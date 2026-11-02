import type { Event } from "../nostr/events";

/**
 * 前後の投稿（Android 版の AroundTimeline）。選んだ投稿の時刻から後を読むとき、リレーは条件に合うものを新しい順に
 * 返すので、`since` だけでは直後ではなく最近のものが返る。そこで区切った時間（`until` を付ける）ごとに読み、
 * 古いほうから並べ直して使う。
 */

/** 後ろを読む最初の区切り（秒）。見つからなければ、区切りを広げていく。 */
export const FIRST_SPAN = 3600;
/** 区切りを広げる上限（約 1 か月）。 */
export const MAX_SPAN = 30 * 24 * 3600;
/** 1 回に足す数。 */
export const STEP = 30;

export type AroundScope = "following" | "global" | "author";
export const AROUND_SCOPES: { scope: AroundScope; label: string }[] = [
  { scope: "following", label: "フォロー中" },
  { scope: "global", label: "グローバル" },
  { scope: "author", label: "この人だけ" },
];

const ascending = (a: Event, b: Event) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * since 以後（since を含む）に読めたもののうち、古いほうから count 件。next は次に読む区切りの始まり（足りたら最後の
 * 時刻。同じ時刻の残りを取りこぼさないよう、その時刻から読み直し、すでにあるものは捨てる）。
 */
export function earliestAfter(events: Event[], since: number, count: number, known: Set<string>): { taken: Event[]; next: number | null } {
  const fresh = events.filter((e) => e.created_at >= since && !known.has(e.id)).sort(ascending);
  const taken = fresh.slice(0, count);
  return { taken, next: fresh.length > count ? taken[taken.length - 1].created_at : null };
}

/** 次の区切りの長さ。何も見つからなかったら 4 倍に広げる（上限あり）。 */
export function nextSpan(span: number, found: boolean): number {
  return found ? FIRST_SPAN : Math.min(MAX_SPAN, span * 4);
}
