import { getEventHash, matchFilters, verifyEvent, type Event, type Filter } from "nostr-tools";

export type { Event, Filter };

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

/**
 * リレーから届いた EVENT を使ってよいか（Android 版の技術資料 4.2.1）。形・ID・署名・時刻・大きさ・NIP-40 の期限と、
 * その REQ のフィルタに合っているかを確かめる。署名の確認がいちばん重いので最後に行う。
 */
export function acceptable(event: unknown, filters: Filter[], now = Date.now() / 1000): event is Event {
  if (typeof event !== "object" || event === null) return false;
  const e = event as Record<string, unknown>;
  if (typeof e.id !== "string" || !HEX64.test(e.id)) return false;
  if (typeof e.pubkey !== "string" || !HEX64.test(e.pubkey)) return false;
  if (typeof e.sig !== "string" || !HEX128.test(e.sig)) return false;
  if (typeof e.created_at !== "number" || !Number.isInteger(e.created_at) || e.created_at < 0 || e.created_at > now + 600) return false;
  if (typeof e.kind !== "number" || !Number.isInteger(e.kind) || e.kind < 0 || e.kind > 65535) return false;
  if (typeof e.content !== "string" || e.content.length > 64000) return false;
  if (!Array.isArray(e.tags) || e.tags.length > 4000) return false;
  if (!e.tags.every((tag) => Array.isArray(tag) && tag.every((value) => typeof value === "string"))) return false;
  const typed = event as Event;
  if (expired(typed, now)) return false;
  if (!matchFilters(filters, typed)) return false;
  return verified(typed);
}

/**
 * 署名を確かめた ID と署名（新しい 20,000 件）。同じ投稿はいくつものリレーから届くので、ID を計算し直して合い、
 * 署名も前に確かめたものと同じなら、重い署名の確認を省く（スクロールがカクつく原因の一つだった）。
 */
const checked = new Map<string, string>();
const CHECKED_LIMIT = 20_000;

function verified(event: Event): boolean {
  if (checked.get(event.id) === event.sig) return getEventHash(event) === event.id;
  if (!verifyEvent(event)) return false;
  checked.set(event.id, event.sig);
  if (checked.size > CHECKED_LIMIT) checked.delete(checked.keys().next().value!);
  return true;
}

/** NIP-40 の期限を過ぎているか。 */
export function expired(event: Event, now = Date.now() / 1000): boolean {
  const value = tagValue(event, "expiration");
  if (!value || !/^\d+$/.test(value)) return false;
  return Number(value) <= now;
}

export function tagValue(event: Event, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name && tag.length >= 2)?.[1];
}

/** 置き換え可能なイベントで新しいほう（created_at が大きい、同じなら ID が小さい。NIP-01）。 */
export function newer(a: Event, b: Event | undefined): boolean {
  if (!b) return true;
  return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
}

export function latest(events: Iterable<Event>): Event | undefined {
  let best: Event | undefined;
  for (const event of events) if (newer(event, best)) best = event;
  return best;
}

/** 新しい順（同じ時刻なら ID の順）。 */
export function byNewest(a: Event, b: Event): number {
  return b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const isHex64 = (value: string | undefined): boolean => !!value && HEX64.test(value);
