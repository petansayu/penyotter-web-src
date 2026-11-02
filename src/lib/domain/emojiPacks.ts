import { emojiTags, parseSetAddress, setReferences, type CustomEmoji } from "./emojis";
import { newer, type Event } from "../nostr/events";

/**
 * 投稿やリアクションで見かけたカスタム絵文字の、もとの絵文字パック（kind 30030）を探して自分の絵文字リストに
 * 足すための規則（Android 版の EmojiPacks）。
 */

export interface EmojiPack {
  author: string;
  identifier: string;
  /** 30030:公開鍵:識別子 */
  address: string;
  title: string;
  emojis: CustomEmoji[];
}

/** 絵文字を探すときに読む、絵文字リストのパックの数（Android 版の EmojiPacks.MAX_LISTED）。 */
export const MAX_LISTED = 60;

/** 使った人の手がかりで見つからないときに読む、フォロー中の人の絵文字リストのパックの数（Android 版の EmojiPacks.MAX_FOLLOWED）。 */
export const MAX_FOLLOWED = 150;

/** emoji タグそのものが指すパック（NIP-30 の 4 つめ）。あって読めるときだけ。 */
export function packAddressIn(tags: string[][], url: string): { author: string; identifier: string } | null {
  const tag = tags.find((t) => t.length >= 4 && t[0]?.toLowerCase() === "emoji" && t[2]?.trim() === url);
  return tag ? parseSetAddress(tag[3]) : null;
}

/** kind 30030 をパックにする。題名は title タグ、なければ識別子。 */
export function emojiPack(event: Event): EmojiPack | null {
  if (event.kind !== 30030) return null;
  const identifier = event.tags.find((t) => t.length >= 2 && t[0] === "d")?.[1];
  if (!identifier?.trim()) return null;
  const parsed = parseSetAddress(`30030:${event.pubkey}:${identifier}`);
  if (!parsed) return null;
  const address = `30030:${event.pubkey}:${identifier}`;
  const title = event.tags.find((t) => t.length >= 2 && t[0] === "title")?.[1]?.trim().slice(0, 100) || identifier;
  return { ...parsed, address, title, emojis: emojiTags(event.tags).map((e) => ({ ...e, set: address })) };
}

/** パックごとにいちばん新しい版（NIP-01: 新しいもの、同じ時刻なら ID の小さいもの）。 */
export function newestPacks(events: Event[]): EmojiPack[] {
  const latest = new Map<string, Event>();
  for (const event of events) {
    const pack = emojiPack(event);
    if (pack && newer(event, latest.get(pack.address))) latest.set(pack.address, event);
  }
  return [...latest.values()].map((event) => emojiPack(event)!);
}

/** その絵文字（同じ画像）が入っているパック。 */
export function packsContaining(packs: EmojiPack[], url: string): EmojiPack[] {
  return packs.filter((pack) => pack.emojis.some((e) => e.url === url));
}

/** 同じ名前の絵文字が入っているパック（画像の URL が変わった絵文字のため。画像は違うことがある）。 */
export function packsNamed(packs: EmojiPack[], shortcode: string): EmojiPack[] {
  return packs.filter((pack) => pack.emojis.some((e) => e.shortcode === shortcode));
}

/** 何人かの絵文字リスト（kind 10030）が指すパックを、指している人の多い順に limit 件（同じ数なら先に出てきた順）。 */
export function popularReferences(lists: Event[], limit: number): { author: string; identifier: string }[] {
  const counts = new Map<string, { ref: { author: string; identifier: string }; count: number }>();
  for (const list of lists) {
    for (const ref of setReferences(list)) {
      const key = `${ref.author}:${ref.identifier}`;
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { ref, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit).map((e) => e.ref);
}
