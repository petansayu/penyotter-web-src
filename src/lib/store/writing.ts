import { buildReport, buildStatus, buildVanish, buildVote, newestStatus, type Poll, type StatusType } from "../domain/extraEvents";
import type { Event } from "../nostr/events";
import { INDEXER_RELAYS } from "../nostr/outbox";
import { eventsOf, pool, publish, type PublishResult } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { TEST_RELAY } from "../nostr/testMode";
import { emojis } from "./emojis.svelte";
import { searchRelays } from "./search.svelte";
import { applyStatus } from "./statuses.svelte";
import { viewer } from "./viewer.svelte";

/** 投稿以外の書き込み（ステータス・投票・通報・消去の依頼。技術資料 6.11・6.12）。 */

const now = () => Math.floor(Date.now() / 1000);

async function signer() {
  if (!viewer.pubkey || !viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
  return viewer.getSigner();
}

/** 自分のステータスを読み直す（取り切れなければ書き換えない）。 */
async function ownStatuses(me: string): Promise<Event[]> {
  const fetched = await pool.fetch(relaySet([...viewer.readRelays, ...viewer.writeRelays]), [{ kinds: [30315], authors: [me], limit: 20 }]);
  if (!fetched.complete) throw new Error("最新のステータスを取得できませんでした。接続を確認して再試行してください");
  return eventsOf(fetched);
}

/** 編集の画面を開くときの今のステータス。 */
export async function loadOwnStatuses(): Promise<Record<StatusType, Event | undefined>> {
  const me = viewer.pubkey!;
  const events = await ownStatuses(me);
  return { general: newestStatus(events, me, "general"), music: newestStatus(events, me, "music") };
}

/**
 * ステータスを書き換える。base は画面を開いたときの版。その後にほかのアプリで新しい版が出ていたら送らない。
 * content が空なら消す（NIP-38）。
 */
export async function saveStatus(type: StatusType, base: Event | undefined, content: string): Promise<PublishResult> {
  const sign = await signer();
  const me = viewer.pubkey!;
  const latest = newestStatus(await ownStatuses(me), me, type);
  if (latest && base?.id !== latest.id && (!base || latest.created_at >= base.created_at)) throw new Error("別のステータス更新が見つかりました。開き直してください");
  const event = await sign.sign(buildStatus(me, type, latest ?? base, content.trim(), emojis.custom, now()));
  const result = await publish(viewer.writeRelays, event);
  if (result.accepted > 0) applyStatus(event);
  return result;
}

/** 投票の答え（kind 1018）を、投票のリレーと読み込みリレーから読む。 */
export async function loadPollResponses(poll: Poll): Promise<Event[]> {
  const relays = relaySet([...poll.relays, ...viewer.readRelays]);
  return eventsOf(await pool.fetch(relays, [{ kinds: [1018], "#e": [poll.id], limit: 1000 }]));
}

/** 投票する。送り先は投票の relay タグのリレー（10 件まで）、なければ書き込みリレー。 */
export async function vote(poll: Poll, choices: Set<string>): Promise<{ event: Event; result: PublishResult }> {
  const sign = await signer();
  const event = await sign.sign(buildVote(poll, choices, now()));
  const relays = TEST_RELAY ? [TEST_RELAY] : poll.relays.length > 0 ? poll.relays : viewer.writeRelays;
  return { event, result: await publish(relays, event) };
}

/** 通報（kind 1984）。書き込みリレーへ。 */
export async function report(target: { note?: Event; pubkey: string }, type: string, reason: string): Promise<PublishResult> {
  const sign = await signer();
  return publish(viewer.writeRelays, await sign.sign(buildReport(target, type, reason, now())));
}

/** 消去の依頼で、すべてのリレーに頼むときに送る先（知っているリレー）。 */
export const knownRelays = () => relaySet([...viewer.readRelays, ...viewer.writeRelays, ...viewer.alwaysOn, ...searchRelays(viewer.pubkey), ...INDEXER_RELAYS]);

/** 消去の依頼（kind 62）。relays が null ならすべてのリレー（ALL_RELAYS）に頼み、知っているリレーへ送る。 */
export async function requestVanish(relays: string[] | null, reason: string): Promise<PublishResult> {
  const sign = await signer();
  const event = await sign.sign(buildVanish(relays, reason, now()));
  return publish(relays ?? knownRelays(), event);
}
