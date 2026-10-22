import { isHex64, type Event } from "../nostr/events";

/**
 * バッジ（NIP-58、Android 版の Badges、技術資料 8.11）。定義（kind 30009）・授与（kind 8）・本人が選んだ一覧
 * （kind 10008、または d が profile_badges の kind 30008。`a` と `e` が続けて並ぶ）。
 */

export interface Badge { address: string; issuer: string; name: string; description: string; image?: string; thumb?: string }

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

/** 確かめられたバッジ。授与の作者 = 定義の作者、授与に定義の `a` と owner の `p` があり、定義が見つかったものだけ。 */
export function resolveBadges(owner: string, pairs: [string, string][], awards: Iterable<Event>, definitions: Iterable<Event>): Badge[] {
  const awardById = new Map([...awards].filter((e) => e.kind === AWARD).map((e) => [e.id, e]));
  const definitionByAddress = new Map<string, Event>();
  for (const event of [...definitions].filter((e) => e.kind === DEFINITION).sort(newest).reverse()) {
    definitionByAddress.set(`${DEFINITION}:${event.pubkey}:${event.tags.find((t) => t[0] === "d")?.[1] ?? ""}`, event);
  }
  const result: Badge[] = [];
  for (const [address, awardId] of pairs) {
    const parts = address.split(":");
    const issuer = parts[1];
    const d = parts.slice(2).join(":");
    if (parts.length < 3 || !isHex64(issuer)) continue;
    const award = awardById.get(awardId);
    if (!award || award.pubkey !== issuer || !award.tags.some((t) => t[0] === "a" && t[1] === address) || !award.tags.some((t) => t[0] === "p" && t[1] === owner)) continue;
    const definition = definitionByAddress.get(address);
    if (!definition || result.some((b) => b.address === address)) continue;
    const tag = (name: string) => definition.tags.find((t) => t.length >= 2 && t[0] === name)?.[1]?.trim();
    const image = tag("image")?.startsWith("https://") ? tag("image") : undefined;
    // 64 ピクセル以上でいちばん小さい正方形のサムネイル。なければ元の画像
    const size = (t: string[]) => {
      const n = Number(t[2]?.split("x")[0]);
      return Number.isFinite(n) && n > 0 ? (n >= 64 ? n : 10_000 + n) : 5_000;
    };
    const thumb = definition.tags.filter((t) => t.length >= 2 && t[0] === "thumb" && t[1].startsWith("https://")).sort((a, b) => size(a) - size(b))[0]?.[1];
    result.push({ address, issuer, name: (tag("name") || d).slice(0, 100), description: (tag("description") ?? "").slice(0, 500), image, thumb: thumb ?? image });
  }
  return result;
}
