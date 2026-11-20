import { nip19 } from "nostr-tools";
import {
  addLinkBookmark, buildLinkBookmark, decodeLinkBookmarks, linkBookmarkDeletion, linkIdentifier, linkKey, LINK_BOOKMARK_KIND,
  MAX_EACH, MAX_TITLE, normalizeLink, publicLinkBookmarks, type LinkBookmark,
} from "../domain/linkBookmarks";
import type { Event } from "../nostr/events";
import { eventsOf, pool, publish } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { summary } from "./publishSummary";
import { toast } from "./toast.svelte";
import { viewer } from "./viewer.svelte";

/**
 * リンクのブックマーク（Android 版の LinkBookmarksController）。見る人ごとに localStorage の `link-bookmarks.<公開鍵>` に、
 * 非公開の分・公開の分（kind 39701）の写し・このアプリで削除を依頼したリンク（`d` → 時刻）を置く。
 */

interface Saved { private: unknown; public: unknown; removed: Record<string, number> }

const now = () => Math.floor(Date.now() / 1000);

class LinkBookmarks {
  privateLinks = $state<LinkBookmark[]>([]);
  publicLinks = $state<LinkBookmark[]>([]);
  loading = $state(false);
  busy = $state(false);
  private owner: string | null = null;
  private removed: Record<string, number> = {};

  /** 両方を新しい順に。 */
  all = $derived([...this.privateLinks, ...this.publicLinks].sort((a, b) => b.addedAt - a.addedAt));

  /** 見る人に合わせて、ブラウザに残した分を読む。 */
  private prepare(): string | null {
    const me = viewer.pubkey;
    if (!me) return null;
    if (this.owner === me) return me;
    this.owner = me;
    let saved: Partial<Saved> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(`link-bookmarks.${me}`) ?? "null");
    } catch {
      saved = null;
    }
    this.privateLinks = decodeLinkBookmarks(saved?.private, false);
    this.publicLinks = decodeLinkBookmarks(saved?.public, true);
    this.removed = saved?.removed && typeof saved.removed === "object" ? saved.removed : {};
    return me;
  }

  private save() {
    if (!this.owner) return;
    try {
      const strip = (list: LinkBookmark[]) => list.map(({ public: _, ...rest }) => rest);
      localStorage.setItem(`link-bookmarks.${this.owner}`, JSON.stringify({ private: strip(this.privateLinks), public: strip(this.publicLinks), removed: this.removed }));
    } catch {
      // 保存できなくてもこの間は使える
    }
  }

  /** 画面を開いたとき。残した分を出してから、読み込み＋書き込みリレーの公開の分を読む。 */
  async refresh() {
    const me = this.prepare();
    if (!me || this.loading) return;
    this.loading = true;
    try {
      const fetched = await pool.fetch(relaySet([...viewer.readRelays, ...viewer.writeRelays]), [{ kinds: [LINK_BOOKMARK_KIND], authors: [me], limit: MAX_EACH }]);
      if (this.owner !== me) return;
      const found = publicLinkBookmarks(eventsOf(fetched), me, this.removed);
      // 答えないリレーがあっても、残した一覧を空にしない
      if (fetched.complete || found.length > 0) {
        this.publicLinks = found;
        this.save();
      }
    } finally {
      this.loading = false;
    }
  }

  /** 足す。題名が空ならホスト名。公開は kind 39701 を署名して書き込みリレーへ。 */
  async add(url: string, title: string, isPublic: boolean, from?: Event) {
    const me = this.prepare();
    if (!me) return;
    const link = normalizeLink(url);
    if (!link) throw new Error("http か https の URL を入力してください");
    const named = (title.trim() || new URL(link).hostname.replace(/^www\./, "")).slice(0, MAX_TITLE);
    if (!isPublic) {
      const source = from ? nip19.neventEncode({ id: from.id, author: from.pubkey, kind: from.kind }) : undefined;
      this.privateLinks = addLinkBookmark(this.privateLinks, { url: link, title: named, addedAt: now(), public: false, ...(source ? { from: source } : {}) });
      this.save();
      toast.show("リンクを非公開ブックマークに追加しました");
      return;
    }
    if (!viewer.canSign) throw new Error("公開のブックマークには、署名できるアカウントが必要です");
    this.busy = true;
    try {
      const old = this.publicLinks.find((item) => linkKey(item.url) === linkKey(link));
      const signer = await viewer.getSigner();
      const event = await signer.sign(buildLinkBookmark(link, named, now(), old?.addedAt));
      const result = await publish(viewer.writeRelays, event);
      if (result.accepted === 0) throw new Error(`公開のブックマークを送れませんでした（${summary(result)}）`);
      if (this.owner !== me) return;
      // 消したリンクを足し直したら、また出す
      delete this.removed[linkIdentifier(link)];
      this.publicLinks = addLinkBookmark(this.publicLinks, { url: link, title: named, addedAt: old?.addedAt ?? event.created_at, public: true, eventId: event.id });
      this.save();
      toast.show(`リンクを公開ブックマークに追加しました（${summary(result)}）`);
    } finally {
      this.busy = false;
    }
  }

  /** 消す。公開の分は削除の依頼を送り、リレーがまだ返しても出さない。 */
  async remove(bookmark: LinkBookmark) {
    const me = this.prepare();
    if (!me) return;
    if (!bookmark.public) {
      this.privateLinks = this.privateLinks.filter((item) => linkKey(item.url) !== linkKey(bookmark.url));
      this.save();
      return;
    }
    if (!viewer.canSign) throw new Error("公開のブックマークを消すには、署名できるアカウントが必要です");
    this.busy = true;
    try {
      const signer = await viewer.getSigner();
      const time = now();
      const result = await publish(viewer.writeRelays, await signer.sign(linkBookmarkDeletion(me, bookmark, time)));
      if (result.accepted === 0) throw new Error(`削除の依頼を送れませんでした（${summary(result)}）`);
      if (this.owner !== me) return;
      this.removed = { ...this.removed, [linkIdentifier(bookmark.url)]: time };
      this.publicLinks = this.publicLinks.filter((item) => linkKey(item.url) !== linkKey(bookmark.url));
      this.save();
      toast.show(`公開のブックマークの削除を依頼しました（${summary(result)}）`);
    } finally {
      this.busy = false;
    }
  }
}

export const linkBookmarks = new LinkBookmarks();
