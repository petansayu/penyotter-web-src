import { SvelteMap } from "svelte/reactivity";
import { blossomServersOf, buildBlossomServers } from "../domain/media";
import { latest, type Event } from "../nostr/events";
import { fetchFromAuthors } from "../nostr/outbox";
import { eventsOf, pool, publish, type PublishResult } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { viewer } from "./viewer.svelte";

/**
 * Blossom のサーバー一覧（kind 10063、Android 版の BlossomServers・LocalBlossomServers）。画像が読めないとき、同じ
 * ハッシュの画像を作者のほかのサーバーから読む。表示した人の分をまとめて（80 人ずつ）読む。
 */

export const blossomServers = new SvelteMap<string, string[]>();
const newest = new Map<string, Event>();
const requested = new Set<string>();
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function keep(event: Event) {
  if (event.kind !== 10063) return;
  const known = newest.get(event.pubkey);
  if (known && known.created_at >= event.created_at) return;
  newest.set(event.pubkey, event);
  blossomServers.set(event.pubkey, blossomServersOf(event.tags));
}

export function requestBlossomServers(pubkey: string) {
  if (requested.has(pubkey)) return;
  requested.add(pubkey);
  queue.add(pubkey);
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    const batch = [...queue];
    queue = new Set();
    for (let i = 0; i < batch.length; i += 80) void fetchFromAuthors(batch.slice(i, i + 80), { kinds: [10063] }, viewer.alwaysOn, keep, 200);
  }, 300);
}

/** 自分の一覧を読む（設定の画面）。 */
export async function loadOwnBlossomServers(): Promise<string[]> {
  const me = viewer.pubkey!;
  const event = latest(eventsOf(await pool.fetch(relaySet([...viewer.readRelays, ...viewer.writeRelays]), [{ kinds: [10063], authors: [me], limit: 5 }])));
  if (event) keep(event);
  return event ? blossomServersOf(event.tags) : [];
}

/** 自分の一覧を公開する（書き込みリレーへ）。 */
export async function publishBlossomServers(servers: string[]): Promise<PublishResult> {
  if (!viewer.pubkey || !viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
  const signer = await viewer.getSigner();
  const event = await signer.sign(buildBlossomServers(servers, Math.floor(Date.now() / 1000)));
  const result = await publish(viewer.writeRelays, event);
  if (result.accepted > 0) keep(event);
  return result;
}
