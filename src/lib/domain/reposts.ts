import { verifyEvent } from "nostr-tools";
import { isHex64, type Event } from "../nostr/events";
import { fetchFromAuthors } from "../nostr/outbox";
import { eventsOf, merge, pool } from "../nostr/pool";
import { publicRelay } from "../nostr/relayUrl";

/** Android 版の Reposts・RepostTargets と同じ、リポスト元の決め方と探し方。 */

const TARGET_KINDS = [1, 1111];
const MAX_HINT_RELAYS = 4;
const MAX_AUTHORS = 20;

export const isRepost = (event: Event) => event.kind === 6 || event.kind === 16;

export function repostTarget(event: Event): string | null {
  if (!isRepost(event)) return null;
  for (let i = event.tags.length - 1; i >= 0; i--) {
    const tag = event.tags[i];
    if (tag.length >= 2 && tag[0] === "e" && isHex64(tag[1])) return tag[1];
  }
  return null;
}

/** リポストした人が元の投稿を見たリレー（`e` タグのヒント）。公開の wss:// だけ。 */
export function relayHints(event: Event): string[] {
  const target = repostTarget(event);
  if (!target) return [];
  const hints = event.tags.filter((tag) => tag.length >= 3 && tag[0] === "e" && tag[1] === target).map((tag) => publicRelay(tag[2]));
  return [...new Set(hints.filter((url): url is string => !!url))];
}

/** リポストの `p` タグの人（ふつうは先頭が元の作者）。3 人まで。 */
export function repostAuthors(event: Event): string[] {
  return [...new Set(event.tags.filter((tag) => tag.length >= 2 && tag[0] === "p" && isHex64(tag[1])).map((tag) => tag[1]))].slice(0, 3);
}

/** リポストの content に入っている署名つきの元の投稿（kind 1・1111 で、署名が正しいときだけ）。 */
export function embeddedTarget(event: Event): Event | null {
  const target = repostTarget(event);
  if (!target || !event.content.trim().startsWith("{")) return null;
  try {
    const inner = JSON.parse(event.content) as Event;
    if (inner.id !== target || !TARGET_KINDS.includes(inner.kind) || !verifyEvent(inner)) return null;
    return inner;
  } catch {
    return null;
  }
}

/**
 * 本文にも手元にもないリポスト元を探す（技術資料 5.2）。読み込みリレー → まだない分はリポストのヒント（多いものから
 * 4 件、読み込みリレーは除く）と `p` の人（合わせて 20 人まで）の書き込みリレーへ同時に。
 */
export async function resolveRepostTargets(reposts: Event[], known: (id: string) => boolean, readRelays: string[]): Promise<Event[]> {
  const found = new Map<string, Event>();
  const missing = () => [...new Set(reposts.map(repostTarget).filter((id): id is string => !!id && !known(id) && !found.has(id)))];
  const keep = (events: Event[], ids: string[]) => {
    for (const event of events) if (TARGET_KINDS.includes(event.kind) && ids.includes(event.id) && !found.has(event.id)) found.set(event.id, event);
  };
  const first = missing();
  if (first.length === 0) return [];
  if (readRelays.length > 0) keep(eventsOf(await pool.fetch(readRelays, chunkIds(first))), first);
  const rest = missing();
  if (rest.length === 0) return [...found.values()];
  const pending = reposts.filter((event) => rest.includes(repostTarget(event) ?? ""));
  const counts = new Map<string, number>();
  for (const url of pending.flatMap(relayHints)) if (!readRelays.includes(url)) counts.set(url, (counts.get(url) ?? 0) + 1);
  const hinted = [...counts].sort((a, b) => b[1] - a[1]).map(([url]) => url).slice(0, MAX_HINT_RELAYS);
  const authors = [...new Set(pending.flatMap(repostAuthors))].slice(0, MAX_AUTHORS);
  const [fromHints, fromAuthors] = await Promise.all([
    hinted.length > 0 ? pool.fetch(hinted, chunkIds(rest)) : Promise.resolve(merge([])),
    authors.length > 0 ? fetchFromAuthors(authors, { kinds: TARGET_KINDS, ids: rest }, readRelays) : Promise.resolve(merge([])),
  ]);
  keep(eventsOf(fromHints), rest);
  keep(eventsOf(fromAuthors), rest);
  return [...found.values()];
}

/**
 * ID だけ分かっている投稿（リアクションの先など）を探す。読み込みリレー → まだない分は authors（20 人まで）の
 * 書き込みリレーから。kinds の種類だけを受け取る。
 */
export async function resolveTargets(ids: (string | null)[], authors: string[], known: (id: string) => boolean, readRelays: string[], kinds: number[]): Promise<Event[]> {
  const found = new Map<string, Event>();
  const missing = () => [...new Set(ids.filter((id): id is string => !!id && isHex64(id) && !known(id) && !found.has(id)))];
  const keep = (events: Event[], wanted: string[]) => {
    for (const event of events) if (kinds.includes(event.kind) && wanted.includes(event.id)) found.set(event.id, event);
  };
  const first = missing();
  if (first.length === 0) return [];
  if (readRelays.length > 0) keep(eventsOf(await pool.fetch(readRelays, chunkIds(first, kinds))), first);
  const rest = missing();
  const people = [...new Set(authors.filter(isHex64))].slice(0, MAX_AUTHORS);
  if (rest.length > 0 && people.length > 0) keep(eventsOf(await fetchFromAuthors(people, { kinds, ids: rest }, readRelays)), rest);
  return [...found.values()];
}

function chunkIds(ids: string[], kinds = TARGET_KINDS) {
  const filters = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    filters.push({ kinds, ids: chunk, limit: chunk.length });
  }
  return filters;
}
