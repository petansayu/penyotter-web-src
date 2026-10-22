import { verifyEvent, type EventTemplate } from "nostr-tools";
import type { Event } from "./events";

/**
 * 署名役。秘密鍵はブラウザに置かず、NIP-07 のブラウザ拡張（nos2x・Alby など）に署名を頼む。
 * 返ってきたイベントは、署名と公開鍵を確かめてから使う。
 */

export interface Signer {
  readonly pubkey: string;
  sign(template: EventTemplate): Promise<Event>;
  /** NIP-44 の暗号化・復号（DM・非公開の一覧）。できない署名役は SignerError。 */
  nip44Encrypt(peer: string, plaintext: string): Promise<string>;
  nip44Decrypt(peer: string, ciphertext: string): Promise<string>;
  /** NIP-04（旧方式の DM）。 */
  nip04Encrypt(peer: string, plaintext: string): Promise<string>;
  nip04Decrypt(peer: string, ciphertext: string): Promise<string>;
}

interface Cipher {
  encrypt(peer: string, plaintext: string): Promise<string>;
  decrypt(peer: string, ciphertext: string): Promise<string>;
}

interface Nip07 {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate & { pubkey?: string }): Promise<Event>;
  nip44?: Cipher;
  nip04?: Cipher;
}

/** 暗号化・復号を頼む（ブラウザ拡張・リモート署名で共通の言い方で断る）。 */
export async function askCipher(run: (() => Promise<string>) | undefined, what: string): Promise<string> {
  if (!run) throw new SignerError(`この署名役は${what}に対応していません。`);
  let result: string;
  try {
    result = await run();
  } catch (e) {
    if (e instanceof SignerError) throw e;
    throw new SignerError(`${what}を断られたか、答えがありませんでした。`);
  }
  if (typeof result !== "string") throw new SignerError(`${what}の答えが正しくありません。`);
  return result;
}

declare global {
  interface Window { nostr?: Nip07 }
}

/** ブラウザ拡張が window.nostr を入れるのを待つ（読み込みが遅い拡張があるため、最大 3 秒）。 */
async function waitForNip07(): Promise<Nip07 | null> {
  for (let i = 0; i < 30; i++) {
    if (window.nostr) return window.nostr;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export class SignerError extends Error {}

/** NIP-07 の署名役を作る。拡張がない・断られたときは SignerError。 */
export async function connectNip07(expected?: string): Promise<Signer> {
  const nostr = await waitForNip07();
  if (!nostr) throw new SignerError("NIP-07 に対応したブラウザ拡張（nos2x・Alby など）が見つかりませんでした。");
  let pubkey: string;
  try {
    pubkey = (await nostr.getPublicKey()).toLowerCase();
  } catch {
    throw new SignerError("ブラウザ拡張が公開鍵を教えてくれませんでした（断られた可能性があります）。");
  }
  if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new SignerError("ブラウザ拡張から受け取った公開鍵の形が正しくありません。");
  if (expected && expected !== pubkey) throw new SignerError("ブラウザ拡張の鍵が、ログインしていた鍵と違います。拡張の鍵を確かめてください。");
  return {
    pubkey,
    async sign(template) {
      let signed: Event;
      try {
        signed = await nostr.signEvent({ ...template, pubkey });
      } catch {
        throw new SignerError("署名を断られたか、ブラウザ拡張が答えませんでした。");
      }
      if (!signed || signed.pubkey !== pubkey || signed.kind !== template.kind || signed.content !== template.content || !verifyEvent(signed)) {
        throw new SignerError("ブラウザ拡張から受け取った署名が正しくありません。");
      }
      return signed;
    },
    nip44Encrypt: (peer, text) => askCipher(nostr.nip44 && (() => nostr.nip44!.encrypt(peer, text)), "NIP-44 の暗号化"),
    nip44Decrypt: (peer, text) => askCipher(nostr.nip44 && (() => nostr.nip44!.decrypt(peer, text)), "NIP-44 の復号"),
    nip04Encrypt: (peer, text) => askCipher(nostr.nip04 && (() => nostr.nip04!.encrypt(peer, text)), "NIP-04 の暗号化"),
    nip04Decrypt: (peer, text) => askCipher(nostr.nip04 && (() => nostr.nip04!.decrypt(peer, text)), "NIP-04 の復号"),
  };
}
