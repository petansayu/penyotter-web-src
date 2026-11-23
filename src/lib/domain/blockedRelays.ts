import type { Event } from "../nostr/events";

/**
 * ブロックしたリレー（NIP-51 kind 10006、`relay` タグ。Android 版の BlockedRelays、技術資料 4.6）。ブロックしたリレーには
 * どこから来ても（自分のリレー・相手の書き込みリレー・ヒント・グローバル・検索）つながない。読むのは公開の `relay`
 * タグだけで、暗号化した content はそのまま残す。
 */
export const BLOCKED_RELAYS_KIND = 10006;
/** 1 つの一覧でブロックできるリレーの数。 */
export const MAX_BLOCKED = 200;

/**
 * 同じリレーの見分け。ws と wss、ホスト名の大文字小文字、既定のポート（443・80）、末尾の `/` を区別しない。リレーの
 * アドレスでなければ null。
 */
export function relayKey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "wss:" && url.protocol !== "ws:") || !url.hostname || url.username || url.password) return null;
  // URL は既定のポートを port に入れない
  const port = url.port ? `:${url.port}` : "";
  return `${url.hostname.toLowerCase()}${port}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

/** 打ったアドレスを一覧に書く形にする。`wss://` がなければ足す。リレーのアドレスでなければ null。 */
export function blockAddress(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 300) return null;
  const withScheme = text.includes("://") ? text : `wss://${text}`;
  const key = relayKey(withScheme);
  if (!key) return null;
  return `${withScheme.slice(0, withScheme.indexOf("://")).toLowerCase()}://${key}`;
}

/** 一覧のブロックしたリレー（並びのまま、同じリレーは 1 回）。 */
export function blockedAddresses(event: Event | undefined): string[] {
  if (!event || event.kind !== BLOCKED_RELAYS_KIND) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== "relay" || typeof tag[1] !== "string") continue;
    const address = blockAddress(tag[1]);
    const key = address && relayKey(address);
    if (!address || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(address);
    if (result.length >= MAX_BLOCKED) break;
  }
  return result;
}

export function blockedKeys(event: Event | undefined): Set<string> {
  return new Set(blockedAddresses(event).map((address) => relayKey(address)!));
}

/** タグに relay をブロックした・解いたもの。ほかのタグはそのまま。 */
export function withBlockedRelay(tags: string[][], relay: string, blocked: boolean): string[][] {
  const address = blockAddress(relay);
  if (!address) throw new Error("リレーのアドレスが正しくありません。");
  const key = relayKey(address);
  const same = (tag: string[]) => tag[0] === "relay" && typeof tag[1] === "string" && relayKey(tag[1]) === key;
  if (!blocked) return tags.filter((tag) => !same(tag));
  if (tags.some(same)) return tags;
  if (tags.filter((tag) => tag[0] === "relay").length >= MAX_BLOCKED) throw new Error(`ブロックできるリレーは ${MAX_BLOCKED} 件までです。`);
  return [...tags, ["relay", address]];
}
