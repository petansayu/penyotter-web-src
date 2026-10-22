import { nip19 } from "nostr-tools";

/**
 * 投稿欄の「@名前」の補完（Android 版の Mentions、技術資料 9.3）。選ぶと本文に `nostr:npub1…` と空白を入れる。
 * Web 版だけ: 入力欄（textarea）では見せ方を変えられないので、入力欄には `nostr:npub1…` のまま出し、下に名前を並べる。
 */

export const MAX_QUERY = 30;
export const LIMIT = 8;

export interface MentionQuery { start: number; end: number; text: string }
export interface MentionPerson { pubkey: string; name?: string; displayName?: string; nip05?: string; petname?: string }

/** メールアドレスの文字（この直後の @ は補完しない）。 */
const mailLike = (char: string) => /[A-Za-z0-9._\-+%]/.test(char);

/** cursor の位置で打っている「@…」。なければ null。全角の「＠」も。 */
export function mentionQuery(text: string, cursor: number): MentionQuery | null {
  if (cursor < 1 || cursor > text.length) return null;
  for (let index = cursor - 1; index >= 0 && cursor - index <= MAX_QUERY + 1; index--) {
    const char = text[index];
    if (char === "@" || char === "＠") {
      const before = text[index - 1];
      if (before !== undefined && mailLike(before)) return null;
      return { start: index, end: cursor, text: text.slice(index + 1, cursor) };
    }
    if (/\s/.test(char)) return null;
  }
  return null;
}

/** 大文字小文字・全角半角・カタカナひらがなを区別しないための形。 */
export function normalize(value: string): string {
  return [...value.normalize("NFKC").toLowerCase().trim()]
    .map((c) => (c >= "ァ" && c <= "ヶ" ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c))
    .join("");
}

const labelOf = (p: MentionPerson) => p.petname || p.displayName || p.name || "";

/**
 * 候補を良い順に。名前の先頭 → 単語の先頭 → 途中 → 公開鍵・npub の先頭（4 文字以上）。同じ順位ならフォロー中を先に。
 * 空の語ならフォロー中の人を名前の順に。
 */
export function mentionCandidates(query: string, people: Iterable<MentionPerson>, follows: Set<string>, limit = LIMIT): MentionPerson[] {
  const wanted = normalize(query);
  const byKey = new Map<string, MentionPerson>();
  for (const person of people) byKey.set(person.pubkey, person);
  for (const pubkey of follows) if (!byKey.has(pubkey)) byKey.set(pubkey, { pubkey });
  const all = [...byKey.values()];
  const byName = (a: MentionPerson, b: MentionPerson) => (normalize(labelOf(a)) || "￿").localeCompare(normalize(labelOf(b)) || "￿") || a.pubkey.localeCompare(b.pubkey);
  if (!wanted) return all.filter((p) => follows.has(p.pubkey)).sort(byName).slice(0, limit);
  const ranked: { person: MentionPerson; rank: number }[] = [];
  for (const person of all) {
    const names = [person.petname ?? "", person.displayName ?? "", person.name ?? "", (person.nip05 ?? "").split("@")[0]].map(normalize).filter(Boolean);
    let rank: number;
    if (names.some((n) => n.startsWith(wanted))) rank = 0;
    else if (names.some((n) => n.split(/[ _\-.]/).some((w) => w.startsWith(wanted)))) rank = 1;
    else if (names.some((n) => n.includes(wanted))) rank = 2;
    else if (wanted.length >= 4 && (person.pubkey.startsWith(wanted) || nip19.npubEncode(person.pubkey).slice(5).startsWith(wanted.replace(/^npub1/, "")))) rank = 3;
    else continue;
    ranked.push({ person, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || Number(follows.has(b.person.pubkey)) - Number(follows.has(a.person.pubkey)) || byName(a.person, b.person))
    .map((r) => r.person)
    .slice(0, limit);
}

/** 「@…」を `nostr:npub1…` と空白に置き換える。カーソルはその後ろ。 */
export function insertMention(text: string, query: MentionQuery, pubkey: string): { text: string; cursor: number } {
  const mention = `nostr:${nip19.npubEncode(pubkey)}`;
  const rest = text.slice(query.end);
  const spaced = /^\s/.test(rest) ? mention : `${mention} `;
  return { text: text.slice(0, query.start) + spaced + rest, cursor: query.start + spaced.length };
}
