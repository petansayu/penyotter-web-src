import { finalizeEvent, generateSecretKey, getEventHash, nip44, verifyEvent, type EventTemplate } from "nostr-tools";
import { isHex64, type Event } from "../nostr/events";
import { normalizeRelay } from "../nostr/relayUrl";

/**
 * DM（NIP-17 の gift wrap、Android 版の DirectMessageEvents・技術資料 5.7・6.8）。rumor（kind 14、署名なし）を
 * seal（kind 13、自分の鍵で署名、NIP-44 で相手宛てに暗号化）で包み、さらに使い捨ての鍵の gift wrap（kind 1059）で
 * 包む。seal と gift wrap の時刻は 0〜2 日前のどこか。相手宛てと自分宛ての控えを別々に作る。
 *
 * 自分の鍵での暗号化・署名は署名役（ブラウザ拡張・リモート署名）に頼むので、関数として受け取る。
 */

export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export const MAX_INBOX_RELAYS = 3;
const TWO_DAYS = 2 * 24 * 3600;

/** DM 受信リレー（kind 10050 の `relay`。wss:// を 3 件まで）。 */
export function inboxRelays(event: Event | undefined): string[] {
  const urls = (event?.tags ?? []).filter((t) => t[0] === "relay" && t[1]).map((t) => normalizeRelay(t[1])).filter((u): u is string => !!u);
  return [...new Set(urls)].slice(0, MAX_INBOX_RELAYS);
}

/** DM 受信リレーの一覧を作る（kind 10050）。 */
export function buildInbox(relays: string[], now: number): EventTemplate {
  const urls = [...new Set(relays.map(normalizeRelay).filter((u): u is string => !!u))].slice(0, MAX_INBOX_RELAYS);
  if (urls.length === 0) throw new Error("DM 受信リレーを 1 件以上入れてください");
  return { kind: 10050, created_at: now, tags: urls.map((url) => ["relay", url]), content: "" };
}

/** rumor（kind 14）。ID は計算するが署名はしない。 */
export function buildRumor(me: string, peer: string, body: string, now: number): Rumor {
  if (!body.trim()) throw new Error("メッセージを入力してください");
  if (!isHex64(peer)) throw new Error("相手の公開鍵の形が正しくありません");
  const rumor = { pubkey: me, created_at: now, kind: 14, tags: [["p", peer]], content: body };
  return { ...rumor, id: getEventHash(rumor) };
}

/** 0〜2 日前のどこか（seal と gift wrap の時刻）。 */
export const randomPast = (now: number, random = Math.random) => now - Math.floor(random() * TWO_DAYS);

/** seal（kind 13）の中身。encrypt は署名役の NIP-44 の暗号化（受け取る人宛て）。 */
export async function sealTemplate(rumor: Rumor, recipient: string, encrypt: (peer: string, text: string) => Promise<string>, now: number): Promise<EventTemplate> {
  return { kind: 13, created_at: randomPast(now), tags: [], content: await encrypt(recipient, JSON.stringify(rumor)) };
}

/** gift wrap（kind 1059）。使い捨ての鍵で包んで署名し、鍵はすぐ捨てる。 */
export function giftWrap(seal: Event, recipient: string, now: number): Event {
  let secret: Uint8Array | null = generateSecretKey();
  try {
    const content = nip44.v2.encrypt(JSON.stringify(seal), nip44.v2.utils.getConversationKey(secret, recipient));
    return finalizeEvent({ kind: 1059, created_at: randomPast(now), tags: [["p", recipient]], content }, secret);
  } finally {
    secret.fill(0);
    secret = null;
  }
}

/**
 * gift wrap を開く。seal の署名と、seal の作者と rumor の作者が同じことを確かめ、rumor は kind 14・15 だけ、ID を
 * 計算し直す。decrypt は署名役の NIP-44 の復号。開けない・正しくないものは null。
 */
export async function unwrap(wrap: Event, decrypt: (peer: string, text: string) => Promise<string>): Promise<Rumor | null> {
  if (wrap.kind !== 1059) return null;
  let seal: Event;
  try {
    seal = JSON.parse(await decrypt(wrap.pubkey, wrap.content)) as Event;
  } catch {
    return null;
  }
  if (!seal || seal.kind !== 13 || !verifyEvent(seal)) return null;
  let raw: Partial<Rumor>;
  try {
    raw = JSON.parse(await decrypt(seal.pubkey, seal.content)) as Partial<Rumor>;
  } catch {
    return null;
  }
  if (!raw || raw.pubkey !== seal.pubkey || (raw.kind !== 14 && raw.kind !== 15) || typeof raw.content !== "string" || !Array.isArray(raw.tags) || typeof raw.created_at !== "number") return null;
  const rumor = { pubkey: raw.pubkey, created_at: raw.created_at, kind: raw.kind, tags: raw.tags, content: raw.content };
  const id = getEventHash(rumor);
  if (raw.id && raw.id !== id) return null;
  return { ...rumor, id };
}

/** 会話の相手（1 対 1 の DM。自分が書いたものは `p` の相手、相手が書いたものは作者）。グループの DM は null。 */
export function conversationPeer(message: { pubkey: string; tags: string[][] }, me: string): string | null {
  const people = [...new Set([message.pubkey, ...message.tags.filter((t) => t[0] === "p" && isHex64(t[1])).map((t) => t[1])])].filter((p) => p !== me);
  if (people.length !== 1) return message.pubkey === me && people.length === 0 ? me : null;
  return people[0];
}

// ファイル（NIP-17 の kind 15）と旧方式（NIP-04）

export interface DmFile { url: string; type: string; key: string; nonce: string; x?: string; ox?: string; size?: number }

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const sha256Hex = async (data: BufferSource) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));

/** ファイルを AES-256-GCM で暗号化する（鍵と nonce は 16 進）。 */
export async function encryptFile(data: Uint8Array<ArrayBuffer>): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; key: string; nonce: string; x: string; ox: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, data));
  return { ciphertext, key: toHex(raw), nonce: toHex(nonce), x: await sha256Hex(ciphertext), ox: await sha256Hex(data) };
}

/** 暗号化されたファイルを開く。x があればハッシュを確かめる。 */
export async function decryptFile(ciphertext: Uint8Array<ArrayBuffer>, file: Pick<DmFile, "key" | "nonce" | "x">): Promise<Uint8Array<ArrayBuffer>> {
  if (file.x && (await sha256Hex(ciphertext)) !== file.x.toLowerCase()) throw new Error("ファイルのハッシュが合いません");
  const key = await crypto.subtle.importKey("raw", fromHex(file.key), "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(file.nonce) }, key, ciphertext));
}

/** ファイルの rumor（kind 15）。content はアップロードした暗号化済みのファイルの URL。 */
export function buildFileRumor(me: string, peer: string, file: DmFile, now: number): Rumor {
  if (!isHex64(peer)) throw new Error("相手の公開鍵の形が正しくありません");
  const tags = [["p", peer], ["file-type", file.type], ["encryption-algorithm", "aes-gcm"], ["decryption-key", file.key], ["decryption-nonce", file.nonce]];
  if (file.x) tags.push(["x", file.x]);
  if (file.ox) tags.push(["ox", file.ox]);
  if (file.size) tags.push(["size", String(file.size)]);
  const rumor = { pubkey: me, created_at: now, kind: 15, tags, content: file.url };
  return { ...rumor, id: getEventHash(rumor) };
}

/** kind 15 の rumor からファイルの情報を読む（aes-gcm で https のものだけ）。 */
export function fileOf(rumor: { kind: number; tags: string[][]; content: string }): DmFile | null {
  if (rumor.kind !== 15 || !rumor.content.startsWith("https://")) return null;
  const tag = (name: string) => rumor.tags.find((t) => t[0] === name)?.[1];
  const key = tag("decryption-key");
  const nonce = tag("decryption-nonce");
  if (tag("encryption-algorithm") !== "aes-gcm" || !key || !nonce || !/^[0-9a-f]+$/i.test(key) || !/^[0-9a-f]+$/i.test(nonce)) return null;
  const size = Number(tag("size"));
  return { url: rumor.content, type: tag("file-type") ?? "application/octet-stream", key, nonce, x: tag("x"), ox: tag("ox"), size: Number.isFinite(size) ? size : undefined };
}

/** 旧方式（NIP-04、kind 4）。content は署名役で暗号化した本文。 */
export function buildLegacyDm(peer: string, encrypted: string, now: number): EventTemplate {
  if (!isHex64(peer)) throw new Error("相手の公開鍵の形が正しくありません");
  return { kind: 4, created_at: now, tags: [["p", peer]], content: encrypted };
}
