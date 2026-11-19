import { isHex64, type Event } from "../nostr/events";

/**
 * ミュート一覧（kind 10000、NIP-51）が隠すもの。公開のタグと、非公開の分（content を復号したタグ）を合わせて読む
 * （Android 版の MuteList.rules・MuteRules・MutedWords）。言葉（`word`）とハッシュタグ（`t`）は小文字にそろえる。
 */
export interface MuteRules {
  pubkeys: Set<string>;
  events: Set<string>;
  words: Set<string>;
  hashtags: Set<string>;
}

export const NO_MUTES: MuteRules = { pubkeys: new Set(), events: new Set(), words: new Set(), hashtags: new Set() };

export function muteRules(tags: string[][]): MuteRules {
  const hex = (name: string) => new Set(tags.filter((t) => t.length >= 2 && t[0] === name && isHex64(t[1])).map((t) => t[1]));
  const texts = (name: string) => new Set(tags.filter((t) => t.length >= 2 && t[0] === name && t[1].trim() !== "").map((t) => t[1].trim().toLowerCase()));
  return { pubkeys: hex("p"), events: hex("e"), words: texts("word"), hashtags: texts("t") };
}

/** ミュートした言葉を本文に含むか、ミュートしたハッシュタグ（`t`）が付いているか。 */
export function mutedByWords(event: Pick<Event, "content" | "tags">, rules: Pick<MuteRules, "words" | "hashtags">): boolean {
  if (rules.words.size > 0) {
    const lower = event.content.toLowerCase();
    for (const word of rules.words) if (lower.includes(word)) return true;
  }
  return rules.hashtags.size > 0 && event.tags.some((t) => t.length >= 2 && t[0] === "t" && rules.hashtags.has(t[1].toLowerCase()));
}

/** 非公開の分（復号した JSON）からタグを読む。読めなければ空。 */
export function parsePrivateTags(plain: string): string[][] {
  try {
    const parsed = JSON.parse(plain) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string[] => Array.isArray(t) && t.every((v) => typeof v === "string")) : [];
  } catch {
    return [];
  }
}
