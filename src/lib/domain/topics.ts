import type { Event } from "../nostr/events";

/**
 * 投稿の言葉（Android 版の Words・Topics・ProbableFlow）。いまの話題・直前の流れ・たぶんこの流れに使う。
 * 言葉の区切りはブラウザの Intl.Segmenter（日本語の辞書を持つ）。ない環境では文字の種類の切れ目で区切る。
 * 投稿をどこにも送らない。
 */

const LINK = /(https?:\/\/|nostr:)\S+/g;
const SHORTCODE = /:[A-Za-z0-9_+-]{2,}:/g;
const LAUGH = /^[wｗ草笑]+$/;
const HIRAGANA = /^[ぁ-ゟー]+$/;
const ASCII = /^[\x20-\x7E]+$/;
const LETTER = /\p{L}/u;
const STOP = new Set(["自分", "今日", "明日", "昨日", "本当", "感じ", "時間", "一番", "普通", "意味", "最近", "今回", "大丈夫",
  "the", "and", "for", "you", "this", "that", "with", "are", "but", "not", "have", "was", "just", "were", "made", "from", "they",
  "what", "when", "will", "your", "about", "been", "more", "some", "there", "their", "would", "could", "into", "than", "then",
  "them", "like", "only", "also", "over", "after", "before", "very", "here", "these", "those", "which", "while", "can", "all",
  "has", "had", "its", "our", "out", "who", "how", "now", "new", "one", "get", "got", "did", "does", "don't", "it's", "i'm"]);

export type Segment = (text: string) => string[];

/** 文字の種類（漢字・カタカナ・ひらがな・英数字）の切れ目で区切る。辞書がないときの区切り方。 */
export function scriptRuns(text: string): string[] {
  const words: string[] = [];
  let current = "";
  let kind = -1;
  for (const ch of text) {
    const k = /\p{Script=Han}/u.test(ch) ? 0 : /\p{Script=Katakana}|ー/u.test(ch) ? 1 : /\p{Script=Hiragana}/u.test(ch) ? 2 : /[\p{L}\p{N}_]/u.test(ch) ? 3 : -1;
    if (k !== kind || k === -1) {
      if (current) words.push(current);
      current = "";
    }
    if (k !== -1) current += ch;
    kind = k;
  }
  if (current) words.push(current);
  return words;
}

let segmenter: Intl.Segmenter | null | undefined;
/** ブラウザの辞書で区切る（言葉らしいものだけ）。Intl.Segmenter がなければ scriptRuns。 */
export const dictionarySegment: Segment = (text) => {
  if (segmenter === undefined) segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("ja", { granularity: "word" }) : null;
  if (!segmenter) return scriptRuns(text);
  return [...segmenter.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment);
};

/** 漢字やカタカナの言葉の送りがなを落とす（取り戻す・取り戻した → 取り戻）。漢字 1 文字になると短すぎて数えない。 */
export function stem(word: string): string {
  if (HIRAGANA.test(word)) return word;
  return word.replace(/[ぁ-ゟ]+$/, "");
}

export function keep(word: string): boolean {
  const length = [...word].length;
  if (length < 2 || STOP.has(word) || LAUGH.test(word)) return false;
  if (!LETTER.test(word)) return false;
  if (HIRAGANA.test(word) && length <= 3) return false;
  if (ASCII.test(word) && length < 3) return false;
  return true;
}

/** 投稿の言葉。リンク・数字・笑い・短いひらがなを除き、カスタム絵文字（:name:）は言葉として数える。 */
export function wordsOf(text: string, segment: Segment = dictionarySegment): Set<string> {
  const cleaned = text.replace(LINK, " ");
  const emoji = cleaned.match(SHORTCODE) ?? [];
  const plain = cleaned.replace(SHORTCODE, " ").normalize("NFKC").toLowerCase();
  return new Set([...emoji, ...segment(plain).map((w) => stem(w.replace(/^[#\s]+|[#\s]+$/g, ""))).filter(keep)]);
}

/** 投稿ごとの言葉を覚えておく（区切るのは軽くないので）。 */
export class WordCache {
  private readonly cache = new Map<string, Set<string>>();
  constructor(private readonly segment: Segment = dictionarySegment, private readonly size = 6000) {}
  of = (event: Event): Set<string> => {
    let found = this.cache.get(event.id);
    if (!found) {
      found = wordsOf(event.content, this.segment);
      this.cache.set(event.id, found);
      if (this.cache.size > this.size) this.cache.delete(this.cache.keys().next().value!);
    }
    return found;
  };
}

export const words = new WordCache();

/** 話題の言葉。people はその時間に使った人数、score はふだんよりどれだけ多いか。 */
export interface Topic { word: string; people: number; score: number }

/** これより少ない人数は、その人のひとりごと。 */
export const MIN_PEOPLE = 3;
export const WINDOWS: [number, string][] = [[30 * 60, "30分"], [60 * 60, "1時間"], [3 * 60 * 60, "3時間"]];
/** ふだんの量を測る長さ。 */
const BASELINE = 24 * 60 * 60;

/** 人が書いた短い投稿（記事や画像の投稿は除く）。 */
export const talk = (event: Event) => event.kind === 1;

/**
 * 直近 window 秒で増えた言葉。人数で数え（1 人の連投は 1 人）、前の 1 日の同じ長さの区切りでの平均と比べる
 * （あいさつのように毎日出る言葉は上がらない）。
 */
export function currentTopics(events: Event[], now: number, window: number, of: (e: Event) => Set<string> = words.of, minPeople = MIN_PEOPLE, limit = 12): Topic[] {
  const start = now - window;
  const recent = new Map<string, Set<string>>();
  const usual = new Map<string, Set<string>>();
  let oldest = start;
  for (const event of events) {
    if (!talk(event)) continue;
    const time = event.created_at;
    if (time >= start && time <= now) {
      for (const word of of(event)) (recent.get(word) ?? recent.set(word, new Set()).get(word)!).add(event.pubkey);
    } else if (time >= start - BASELINE && time < start) {
      oldest = Math.min(oldest, time);
      const slice = Math.floor((start - time - 1) / window);
      for (const word of of(event)) (usual.get(word) ?? usual.set(word, new Set()).get(word)!).add(`${slice}:${event.pubkey}`);
    }
  }
  const slices = Math.max(1, Math.ceil((start - oldest) / window));
  const topics: Topic[] = [];
  for (const [word, people] of recent) {
    if (people.size < minPeople) continue;
    const expected = (usual.get(word)?.size ?? 0) / slices;
    const score = (people.size - expected) / Math.sqrt(expected + 1);
    if (score > 0) topics.push({ word, people: people.size, score });
  }
  return topics.sort((a, b) => b.score - a.score || b.people - a.people || (a.word < b.word ? -1 : 1)).slice(0, limit);
}

/** その言葉を使った投稿（古い順）。 */
export function matching(events: Event[], word: string, since: number, until: number, of: (e: Event) => Set<string> = words.of): Event[] {
  return events.filter((e) => talk(e) && e.created_at >= since && e.created_at <= until && of(e).has(word))
    .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
}

/** 直前の window 秒の流れ（話している人・話題の言葉・言葉の多い投稿・勢い）。 */
export interface Summary { people: [string, number][]; topics: Topic[]; highlights: Event[]; count: number; before: number }

export function summarize(events: Event[], now: number, window: number, of: (e: Event) => Set<string> = words.of): Summary {
  const recent = events.filter((e) => talk(e) && e.created_at >= now - window && e.created_at <= now);
  const before = events.filter((e) => talk(e) && e.created_at >= now - 2 * window && e.created_at < now - window).length;
  const topics = currentTopics(events, now, window, of, 2, 8);
  const weight = new Map(topics.map((t) => [t.word, t.score]));
  const counts = new Map<string, number>();
  for (const e of recent) counts.set(e.pubkey, (counts.get(e.pubkey) ?? 0) + 1);
  const people = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const highlights = recent.map((e) => [e, [...of(e)].reduce((sum, w) => sum + (weight.get(w) ?? 0), 0)] as const)
    .filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1] || b[0].created_at - a[0].created_at).slice(0, 3).map(([e]) => e);
  return { people, topics, highlights, count: recent.length, before };
}
