import { SvelteMap } from "svelte/reactivity";
import { buildFileRumor, buildInbox, buildLegacyDm, buildRumor, conversationPeer, encryptFile, fileOf, giftWrap, inboxRelays, sealTemplate, unwrap, type DmFile, type Rumor } from "../domain/dm";
import { uploadRaw } from "./upload";
import { isHex64, latest, type Event } from "../nostr/events";
import { INDEXER_RELAYS } from "../nostr/outbox";
import { eventsOf, pool, publish, type PublishResult } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { SignerError } from "../nostr/signer";
import { requestProfiles } from "./cache.svelte";
import { viewer } from "./viewer.svelte";

/**
 * DM（Android 版の DirectMessagesController・技術資料 5.7・6.8）。署名できるアカウントでだけ読む。NIP-17 の gift wrap
 * （kind 1059）を自分の DM 受信リレー（kind 10050）と読み込みリレーから読み、署名役に復号を頼む。旧方式の NIP-04
 * （kind 4）は読むだけ。送るのは NIP-17 で、相手宛てを相手の DM 受信リレーへ、自分宛ての控えを自分の DM 受信リレー
 * （なければ書き込みリレー）へ送る。
 */

export interface DirectMessage {
  id: string;
  pubkey: string;
  peer: string;
  created_at: number;
  content: string;
  protocol: "nip17" | "nip04";
  /** ファイル（kind 15）。 */
  file?: DmFile;
}

export interface Conversation {
  peer: string;
  messages: DirectMessage[];
  last: DirectMessage;
  unread: boolean;
}

const LIMIT = 200;
const INBOX_CACHE_MS = 10 * 60_000;
/** gift wrap の時刻は 0〜2 日前にずらしてあるので、購読はそれより前から。 */
const WRAP_JITTER = 2 * 24 * 3600 + 600;
const now = () => Math.floor(Date.now() / 1000);

class DirectMessages {
  readonly messages = new SvelteMap<string, DirectMessage>();
  loading = $state(false);
  error = $state<string | null>(null);
  /** 自分の DM 受信リレー（読んだもの）。null はまだ読んでいない。 */
  inbox = $state<string[] | null>(null);
  inboxEvent = $state<Event>();
  private readMarks = $state<Record<string, number>>({});
  private owner: string | null = null;
  private stopLive: (() => void) | undefined;
  private seenWraps = new Set<string>();
  private inboxAt = 0;
  private peerInbox = new Map<string, { relays: string[]; at: number }>();

  conversations = $derived.by((): Conversation[] => {
    const groups = new Map<string, DirectMessage[]>();
    for (const message of this.messages.values()) {
      if (viewer.mutedPubkeys.has(message.peer)) continue;
      groups.set(message.peer, [...(groups.get(message.peer) ?? []), message]);
    }
    return [...groups].map(([peer, list]) => {
      const messages = list.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
      const last = messages[messages.length - 1];
      const unread = messages.some((m) => m.pubkey !== viewer.pubkey && m.created_at > (this.readMarks[peer] ?? 0));
      return { peer, messages, last, unread };
    }).sort((a, b) => b.last.created_at - a.last.created_at);
  });

  unreadCount = $derived(this.conversations.filter((c) => c.unread).length);

  private marksKey = (me: string) => `dm-read.${me}`;

  /** 見る人が変わったら空にする。 */
  private reset(me: string | null) {
    if (this.owner === me) return;
    this.stopLive?.();
    this.stopLive = undefined;
    this.owner = me;
    this.messages.clear();
    this.seenWraps.clear();
    this.inbox = null;
    this.inboxEvent = undefined;
    this.inboxAt = 0;
    this.error = null;
    try {
      this.readMarks = me ? (JSON.parse(localStorage.getItem(this.marksKey(me)) ?? "{}") as Record<string, number>) : {};
    } catch {
      this.readMarks = {};
    }
  }

  /** 会話を読んだ印（未読の印を消す）。 */
  markRead(peer: string) {
    const me = viewer.pubkey;
    const conversation = this.conversations.find((c) => c.peer === peer);
    if (!me || !conversation || (this.readMarks[peer] ?? 0) >= conversation.last.created_at) return;
    this.readMarks = { ...this.readMarks, [peer]: conversation.last.created_at };
    try {
      localStorage.setItem(this.marksKey(me), JSON.stringify(this.readMarks));
    } catch {
      // 覚えられなくても読める
    }
  }

  /** 自分の DM 受信リレー（kind 10050）を、読み込みリレーと書き込みリレーから読む（10 分覚える）。 */
  async loadInbox(force = false): Promise<{ relays: string[]; complete: boolean }> {
    const me = viewer.pubkey;
    if (!me) return { relays: [], complete: false };
    if (!force && this.inbox && Date.now() - this.inboxAt < INBOX_CACHE_MS) return { relays: this.inbox, complete: true };
    const fetched = await pool.fetch(relaySet([...viewer.readRelays, ...viewer.writeRelays]), [{ kinds: [10050], authors: [me], limit: 5 }]);
    const event = latest(eventsOf(fetched).filter((e) => e.pubkey === me));
    if (fetched.complete || event) {
      this.inboxEvent = event;
      this.inbox = inboxRelays(event);
      this.inboxAt = Date.now();
    }
    return { relays: this.inbox ?? [], complete: fetched.complete };
  }

  /** 読む（DM の画面を開いたとき）。 */
  async load() {
    const me = viewer.pubkey;
    this.reset(me);
    if (!me || this.loading) return;
    if (!viewer.canSign) {
      this.error = "見るだけのアカウントでは DM を読めません。";
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const signer = await viewer.getSigner();
      const { relays: inbox } = await this.loadInbox();
      const from = relaySet([...inbox, ...viewer.readRelays]);
      const [wraps, legacy] = await Promise.all([
        pool.fetch(from, [{ kinds: [1059], "#p": [me], limit: LIMIT }]),
        pool.fetch(viewer.readRelays, [{ kinds: [4], "#p": [me], limit: LIMIT }, { kinds: [4], authors: [me], limit: LIMIT }]),
      ]);
      if (viewer.pubkey !== me) return;
      await this.openWraps(eventsOf(wraps), signer.nip44Decrypt.bind(signer), me);
      await this.openLegacy(eventsOf(legacy), signer.nip04Decrypt.bind(signer), me);
      // 届く分を購読する（gift wrap の時刻はずらしてあるので、2 日と少し前から）
      this.stopLive?.();
      this.stopLive = pool.subscribe(from, [{ kinds: [1059], "#p": [me], since: now() - WRAP_JITTER }], (event) => {
        if (viewer.pubkey === me) void this.openWraps([event], signer.nip44Decrypt.bind(signer), me);
      });
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  private async openWraps(wraps: Event[], decrypt: (peer: string, text: string) => Promise<string>, me: string) {
    for (const wrap of wraps.sort((a, b) => b.created_at - a.created_at)) {
      if (this.seenWraps.has(wrap.id)) continue;
      this.seenWraps.add(wrap.id);
      let rumor;
      try {
        rumor = await unwrap(wrap, decrypt);
      } catch (e) {
        if (e instanceof SignerError) {
          this.error = `${e.message}（NIP-17 の DM を開けません）`;
          return;
        }
        continue;
      }
      if (!rumor || (rumor.kind !== 14 && rumor.kind !== 15)) continue;
      const file = rumor.kind === 15 ? fileOf(rumor) : null;
      if (rumor.kind === 15 && !file) continue;
      const peer = conversationPeer(rumor, me);
      if (!peer || this.messages.has(rumor.id)) continue;
      this.messages.set(rumor.id, { id: rumor.id, pubkey: rumor.pubkey, peer, created_at: rumor.created_at, content: file ? "" : rumor.content, protocol: "nip17", ...(file ? { file } : {}) });
      requestProfiles([peer]);
    }
  }

  private async openLegacy(events: Event[], decrypt: (peer: string, text: string) => Promise<string>, me: string) {
    for (const event of events.sort((a, b) => b.created_at - a.created_at)) {
      if (event.kind !== 4 || this.messages.has(event.id)) continue;
      const peer = event.pubkey === me ? event.tags.find((t) => t[0] === "p" && isHex64(t[1]))?.[1] : event.pubkey;
      if (!peer) continue;
      try {
        const content = await decrypt(peer, event.content);
        this.messages.set(event.id, { id: event.id, pubkey: event.pubkey, peer, created_at: event.created_at, content, protocol: "nip04" });
        requestProfiles([peer]);
      } catch (e) {
        if (e instanceof SignerError) return;
      }
    }
  }

  /** 相手の DM 受信リレー（自分の読み込みリレーとインデックス用のリレーから探す。10 分覚える）。 */
  private async inboxOf(peer: string): Promise<string[]> {
    const cached = this.peerInbox.get(peer);
    if (cached && Date.now() - cached.at < INBOX_CACHE_MS) return cached.relays;
    const fetched = await pool.fetch(relaySet([...viewer.readRelays, ...INDEXER_RELAYS]), [{ kinds: [10050], authors: [peer], limit: 5 }]);
    const relays = inboxRelays(latest(eventsOf(fetched).filter((e) => e.pubkey === peer)));
    this.peerInbox.set(peer, { relays, at: Date.now() });
    return relays;
  }

  /** NIP-17 で送る。相手が DM 受信リレーを公開していなければ送らない。 */
  async send(peer: string, body: string): Promise<PublishResult> {
    const me = viewer.pubkey;
    if (!me || !viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
    return this.sendRumor(peer, buildRumor(me, peer, body, now()));
  }

  /**
   * ファイルを送る（NIP-17 の kind 15）。ブラウザで AES-256-GCM で暗号化してから画像の投稿先に送るので、投稿先には
   * 中身が分からない。相手の DM 受信リレーが分からなければ、アップロードもしない。
   */
  async sendFile(peer: string, file: File): Promise<PublishResult> {
    const me = viewer.pubkey;
    if (!me || !viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
    if ((await this.inboxOf(peer)).length === 0) throw new Error("相手が DM 受信リレー（kind 10050）を公開していないので、NIP-17 の DM を送れません。");
    const data = new Uint8Array(await file.arrayBuffer());
    const sealed = await encryptFile(data);
    const uploaded = await uploadRaw(sealed.ciphertext);
    const info: DmFile = { url: uploaded.url, type: file.type || "application/octet-stream", key: sealed.key, nonce: sealed.nonce, x: sealed.x, ox: sealed.ox, size: data.length };
    return this.sendRumor(peer, buildFileRumor(me, peer, info, now()), info);
  }

  /** 旧方式（NIP-04、kind 4）で送る。書き込みリレーへ。相手と時刻は公開される。 */
  async sendLegacy(peer: string, body: string): Promise<PublishResult> {
    const me = viewer.pubkey;
    if (!me || !viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
    if (!body.trim()) throw new Error("メッセージを入力してください");
    const signer = await viewer.getSigner();
    const event = await signer.sign(buildLegacyDm(peer, await signer.nip04Encrypt(peer, body), now()));
    const result = await publish(viewer.writeRelays, event);
    if (result.accepted > 0) this.messages.set(event.id, { id: event.id, pubkey: me, peer, created_at: event.created_at, content: body, protocol: "nip04" });
    return result;
  }

  private async sendRumor(peer: string, rumor: Rumor, file?: DmFile): Promise<PublishResult> {
    const me = viewer.pubkey!;
    const body = rumor.content;
    const theirs = await this.inboxOf(peer);
    if (theirs.length === 0) throw new Error("相手が DM 受信リレー（kind 10050）を公開していないので、NIP-17 の DM を送れません。");
    const signer = await viewer.getSigner();
    const encrypt = signer.nip44Encrypt.bind(signer);
    const toPeer = giftWrap(await signer.sign(await sealTemplate(rumor, peer, encrypt, now())), peer, now());
    const toMe = giftWrap(await signer.sign(await sealTemplate(rumor, me, encrypt, now())), me, now());
    const result = await publish(theirs, toPeer);
    if (result.accepted > 0) {
      const { relays: mine } = await this.loadInbox();
      void publish(mine.length > 0 ? mine : viewer.writeRelays, toMe);
      this.seenWraps.add(toMe.id);
      this.messages.set(rumor.id, { id: rumor.id, pubkey: me, peer, created_at: rumor.created_at, content: file ? "" : body, protocol: "nip17", ...(file ? { file } : {}) });
    }
    return result;
  }

  /** DM 受信リレーを公開する。今公開されているものを読めなかったときは、上書きを防ぐため公開しない。 */
  async publishInbox(relays: string[]): Promise<PublishResult> {
    if (!viewer.canSign) throw new Error("署名できるアカウントでログインしてください");
    const { complete } = await this.loadInbox(true);
    if (!complete) throw new Error("今の DM 受信リレーを読めなかったので、公開しませんでした。");
    const signer = await viewer.getSigner();
    const base = this.inboxEvent;
    const template = buildInbox(relays, Math.max(now(), (base?.created_at ?? 0) + 1));
    const event = await signer.sign(template);
    const result = await publish(viewer.writeRelays, event);
    if (result.accepted > 0) {
      this.inboxEvent = event;
      this.inbox = inboxRelays(event);
      this.inboxAt = Date.now();
    }
    return result;
  }

  stop() {
    this.stopLive?.();
    this.stopLive = undefined;
  }
}

export const dms = new DirectMessages();
