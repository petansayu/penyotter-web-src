import { AWARD, badgePairs, DEFINITION, LEGACY_PROFILE_BADGES, PROFILE_BADGES, profileBadgeList, resolveBadges, type Badge } from "../domain/badges";
import { count } from "../nostr/count";
import { isHex64, latest, type Event } from "../nostr/events";
import { fetchFromAuthor, fetchFromAuthors, loadRelayLists, relayLists, writeRelays } from "../nostr/outbox";
import { eventsOf, pool } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { keepNotes, requestProfiles } from "./cache.svelte";
import { viewer } from "./viewer.svelte";

/** プロフィールの投稿タブ以外の中身（技術資料 5.5）。どれも開いたときに読む。 */

const pTags = (event: Event | undefined) => [...new Set((event?.tags ?? []).filter((t) => t[0] === "p" && isHex64(t[1])).map((t) => t[1]))];

/** ピン留め（NIP-51 の kind 10001）。中の投稿は読み込みリレーから読む。 */
export async function loadPinned(pubkey: string, hints: string[]): Promise<Event[]> {
  const list = latest(eventsOf(await fetchFromAuthor(pubkey, [{ kinds: [10001], authors: [pubkey] }], viewer.readRelays, hints)));
  const ids = [...new Set((list?.tags ?? []).filter((t) => t[0] === "e" && isHex64(t[1])).map((t) => t[1]))].slice(0, 50);
  if (ids.length === 0) return [];
  const fetched = eventsOf(await pool.fetch(relaySet([...viewer.readRelays, ...writeRelays(pubkey)]), [{ kinds: [1], ids }]));
  keepNotes(fetched);
  // 一覧の順に（新しく足したものが後ろなので、上に出すため逆に）
  return ids.map((id) => fetched.find((e) => e.id === id)).filter((e): e is Event => !!e).reverse();
}

/** フォロー（相手の最新の kind 3）。complete でなければ数は出さない。 */
export async function loadFollowing(pubkey: string, hints: string[]): Promise<{ ids: string[]; complete: boolean }> {
  const fetched = await fetchFromAuthor(pubkey, [{ kinds: [3], authors: [pubkey], limit: 5 }], viewer.readRelays, hints);
  const list = latest(eventsOf(fetched));
  return { ids: pTags(list), complete: !!list || fetched.complete };
}

/** フォロワー数（読み込みリレーへの COUNT）。 */
export const countFollowers = (pubkey: string) => count(relaySet(viewer.readRelays, 8), { kinds: [3], "#p": [pubkey] });

/**
 * フォロワーの一覧。読み込みリレーから相手を入れた kind 3 を 500 件まで読み、その人たちの最新の kind 3 をそれぞれの
 * 書き込みリレーから読み直して、今も入っている人だけにする。
 */
export async function loadFollowers(pubkey: string): Promise<{ ids: string[]; complete: boolean }> {
  const first = await pool.fetch(viewer.readRelays, [{ kinds: [3], "#p": [pubkey], limit: 500 }]);
  const authors = [...new Set(eventsOf(first).map((e) => e.pubkey))].slice(0, 500);
  if (authors.length === 0) return { ids: [], complete: first.complete };
  const newestBy = new Map<string, Event>();
  const keep = (event: Event) => {
    if (event.kind !== 3) return;
    const known = newestBy.get(event.pubkey);
    if (!known || event.created_at > known.created_at || (event.created_at === known.created_at && event.id < known.id)) newestBy.set(event.pubkey, event);
  };
  eventsOf(first).forEach(keep);
  await loadRelayLists(authors, viewer.alwaysOn);
  await fetchFromAuthors(authors, { kinds: [3] }, viewer.alwaysOn, keep);
  const ids = authors.filter((author) => pTags(newestBy.get(author)).includes(pubkey));
  requestProfiles(ids.slice(0, 200));
  return { ids, complete: first.complete };
}

/** リアクション（相手の kind 7 を 100 件）と、その先の投稿。 */
export async function loadReactions(pubkey: string, hints: string[]): Promise<{ reaction: Event; target: Event }[]> {
  const fetched = await fetchFromAuthor(pubkey, [{ kinds: [7], authors: [pubkey], limit: 100 }], viewer.readRelays, hints);
  const reactions = eventsOf(fetched).filter((e) => e.kind === 7).sort((a, b) => b.created_at - a.created_at);
  const targetOf = (r: Event) => [...r.tags].reverse().find((t) => t[0] === "e" && isHex64(t[1]))?.[1];
  const ids = [...new Set(reactions.map(targetOf).filter((id): id is string => !!id))];
  const targets = new Map<string, Event>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    for (const event of eventsOf(await pool.fetch(viewer.readRelays, [{ kinds: [1, 1111], ids: chunk }]))) targets.set(event.id, event);
  }
  keepNotes(targets.values());
  return reactions.flatMap((reaction) => {
    const target = targets.get(targetOf(reaction) ?? "");
    return target ? [{ reaction, target }] : [];
  });
}

/** 相手の kind 10002（読み込み・書き込み）。 */
export async function loadRelays(pubkey: string): Promise<{ url: string; read: boolean; write: boolean }[] | null> {
  await loadRelayLists([pubkey], viewer.readRelays);
  const list = relayLists.get(pubkey)?.list;
  if (!list) return null;
  return relaySet([...list.read, ...list.write]).map((url) => ({ url, read: list.read.includes(url), write: list.write.includes(url) }));
}

/** バッジ（NIP-58）。授与は読み込みリレー、定義は授与した人の書き込みリレーから読む。 */
export async function loadBadges(pubkey: string, hints: string[]): Promise<Badge[]> {
  const lists = eventsOf(await fetchFromAuthor(pubkey, [{ kinds: [PROFILE_BADGES, LEGACY_PROFILE_BADGES], authors: [pubkey] }], viewer.readRelays, hints));
  const list = profileBadgeList(lists, pubkey);
  if (!list) return [];
  const pairs = badgePairs(list).slice(0, 30);
  if (pairs.length === 0) return [];
  const awards = eventsOf(await pool.fetch(relaySet([...viewer.readRelays, ...writeRelays(pubkey)]), [{ kinds: [AWARD], ids: pairs.map((p) => p[1]) }]));
  const byIssuer = new Map<string, string[]>();
  for (const [address] of pairs) {
    const [, issuer, ...rest] = address.split(":");
    if (!isHex64(issuer)) continue;
    byIssuer.set(issuer, [...(byIssuer.get(issuer) ?? []), rest.join(":")]);
  }
  const definitions: Event[] = [];
  await Promise.all([...byIssuer].map(async ([issuer, ds]) => {
    definitions.push(...eventsOf(await fetchFromAuthor(issuer, [{ kinds: [DEFINITION], authors: [issuer], "#d": ds }], viewer.readRelays)));
  }));
  return resolveBadges(pubkey, pairs, awards, definitions);
}
