import { nip19 } from "nostr-tools";
import type { Event, Filter } from "../nostr/events";
import { normalizeRelay } from "../nostr/relayUrl";
import type { Profile } from "../store/cache.svelte";
import { parent } from "./threads";

/** 検索（Android 版の SearchQueries・TextSearch、技術資料 5.6）。 */

export type SearchQuery =
  | { type: "text"; value: string }
  | { type: "tag"; value: string }
  | { type: "author"; pubkey: string; relays: string[] }
  | { type: "event"; id: string; relays: string[]; author?: string }
  | { type: "address"; kind: number; pubkey: string; identifier: string; relays: string[] }
  | { type: "nip05"; value: string }
  /** 検索語なしで、絞り込みだけで探す。 */
  | { type: "filtered" };

/** 検索で探す種類（投稿・コメント・記事）。 */
export const SEARCH_KINDS = [1, 1111, 30023];

/** 入力を読む。読めないときは日本語の理由で例外を投げる。 */
export function parseQuery(input: string): SearchQuery {
  const trimmed = input.trim();
  const value = /^nostr:/i.test(trimmed) ? trimmed.slice(6) : trimmed;
  if (!value || value.length > 5000) throw new Error("検索語を入力してください（最大5000文字）");
  if (/nsec1|ncryptsec1/i.test(value)) throw new Error("秘密鍵は検索に使用できません");
  if (value.startsWith("#")) {
    const tag = value.slice(1);
    if (!tag || tag.length > 100 || /\s/.test(tag)) throw new Error("タグを1つ入力してください");
    return { type: "tag", value: tag.toLowerCase() };
  }
  if (/^[0-9a-fA-F]{64}$/.test(value)) return { type: "author", pubkey: value.toLowerCase(), relays: [] };
  if (value.includes("@") && !/\s/.test(value) && !value.includes("://")) return { type: "nip05", value };
  if (!/^(npub1|note1|nevent1|nprofile1|naddr1)/i.test(value)) return { type: "text", value };
  let decoded: nip19.DecodedResult;
  try {
    decoded = nip19.decode(value.toLowerCase() as `${string}1${string}`);
  } catch {
    throw new Error("識別子の形式・チェックサムを確認してください");
  }
  const hints = (relays: string[] | undefined) => [...new Set((relays ?? []).map(normalizeRelay).filter((url): url is string => !!url))].slice(0, 6);
  switch (decoded.type) {
    case "npub": return { type: "author", pubkey: decoded.data, relays: [] };
    case "nprofile": return { type: "author", pubkey: decoded.data.pubkey, relays: hints(decoded.data.relays) };
    case "note": return { type: "event", id: decoded.data, relays: [] };
    case "nevent": return { type: "event", id: decoded.data.id, relays: hints(decoded.data.relays), author: decoded.data.author };
    case "naddr": return { type: "address", kind: decoded.data.kind, pubkey: decoded.data.pubkey, identifier: decoded.data.identifier, relays: hints(decoded.data.relays) };
    default: throw new Error("識別子の参照先が不正です");
  }
}

/**
 * 文字の検索の語。空白で区切り、"..." は 1 語、先頭の - は除外。`:` を含む語（リレー向けの指定）は、
 * 引用符で囲まない限り使わない（Android 版の TextSearch.terms）。
 */
export function terms(query: string): { value: string; excluded: boolean }[] {
  const result: { value: string; excluded: boolean }[] = [];
  for (const match of query.matchAll(/-?"([^"]+)"|-?\S+/g)) {
    const raw = match[0];
    const excluded = raw.startsWith("-");
    const value = raw.replace(/^-/, "").replace(/^"(.*)"$/, "$1").trim();
    if (value && (!value.includes(":") || raw.includes('"'))) result.push({ value, excluded });
  }
  return result;
}

/** 大文字小文字を区別せずに、すべての語を含み、除外の語を含まないか。 */
export function textMatches(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const all = terms(query);
  return all.filter((t) => !t.excluded).every((t) => lower.includes(t.value.toLowerCase())) &&
    !all.filter((t) => t.excluded).some((t) => lower.includes(t.value.toLowerCase()));
}

/** 文字の検索で見る文字（記事は題名と概要も）。 */
function searchable(event: Event): string {
  if (event.kind !== 30023) return event.content;
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1] ?? "";
  return [tag("title"), tag("summary"), event.content].join("\n");
}

export type PostType = "all" | "root" | "reply" | "quote" | "comment";
export type MediaType = "all" | "image" | "video" | "link" | "none";
export const POST_TYPES: { value: PostType; label: string }[] = [
  { value: "all", label: "すべて" }, { value: "root", label: "ルート投稿" }, { value: "reply", label: "返信" }, { value: "quote", label: "引用" }, { value: "comment", label: "kind 1111" },
];
export const MEDIA_TYPES: { value: MediaType; label: string }[] = [
  { value: "all", label: "すべて" }, { value: "image", label: "画像あり" }, { value: "video", label: "動画あり" }, { value: "link", label: "リンクあり" }, { value: "none", label: "メディアなし" },
];

/** 検索の絞り込み（Android 版の SearchFilters）。since・until は秒。 */
export interface SearchFilters {
  since?: number;
  until?: number;
  authors: string[];
  excludedAuthors: string[];
  tags: string[];
  excludedTags: string[];
  excludedTerms: string[];
  postType: PostType;
  mediaType: MediaType;
}

export const NO_FILTERS: SearchFilters = { authors: [], excludedAuthors: [], tags: [], excludedTags: [], excludedTerms: [], postType: "all", mediaType: "all" };

/** 使っている絞り込みの数。 */
export function activeFilters(f: SearchFilters): number {
  return [f.since !== undefined || f.until !== undefined, f.authors.length > 0, f.excludedAuthors.length > 0, f.tags.length > 0,
    f.excludedTags.length > 0, f.excludedTerms.length > 0, f.postType !== "all", f.mediaType !== "all"].filter(Boolean).length;
}

/** 絞り込みに合うか（Android 版の SearchQueries.matchesFilters）。 */
export function matchesFilters(event: Event, f: SearchFilters): boolean {
  if (f.since !== undefined && event.created_at < f.since) return false;
  if (f.until !== undefined && event.created_at > f.until) return false;
  if (f.authors.length > 0 && !f.authors.includes(event.pubkey)) return false;
  if (f.excludedAuthors.includes(event.pubkey)) return false;
  const tags = new Set(event.tags.filter((t) => t.length >= 2 && t[0] === "t").map((t) => t[1].toLowerCase()));
  if (!f.tags.every((tag) => tags.has(tag.toLowerCase()))) return false;
  if (f.excludedTags.some((tag) => tags.has(tag.toLowerCase()))) return false;
  const lower = event.content.toLowerCase();
  if (f.excludedTerms.some((term) => lower.includes(term.toLowerCase()))) return false;
  const reply = parent(event) !== null;
  const quote = event.tags.some((t) => t[0] === "q" && /^[0-9a-fA-F]{64}$/.test(t[1] ?? ""));
  switch (f.postType) {
    case "root": if (event.kind !== 1 || reply || quote) return false; break;
    case "reply": if (event.kind !== 1 || !reply || quote) return false; break;
    case "quote": if (!quote) return false; break;
    case "comment": if (event.kind !== 1111) return false; break;
  }
  const urls = [...event.content.matchAll(/https?:\/\/\S+/gi)].map((m) => m[0].replace(/[.,)\]}。、]+$/u, ""));
  const path = (url: string) => url.split(/[?#]/)[0].toLowerCase();
  const videos = urls.some((url) => /\.(mp4|webm|mov|m4v)$/.test(path(url)));
  const images = urls.some((url) => /\.(png|jpe?g|gif|webp)$/.test(path(url))) || event.tags.some((t) => t[0] === "imeta");
  switch (f.mediaType) {
    case "image": return images;
    case "video": return videos;
    case "link": return urls.length > 0;
    case "none": return urls.length === 0 && !images;
  }
  return true;
}

/** 端末内の投稿から探す（新しい順、limit 件まで）。 */
export function matchNotes(query: SearchQuery, events: Iterable<Event>, limit = 100, filters: SearchFilters = NO_FILTERS): Event[] {
  const unique = new Map<string, Event>();
  for (const event of events) {
    if (!SEARCH_KINDS.includes(event.kind) && query.type !== "event") continue;
    let ok = false;
    switch (query.type) {
      case "filtered": ok = true; break;
      case "text": ok = textMatches(searchable(event), query.value); break;
      case "tag": ok = event.tags.some((t) => t.length >= 2 && t[0] === "t" && t[1].toLowerCase() === query.value); break;
      case "author": ok = event.pubkey === query.pubkey; break;
      case "event": ok = event.id === query.id; break;
      case "address": ok = event.pubkey === query.pubkey && event.tags.some((t) => t[0] === "d" && t[1] === query.identifier); break;
    }
    if (ok && matchesFilters(event, filters)) unique.set(event.id, event);
  }
  return [...unique.values()].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)).slice(0, limit);
}

/** 端末内のプロフィールから探す（文字の検索だけ。名前・公開鍵・NIP-05・自己紹介）。 */
export function matchProfiles(query: SearchQuery, profiles: Iterable<[string, Profile]>, limit = 50): string[] {
  if (query.type !== "text") return [];
  const result: string[] = [];
  for (const [pubkey, profile] of profiles) {
    const text = [profile.displayName, profile.name, pubkey, profile.nip05, profile.about].filter(Boolean).join(" ");
    if (textMatches(text, query.value)) result.push(pubkey);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * リレーへ送るフィルタ（文字は NIP-50 の search、タグは #t、絞り込みだけのときは種類と絞り込み）。until があれば
 * それより前（絞り込みの until より前のときだけ）。絞り込みの期間・作者・タグはフィルタに入れ、除く語は search に
 * `-語` で足す。ほかの絞り込みは、届いたものを matchesFilters で絞る。
 */
export function searchFilters(query: SearchQuery, until?: number, filters: SearchFilters = NO_FILTERS): Filter[] {
  const kinds = filters.postType === "comment" ? [1111] : SEARCH_KINDS;
  const end = [until, filters.until].filter((v): v is number => v !== undefined);
  const base: Filter = {
    kinds,
    limit: 100,
    ...(end.length > 0 ? { until: Math.min(...end) } : {}),
    ...(filters.since !== undefined ? { since: filters.since } : {}),
    ...(filters.authors.length > 0 ? { authors: filters.authors } : {}),
  };
  if (query.type === "text") {
    if (query.value.length > 500) return [];
    const excluded = filters.excludedTerms.map((term) => (/\s/.test(term) ? `-"${term}"` : `-${term}`));
    const search = [query.value, ...excluded].join(" ");
    return [
      { ...base, search, ...(filters.tags.length > 0 ? { "#t": filters.tags } : {}) },
      ...(until === undefined ? [{ kinds: [0], search: query.value, limit: 50 }] : []),
    ];
  }
  if (query.type === "tag") return [{ ...base, "#t": [...new Set([...filters.tags, query.value])] }];
  if (query.type === "filtered") return [{ ...base, ...(filters.tags.length > 0 ? { "#t": filters.tags } : {}) }];
  return [];
}
