import { isHex64, type Event } from "../nostr/events";
import { emojisOf, quoteCardId } from "./content";
import { parent } from "./threads";

/** 通知（Android 版の Notifications・Zaps・NotificationsPanel、技術資料 5.3）。 */

export type NotificationType = "all" | "replies" | "reactions" | "reposts" | "zaps" | "quotes";
export const NOTIFICATION_TYPES: { type: NotificationType; label: string }[] = [
  { type: "all", label: "すべて" },
  { type: "replies", label: "リプライ" },
  { type: "reactions", label: "リアクション" },
  { type: "reposts", label: "リポスト" },
  { type: "zaps", label: "zap" },
  { type: "quotes", label: "引用" },
];

export const NOTIFICATION_KINDS = [1, 6, 7, 16, 1111, 9735];
/** 通知の対象として使わない種類（プロフィール・フォロー一覧・削除）。リアクション（7）は「あなたのリアクション」として使う。 */
export const NOT_TARGETS = [0, 3, 5];

export interface ZapReceipt { sender: string; msats: number | null; message: string }

const receipts = new Map<string, ZapReceipt | null>();

/**
 * zap レシートから送った人・金額・メッセージを読む。送った人は中の zap リクエスト（description）の作者、なければ
 * `P` タグ。金額は bolt11 の請求書、なければリクエストの amount。LNURL サーバーの署名は確かめていない（11 章）。
 */
export function zapReceipt(event: Event): ZapReceipt | null {
  if (event.kind !== 9735) return null;
  if (receipts.has(event.id)) return receipts.get(event.id)!;
  let request: { pubkey?: unknown; tags?: unknown; content?: unknown } | null = null;
  try {
    const description = event.tags.find((tag) => tag.length >= 2 && tag[0] === "description")?.[1];
    if (description) request = JSON.parse(description);
  } catch {
    request = null;
  }
  const fromRequest = typeof request?.pubkey === "string" && isHex64(request.pubkey) ? request.pubkey : null;
  const fromTag = event.tags.find((tag) => tag.length >= 2 && tag[0] === "P" && isHex64(tag[1]))?.[1] ?? null;
  const sender = fromRequest ?? fromTag;
  let result: ZapReceipt | null = null;
  if (sender) {
    const amount = Array.isArray(request?.tags)
      ? (request.tags as unknown[]).find((tag): tag is string[] => Array.isArray(tag) && tag[0] === "amount" && typeof tag[1] === "string")?.[1]
      : undefined;
    const requested = amount && /^\d+$/.test(amount) && Number(amount) > 0 ? Number(amount) : null;
    const bolt11 = event.tags.find((tag) => tag.length >= 2 && tag[0] === "bolt11")?.[1];
    const paid = bolt11 ? bolt11Msats(bolt11) : null;
    result = { sender, msats: paid ?? requested, message: typeof request?.content === "string" ? request.content.trim() : "" };
  }
  if (receipts.size > 2000) receipts.clear();
  receipts.set(event.id, result);
  return result;
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
  return notificationTarget(event) !== null;
}

/** 通知の 1 枚。返信・引用は 1 件ずつ、zap・リアクション・リポストは投稿ごとにまとめる（新しいものは 1 件ずつ）。 */
export interface NotificationGroup {
  key: string;
  events: Event[];
  target: string | null;
  kind: "reply" | "quote" | "action" | "actions";
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
}

export function notificationGroups(events: Iterable<Event>, me: string, options: GroupOptions): NotificationGroup[] {
  const unique = new Map<string, Event>();
  for (const event of events) unique.set(event.id, event);
  const rows = [...unique.values()].filter((event) => {
    const who = actor(event);
    const target = notificationTarget(event);
    return eligible(event, me) && !options.muted?.has(who) && !(target && options.mutedNotes?.has(target)) &&
      (!options.follows || options.follows.has(who)) && (options.type === "all" || notificationType(event) === options.type);
  }).sort(newest);
  const result: NotificationGroup[] = [];
  const gathered = new Map<string, Event[]>();
  for (const event of rows) {
    const type = notificationType(event);
    const target = notificationTarget(event);
    if (type === "replies" || type === "quotes") {
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
  | { type: "reaction"; content: string; emoji: string | null; actors: string[] }
  | { type: "reposts"; actors: string[] };

/** まとめたカードの行: zap（新しい順に 1 件ずつ）、リポスト、絵文字ごとのリアクション。 */
export function actionLines(group: NotificationGroup): ActionLine[] {
  const zaps: ActionLine[] = group.events.flatMap((event) => {
    const receipt = zapReceipt(event);
    return receipt ? [{ type: "zap" as const, event, receipt }] : [];
  });
  const reposts = [...new Set(group.events.filter((event) => notificationType(event) === "reposts").map((event) => event.pubkey))];
  const reactions = new Map<string, { content: string; emoji: string | null; actors: string[] }>();
  for (const event of group.events.filter((e) => notificationType(e) === "reactions")) {
    const content = event.content.trim() || "+";
    const shortcode = /^:([A-Za-z0-9_-]+):$/.exec(content)?.[1];
    const emoji = shortcode ? emojisOf(event).get(shortcode) ?? null : null;
    const key = `${content}\u0000${emoji ?? ""}`;
    const line = reactions.get(key) ?? { content, emoji, actors: [] };
    if (!line.actors.includes(event.pubkey)) line.actors.push(event.pubkey);
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
