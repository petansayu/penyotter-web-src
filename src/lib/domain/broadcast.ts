import { expired, type Event } from "../nostr/events";

/**
 * ブロードキャスト（Android 版の Broadcast）。署名済みの投稿をそのまま自分の書き込みリレーへ送る。署名し直さないので
 * ほかの人の投稿も送れるが、本人以外が送ってはいけない保護された投稿（NIP-70 の ["-"]）と、期限の切れた投稿と、
 * 削除が依頼された投稿は送らない。送れないときはその理由。
 */
export function broadcastRefusal(event: Event, me: string, deleted: { has(id: string): boolean }, now = Date.now() / 1000): string | null {
  if (deleted.has(event.id)) return "削除が依頼された投稿は送れません";
  if (event.pubkey !== me && event.tags.some((t) => t[0] === "-")) return "この投稿は本人以外が送り直せない設定（保護された投稿）です";
  if (expired(event, now)) return "期限の切れた投稿は送れません";
  return null;
}
