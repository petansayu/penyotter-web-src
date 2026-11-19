import type { Event } from "../nostr/events";

/**
 * リアクション・リポストのメニュー（Android 版の InteractionMenu）で操作するイベント。投稿詳細のリアクション・
 * リポストの一覧と、タイムラインの「〜がリポスト」の行から開く。App.svelte に 1 つだけ置く。
 */
export const interactionMenu = $state<{ event: Event | null }>({ event: null });

export function openInteractionMenu(event: Event) {
  interactionMenu.event = event;
}
