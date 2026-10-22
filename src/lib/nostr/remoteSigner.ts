import { generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools";
import { BunkerSigner, createNostrConnectURI, parseBunkerInput, type BunkerPointer } from "nostr-tools/nip46";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { isHex64 } from "./events";
import { normalizeRelay } from "./relayUrl";
import { askCipher, SignerError, type Signer } from "./signer";
import { TEST_RELAY } from "./testMode";

/**
 * リモート署名（NIP-46）。bunker:// を貼ってつなぐか、nostrconnect:// を出して署名アプリに読み取ってもらう。
 *
 * つなぐたびに「接続用の鍵」を新しく作る（利用者の秘密鍵とは別のもの）。この鍵はふだんタブの sessionStorage
 * だけに置き、タブを閉じたら消える。ログインのときに「このブラウザに記憶する」を選んだときだけ localStorage に
 * 置く（利用者が選んだ方式、2026-10-21）。
 */

const TIMEOUT = 120_000;
const storageKey = (pubkey: string) => `nip46.${pubkey}`;

interface Session { bunker: string; relays: string[]; clientKey: string }

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new SignerError(message)), TIMEOUT))]);
}

/** bunker:// を読む。リレーは wss:// だけ（テストモードでは手元のテスト用リレーだけ）。 */
export async function parseBunker(input: string): Promise<BunkerPointer> {
  const value = input.trim();
  if (/^(nsec1|ncryptsec1)/i.test(value)) throw new SignerError("秘密鍵は入力しないでください。bunker:// で始まる文字を貼ってください。");
  if (!/^bunker:\/\//i.test(value)) throw new SignerError("bunker:// で始まる文字を貼ってください。");
  const pointer = await parseBunkerInput(value).catch(() => null);
  if (!pointer || !isHex64(pointer.pubkey)) throw new SignerError("bunker:// の形が正しくありません。");
  const relays = [...new Set(pointer.relays.map((url) => normalizeRelay(url)).filter((url): url is string => !!url))];
  if (TEST_RELAY && relays.some((url) => url !== TEST_RELAY)) throw new SignerError(`テストモードでは、手元のテスト用リレー（${TEST_RELAY}）を使う bunker だけにつなぎます。`);
  if (relays.length === 0) throw new SignerError("bunker:// に、つなげるリレー（wss://）がありません。");
  return { ...pointer, relays };
}

/** 署名アプリが承認の画面（auth_url）を求めたとき。https だけを新しいタブで開く。 */
function openAuth(url: string) {
  try {
    if (new URL(url).protocol === "https:") window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // 開けない URL は使わない
  }
}

function wrap(bunker: BunkerSigner, pubkey: string): Signer {
  return {
    pubkey,
    async sign(template) {
      let signed;
      try {
        signed = await withTimeout(bunker.signEvent(template), "リモート署名が 2 分たっても答えませんでした。署名アプリを確かめてください。");
      } catch (e) {
        if (e instanceof SignerError) throw e;
        throw new SignerError("リモート署名に断られたか、答えがありませんでした。");
      }
      if (signed.pubkey !== pubkey || signed.kind !== template.kind || signed.content !== template.content || !verifyEvent(signed)) {
        throw new SignerError("リモート署名から受け取った署名が正しくありません。");
      }
      return signed;
    },
    nip44Encrypt: (peer, text) => askCipher(() => withTimeout(bunker.nip44Encrypt(peer, text), "リモート署名が 2 分たっても答えませんでした。"), "NIP-44 の暗号化"),
    nip44Decrypt: (peer, text) => askCipher(() => withTimeout(bunker.nip44Decrypt(peer, text), "リモート署名が 2 分たっても答えませんでした。"), "NIP-44 の復号"),
    nip04Encrypt: (peer, text) => askCipher(() => withTimeout(bunker.nip04Encrypt(peer, text), "リモート署名が 2 分たっても答えませんでした。"), "NIP-04 の暗号化"),
    nip04Decrypt: (peer, text) => askCipher(() => withTimeout(bunker.nip04Decrypt(peer, text), "リモート署名が 2 分たっても答えませんでした。"), "NIP-04 の復号"),
  };
}

function save(pubkey: string, session: Session, remember: boolean) {
  forgetRemote(pubkey);
  try {
    (remember ? localStorage : sessionStorage).setItem(storageKey(pubkey), JSON.stringify(session));
  } catch {
    // 保存できなければ、このページを開いている間だけ使える
  }
}

function load(pubkey: string): { session: Session; remembered: boolean } | null {
  for (const [storage, remembered] of [[sessionStorage, false], [localStorage, true]] as const) {
    try {
      const raw = storage.getItem(storageKey(pubkey));
      if (!raw) continue;
      const session = JSON.parse(raw) as Session;
      if (isHex64(session.bunker) && /^[0-9a-f]{64}$/.test(session.clientKey) && Array.isArray(session.relays)) return { session, remembered };
    } catch {
      // 読めない保存分は使わない
    }
  }
  return null;
}

/** 接続用の鍵を、このブラウザ（localStorage・sessionStorage の両方）から消す。 */
export function forgetRemote(pubkey: string) {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      storage.removeItem(storageKey(pubkey));
    } catch {
      // 何もしない
    }
  }
}

/** 接続用の鍵を記憶しているか（null は持っていない）。 */
export function remoteState(pubkey: string): "remembered" | "tab" | null {
  const saved = load(pubkey);
  return saved ? (saved.remembered ? "remembered" : "tab") : null;
}

/** bunker につなぐ（初めてのとき）。利用者の公開鍵を返す。 */
export async function connectRemote(pointer: BunkerPointer, remember: boolean): Promise<Signer> {
  const clientKey = generateSecretKey();
  const bunker = BunkerSigner.fromBunker(clientKey, pointer, { onauth: openAuth });
  try {
    await withTimeout(bunker.connect({ name: "ぺにょったー Web" }), "リモート署名が 2 分たっても答えませんでした。署名アプリで承認したか確かめてください。");
    const pubkey = (await withTimeout(bunker.getPublicKey(), "リモート署名が公開鍵を教えてくれませんでした。")).toLowerCase();
    if (!isHex64(pubkey)) throw new SignerError("リモート署名から受け取った公開鍵の形が正しくありません。");
    save(pubkey, { bunker: pointer.pubkey, relays: pointer.relays, clientKey: bytesToHex(clientKey) }, remember);
    return wrap(bunker, pubkey);
  } catch (e) {
    await bunker.close();
    if (e instanceof SignerError) throw e;
    throw new SignerError("リモート署名につなげませんでした（断られたか、bunker:// が古い可能性があります）。");
  }
}

/**
 * nostrconnect:// で使うリレー。NIP-46 用によく使われる relay.nsec.app（Web 版だけ。Android 版には nostrconnect:// が
 * まだない）。テストモードでは手元のテスト用リレー。
 */
export const NOSTR_CONNECT_RELAYS = TEST_RELAY ? [TEST_RELAY] : ["wss://relay.nsec.app"];
/** 署名アプリが読み取るのを待つ時間。 */
const CONNECT_WAIT = 5 * 60_000;

export interface NostrConnectSession {
  /** 署名アプリに読み取ってもらう nostrconnect://。 */
  uri: string;
  /** 署名アプリが承認したら、署名役を返す。待つのをやめたか時間切れなら SignerError。 */
  done: Promise<Signer>;
  /** 待つのをやめる。 */
  cancel: () => void;
}

/** nostrconnect:// を作り、署名アプリからの返事を待つ（最大 5 分）。remember なら接続用の鍵をこのブラウザに記憶する。 */
export function startNostrConnect(remember: boolean, relays: string[] = NOSTR_CONNECT_RELAYS): NostrConnectSession {
  const clientKey = generateSecretKey();
  const secret = bytesToHex(generateSecretKey()).slice(0, 32);
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(clientKey),
    relays,
    secret,
    name: "ぺにょったー Web",
    perms: ["sign_event:1", "sign_event:5", "sign_event:6", "sign_event:7", "sign_event:16", "sign_event:1111", "sign_event:22242"],
  });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CONNECT_WAIT);
  const done = (async () => {
    let bunker: BunkerSigner;
    try {
      bunker = await BunkerSigner.fromURI(clientKey, uri, { onauth: openAuth }, abort.signal);
    } catch {
      throw new SignerError(abort.signal.aborted ? "署名アプリからの返事がないまま、待つのをやめました。" : "署名アプリにつなげませんでした。");
    } finally {
      clearTimeout(timer);
    }
    try {
      const pubkey = (await withTimeout(bunker.getPublicKey(), "リモート署名が公開鍵を教えてくれませんでした。")).toLowerCase();
      if (!isHex64(pubkey)) throw new SignerError("リモート署名から受け取った公開鍵の形が正しくありません。");
      save(pubkey, { bunker: bunker.bp.pubkey, relays: bunker.bp.relays, clientKey: bytesToHex(clientKey) }, remember);
      return wrap(bunker, pubkey);
    } catch (e) {
      await bunker.close();
      throw e instanceof SignerError ? e : new SignerError("リモート署名につなげませんでした。");
    }
  })();
  return { uri, done, cancel: () => abort.abort() };
}

/** 保存した接続用の鍵で、つなぎ直す。持っていなければ null。 */
export function resumeRemote(pubkey: string): Signer | null {
  const saved = load(pubkey);
  if (!saved) return null;
  const { session } = saved;
  const bunker = BunkerSigner.fromBunker(hexToBytes(session.clientKey), { pubkey: session.bunker, relays: session.relays, secret: null }, { onauth: openAuth });
  return wrap(bunker, pubkey);
}
