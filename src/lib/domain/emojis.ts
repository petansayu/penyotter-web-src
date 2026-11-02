import { reactionHidden } from "./hiddenMessages";
import { isHex64, newer, type Event } from "../nostr/events";

/** リアクションの絵文字（Android 版の EmojiPalette・EmojiCatalogParser・CustomEmoji）。 */

/** 標準の絵文字のパレット（Android 版と同じ 36 個と並び）。 */
export const PALETTE: { text: string; label: string }[] = [
  ["😊", "笑顔"], ["😄", "にっこり"], ["😂", "笑い泣き"], ["🥰", "大好き"], ["😍", "ハートの目"], ["😎", "サングラス"],
  ["🤔", "考え中"], ["🥺", "お願い"], ["😭", "大泣き"], ["😴", "眠い"], ["🙌", "ばんざい"], ["👏", "拍手"],
  ["👍", "いいね"], ["🙏", "ありがとう"], ["👋", "手を振る"], ["💪", "がんばる"], ["❤️", "ハート"], ["💕", "ふたつのハート"],
  ["✨", "きらきら"], ["🎉", "お祝い"], ["🔥", "炎"], ["💯", "百点"], ["☀️", "晴れ"], ["🌙", "月"],
  ["🌸", "桜"], ["🌱", "芽"], ["☕", "コーヒー"], ["🍵", "お茶"], ["🍰", "ケーキ"], ["🍻", "乾杯"],
  ["🐱", "ねこ"], ["🐶", "いぬ"], ["🐰", "うさぎ"], ["🐾", "足あと"], ["📷", "カメラ"], ["🎵", "音符"],
].map(([text, label]) => ({ text, label }));

/** set はその絵文字が入っている絵文字セットのアドレス（30030:公開鍵:識別子）。セットから来たものだけ。 */
export interface CustomEmoji { shortcode: string; url: string; set?: string }

/** 絵文字セットのアドレス（30030:公開鍵:識別子）を読む。読めなければ null。 */
export function parseSetAddress(value: string | undefined): { author: string; identifier: string } | null {
  const [kind, author, ...rest] = (value ?? "").trim().split(":");
  const identifier = rest.join(":");
  if (kind !== "30030" || !isHex64(author) || !identifier || identifier.length > 256) return null;
  return { author, identifier };
}

/**
 * 送るときの emoji タグ。セットから来た絵文字は、4 つめにそのセットのアドレスを付ける（NIP-30。見た人がパックを
 * 探せるように。Android 版の CustomEmoji.tag）。
 */
export function emojiTag(emoji: CustomEmoji): string[] {
  return ["emoji", emoji.shortcode, emoji.url, ...(parseSetAddress(emoji.set) ? [emoji.set!.trim()] : [])];
}

/** カスタム絵文字の上限（Android 版の CustomEmoji.MAX_CATALOG）。 */
export const MAX_CATALOG = 3000;

function valid(shortcode: string, url: string): boolean {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(shortcode) || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** タグの emoji（NIP-30）。 */
export function emojiTags(tags: string[][]): CustomEmoji[] {
  return tags.filter((t) => t.length >= 3 && t[0].toLowerCase() === "emoji")
    .map((t) => ({ shortcode: t[1].trim().replace(/^:|:$/g, ""), url: t[2].trim() }))
    .filter((e) => valid(e.shortcode, e.url));
}

/** kind 10030 が指す絵文字セット（`a` タグの 30030:作者:d、300 件まで）。 */
export function setReferences(list: Event): { author: string; identifier: string }[] {
  if (list.kind !== 10030) return [];
  const result: { author: string; identifier: string }[] = [];
  for (const tag of list.tags) {
    if (tag[0] !== "a" || tag.length < 2) continue;
    const address = parseSetAddress(tag[1]);
    if (!address) continue;
    const { author, identifier } = address;
    if (!result.some((r) => r.author === author && r.identifier === identifier)) result.push({ author, identifier });
    if (result.length >= 300) break;
  }
  return result;
}

/** kind 10030 と絵文字セットから、使える絵文字の一覧を作る（直接のもの → セットの順。名前と URL が同じものは 1 つ）。 */
export function resolveCatalog(list: Event, sets: Event[]): CustomEmoji[] {
  const latest = new Map<string, Event>();
  for (const set of sets) {
    if (set.kind !== 30030) continue;
    const d = set.tags.find((t) => t[0] === "d")?.[1];
    if (d === undefined) continue;
    const key = `${set.pubkey}:${d}`;
    if (newer(set, latest.get(key))) latest.set(key, set);
  }
  const all = [...emojiTags(list.tags), ...setReferences(list).flatMap((ref) =>
    emojiTags(latest.get(`${ref.author}:${ref.identifier}`)?.tags ?? []).map((e) => ({ ...e, set: `30030:${ref.author}:${ref.identifier}` })))];
  const seen = new Set<string>();
  return all.filter((e) => {
    const key = `${e.shortcode}\u0000${e.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_CATALOG);
}

/**
 * リアクションの見せ方: 「+」と空はいいね（ハート）、`:名前:` は emoji タグの画像、ほかはその文字。隠しメッセージ
 * （セクシー餃子）が付いていれば、見える絵文字で決めて hidden にメッセージを入れる。
 */
export function reactionDisplay(reaction: Event): ({ type: "like" } | { type: "image"; url: string; shortcode: string } | { type: "text"; text: string }) & { hidden?: string } {
  const secret = reactionHidden(reaction.content.trim());
  const content = secret ? secret.visible : reaction.content.trim();
  const extra = secret ? { hidden: secret.message } : {};
  if (!content || content === "+") return { type: "like", ...extra };
  const code = /^:([A-Za-z0-9_-]+):$/.exec(content)?.[1];
  const image = code ? emojiTags(reaction.tags).find((e) => e.shortcode === code) : undefined;
  if (image) return { type: "image", url: image.url, shortcode: image.shortcode, ...extra };
  return { type: "text", text: content.slice(0, 32), ...extra };
}
