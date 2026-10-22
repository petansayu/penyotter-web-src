import { petnames } from "../domain/lists";
import { nip05, nip19 } from "nostr-tools";
import { isHex64, latest, type Event } from "../nostr/events";
import { DEFAULT_RELAYS, INDEXER_RELAYS, loadRelayLists, parseRelayList, relayLists, type RelayList } from "../nostr/outbox";
import { eventsOf, merge, pool } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { connectRemote, forgetRemote, parseBunker, resumeRemote, startNostrConnect } from "../nostr/remoteSigner";
import { connectNip07, SignerError, type Signer } from "../nostr/signer";
import { TEST_RELAY } from "../nostr/testMode";
import { deleteViewerData } from "./db";

/**
 * 見ている人（閲覧専用のアカウントと同じ）。公開鍵はブラウザに保存し、リレーはその人の kind 10002 を使う。
 * 秘密鍵は受け付けない。
 */

const STORAGE_KEY = "viewer";
/** このブラウザに入れたアカウント（Android 版の複数アカウント。公開鍵・リレーのヒント・署名のしかただけ）。 */
const ACCOUNTS_KEY = "accounts";

export type SignMode = "view" | "nip07" | "nip46";
export type ViewerInput = { pubkey: string; relays: string[]; mode?: SignMode };

/** npub・nprofile・16進・NIP-05 を公開鍵にする。nsec・ncryptsec は受け付けない（読める形でブラウザに残さないため）。 */
export async function resolveViewer(raw: string): Promise<ViewerInput> {
  const value = raw.trim().replace(/^nostr:/i, "");
  if (/^(nsec1|ncryptsec1)/i.test(value)) throw new Error("秘密鍵は入力しないでください。公開鍵（npub）か NIP-05 を入れてください。");
  if (isHex64(value.toLowerCase())) return { pubkey: value.toLowerCase(), relays: [] };
  if (/^(npub1|nprofile1)/i.test(value)) {
    try {
      const decoded = nip19.decode(value.toLowerCase());
      if (decoded.type === "npub") return { pubkey: decoded.data, relays: [] };
      if (decoded.type === "nprofile") return { pubkey: decoded.data.pubkey, relays: decoded.data.relays ?? [] };
    } catch {
      // 下で知らせる
    }
    throw new Error("npub を読めませんでした。");
  }
  if (value.includes(".")) {
    const profile = await nip05.queryProfile(value.includes("@") ? value : `_@${value}`).catch(() => null);
    if (profile) return { pubkey: profile.pubkey, relays: profile.relays ?? [] };
    throw new Error("NIP-05 から公開鍵を見つけられませんでした。");
  }
  throw new Error("npub か NIP-05（name@example.com）を入れてください。");
}

class Viewer {
  pubkey = $state<string | null>(null);
  /** 読み込みリレー（kind 10002 の read。なければ最初のリレー）。 */
  readRelays = $state<string[]>(DEFAULT_RELAYS);
  writeRelays = $state<string[]>(DEFAULT_RELAYS);
  follows = $state<string[]>([]);
  mutedPubkeys = $state<Set<string>>(new Set());
  mutedEvents = $state<Set<string>>(new Set());
  /** 今使っているフォロー一覧（kind 3）とミュート一覧（kind 10000）。書き換えの元にはせず、毎回取り直す（lists）。 */
  contactList = $state<Event>();
  muteList = $state<Event>();
  /** フォロー一覧のペットネーム（相手の公開鍵 → 名前）。 */
  petnames = $derived(petnames(this.contactList));
  /** 公開ブックマーク（kind 10003）。 */
  bookmarkList = $state<Event>();
  /** ブックマークした投稿の ID（`e`）と、記事などのアドレス（`a`）。 */
  bookmarks = $state<Set<string>>(new Set());
  /** 読んだリレーリスト（kind 10002）。リレー設定の画面で編集の元にし、公開する前に取り直して比べる。 */
  relayListEvent = $state<Event>();
  /** 取り込んでいないリレーリスト（起動時にリレーで見つけた、今使っているものと違う版。技術資料 4.1.1）。 */
  relayListChange = $state<Event>();
  /** リレーリスト・フォローを読み終えたか。 */
  ready = $state(false);
  error = $state<string | null>(null);
  /** 署名のしかた。view は見るだけ、nip07 はブラウザ拡張、nip46 はリモート署名。 */
  mode = $state<SignMode>("view");
  /** このブラウザに入れたアカウント。 */
  accounts = $state<ViewerInput[]>([]);
  /** アカウントを足す画面を出しているか。 */
  adding = $state(false);
  private signer: Signer | null = null;
  private hints: string[] = [];

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as ViewerInput | null;
      if (saved && isHex64(saved.pubkey)) {
        this.pubkey = saved.pubkey;
        this.hints = saved.relays ?? [];
        this.mode = saved.mode === "nip07" || saved.mode === "nip46" ? saved.mode : "view";
      }
    } catch {
      // 保存がなければ最初の画面
    }
    try {
      const saved = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]") as ViewerInput[];
      this.accounts = Array.isArray(saved) ? saved.filter((a) => a && isHex64(a.pubkey)).slice(0, 20) : [];
    } catch {
      this.accounts = [];
    }
    if (this.pubkey && !this.accounts.some((a) => a.pubkey === this.pubkey)) this.saveAccounts([...this.accounts, { pubkey: this.pubkey, relays: this.hints, mode: this.mode }]);
  }

  private saveAccounts(accounts: ViewerInput[]) {
    this.accounts = accounts;
    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    } catch {
      // 保存できなくてもこの間は使える
    }
  }

  /** ほかのアカウントに切り替える。画面の中身はすべてその人のもので読み直す（ページを読み直す）。 */
  switchTo(pubkey: string) {
    const account = this.accounts.find((a) => a.pubkey === pubkey);
    if (!account || account.pubkey === this.pubkey) return;
    this.set(account);
  }

  /** 常時接続リレー（読み込みリレーの先頭 6 件）。 */
  get alwaysOn(): string[] {
    return this.readRelays.slice(0, 6);
  }

  get canSign(): boolean {
    return this.mode !== "view";
  }

  /** 署名役。初めて使うときにブラウザ拡張につなぐ。鍵がログインしていた鍵と違えば SignerError。 */
  async getSigner(): Promise<Signer> {
    if (!this.pubkey || this.mode === "view") throw new SignerError("このアカウントは見るだけです。署名するには、ブラウザ拡張でログインし直してください。");
    if (this.signer?.pubkey === this.pubkey) return this.signer;
    if (this.mode === "nip46") {
      const remote = resumeRemote(this.pubkey);
      if (!remote) throw new SignerError("リモート署名の接続が切れています（タブを閉じると消えます）。設定の「リモート署名」で bunker:// を貼り直してください。");
      this.signer = remote;
      return remote;
    }
    this.signer = await connectNip07(this.pubkey);
    return this.signer;
  }

  /** ほかのアカウントの署名役（投稿欄で投稿するアカウントを選んだとき）。見るだけのアカウントは SignerError。 */
  async signerFor(pubkey: string): Promise<Signer> {
    if (pubkey === this.pubkey) return this.getSigner();
    const account = this.accounts.find((a) => a.pubkey === pubkey);
    if (!account || !account.mode || account.mode === "view") throw new SignerError("このアカウントは見るだけです。");
    if (account.mode === "nip46") {
      const remote = resumeRemote(pubkey);
      if (!remote) throw new SignerError("そのアカウントのリモート署名の接続が切れています。切り替えてから bunker:// を貼り直してください。");
      return remote;
    }
    return connectNip07(pubkey);
  }

  /** 署名できるアカウント（投稿欄で選べるもの）。 */
  get signableAccounts(): ViewerInput[] {
    return this.accounts.filter((a) => a.mode && a.mode !== "view");
  }

  /** リモート署名（NIP-46）でログインする。remember なら接続用の鍵をこのブラウザに記憶する。 */
  async loginBunker(input: string, remember: boolean) {
    const signer = await connectRemote(await parseBunker(input), remember);
    if (this.pubkey !== signer.pubkey || this.mode !== "nip46") this.set({ pubkey: signer.pubkey, relays: [], mode: "nip46" });
    this.signer = signer;
  }

  /** nostrconnect:// を出して、署名アプリが承認したらログインする。 */
  startNostrConnect(remember: boolean) {
    const session = startNostrConnect(remember);
    return {
      uri: session.uri,
      cancel: session.cancel,
      done: session.done.then((signer) => {
        if (this.pubkey !== signer.pubkey || this.mode !== "nip46") this.set({ pubkey: signer.pubkey, relays: [], mode: "nip46" });
        this.signer = signer;
      }),
    };
  }

  /** リモート署名の接続用の鍵を、このブラウザから消す（見るだけになる。もう一度貼れば署名できる）。 */
  forgetBunker() {
    if (this.pubkey) forgetRemote(this.pubkey);
    this.signer = null;
  }

  /** ブラウザ拡張（NIP-07）でログインする。 */
  async loginNip07() {
    const signer = await connectNip07();
    this.set({ pubkey: signer.pubkey, relays: [], mode: "nip07" });
    this.signer = signer;
  }

  set(input: ViewerInput) {
    // 別のアカウントに替わるときは、ほかの画面の状態を残さないようにページを読み直す
    const switching = !!this.pubkey && this.pubkey !== input.pubkey;
    this.adding = false;
    this.pubkey = input.pubkey;
    this.hints = relaySet(input.relays, 6);
    this.mode = input.mode ?? "view";
    this.signer = null;
    this.ready = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ pubkey: this.pubkey, relays: this.hints, mode: this.mode }));
    } catch {
      // 保存できなくてもこの間は使える
    }
    const entry = { pubkey: input.pubkey, relays: this.hints, mode: this.mode };
    this.saveAccounts([...this.accounts.filter((a) => a.pubkey !== input.pubkey), entry].slice(-20));
    if (switching) setTimeout(() => location.reload(), 0);
  }

  /**
   * 今のアカウントをこのブラウザから外す。その人の保存分（投稿・プロフィール・通知の既読・リレーの設定）も消す。
   * ほかのアカウントがあれば、そちらに切り替える。
   */
  clear() {
    const previous = this.pubkey;
    const rest = this.accounts.filter((a) => a.pubkey !== previous);
    this.saveAccounts(rest);
    this.pubkey = null;
    this.mode = "view";
    this.signer = null;
    this.ready = false;
    this.follows = [];
    this.applyContacts(undefined);
    this.applyMutes(undefined);
    this.applyBookmarks(undefined);
    try {
      localStorage.removeItem(STORAGE_KEY);
      if (previous) for (const key of ["notifications", "search-relays", "global-relays", "home-tab", "relay-list"]) localStorage.removeItem(`${key}.${previous}`);
      if (previous) forgetRemote(previous);
    } catch {
      // 何もしない
    }
    if (previous) void deleteViewerData(previous);
    if (rest.length > 0) {
      const next = rest[rest.length - 1];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // 読み直したときに最初の画面になる
      }
      setTimeout(() => location.reload(), 0);
    }
  }

  /** 取り込んだリレーリスト（見る人ごとにブラウザに覚える。read・write と、取り込まないと選んだ版の ID）。 */
  private adopted(pubkey: string): { id: string; read: string[]; write: string[]; declined?: string } | null {
    try {
      return JSON.parse(localStorage.getItem(`relay-list.${pubkey}`) ?? "null");
    } catch {
      return null;
    }
  }

  private rememberAdopted(pubkey: string, value: { id: string; read: string[]; write: string[]; declined?: string }) {
    try {
      localStorage.setItem(`relay-list.${pubkey}`, JSON.stringify(value));
    } catch {
      // 保存できなくてもこの間は使える
    }
  }

  /** 見つけた新しいリレーリストを取り込む。 */
  acceptRelayListChange() {
    const event = this.relayListChange;
    if (!event) return;
    this.relayListChange = undefined;
    this.applyRelayList(event);
  }

  /** 見つけた新しいリレーリストを取り込まない（同じ版では二度と知らせない）。 */
  declineRelayListChange() {
    const event = this.relayListChange;
    if (!event || !this.pubkey) return;
    this.relayListChange = undefined;
    const current = this.adopted(this.pubkey);
    if (current) this.rememberAdopted(this.pubkey, { ...current, declined: event.id });
  }

  /** 公開したリレーリストを使う（テストモードでは手元のテスト用リレーのまま）。 */
  applyRelayList(event: Event) {
    this.relayListEvent = event;
    const list = parseRelayList(event);
    this.rememberAdopted(event.pubkey, { id: event.id, read: list.read, write: list.write });
    const parsed = parseRelayList(event);
    relayLists.set(event.pubkey, parsed);
    if (TEST_RELAY) return;
    if (parsed.read.length > 0) this.readRelays = parsed.read;
    if (parsed.write.length > 0) this.writeRelays = parsed.write;
  }

  /** 公開ブックマークを使う。非公開の分（content の暗号化）は読まない。 */
  applyBookmarks(event: Event | undefined) {
    this.bookmarkList = event;
    this.bookmarks = new Set(event?.tags.filter((tag) => (tag[0] === "e" && isHex64(tag[1])) || (tag[0] === "a" && tag[1])).map((tag) => tag[1]) ?? []);
  }

  /** 置き換え可能な一覧（3・10000・10003）を使う。 */
  applyList(kind: 3 | 10000 | 10003, event: Event | undefined) {
    if (kind === 3) this.applyContacts(event);
    else if (kind === 10000) this.applyMutes(event);
    else this.applyBookmarks(event);
  }

  listOf(kind: 3 | 10000 | 10003): Event | undefined {
    return kind === 3 ? this.contactList : kind === 10000 ? this.muteList : this.bookmarkList;
  }

  /** フォロー一覧を使う（読んだとき・書き換えたとき）。 */
  applyContacts(event: Event | undefined) {
    this.contactList = event;
    this.follows = event ? pTags(event) : [];
  }

  /** ミュート一覧を使う。読めるのは公開の分（タグ）だけ（非公開の分は content に暗号化されている）。 */
  applyMutes(event: Event | undefined) {
    this.muteList = event;
    this.mutedPubkeys = new Set(event ? pTags(event) : []);
    this.mutedEvents = new Set(event?.tags.filter((tag) => tag[0] === "e" && isHex64(tag[1])).map((tag) => tag[1]) ?? []);
  }

  /** 自分の kind 10002・3・10000 を読む（技術資料 5.10。閲覧専用なので取り込むだけ）。 */
  async load() {
    const pubkey = this.pubkey;
    if (!pubkey) return;
    this.error = null;
    const lookIn = relaySet([...this.hints, ...DEFAULT_RELAYS]);
    const lists = await pool.fetch(relaySet([...lookIn, ...INDEXER_RELAYS]), [{ kinds: [10002], authors: [pubkey], limit: 5 }]);
    const relayList = latest(eventsOf(lists));
    this.relayListEvent = relayList;
    // 起動時は、前に取り込んだリレーリストを使う。リレーで見つけた版が違えば知らせるだけで、勝手には取り込まない
    // （技術資料 4.1.1。初めてのときと、中身が同じときは取り込む）
    const adopted = this.adopted(pubkey);
    let chosen: RelayList | null = relayList ? parseRelayList(relayList) : null;
    this.relayListChange = undefined;
    if (adopted && relayList && adopted.id !== relayList.id) {
      const same = JSON.stringify([...chosen!.read].sort()) === JSON.stringify([...adopted.read].sort()) && JSON.stringify([...chosen!.write].sort()) === JSON.stringify([...adopted.write].sort());
      if (same) this.rememberAdopted(pubkey, { ...adopted, id: relayList.id });
      else {
        if (lists.complete && adopted.declined !== relayList.id) this.relayListChange = relayList;
        chosen = { read: adopted.read, write: adopted.write };
      }
    } else if (adopted && !relayList) chosen = { read: adopted.read, write: adopted.write };
    else if (!adopted && relayList) this.rememberAdopted(pubkey, { id: relayList.id, read: chosen!.read, write: chosen!.write });
    // テストモードでは、自分のリレーリストによらず手元のテスト用リレーだけを使う
    const parsed: RelayList = TEST_RELAY ? { read: [TEST_RELAY], write: [TEST_RELAY] } : chosen ?? { read: [], write: [] };
    if (relayList) relayLists.set(pubkey, parsed);
    this.readRelays = parsed.read.length > 0 ? parsed.read : lookIn;
    this.writeRelays = parsed.write.length > 0 ? parsed.write : lookIn;
    const relays = relaySet([...this.readRelays, ...this.writeRelays]);
    const [contacts, mutes, bookmarks] = await Promise.all([
      pool.fetch(relays, [{ kinds: [3], authors: [pubkey], limit: 5 }]),
      pool.fetch(this.readRelays, [{ kinds: [10000], authors: [pubkey], limit: 5 }]),
      pool.fetch(this.readRelays, [{ kinds: [10003], authors: [pubkey], limit: 5 }]),
    ]);
    if (this.pubkey !== pubkey) return;
    const contactList = latest(eventsOf(merge([contacts])));
    this.applyContacts(contactList);
    this.applyMutes(latest(eventsOf(mutes)));
    this.applyBookmarks(latest(eventsOf(bookmarks)));
    if (!contactList) this.error = "フォロー一覧が見つかりませんでした。";
    this.ready = true;
    void loadRelayLists(this.follows.slice(0, 500), this.alwaysOn);
  }
}

function pTags(event: Event): string[] {
  return [...new Set(event.tags.filter((tag) => tag[0] === "p" && isHex64(tag[1])).map((tag) => tag[1]))];
}

export const viewer = new Viewer();
