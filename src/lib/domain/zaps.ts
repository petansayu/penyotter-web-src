import { nip19, type EventTemplate } from "nostr-tools";
import { isHex64, type Event } from "../nostr/events";

/** zap のリクエスト（NIP-57、Android 版の ZapService・LightningAddress、技術資料 6.11）。 */

/** Lightning アドレス（name@example.com）。読めなければ例外（日本語の理由）。 */
export function parseLightningAddress(input: string): { user: string; domain: string } {
  const parts = input.trim().split("@");
  if (parts.length !== 2 || !/^[A-Za-z0-9._-]{1,64}$/.test(parts[0]) || parts[0].startsWith(".") || parts[0].endsWith(".")) {
    throw new Error("Lightningアドレスは name@example.com の形式で入力してください");
  }
  let domain = "";
  try {
    domain = new URL(`https://${parts[1]}`).hostname.toLowerCase();
  } catch {
    // 下で断る
  }
  if (domain.length < 3 || domain.length > 253 || !domain.includes(".") || !domain.split(".").every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) ||
    !/[a-z]$/.test(domain) || domain.endsWith(".local") || domain.endsWith(".localhost")) {
    throw new Error("Lightningアドレスのドメインを確認してください");
  }
  return { user: parts[0], domain };
}

export const lnurlpEndpoint = (address: { user: string; domain: string }) => `https://${address.domain}/.well-known/lnurlp/${address.user}`;
export const lnurlOf = (endpoint: string) => nip19.encodeBytes("lnurl", new TextEncoder().encode(endpoint));

/** LNURL の情報が zap に使えるか。金額（ミリサトシ）が範囲内か。 */
export function checkZapInfo(info: unknown, millisats: number): { callback: string } {
  const raw = (info ?? {}) as Record<string, unknown>;
  if (raw.allowsNostr !== true || typeof raw.nostrPubkey !== "string" || !isHex64(raw.nostrPubkey)) throw new Error("このLightningアドレスはZapに対応していません");
  const min = Number(raw.minSendable);
  const max = Number(raw.maxSendable);
  if (!(millisats >= min && millisats <= max)) throw new Error("Zap金額が送信可能範囲外です");
  if (typeof raw.callback !== "string" || !raw.callback.startsWith("https://")) throw new Error("請求書の取得先が正しくありません");
  return { callback: raw.callback };
}

/** zap リクエスト（kind 9734）。リレーには送らず、LNURL のコールバックに渡す。 */
export function buildZapRequest(note: Event, millisats: number, lnurl: string, relays: string[], comment: string, now: number): EventTemplate {
  return {
    kind: 9734,
    created_at: now,
    tags: [["relays", ...[...new Set(relays)].slice(0, 10)], ["amount", String(millisats)], ["lnurl", lnurl], ["p", note.pubkey], ["e", note.id], ["k", String(note.kind)]],
    content: comment.slice(0, 500),
  };
}
