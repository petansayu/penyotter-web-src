import { finalizeEvent, generateSecretKey, getPublicKey, nip04, nip44, type EventTemplate } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { TEST_RELAY } from "./testMode";

/**
 * テストモードだけで使う偽の NIP-07（window.nostr）。使い捨ての鍵で署名する。鍵はこのタブの sessionStorage だけに
 * 置き、ログにも画面にも出さない。テストモードでないとき（本番用のビルドを含む）は何もしない。
 */
export function installDevSigner() {
  if (!TEST_RELAY || window.nostr) return;
  let secret: Uint8Array;
  try {
    const saved = sessionStorage.getItem("dev-signer");
    secret = saved ? hexToBytes(saved) : generateSecretKey();
    if (!saved) sessionStorage.setItem("dev-signer", bytesToHex(secret));
  } catch {
    secret = generateSecretKey();
  }
  const pubkey = getPublicKey(secret);
  window.nostr = {
    getPublicKey: async () => pubkey,
    signEvent: async (template: EventTemplate) => finalizeEvent(template, secret),
    nip44: {
      encrypt: async (peer: string, text: string) => nip44.v2.encrypt(text, nip44.v2.utils.getConversationKey(secret, peer)),
      decrypt: async (peer: string, text: string) => nip44.v2.decrypt(text, nip44.v2.utils.getConversationKey(secret, peer)),
    },
    nip04: {
      encrypt: async (peer: string, text: string) => nip04.encrypt(secret, peer, text),
      decrypt: async (peer: string, text: string) => nip04.decrypt(secret, peer, text),
    },
  };
}
