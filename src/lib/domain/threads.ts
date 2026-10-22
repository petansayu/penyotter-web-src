import { isHex64, type Event } from "../nostr/events";

/** Android 版の Threads と同じ、返信の親と根の決め方（kind 1 は NIP-10、kind 1111 は NIP-22）。 */

export function address(event: Event): string | null {
  const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === "d")?.[1];
  return d === undefined ? null : `${event.kind}:${event.pubkey}:${d}`;
}

/** 返信がこのイベントを指すときの値（アドレスで指すイベントならアドレス、ほかは ID）。 */
export function reference(event: Event): string {
  return event.kind >= 30000 && event.kind <= 39999 ? address(event) ?? event.id : event.id;
}

export function parent(event: Event): string | null {
  const tags = event.tags;
  // アドレスで指すイベントへのコメントは a と e の両方を付ける（NIP-22）。reference が使うのはアドレス
  if (event.kind === 1111) {
    const tag = findLast(tags, (t) => t.length >= 2 && t[0] === "a")
      ?? findLast(tags, (t) => t.length >= 2 && t[0] === "e" && isHex64(t[1]))
      ?? findLast(tags, (t) => t.length >= 2 && t[0] === "i");
    return tag?.[1] ?? null;
  }
  // NIP-10 の返信は kind 1 だけ。ほかのイベント（記事・画像など）は返信でなく e タグで投稿に触れる
  if (event.kind !== 1) return null;
  const refs = tags.filter((t) => t.length >= 2 && t[0] === "e" && isHex64(t[1]));
  return findLast(refs, (t) => t[3] === "reply")?.[1]
    ?? refs.find((t) => t[3] === "root")?.[1]
    ?? findLast(refs, (t) => !t[3])?.[1]
    ?? null;
}

export function root(event: Event): string {
  if (event.kind !== 1 && event.kind !== 1111) return reference(event);
  if (event.kind === 1111) {
    const tag = event.tags.find((t) => t.length >= 2 && t[0] === "A")
      ?? event.tags.find((t) => t.length >= 2 && t[0] === "E" && isHex64(t[1]))
      ?? event.tags.find((t) => t.length >= 2 && t[0] === "I");
    if (tag) return tag[1];
  }
  return event.tags.find((t) => t.length >= 2 && t[0] === "e" && t[3] === "root" && isHex64(t[1]))?.[1] ?? reference(event);
}

export interface Chain { ancestors: Event[]; missing: string | null; truncated: boolean }

/** 選んだ投稿の返信元を、手元にある分だけたどる（20 段まで、循環しない）。 */
export function chain(selected: Event, events: Iterable<Event>, limit = 20): Chain {
  const byReference = new Map<string, Event>();
  for (const event of events) byReference.set(reference(event), event);
  const seen = new Set([reference(selected)]);
  const ancestors: Event[] = [];
  let next = parent(selected);
  while (next !== null) {
    if (seen.has(next) || ancestors.length >= limit) return { ancestors: ancestors.reverse(), missing: null, truncated: true };
    seen.add(next);
    const event = byReference.get(next);
    if (!event) return { ancestors: ancestors.reverse(), missing: next, truncated: false };
    ancestors.push(event);
    next = parent(event);
  }
  return { ancestors: ancestors.reverse(), missing: null, truncated: false };
}

export interface ReplyNode { event: Event; depth: number }

/** 手元にある返信を、深さ優先で並べる（循環しない、200 件まで）。 */
export function descendants(selected: Event, events: Iterable<Event>, limit = 200): ReplyNode[] {
  const children = new Map<string, Event[]>();
  const unique = new Map<string, Event>();
  for (const event of events) if (event.id !== selected.id) unique.set(event.id, event);
  for (const event of unique.values()) {
    const key = parent(event);
    if (key !== null) children.set(key, [...(children.get(key) ?? []), event]);
  }
  for (const list of children.values()) list.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
  const result: ReplyNode[] = [];
  const seen = new Set([reference(selected)]);
  const append = (key: string, depth: number) => {
    for (const event of children.get(key) ?? []) {
      if (result.length >= limit || seen.has(event.id)) continue;
      seen.add(event.id);
      result.push({ event, depth });
      append(reference(event), depth + 1);
    }
  };
  append(reference(selected), 0);
  return result;
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i])) return items[i];
  return undefined;
}
