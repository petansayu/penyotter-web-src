import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { actor, eligible, NOT_TARGETS, NOTIFICATION_KINDS, notificationGroups, notificationTarget, reactedTo, type NotificationType } from "../domain/notifications";
import { byNewest, type Event, type Filter } from "../nostr/events";
import { fetchFromAuthor, loadRelayLists, planAuthors } from "../nostr/outbox";
import { delay, eventsOf, merge, pool, type Fetched } from "../nostr/pool";
import { keepNotes, notes, requestProfiles } from "./cache.svelte";
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

  /** 見る人宛ての通知のうち、まだ読んでいないものの数（絞り込みによらない）。 */
  unread = $derived.by(() => {
    if (!this.owner) return 0;
    const groups = notificationGroups(this.events.values(), this.owner, { type: "all", muted: viewer.mutedPubkeys, mutedNotes: viewer.mutedEvents });
    const ids = new Set(groups.flatMap((group) => group.events.map((event) => event.id)));
    let count = 0;
    for (const id of ids) if (!this.read.has(id)) count++;
    return count;
  });

  /** 見る人が決まったらすぐ呼ぶ。保存した既読・絞り込み・通知を出す（リレーには問い合わせない）。 */
  prepare(pubkey: string) {
    if (this.owner === pubkey) return;
    this.stop();
    this.owner = pubkey;
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
    const saved = (await readScope(me, "notifications")).filter((event) => eligible(event, me));
    const targets = [...new Set(saved.map(notificationTarget).filter((id): id is string => !!id && !notes.has(id)))];
    const found = await readEvents(me, targets);
    keepNotes(found, null);
    const reacted = found.filter((event) => event.kind === 7).map(reactedTo).filter((ref) => !!ref && !notes.has(ref.id)).map((ref) => ref!.id);
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
    }
    const filter: Filter = { kinds: NOTIFICATION_KINDS, "#p": [me], limit: this.limit, ...(this.until !== undefined ? { until: this.until } : {}) };
    const onEvent = (event: Event) => {
      if (generation === this.generation) this.queue(event);
    };
    const timeout = delay(LIMIT_MS).then(() => null);
    try {
      const fetched = await Promise.race([this.fetchPage(filter, onEvent), timeout]);
      if (generation !== this.generation) return;
      if (!fetched) {
        this.message = "リレーの応答が遅いため、取得を打ち切りました。取得できた通知を表示しています。再取得できます。";
        return;
      }
      const events = eventsOf(fetched).filter((event) => eligible(event, me));
      await this.ingest(events);
      this.advance(eventsOf(fetched), fetched.complete);
      if (this.events.size >= MAX_EVENTS) {
        this.message = "最新500件を表示しています";
        this.finished = true;
      } else if (!fetched.complete) this.message = "一部のリレーから取得できませんでした。";
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  /** 読み込みリレーと、フォロー中の人の書き込みリレー（常時接続リレーは足さない）から同時に読む。 */
  private async fetchPage(filter: Filter, onEvent: (event: Event) => void): Promise<Fetched> {
    const follows = viewer.follows.slice(0, 500);
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
    this.stopLive = pool.subscribe(viewer.readRelays, [{ kinds: NOTIFICATION_KINDS, "#p": [me], since, limit: 50 }], (event) => this.queue(event));
  }

  /** 届いたものは 0.4 秒ためてから入れる。 */
  private queue(event: Event) {
    this.buffer.push(event);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined;
      const events = this.buffer;
      this.buffer = [];
      const me = this.owner;
      if (me) void this.ingest(events.filter((e) => eligible(e, me)));
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
    const reacted = targets.filter((event) => event.kind === 7).map(reactedTo).filter((ref) => !!ref && !notes.has(ref.id)).slice(0, 50);
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
