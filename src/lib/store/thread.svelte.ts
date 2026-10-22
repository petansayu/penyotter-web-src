import { SvelteMap } from "svelte/reactivity";
import { mentionedPubkeys } from "../domain/content";
import { deletedBy, deletionKeys, reactionTarget } from "../domain/interactions";
import { chain, descendants, parent, reference } from "../domain/threads";
import { isHex64, type Event, type Filter } from "../nostr/events";
import { fetchFromAuthor, loadRelayLists, relayLists } from "../nostr/outbox";
import { eventsOf, pool } from "../nostr/pool";
import { publicRelay, relaySet } from "../nostr/relayUrl";
import { keepNotes, notes, requestProfiles } from "./cache.svelte";
import { readEvents, readScope } from "./db";
import { viewer } from "./viewer.svelte";

/**
 * 投稿の詳細（技術資料 5.4）。選んだ投稿、返信元（20 段まで）、返信と返信の返信、リポストとリアクション（と、
 * リアクションへのリアクション）。返信は開いている間、5 秒前から購読し続け、届いた分は「新しい返信」として知らせる。
 */
export class Thread {
  selected = $state<Event | null>(null);
  loading = $state(true);
  message = $state<string | null>(null);
  /** 選んだ投稿が届いたリレー。 */
  relays = $state<string[]>([]);
  private readonly related = new SvelteMap<string, Event>();
  /** リアクション（本人が取り消したものは除く）。 */
  reactions = $state<Event[]>([]);
  /** リポスト（kind 6・16）。 */
  reposts = $state<Event[]>([]);
  /** リアクションへのリアクション（リアクションの ID ごと）。 */
  readonly reactionReactions = new SvelteMap<string, Event[]>();
  /** リポストとリアクションを取り切れたか（できなければ数に「+」）。 */
  interactionsComplete = $state(false);
  /** 購読で届いた、まだ出していない返信。 */
  pendingReplies = $state<Event[]>([]);
  private replyRelays: string[] = [];
  private closeLive: (() => void) | null = null;
  private stopped = false;

  constructor(private readonly id: string, private readonly hints: string[] = [], private readonly author?: string) {}

  ancestors = $derived.by(() => (this.selected ? chain(this.selected, this.related.values()) : null));
  replies = $derived.by(() => (this.selected ? descendants(this.selected, this.related.values()) : []));

  async load() {
    await this.showSaved();
    const read = relaySet([...this.hints, ...viewer.readRelays]);
    const filters: Filter[] = [{ ids: [this.id], limit: 1 }];
    const fetched = this.author ? await fetchFromAuthor(this.author, filters, viewer.readRelays, this.hints) : await pool.fetch(read, filters);
    const entry = fetched.events.get(this.id);
    const selected = entry?.event ?? this.selected ?? notes.get(this.id) ?? null;
    this.relays = entry ? [...entry.relays] : [];
    this.selected = selected;
    if (!selected) {
      this.loading = false;
      this.message = "投稿が見つかりませんでした。";
      return;
    }
    keepNotes([selected]);
    this.keep([selected]);
    await Promise.all([this.loadAncestors(selected), this.loadReplies(selected), this.loadInteractions(selected)]);
    this.loading = false;
    this.startLive(selected);
  }

  /** 画面を閉じたら購読をやめる。 */
  stop() {
    this.stopped = true;
    this.closeLive?.();
    this.closeLive = null;
  }

  /** 「新しい返信」を押したら、届いた返信を出す。 */
  acknowledgeReplies() {
    this.keep(this.pendingReplies);
    this.pendingReplies = [];
  }

  /** 返信を 5 秒前から購読し続ける。 */
  private startLive(selected: Event) {
    if (this.stopped || this.replyRelays.length === 0) return;
    const ref = reference(selected);
    const since = Math.floor(Date.now() / 1000) - 5;
    const filter: Filter = isHex64(ref) ? { kinds: [1, 1111], "#e": [ref], since } : { kinds: [1, 1111], "#a": [ref], since };
    this.closeLive = pool.subscribe(this.replyRelays, [filter], (event) => {
      if (this.related.has(event.id) || this.pendingReplies.some((e) => e.id === event.id) || parent(event) === null) return;
      this.pendingReplies = [...this.pendingReplies, event];
      requestProfiles([event.pubkey]);
    });
  }

  /** リポスト・リアクションと、その取り消し、リアクションへのリアクション（読み込みリレーと投稿が見つかったリレー）。 */
  private async loadInteractions(selected: Event) {
    const relays = relaySet([...viewer.readRelays, ...this.relays]);
    const id = selected.id;
    const first = await pool.fetch(relays, [{ kinds: [6, 7, 16], "#e": [id], limit: 500 }]);
    const events = eventsOf(first).filter((e) => (e.kind === 7 ? reactionTarget(e) === id : e.tags.some((t) => t[0] === "e" && t[1] === id)));
    const reactionIds = events.filter((e) => e.kind === 7).map((e) => e.id);
    const second = events.length > 0
      ? eventsOf(await pool.fetch(relays, [{ kinds: [5], "#e": events.map((e) => e.id) }, ...(reactionIds.length ? [{ kinds: [7], "#e": reactionIds }] : [])]))
      : [];
    const nested = second.filter((e) => e.kind === 7 && reactionIds.includes(reactionTarget(e) ?? ""));
    const third = nested.length > 0 ? eventsOf(await pool.fetch(relays, [{ kinds: [5], "#e": nested.map((e) => e.id) }])) : [];
    const keys = deletionKeys([...second, ...third]);
    const alive = (e: Event) => !deletedBy(keys, e);
    const byTime = (a: Event, b: Event) => a.created_at - b.created_at;
    this.reactions = events.filter((e) => e.kind === 7 && alive(e)).sort(byTime);
    this.reposts = events.filter((e) => e.kind !== 7 && alive(e)).sort(byTime);
    this.reactionReactions.clear();
    for (const reaction of nested.filter(alive).sort(byTime)) {
      const target = reactionTarget(reaction)!;
      this.reactionReactions.set(target, [...(this.reactionReactions.get(target) ?? []), reaction]);
    }
    this.interactionsComplete = first.complete;
    requestProfiles([...events, ...nested].map((e) => e.pubkey));
  }

  /**
   * 保存分を先に出す（技術資料 5.1）。選んだ投稿、たどれる分の返信元、保存分（見た投稿・ホーム）の中の返信。
   * リレーに問い合わせる前に出し、そのあとリレーから読み直す。
   */
  private async showSaved() {
    const me = viewer.pubkey;
    if (!me) return;
    const selected = notes.get(this.id) ?? (await readEvents(me, [this.id]))[0];
    if (!selected || this.selected) return;
    this.selected = selected;
    this.related.set(selected.id, selected);
    for (let depth = 0; depth < 20; depth++) {
      const missing = chain(selected, this.related.values()).missing;
      if (!missing || !isHex64(missing)) break;
      const found = notes.get(missing) ?? (await readEvents(me, [missing]))[0];
      if (!found) break;
      this.related.set(found.id, found);
    }
    const saved = [...notes.values(), ...(await readScope(me, "notes")), ...(await readScope(me, "home"))];
    // 返信と返信の返信（選んだ投稿から 2 段まで）
    const refs = new Set([reference(selected)]);
    for (let depth = 0; depth < 2; depth++) {
      const found = saved.filter((event) => !this.related.has(event.id) && refs.has(parent(event) ?? ""));
      for (const event of found) {
        this.related.set(event.id, event);
        refs.add(reference(event));
      }
    }
    requestProfiles([...this.related.values()].flatMap((event) => [event.pubkey, ...mentionedPubkeys(event)]));
  }

  private keep(events: Event[]) {
    for (const event of events) this.related.set(event.id, event);
    keepNotes(events);
    requestProfiles(events.flatMap((event) => [event.pubkey, ...mentionedPubkeys(event)]));
  }

  /** 返信元を 1 段ずつたどる。全体で 20 秒かけても届かなければ知らせる。 */
  private async loadAncestors(selected: Event) {
    const deadline = Date.now() + 20_000;
    for (let depth = 0; depth < 20 && Date.now() < deadline; depth++) {
      const missing = chain(selected, this.related.values()).missing;
      if (!missing) return;
      const known = notes.get(missing);
      if (known) {
        this.keep([known]);
        continue;
      }
      let filter: Filter;
      // ID で探すときは種類を付けない（技術資料 5.4。記事・画像の投稿などへのコメントの親も取れるように）
      if (isHex64(missing)) filter = { ids: [missing] };
      else {
        const [kind, author, d] = missing.split(":");
        if (!kind || !author || d === undefined) return;
        filter = { kinds: [Number(kind)], authors: [author], "#d": [d] };
      }
      const events = eventsOf(await this.fetchParent(missing, filter, selected)).filter((event) => reference(event) === missing);
      if (events.length === 0) break;
      this.keep(events);
    }
    if (chain(selected, this.related.values()).missing) this.message = "返信元の一部を取得できませんでした";
  }

  /**
   * 返信元を読む。読み込みリレーのほか、返信に書かれたリレーヒントと、返信先の人（`e` タグの 5 つ目、なければ
   * 返信した人以外の最初の `p`）の書き込みリレーからも探す（Web 版だけの追加。読み込みリレーが受信専用の
   * リレーばかりの人だと、読み込みリレーにはないことが多いため）。
   */
  private fetchParent(missing: string, filter: Filter, selected: Event) {
    const ancestors = chain(selected, this.related.values()).ancestors;
    const child = ancestors[0] ?? selected;
    const tag = child.tags.find((t) => (t[0] === "e" || t[0] === "a") && t[1] === missing);
    const hints = relaySet([tag?.[2] ?? "", ...this.relays].filter(Boolean), 4, publicRelay);
    const author = isHex64(missing)
      ? (isHex64(tag?.[4]) ? tag![4] : child.tags.find((t) => t[0] === "p" && isHex64(t[1]) && t[1] !== child.pubkey)?.[1])
      : missing.split(":")[1];
    return author ? fetchFromAuthor(author, [filter], viewer.readRelays, hints) : pool.fetch(relaySet([...hints, ...viewer.readRelays]), [filter]);
  }

  /** 返信は、読み込みリレーと、投稿者の読み込みリレー（NIP-65 で返信が届く先）と、投稿が見つかったリレーから読む。 */
  private async loadReplies(selected: Event) {
    await loadRelayLists([selected.pubkey], viewer.readRelays);
    const relays = relaySet([...viewer.readRelays, ...(relayLists.get(selected.pubkey)?.list?.read.slice(0, 4) ?? []), ...this.relays]);
    this.replyRelays = relays;
    const ref = reference(selected);
    const filter: Filter = isHex64(ref) ? { kinds: [1, 1111], "#e": [ref] } : { kinds: [1, 1111], "#a": [ref] };
    const replies = eventsOf(await pool.fetch(relays, [filter]))
      .filter((event) => parent(event) !== null);
    this.keep(replies);
    const ids = replies.map((event) => event.id).slice(0, 100);
    if (ids.length > 0) this.keep(eventsOf(await pool.fetch(relays, [{ kinds: [1, 1111], "#e": ids }])));
  }
}
