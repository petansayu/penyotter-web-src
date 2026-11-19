import type { EventTemplate } from "nostr-tools";
import { isHex64, type Event } from "../nostr/events";

/**
 * 自分の絵文字パック（NIP-51 の kind 30030: `d`・`title`・`emoji`）を作る・書き換える（Android 版の EmojiPackEditing と
 * 同じ）。知らないタグと content はそのまま残す。
 */

export const PACK_KIND = 30030;
export const MAX_TITLE = 100;
export const MAX_PACK_EMOJIS = 1000;

export type PackChange =
  | { type: "add"; shortcode: string; url: string }
  | { type: "remove"; shortcode: string; url: string }
  | { type: "rename"; title: string };

/** 新しい識別子。時刻（36 進）とでたらめな部分で、同じ秒に作った 2 つのパックが重ならないようにする。 */
export const newPackIdentifier = (now: number, random: number) => `penyotter-${now.toString(36)}-${(random & 0xffff).toString(36)}`;

/** カスタム絵文字として使える名前と画像か（名前は英数字・_・-、画像は https）。 */
export function validEmoji(shortcode: string, url: string): boolean {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(shortcode) || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !!parsed.hostname && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** ファイル名から名前の候補（拡張子を落とし、使えない文字は _、40 文字まで）。 */
export function suggestedShortcode(fileName: string): string {
  const base = fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;
  return base.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

function cleanTitle(title: string): string {
  const name = title.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("パックの名前を入れてください");
  if (name.length > MAX_TITLE) throw new Error(`パックの名前は ${MAX_TITLE} 文字までです`);
  return name;
}

export const packIdentifier = (tags: string[][]) => tags.find((t) => t.length >= 2 && t[0] === "d")?.[1] ?? null;
export const packTitle = (event: Event) => event.tags.find((t) => t[0] === "title" && t[1])?.[1] ?? packIdentifier(event.tags) ?? "";
export const packEmojis = (event: Event) => event.tags.filter((t) => t[0] === "emoji" && t[1] && t[2]).map((t) => ({ shortcode: t[1], url: t[2] }));

export function createPack(identifier: string, title: string, now: number): EventTemplate {
  if (!identifier.trim() || identifier.length > 256) throw new Error("パックの識別子が正しくありません");
  return { kind: PACK_KIND, created_at: now, tags: [["d", identifier], ["title", cleanTitle(title)]], content: "" };
}

export function editPack(me: string, base: Event, change: PackChange, now: number): EventTemplate {
  if (!isHex64(me) || base.pubkey !== me || base.kind !== PACK_KIND) throw new Error("自分の絵文字パックではありません");
  const identifier = packIdentifier(base.tags);
  if (!identifier) throw new Error("パックの識別子がありません");
  const tags = base.tags.map((tag) => [...tag]);
  if (change.type === "add") {
    if (!validEmoji(change.shortcode, change.url)) throw new Error("名前（英数字・_・-）と画像の URL を確かめてください");
    const same = tags.filter((t) => t[0] === "emoji" && t[1] === change.shortcode);
    if (!same.some((t) => t[2] === change.url)) {
      if (same.length > 0) throw new Error(`このパックには「${change.shortcode}」という名前の絵文字がもうあります`);
      if (tags.filter((t) => t[0] === "emoji").length >= MAX_PACK_EMOJIS) throw new Error(`1 つのパックに入れられる絵文字は ${MAX_PACK_EMOJIS} 個までです`);
      tags.push(["emoji", change.shortcode, change.url]);
    }
  } else if (change.type === "remove") {
    for (let i = tags.length - 1; i >= 0; i--) if (tags[i][0] === "emoji" && tags[i][1] === change.shortcode && tags[i][2] === change.url) tags.splice(i, 1);
  } else {
    const name = cleanTitle(change.title);
    const index = tags.findIndex((t) => t[0] === "title");
    if (index >= 0) tags[index] = ["title", name];
    else tags.splice(tags.findIndex((t) => t[0] === "d") + 1, 0, ["title", name]);
  }
  if (base.created_at >= now + 60) throw new Error("絵文字パックの時刻が未来になっています。しばらく待って再試行してください");
  if (packIdentifier(tags) !== identifier) throw new Error("パックの識別子が変わってしまいます");
  return { kind: PACK_KIND, created_at: Math.max(now, base.created_at + 1), tags, content: base.content };
}

/** me のパックの、識別子ごとのいちばん新しい版（新しい順）。 */
export function ownPacks(events: Iterable<Event>, me: string): Event[] {
  const newest = new Map<string, Event>();
  for (const event of events) {
    const id = event.kind === PACK_KIND && event.pubkey === me ? packIdentifier(event.tags) : null;
    if (id === null) continue;
    const current = newest.get(id);
    if (!current || event.created_at > current.created_at || (event.created_at === current.created_at && event.id < current.id)) newest.set(id, event);
  }
  return [...newest.values()].sort((a, b) => b.created_at - a.created_at);
}
