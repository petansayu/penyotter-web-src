import type { EventTemplate } from "nostr-tools";
import { buildDraftDeletion, buildDraftWrap, DRAFT_KIND, draftPlaintext, newestWraps, PRIVATE_RELAYS, privateRelays, readDraft, type RemoteDraft } from "../domain/drafts";
import { latest } from "../nostr/events";
import { eventsOf, pool, publish, type PublishResult } from "../nostr/pool";
import { viewer } from "./viewer.svelte";

/**
 * リレーの下書き（NIP-37、技術資料 6.10、Android 版の ComposerController.saveDraftToRelays ほか）。保存先は kind 10013 に
 * 書かれた非公開のリレー（書き込みリレーから読み、自分宛ての NIP-44 で復号する）。読めなければ書き込みリレー。
 */

const now = () => Math.floor(Date.now() / 1000);

async function signer() {
  if (!viewer.pubkey || !viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
  return viewer.getSigner();
}

/** 下書きの置き場所。 */
export async function draftRelays(): Promise<string[]> {
  const me = viewer.pubkey!;
  try {
    const list = latest(eventsOf(await pool.fetch(viewer.writeRelays, [{ kinds: [PRIVATE_RELAYS], authors: [me], limit: 5 }])).filter((e) => e.pubkey === me));
    if (list) {
      const relays = privateRelays(await (await signer()).nip44Decrypt(me, list.content));
      if (relays.length > 0) return relays;
    }
  } catch {
    // 読めなければ書き込みリレーへ
  }
  return viewer.writeRelays;
}

/** 下書きを保存する。同じ識別子で保存し直すと、前の下書きを置き換える。 */
export async function saveRemoteDraft(identifier: string, draft: EventTemplate): Promise<PublishResult> {
  const sign = await signer();
  const me = viewer.pubkey!;
  const encrypted = await sign.nip44Encrypt(me, draftPlaintext(draft, me));
  const event = await sign.sign(buildDraftWrap(identifier, draft.kind, encrypted, now()));
  return publish(await draftRelays(), event);
}

/** 下書きを消す（中身が空の版に置き換える）。 */
export async function deleteRemoteDraft(identifier: string, kind: number): Promise<PublishResult> {
  const sign = await signer();
  return publish(await draftRelays(), await sign.sign(buildDraftDeletion(identifier, kind, now())));
}

/** 下書きの一覧（続きを書ける kind 1・1111 だけ）。復号できなかった数も返す。 */
export async function loadRemoteDrafts(): Promise<{ drafts: RemoteDraft[]; failed: number }> {
  const sign = await signer();
  const me = viewer.pubkey!;
  const wraps = newestWraps(eventsOf(await pool.fetch(await draftRelays(), [{ kinds: [DRAFT_KIND], authors: [me], limit: 200 }])), me);
  let failed = 0;
  const drafts: RemoteDraft[] = [];
  for (const wrap of wraps) {
    try {
      const draft = readDraft(wrap, await sign.nip44Decrypt(me, wrap.content));
      if (draft) drafts.push(draft);
    } catch {
      failed++;
    }
  }
  return { drafts, failed };
}
