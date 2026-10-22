import { SvelteMap } from "svelte/reactivity";
import { mentionedPubkeys } from "../domain/content";
import { matchesFilters, matchNotes, matchProfiles, NO_FILTERS, searchFilters, SEARCH_KINDS, textMatches, type SearchFilters, type SearchQuery } from "../domain/search";
import { byNewest, type Event } from "../nostr/events";
import { eventsOf, pool } from "../nostr/pool";
import { relayInfo } from "../nostr/relayInfo";
import { loadRelayLists, writeRelays } from "../nostr/outbox";
import { relaySet } from "../nostr/relayUrl";
import { keepNotes, keepProfiles, notes, profiles, requestProfiles } from "./cache.svelte";
import { readScope } from "./db";
import { readRelaySetting, saveRelaySetting } from "./relaySettings";
import { viewer } from "./viewer.svelte";

/**
 * 検索（技術資料 5.6）。端末内の投稿とプロフィールから探して先に出し、そのあとリレーに問い合わせる。
 * 文字は NIP-50 に対応した検索リレー（NIP-11 で対応と分かったもの全部と、分からないもの 2 件）へ、
 * タグは検索リレーと読み込みリレーへ。リレーは同時に 4 つまで。
 */

/**
 * 検索リレーの最初の値。Android 版は空で、利用者が設定する。Web 版は空だと文字の検索が使えないので、日本語の
 * 全文検索ができる search.nos.today にしておく（Web 版だけ）。
 */
export const DEFAULT_SEARCH_RELAYS = ["wss://search.nos.today"];
const CONCURRENCY = 4;

/** 見る人の検索リレー。 */
export const searchRelays = (pubkey: string | null) => readRelaySetting("search-relays", pubkey, DEFAULT_SEARCH_RELAYS);

/** 1 行に 1 件の文字から検索リレーを保存する。 */
export const saveSearchRelays = (pubkey: string, text: string) => saveRelaySetting("search-relays", pubkey, text);

export interface RelayStatus { url: string; state: "waiting" | "loading" | "done" | "partial" | "failed" | "skipped"; count: number; note?: string }

export class Search {
  readonly posts = new SvelteMap<string, Event>();
  people = $state<string[]>([]);
  statuses = $state<RelayStatus[]>([]);
  loading = $state(false);
  finished = $state(false);
  message = $state<string | null>(null);
  private until: number | undefined;
  private generation = 0;

  constructor(readonly query: SearchQuery, readonly filters: SearchFilters = NO_FILTERS) {}

  results = $derived([...this.posts.values()].sort(byNewest));

  async start() {
    const query = this.query;
    if (query.type !== "text" && query.type !== "tag" && query.type !== "filtered") return;
    // 端末内から先に出す
    const me = viewer.pubkey;
    const saved = me ? [...(await readScope(me, "home")), ...(await readScope(me, "notes"))] : [];
    for (const event of matchNotes(query, [...notes.values(), ...saved], 100, this.filters)) this.add(event);
    this.people = matchProfiles(query, [...profiles].map(([pubkey, value]) => [pubkey, value.profile]));
    await this.remote();
  }

  async more() {
    if (this.loading || this.finished) return;
    await this.remote();
  }

  private add(event: Event) {
    if (this.posts.has(event.id)) return;
    this.posts.set(event.id, event);
    keepNotes([event], null);
    requestProfiles([event.pubkey, ...mentionedPubkeys(event)]);
  }

  /** 問い合わせるリレー。文字は NIP-50 対応と分かったもの全部と分からないもの 2 件、タグは検索リレーと読み込みリレー。 */
  private async relays(): Promise<RelayStatus[]> {
    const search = searchRelays(viewer.pubkey);
    if (this.query.type === "tag" || this.query.type === "filtered") {
      // 作者で絞ったときは、作者（20 人まで）の書き込みリレーにも問い合わせる（技術資料 5.6）
      const authors = this.filters.authors.slice(0, 20);
      if (authors.length > 0) await loadRelayLists(authors, viewer.alwaysOn);
      const theirs = authors.flatMap((pubkey) => writeRelays(pubkey));
      return relaySet([...theirs, ...search, ...viewer.readRelays], 12).map((url) => ({ url, state: "waiting", count: 0 }));
    }
    const infos = await Promise.all(search.map(async (url) => ({ url, info: await relayInfo(url) })));
    let unknown = 0;
    return infos.map(({ url, info }): RelayStatus => {
      if (info?.supportedNips.includes(50)) return { url, state: "waiting", count: 0 };
      if (info) return { url, state: "skipped", count: 0, note: "NIP-50 に対応していない" };
      if (unknown++ < 2) return { url, state: "waiting", count: 0, note: "対応が分からない" };
      return { url, state: "skipped", count: 0, note: "対応が分からない" };
    });
  }

  private async remote() {
    const generation = ++this.generation;
    const query = this.query;
    const filters = searchFilters(query, this.until, this.filters);
    if (filters.length === 0) return;
    this.loading = true;
    this.message = null;
    try {
      const statuses = await this.relays();
      if (generation !== this.generation) return;
      this.statuses = statuses;
      const targets = statuses.filter((status) => status.state === "waiting");
      if (targets.length === 0) {
        this.message = query.type === "text" ? "NIP-50 に対応した検索リレーがありません。設定の「検索リレー」で足してください。" : "問い合わせるリレーがありません。";
        this.finished = true;
        return;
      }
      const found: Event[] = [];
      let next = 0;
      const worker = async () => {
        while (next < targets.length) {
          const status = targets[next++];
          this.update(status.url, { state: "loading" });
          const fetched = await pool.fetch([status.url], filters);
          if (generation !== this.generation) return;
          const events = eventsOf(fetched);
          const posts = events.filter((event) => SEARCH_KINDS.includes(event.kind) && matchesFilters(event, this.filters) &&
            (query.type !== "text" || textMatches(event.kind === 30023 ? `${event.tags.find((t) => t[0] === "title")?.[1] ?? ""}\n${event.content}` : event.content, query.value)));
          const people = events.filter((event) => event.kind === 0);
          keepProfiles(people);
          this.people = [...new Set([...this.people, ...people.map((event) => event.pubkey)])].slice(0, 100);
          for (const event of posts) this.add(event);
          found.push(...posts);
          const info = fetched.complete ? null : await relayInfo(status.url);
          this.update(status.url, {
            state: fetched.complete ? "done" : events.length > 0 ? "partial" : "failed",
            count: posts.length,
            note: info?.paymentRequired ? "有料" : info?.authRequired ? "認証が必要" : undefined,
          });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
      if (generation !== this.generation) return;
      if (found.length === 0) this.finished = true;
      else this.until = Math.min(...found.map((event) => event.created_at)) - 1;
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  private update(url: string, change: Partial<RelayStatus>) {
    this.statuses = this.statuses.map((status) => (status.url === url ? { ...status, ...change } : status));
  }
}
