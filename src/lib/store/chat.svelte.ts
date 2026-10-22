import { SvelteMap } from "svelte/reactivity";
import { buildChannel, buildMessage, channelMeta, joinedChannels, messageChannel, type ChannelMeta } from "../domain/chat";
import { nextList, withoutTag, withTag } from "../domain/lists";
import { latest, type Event } from "../nostr/events";
import { delay, eventsOf, pool, publish, type PublishResult } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { keepNotes, requestProfiles } from "./cache.svelte";
import { settings } from "./settings.svelte";
import { viewer } from "./viewer.svelte";

/**
 * パブリックチャット（NIP-28。Android 版の PublicChatController・技術資料 5.8・6.9）。チャンネルの一覧（参加中の
 * kind 10005 と、読み込みリレーの kind 40）と、開いたチャンネルのメッセージ（kind 42、購読し続ける）。ミュートした人と
 * メッセージは出さない（技術資料 8.3）。
 */

const LIST_LIMIT_MS = 30_000;
const now = () => Math.floor(Date.now() / 1000);

export interface Channel {
  id: string;
  create: Event;
  meta: ChannelMeta;
  /** 一覧で見えている最新のメッセージの時刻（並べ替えに使う）。 */
  lastAt: number;
}

class Chat {
  readonly channels = new SvelteMap<string, Channel>();
  joinedEvent = $state<Event>();
  joined = $derived(joinedChannels(this.joinedEvent));
  loading = $state(false);
  message = $state<string | null>(null);
  /** 開いているチャンネルのメッセージ（古い順）。 */
  current = $state<string | null>(null);
  messages = $state<Event[]>([]);
  messagesLoading = $state(false);
  sending = $state(false);
  private stopLive: (() => void) | undefined;
  private updates = new Map<string, Event[]>();
  private loadedFor: string | null = null;
  /** 開いているチャンネルで、もう出したメッセージ（送ったものと購読で届いたものが重ならないように）。 */
  private seen = new Set<string>();

  /** 一覧を読む（最初に開いたときと「更新」）。 */
  async load(force = false) {
    const me = viewer.pubkey;
    if (!me || this.loading || (!force && this.loadedFor === me)) return;
    this.loadedFor = me;
    this.loading = true;
    this.message = null;
    try {
      const timeout = delay(LIST_LIMIT_MS).then(() => "timeout" as const);
      const work = (async () => {
        const [joinedFetched, created] = await Promise.all([
          pool.fetch(viewer.readRelays, [{ kinds: [10005], authors: [me], limit: 5 }]),
          pool.fetch(viewer.readRelays, [{ kinds: [40], limit: 200 }], { onEvent: (event) => this.keepChannel(event) }),
        ]);
        this.joinedEvent = latest(eventsOf(joinedFetched).filter((e) => e.pubkey === me)) ?? this.joinedEvent;
        for (const event of eventsOf(created)) this.keepChannel(event);
        const missing = this.joined.filter((id) => !this.channels.has(id));
        if (missing.length > 0) for (const event of eventsOf(await pool.fetch(viewer.readRelays, [{ ids: missing, limit: missing.length }]))) this.keepChannel(event);
        const ids = [...this.channels.keys()];
        if (ids.length > 0) {
          const updates = await pool.fetch(viewer.readRelays, [{ kinds: [41], "#e": ids.slice(0, 200), limit: 400 }]);
          for (const event of eventsOf(updates)) this.keepUpdate(event);
        }
        if (this.joined.length > 0) {
          const recent = await pool.fetch(viewer.readRelays, [{ kinds: [42], "#e": this.joined, limit: 250 }]);
          for (const event of eventsOf(recent)) this.touch(event);
        }
      })();
      if ((await Promise.race([work, timeout])) === "timeout") this.message = "チャンネルの一覧を 30 秒で打ち切りました。取れた分を出しています。";
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  private keepChannel(event: Event) {
    if (event.kind !== 40 || this.channels.has(event.id)) return;
    this.channels.set(event.id, { id: event.id, create: event, meta: channelMeta(event, this.updates.get(event.id) ?? []), lastAt: event.created_at });
  }

  private keepUpdate(event: Event) {
    const id = event.tags.find((t) => t[0] === "e")?.[1];
    if (!id) return;
    this.updates.set(id, [...(this.updates.get(id) ?? []), event]);
    const channel = this.channels.get(id);
    if (channel) this.channels.set(id, { ...channel, meta: channelMeta(channel.create, this.updates.get(id)!) });
  }

  private touch(message: Event) {
    const id = messageChannel(message);
    const channel = id ? this.channels.get(id) : undefined;
    if (channel && message.created_at > channel.lastAt) this.channels.set(channel.id, { ...channel, lastAt: message.created_at });
  }

  /** チャンネルを読む（一覧になければ ID で）。 */
  async channel(id: string): Promise<Channel | undefined> {
    if (!this.channels.has(id)) {
      const fetched = await pool.fetch(viewer.readRelays, [{ ids: [id], limit: 1 }, { kinds: [41], "#e": [id], limit: 20 }]);
      for (const event of eventsOf(fetched)) {
        if (event.kind === 41) this.keepUpdate(event);
      }
      for (const event of eventsOf(fetched)) this.keepChannel(event);
    }
    return this.channels.get(id);
  }

  /** メッセージを読む先（チャンネルの relays と読み込みリレー、合わせて 12 件まで）。 */
  private relaysFor(channel: Channel) {
    return relaySet([...channel.meta.relays, ...viewer.readRelays], 12);
  }

  /** チャンネルを開く。メッセージを読み、届くものを購読する。 */
  async open(id: string) {
    this.close();
    this.current = id;
    this.messages = [];
    this.messagesLoading = true;
    try {
      const channel = await this.channel(id);
      if (this.current !== id) return;
      const relays = channel ? this.relaysFor(channel) : viewer.readRelays;
      this.seen = new Set();
      const add = (event: Event) => {
        if (this.current !== id || event.kind !== 42 || this.seen.has(event.id) || messageChannel(event) !== id) return;
        this.seen.add(event.id);
        this.messages = [...this.messages, event].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
        keepNotes([event], null);
        requestProfiles([event.pubkey]);
        this.touch(event);
      };
      const fetched = await pool.fetch(relays, [{ kinds: [42], "#e": [id], limit: 400 }], { onEvent: add });
      for (const event of eventsOf(fetched)) add(event);
      if (this.current !== id) return;
      this.stopLive = pool.subscribe(relays, [{ kinds: [42], "#e": [id], since: now() - 30 }], add);
    } finally {
      if (this.current === id) this.messagesLoading = false;
    }
  }

  close() {
    this.stopLive?.();
    this.stopLive = undefined;
    this.current = null;
  }

  /** メッセージを送る（技術資料 6.9）。送り先はチャンネルの relays と自分の書き込みリレーの先頭 2 件（8 件まで）。 */
  async send(channelId: string, body: string, replyTo?: Event): Promise<PublishResult> {
    if (!viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
    const channel = await this.channel(channelId);
    const relay = channel?.meta.relays[0] ?? viewer.writeRelays[0] ?? "";
    this.sending = true;
    try {
      const signer = await viewer.getSigner();
      const event = await signer.sign(buildMessage(channelId, relay, body, now(), replyTo, settings.clientTag));
      const relays = relaySet([...(channel?.meta.relays ?? []), ...viewer.writeRelays.slice(0, 2)], 8);
      const result = await publish(relays, event);
      if (result.accepted > 0 && this.current === channelId && !this.seen.has(event.id)) {
        this.seen.add(event.id);
        this.messages = [...this.messages, event];
        keepNotes([event], null);
      }
      return result;
    } finally {
      this.sending = false;
    }
  }

  /** チャンネルを作る（kind 40）。置くリレーへ送り、参加中にも足す。 */
  async create(name: string, about: string, relays: string[]): Promise<string> {
    const signer = await viewer.getSigner();
    const event = await signer.sign(buildChannel(name, about, relays, now()));
    const result = await publish(relaySet(relays), event);
    if (result.accepted === 0) throw new Error("チャンネルを置くリレーに受理されませんでした");
    this.keepChannel(event);
    await this.setJoined(event.id, true);
    return event.id;
  }

  /**
   * 参加・退出（kind 10005）。取り直してから、そのチャンネルの `e` だけを足し引きする（ほかのタグと content は残す）。
   */
  async setJoined(id: string, join: boolean): Promise<PublishResult> {
    const me = viewer.pubkey;
    if (!me || !viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
    const fetched = await pool.fetch(relaySet([...viewer.readRelays, ...viewer.writeRelays]), [{ kinds: [10005], authors: [me], limit: 5 }]);
    if (!fetched.complete) throw new Error("参加中のチャンネルの一覧を取り直せなかったので、変えませんでした。");
    const base = latest([...eventsOf(fetched).filter((e) => e.pubkey === me), ...(this.joinedEvent ? [this.joinedEvent] : [])]);
    const channel = this.channels.get(id);
    const tags = base ? base.tags.map((t) => [...t]) : [];
    const next = join ? withTag(tags, ["e", id, channel?.meta.relays[0] ?? ""]) : withoutTag(tags, "e", id);
    const signer = await viewer.getSigner();
    const event = await signer.sign(nextList(10005, base, next, now()));
    const result = await publish(viewer.writeRelays, event);
    if (result.accepted > 0) this.joinedEvent = event;
    return result;
  }
}

export const chat = new Chat();
