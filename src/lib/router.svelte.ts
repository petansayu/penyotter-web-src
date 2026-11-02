import { nip19 } from "nostr-tools";
import type { AroundScope } from "./domain/around";
import { isHex64 } from "./nostr/events";

/**
 * 画面の切り替え。URL の # の後ろに置く（静的なサイトのどこに置いても動くように）。
 * `#/` ホーム、`#/notifications` 通知、`#/search?q=<検索語>` 検索、`#/p/<npub|nprofile>` プロフィール、`#/e/<nevent|note>` 投稿の詳細、`#/settings` 設定、
 * `#/settings/<小画面>` 設定の小画面、`#/mutes` ミュート、`#/history` 一覧の履歴、`#/write?d=<識別子>` 記事を書く（書き直す）。
 */

export type Route =
  | { name: "home" }
  | { name: "settings"; page: SettingsPage | null }
  | { name: "mutes" }
  | { name: "badges" }
  | { name: "conversation"; a: string; b: string }
  | { name: "topic"; word: string; since: number; until: number; tab: "following" | "global" }
  | { name: "flow"; id: string; author?: string; scope: "following" | "global" }
  | { name: "around"; id?: string; at?: number; scope: AroundScope; author?: string }
  | { name: "history" }
  | { name: "bookmarks" }
  | { name: "lists"; identifier: string | null }
  | { name: "write"; identifier: string | null }
  | { name: "relay"; url: string }
  | { name: "secretLink" }
  | { name: "chat"; channel: string | null }
  | { name: "messages"; peer: string | null }
  | { name: "notifications" }
  | { name: "search"; q: string }
  | { name: "profile"; pubkey: string; relays: string[] }
  | { name: "thread"; id: string; relays: string[]; author?: string }
  | { name: "notFound"; path: string };

/** 設定の小画面（Android 版の設定のトップから入る画面）。 */
export const SETTINGS_PAGES = ["account", "relays", "uploads", "reactions", "appearance", "theme", "storage", "about", "vanish"] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];
export const SETTINGS_TITLES: Record<SettingsPage, string> = {
  account: "アカウント",
  relays: "リレー",
  uploads: "画像投稿先",
  reactions: "リアクション",
  appearance: "見た目",
  theme: "カラーテーマ",
  storage: "ストレージ",
  about: "このアプリについて",
  vanish: "消去の依頼",
};

export function parseRoute(hash: string): Route {
  const [rawPath, queryString = ""] = hash.replace(/^#/, "").split("?");
  const path = decodeURIComponent(rawPath) || "/";
  if (path === "/search") return { name: "search", q: new URLSearchParams(queryString).get("q") ?? "" };
  if (path === "/") return { name: "home" };
  if (path === "/settings") return { name: "settings", page: null };
  const page = path.match(/^\/settings\/([a-z]+)$/)?.[1] as SettingsPage | undefined;
  if (page && SETTINGS_PAGES.includes(page)) return { name: "settings", page };
  if (path === "/mutes") return { name: "mutes" };
  if (path === "/badges") return { name: "badges" };
  // 2 人の会話（#/talk/<npub>/<npub>）
  const talk = path.match(/^\/talk\/(npub1[0-9a-z]+)\/(npub1[0-9a-z]+)$/);
  if (talk) {
    try {
      const [a, b] = [nip19.decode(talk[1]), nip19.decode(talk[2])];
      if (a.type === "npub" && b.type === "npub") return { name: "conversation", a: a.data, b: b.data };
    } catch {
      // 下で見つからない画面にする
    }
  }
  // いまの話題の言葉の投稿（#/topic/<言葉>?since=&until=&tab=）
  const topicWord = path.match(/^\/topic\/(.+)$/)?.[1];
  if (topicWord) {
    const query = new URLSearchParams(queryString);
    const [since, until] = [Number(query.get("since")), Number(query.get("until"))];
    if (Number.isFinite(since) && Number.isFinite(until)) return { name: "topic", word: topicWord, since, until, tab: query.get("tab") === "global" ? "global" : "following" };
  }
  // たぶんこの流れ（#/flow/<nevent>?scope=following|global）
  const flowValue = path.match(/^\/flow\/(.+)$/)?.[1];
  if (flowValue) {
    try {
      const decoded = nip19.decode(flowValue.toLowerCase());
      const scope = new URLSearchParams(queryString).get("scope") === "global" ? "global" : "following";
      if (decoded.type === "nevent") return { name: "flow", id: decoded.data.id, author: decoded.data.author, scope };
    } catch {
      // 下で見つからない画面にする
    }
  }
  // 日時を指定して見る（#/at/<UNIX 秒>?scope=…&author=<16 進>）
  const atValue = path.match(/^\/at\/(\d{1,12})$/)?.[1];
  if (atValue) {
    const query = new URLSearchParams(queryString);
    const raw = query.get("scope");
    const scope: AroundScope = raw === "global" || raw === "author" ? raw : "following";
    const author = query.get("author") ?? undefined;
    return { name: "around", at: Number(atValue), scope, ...(author && isHex64(author) ? { author } : {}) };
  }
  // 前後の投稿（#/around/<note|nevent>?scope=following|global|author）
  const aroundValue = path.match(/^\/around\/(.+)$/)?.[1];
  if (aroundValue) {
    try {
      const decoded = nip19.decode(aroundValue.toLowerCase());
      const raw = new URLSearchParams(queryString).get("scope");
      const scope: AroundScope = raw === "global" || raw === "author" ? raw : "following";
      if (decoded.type === "note") return { name: "around", id: decoded.data, scope };
      if (decoded.type === "nevent") return { name: "around", id: decoded.data.id, scope, author: decoded.data.author };
    } catch {
      // 下で見つからない画面にする
    }
  }
  if (path === "/history") return { name: "history" };
  if (path === "/bookmarks") return { name: "bookmarks" };
  if (path === "/lists") return { name: "lists", identifier: null };
  const listId = path.match(/^\/lists\/(.+)$/)?.[1];
  if (listId) return { name: "lists", identifier: listId };
  // nostr: のリンク（NIP-21）。ブラウザの決まりで web+nostr: として受け取る（registerProtocolHandler・manifest の
  // protocol_handlers）。Web 版だけ: Android 版の nostr: の受け口にあたる。秘密鍵（nsec・ncryptsec）は開かない
  if (path === "/open") {
    const uri = (new URLSearchParams(queryString).get("uri") ?? "").trim().replace(/^web\+nostr:(\/\/)?/i, "").replace(/^nostr:(\/\/)?/i, "");
    if (/^(nsec|ncryptsec)1/i.test(uri)) return { name: "secretLink" };
    try {
      const decoded = nip19.decode(uri.toLowerCase());
      if (decoded.type === "npub") return { name: "profile", pubkey: decoded.data, relays: [] };
      if (decoded.type === "nprofile") return { name: "profile", pubkey: decoded.data.pubkey, relays: decoded.data.relays ?? [] };
      if (decoded.type === "note") return { name: "thread", id: decoded.data, relays: [] };
      if (decoded.type === "nevent") return { name: "thread", id: decoded.data.id, relays: decoded.data.relays ?? [], author: decoded.data.author };
      if (decoded.type === "naddr") return { name: "search", q: uri.toLowerCase() };
    } catch {
      // 下で見つからない画面にする
    }
    return { name: "notFound", path: `nostr:${uri.slice(0, 80)}` };
  }
  if (path === "/relay") {
    const url = new URLSearchParams(queryString).get("url") ?? "";
    if (/^wss?:\/\/[^\s]+$/.test(url)) return { name: "relay", url };
  }
  if (path === "/write") return { name: "write", identifier: new URLSearchParams(queryString).get("d") };
  if (path === "/chat") return { name: "chat", channel: null };
  const channel = path.match(/^\/chat\/([0-9a-f]{64})$/)?.[1];
  if (channel) return { name: "chat", channel };
  if (path === "/messages") return { name: "messages", peer: null };
  const peer = path.match(/^\/messages\/(npub1[0-9a-z]+)$/)?.[1];
  if (peer) {
    try {
      const decoded = nip19.decode(peer);
      if (decoded.type === "npub") return { name: "messages", peer: decoded.data };
    } catch {
      // 下で見つからない画面にする
    }
  }
  if (path === "/notifications") return { name: "notifications" };
  const [, kind, value] = path.match(/^\/(p|e)\/(.+)$/) ?? [];
  if (kind && value) {
    try {
      const decoded = nip19.decode(value.replace(/^nostr:/i, "").toLowerCase());
      if (kind === "p" && decoded.type === "npub") return { name: "profile", pubkey: decoded.data, relays: [] };
      if (kind === "p" && decoded.type === "nprofile") return { name: "profile", pubkey: decoded.data.pubkey, relays: decoded.data.relays ?? [] };
      if (kind === "e" && decoded.type === "note") return { name: "thread", id: decoded.data, relays: [] };
      if (kind === "e" && decoded.type === "nevent")
        return { name: "thread", id: decoded.data.id, relays: decoded.data.relays ?? [], author: decoded.data.author };
    } catch {
      // 下で見つからない画面にする
    }
  }
  return { name: "notFound", path };
}

export const profileHref = (pubkey: string, relays: string[] = []) =>
  `#/p/${relays.length > 0 ? nip19.nprofileEncode({ pubkey, relays: relays.slice(0, 3) }) : nip19.npubEncode(pubkey)}`;

export const searchHref = (q: string) => `#/search${q ? `?${new URLSearchParams({ q })}` : ""}`;

export const threadHref = (id: string, author?: string, relays: string[] = []) =>
  `#/e/${nip19.neventEncode({ id, author, relays: relays.slice(0, 3) })}`;

/** 2 人の会話の画面。 */
export const talkHref = (a: string, b: string) => `#/talk/${nip19.npubEncode(a)}/${nip19.npubEncode(b)}`;

/** 日時を指定して見る画面（author は「この人だけ」のとき）。 */
export const atHref = (time: number, scope: AroundScope, author?: string) =>
  `#/at/${Math.floor(time)}?scope=${scope}${author ? `&author=${author}` : ""}`;

/** いまの話題の言葉を含む投稿の画面。 */
export const topicHref = (word: string, since: number, until: number, tab: "following" | "global") =>
  `#/topic/${encodeURIComponent(word)}?since=${Math.floor(since)}&until=${Math.floor(until)}&tab=${tab}`;

/** たぶんこの流れの画面。scope はホームの範囲。 */
export const flowHref = (id: string, author: string, scope: "following" | "global") =>
  `#/flow/${nip19.neventEncode({ id, author })}?scope=${scope}`;

/** 前後の投稿の画面。scope は最初に選ぶ範囲。 */
export const aroundHref = (id: string, scope: AroundScope, author?: string) =>
  `#/around/${nip19.neventEncode({ id, author })}?scope=${scope}`;

class Router {
  route = $state<Route>(parseRoute(location.hash));

  constructor() {
    window.addEventListener("hashchange", () => (this.route = parseRoute(location.hash)));
  }
}

export const router = new Router();

/** 記事を書く画面。identifier を渡すと自分のその記事を書き直す。 */
export const writeHref = (identifier?: string) => `#/write${identifier ? `?${new URLSearchParams({ d: identifier })}` : ""}`;

/** リレーの情報画面。 */
export const relayHref = (url: string) => `#/relay?${new URLSearchParams({ url })}`;
