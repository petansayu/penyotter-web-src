import { buildProfile, PROFILE_FIELDS, profileValues, type ProfileValues } from "../domain/profileEdit";
import { latest, type Event } from "../nostr/events";
import { INDEXER_RELAYS } from "../nostr/outbox";
import { eventsOf, pool, publish, type PublishResult } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { keepProfiles } from "./cache.svelte";
import { TEST_BLOSSOM } from "./upload";
import { viewer } from "./viewer.svelte";

/**
 * 自分のプロフィール（kind 0）の書き換え（Android 版の ProfileEditService）。開くときと送るときに、読み込み・
 * 書き込み・インデックス用のリレーから取り直す。送るときは、画面を開いてから変えた項目だけを、取り直した
 * いちばん新しい版に当てる（その間にほかのアプリで変えた項目を戻さないため）。
 */

async function fetchLatest(me: string): Promise<{ event: Event | undefined; complete: boolean }> {
  const relays = relaySet([...viewer.readRelays, ...viewer.writeRelays, ...INDEXER_RELAYS]);
  const fetched = await pool.fetch(relays, [{ kinds: [0], authors: [me], limit: 5 }]);
  const event = latest(eventsOf(fetched).filter((e) => e.pubkey === me && e.kind === 0));
  if (event) keepProfiles([event]);
  return { event, complete: fetched.complete };
}

/** 画面を開くときの値。 */
export async function loadOwnProfile(): Promise<ProfileValues> {
  const me = viewer.pubkey;
  if (!me) throw new Error("見る人が決まっていません");
  return profileValues((await fetchLatest(me)).event);
}

/** 送る。initial は画面を開いたときの値、values は今の値。 */
export async function saveOwnProfile(initial: ProfileValues, values: ProfileValues): Promise<PublishResult> {
  const me = viewer.pubkey;
  if (!me || !viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
  const { event: base, complete } = await fetchLatest(me);
  if (!complete && !base) throw new Error("プロフィールをリレーから取り直せなかったので、送りませんでした。少し待ってからもう一度試してください。");
  const merged = profileValues(base);
  for (const field of PROFILE_FIELDS) if (values[field] !== initial[field]) merged[field] = values[field];
  const signer = await viewer.getSigner();
  const event = await signer.sign(buildProfile(base, merged, Math.floor(Date.now() / 1000), TEST_BLOSSOM));
  const result = await publish(viewer.writeRelays, event);
  if (result.accepted > 0) keepProfiles([event]);
  return result;
}
