import { isHex64, type Event } from "../nostr/events";

/**
 * バッジ（NIP-58、Android 版の Badges、技術資料 8.11）。定義（kind 30009）・授与（kind 8）・本人が選んだ一覧
 * （kind 10008、または d が profile_badges の kind 30008。`a` と `e` が続けて並ぶ）。
 */

export interface Badge { address: string; issuer: string; name: string; description: string; image?: string; thumb?: string; awardedAt?: number }

export const DEFINITION = 30009;
export const AWARD = 8;
export const PROFILE_BADGES = 10008;
export const LEGACY_PROFILE_BADGES = 30008;

const newest = (a: Event, b: Event) => b.created_at - a.created_at || a.id.localeCompare(b.id);

/** owner の最新のバッジ一覧（どちらの kind でも）。 */
export function profileBadgeList(events: Iterable<Event>, owner: string): Event | undefined {
  return [...events]
    .filter((e) => e.pubkey === owner && (e.kind === PROFILE_BADGES || (e.kind === LEGACY_PROFILE_BADGES && e.tags.some((t) => t[0] === "d" && t[1] === "profile_badges"))))
    .sort(newest)[0];
}

/** （定義のアドレス, 授与の ID）の組。`a` の次に `e` が来ているものだけ。 */
export function badgePairs(list: Event): [string, string][] {
  const tags = list.tags.filter((t) => t.length >= 2 && (t[0] === "a" || t[0] === "e"));
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < tags.length; i++) {
    const [a, e] = [tags[i], tags[i + 1]];
    if (a[0] === "a" && e[0] === "e" && a[1].startsWith(`${DEFINITION}:`) && isHex64(e[1]) && !pairs.some((p) => p[0] === a[1] && p[1] === e[1])) pairs.push([a[1], e[1]]);
  }
  return pairs;
}

/** もらったバッジ: 定義と、それをくれた授与（kind 8）。 */
export interface ReceivedBadge { badge: Badge; awardId: string; time: number }

/** 定義（kind 30009）ごとの新しい版。アドレスで引く。 */
export function newestDefinitions(definitions: Iterable<Event>): Map<string, Event> {
  const result = new Map<string, Event>();
  for (const event of [...definitions].filter((e) => e.kind === DEFINITION).sort(newest).reverse()) {
    result.set(`${DEFINITION}:${event.pubkey}:${event.tags.find((t) => t[0] === "d")?.[1] ?? ""}`, event);
  }
  return result;
}

/** 定義のアドレス（30009:<作った人>:<d>）の作った人と識別子。 */
export function addressParts(address: string): { issuer: string; identifier: string } | null {
  const [kind, issuer, ...rest] = address.split(":");
  const identifier = rest.join(":");
  return kind === String(DEFINITION) && isHex64(issuer) && identifier ? { issuer, identifier } : null;
}

/** 定義から、表示するバッジ。 */
export function badgeOf(address: string, definition: Event): Badge | null {
  const parts = addressParts(address);
  if (!parts) return null;
  const tag = (name: string) => definition.tags.find((t) => t.length >= 2 && t[0] === name)?.[1]?.trim();
  const image = tag("image")?.startsWith("https://") ? tag("image") : undefined;
  // 64 ピクセル以上でいちばん小さい正方形のサムネイル。なければ元の画像
  const size = (t: string[]) => {
    const n = Number(t[2]?.split("x")[0]);
    return Number.isFinite(n) && n > 0 ? (n >= 64 ? n : 10_000 + n) : 5_000;
  };
  const thumb = definition.tags.filter((t) => t.length >= 2 && t[0] === "thumb" && t[1].startsWith("https://")).sort((a, b) => size(a) - size(b))[0]?.[1];
  return { address, issuer: parts.issuer, name: (tag("name") || parts.identifier).slice(0, 100), description: (tag("description") ?? "").slice(0, 500), image, thumb: thumb ?? image };
}

/** 授与が owner に本当にくれたバッジ（授与した人自身が作ったものだけ。kind 8 はだれでも署名できるため）。 */
export function awardedAddresses(award: Event, owner: string): string[] {
  if (award.kind !== AWARD || !award.tags.some((t) => t[0] === "p" && t[1] === owner)) return [];
  return [...new Set(award.tags.filter((t) => t.length >= 2 && t[0] === "a" && addressParts(t[1])?.issuer === award.pubkey).map((t) => t[1]))];
}

/** owner がもらったバッジ（定義が見つかったもの）。新しい授与から。同じバッジを何度ももらったら新しいほうだけ。 */
export function receivedBadges(owner: string, awards: Iterable<Event>, definitions: Iterable<Event>): ReceivedBadge[] {
  const byAddress = newestDefinitions(definitions);
  const result: ReceivedBadge[] = [];
  for (const award of [...awards].sort(newest)) {
    for (const address of awardedAddresses(award, owner)) {
      const definition = byAddress.get(address);
      const badge = definition && badgeOf(address, definition);
      if (badge && !result.some((r) => r.badge.address === address)) result.push({ badge, awardId: award.id, time: award.created_at });
    }
  }
  return result;
}

/**
 * プロフィールのバッジ一覧（kind 10008）を、pairs（定義のアドレス, 授与の ID）の順に作り直す。前の一覧のほかの
 * タグは残す。kind 30008 だった一覧は kind 10008 にする（d タグを外す）。
 */
export function profileBadgeTags(base: Event | undefined, pairs: [string, string][]): string[][] {
  const kept = (base?.tags ?? []).filter((t) => t.length > 0 && t[0] !== "a" && t[0] !== "e" && t[0] !== "d").map((t) => [...t]);
  const seen = new Set<string>();
  const items = pairs.filter(([address, award]) => addressParts(address) && isHex64(award) && !seen.has(address) && seen.add(address));
  return [...kept, ...items.flatMap(([address, award]) => [["a", address], ["e", award]])];
}

/** 確かめられたバッジ。授与の作者 = 定義の作者、授与に定義の `a` と owner の `p` があり、定義が見つかったものだけ。 */
export function resolveBadges(owner: string, pairs: [string, string][], awards: Iterable<Event>, definitions: Iterable<Event>): Badge[] {
  const awardById = new Map([...awards].filter((e) => e.kind === AWARD).map((e) => [e.id, e]));
  const definitionByAddress = newestDefinitions(definitions);
  const result: Badge[] = [];
  for (const [address, awardId] of pairs) {
    const award = awardById.get(awardId);
    if (!award || !awardedAddresses(award, owner).includes(address)) continue;
    const definition = definitionByAddress.get(address);
    const badge = definition && badgeOf(address, definition);
    if (badge && !result.some((b) => b.address === address)) result.push({ ...badge, awardedAt: award.created_at });
  }
  return result;
}

/** バッジをもらった人（作った人自身の授与の p だけ）。新しい授与から。 */
export function badgeHolders(address: string, awards: Iterable<Event>): string[] {
  const issuer = addressParts(address)?.issuer;
  if (!issuer) return [];
  const result: string[] = [];
  for (const award of [...awards].sort(newest)) {
    if (award.kind !== AWARD || award.pubkey !== issuer || !award.tags.some((t) => t[0] === "a" && t[1] === address)) continue;
    for (const tag of award.tags) if (tag[0] === "p" && isHex64(tag[1]) && !result.includes(tag[1])) result.push(tag[1]);
  }
  return result;
}

/** author が作ったバッジ（定義の新しい版）。新しい順。 */
export function createdBadges(author: string, definitions: Iterable<Event>): Badge[] {
  return [...newestDefinitions([...definitions].filter((e) => e.pubkey === author))]
    .sort(([, a], [, b]) => b.created_at - a.created_at)
    .flatMap(([address, definition]) => badgeOf(address, definition) ?? []);
}
