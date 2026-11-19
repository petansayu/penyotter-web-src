import { createPack, editPack, newPackIdentifier, ownPacks, PACK_KIND, packIdentifier, type PackChange } from "../domain/emojiPackEditing";
import type { Event } from "../nostr/events";
import { eventsOf, pool, publish } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { emojis } from "./emojis.svelte";
import { recordVersion } from "./listHistory";
import { fetchLatest, lists } from "./lists.svelte";
import { summary } from "./publishSummary";
import { toast } from "./toast.svelte";
import { viewer } from "./viewer.svelte";

/**
 * 自分の絵文字パック（kind 30030。Android 版の EmojiPackService）。ほかの一覧と同じ守り方で、変更は 1 つずつ、
 * 毎回そのパックを `#d` で取り直し（完了しなければやめる。見つからないパックを作り直さない）、前後の版を一覧の履歴へ。
 */
class MyEmojiPacks {
  packs = $state<Event[]>([]);
  loading = $state(false);
  busy = $state(false);
  message = $state<string | null>(null);
  private lock: Promise<unknown> = Promise.resolve();

  private get relays() {
    return relaySet([...viewer.readRelays, ...viewer.writeRelays]);
  }

  /** 自分のパックを読む。 */
  async load() {
    const me = viewer.pubkey;
    if (!me) return;
    this.loading = true;
    this.message = null;
    try {
      const fetched = await pool.fetch(this.relays, [{ kinds: [PACK_KIND], authors: [me], limit: 200 }]);
      if (!fetched.complete && fetched.events.size === 0) throw new Error("絵文字パックを取得できませんでした。接続を確かめて、もう一度試してください。");
      if (viewer.pubkey === me) this.packs = ownPacks(eventsOf(fetched), me);
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  /** パックを作る。addToList なら、自分の絵文字リスト（kind 10030）にも入れる。 */
  create(title: string, addToList: boolean) {
    return this.run(async (me) => {
      let identifier = newPackIdentifier(Math.floor(Date.now() / 1000), Math.floor(Math.random() * 0x10000));
      if (await this.latest(me, identifier)) identifier = newPackIdentifier(Math.floor(Date.now() / 1000), Math.floor(Math.random() * 0x10000));
      const signer = await viewer.getSigner();
      const event = await signer.sign(createPack(identifier, title, Math.floor(Date.now() / 1000)));
      await this.send(me, event);
      if (addToList) await lists.addEmojiSet(`${PACK_KIND}:${me}:${identifier}`);
    });
  }

  /** パックを 1 つ変える（絵文字を足す・外す、名前を変える）。 */
  change(identifier: string, change: PackChange) {
    return this.run(async (me) => {
      const base = await this.latest(me, identifier);
      if (!base) throw new Error("この絵文字パックが見つかりませんでした");
      const signer = await viewer.getSigner();
      await this.send(me, await signer.sign(editPack(me, base, change, Math.floor(Date.now() / 1000))));
    });
  }

  private run(task: (me: string) => Promise<void>): Promise<boolean> {
    const me = viewer.pubkey;
    if (!me || !viewer.canSign) return Promise.resolve(false);
    const next = this.lock.catch(() => {}).then(async () => {
      this.busy = true;
      try {
        await task(me);
        return true;
      } catch (e) {
        toast.show(e instanceof Error ? e.message : String(e), 6000);
        return false;
      } finally {
        this.busy = false;
      }
    });
    this.lock = next;
    return next;
  }

  /** そのパックのいちばん新しい版を取り直す（完了しなければやめる）。見つかった版は履歴に残す。 */
  private async latest(me: string, identifier: string): Promise<Event | undefined> {
    const fetched = await fetchLatest(this.relays, [{ kinds: [PACK_KIND], authors: [me], "#d": [identifier], limit: 5 }]);
    if (!fetched.complete) throw new Error("最新の絵文字パックを取得できませんでした。接続を確かめて、もう一度試してください。");
    const newest = ownPacks(eventsOf(fetched), me).find((event) => packIdentifier(event.tags) === identifier);
    if (newest && !(await recordVersion(me, newest, "relay"))) throw new Error("一覧の履歴をこのブラウザに保存できなかったので、変更をやめました。");
    return newest;
  }

  /** 署名した版を履歴に残してから、書き込みリレーへ送る。受理されたら一覧とパレットに出す。 */
  private async send(me: string, event: Event) {
    if (!(await recordVersion(me, event, "app"))) throw new Error("一覧の履歴をこのブラウザに保存できなかったので、送りませんでした。");
    const result = await publish(viewer.writeRelays, event);
    toast.show(summary(result));
    if (result.accepted === 0) throw new Error("絵文字パックをリレーに受理してもらえませんでした");
    const id = packIdentifier(event.tags);
    this.packs = [event, ...this.packs.filter((p) => packIdentifier(p.tags) !== id)];
    void emojis.reload();
  }
}

export const myEmojiPacks = new MyEmojiPacks();
