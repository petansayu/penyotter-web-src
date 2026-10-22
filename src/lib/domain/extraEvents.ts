import { isHex64, type Event } from "../nostr/events";
import type { EventTemplate } from "nostr-tools";

/**
 * 投稿以外に作るイベント（技術資料 6.11・6.12、Android 版の StatusPosts・Polls・Vanish と通報）。
 */

// ステータス（NIP-38、kind 30315）

export const STATUS_TYPES = ["general", "music"] as const;
export type StatusType = (typeof STATUS_TYPES)[number];

const statusType = (event: Event) => event.tags.find((t) => t[0] === "d")?.[1];

/** その種類の、自分のいちばん新しいステータス。 */
export function newestStatus(events: Iterable<Event>, me: string, type: StatusType): Event | undefined {
  return [...events]
    .filter((e) => e.kind === 30315 && e.pubkey === me && statusType(e) === type)
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
}

/** 前の版のタグ（d・emoji・expiration を除く）を残して書き換える。空の content で消す。 */
export function buildStatus(me: string, type: StatusType, base: Event | undefined, content: string, emojis: { shortcode: string; url: string }[], now: number): EventTemplate {
  if (!isHex64(me)) throw new Error("公開鍵の形が正しくありません");
  if (content.length > 500) throw new Error("ステータスは500文字以内で入力してください");
  if (base && base.created_at >= now + 60) throw new Error("ステータスの時刻が未来になっています。しばらく待って再試行してください");
  const tags = (base?.tags ?? []).filter((t) => !["d", "emoji", "expiration"].includes(t[0])).map((t) => [...t]);
  tags.unshift(["d", type]);
  const used = new Set([...content.matchAll(/:([A-Za-z0-9_-]+):/g)].map((m) => m[1]));
  for (const emoji of emojis) {
    if (used.has(emoji.shortcode) && !tags.some((t) => t[0] === "emoji" && t[1] === emoji.shortcode)) tags.push(["emoji", emoji.shortcode, emoji.url]);
  }
  return { kind: 30315, created_at: Math.max(now, (base?.created_at ?? -1) + 1), tags, content };
}

// 投票（NIP-88）

export interface Poll { id: string; question: string; options: [string, string][]; relays: string[]; multiple: boolean; endsAt?: number }
export interface PollTally { votes: Map<string, number>; voters: number; mine: Set<string> }

export function parsePoll(event: Event): Poll | null {
  if (event.kind !== 1068) return null;
  const options: [string, string][] = [];
  for (const t of event.tags) {
    if (t.length >= 3 && t[0] === "option" && /^[A-Za-z0-9_-]{1,64}$/.test(t[1]) && !options.some((o) => o[0] === t[1]) && options.length < 50) options.push([t[1], t[2].slice(0, 200)]);
  }
  if (options.length < 2) return null;
  const relays = [...new Set(event.tags.filter((t) => t[0] === "relay" && /^wss?:\/\//.test(t[1] ?? "")).map((t) => t[1]))].slice(0, 10);
  const ends = Number(event.tags.find((t) => t[0] === "endsAt")?.[1]);
  return {
    id: event.id, question: event.content.slice(0, 2000), options, relays,
    multiple: event.tags.find((t) => t[0] === "polltype")?.[1] === "multiplechoice",
    endsAt: Number.isFinite(ends) && ends > 0 ? ends : undefined,
  };
}

/** 1 人 1 票（締め切り前のいちばん新しい答え）。単一選択は最初の response だけ。 */
export function tallyPoll(poll: Poll, responses: Iterable<Event>, voter?: string | null): PollTally {
  const valid = new Set(poll.options.map((o) => o[0]));
  const latestBy = new Map<string, Event>();
  for (const event of responses) {
    if (event.kind !== 1018 || !event.tags.some((t) => t[0] === "e" && t[1] === poll.id)) continue;
    if (poll.endsAt !== undefined && event.created_at > poll.endsAt) continue;
    const known = latestBy.get(event.pubkey);
    if (!known || event.created_at > known.created_at || (event.created_at === known.created_at && event.id < known.id)) latestBy.set(event.pubkey, event);
  }
  const choices = new Map<string, Set<string>>();
  for (const [author, event] of latestBy) {
    const picked = event.tags.filter((t) => t[0] === "response" && valid.has(t[1])).map((t) => t[1]);
    const chosen = new Set(poll.multiple ? picked : picked.slice(0, 1));
    if (chosen.size > 0) choices.set(author, chosen);
  }
  const votes = new Map(poll.options.map(([id]) => [id, [...choices.values()].filter((c) => c.has(id)).length]));
  return { votes, voters: choices.size, mine: (voter && choices.get(voter)) || new Set() };
}

export function buildVote(poll: Poll, choices: Set<string>, now: number): EventTemplate {
  const picked = poll.options.map((o) => o[0]).filter((id) => choices.has(id));
  const chosen = poll.multiple ? picked : picked.slice(0, 1);
  if (chosen.length === 0) throw new Error("選択肢を選んでください");
  return { kind: 1018, created_at: now, tags: [["e", poll.id], ...chosen.map((id) => ["response", id])], content: "" };
}

// 通報（NIP-56、kind 1984）

export const REPORT_TYPES: { value: string; label: string }[] = [
  { value: "spam", label: "スパム" },
  { value: "impersonation", label: "なりすまし" },
  { value: "nudity", label: "性的な内容" },
  { value: "profanity", label: "暴言・ヘイト" },
  { value: "illegal", label: "違法な内容" },
  { value: "malware", label: "マルウェア" },
  { value: "other", label: "そのほか" },
];

/** 投稿の通報は e と p、人の通報は p に種類を付ける。理由は 1,000 文字まで。 */
export function buildReport(target: { note?: Event; pubkey: string }, type: string, reason: string, now: number): EventTemplate {
  if (!REPORT_TYPES.some((t) => t.value === type)) throw new Error("通報の種類を選んでください");
  if (!isHex64(target.pubkey)) throw new Error("公開鍵の形が正しくありません");
  const tags = target.note ? [["e", target.note.id, type], ["p", target.pubkey]] : [["p", target.pubkey, type]];
  return { kind: 1984, created_at: now, tags, content: reason.trim().slice(0, 1000) };
}

// 消去の依頼（NIP-62、kind 62）

export const ALL_RELAYS = "ALL_RELAYS";

/** relays が null なら、すべてのリレーに頼む（ALL_RELAYS）。 */
export function buildVanish(relays: string[] | null, reason: string, now: number): EventTemplate {
  const targets = relays ? [...new Set(relays.filter((url) => /^wss?:\/\//.test(url)))] : null;
  if (targets && targets.length === 0) throw new Error("消去を頼むリレーがありません");
  return { kind: 62, created_at: now, tags: targets ? targets.map((url) => ["relay", url]) : [["relay", ALL_RELAYS]], content: reason.trim().slice(0, 1000) };
}
