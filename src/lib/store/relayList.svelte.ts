import { buildRelayList, type RelayEntry } from "../domain/relayList";
import { latest, newer, type Event } from "../nostr/events";
import { eventsOf, pool, publish, type PublishResult } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { recordVersion } from "./listHistory";
import { viewer } from "./viewer.svelte";

/**
 * リレーリスト（kind 10002）の公開（技術資料 4.1.1）。読み込み・書き込みリレーから取り直し（完了しなければやめる）、
 * 画面で編集を始めたあとにほかのアプリで更新されていたら公開をやめて知らせる。前の版と新しい版を一覧の履歴に
 * 残してから、前と新しい書き込みリレーへ送る。
 */

/** ほかのアプリで更新されていた（画面に読み込み直してから、もう一度確かめてもらう）。 */
export class RelayListChanged extends Error {
  constructor(readonly latest: Event) {
    super("ほかのアプリでリレーリストが更新されています。読み込み直してから、もう一度確かめてください。");
  }
}

/** 一覧の履歴から「リレー設定に読み込む」を選んだときの中身（リレー設定の画面が受け取る）。 */
class RelayDraft {
  pending = $state<Event | null>(null);
}
export const relayDraft = new RelayDraft();

/** 公開する。base は画面で編集を始めたときの版（なければ undefined）。 */
export async function publishRelayList(entries: RelayEntry[], base: Event | undefined): Promise<PublishResult> {
  const me = viewer.pubkey;
  if (!me || !viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
  const before = { read: viewer.readRelays, write: viewer.writeRelays };
  const fetched = await pool.fetch(relaySet([...before.read, ...before.write]), [{ kinds: [10002], authors: [me], limit: 5 }]);
  if (!fetched.complete) throw new Error("リレーリストを取り直せなかったので、公開しませんでした。少し待ってからもう一度試してください。");
  const current = latest(eventsOf(fetched).filter((event) => event.pubkey === me && event.kind === 10002));
  if (current && current.id !== base?.id && newer(current, base)) {
    await recordVersion(me, current, "relay");
    // いま公開されているのはこの版なので、アプリが使うリレーもこれに合わせる
    viewer.applyRelayList(current);
    throw new RelayListChanged(current);
  }
  const previous = current ?? base;
  if (previous && !(await recordVersion(me, previous, "relay"))) throw new Error("一覧の履歴をこのブラウザに保存できなかったので、公開しませんでした。");
  const signer = await viewer.getSigner();
  const event = await signer.sign(buildRelayList(previous, entries, Math.floor(Date.now() / 1000)));
  if (!(await recordVersion(me, event, "app"))) throw new Error("一覧の履歴をこのブラウザに保存できなかったので、公開しませんでした。");
  const next = entries.filter((e) => e.write).map((e) => e.url);
  const result = await publish(relaySet([...next, ...before.write]), event);
  if (result.accepted > 0) viewer.applyRelayList(event);
  return result;
}
