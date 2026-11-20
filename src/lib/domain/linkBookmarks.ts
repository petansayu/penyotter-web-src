import { isHex64, type Event } from "../nostr/events";

/**
 * リンクのブックマーク（Android 版の LinkBookmarks）。非公開はブラウザの中だけ（見つけた投稿の nevent も残す）、
 * 公開は NIP-B0 の kind 39701（1 リンク 1 イベント）。kind 10003 には URL を入れない（`e`・`a` だけの仕様で、
 * NIP-51 の `r` はリレーの URL）。
 */

export interface LinkBookmark {
  url: string;
  title: string;
  addedAt: number;
  public: boolean;
  /** 見つけた投稿の nevent（非公開だけ）。 */
  from?: string;
  /** 公開の分を読んだ・送った kind 39701 の ID。 */
  eventId?: string;
  /** リンクについてのメモ（NIP-B0 では content）。 */
  description?: string;
}

export const LINK_BOOKMARK_KIND = 39701;
export const MAX_URL = 2000;
export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 2000;
export const MAX_EACH = 500;

/** 残すリンクの形。http・https でホストがあり、前後の空白を除いたもの。使えなければ null。 */
export function normalizeLink(raw: string): string | null {
  const url = raw.trim();
  if (!url || url.length > MAX_URL || /\s/.test(url)) return null;
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) return null;
  } catch {
    return null;
  }
  return url;
}

/** 末尾の / だけが違うリンクは同じブックマーク。 */
export const linkKey = (url: string) => url.trim().replace(/\/+$/, "");

/** `d` タグ（NIP-B0）。https なら `https://` を省き、http は残す（区別するため）。 */
export const linkIdentifier = (url: string) => (/^https:\/\//i.test(url.trim()) ? url.trim().slice("https://".length) : url.trim());

/** `d` タグが指すリンク。 */
export const linkFromIdentifier = (d: string) => (/^https?:\/\//i.test(d) ? d : `https://${d}`);

/** 署名する公開のブックマーク。description は content に入れる。publishedAt は足し直し・編集しても最初の時刻を残すため。 */
export function buildLinkBookmark(url: string, title: string, now: number, publishedAt?: number, description = "") {
  const link = normalizeLink(url);
  if (!link) throw new Error("http か https の URL を入力してください");
  const tags = [["d", linkIdentifier(link)]];
  const named = title.trim().slice(0, MAX_TITLE);
  if (named) tags.push(["title", named]);
  tags.push(["published_at", String(publishedAt ?? now)]);
  return { kind: LINK_BOOKMARK_KIND, created_at: now, tags, content: description.trim().slice(0, MAX_DESCRIPTION) };
}

/** events のうち自分の公開のブックマーク。同じ `d` は新しい版だけ、消した時刻（removed）より古い版は除く。新しい順。 */
export function publicLinkBookmarks(events: Iterable<Event>, me: string, removed: Record<string, number> = {}): LinkBookmark[] {
  const newest = new Map<string, Event>();
  for (const event of events) {
    if (event.kind !== LINK_BOOKMARK_KIND || event.pubkey !== me) continue;
    const d = event.tags.find((tag) => tag.length >= 2 && tag[0] === "d")?.[1];
    if (d === undefined) continue;
    const old = newest.get(d);
    if (!old || event.created_at > old.created_at || (event.created_at === old.created_at && event.id < old.id)) newest.set(d, event);
  }
  const result: LinkBookmark[] = [];
  for (const [d, event] of newest) {
    if ((removed[d] ?? -1) >= event.created_at) continue;
    const url = normalizeLink(linkFromIdentifier(d));
    if (!url) continue;
    const tag = (name: string) => event.tags.find((t) => t.length >= 2 && t[0] === name)?.[1];
    const published = Number(tag("published_at"));
    const description = event.content.trim().slice(0, MAX_DESCRIPTION);
    result.push({ url, title: (tag("title") ?? "").slice(0, MAX_TITLE), addedAt: Number.isInteger(published) && published > 0 ? published : event.created_at, public: true, eventId: event.id, ...(description ? { description } : {}) });
  }
  return result.sort((a, b) => b.addedAt - a.addedAt).slice(0, MAX_EACH);
}

/** 公開のブックマークの削除の依頼（NIP-09）。アドレスと、分かればその版。 */
export function linkBookmarkDeletion(me: string, bookmark: LinkBookmark, now: number) {
  const tags = [["a", `${LINK_BOOKMARK_KIND}:${me}:${linkIdentifier(bookmark.url)}`]];
  if (bookmark.eventId && isHex64(bookmark.eventId)) tags.push(["e", bookmark.eventId]);
  tags.push(["k", String(LINK_BOOKMARK_KIND)]);
  return { kind: 5, created_at: now, tags, content: "" };
}

/** 同じリンクのブックマークを、その位置のまま bookmark に置き換える（編集）。 */
export const replaceLinkBookmark = (list: LinkBookmark[], bookmark: LinkBookmark) =>
  list.map((item) => (linkKey(item.url) === linkKey(bookmark.url) ? bookmark : item));

/** bookmark を先頭に（同じリンクは新しい題名で上へ）。 */
export const addLinkBookmark = (list: LinkBookmark[], bookmark: LinkBookmark) =>
  [bookmark, ...list.filter((item) => linkKey(item.url) !== linkKey(bookmark.url))].slice(0, MAX_EACH);

/** ブラウザに残した一覧を読む。壊れた項目は除く。 */
export function decodeLinkBookmarks(raw: unknown, isPublic: boolean): LinkBookmark[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: LinkBookmark[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const url = typeof item?.url === "string" ? normalizeLink(item.url) : null;
    if (!url || typeof item.addedAt !== "number" || seen.has(linkKey(url))) continue;
    seen.add(linkKey(url));
    result.push({
      url, title: typeof item.title === "string" ? item.title.slice(0, MAX_TITLE) : "", addedAt: item.addedAt, public: isPublic,
      ...(typeof item.from === "string" && /^(nevent1|note1)/.test(item.from) ? { from: item.from } : {}),
      ...(typeof item.eventId === "string" && isHex64(item.eventId) ? { eventId: item.eventId } : {}),
      ...(typeof item.description === "string" && item.description ? { description: item.description.slice(0, MAX_DESCRIPTION) } : {}),
    });
  }
  return result.slice(0, MAX_EACH);
}
