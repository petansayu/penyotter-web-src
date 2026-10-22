import { SvelteMap } from "svelte/reactivity";
import { newer, type Event } from "../nostr/events";
import { fetchFromAuthor, fetchFromAuthors, INDEXER_RELAYS } from "../nostr/outbox";
import { eventsOf, pool } from "../nostr/pool";
import { publicRelay, relaySet } from "../nostr/relayUrl";
import { readProfiles, saveProfiles, saveScope, type Scope } from "./db";
import { viewer } from "./viewer.svelte";

/** 読んだ投稿とプロフィール。画面をまたいで使い、ブラウザ（IndexedDB）にも保存する。 */

export interface Profile {
  name?: string;
  displayName?: string;
  picture?: string;
  banner?: string;
  about?: string;
  nip05?: string;
  website?: string;
  lud16?: string;
  /** NIP-24 の bot。 */
  bot?: boolean;
  /** NIP-24 の誕生日（年・月・日はどれも省略できる）。 */
  birthday?: { year?: number; month?: number; day?: number };
}

/** NIP-24 の誕生日を読む（Android 版の ProfileInfo.birthday と同じ確かめ方）。 */
function birthdayOf(value: unknown): Profile["birthday"] {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const number = (key: string, min: number, max: number): number | null | undefined => {
    if (!(key in raw)) return undefined;
    const v = raw[key];
    return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
  };
  const year = number("year", 1, 9999);
  const month = number("month", 1, 12);
  const day = number("day", 1, 31);
  if (year === null || month === null || day === null || (year === undefined && month === undefined && day === undefined)) return undefined;
  if (month !== undefined && day !== undefined) {
    const date = new Date(Date.UTC(year ?? 2000, month - 1, day));
    if (date.getUTCMonth() !== month - 1) return undefined;
  }
  return { year, month, day };
}

export const notes = new SvelteMap<string, Event>();
export const profiles = new SvelteMap<string, { event: Event; profile: Profile }>();

/**
 * 投稿を覚える。save に一覧を渡すとブラウザにも保存する（既定は「見た投稿」の notes。ホームの一覧の投稿は
 * ホームの一覧として別に保存するので null、保存分から読んだものも null）。
 */
export function keepNotes(events: Iterable<Event>, save: Scope | null = "notes") {
  const fresh: Event[] = [];
  for (const event of events) {
    if (notes.has(event.id)) continue;
    notes.set(event.id, event);
    fresh.push(event);
  }
  if (save && fresh.length > 0 && viewer.pubkey) void saveScope(viewer.pubkey, save, fresh);
}

let profileWrites: Event[] = [];
let profileTimer: ReturnType<typeof setTimeout> | undefined;

/** プロフィールを覚える。新しいものだけ。save なら、まとめてブラウザにも保存する。 */
export function keepProfiles(events: Iterable<Event>, save = true) {
  for (const event of events) {
    if (event.kind !== 0 || !newer(event, profiles.get(event.pubkey)?.event)) continue;
    const profile = parseProfile(event.content);
    if (!profile) continue;
    profiles.set(event.pubkey, { event, profile });
    if (save) profileWrites.push(event);
  }
  if (profileWrites.length > 0) profileTimer ??= setTimeout(() => {
    profileTimer = undefined;
    const batch = profileWrites;
    profileWrites = [];
    if (viewer.pubkey) void saveProfiles(viewer.pubkey, batch);
  }, 1000);
}

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const https = (value: unknown) => {
  const url = text(value, 2048);
  try {
    return url && new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};

export function parseProfile(content: string): Profile | null {
  try {
    const raw = JSON.parse(content) as Record<string, unknown>;
    if (typeof raw !== "object" || raw === null) return null;
    return {
      name: text(raw.name, 100),
      displayName: text(raw.display_name ?? raw.displayName, 100),
      picture: https(raw.picture),
      banner: https(raw.banner),
      about: text(raw.about, 4000),
      nip05: text(raw.nip05, 200),
      website: https(raw.website),
      lud16: text(raw.lud16, 200),
      bot: raw.bot === true,
      birthday: birthdayOf(raw.birthday),
    };
  } catch {
    return null;
  }
}

export function displayName(pubkey: string): string {
  const profile = profiles.get(pubkey)?.profile;
  return profile?.displayName || profile?.name || `${pubkey.slice(0, 8)}…`;
}

const requested = new Set<string>();
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** プロフィールを読む。まとめて（80 人ずつ）、相手の書き込みリレーから読む（技術資料 5.2）。 */
export function requestProfiles(pubkeys: Iterable<string>) {
  for (const pubkey of pubkeys) {
    if (requested.has(pubkey)) continue;
    requested.add(pubkey);
    queue.add(pubkey);
  }
  if (queue.size === 0 || timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    const batch = [...queue];
    queue = new Set();
    // 保存したものを先に出し、リレーからも読み直す
    if (viewer.pubkey) void readProfiles(viewer.pubkey, batch).then((saved) => keepProfiles(saved, false));
    for (let i = 0; i < batch.length; i += 80) {
      const authors = batch.slice(i, i + 80);
      const keep = (event: Event) => keepProfiles([event]);
      void fetchFromAuthors(authors, { kinds: [0] }, viewer.alwaysOn, keep);
      void pool.fetch(INDEXER_RELAYS, [{ kinds: [0], authors }], { onEvent: keep });
    }
  }, 150);
}

const loadingNotes = new Map<string, Promise<Event | null>>();

/** ID で 1 件読む（引用カードなど）。種類を問わない。ヒントと作者が分かればそのリレーからも読む。 */
export function requestNote(id: string, hints: string[] = [], author?: string): Promise<Event | null> {
  const known = notes.get(id);
  if (known) return Promise.resolve(known);
  let loading = loadingNotes.get(id);
  if (!loading) {
    const filters = [{ ids: [id], limit: 1 }];
    const safeHints = relaySet(hints, 4, publicRelay);
    const relays = relaySet([...safeHints, ...viewer.readRelays]);
    loading = (author ? fetchFromAuthor(author, filters, viewer.readRelays, safeHints) : pool.fetch(relays, filters)).then((fetched) => {
      const event = eventsOf(fetched).find((e) => e.id === id) ?? null;
      if (event) keepNotes([event]);
      // 見つからなかったものは、次に開いたときにもう一度探す
      else loadingNotes.delete(id);
      return event;
    });
    loadingNotes.set(id, loading);
  }
  return loading;
}
