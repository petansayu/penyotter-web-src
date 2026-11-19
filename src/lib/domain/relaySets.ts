import type { EventTemplate } from "nostr-tools";
import { isHex64, type Event } from "../nostr/events";

/**
 * リレーセット（NIP-51 の kind 30002。Android 版の RelaySets・RelaySetEditing と同じ）。名前のついたリレーのまとまりで、
 * 選ぶとそのリレーにあるだれの投稿でも新しい順に出す。書き換えるのは公開の `relay` タグと名前だけで、ほかのタグと
 * 暗号化した content（非公開のリレー）はそのまま残す。
 */

export const RELAY_SET_KIND = 30002;
/** 1 つのタイムラインで同時に読むリレーの数。 */
export const MAX_READ_RELAYS = 12;
export const MAX_SET_RELAYS = 100;
export const MAX_SET_TITLE = 100;

export interface RelaySet {
  address: string;
  identifier: string;
  title: string;
  description: string;
  relays: string[];
  /** 非公開の部分にだけあるリレー（出すだけで、ここでは変えない）。 */
  privateRelays: string[];
}

export type RelaySetChange = { type: "add"; relay: string } | { type: "remove"; relay: string } | { type: "rename"; title: string };

/** 保存するリレーのアドレス（wss だけ、ユーザー・フラグメントなし、最後の / は落とす）。違えば null。 */
export function normalizeSetRelay(raw: string): string | null {
  const text = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(text);
    if (url.protocol !== "wss:" || !url.hostname || url.username || url.password || url.hash || text.length > 300) return null;
    return text;
  } catch {
    return null;
  }
}

export const relaysIn = (tags: string[][]) => [...new Set(tags.filter((t) => t.length >= 2 && t[0] === "relay").map((t) => normalizeSetRelay(t[1])).filter((u): u is string => !!u))];
export const setIdentifier = (tags: string[][]) => tags.find((t) => t.length >= 2 && t[0] === "d")?.[1] ?? null;

/** owner のセットの、識別子ごとのいちばん新しい版。 */
export function newestSets(events: Iterable<Event>, owner: string): Event[] {
  const newest = new Map<string, Event>();
  for (const event of events) {
    const id = event.kind === RELAY_SET_KIND && event.pubkey === owner ? setIdentifier(event.tags) : null;
    if (id === null) continue;
    const current = newest.get(id);
    if (!current || event.created_at > current.created_at || (event.created_at === current.created_at && event.id < current.id)) newest.set(id, event);
  }
  return [...newest.values()];
}

/** セットを読む。hidden はそのセットの非公開のタグ（読めなければ空）。名前の順。 */
export function parseRelaySets(events: Iterable<Event>, owner: string, hidden: (event: Event) => string[][] = () => []): RelaySet[] {
  return newestSets(events, owner).map((event) => {
    const identifier = setIdentifier(event.tags) ?? "";
    const tag = (name: string) => event.tags.find((t) => t.length >= 2 && t[0] === name)?.[1]?.trim();
    const publicRelays = relaysIn(event.tags);
    const privateRelays = event.content.trim() ? relaysIn(hidden(event)).filter((url) => !publicRelays.includes(url)) : [];
    return {
      address: `${RELAY_SET_KIND}:${owner}:${identifier}`,
      identifier,
      title: (tag("title") || tag("name") || identifier || "名前のないリレーセット").slice(0, MAX_SET_TITLE),
      description: (tag("description") ?? "").slice(0, 300),
      relays: publicRelays.slice(0, MAX_SET_RELAYS),
      privateRelays: privateRelays.slice(0, MAX_SET_RELAYS),
    };
  }).sort((a, b) => a.title.localeCompare(b.title, "ja"));
}

/** セットのタイムラインで読むリレー（公開のものを先に、12 件まで）。 */
export const feedRelays = (set: RelaySet) => [...new Set([...set.relays, ...set.privateRelays])].slice(0, MAX_READ_RELAYS);

export const newSetIdentifier = (now: number, random: number) => `penyotter-${now.toString(36)}-${(random & 0xffff).toString(36)}`;

function cleanTitle(title: string): string {
  const name = title.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("リレーセットの名前を入れてください");
  if (name.length > MAX_SET_TITLE) throw new Error(`リレーセットの名前は ${MAX_SET_TITLE} 文字までです`);
  return name;
}

export function createRelaySet(identifier: string, title: string, relays: string[], now: number): EventTemplate {
  if (!identifier.trim() || identifier.length > 256) throw new Error("リレーセットの識別子が正しくありません");
  const urls = [...new Set(relays.map((raw) => {
    const url = normalizeSetRelay(raw);
    if (!url) throw new Error("wss:// で始まるリレーのアドレスを入れてください");
    return url;
  }))];
  if (urls.length > MAX_SET_RELAYS) throw new Error(`1 つのリレーセットに入れられるリレーは ${MAX_SET_RELAYS} 件までです`);
  return { kind: RELAY_SET_KIND, created_at: now, tags: [["d", identifier], ["title", cleanTitle(title)], ...urls.map((url) => ["relay", url])], content: "" };
}

export function editRelaySet(me: string, base: Event, change: RelaySetChange, now: number): EventTemplate {
  if (!isHex64(me) || base.pubkey !== me || base.kind !== RELAY_SET_KIND) throw new Error("自分のリレーセットではありません");
  const identifier = setIdentifier(base.tags);
  if (!identifier) throw new Error("リレーセットの識別子がありません");
  let tags = base.tags.map((tag) => [...tag]);
  if (change.type === "add") {
    const url = normalizeSetRelay(change.relay);
    if (!url) throw new Error("wss:// で始まるリレーのアドレスを入れてください");
    if (!relaysIn(tags).includes(url)) {
      if (relaysIn(tags).length >= MAX_SET_RELAYS) throw new Error(`1 つのリレーセットに入れられるリレーは ${MAX_SET_RELAYS} 件までです`);
      tags.push(["relay", url]);
    }
  } else if (change.type === "remove") {
    const url = normalizeSetRelay(change.relay) ?? change.relay;
    tags = tags.filter((t) => !(t[0] === "relay" && t.length >= 2 && (normalizeSetRelay(t[1]) ?? t[1]) === url));
  } else {
    const name = cleanTitle(change.title);
    const index = tags.findIndex((t) => t[0] === "title");
    if (index >= 0) tags[index] = ["title", name];
    else tags.splice(tags.findIndex((t) => t[0] === "d") + 1, 0, ["title", name]);
  }
  if (base.created_at >= now + 60) throw new Error("リレーセットの時刻が未来になっています。しばらく待って再試行してください");
  if (setIdentifier(tags) !== identifier) throw new Error("リレーセットの識別子が変わってしまいます");
  return { kind: RELAY_SET_KIND, created_at: Math.max(now, base.created_at + 1), tags, content: base.content };
}
