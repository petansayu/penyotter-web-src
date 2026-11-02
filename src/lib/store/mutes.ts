import { root } from "../domain/threads";
import type { Event } from "../nostr/events";
import { viewer } from "./viewer.svelte";

/**
 * ミュートしているか（Android 版の HomeModel の判定と同じ）。ミュートした人の投稿、ミュートした投稿、ミュートした
 * スレッド（根の投稿をミュート）の投稿。
 */
export function isMuted(note: Event): boolean {
  const posts = viewer.mutedEvents;
  return viewer.mutedPubkeys.has(note.pubkey) || posts.has(note.id) || posts.has(root(note));
}

/** 札に出す言葉。人をミュートしたのか、投稿（スレッド）をミュートしたのか。 */
export function mutedLabel(note: Event): string {
  return viewer.mutedPubkeys.has(note.pubkey) ? "ミュートしているユーザーの投稿" : "ミュートした投稿";
}
