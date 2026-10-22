import { nip19, type EventTemplate } from "nostr-tools";
import { isHex64, tagValue, type Event } from "../nostr/events";
import { address } from "./threads";
import { imetaTags, MAX_ATTACHMENTS, withAttachments, type Attachment } from "./media";

/** 投稿するイベントの組み立て（Android 版の PostBuilder・PenyotterClient、技術資料 6.1〜6.5）。 */

/** クライアントタグ（Android 版と同じ。このアプリの NIP-89 のアプリ情報を指す）。 */
export const CLIENT_TAG = ["client", "ぺにょったー", "31990:8fc9fe720f7706a14808eed3433c91b3ea3ae4164caa6d21d94417448d0d4188:penyotter", "wss://yabu.me"];
const CLIENT_KINDS = new Set([1, 6, 7, 16, 20, 21, 22, 42, 1111]);
export const MAX_BODY = 20_000;

export type ComposeMode = "post" | "reply" | "quote" | "like";

export interface Draft {
  mode: ComposeMode;
  body: string;
  /** 返信・引用・リアクションの相手。 */
  target?: Event;
  /** カスタム絵文字のリアクション（body は `:名前:`）。 */
  emoji?: { shortcode: string; url: string };
  /** 付ける画像・動画（本文の後ろに URL、imeta タグ）。 */
  media?: Attachment[];
  /** 本文の :名前: に使えるカスタム絵文字（本文にあるものだけ emoji タグにする。50 種類まで）。 */
  customEmojis?: { shortcode: string; url: string }[];
  /** 注意書き（NIP-36、200 文字まで）。 */
  contentWarning?: string | null;
  /** 消える投稿（NIP-40）。何秒後に消えるか。 */
  expiresAfter?: number | null;
}

/** 消える投稿の選択肢（Android 版の Expiration.choices と同じ）。 */
export const EXPIRATION_CHOICES: { label: string; seconds: number }[] = [
  { label: "1時間", seconds: 3600 },
  { label: "1日", seconds: 86400 },
  { label: "3日", seconds: 3 * 86400 },
  { label: "1週間", seconds: 7 * 86400 },
];
export const expirationLabel = (seconds: number | null | undefined) =>
  seconds ? EXPIRATION_CHOICES.find((c) => c.seconds === seconds)?.label ?? `${Math.floor(seconds / 3600)}時間` : null;

/** 1 つの投稿に付けるカスタム絵文字の種類の上限（Android 版と同じ）。 */
export const MAX_CUSTOM_EMOJIS = 50;

/** 本文の nostr:note・nevent（引用）。 */
function references(body: string): { id: string; relay: string; author?: string }[] {
  const result: { id: string; relay: string; author?: string }[] = [];
  for (const match of body.matchAll(/nostr:((?:note|nevent)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi)) {
    try {
      const decoded = nip19.decode(match[1].toLowerCase());
      const ref = decoded.type === "note" ? { id: decoded.data, relay: "" }
        : decoded.type === "nevent" ? { id: decoded.data.id, relay: decoded.data.relays?.[0] ?? "", author: decoded.data.author } : null;
      if (ref && !result.some((r) => r.id === ref.id)) result.push(ref);
    } catch {
      // 読めない参照は使わない
    }
  }
  return result;
}

/** 本文の nostr:npub・nprofile（メンション）。 */
function mentions(body: string): string[] {
  const result: string[] = [];
  for (const match of body.matchAll(/nostr:((?:npub|nprofile)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi)) {
    try {
      const decoded = nip19.decode(match[1].toLowerCase());
      const pubkey = decoded.type === "npub" ? decoded.data : decoded.type === "nprofile" ? decoded.data.pubkey : null;
      if (pubkey && !result.includes(pubkey)) result.push(pubkey);
    } catch {
      // 読めない参照は使わない
    }
  }
  return result;
}

const has = (tags: string[][], name: string, value: string) => tags.some((tag) => tag[0] === name && tag[1] === value);

/** 署名する前のイベントを作る。読めない下書きは例外（日本語の理由）。 */
export function buildEvent(author: string, draft: Draft, now: number, options: { clientTag?: boolean } = {}): EventTemplate {
  if (!isHex64(author)) throw new Error("公開鍵の形が正しくありません");
  const media = draft.mode === "like" ? [] : draft.media ?? [];
  if (media.length > MAX_ATTACHMENTS) throw new Error(`画像・動画は ${MAX_ATTACHMENTS} つまでです`);
  const body = withAttachments(draft.body, media);
  if (draft.mode !== "like" && !body.trim()) throw new Error("本文を入力してください");
  if (draft.mode === "like") {
    // リアクションは「+」、絵文字（32 文字まで）、またはカスタム絵文字の :名前:
    if (!body.trim() || body.length > 32 || /\s/.test(body)) throw new Error("リアクションを 1 つ選んでください");
    if (draft.emoji && body !== `:${draft.emoji.shortcode}:`) throw new Error("カスタム絵文字の名前が合いません");
    if (!draft.emoji && /^:[A-Za-z0-9_-]+:$/.test(body)) throw new Error("カスタム絵文字の画像がありません");
  }
  if (body.length > MAX_BODY) throw new Error(`本文は ${MAX_BODY.toLocaleString("en-US")} 文字までです`);
  const target = draft.target;
  if (draft.mode !== "post" && (!target || !isHex64(target.id) || !isHex64(target.pubkey))) throw new Error("相手の投稿が必要です");
  const tags: string[][] = [];

  if (draft.mode === "reply" && target) {
    const targetPeople = target.tags.filter((t) => t.length >= 2 && t[0] === "p" && isHex64(t[1])).map((t) => t[1]);
    if (target.kind === 1) {
      // NIP-10: 根と返信先に印を付ける
      const refs = target.tags.filter((t) => t.length >= 2 && t[0] === "e" && isHex64(t[1]));
      const root = refs.find((t) => t[3] === "root") ?? refs.find((t) => t.length < 4 || !t[3]);
      const rootId = root?.[1] ?? target.id;
      const rootAuthor = isHex64(root?.[4]) ? root![4] : rootId === target.id ? target.pubkey : "";
      tags.push(["e", rootId, root?.[2] ?? "", "root", rootAuthor]);
      if (rootId !== target.id) tags.push(["e", target.id, "", "reply", target.pubkey]);
    } else {
      // NIP-22: 公開鍵は E・e にだけ書く。アドレスで指すイベントはアドレスと ID の両方で指す
      const rootRef = ["A", "E", "I"].map((name) => target.tags.find((t) => t.length >= 2 && t[0] === name)).find(Boolean);
      const targetAddress = target.kind >= 30000 && target.kind < 40000 ? address(target) : null;
      tags.push(rootRef ?? (targetAddress ? ["A", targetAddress, ""] : ["E", target.id, "", target.pubkey]));
      tags.push(["K", tagValue(target, "K") ?? String(target.kind)]);
      tags.push(["P", target.tags.find((t) => t[0] === "P" && isHex64(t[1]))?.[1] ?? target.pubkey]);
      if (targetAddress) tags.push(["a", targetAddress, ""]);
      tags.push(["e", target.id, "", target.pubkey]);
      tags.push(["k", String(target.kind)]);
    }
    for (const pubkey of [...new Set([...targetPeople, target.pubkey])]) tags.push(["p", pubkey]);
  } else if (draft.mode === "quote" && target) {
    tags.push(["q", target.id, "", target.pubkey], ["p", target.pubkey]);
  } else if (draft.mode === "like" && target) {
    tags.push(["e", target.id, "", target.pubkey], ["p", target.pubkey], ["k", String(target.kind)]);
    if (draft.emoji) tags.push(["emoji", draft.emoji.shortcode, draft.emoji.url]);
  }

  const content = draft.mode === "quote" && target ? `${body.trimEnd()}\n\nnostr:${nip19.noteEncode(target.id)}` : body;

  if (draft.mode !== "like") {
    // 本文の nevent・note は引用（q と、作者が分かれば p）。10 件まで
    for (const ref of references(content).slice(0, 10)) {
      if (!has(tags, "q", ref.id)) tags.push(["q", ref.id, ref.relay, ...(ref.author ? [ref.author] : [])]);
      if (ref.author && ref.author !== author && !has(tags, "p", ref.author)) tags.push(["p", ref.author]);
    }
    // メンションした人（自分を除く、20 人まで）に p を付ける
    for (const pubkey of mentions(content).filter((p) => p !== author).slice(0, 20)) if (!has(tags, "p", pubkey)) tags.push(["p", pubkey]);
    // ハッシュタグ（直前が文字・数字・_・/ の # は除く）
    const hashtags = new Set([...content.matchAll(/(?<![\p{L}\p{N}_/])#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase()));
    for (const tag of hashtags) tags.push(["t", tag]);
  }
  if (draft.mode !== "like" && draft.contentWarning != null) tags.push(["content-warning", draft.contentWarning.trim().slice(0, 200)]);
  tags.push(...imetaTags(media));
  if (draft.mode !== "like" && draft.customEmojis?.length) {
    const used = new Set([...content.matchAll(/:([A-Za-z0-9_-]+):/g)].map((m) => m[1]));
    const seen = new Set<string>();
    for (const emoji of draft.customEmojis) {
      if (!used.has(emoji.shortcode) || seen.has(emoji.shortcode) || !emoji.url.startsWith("https://")) continue;
      if (seen.size >= MAX_CUSTOM_EMOJIS) throw new Error(`カスタム絵文字は ${MAX_CUSTOM_EMOJIS} 種類までです`);
      seen.add(emoji.shortcode);
      tags.push(["emoji", emoji.shortcode, emoji.url]);
    }
  }
  // 消える投稿（NIP-40）。リアクションには使わない
  if (draft.mode !== "like" && draft.expiresAfter && draft.expiresAfter > 0) tags.push(["expiration", String(now + draft.expiresAfter)]);
  // 件名（NIP-14）は返信で「Re: 」を付けて引き継ぐ
  if (draft.mode === "reply" && target) {
    const subject = tagValue(target, "subject")?.trim();
    if (subject) tags.push(["subject", /^re:/i.test(subject) ? subject : `Re: ${subject}`]);
  }

  const kind = draft.mode === "like" ? 7 : draft.mode === "reply" && target?.kind !== 1 ? 1111 : 1;
  if ((options.clientTag ?? true) && CLIENT_KINDS.has(kind) && !tags.some((t) => t[0] === "client")) tags.push([...CLIENT_TAG]);
  return { kind, created_at: now, tags, content };
}

/** クライアントタグを付ける（対象の kind で、まだないときだけ）。 */
export function withClientTag<T extends EventTemplate>(template: T, on: boolean): T {
  if (on && CLIENT_KINDS.has(template.kind) && !template.tags.some((t) => t[0] === "client")) template.tags.push([...CLIENT_TAG]);
  return template;
}

/**
 * リポスト（技術資料 6.5、NIP-18）。元の投稿が kind 1 なら kind 6、それ以外は kind 16 と `k`。content は署名つきの
 * 元の投稿の JSON（NIP-70 の `["-"]` がある保護された投稿は空にする。中に入れるとリレーに拒否されるため）。
 * relay は元の投稿を受け取ったリレー。
 */
export function buildRepost(original: Event, relay: string, now: number, options: { clientTag?: boolean } = {}): EventTemplate {
  if (!isHex64(original.id) || !isHex64(original.pubkey)) throw new Error("リポストする投稿の形が正しくありません");
  const kind = original.kind === 1 ? 6 : 16;
  const tags: string[][] = [["e", original.id, relay], ["p", original.pubkey]];
  if (kind === 16) tags.push(["k", String(original.kind)]);
  const protectedPost = original.tags.some((tag) => tag.length === 1 && tag[0] === "-");
  const content = protectedPost ? "" : JSON.stringify(original);
  if (options.clientTag ?? true) tags.push([...CLIENT_TAG]);
  return { kind, created_at: now, tags, content };
}

/** リアクション・リポストの取り消し（kind 5）。 */
export function buildUndo(action: Event, now: number): EventTemplate {
  if (![6, 7, 16].includes(action.kind)) throw new Error("取り消せるのはリアクションとリポストだけです");
  return {
    kind: 5,
    created_at: now,
    tags: [["e", action.id], ["k", String(action.kind)]],
    content: action.kind === 7 ? "リアクションを取り消しました" : "リポストを取り消しました",
  };
}

/**
 * 投稿の削除の依頼（NIP-09、kind 5）。`e` と `k`、書き直せる種類（記事など）はアドレスの `a` も付ける。
 * 自分の投稿だけ。
 */
export function buildDeletion(note: Event, author: string, now: number): EventTemplate {
  if (note.pubkey !== author) throw new Error("削除できるのは自分の投稿だけです");
  const tags: string[][] = [["e", note.id], ["k", String(note.kind)]];
  const target = note.kind >= 30000 && note.kind < 40000 ? address(note) : null;
  if (target) tags.push(["a", target]);
  return { kind: 5, created_at: now, tags, content: "" };
}

/** 削除の依頼を届けたい相手（引用した相手、なければ最初の `p`。自分は除く）。Android 版の DeliveryRelays.addressee。 */
export function addressee(note: Event): string | null {
  const quoted = note.tags.find((tag) => tag[0] === "q" && isHex64(tag[3]) && tag[3] !== note.pubkey)?.[3];
  if (quoted) return quoted;
  return note.tags.find((tag) => tag[0] === "p" && isHex64(tag[1]) && tag[1] !== note.pubkey)?.[1] ?? null;
}
