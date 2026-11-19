import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { actor, NOT_TARGETS, NOTIFICATION_KINDS, notificationGroups, notificationTarget, reactedTo, shownAsNotification, type NotificationType } from "../domain/notifications";
import { WATCH_KINDS, watchSince, type WatchRule } from "../domain/watchedPosts";
import { postWatch } from "./postWatch.svelte";
import { byNewest, type Event, type Filter } from "../nostr/events";
import { fetchFromAuthor, fetchFromAuthors, loadRelayLists, planAuthors, subscribeAuthors } from "../nostr/outbox";
import { delay, eventsOf, merge, pool, type Fetched } from "../nostr/pool";
import { lnurlpEndpoint, parseLightningAddress } from "../domain/zaps";
import { isInteraction } from "../domain/interactions";
import { isHex64 } from "../nostr/events";
import { keepNotes, notes, profiles, requestProfiles } from "./cache.svelte";
import { readEvents, readScope, saveScope } from "./db";
import { viewer } from "./viewer.svelte";

/**
 * 通知（技術資料 5.3）。読み込みリレーへの一回きりの取得と、フォロー中の人の書き込みリレーへの取得を同時に行い、
 * 開いている間は読み込みリレーを購読し続ける。既読と絞り込みは、見る人ごとにブラウザに保存する。
 */

const LIMIT_MS = 40_000;
const STALE_MS = 45_000;
const MAX_EVENTS = 500;
const MAX_READ = 3000;

interface Saved { read: string[]; type: NotificationType; following: boolean }

function storageKey(pubkey: string) {
  return `notifications.${pubkey}`;
}

class Notifications {
  readonly events = new SvelteMap<string, Event>();
  readonly read = new SvelteSet<string>();
  type = $state<NotificationType>("all");
  following = $state(false);
  /** 自分宛ての zap レシートを署名してよい鍵（自分の Lightning アドレスのサーバーの nostrPubkey）。分からなければ null。 */
  zapIssuer = $state<string | null>(null);
  private issuerAsked: string | null = null;
  loading = $state(false);
  finished = $state(false);
  message = $state<string | null>(null);
  /** 見る人。unread がこれに応じて数え直すよう、$state にする。 */
  private owner = $state<string | null>(null);
  private until: number | undefined;
  private limit = 100;
  private emptyRuns = 0;
  private startedAt = 0;
  private generation = 0;
  private stopLive: (() => void) | undefined;
  /** 投稿のお知らせの分は、通知とは別にさかのぼる（よく書く人の投稿で、ほかの通知を読み飛ばさないため）。 */
  private watchUntil: number | undefined;
  private watchDone = false;
  private buffer: Event[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private hiddenAt: number | null = null;
  private networkStarted = false;
  private saved: Promise<void> = Promise.resolve();

  constructor() {
    document.addEventListener("visibilitychange", () => {
      // 裏に回ったら購読をやめ、戻ったら 30 秒前から購読し直す
      if (document.hidden) {
        this.hiddenAt = Date.now();
        this.stopLive?.();
        this.stopLive = undefined;
      } else if (this.owner && this.hiddenAt !== null) {
        this.live(Math.floor(this.hiddenAt / 1000) - 30);
        this.hiddenAt = null;
      }
    });
  }

  /** 投稿のお知らせに出す人（見る人ごと、ブラウザの中だけ）。 */
  get watches(): WatchRule[] {
    return this.owner ? postWatch.rules(this.owner) : [];
  }

  /** お知らせに出す人や条件を変えたあとに呼ぶ。読み直して、購読をやり直す。 */
  watchesChanged() {
    if (!this.owner || !this.networkStarted) return;
    this.watchUntil = undefined;
    this.watchDone = false;
    this.live(Math.floor(Date.now() / 1000) - 30);
    void this.refresh();
  }

  /** 見る人宛ての通知のうち、まだ読んでいないものの数（絞り込みによらない）。 */
  unread = $derived.by(() => {
    if (!this.owner) return 0;
    const groups = notificationGroups(this.events.values(), this.owner, { type: "all", muted: viewer.mutedPubkeys, mutedNotes: viewer.mutedEvents, words: { words: viewer.mutedWords, hashtags: viewer.mutedHashtags }, zapIssuer: this.zapIssuer, watches: this.watches });
    const ids = new Set(groups.flatMap((group) => group.events.map((event) => event.id)));
    let count = 0;
    for (const id of ids) if (!this.read.has(id)) count++;
    return count;
  });

  /**
   * 自分の Lightning アドレスのサーバーに、zap レシートを署名する鍵を見る人ごとに 1 回だけ聞く（NIP-57。Android 版の
   * NotificationsController.learnZapIssuer と同じ）。プロフィールに Lightning アドレスがなければ聞かない。
   */
  learnZapIssuer(pubkey: string) {
    const lud16 = profiles.get(pubkey)?.profile.lud16;
    if (!lud16 || this.issuerAsked === pubkey) return;
    this.issuerAsked = pubkey;
    void (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        const response = await fetch(lnurlpEndpoint(parseLightningAddress(lud16)), { headers: { Accept: "application/json" }, signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" }).finally(() => clearTimeout(timer));
        const text = response.ok ? await response.text() : "";
        const key = text.length <= 100_000 ? (JSON.parse(text || "{}") as { nostrPubkey?: unknown }).nostrPubkey : undefined;
        if (typeof key === "string" && isHex64(key) && this.owner === pubkey) this.zapIssuer = key;
      } catch {
        // 分からなければ、署名した人は比べない
      }
    })();
  }

  /** 見る人が決まったらすぐ呼ぶ。保存した既読・絞り込み・通知を出す（リレーには問い合わせない）。 */
  prepare(pubkey: string) {
    if (this.owner === pubkey) return;
    this.stop();
    this.owner = pubkey;
    this.zapIssuer = null;
    this.networkStarted = false;
    this.events.clear();
    this.read.clear();
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(pubkey)) ?? "null") as Partial<Saved> | null;
      for (const id of saved?.read ?? []) if (typeof id === "string") this.read.add(id);
      if (saved?.type) this.type = saved.type;
      this.following = saved?.following === true;
    } catch {
      // 保存がなければ最初から
    }
    this.saved = this.showSaved(pubkey);
  }

  /** 見る人のリレーのリストを読んだあとに呼ぶ。保存分を出し終えてから、取得と購読を始める。 */
  start(pubkey: string) {
    this.prepare(pubkey);
    if (this.networkStarted) return;
    this.networkStarted = true;
    const generation = this.generation;
    void this.saved.then(() => {
      if (generation !== this.generation) return;
      this.live(Math.floor(Date.now() / 1000) - 30);
      void this.refresh();
    });
  }

  /** 保存した通知と、その対象の投稿を先に出す（技術資料 5.1）。 */
  private async showSaved(me: string) {
    const watches = postWatch.rules(me);
    const saved = (await readScope(me, "notifications")).filter((event) => shownAsNotification(event, me, watches));
    const targets = [...new Set(saved.map(notificationTarget).filter((id): id is string => !!id && !notes.has(id)))];
    const found = await readEvents(me, targets);
    keepNotes(found, null);
    const reacted = found.filter((event) => isInteraction(event.kind)).map(reactedTo).filter((ref) => !!ref && !notes.has(ref.id)).map((ref) => ref!.id);
    keepNotes(await readEvents(me, reacted), null);
    if (this.owner !== me) return;
    for (const event of saved) if (!this.events.has(event.id)) this.events.set(event.id, event);
    keepNotes(saved.filter((event) => event.kind === 1 || event.kind === 1111), null);
    requestProfiles([...saved.map(actor), ...found.map((event) => event.pubkey)]);
  }

  stop() {
    this.generation++;
    this.stopLive?.();
    this.stopLive = undefined;
    this.owner = null;
    this.loading = false;
  }

  private save() {
    if (!this.owner) return;
    try {
      const saved: Saved = { read: [...this.read].slice(-MAX_READ), type: this.type, following: this.following };
      localStorage.setItem(storageKey(this.owner), JSON.stringify(saved));
    } catch {
      // 保存できなくてもこの間は使える
    }
  }

  filter(type: NotificationType = this.type, following: boolean = this.following) {
    this.type = type;
    this.following = following;
    this.save();
  }

  markRead(ids: Iterable<string>) {
    let changed = false;
    for (const id of ids) {
      if (this.read.has(id)) continue;
      this.read.add(id);
      changed = true;
    }
    if (changed) this.save();
  }

  markAllRead() {
    this.markRead(this.events.keys());
  }

  /** 最新から読み直す。 */
  refresh() {
    return this.load(false);
  }

  /** 過去の通知を読む。 */
  older() {
    return this.load(true);
  }

  private async load(older: boolean) {
    const me = this.owner;
    if (!me) return;
    // 応答しないリレーで止まった取得は、しばらくしたら捨ててやり直す
    if (this.loading && Date.now() - this.startedAt < STALE_MS) return;
    const generation = ++this.generation;
    this.startedAt = Date.now();
    this.loading = true;
    this.message = null;
    if (!older) {
      this.until = undefined;
      this.limit = 100;
      this.emptyRuns = 0;
      this.finished = false;
      this.watchUntil = undefined;
      this.watchDone = false;
    }
    const watches = this.watches;
    const filter: Filter = { kinds: NOTIFICATION_KINDS, "#p": [me], limit: this.limit, ...(this.until !== undefined ? { until: this.until } : {}) };
    const onEvent = (event: Event) => {
      if (generation === this.generation) this.queue(event);
    };
    const timeout = delay(LIMIT_MS).then(() => null);
    try {
      const watchedPage = this.fetchWatched(watches, onEvent);
      const fetched = await Promise.race([this.fetchPage(filter, onEvent), timeout]);
      if (generation !== this.generation) return;
      if (!fetched) {
        this.message = "リレーの応答が遅いため、取得を打ち切りました。取得できた通知を表示しています。再取得できます。";
        return;
      }
      const watched = await Promise.race([watchedPage, delay(LIMIT_MS).then(() => null)]);
      if (generation !== this.generation) return;
      const events = [...eventsOf(fetched), ...(watched ? eventsOf(watched) : [])].filter((event) => shownAsNotification(event, me, watches));
      await this.ingest(events);
      this.advance(eventsOf(fetched), fetched.complete);
      if (watched) this.advanceWatched(eventsOf(watched), watched.complete);
      // お知らせの分がまださかのぼれるあいだは「過去の通知を読み込む」を残す
      if (this.finished && watches.length > 0 && !this.watchDone && this.events.size < MAX_EVENTS) this.finished = false;
      if (this.events.size >= MAX_EVENTS) {
        this.message = "最新500件を表示しています";
        this.finished = true;
      } else if (!fetched.complete || (watched && !watched.complete)) this.message = "一部のリレーから取得できませんでした。";
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  /** 読み込みリレーと、フォロー中の人の書き込みリレー（常時接続リレーは足さない）から同時に読む。 */
  private async fetchPage(filter: Filter, onEvent: (event: Event) => void): Promise<Fetched> {
    const follows = viewer.follows;
    const routed = (async () => {
      if (follows.length === 0) return merge([]);
      await loadRelayLists(follows, viewer.alwaysOn);
      const plans = planAuthors(follows).filter((plan) => !viewer.readRelays.includes(plan.relay));
      const relays = [...new Set(plans.map((plan) => plan.relay))];
      return pool.fetch(relays, [filter], { onEvent, limit: 4000 });
    })();
    const own = pool.fetch(viewer.readRelays, [filter], { onEvent });
    const [ownResult, routedResult] = await Promise.all([own, routed]);
    // 完了かどうかは読み込みリレーの分で決める
    return { ...merge([ownResult, routedResult]), complete: ownResult.complete };
  }

  /** お知らせに出す人の投稿を、その人たちの書き込みリレーから読む（選んだ時刻より前は読まない）。 */
  private async fetchWatched(watches: WatchRule[], onEvent: (event: Event) => void): Promise<Fetched | null> {
    const since = watchSince(watches);
    if (since === null || this.watchDone || (this.watchUntil !== undefined && this.watchUntil < since)) return null;
    const filter: Filter = { kinds: WATCH_KINDS, since, limit: 100, ...(this.watchUntil !== undefined ? { until: this.watchUntil } : {}) };
    return fetchFromAuthors(watches.map((rule) => rule.pubkey), filter, viewer.alwaysOn, onEvent);
  }

  private advanceWatched(events: Event[], complete: boolean) {
    if (!complete) return;
    if (events.length === 0) {
      this.watchDone = true;
      return;
    }
    const oldest = Math.min(...events.map((event) => event.created_at));
    this.watchUntil = oldest - 1;
  }

  /** さかのぼり方（技術資料 4.3.1 と同じ）。 */
  private advance(events: Event[], complete: boolean) {
    if (events.length === 0) {
      if (complete && ++this.emptyRuns >= 2) this.finished = true;
      return;
    }
    this.emptyRuns = 0;
    if (!complete) return;
    const oldest = Math.min(...events.map((event) => event.created_at));
    if (this.until !== undefined && events.every((event) => event.created_at === this.until) && events.length >= this.limit) {
      if (this.limit >= 3200) {
        this.message = "同時刻の通知が多いため、一部のみ表示しています";
        this.finished = true;
      } else this.limit *= 2;
      return;
    }
    this.until = events.length < this.limit ? oldest - 1 : oldest;
  }

  /** 読み込みリレーで、同じフィルタを since から購読し続ける。 */
  private live(since: number) {
    const me = this.owner;
    if (!me) return;
    this.stopLive?.();
    const own = pool.subscribe(viewer.readRelays, [{ kinds: NOTIFICATION_KINDS, "#p": [me], since, limit: 50 }], (event) => this.queue(event));
    // お知らせに出す人は、その人たちの書き込みリレーで購読する
    const watched = this.watches.map((rule) => rule.pubkey);
    const others = watched.length > 0 ? subscribeAuthors(watched, { kinds: WATCH_KINDS, since, limit: 50 }, viewer.alwaysOn, (event) => this.queue(event)) : undefined;
    this.stopLive = () => {
      own();
      others?.();
    };
  }

  /** 届いたものは 0.4 秒ためてから入れる。 */
  private queue(event: Event) {
    this.buffer.push(event);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined;
      const events = this.buffer;
      this.buffer = [];
      const me = this.owner;
      if (me) {
        const watches = this.watches;
        void this.ingest(events.filter((e) => shownAsNotification(e, me, watches)));
      }
    }, 400);
  }

  private async ingest(incoming: Event[]) {
    const fresh = incoming.filter((event) => !this.events.has(event.id));
    if (fresh.length === 0) return;
    for (const event of fresh) this.events.set(event.id, event);
    // 一覧に残すのは新しい 500 件まで
    if (this.events.size > MAX_EVENTS) {
      for (const event of [...this.events.values()].sort(byNewest).slice(MAX_EVENTS)) this.events.delete(event.id);
    }
    keepNotes(fresh.filter((event) => event.kind === 1 || event.kind === 1111), null);
    if (this.owner) void saveScope(this.owner, "notifications", fresh);
    requestProfiles(fresh.map(actor));
    await this.fillTargets(fresh);
  }

  /** 通知の対象の投稿を、自分の書き込みリレーと読み込みリレーから読む（種類を問わない）。 */
  private async fillTargets(events: Event[]) {
    const me = this.owner;
    if (!me) return;
    const missing = [...new Set(events.map(notificationTarget).filter((id): id is string => !!id && !notes.has(id)))].slice(0, 100);
    if (missing.length > 0) {
      const fetched = await fetchFromAuthor(me, [{ ids: missing, limit: missing.length }], viewer.readRelays);
      keepNotes(eventsOf(fetched).filter((event) => missing.includes(event.id) && !NOT_TARGETS.includes(event.kind)));
    }
    const targets = events.map(notificationTarget).map((id) => (id ? notes.get(id) : undefined)).filter((event): event is Event => !!event);
    requestProfiles(targets.map((event) => event.pubkey));
    // あなたのリアクションへのリアクション: リアクションした先の投稿も、その作者のリレーから読む
    const reacted = targets.filter((event) => isInteraction(event.kind)).map(reactedTo).filter((ref) => !!ref && !notes.has(ref.id)).slice(0, 50);
    const byAuthor = new Map<string, string[]>();
    for (const ref of reacted) byAuthor.set(ref!.author ?? me, [...(byAuthor.get(ref!.author ?? me) ?? []), ref!.id]);
    await Promise.all([...byAuthor].map(async ([author, ids]) => {
      const fetched = await fetchFromAuthor(author, [{ ids, limit: ids.length }], viewer.readRelays);
      const found = eventsOf(fetched).filter((event) => ids.includes(event.id) && !NOT_TARGETS.includes(event.kind));
      keepNotes(found);
      requestProfiles(found.map((event) => event.pubkey));
    }));
  }
}

export const notifications = new Notifications();

/** 対象の投稿を 1 件読む（未取得の通知を押したとき）。 */
export async function fetchTarget(id: string, author: string): Promise<Event | null> {
  const fetched = await fetchFromAuthor(author, [{ ids: [id], limit: 1 }], viewer.readRelays);
  const found = eventsOf(fetched).find((event) => event.id === id && !NOT_TARGETS.includes(event.kind)) ?? null;
  if (found) keepNotes([found]);
  return found;
}
