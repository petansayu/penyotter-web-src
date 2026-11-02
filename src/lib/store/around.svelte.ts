import { earliestAfter, FIRST_SPAN, nextSpan, STEP, type AroundScope } from "../domain/around";
import type { Event, Filter } from "../nostr/events";
import { fetchFromAuthor, fetchFromAuthors } from "../nostr/outbox";
import { eventsOf, merge, pool, type Fetched } from "../nostr/pool";
import { Feed, HOME_KINDS, PROFILE_KINDS } from "./feed.svelte";
import { globalRelays } from "./global";
import { viewer } from "./viewer.svelte";

/**
 * 選んだ投稿（またはリポスト）の前後の投稿（Android 版の AroundController）。範囲はフォロー中・グローバル・その人
 * だけ。カードの作り方（リポスト元の解決・ミュート）はタイムライン（Feed）と同じものを使い、読む部分だけをここで
 * する。前は until を下げながら、後は区切った時間ごとに古いほうから（domain/around.ts）。
 */
export class Around {
  readonly feed: Feed;
  olderLoading = $state(false);
  newerLoading = $state(false);
  olderDone = $state(false);
  newerDone = $state(false);
  message = $state<string | null>(null);
  private olderUntil: number;
  private newerSince: number;
  private span = FIRST_SPAN;
  private readonly known = new Set<string>();
  private readonly kinds: number[];

  /** 起点の時刻。anchor がなければ、指定した時刻（日時を指定して見る・投稿カレンダー）。 */
  readonly time: number;
  /** 「この人だけ」の人（anchor があればその作者）。 */
  readonly author: string | null;

  constructor(readonly anchor: Event | null, readonly scope: AroundScope, at?: { time: number; author?: string }) {
    const shown = scope === "author" ? PROFILE_KINDS : HOME_KINDS;
    this.kinds = [...shown, 6, 16];
    this.feed = new Feed(shown, { page: async () => merge([]) });
    this.time = anchor?.created_at ?? at?.time ?? Math.floor(Date.now() / 1000);
    this.author = anchor?.pubkey ?? at?.author ?? null;
    this.olderUntil = this.time;
    this.newerSince = this.time;
    if (anchor) {
      this.known.add(anchor.id);
      this.feed.add([anchor]);
    }
  }

  private fetch(filter: Filter): Promise<Fetched> {
    if (this.scope === "author") {
      const author = this.author;
      if (!author) return Promise.resolve(merge([]));
      return fetchFromAuthor(author, [{ ...filter, authors: [author] }], viewer.readRelays);
    }
    if (this.scope === "global") {
      const chosen = globalRelays(viewer.pubkey);
      return pool.fetch(chosen.length > 0 ? chosen : viewer.readRelays, [filter]);
    }
    const authors = [...new Set([...viewer.follows, ...(viewer.pubkey ? [viewer.pubkey] : [])])];
    const pinned = viewer.pubkey ? [{ author: viewer.pubkey, relays: viewer.writeRelays }] : [];
    return fetchFromAuthors(authors, filter, viewer.alwaysOn, undefined, 4000, pinned);
  }

  private add(events: Event[]) {
    const fresh = events.filter((e) => !this.known.has(e.id));
    for (const event of fresh) this.known.add(event.id);
    this.feed.add(fresh);
    return fresh;
  }

  /** 選んだ投稿より前を足す。 */
  async older() {
    if (this.olderLoading || this.olderDone) return;
    this.olderLoading = true;
    this.message = null;
    try {
      const events = eventsOf(await this.fetch({ kinds: this.kinds, until: this.olderUntil, limit: STEP }));
      const fresh = this.add(events);
      if (fresh.length === 0) this.olderDone = true;
      else this.olderUntil = Math.min(...fresh.map((e) => e.created_at));
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e);
    } finally {
      this.olderLoading = false;
    }
  }

  /** 選んだ投稿より後を、古いほうから足す。見つかるまで区切りを広げる（今を越えたら終わり）。 */
  async newer() {
    if (this.newerLoading || this.newerDone) return;
    this.newerLoading = true;
    this.message = null;
    try {
      for (let tries = 0; tries < 8; tries++) {
        const now = Math.floor(Date.now() / 1000);
        const since = this.newerSince;
        const until = Math.min(now, since + this.span);
        const events = eventsOf(await this.fetch({ kinds: this.kinds, since, until, limit: 500 }));
        const { taken, next } = earliestAfter(events, since, STEP, this.known);
        this.add(taken);
        this.span = nextSpan(this.span, taken.length > 0);
        if (next !== null) {
          this.newerSince = next;
          return;
        }
        this.newerSince = until + 1;
        if (until >= now) {
          this.newerDone = true;
          return;
        }
        if (taken.length > 0) return;
      }
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e);
    } finally {
      this.newerLoading = false;
    }
  }
}
