import type { Event } from "../nostr/events";
import { talk, words } from "./topics";

/**
 * たぶんこの流れ（Android 版の ProbableFlow）。返信を付けずに話す（エアリプ）タイムラインで、選んだ投稿と同じ話題の
 * 投稿を推定する。つなぐのは、同じ言葉（珍しい言葉ほど強く）・時間の近さ・選んだ投稿の人との交互の投稿・返信や
 * 引用やメンション。選んだ投稿から、つながる投稿を足し、言葉でつながった投稿からもう一度広げる（回ごとに少し厳しく）。
 */

/** 前後に読む長さ。 */
export const WINDOW = 30 * 60;
/** この秒数のうちに相手の投稿のすぐ後に投稿したら、受け答えとみなす。 */
const TURN = 180;
/** 受け答えを数える範囲（選んだ投稿の前後）。 */
const TALK = 10 * 60;
const ROUNDS = 3;

export type Breadth = "wide" | "normal" | "narrow";
export const BREADTHS: { value: Breadth; label: string; threshold: number }[] = [
  { value: "wide", label: "広く", threshold: 0.12 },
  { value: "normal", label: "ふつう", threshold: 0.22 },
  { value: "narrow", label: "絞る", threshold: 0.4 },
];

/** 流れの 1 件と、つながった理由の言葉（選んだ投稿や、返信・受け答えでつながったものは空）。 */
export interface Linked { event: Event; words: string[]; seed: boolean }

export function related(seed: Event, candidates: Event[], breadth: Breadth = "normal", of: (e: Event) => Set<string> = words.of): Linked[] {
  const threshold = BREADTHS.find((b) => b.value === breadth)!.threshold;
  const seen = new Set([seed.id]);
  const pool = [seed, ...candidates.filter((e) => talk(e) && Math.abs(e.created_at - seed.created_at) <= WINDOW && !seen.has(e.id) && seen.add(e.id))];
  const bag = new Map(pool.map((e) => [e.id, of(e)]));
  const df = new Map<string, number>();
  for (const set of bag.values()) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const n = pool.length;
  const idf = (w: string) => Math.log((n + 1) / (df.get(w) ?? 1));
  const mass = new Map([...bag].map(([id, set]) => [id, [...set].reduce((sum, w) => sum + idf(w), 0)]));
  // 受け答えは選んだ投稿の近くだけで数える（混んだタイムラインを 1 時間見れば、だれでもだれかの後に投稿している）
  const talking = turns(pool.filter((e) => Math.abs(e.created_at - seed.created_at) <= TALK));

  const shared = (a: Event, b: Event) => [...bag.get(a.id)!].filter((w) => bag.get(b.id)!.has(w));
  const similarity = (a: Event, b: Event) => {
    const common = shared(a, b);
    if (common.length === 0) return 0;
    const denominator = Math.sqrt(mass.get(a.id)! * mass.get(b.id)!);
    return denominator === 0 ? 0 : common.reduce((sum, w) => sum + idf(w), 0) / denominator;
  };
  const link = (c: Event, m: Event) => {
    const gap = Math.abs(c.created_at - m.created_at);
    const near = Math.exp(-gap / 900);
    let score = similarity(c, m) * near;
    if (refers(c, m, gap) || refers(m, c, gap)) score = Math.max(score, 1);
    // 言葉のない受け答えは、選んだ投稿の人のまわりでだけ拾う（人から人へ広がらないように）
    const withAuthor = c.pubkey === seed.pubkey || m.pubkey === seed.pubkey;
    if (withAuthor && c.pubkey !== m.pubkey && gap <= 300 && talking(c.pubkey, m.pubkey)) score += 0.35 * near;
    if (c.pubkey === seed.pubkey && m.pubkey === seed.pubkey && gap <= 300) score += 0.15;
    return score;
  };

  // 広げる起点になるのは、選んだ投稿と、言葉でつながった投稿だけ
  const members = new Map<string, Linked>([[seed.id, { event: seed, words: [], seed: true }]]);
  const anchors: Event[] = [seed];
  for (let round = 0; round < ROUNDS; round++) {
    const bar = threshold * (1 + 0.5 * round);
    const added: Linked[] = [];
    for (const c of pool) {
      if (members.has(c.id)) continue;
      let best: [Event, number] | null = null;
      for (const m of anchors) {
        const score = link(c, m);
        if (!best || score > best[1]) best = [m, score];
      }
      if (best && best[1] >= bar) added.push({ event: c, words: shared(c, best[0]).sort((a, b) => idf(b) - idf(a)).slice(0, 3), seed: false });
    }
    if (added.length === 0) break;
    for (const linked of added) members.set(linked.event.id, linked);
    anchors.push(...added.filter((l) => l.words.length > 0).map((l) => l.event));
  }
  return [...members.values()].sort((a, b) => a.event.created_at - b.event.created_at || (a.event.id < b.event.id ? -1 : 1));
}

/** a が b に返信・引用している、または b の人にメンションしている（gap 秒の差のうち。離れると別の話のことがある）。 */
function refers(a: Event, b: Event, gap: number) {
  return a.tags.some((t) => t.length >= 2 && (((t[0] === "e" || t[0] === "q") && t[1] === b.id && gap <= 900) || (t[0] === "p" && t[1] === b.pubkey && a.pubkey !== b.pubkey && gap <= 600)));
}

/** 2 人が受け答えしているか。相手の投稿のすぐ後（TURN 秒のうち）の投稿が、両方向あわせて 3 回以上。 */
function turns(pool: Event[]): (a: string, b: string) => boolean {
  const sorted = [...pool].sort((a, b) => a.created_at - b.created_at);
  const count = new Map<string, number>();
  sorted.forEach((post, i) => {
    let j = i - 1;
    while (j >= 0 && sorted[j].pubkey === post.pubkey) j--;
    if (j < 0 || post.created_at - sorted[j].created_at > TURN) return;
    const key = `${sorted[j].pubkey}>${post.pubkey}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  });
  return (a, b) => {
    const ab = count.get(`${a}>${b}`) ?? 0;
    const ba = count.get(`${b}>${a}`) ?? 0;
    return ab >= 1 && ba >= 1 && ab + ba >= 3;
  };
}
