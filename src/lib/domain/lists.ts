import type { EventTemplate } from "nostr-tools";
import type { Event } from "../nostr/events";

/**
 * 置き換え可能な一覧（フォロー kind 3・ミュート kind 10000）の書き換えの規則。Android 版の ListSafety・
 * ListRestore と同じ（技術資料 7 章）。通信はしない。
 */

/** タグの見分け方。p・e・t は名前と値、それ以外は名前と最初の 2 つの値。 */
export function tagKey(tag: string[]): string {
  return ["p", "e", "t"].includes(tag[0]) ? `${tag[0]}\u0000${tag[1] ?? ""}` : `${tag[0]}\u0000${tag[1] ?? ""}\u0000${tag[2] ?? ""}`;
}

/** 一覧の項目として数えるタグ（d などの印は数えない）。 */
const ITEM_TAGS = new Set(["p", "e", "t", "word", "a", "emoji", "r"]);
export const items = (tags: string[][]) => tags.filter((tag) => ITEM_TAGS.has(tag[0]) && tag.length >= 2);

export interface ListDiff {
  added: string[][];
  removed: string[][];
}

/** before から after への差（項目のタグだけ）。 */
export function diffTags(before: string[][], after: string[][]): ListDiff {
  const beforeKeys = new Set(items(before).map(tagKey));
  const afterKeys = new Set(items(after).map(tagKey));
  return {
    added: items(after).filter((tag) => !beforeKeys.has(tagKey(tag))),
    removed: items(before).filter((tag) => !afterKeys.has(tagKey(tag))),
  };
}

export type ConfirmReason = "missing" | "emptied" | "many-removed";

/**
 * 送る前に聞くか（技術資料 7.2）。base がない（新しく作る）、空でない一覧が空になる、5 件以上外れる、2 件以上外れて
 * それが 20% 以上。single（一人を足す・外すだけ）のときは、ない・空になるときだけ。
 */
export function confirmReason(base: Event | undefined, next: string[][], single: boolean): ConfirmReason | null {
  if (!base) return "missing";
  const before = items(base.tags).length;
  const after = items(next).length;
  if (before > 0 && after === 0) return "emptied";
  if (single) return null;
  const removed = diffTags(base.tags, next).removed.length;
  if (removed >= 5 || (removed >= 2 && removed >= before * 0.2)) return "many-removed";
  return null;
}

/** 届いた版が大きく減っているか（技術資料 7.3）。5 件以上あったのが空、または 10 件以上外れて半分以上。 */
export function suspiciousDrop(before: Event, after: Event): boolean {
  const count = items(before.tags).length;
  if (count >= 5 && items(after.tags).length === 0) return true;
  const removed = diffTags(before.tags, after.tags).removed.length;
  return removed >= 10 && removed * 2 >= count;
}

/** 次の版の時刻。今と、元の版の時刻 + 1 の大きいほう。 */
export const nextCreatedAt = (now: number, base: Event | undefined) => Math.max(now, (base?.created_at ?? 0) + 1);

/** tag を足す（もうあれば何もしない）。ほかのタグと content は残す。 */
export function withTag(tags: string[][], tag: string[]): string[][] {
  const key = tagKey(tag);
  return tags.some((t) => tagKey(t) === key) ? tags : [...tags, tag];
}

/** name・value のタグを外す。ほかのタグは残す。 */
export const withoutTag = (tags: string[][], name: string, value: string) => tags.filter((tag) => !(tag[0] === name && tag[1] === value));

/** 次の版を作る。 */
export function nextList(kind: number, base: Event | undefined, tags: string[][], now: number, content = base?.content ?? ""): EventTemplate {
  return { kind, created_at: nextCreatedAt(now, base), tags, content };
}

export type RestoreMode = "merge" | "exact";

/**
 * 履歴の版から戻す（技術資料 7.4）。merge は今の一覧に、昔の版にあって今ない項目を足す（content は今のまま）。
 * exact は昔の版のタグと content をそのまま使う。
 */
export function restoreList(current: Event | undefined, old: Event, mode: RestoreMode, now: number): EventTemplate {
  if (mode === "exact") return nextList(old.kind, current, old.tags.map((tag) => [...tag]), now, old.content);
  const tags = current ? current.tags.map((tag) => [...tag]) : [];
  const keys = new Set(tags.map(tagKey));
  for (const tag of items(old.tags)) if (!keys.has(tagKey(tag))) tags.push([...tag]);
  return nextList(old.kind, current, tags, now, current?.content ?? "");
}
