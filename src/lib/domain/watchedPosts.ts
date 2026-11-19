import { isHex64, type Event } from "../nostr/events";
import { mediaOf, segments } from "./content";
import { normalize } from "./mentions";
import { parent } from "./threads";

/**
 * 投稿のお知らせ（Android 版の WatchedPosts）。選んだ人の新しい投稿を通知の「投稿」に出す。だれを選んだかは
 * ブラウザの中だけに保存し、リレーには送らない。
 */

export type WatchMode = "all" | "links" | "words";
export const WATCH_MODES: { mode: WatchMode; label: string }[] = [
  { mode: "all", label: "すべての投稿" },
  { mode: "links", label: "リンクを含む投稿" },
  { mode: "words", label: "言葉を含む投稿" },
];

export interface WatchRule {
  pubkey: string;
  mode: WatchMode;
  words: string[];
  replies: boolean;
  /** 選んだ時刻（秒）。これより前の投稿は出さない。 */
  since: number;
}

export const MAX_PEOPLE = 50;
export const MAX_WORDS = 5;
export const MAX_WORD_LENGTH = 50;
/** 選んだ人について読む種類（投稿だけ）。 */
export const WATCH_KINDS = [1];

/** 何を出すかの 1 行（一覧とプロフィール）。 */
export function watchSummary(rule: WatchRule): string {
  const base = rule.mode === "words" ? `「${rule.words.join("」「")}」を含む投稿` : WATCH_MODES.find((m) => m.mode === rule.mode)!.label;
  return base + (rule.replies ? "（返信も）" : "");
}

/** 入力欄の言葉。カンマ・読点・空白・改行で区切り、重なりを除いて 5 つまで。 */
export function watchWords(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input.split(/[,、，\s]+/)) {
    const word = raw.trim().slice(0, MAX_WORD_LENGTH);
    if (!word || seen.has(normalize(word))) continue;
    seen.add(normalize(word));
    result.push(word);
    if (result.length >= MAX_WORDS) break;
  }
  return result;
}

/** event が当てはまるルール。自分の投稿は数えない。 */
export function watchMatch(event: Event, me: string, rules: WatchRule[]): WatchRule | null {
  if (!WATCH_KINDS.includes(event.kind) || event.pubkey === me) return null;
  const rule = rules.find((r) => r.pubkey === event.pubkey);
  if (!rule || event.created_at < rule.since) return null;
  if (!rule.replies && parent(event) !== null) return null;
  if (rule.mode === "links") {
    const media = new Set(mediaOf(event).map((m) => m.url));
    return segments(event.content, new Map()).some((s) => s.type === "link" && !media.has(s.url)) ? rule : null;
  }
  if (rule.mode === "words") {
    const text = normalize(event.content);
    const hashtags = event.tags.filter((t) => t.length >= 2 && t[0] === "t").map((t) => normalize(t[1]));
    const words = rule.words.map(normalize).filter((w) => w.length > 0);
    return words.some((w) => text.includes(w) || hashtags.includes(w.replace(/^#/, ""))) ? rule : null;
  }
  return rule;
}

/** いちばん早く選んだ時刻。ルールがなければ null。 */
export const watchSince = (rules: WatchRule[]) => (rules.length === 0 ? null : Math.min(...rules.map((r) => r.since)));

/** 保存した形を読む。壊れた項目は除く。 */
export function decodeWatches(raw: string | null): WatchRule[] {
  try {
    const list = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(list)) return [];
    const result: WatchRule[] = [];
    for (const item of list as Record<string, unknown>[]) {
      if (!item || typeof item.pubkey !== "string" || !isHex64(item.pubkey) || typeof item.since !== "number") continue;
      if (result.some((r) => r.pubkey === item.pubkey)) continue;
      const mode = WATCH_MODES.some((m) => m.mode === item.mode) ? (item.mode as WatchMode) : "links";
      const words = Array.isArray(item.words) ? (item.words as unknown[]).filter((w): w is string => typeof w === "string").slice(0, MAX_WORDS) : [];
      result.push({ pubkey: item.pubkey, mode, words, replies: item.replies === true, since: item.since });
    }
    return result.slice(0, MAX_PEOPLE);
  } catch {
    return [];
  }
}

/** rule を足す・置き換える。前からいる人は最初の since を残す（条件を変えても、出ていた投稿が消えないように）。 */
export function putWatch(rules: WatchRule[], rule: WatchRule): WatchRule[] {
  const old = rules.find((r) => r.pubkey === rule.pubkey);
  if (!old && rules.length >= MAX_PEOPLE) throw new Error(`お知らせに出せるのは${MAX_PEOPLE}人までです`);
  if (rule.mode === "words" && rule.words.length === 0) throw new Error("言葉を入力してください");
  const kept = { ...rule, since: old?.since ?? rule.since };
  return old ? rules.map((r) => (r.pubkey === rule.pubkey ? kept : r)) : [...rules, kept];
}
