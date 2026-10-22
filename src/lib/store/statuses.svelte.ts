import { SvelteMap } from "svelte/reactivity";
import { latestStatuses, type UserStatus } from "../domain/cardInfo";
import type { Event } from "../nostr/events";
import { fetchFromAuthors } from "../nostr/outbox";
import { viewer } from "./viewer.svelte";

/**
 * ステータス（NIP-38、kind 30315）。投稿カードの名前の下に出す（Android 版の LocalUserStatuses）。表示した人の分を
 * まとめて（80 人ずつ）その人の書き込みリレーから読む。この間に 1 回だけ読む。
 */

export const statuses = new SvelteMap<string, UserStatus[]>();
const events = new Map<string, Event[]>();
const requested = new Set<string>();
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function keep(event: Event) {
  if (event.kind !== 30315) return;
  const list = events.get(event.pubkey) ?? [];
  if (list.some((e) => e.id === event.id)) return;
  list.push(event);
  events.set(event.pubkey, list);
  statuses.set(event.pubkey, latestStatuses(list, event.pubkey, Math.floor(Date.now() / 1000)));
}

/** 自分で書き換えたステータスを出す。 */
export const applyStatus = (event: Event) => keep(event);

export function requestStatuses(pubkeys: Iterable<string>) {
  for (const pubkey of pubkeys) {
    if (requested.has(pubkey)) continue;
    requested.add(pubkey);
    queue.add(pubkey);
  }
  if (queue.size === 0 || timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    const batch = [...queue];
    queue = new Set();
    for (let i = 0; i < batch.length; i += 80) {
      void fetchFromAuthors(batch.slice(i, i + 80), { kinds: [30315], "#d": ["general", "music"] }, viewer.alwaysOn, keep, 400);
    }
  }, 300);
}
