import { SvelteMap } from "svelte/reactivity";
import { mentionedPubkeys } from "../domain/content";
import { root } from "../domain/threads";
import { reactionTarget } from "../domain/interactions";
import { embeddedTarget, isRepost, repostTarget, resolveRepostTargets, resolveTargets } from "../domain/reposts";
import { byNewest, newer, type Event } from "../nostr/events";
import { eventsOf, type Fetched } from "../nostr/pool";
import { address } from "../domain/threads";
import { keepNotes, notes, requestProfiles } from "./cache.svelte";
import { readEvents, readScope, saveScope, type Scope } from "./db";
import { deletedNotes, droppedNotes, requestRepostDeletions } from "./interactions.svelte";
import { viewer } from "./viewer.svelte";

/** 一覧の 1 枚。repost があれば、そのリポストで出ている投稿。reaction があれば、そのリアクションの先の投稿。 */
export interface Card { key: string; note: Event; repost?: Event; reaction?: Event }

/** ホームが投稿として出す種類（リポストのほか）。Android 版の FeedCards.home。 */
export const HOME_KINDS = [1, 30023, 1068, 20, 21, 22, 34235, 34236];
/** プロフィールの投稿タブが出す種類（リポストのほか）。FeedCards.profile。 */
export const PROFILE_KINDS = [1, 1111, 1068, 20, 21, 22, 34235, 34236];
const REPOST_TARGET_KINDS = [1, 1111];
/** リアクションの列で、リアクションの先として出す種類。 */
const REACTION_TARGET_KINDS = [1, 1111, 30023, 1068, 20, 21, 22, 34235, 34236];

export interface FeedSource {
  /** until より前（until を含む）を limit 件まで読む。 */
  page(until: number | undefined, limit: number, onEvent: (event: Event) => void): Promise<Fetched>;
  /** since から後を購読する。返した関数で止める。 */
  live?(since: number, onEvent: (event: Event) => void): () => void;
  /** このカードを出すか（プロフィールでは、ほかの人がしたリポストを出さない）。 */
  accepts?(card: Card): boolean;
  /** ブラウザに保存する一覧（ホームだけ）。 */
  cacheScope?: Scope;
  /** 保存する一覧を持たないとき、リレーに問い合わせる前に出せる手元の分（プロフィールでは、ほかの画面で読んだその人の投稿）。 */
  saved?(): Promise<Event[]>;
}

/** ミュートは読むときに除く（技術資料 5.1）。 */
function muted(card: Card): boolean {
  const people = viewer.mutedPubkeys;
  const posts = viewer.mutedEvents;
  if (people.has(card.note.pubkey) || (card.repost && people.has(card.repost.pubkey))) return true;
  return posts.has(card.note.id) || posts.has(root(card.note));
}

/**
 * タイムラインの一覧（Android 版の技術資料 4.3.1・5.2）。届いたイベントを ID でまとめ、リポストは元の投稿が
 * 見つかったものだけ出す。記事は同じもの（作者と d）の新しい版だけ。
 */
export class Feed {
  private readonly events = new SvelteMap<string, Event>();
  loading = $state(false);
  finished = $state(false);
  message = $state<string | null>(null);
  private until: number | undefined;
  private limit = 100;
  private emptyRuns = 0;
  private stopLive: (() => void) | undefined;
  private buffer: Event[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  /** start を呼んだか。保存分だけを出している間（リレーのリストを読む前）は、続きを読まない。 */
  private started = false;

  constructor(private readonly shown: number[], private readonly source: FeedSource) {}

  cards = $derived.by(() => {
    const articles = new Map<string, Event>();
    for (const event of this.events.values()) {
      if (event.kind !== 30023) continue;
      const key = address(event);
      if (key && newer(event, articles.get(key))) articles.set(key, event);
    }
    const result: Card[] = [];
    for (const event of [...this.events.values()].sort(byNewest)) {
      if (droppedNotes.has(event.id)) continue;
      let card: Card | null = null;
      if (isRepost(event)) {
        // リポストした本人が取り消したもの（kind 5）は出さない
        if (deletedNotes.has(event.id)) continue;
        const target = notes.get(repostTarget(event) ?? "");
        if (target && REPOST_TARGET_KINDS.includes(target.kind)) card = { key: event.id, note: target, repost: event };
      } else if (event.kind === 7) {
        // リアクションの列（shown に 7 を入れたときだけ）。取り消したものは出さない
        if (!this.shown.includes(7) || deletedNotes.has(event.id)) continue;
        const target = notes.get(reactionTarget(event) ?? "");
        if (target && REACTION_TARGET_KINDS.includes(target.kind)) card = { key: event.id, note: target, reaction: event };
      } else if (this.shown.includes(event.kind)) {
        if (event.kind === 30023 && articles.get(address(event) ?? "") !== event) continue;
        card = { key: event.id, note: event };
      }
      if (card && droppedNotes.has(card.note.id)) continue;
      if (card && !muted(card) && (this.source.accepts?.(card) ?? true)) result.push(card);
    }
    return result;
  });

  /** 保存した分を先に出す（技術資料 5.1）。リレーのリストを読む前に呼べる。 */
  async showSaved() {
    const scope = this.source.cacheScope;
    const me = viewer.pubkey;
    if (!me) return;
    if (!scope && !this.source.saved) return;
    const saved = scope ? await readScope(me, scope, 300) : await this.source.saved!();
    const targets = saved.filter(isRepost).map(repostTarget).filter((id): id is string => !!id && !notes.has(id));
    keepNotes(await readEvents(me, targets), null);
    await this.ingest(saved, false);
  }

  /** 最初の読み込み。続けて購読する。 */
  async start() {
    this.stop();
    this.started = true;
    this.until = undefined;
    this.limit = 100;
    this.emptyRuns = 0;
    this.finished = false;
    const started = Math.floor(Date.now() / 1000);
    await this.more();
    this.stopLive = this.source.live?.(started - 30, (event) => this.queue(event));
  }

  stop() {
    this.stopLive?.();
    this.stopLive = undefined;
    clearTimeout(this.flushTimer);
  }

  /** さかのぼって読む（技術資料 4.3.1）。 */
  async more() {
    if (!this.started || this.loading || this.finished) return;
    this.loading = true;
    this.message = null;
    try {
      const fetched = await this.source.page(this.until, this.limit, (event) => this.queue(event));
      const events = eventsOf(fetched);
      await this.ingest(events);
      if (!fetched.complete && events.length === 0) {
        this.message = "読み込めませんでした。もう一度読むと続きから読みます。";
        return;
      }
      if (events.length === 0) {
        if (++this.emptyRuns >= 2) this.finished = true;
        return;
      }
      this.emptyRuns = 0;
      if (!fetched.complete) return;
      const oldest = Math.min(...events.map((event) => event.created_at));
      if (this.until !== undefined && events.every((event) => event.created_at === this.until) && events.length >= this.limit) {
        if (this.limit >= 3200) {
          this.message = "同時刻の投稿が多いため、これ以上の取得を停止しました";
          this.finished = true;
        } else this.limit *= 2;
        return;
      }
      this.until = events.length < this.limit ? oldest - 1 : oldest;
    } finally {
      this.loading = false;
    }
  }

  /** 自分で送って受理された投稿を、リレーから届くのを待たずに入れる。 */
  add(events: Event[]) {
    for (const event of events) this.queue(event);
  }

  /** 購読で届いたものは 0.12 秒ためて（最大 200 件）まとめて入れる。 */
  private queue(event: Event) {
    this.buffer.push(event);
    if (this.buffer.length >= 200) return this.flush();
    this.flushTimer ??= setTimeout(() => this.flush(), 120);
  }

  private flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const events = this.buffer;
    this.buffer = [];
    void this.ingest(events);
  }

  /** 一覧に入れる。save なら、ホームの一覧としてブラウザにも保存する。 */
  private async ingest(events: Event[], save = true) {
    const fresh = events.filter((event) => !this.events.has(event.id));
    if (fresh.length === 0) return;
    const reposts = fresh.filter(isRepost);
    const reactions = fresh.filter((event) => event.kind === 7);
    const posts = fresh.filter((event) => !isRepost(event) && event.kind !== 7);
    keepNotes(posts, null);
    keepNotes(reposts.map(embeddedTarget).filter((event): event is Event => !!event));
    for (const event of fresh) this.events.set(event.id, event);
    if (save && this.source.cacheScope && viewer.pubkey) void saveScope(viewer.pubkey, this.source.cacheScope, fresh);
    requestProfiles(fresh.flatMap((event) => [event.pubkey, ...mentionedPubkeys(event)]));
    requestRepostDeletions([...reposts, ...reactions]);
    const [found, reacted] = await Promise.all([
      resolveRepostTargets(reposts, (id) => notes.has(id), viewer.readRelays),
      resolveTargets(reactions.map(reactionTarget), reactions.flatMap(lastAuthor), (id) => notes.has(id), viewer.readRelays, REACTION_TARGET_KINDS),
    ]);
    keepNotes([...found, ...reacted]);
    const targets = [...reposts.map((event) => repostTarget(event)), ...reactions.map(reactionTarget)]
      .map((id) => notes.get(id ?? ""))
      .filter((event): event is Event => !!event);
    requestProfiles(targets.flatMap((event) => [event.pubkey, ...mentionedPubkeys(event)]));
  }
}

/** リアクションの先の作者（最後の `p`）。 */
function lastAuthor(event: Event): string[] {
  const tag = event.tags.findLast((t) => t[0] === "p" && t.length >= 2);
  return tag ? [tag[1]] : [];
}
