import type { EventTemplate } from "nostr-tools";
import { isHex64, type Event } from "../nostr/events";

/**
 * リレーの下書き（NIP-37、Android 版の DraftWraps、技術資料 6.10）と記事の書き方（NIP-23、Android 版の ArticleWriting、6.11）。
 * 下書きは kind 31234 で、content は下書きのイベントの JSON を自分宛てに NIP-44 で暗号化したもの。中身が空の版は削除。
 */

export const DRAFT_KIND = 31234;
export const PRIVATE_RELAYS = 10013;
/** 保存し直さなければ 90 日で消える。 */
export const KEEP_SECONDS = 90 * 86400;

export interface RemoteDraft { identifier: string; kind: number; content: string; tags: string[][]; savedAt: number }

/** 下書きのイベント（kind・content・tags・created_at・pubkey）の JSON。暗号化する前の文。 */
export const draftPlaintext = (draft: EventTemplate, author: string) =>
  JSON.stringify({ kind: draft.kind, content: draft.content, tags: draft.tags, created_at: draft.created_at, pubkey: author });

export function buildDraftWrap(identifier: string, draftKind: number, encrypted: string, now: number): EventTemplate {
  if (!identifier.trim() || !encrypted) throw new Error("下書きの中身がありません");
  return { kind: DRAFT_KIND, created_at: now, tags: [["d", identifier], ["k", String(draftKind)], ["expiration", String(now + KEEP_SECONDS)]], content: encrypted };
}

/** 削除は、同じ d と k で中身を空にした版（expiration は付けない）。 */
export const buildDraftDeletion = (identifier: string, draftKind: number, now: number): EventTemplate =>
  ({ kind: DRAFT_KIND, created_at: now, tags: [["d", identifier], ["k", String(draftKind)]], content: "" });

const identifierOf = (event: Event) => event.tags.find((t) => t[0] === "d")?.[1] ?? "";

/** 識別子ごとのいちばん新しい版（中身が空のものは、古い版ごと隠す）。新しい順。 */
export function newestWraps(events: Iterable<Event>, me: string): Event[] {
  const byId = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== DRAFT_KIND || event.pubkey !== me || !identifierOf(event)) continue;
    const known = byId.get(identifierOf(event));
    if (!known || event.created_at > known.created_at || (event.created_at === known.created_at && event.id < known.id)) byId.set(identifierOf(event), event);
  }
  return [...byId.values()].filter((e) => e.content).sort((a, b) => b.created_at - a.created_at);
}

/** 復号した下書きを読む。続きを書ける種類（kind 1・1111）だけ。 */
export function readDraft(wrap: Event, plaintext: string): RemoteDraft | null {
  try {
    const json = JSON.parse(plaintext) as { kind?: unknown; content?: unknown; tags?: unknown };
    if (json.kind !== 1 && json.kind !== 1111) return null;
    const tags = Array.isArray(json.tags) ? json.tags.filter((t): t is string[] => Array.isArray(t) && t.every((v) => typeof v === "string")) : [];
    return { identifier: identifierOf(wrap), kind: json.kind, content: typeof json.content === "string" ? json.content : "", tags, savedAt: wrap.created_at };
  } catch {
    return null;
  }
}

/** 復号した kind 10013 のリレー。 */
export function privateRelays(plaintext: string): string[] {
  try {
    const tags = JSON.parse(plaintext) as unknown;
    if (!Array.isArray(tags)) return [];
    return [...new Set(tags.filter((t) => Array.isArray(t) && t[0] === "relay" && typeof t[1] === "string" && /^wss?:\/\//.test(t[1])).map((t) => t[1] as string))];
  } catch {
    return [];
  }
}

// 記事（NIP-23、kind 30023）

export interface ArticleFields { identifier: string; title: string; summary: string; image: string; hashtags: string; body: string; publishedAt?: number }

export const emptyArticle = (): ArticleFields => ({ identifier: "", title: "", summary: "", image: "", hashtags: "", body: "" });
export const newArticleIdentifier = (now: number) => `penyotter-${now}`;
export const articleDraftIdentifier = (fields: ArticleFields) => `article:${fields.identifier.trim()}`;

export const articleHashtags = (value: string) =>
  [...new Set(value.split(/[\s,、，#＃]+/).map((t) => t.trim().toLowerCase()).filter((t) => t && t.length <= 100))].slice(0, 20);

/** draft は下書きに入れる版（published_at を付けない）。 */
export function buildArticle(fields: ArticleFields, now: number, draft = false): EventTemplate {
  if (!fields.identifier.trim()) throw new Error("記事の識別子がありません");
  if (!fields.title.trim()) throw new Error("題名を入れてください");
  if (!fields.body.trim()) throw new Error("本文を入れてください");
  if (fields.body.length > 200_000) throw new Error("本文が長すぎます（20万文字まで）");
  const tags = [["d", fields.identifier.trim()], ["title", fields.title.trim().slice(0, 300)]];
  if (fields.summary.trim()) tags.push(["summary", fields.summary.trim().slice(0, 600)]);
  if (fields.image.trim().startsWith("https://")) tags.push(["image", fields.image.trim()]);
  if (!draft) tags.push(["published_at", String(fields.publishedAt ?? now)]);
  for (const tag of articleHashtags(fields.hashtags)) tags.push(["t", tag]);
  return { kind: 30023, created_at: now, tags, content: fields.body };
}

/** 書いた記事を書き直すときの値。 */
export function articleFields(note: Event): ArticleFields {
  const tag = (name: string) => note.tags.find((t) => t.length >= 2 && t[0] === name)?.[1] ?? "";
  const published = Number(tag("published_at"));
  return {
    identifier: tag("d"), title: tag("title"), summary: tag("summary"), image: tag("image"),
    hashtags: note.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]).join(" "), body: note.content,
    publishedAt: Number.isFinite(published) && published > 0 ? published : undefined,
  };
}

export const isOwnArticle = (note: Event, me: string | null) => note.kind === 30023 && !!me && isHex64(me) && note.pubkey === me;
