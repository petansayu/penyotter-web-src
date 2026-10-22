/**
 * 絵文字ピッカーの絵文字（Unicode のすべての絵文字。データは emojibase-data の日本語版、MIT License）。Android 版の
 * androidx の EmojiPickerView と同じく、種類ごとに分けて、名前で探せるようにする。最近使ったものを先に出す。
 */

export interface EmojiEntry {
  unicode: string;
  label: string;
  group?: number;
  order?: number;
  tags?: string[];
}

/** 種類（emojibase のグループ番号）と、画面に出す名前。2（肌の色などの部品）は出さない。 */
export const EMOJI_GROUPS: { id: number; label: string }[] = [
  { id: 0, label: "顔と感情" },
  { id: 1, label: "人と体" },
  { id: 3, label: "動物と自然" },
  { id: 4, label: "食べ物" },
  { id: 5, label: "旅行と場所" },
  { id: 6, label: "活動" },
  { id: 7, label: "物" },
  { id: 8, label: "記号" },
  { id: 9, label: "旗" },
];

/** 最近使った絵文字の数。 */
export const MAX_RECENT = 24;

/** 種類ごとに、並び順で。 */
export function groupEmojis(entries: EmojiEntry[]): Map<number, EmojiEntry[]> {
  const groups = new Map<number, EmojiEntry[]>(EMOJI_GROUPS.map((group) => [group.id, []]));
  for (const entry of entries) if (entry.group !== undefined) groups.get(entry.group)?.push(entry);
  for (const list of groups.values()) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return groups;
}

/** 探すための形（全角・半角、大文字・小文字、カタカナ・ひらがなを区別しない）。 */
export function fold(text: string): string {
  // カタカナ（U+30A1〜U+30F6）をひらがなにそろえる
  return [...text.normalize("NFKC").toLowerCase()].map((c) => {
    const code = c.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : c;
  }).join("");
}

/** 名前とタグで探す（名前の先頭に合うものを先に）。 */
export function searchEmojis(entries: EmojiEntry[], query: string, limit = 200): EmojiEntry[] {
  const q = fold(query.trim());
  if (!q) return [];
  const head: EmojiEntry[] = [];
  const rest: EmojiEntry[] = [];
  for (const entry of entries) {
    if (entry.group === undefined || entry.group === 2) continue;
    const label = fold(entry.label);
    if (label.startsWith(q)) head.push(entry);
    else if (label.includes(q) || entry.tags?.some((tag) => fold(tag).includes(q))) rest.push(entry);
  }
  const byOrder = (a: EmojiEntry, b: EmojiEntry) => (a.order ?? 0) - (b.order ?? 0);
  return [...head.sort(byOrder), ...rest.sort(byOrder)].slice(0, limit);
}

/** 最近使った絵文字を足す（先頭に、重ねずに）。 */
export const withRecent = (recent: string[], emoji: string) => [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT);

/**
 * 本文の選んだ範囲（なければカーソル）に文字を入れる（Android 版の EmojiPalette.insertText）。サロゲートペアの
 * 途中には入れない。上限を超えるなら null。
 */
export function insertAt(text: string, start: number, end: number, insert: string, limit = 20_000): { text: string; cursor: number } | null {
  let from = Math.max(0, Math.min(Math.min(start, end), text.length));
  let to = Math.max(0, Math.min(Math.max(start, end), text.length));
  const insidePair = (index: number) => index > 0 && index < text.length && /[\uD800-\uDBFF]/.test(text[index - 1]) && /[\uDC00-\uDFFF]/.test(text[index]);
  if (from === to && insidePair(from)) {
    from++;
    to++;
  } else {
    if (insidePair(from)) from--;
    if (insidePair(to)) to++;
  }
  if (text.length - (to - from) + insert.length > limit) return null;
  return { text: text.slice(0, from) + insert + text.slice(to), cursor: from + insert.length };
}
