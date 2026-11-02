import type { Event } from "nostr-tools";

/**
 * ここまで読んだ（しおり）。ホームで画面に出たいちばん新しい投稿（time はリポストならリポストの時刻）。Android 版の
 * ReadMarker。次に開いたとき、これより新しい投稿との境目に「ここまで読みました」の線を引く。
 */
export interface ReadMarker { time: number; key: string }

interface Placed { key: string; note: Event; repost?: Event }

/** 一覧での時刻（リポストはリポストした時刻）。 */
export const feedTime = (card: Placed) => (card.repost ?? card.note).created_at;

/** 線を引く位置（その投稿の上）。上に新しい投稿がないとき、しおりが読んだどれよりも古いときは null。 */
export function lineIndex(cards: Placed[], marker: ReadMarker | null): number | null {
  if (!marker) return null;
  const index = cards.findIndex((card) => feedTime(card) <= marker.time);
  return index > 0 ? index : null;
}

/** しおりが読んだどの投稿よりも古い（戻る場所は、まだ読んでいない先にある）。 */
export const beyond = (cards: Placed[], marker: ReadMarker | null) =>
  !!marker && cards.length > 0 && cards.every((card) => feedTime(card) > marker.time);
