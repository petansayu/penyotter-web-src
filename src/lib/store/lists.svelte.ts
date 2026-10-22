import { emojis } from "./emojis.svelte";
import type { EventTemplate } from "nostr-tools";
import { confirmReason, diffTags, nextList, restoreList, suspiciousDrop, tagKey, withoutTag, withTag, type ConfirmReason, type ListDiff, type RestoreMode, withPetname } from "../domain/lists";
import { latest, newer, type Event } from "../nostr/events";
import { delay, eventsOf, pool, publish, type PublishResult } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { latestVersion, recordVersion, type HistorySource } from "./listHistory";
import { summary } from "./publishSummary";
import { toast } from "./toast.svelte";
import { viewer } from "./viewer.svelte";

/**
 * フォロー一覧（kind 3）とミュート一覧（kind 10000）の書き換え（技術資料 7 章、Android 版の ListGuard・
 * FollowService）。一覧ごとに 1 つずつ、毎回リレーから取り直し、いちばん新しい版に頼まれた変更だけを当てる。
 * 取り直しが完了しなければやめる。危ない変更は先に聞き、元の版と署名した版を履歴に残してから送る。
 */

export type ListKind = 3 | 10000 | 10003 | 10030;
const LIST_NAMES: Record<ListKind, string> = { 3: "フォロー一覧", 10000: "ミュート一覧", 10003: "ブックマーク", 10030: "絵文字リスト" };

export interface Confirmation {
  kind: ListKind;
  reason: ConfirmReason;
  diff: ListDiff;
  answer: (ok: boolean) => void;
}

const pendingKey = (me: string, kind: number) => `pending-list.${me}.${kind}`;
const now = () => Math.floor(Date.now() / 1000);

function readPending(me: string, kind: number): Event | undefined {
  try {
    const event = JSON.parse(localStorage.getItem(pendingKey(me, kind)) ?? "null") as Event | null;
    return event && event.pubkey === me && event.kind === kind ? event : undefined;
  } catch {
    return undefined;
  }
}

function writePending(me: string, kind: number, event: Event | null) {
  try {
    if (event) localStorage.setItem(pendingKey(me, kind), JSON.stringify(event));
    else localStorage.removeItem(pendingKey(me, kind));
  } catch {
    // 覚えられなくても送れる
  }
}

class Lists {
  /** 確認のダイアログ（ListConfirmDialog が出す）。 */
  confirmation = $state<Confirmation | null>(null);
  /** 書き換え中の一覧（ボタンを押せなくする）。 */
  busy = $state<Set<ListKind>>(new Set());
  private readonly locks = new Map<string, Promise<unknown>>();

  /**
   * 読んだ一覧を取り込む（技術資料 7.3）。このブラウザの履歴にある版と比べて新しいほうを使う。新しい版が届いたら
   * 前の版と届いた版を履歴に残し、大きく減っていたら前の版を固定して知らせる。
   */
  async adopt() {
    const me = viewer.pubkey;
    if (!me) return;
    for (const kind of [3, 10000, 10003] as const) {
      const fetched = viewer.listOf(kind);
      const known = await latestVersion(me, kind);
      if (viewer.pubkey !== me) return;
      if (fetched && newer(fetched, known)) {
        if (known) await recordVersion(me, known, "local");
        await recordVersion(me, fetched, "relay");
        if (known && known.id !== fetched.id && suspiciousDrop(known, fetched)) {
          await recordVersion(me, known, "local", true);
          toast.show(`大きく減った${LIST_NAMES[kind]}を受け取りました。前の版を設定の「一覧の履歴」に残しています。`, 8000);
        }
      } else if (known && !fetched) {
        // リレーから取れなかったときは、このブラウザが知っている最後の版を出す（書き換えには使わない）
        viewer.applyList(kind, known);
      }
    }
  }

  follow(pubkey: string) {
    return this.change(3, (tags) => withTag(tags, ["p", pubkey]), true);
  }

  unfollow(pubkey: string) {
    return this.change(3, (tags) => withoutTag(tags, "p", pubkey), true);
  }

  /** ペットネームを書き換える（空にすると消す）。 */
  renamePetname(pubkey: string, petname: string) {
    return this.change(3, (tags) => withPetname(tags, pubkey, petname), true);
  }

  muteUser(pubkey: string) {
    return this.change(10000, (tags) => withTag(tags, ["p", pubkey]), true);
  }

  unmuteUser(pubkey: string) {
    return this.change(10000, (tags) => withoutTag(tags, "p", pubkey), true);
  }

  mutePost(id: string) {
    return this.change(10000, (tags) => withTag(tags, ["e", id]), true);
  }

  unmutePost(id: string) {
    return this.change(10000, (tags) => withoutTag(tags, "e", id), true);
  }

  /** ブックマークに足す（記事など書き直せる投稿はアドレス `a`、それ以外は ID `e`）。 */
  bookmark(ref: { id: string; address?: string | null }) {
    const tag = ref.address ? ["a", ref.address] : ["e", ref.id];
    return this.change(10003, (tags) => withTag(tags, tag), true);
  }

  unbookmark(ref: { id: string; address?: string | null }) {
    return this.change(10003, (tags) => withoutTag(withoutTag(tags, "e", ref.id), "a", ref.address ?? ""), true);
  }

  /** 絵文字リスト（kind 10030）に絵文字を足す・外す（Android 版の EmojiListEditing）。 */
  addEmoji(shortcode: string, url: string) {
    return this.change(10030, (tags) => withTag(tags, ["emoji", shortcode, url]), true);
  }

  removeEmoji(shortcode: string, url: string) {
    return this.change(10030, (tags) => tags.filter((t) => !(t[0] === "emoji" && t[1] === shortcode && t[2] === url)), true);
  }

  /** 絵文字セット（30030:公開鍵:識別子）を足す・外す。 */
  addEmojiSet(address: string) {
    return this.change(10030, (tags) => withTag(tags, ["a", address]), true);
  }

  removeEmojiSet(address: string) {
    return this.change(10030, (tags) => withoutTag(tags, "a", address), true);
  }

  /** 履歴の版から戻す（技術資料 7.4）。差は画面で見てから選ぶが、条件に当たれば確認も出す。 */
  restore(old: Event, mode: RestoreMode) {
    const kind = old.kind as ListKind;
    return this.run(kind, (base) => restoreList(base, old, mode, now()), false, "before-restore");
  }

  /** 一人を足す・外すなど。結果はトーストで知らせる。成功したら true。 */
  private change(kind: ListKind, edit: (tags: string[][]) => string[][], single: boolean) {
    return this.run(kind, (base) => nextList(kind, base, edit(base ? base.tags.map((tag) => [...tag]) : []), now()), single, "local");
  }

  private async run(kind: ListKind, build: (base: Event | undefined) => EventTemplate, single: boolean, baseSource: HistorySource): Promise<boolean> {
    const me = viewer.pubkey;
    if (!me || !viewer.canSign) return false;
    const key = `${me}:${kind}`;
    const previous = this.locks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.apply(me, kind, build, single, baseSource));
    this.locks.set(key, task);
    this.busy = new Set([...this.busy, kind]);
    try {
      const result = await task;
      if (result) toast.show(summary(result));
      return !!result && result.accepted > 0;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), 6000);
      return false;
    } finally {
      if (this.locks.get(key) === task) this.locks.delete(key);
      this.busy = new Set([...this.busy].filter((k) => k !== kind));
    }
  }

  /** 書き換えの本体（技術資料 7.1）。確認で「やめる」なら null。 */
  private async apply(me: string, kind: ListKind, build: (base: Event | undefined) => EventTemplate, single: boolean, baseSource: HistorySource): Promise<PublishResult | null> {
    const name = LIST_NAMES[kind];
    // 1. 読み込み＋書き込みリレーから取り直す。完了しなければやめる（取れなかったことを「ない」と取り違えない）
    const relays = relaySet([...viewer.readRelays, ...viewer.writeRelays]);
    const fetched = await pool.fetch(relays, [{ kinds: [kind], authors: [me], limit: 5 }]);
    if (!fetched.complete) throw new Error(`${name}をリレーから取り直せなかったので、変更をやめました。少し待ってからもう一度試してください。`);
    // 2. リレーの版・このブラウザが知っている版・送信待ちのうち、いちばん新しいものを元にする
    const fromRelays = latest(eventsOf(fetched).filter((event) => event.pubkey === me && event.kind === kind));
    const known = await latestVersion(me, kind);
    const pending = readPending(me, kind);
    const base = latest([fromRelays, known, pending].filter((event): event is Event => !!event));
    // 3. 元の版を履歴に残す。残せなければやめる
    if (base && !(await recordVersion(me, base, base === fromRelays ? "relay" : baseSource))) {
      throw new Error("一覧の履歴をこのブラウザに保存できなかったので、変更をやめました。");
    }
    // 4. 変更を当てる。送信待ちと同じ中身になるなら、署名し直さずに送り直す
    const template = build(base);
    const same = pending && base === pending && sameTags(pending.tags, template.tags) && pending.content === template.content;
    // 5. 危ない変更は先に聞く
    const reason = confirmReason(base, template.tags, single);
    if (reason && !(await this.ask(kind, reason, diffTags(base?.tags ?? [], template.tags)))) return null;
    let event: Event;
    if (same) event = pending;
    else {
      // 6. 署名し、署名した版も履歴に残してから、送信待ちとして覚える
      const signer = await viewer.getSigner();
      event = await signer.sign(template);
      if (!(await recordVersion(me, event, "app"))) throw new Error("一覧の履歴をこのブラウザに保存できなかったので、送りませんでした。");
      writePending(me, kind, event);
    }
    // 7. 書き込みリレーへ送る。受理されたら送信待ちを消して使う
    const result = await publish(viewer.writeRelays, event);
    if (result.accepted > 0) {
      writePending(me, kind, null);
      if (viewer.pubkey === me) {
        if (kind === 10030) void emojis.reload();
        else viewer.applyList(kind, event);
      }
      if (kind === 3) void this.checkAfter(me, event);
    }
    return result;
  }

  /** 送ったあとにもう一度取り、ほかのアプリがさらに新しい版を出していたら知らせる（フォロー一覧だけ）。 */
  private async checkAfter(me: string, sent: Event) {
    await delay(2000);
    const fetched = await pool.fetch(relaySet([...viewer.readRelays, ...viewer.writeRelays]), [{ kinds: [3], authors: [me], limit: 5 }]);
    const found = latest(eventsOf(fetched).filter((event) => event.pubkey === me));
    if (found && found.id !== sent.id && newer(found, sent)) {
      await recordVersion(me, found, "relay");
      toast.show("ほかのアプリで、さらに新しいフォロー一覧が出ています。設定の「一覧の履歴」で確かめられます。", 8000);
    }
  }

  private ask(kind: ListKind, reason: ConfirmReason, diff: ListDiff): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmation = {
        kind,
        reason,
        diff,
        answer: (ok) => {
          this.confirmation = null;
          resolve(ok);
        },
      };
    });
  }
}

function sameTags(a: string[][], b: string[][]) {
  return a.length === b.length && a.every((tag, i) => tagKey(tag) === tagKey(b[i]) && tag.join("\u0000") === b[i].join("\u0000"));
}

export const LIST_LABELS = LIST_NAMES;
export const lists = new Lists();
