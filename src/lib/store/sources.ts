import { isHex64, type Event, type Filter } from "../nostr/events";
import { fetchFromAuthor, fetchFromAuthors, subscribeAuthors } from "../nostr/outbox";
import { eventsOf, merge, pool } from "../nostr/pool";
import { HOME_KINDS, PROFILE_KINDS, type FeedSource } from "./feed.svelte";
import { notes } from "./cache.svelte";
import { readScope } from "./db";
import { globalRelays } from "./global";
import { viewer } from "./viewer.svelte";

/**
 * ホームのフォロー中（技術資料 5.2）: フォロー中と自分を、相手の書き込みリレーと常時接続リレーから。自分の投稿は、
 * 自分の書き込みリレーからも必ず読む（12 件の枠に入らないと、自分の投稿がホームに出なかったため）。
 */
export function homeSource(): FeedSource {
  const authors = () => [...new Set([...viewer.follows, ...(viewer.pubkey ? [viewer.pubkey] : [])])];
  const pinned = () => (viewer.pubkey ? [{ author: viewer.pubkey, relays: viewer.writeRelays }] : []);
  const kinds = [...HOME_KINDS, 6, 16];
  return {
    page: (until, limit, onEvent) => {
      const filter: Filter = { kinds, limit: until === undefined ? 80 : limit, ...(until !== undefined ? { until } : {}) };
      return fetchFromAuthors(authors(), filter, viewer.alwaysOn, onEvent, 4000, pinned());
    },
    live: (since, onEvent) => subscribeAuthors(authors(), { kinds, since }, viewer.alwaysOn, onEvent, pinned()),
    cacheScope: "home",
  };
}

/**
 * ホームのグローバル（技術資料 5.2）: フォロー中と同じフィルタから authors を外したもの。購読は「グローバルで
 * 読むリレー」（空なら常時接続リレー）、さかのぼりは「グローバルで読むリレー」（空なら読み込みリレー全部）。
 */
export function globalSource(): FeedSource {
  const kinds = [...HOME_KINDS, 6, 16];
  const chosen = () => globalRelays(viewer.pubkey);
  return {
    page: (until, limit, onEvent) => {
      const relays = chosen().length > 0 ? chosen() : viewer.readRelays;
      const filter: Filter = { kinds, limit: until === undefined ? 80 : limit, ...(until !== undefined ? { until } : {}) };
      return pool.fetch(relays, [filter], { onEvent });
    },
    live: (since, onEvent) => pool.subscribe(chosen().length > 0 ? chosen() : viewer.alwaysOn, [{ kinds, since }], onEvent),
    cacheScope: "global",
  };
}

/**
 * プロフィールの投稿（技術資料 5.5）: 相手の書き込みリレーから。リポストはリポストした人の活動として扱う。
 * リレーの返事を待つ間に、ほかの画面で読んで手元にあるその人の投稿を先に出す（Android 版も保存分を先に出す）。
 */
export function profileSource(pubkey: string, hints: string[] = []): FeedSource {
  const kinds = [...PROFILE_KINDS, 6, 16];
  return {
    saved: async () => {
      const me = viewer.pubkey;
      const stored = me ? [...(await readScope(me, "home", 500)), ...(await readScope(me, "notes", 500))] : [];
      const seen = new Set<string>();
      return [...notes.values(), ...stored].filter((event) => {
        if (event.pubkey !== pubkey || !kinds.includes(event.kind) || seen.has(event.id)) return false;
        seen.add(event.id);
        return true;
      });
    },
    page: (until, limit, onEvent) =>
      fetchFromAuthor(pubkey, [{ kinds, authors: [pubkey], limit, ...(until !== undefined ? { until } : {}) }], viewer.readRelays, hints, onEvent),
    accepts: (card) => (card.repost ? card.repost.pubkey === pubkey : card.note.pubkey === pubkey),
  };
}

/** プロフィールの記事（技術資料 5.5）: `{"kinds":[30023],"authors":[相手],"limit":100}` を相手の書き込みリレーから。 */
export function articlesSource(pubkey: string, hints: string[] = []): FeedSource {
  return {
    page: (until, limit, onEvent) =>
      fetchFromAuthor(pubkey, [{ kinds: [30023], authors: [pubkey], limit: Math.min(limit, 100), ...(until !== undefined ? { until } : {}) }], viewer.readRelays, hints, onEvent),
    accepts: (card) => card.note.pubkey === pubkey,
  };
}

/** リレーの列: 決めたリレーだけから、ホームと同じ種類を読む（Rabbit のリレーの列）。 */
export function relaysSource(relays: string[]): FeedSource {
  const kinds = [...HOME_KINDS, 6, 16];
  return {
    page: (until, limit, onEvent) =>
      pool.fetch(relays, [{ kinds, limit: until === undefined ? 80 : limit, ...(until !== undefined ? { until } : {}) }], { onEvent }),
    live: (since, onEvent) => pool.subscribe(relays, [{ kinds, since }], onEvent),
  };
}

/** リアクションの列: その人がしたリアクション（kind 7）を、その人の書き込みリレーから。先の投稿を出す。 */
export function reactionsSource(pubkey: string): FeedSource {
  return {
    page: (until, limit, onEvent) =>
      fetchFromAuthor(pubkey, [{ kinds: [7], authors: [pubkey], limit: Math.min(limit, 100), ...(until !== undefined ? { until } : {}) }], viewer.readRelays, [], onEvent),
    live: (since, onEvent) => subscribeAuthors([pubkey], { kinds: [7], since }, viewer.alwaysOn, onEvent),
    accepts: (card) => card.reaction?.pubkey === pubkey,
  };
}

/**
 * リストの列: フォローセット（kind 30000）のメンバーの投稿を、ホームと同じ読み方で。自分のリストで署名できるときは、
 * 非公開のメンバー（content を自分宛てに NIP-44、古いリストは NIP-04（"?iv="）で暗号化したタグの JSON）も読む
 * （Android 版の FollowSets.privateTags）。
 */
/** 自分のリストの非公開の項目（復号できなければ空）。 */
export async function privateTags(list: Event): Promise<string[][]> {
  if (!list.content || list.pubkey !== viewer.pubkey || !viewer.canSign) return [];
  try {
    const signer = await viewer.getSigner();
    const plain = list.content.includes("?iv=") ? await signer.nip04Decrypt(list.pubkey, list.content) : await signer.nip44Decrypt(list.pubkey, list.content);
    const parsed = JSON.parse(plain) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string[] => Array.isArray(t) && t.every((v) => typeof v === "string")) : [];
  } catch {
    return [];
  }
}

export function listSource(pubkey: string, identifier: string): FeedSource {
  const kinds = [...HOME_KINDS, 6, 16];
  let members: string[] | null = null;
  const load = async () => {
    if (members) return members;
    const fetched = await fetchFromAuthor(pubkey, [{ kinds: [30000], authors: [pubkey], "#d": [identifier], limit: 5 }], viewer.readRelays);
    const list = eventsOf(fetched).filter((event) => event.pubkey === pubkey).sort((a, b) => b.created_at - a.created_at)[0];
    const tags = list ? [...list.tags, ...(await privateTags(list))] : [];
    members = [...new Set(tags.filter((tag) => tag[0] === "p" && isHex64(tag[1])).map((tag) => tag[1]))];
    return members;
  };
  return {
    page: async (until, limit, onEvent) => {
      const authors = await load();
      if (authors.length === 0) return merge([]);
      const filter: Filter = { kinds, limit: until === undefined ? 80 : limit, ...(until !== undefined ? { until } : {}) };
      return fetchFromAuthors(authors, filter, viewer.alwaysOn, onEvent);
    },
    live: (since, onEvent) => (members && members.length > 0 ? subscribeAuthors(members, { kinds, since }, viewer.alwaysOn, onEvent) : () => {}),
  };
}
