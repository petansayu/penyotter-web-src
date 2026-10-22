import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { addressee, buildDeletion, buildEvent, buildRepost, buildUndo } from "../domain/publishing";
import type { Event } from "../nostr/events";
import { fetchFromAuthor, loadRelayLists, relayLists } from "../nostr/outbox";
import { delay, publish, type PublishResult } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { keepNotes } from "./cache.svelte";
import { removeFromScope } from "./db";
import { deletedNotes, droppedNotes, saveDeleted } from "./interactions.svelte";
import { summary } from "./publishSummary";
import { settings } from "./settings.svelte";
import { toast } from "./toast.svelte";
import { viewer } from "./viewer.svelte";

/**
 * リアクション・リポストとその取り消し（技術資料 6.5）。自分がしたものは見る人ごとにブラウザに覚え、ボタンの
 * 色と取り消しに使う。同じ投稿へ同じリアクションを二重に送らない。
 */

const MAX_REMEMBERED = 2000;
const key = (name: string, pubkey: string) => `${name}.${pubkey}`;

/**
 * 送り先（技術資料 6.1）。書き込みリレーに加えて、相手の投稿なら、その作者の kind 10002 の読み込みリレー
 * （インボックス）へ 3 件まで（ゆるアウトボックス）。作者のリストは 4 秒まで探し、見つからなければ書き込みリレーだけ。
 */
export async function deliveryRelays(target: Event | undefined): Promise<string[]> {
  const own = viewer.writeRelays;
  if (!target || target.pubkey === viewer.pubkey) return own;
  await Promise.race([loadRelayLists([target.pubkey], viewer.alwaysOn), delay(4000)]);
  const inbox = relayLists.get(target.pubkey)?.list?.read.slice(0, 3) ?? [];
  return relaySet([...own, ...inbox]);
}

class Actions {
  /** 投稿 ID → 自分のリアクション。 */
  readonly reactions = new SvelteMap<string, Event>();
  /** 投稿 ID → 自分のリポスト。 */
  readonly reposts = new SvelteMap<string, Event>();
  /** 送っている投稿 ID（ボタンを押せなくする）。 */
  readonly busy = new SvelteSet<string>();
  private owner: string | null = null;

  /** 見る人が変わったら呼ぶ（App から）。覚えているものを読み直す。 */
  load() {
    const me = viewer.pubkey;
    if (me === this.owner) return;
    this.owner = me;
    this.reactions.clear();
    this.reposts.clear();
    if (!me) return;
    for (const [name, map] of [["my-reactions", this.reactions], ["my-reposts", this.reposts]] as const) {
      try {
        const saved = JSON.parse(localStorage.getItem(key(name, me)) ?? "[]") as [string, Event][];
        for (const [id, event] of saved) map.set(id, event);
      } catch {
        // 覚えていなければ空
      }
    }
  }

  private save() {
    const me = viewer.pubkey;
    if (!me) return;
    try {
      localStorage.setItem(key("my-reactions", me), JSON.stringify([...this.reactions].slice(-MAX_REMEMBERED)));
      localStorage.setItem(key("my-reposts", me), JSON.stringify([...this.reposts].slice(-MAX_REMEMBERED)));
    } catch {
      // 保存できなくてもこの間は使える
    }
  }

  /**
   * リレーから読んだ自分のリアクション・リポストを取り込む（ほかの端末でしたもの）。targets はそのとき問い合わせた
   * 投稿。覚えているものより新しければ置き換え、取り消されていれば外す。
   */
  adopt(own: { reactions: Map<string, Event>; reposts: Map<string, Event>; removed: Set<string> }, targets: string[]) {
    if (viewer.pubkey !== this.owner) return;
    let changed = false;
    for (const [mine, found] of [[this.reactions, own.reactions], [this.reposts, own.reposts]] as const) {
      for (const id of targets) {
        const current = mine.get(id);
        const latest = found.get(id);
        if (current && own.removed.has(current.id)) {
          mine.delete(id);
          changed = true;
        }
        if (latest && (!mine.get(id) || latest.created_at > mine.get(id)!.created_at)) {
          mine.set(id, latest);
          changed = true;
        }
      }
    }
    if (changed) this.save();
  }

  reactionTo(id: string) {
    return this.reactions.get(id);
  }

  repostOf(id: string) {
    return this.reposts.get(id);
  }

  /** いいね（「+」）を送る。もうリアクションしていれば取り消す。 */
  async toggleLike(target: Event) {
    const mine = this.reactions.get(target.id);
    if (mine) return this.unreact(target);
    return this.react(target, "+");
  }

  /**
   * 絵文字でリアクションする（content は絵文字か、カスタム絵文字の :名前:）。同じものをもうしていれば取り消す。
   * 別のものをしていれば、前のものを取り消してから送る。
   */
  async react(target: Event, content: string, emoji?: { shortcode: string; url: string }) {
    const mine = this.reactions.get(target.id);
    if (mine && mine.content === content) return this.unreact(target);
    await this.run(target.id, async () => {
      if (mine) {
        const undone = await this.signAndSend(buildUndo(mine, now()), viewer.writeRelays);
        if (undone.accepted === 0) return undone;
        this.reactions.delete(target.id);
      }
      const relays = await deliveryRelays(target);
      const template = buildEvent(viewer.pubkey!, { mode: "like", body: content, target, emoji }, now(), { clientTag: settings.clientTag });
      return this.signAndSend(template, relays, (event) => this.reactions.set(target.id, event));
    });
  }

  /** リアクションを取り消す。 */
  async unreact(target: Event) {
    const mine = this.reactions.get(target.id);
    if (!mine) return;
    await this.run(target.id, async () => {
      const result = await this.signAndSend(buildUndo(mine, now()), viewer.writeRelays);
      if (result.accepted > 0) this.reactions.delete(target.id);
      return result;
    });
  }

  /** リポストする。もうしていれば取り消す。元の投稿は作者のリレーから取り直し、取れなければ送らない。 */
  async toggleRepost(target: Event) {
    const mine = this.reposts.get(target.id);
    await this.run(target.id, async () => {
      if (mine) {
        const result = await this.signAndSend(buildUndo(mine, now()), viewer.writeRelays);
        if (result.accepted > 0) {
          this.reposts.delete(target.id);
          // 取り消したリポストのカードを、その場で一覧から外す
          deletedNotes.add(mine.id);
          saveDeleted();
        }
        return result;
      }
      const fetched = await fetchFromAuthor(target.pubkey, [{ ids: [target.id], limit: 1 }], viewer.readRelays);
      const entry = fetched.events.get(target.id);
      if (!entry) throw new Error("元の投稿を作者のリレーから取り直せなかったので、リポストを送りませんでした。");
      const relay = [...entry.relays][0] ?? viewer.readRelays[0] ?? "";
      const relays = await deliveryRelays(target);
      return this.signAndSend(buildRepost(entry.event, relay, now(), { clientTag: settings.clientTag }), relays, (event) => this.reposts.set(target.id, event));
    });
  }

  /**
   * 自分の投稿の削除を依頼する（NIP-09）。書き込みリレーに加えて、引用した相手（なければ最初の p）の読み込みリレーへ
   * 3 件まで送る。受理されたら一覧とこのブラウザの保存分から外す。
   */
  async deletePost(note: Event) {
    const me = viewer.pubkey;
    if (!me || note.pubkey !== me) return;
    await this.run(note.id, async () => {
      const to = addressee(note);
      if (to) await Promise.race([loadRelayLists([to], viewer.alwaysOn), delay(4000)]);
      const inbox = to ? relayLists.get(to)?.list?.read.slice(0, 3) ?? [] : [];
      const result = await this.signAndSend(buildDeletion(note, me, now()), relaySet([...viewer.writeRelays, ...inbox]));
      if (result.accepted > 0) {
        deletedNotes.add(note.id);
        droppedNotes.add(note.id);
        saveDeleted();
        for (const scope of ["home", "global", "notes"] as const) void removeFromScope(me, scope, [note.id]);
      }
      return result;
    });
  }

  private async run(id: string, task: () => Promise<PublishResult>) {
    if (this.busy.has(id) || !viewer.pubkey) return;
    this.busy.add(id);
    try {
      toast.show(summary(await task()));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.delete(id);
      this.save();
    }
  }

  /** 署名して送る。どこかが受理したら accepted を呼ぶ。 */
  private async signAndSend(template: Parameters<Awaited<ReturnType<typeof viewer.getSigner>>["sign"]>[0], relays: string[], accepted?: (event: Event) => void) {
    const signer = await viewer.getSigner();
    const event = await signer.sign(template);
    const result = await publish(relays, event);
    if (result.accepted > 0) {
      accepted?.(event);
      if (event.kind === 6 || event.kind === 16 || event.kind === 7) keepNotes([event], null);
    }
    return result;
  }
}

const now = () => Math.floor(Date.now() / 1000);

export const actions = new Actions();
