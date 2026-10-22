import { isHex64, type Event } from "../nostr/events";
import { repostTarget } from "./reposts";
import { parent } from "./threads";

/**
 * 返信・リポスト・リアクションの数と、削除の依頼（Android 版の InteractionCounts・ReactionSync・NoteDeletion、
 * 技術資料 5.2・8.1）。
 */

export interface Counts {
  replies: number;
  reposts: number;
  reactions: number;
  /** 取得が完了したか。完了していなければ「≥N」と出す。 */
  complete: boolean;
}

/** kind 7 のリアクション先（最後の `e`）。 */
export function reactionTarget(event: Event): string | null {
  if (event.kind !== 7) return null;
  for (let i = event.tags.length - 1; i >= 0; i--) {
    const tag = event.tags[i];
    if (tag.length >= 2 && tag[0] === "e" && isHex64(tag[1])) return tag[1];
  }
  return null;
}

/**
 * kind 5 で、その作者本人が削除を依頼したイベントの ID（`作者:ID` の組）。削除の依頼として扱うのは、
 * イベントの作者本人の kind 5 だけ（ほかの人の kind 5 は無視する）。
 */
export function deletionKeys(events: Iterable<Event>): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.kind !== 5) continue;
    for (const tag of event.tags) if (tag.length >= 2 && tag[0] === "e" && isHex64(tag[1])) keys.add(`${event.pubkey}:${tag[1]}`);
  }
  return keys;
}

export const deletedBy = (keys: Set<string>, event: Event) => keys.has(`${event.pubkey}:${event.id}`);

/**
 * 数を数える。返信は NIP-10・NIP-22 の親がその投稿のものだけ、リポストは kind 6・16、リアクションは kind 7。
 * 本人が kind 5 で取り消したものは数えない。同じイベントは 1 つと数える。
 */
export function countInteractions(targets: Iterable<string>, events: Iterable<Event>, complete: boolean): Map<string, Counts> {
  const unique = new Map<string, Event>();
  for (const event of events) unique.set(event.id, event);
  const removed = deletionKeys(unique.values());
  const result = new Map<string, Counts>();
  for (const target of targets) result.set(target, { replies: 0, reposts: 0, reactions: 0, complete });
  for (const event of unique.values()) {
    if (deletedBy(removed, event)) continue;
    let counts: Counts | undefined;
    if (event.kind === 1 || event.kind === 1111) {
      const to = parent(event);
      if (to && (counts = result.get(to))) counts.replies++;
    } else if (event.kind === 6 || event.kind === 16) {
      if ((counts = result.get(repostTarget(event) ?? ""))) counts.reposts++;
    } else if (event.kind === 7) {
      if ((counts = result.get(reactionTarget(event) ?? ""))) counts.reactions++;
    }
  }
  return result;
}

/** 数の短い書き方（Android 版の InteractionCounts.compact）。0 は空。 */
export function compact(value: number): string {
  if (value <= 0) return "";
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${Math.floor(value / 1_000)}.${Math.floor(value / 100) % 10}K`;
  if (value < 1_000_000) return `${Math.floor(value / 1_000)}K`;
  if (value < 10_000_000) return `${Math.floor(value / 1_000_000)}.${Math.floor(value / 100_000) % 10}M`;
  return `${Math.floor(value / 1_000_000)}M`;
}

/**
 * 自分がした（ほかの端末でしたものも含む）リアクションとリポストを、投稿 ID ごとに新しいもの 1 つずつ拾う。
 * 本人が kind 5 で取り消したものは除き、その ID は removed に入れる（Android 版の ReactionSync.active）。
 */
export function ownActions(events: Iterable<Event>, me: string): { reactions: Map<string, Event>; reposts: Map<string, Event>; removed: Set<string> } {
  const unique = new Map<string, Event>();
  for (const event of events) if (event.pubkey === me) unique.set(event.id, event);
  const removed = new Set<string>();
  for (const key of deletionKeys(unique.values())) removed.add(key.slice(key.indexOf(":") + 1));
  const reactions = new Map<string, Event>();
  const reposts = new Map<string, Event>();
  for (const event of unique.values()) {
    if (removed.has(event.id)) continue;
    const target = event.kind === 7 ? reactionTarget(event) : event.kind === 6 || event.kind === 16 ? repostTarget(event) : null;
    if (!target) continue;
    const map = event.kind === 7 ? reactions : reposts;
    const current = map.get(target);
    if (!current || event.created_at > current.created_at) map.set(target, event);
  }
  return { reactions, reposts, removed };
}
