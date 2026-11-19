import { verifyEvent } from "nostr-tools";
import { mutedByWords, type MuteRules } from "./muteRules";
import { reactionHidden } from "./hiddenMessages";
import { isHex64, type Event } from "../nostr/events";
import { emojisOf, quoteCardId } from "./content";
import { parent } from "./threads";
import { AWARD, awardedAddresses } from "./badges";
import { watchMatch, type WatchRule } from "./watchedPosts";

/** 通知（Android 版の Notifications・Zaps・NotificationsPanel、技術資料 5.3）。 */

export type NotificationType = "all" | "replies" | "reactions" | "reposts" | "zaps" | "quotes" | "badges" | "posts";
export const NOTIFICATION_TYPES: { type: NotificationType; label: string }[] = [
  { type: "all", label: "すべて" },
  { type: "replies", label: "リプライ" },
  { type: "reactions", label: "リアクション" },
  { type: "reposts", label: "リポスト" },
  { type: "zaps", label: "zap" },
  { type: "quotes", label: "引用" },
  { type: "badges", label: "バッジ" },
  // 選んだ人の新しい投稿（投稿のお知らせ、watchedPosts）
  { type: "posts", label: "投稿" },
];

export const NOTIFICATION_KINDS = [1, 6, 7, 8, 16, 1111, 9735];
/** 通知の対象として使わない種類（プロフィール・フォロー一覧・削除）。リアクション（7）は「あなたのリアクション」として使う。 */
export const NOT_TARGETS = [0, 3, 5];

export interface ZapReceipt { sender: string; msats: number | null; message: string }

const receipts = new Map<string, ZapReceipt | null>();

/** 中の zap リクエストに作者の正しい署名があるか（kind 9734）。テストでは差し替える。 */
export const zapChecks = {
  requestIsValid: (request: unknown): boolean => {
    try {
      return (request as Event).kind === 9734 && verifyEvent(request as Event);
    } catch {
      return false;
    }
  },
};

/**
 * zap レシートから送った人・金額・メッセージを読む（NIP-57、Android 版の Zaps.receipt と同じ）。中に送った人の署名
 * つきの zap リクエスト（description）がいる。リクエストが宛てた人がレシートの `p` にいること、bolt11 の請求書の
 * 金額がリクエストの amount と同じことも確かめ、合わなければ null（偽のレシートで zap を見せないため）。
 * レシートを署名したのが受け取る人の Lightning アドレスのサーバーかは、notificationGroups の zapIssuer で比べる。
 */
export function zapReceipt(event: Event): ZapReceipt | null {
  if (event.kind !== 9735) return null;
  if (receipts.has(event.id)) return receipts.get(event.id)!;
  const result = readReceipt(event);
  if (receipts.size > 2000) receipts.clear();
  receipts.set(event.id, result);
  return result;
}

function readReceipt(event: Event): ZapReceipt | null {
  let request: { pubkey?: unknown; tags?: unknown; content?: unknown } | null = null;
  try {
    const description = event.tags.find((tag) => tag.length >= 2 && tag[0] === "description")?.[1];
    if (description) request = JSON.parse(description);
  } catch {
    return null;
  }
  if (!request || typeof request.pubkey !== "string" || !isHex64(request.pubkey) || !zapChecks.requestIsValid(request)) return null;
  const tags = Array.isArray(request.tags) ? (request.tags as unknown[]).filter((tag): tag is string[] => Array.isArray(tag) && tag.every((v) => typeof v === "string")) : [];
  const zapped = tags.find((tag) => tag.length >= 2 && tag[0] === "p")?.[1];
  if (!zapped || !event.tags.some((tag) => tag.length >= 2 && tag[0] === "p" && tag[1] === zapped)) return null;
  const amount = tags.find((tag) => tag[0] === "amount")?.[1];
  const requested = amount && /^\d+$/.test(amount) && Number(amount) > 0 ? Number(amount) : null;
  const bolt11 = event.tags.find((tag) => tag.length >= 2 && tag[0] === "bolt11")?.[1];
  const paid = bolt11 ? bolt11Msats(bolt11) : null;
  if (paid !== null && requested !== null && paid !== requested) return null;
  return { sender: request.pubkey, msats: paid ?? requested, message: typeof request.content === "string" ? request.content.trim() : "" };
}

/** BOLT11 の請求書の金額（ミリサトシ）。 */
export function bolt11Msats(invoice: string): number | null {
  const lower = invoice.trim().toLowerCase().replace(/^lightning:/, "");
  const separator = lower.lastIndexOf("1");
  if (separator <= 0) return null;
  const match = /^ln(?:bcrt|bc|tbs|tb|sb)(\d+)([munp]?)$/.exec(lower.slice(0, separator));
  if (!match) return null;
  const value = BigInt(match[1]);
  const multiplier: Record<string, bigint> = { "": 100_000_000_000n, m: 100_000_000n, u: 100_000n, n: 100n };
  let msats: bigint | null;
  if (match[2] === "p") msats = value % 10n === 0n ? value / 10n : null;
  else msats = value * multiplier[match[2]];
  if (msats === null || msats <= 0n || msats > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(msats);
}

export const sats = (msats: number | null) => (msats === null ? null : Math.floor(msats / 1000));
export const formatSats = (value: number | null) => (value === null ? "金額不明" : `${value.toLocaleString("en-US")} sats`);

export function notificationType(event: Event): NotificationType {
  if (event.kind === 9735) return "zaps";
  if (event.kind === AWARD) return "badges";
  // 技術資料 5.3 のとおり、q タグか本文末尾の note・nevent があれば引用（Android 版のコードは q タグだけを見ている）
  if (event.kind === 1 && quoteCardId(event) !== null) return "quotes";
  if (event.kind === 1 || event.kind === 1111) return "replies";
  if (event.kind === 6 || event.kind === 16) return "reposts";
  return "reactions";
}

/** した人。zap レシートは LNURL サーバーが署名するので、zap リクエストの作者を使う。 */
export const actor = (event: Event) => zapReceipt(event)?.sender ?? event.pubkey;

const lastE = (event: Event) => {
  for (let i = event.tags.length - 1; i >= 0; i--) {
    const tag = event.tags[i];
    if (tag.length >= 2 && tag[0] === "e" && isHex64(tag[1])) return tag[1];
  }
  return null;
};

/**
 * 何についての通知か。kind 1 は q タグか本文末尾の引用、なければ NIP-10 の返信先。kind 1111 は q タグ、なければ
 * 最後の e（記事へのコメントでも ID で取れる）、なければ NIP-22 の親。6・7・16・9735 は最後の e。
 */
export function notificationTarget(event: Event): string | null {
  if (event.kind === 1 || event.kind === 1111) {
    const quoted = event.tags.find((tag) => tag[0] === "q" && /^[0-9a-fA-F]{64}$/.test(tag[1] ?? ""))?.[1]?.toLowerCase();
    if (quoted) return quoted;
    if (event.kind === 1) {
      const trailing = quoteCardId(event);
      if (trailing) return trailing;
    }
    return (event.kind === 1111 ? lastE(event) : null) ?? parent(event);
  }
  return lastE(event);
}

export function eligible(event: Event, me: string): boolean {
  if (!NOTIFICATION_KINDS.includes(event.kind) || event.pubkey === me) return false;
  if (!event.tags.some((tag) => tag.length >= 2 && tag[0] === "p" && tag[1] === me)) return false;
  if (event.kind === 9735) {
    const receipt = zapReceipt(event);
    return !!receipt && receipt.sender !== me;
  }
  // バッジの授与は、授与した人自身のバッジだけ（投稿を指さない）
  if (event.kind === AWARD) return awardedAddresses(event, me).length > 0;
  // 何にも返信せずに自分を名指しした投稿はメンション（それだけで通知になる。Android 版と同じ）
  return event.kind === 1 || notificationTarget(event) !== null;
}

/** 通知に入れるか: 自分宛てか、お知らせに出す人の投稿か（Android 版の Notifications.shown）。 */
export const shownAsNotification = (event: Event, me: string, watches: WatchRule[]) => eligible(event, me) || watchMatch(event, me, watches) !== null;

/** 通知の 1 枚。返信・引用は 1 件ずつ、zap・リアクション・リポストは投稿ごとにまとめる（新しいものは 1 件ずつ）。 */
export interface NotificationGroup {
  key: string;
  events: Event[];
  target: string | null;
  kind: "reply" | "quote" | "action" | "actions" | "badge" | "watch";
  time: number;
}

const newest = (a: Event, b: Event) => b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface GroupOptions {
  type: NotificationType;
  /** フォロー中の人だけにするとき、その一覧。 */
  follows?: Set<string> | null;
  muted?: Set<string>;
  mutedNotes?: Set<string>;
  /** 1 件ずつのカードにする zap・リアクション・リポスト（新しく届いたもの）。 */
  separate?: Set<string>;
  /** 自分宛ての zap レシートを署名してよい人（自分の Lightning アドレスのサーバーの nostrPubkey）。分からなければ null。 */
  zapIssuer?: string | null;
  /** ミュートした言葉・ハッシュタグ（返信・メンション・引用の本文に当てる。Android 版と同じ）。 */
  words?: Pick<MuteRules, "words" | "hashtags">;
  /** 投稿のお知らせに出す人。その人の投稿には「フォロー中」の絞り込みをかけない。 */
  watches?: WatchRule[];
}

export function notificationGroups(events: Iterable<Event>, me: string, options: GroupOptions): NotificationGroup[] {
  const unique = new Map<string, Event>();
  for (const event of events) unique.set(event.id, event);
  // 自分宛てでもある投稿は返信・引用などのまま。そうでないものだけをお知らせの投稿にする
  const watched = new Set<string>();
  const typeOf = (event: Event): NotificationType => (watched.has(event.id) ? "posts" : notificationType(event));
  const rows = [...unique.values()].filter((event) => {
    const who = actor(event);
    const target = notificationTarget(event);
    const own = eligible(event, me);
    const watching = !own && !!options.watches?.length && watchMatch(event, me, options.watches) !== null;
    if (watching) watched.add(event.id);
    return (own || watching) && !options.muted?.has(who) && !(target && options.mutedNotes?.has(target)) &&
      !((event.kind === 1 || event.kind === 1111) && options.words && mutedByWords(event, options.words)) &&
      (event.kind !== 9735 || !options.zapIssuer || event.pubkey === options.zapIssuer) &&
      (!options.follows || watching || options.follows.has(who)) && (options.type === "all" || typeOf(event) === options.type);
  }).sort(newest);
  const result: NotificationGroup[] = [];
  const gathered = new Map<string, Event[]>();
  for (const event of rows) {
    const type = typeOf(event);
    const target = notificationTarget(event);
    if (type === "posts") {
      result.push({ key: `watch:${event.id}`, events: [event], target: null, kind: "watch", time: event.created_at });
    } else if (type === "badges") {
      result.push({ key: `badge:${event.id}`, events: [event], target: null, kind: "badge", time: event.created_at });
    } else if (type === "replies" || type === "quotes") {
      result.push({ key: `${type === "quotes" ? "quote" : "reply"}:${event.id}`, events: [event], target, kind: type === "quotes" ? "quote" : "reply", time: event.created_at });
    } else if (options.separate?.has(event.id)) {
      result.push({ key: `action:${event.id}`, events: [event], target, kind: "action", time: event.created_at });
    } else {
      const key = target ?? "profile";
      gathered.set(key, [...(gathered.get(key) ?? []), event]);
    }
  }
  for (const [key, grouped] of gathered) {
    result.push({ key: `actions:${key}`, events: grouped, target: key === "profile" ? null : key, kind: "actions", time: grouped[0].created_at });
  }
  return result.sort((a, b) => b.time - a.time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export type ActionLine =
  | { type: "zap"; event: Event; receipt: ZapReceipt }
  | { type: "reaction"; content: string; emoji: string | null; actors: string[]; hidden: { actor: string; message: string }[]; tags?: string[][] }
  | { type: "reposts"; actors: string[] };

/** まとめたカードの行: zap（新しい順に 1 件ずつ）、リポスト、絵文字ごとのリアクション。 */
export function actionLines(group: NotificationGroup): ActionLine[] {
  const zaps: ActionLine[] = group.events.flatMap((event) => {
    const receipt = zapReceipt(event);
    return receipt ? [{ type: "zap" as const, event, receipt }] : [];
  });
  const reposts = [...new Set(group.events.filter((event) => notificationType(event) === "reposts").map((event) => event.pubkey))];
  // tags は画像の絵文字のとき、最初のリアクションのタグ（絵文字のパックを探すのに使う）
  const reactions = new Map<string, { content: string; emoji: string | null; actors: string[]; hidden: { actor: string; message: string }[]; tags?: string[][] }>();
  for (const event of group.events.filter((e) => notificationType(e) === "reactions")) {
    // 隠しメッセージ（セクシー餃子）付きは、見える絵文字でまとめる（Android 版と同じ）
    const secret = reactionHidden(event.content.trim());
    const content = (secret ? secret.visible : event.content.trim()) || "+";
    const shortcode = /^:([A-Za-z0-9_-]+):$/.exec(content)?.[1];
    const emoji = shortcode ? emojisOf(event).get(shortcode) ?? null : null;
    const key = `${content}\u0000${emoji ?? ""}`;
    const line = reactions.get(key) ?? { content, emoji, actors: [], hidden: [], ...(emoji ? { tags: event.tags } : {}) };
    if (!line.actors.includes(event.pubkey)) line.actors.push(event.pubkey);
    if (secret) line.hidden.push({ actor: event.pubkey, message: secret.message });
    reactions.set(key, line);
  }
  return [
    ...zaps,
    ...(reposts.length > 0 ? [{ type: "reposts" as const, actors: reposts }] : []),
    ...[...reactions.values()].map((line) => ({ type: "reaction" as const, ...line })),
  ];
}

/** リアクションした先の投稿（最後の e）と、その作者（最後の p）。「あなたのリアクションへのリアクション」で使う。 */
export function reactedTo(reaction: Event): { id: string; author: string | null } | null {
  const id = lastE(reaction);
  if (!id) return null;
  let author: string | null = null;
  for (let i = reaction.tags.length - 1; i >= 0; i--) {
    const tag = reaction.tags[i];
    if (tag.length >= 2 && tag[0] === "p" && isHex64(tag[1])) {
      author = tag[1];
      break;
    }
  }
  return { id, author };
}
