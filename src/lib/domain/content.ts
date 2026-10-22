import { nip19 } from "nostr-tools";
import { isHex64, type Event } from "../nostr/events";

/** 1 つの投稿で読み取る画像・動画の数（Android 版の ImageAttachments.MAX_SHOWN）。 */
export const MAX_SHOWN = 20;

const URL_CANDIDATE = /https:\/\/[^\s<>]+/gi;
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const VIDEO_EXT = new Set(["mp4", "webm", "m4v", "mov"]);
const trimUrl = (url: string) => url.replace(/[.,、。)\]}]+$/u, "");

function safeHttps(url: string): URL | null {
  if (url.length > 2048) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

const extension = (url: URL) => url.pathname.slice(url.pathname.lastIndexOf(".") + 1).toLowerCase();

export interface Media { url: string; video: boolean; width?: number; height?: number }

/** 本文の画像・動画の URL と、NIP-92 の imeta の画像（Android 版の ImageAttachments・MediaAttachments）。 */
export function mediaOf(event: Event): Media[] {
  const meta = new Map<string, Record<string, string>>();
  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;
    const fields: Record<string, string> = {};
    for (const value of tag.slice(1)) {
      const space = value.indexOf(" ");
      if (space > 0) fields[value.slice(0, space)] = value.slice(space + 1);
    }
    if (fields.url && safeHttps(fields.url)) meta.set(fields.url, fields);
  }
  const result: Media[] = [];
  const add = (url: string, video: boolean) => {
    if (result.some((media) => media.url === url) || result.length >= MAX_SHOWN) return;
    const dim = meta.get(url)?.dim?.split("x").map((side) => Number(side.trim()));
    const sized = dim && dim.length === 2 && dim.every((side) => Number.isInteger(side) && side >= 1 && side <= 20000);
    result.push({ url, video, ...(sized ? { width: dim[0], height: dim[1] } : {}) });
  };
  for (const match of event.content.matchAll(URL_CANDIDATE)) {
    const url = trimUrl(match[0]);
    const parsed = safeHttps(url);
    if (!parsed) continue;
    if (IMAGE_EXT.has(extension(parsed))) add(url, false);
    else if (VIDEO_EXT.has(extension(parsed))) add(url, true);
  }
  for (const [url, fields] of meta) {
    const mime = (fields.m ?? "").toLowerCase();
    const parsed = safeHttps(url)!;
    if (mime.startsWith("image/") || IMAGE_EXT.has(extension(parsed))) add(url, false);
    else if (mime.startsWith("video/") || VIDEO_EXT.has(extension(parsed))) add(url, true);
  }
  return result;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 本文から画像・動画の URL を取り除く。URL だけの行は行ごと消す（Android 版の MediaAttachments.displayBody）。 */
export function withoutMedia(text: string, media: Media[]): string {
  let result = text;
  for (const { url } of media) {
    result = result.replace(new RegExp(`^[ \\t]*${escapeRegExp(url)}[ \\t]*(?:\\r?\\n|$)`, "gm"), "").split(url).join("");
  }
  return result.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const BECH32 = "[023456789acdefghjklmnpqrstuvwxyz]+";
const REFERENCE = new RegExp(`nostr:((?:note|nevent)1${BECH32})`, "gi");
const TRAILING_REFERENCE = new RegExp(`(?:^|\\s)(nostr:(?:note|nevent)1${BECH32})\\s*$`, "i");

/** note・nevent から ID を読む。読めなければ null。 */
export function eventIdOf(identifier: string): string | null {
  try {
    const decoded = nip19.decode(identifier.toLowerCase());
    if (decoded.type === "note") return decoded.data;
    if (decoded.type === "nevent") return decoded.data.id;
  } catch {
    // 読めない
  }
  return null;
}

/** 引用カードに出す投稿: `q` タグ、なければ本文末尾の note・nevent（Android 版の Quotes.cardId）。 */
export function quoteCardId(event: Event): string | null {
  const q = event.tags.find((tag) => tag[0] === "q" && /^[0-9a-fA-F]{64}$/.test(tag[1] ?? ""))?.[1];
  if (q) return q.toLowerCase();
  const trailing = TRAILING_REFERENCE.exec(event.content)?.[1];
  return trailing ? eventIdOf(trailing.slice(trailing.indexOf(":") + 1)) : null;
}

/** 引用した投稿のありか: `q` タグのリレーと作者、本文の nevent のリレーと作者。 */
export function quoteSource(event: Event, id: string): { relays: string[]; author?: string } {
  const relays: string[] = [];
  let author: string | undefined;
  const tag = event.tags.find((t) => t[0] === "q" && t[1]?.toLowerCase() === id);
  if (tag?.[2]) relays.push(tag[2]);
  if (tag?.[3] && isHex64(tag[3])) author = tag[3];
  for (const match of event.content.matchAll(REFERENCE)) {
    try {
      const decoded = nip19.decode(match[1].toLowerCase());
      if (decoded.type !== "nevent" || decoded.data.id !== id) continue;
      relays.push(...(decoded.data.relays ?? []));
      author ??= decoded.data.author;
    } catch {
      // 読めない参照は使わない
    }
  }
  return { relays, author };
}

/** 1 つの投稿に並べる引用カードの数（Android 版の Quotes.MAX_CARDS）。 */
export const MAX_QUOTE_CARDS = 3;

/**
 * 引用カードに出す投稿（Android 版の Quotes.cards）。`q` タグを先に、次に本文のどこかにある nostr:note・nevent を、
 * 重ねずに 3 件まで。リレーのヒントと作者も添える（そのありかから読むため）。4 件目からはリンクのまま。
 */
export function quoteCards(event: Event): { id: string; relays: string[]; author?: string }[] {
  const ids: string[] = [];
  for (const tag of event.tags) if (tag[0] === "q" && /^[0-9a-fA-F]{64}$/.test(tag[1] ?? "")) ids.push(tag[1].toLowerCase());
  for (const match of event.content.matchAll(REFERENCE)) {
    const id = eventIdOf(match[1]);
    if (id) ids.push(id);
  }
  return [...new Set(ids)].slice(0, MAX_QUOTE_CARDS).map((id) => ({ id, ...quoteSource(event, id) }));
}

/** 引用カードの上に出す本文。引用した投稿へのリンクはどこにあっても取り除き、リンクだけの行は行ごと消す（Quotes.body）。 */
export function withoutQuoteLink(text: string, card: string | string[] | null): string {
  const cards = new Set(Array.isArray(card) ? card : card ? [card] : []);
  if (cards.size === 0) return text;
  const links = [...new Set([...text.matchAll(REFERENCE)].filter((match) => cards.has(eventIdOf(match[1]) ?? "")).map((match) => match[0]))];
  if (links.length === 0) return text;
  let result = text;
  for (const link of links) {
    result = result.replace(new RegExp(`^[ \\t]*${escapeRegExp(link)}[ \\t]*(?:\\r?\\n|$)`, "gm"), "").replace(new RegExp(`[ \t]?${escapeRegExp(link)}`, "g"), "");
  }
  return result.replace(/[ \t]+(?=\r?\n|$)/g, "").replace(/(?:\r?\n){3,}/g, "\n\n").trim();
}

export type Segment =
  | { type: "text"; text: string }
  | { type: "link"; url: string }
  | { type: "emoji"; shortcode: string; url: string }
  | { type: "hashtag"; tag: string }
  | { type: "profile"; pubkey: string; relays: string[]; raw: string }
  | { type: "event"; id: string; relays: string[]; author?: string; raw: string }
  | { type: "address"; kind: number; pubkey: string; identifier: string; raw: string };

/** NIP-30 のカスタム絵文字（shortcode → https の URL）。 */
export function emojisOf(event: Event): Map<string, string> {
  const result = new Map<string, string>();
  for (const tag of event.tags) {
    if (tag[0]?.toLowerCase() !== "emoji" || tag.length < 3) continue;
    const shortcode = tag[1].trim().replace(/^:|:$/g, "");
    if (/^[A-Za-z0-9_-]{1,64}$/.test(shortcode) && safeHttps(tag[2].trim()) && !result.has(shortcode)) result.set(shortcode, tag[2].trim());
  }
  return result;
}

const TOKEN = new RegExp(
  `(https?:\\/\\/[^\\s<>]+)|((?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1${BECH32})|:([A-Za-z0-9_-]{1,64}):|(?<=^|[\\s　])#([^\\s#　、。,.!?！？「」()（）]+)`,
  "giu",
);

/** 本文を、文字・リンク・カスタム絵文字・ハッシュタグ・nostr: の参照に分ける。 */
export function segments(text: string, emojis: Map<string, string>): Segment[] {
  const result: Segment[] = [];
  let last = 0;
  const pushText = (value: string) => {
    if (!value) return;
    const previous = result[result.length - 1];
    if (previous?.type === "text") previous.text += value;
    else result.push({ type: "text", text: value });
  };
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index!;
    let segment: Segment | null = null;
    let consumed = match[0];
    if (match[1]) {
      const url = trimUrl(match[1]);
      consumed = url;
      segment = { type: "link", url };
    } else if (match[2]) {
      segment = reference(match[2]);
    } else if (match[3]) {
      const url = emojis.get(match[3]);
      if (url) segment = { type: "emoji", shortcode: match[3], url };
    } else if (match[4]) {
      segment = { type: "hashtag", tag: match[4] };
    }
    if (!segment) continue;
    pushText(text.slice(last, index));
    result.push(segment);
    last = index + consumed.length;
  }
  pushText(text.slice(last));
  return result;
}

function reference(raw: string): Segment | null {
  const bech = raw.replace(/^nostr:/i, "").toLowerCase();
  try {
    const decoded = nip19.decode(bech);
    switch (decoded.type) {
      case "npub":
        return { type: "profile", pubkey: decoded.data, relays: [], raw };
      case "nprofile":
        return { type: "profile", pubkey: decoded.data.pubkey, relays: decoded.data.relays ?? [], raw };
      case "note":
        return { type: "event", id: decoded.data, relays: [], raw };
      case "nevent":
        return { type: "event", id: decoded.data.id, relays: decoded.data.relays ?? [], author: decoded.data.author, raw };
      case "naddr":
        return { type: "address", kind: decoded.data.kind, pubkey: decoded.data.pubkey, identifier: decoded.data.identifier, raw };
    }
  } catch {
    // 読めない参照はただの文字
  }
  return null;
}

/** 本文の nostr:npub・nprofile の人（プロフィールを読む相手）。 */
export function mentionedPubkeys(event: Event): string[] {
  const result = new Set<string>();
  for (const segment of segments(event.content, new Map())) if (segment.type === "profile" && isHex64(segment.pubkey)) result.add(segment.pubkey);
  return [...result];
}
