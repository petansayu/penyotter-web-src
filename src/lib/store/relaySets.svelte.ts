import { createRelaySet, editRelaySet, newestSets, newSetIdentifier, parseRelaySets, RELAY_SET_KIND, setIdentifier, type RelaySet, type RelaySetChange } from "../domain/relaySets";
import type { Event } from "../nostr/events";
import { eventsOf, pool, publish } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { recordVersion } from "./listHistory";
import { fetchLatest } from "./lists.svelte";
import { summary } from "./publishSummary";
import { privateTags } from "./sources";
import { toast } from "./toast.svelte";
import { viewer } from "./viewer.svelte";

/**
 * 自分のリレーセット（kind 30002。Android 版の RelaySetService）。署名できるアカウントでは作る・リレーを足す・外す・
 * 名前を変える。絵文字パックと同じ守り方で、変更は 1 つずつ、毎回 `#d` で取り直し（完了が必要）、前後の版を一覧の履歴へ。
 * 非公開のリレーは、署名できるときに復号して出すだけ（変えない）。
 */
class RelaySets {
  sets = $state<RelaySet[] | null>(null);
  busy = $state(false);
  message = $state<string | null>(null);
  private events: Event[] = [];
  private hidden = new Map<string, string[][]>();
  private lock: Promise<unknown> = Promise.resolve();

  private get relays() {
    return relaySet([...viewer.readRelays, ...viewer.writeRelays]);
  }

  async load() {
    const me = viewer.pubkey;
    if (!me) return;
    this.message = null;
    const fetched = await pool.fetch(this.relays, [{ kinds: [RELAY_SET_KIND], authors: [me], limit: 200 }]);
    if (viewer.pubkey !== me) return;
    if (!fetched.complete && fetched.events.size === 0) this.message = "リレーセットを取得できませんでした。接続を確かめて、もう一度試してください。";
    this.events = newestSets(eventsOf(fetched), me);
    this.refresh(me);
    // 非公開のリレーは、署名できるときだけ復号して足す
    for (const event of this.events) {
      if (!event.content || this.hidden.has(event.id)) continue;
      this.hidden.set(event.id, []);
      void privateTags(event).then((tags) => {
        this.hidden.set(event.id, tags);
        if (viewer.pubkey === me) this.refresh(me);
      });
    }
  }

  private refresh(me: string) {
    this.sets = parseRelaySets(this.events, me, (event) => this.hidden.get(event.id) ?? []);
  }

  find(identifier: string) {
    return this.sets?.find((set) => set.identifier === identifier);
  }

  /** セットを作る（relays を最初から入れる）。作ったセットの識別子を返す。 */
  create(title: string, relays: string[] = []): Promise<string | null> {
    return this.run(async (me) => {
      let identifier = newSetIdentifier(Math.floor(Date.now() / 1000), Math.floor(Math.random() * 0x10000));
      if (await this.latest(me, identifier)) identifier = newSetIdentifier(Math.floor(Date.now() / 1000), Math.floor(Math.random() * 0x10000));
      const signer = await viewer.getSigner();
      await this.send(me, await signer.sign(createRelaySet(identifier, title, relays, Math.floor(Date.now() / 1000))));
      return identifier;
    });
  }

  change(identifier: string, change: RelaySetChange): Promise<string | null> {
    return this.run(async (me) => {
      const base = await this.latest(me, identifier);
      if (!base) throw new Error("このリレーセットが見つかりませんでした");
      const signer = await viewer.getSigner();
      await this.send(me, await signer.sign(editRelaySet(me, base, change, Math.floor(Date.now() / 1000))));
      return identifier;
    });
  }

  private run(task: (me: string) => Promise<string>): Promise<string | null> {
    const me = viewer.pubkey;
    if (!me || !viewer.canSign) return Promise.resolve(null);
    const next = this.lock.catch(() => {}).then(async () => {
      this.busy = true;
      try {
        return await task(me);
      } catch (e) {
        toast.show(e instanceof Error ? e.message : String(e), 6000);
        return null;
      } finally {
        this.busy = false;
      }
    });
    this.lock = next;
    return next;
  }

  private async latest(me: string, identifier: string): Promise<Event | undefined> {
    const fetched = await fetchLatest(this.relays, [{ kinds: [RELAY_SET_KIND], authors: [me], "#d": [identifier], limit: 5 }]);
    if (!fetched.complete) throw new Error("最新のリレーセットを取得できませんでした。接続を確かめて、もう一度試してください。");
    const newest = newestSets(eventsOf(fetched), me).find((event) => setIdentifier(event.tags) === identifier);
    if (newest && !(await recordVersion(me, newest, "relay"))) throw new Error("一覧の履歴をこのブラウザに保存できなかったので、変更をやめました。");
    return newest;
  }

  private async send(me: string, event: Event) {
    if (!(await recordVersion(me, event, "app"))) throw new Error("一覧の履歴をこのブラウザに保存できなかったので、送りませんでした。");
    const result = await publish(viewer.writeRelays, event);
    toast.show(summary(result));
    if (result.accepted === 0) throw new Error("リレーセットをリレーに受理してもらえませんでした");
    const id = setIdentifier(event.tags);
    this.events = [event, ...this.events.filter((e) => setIdentifier(e.tags) !== id)];
    this.refresh(me);
  }
}

export const relaySets = new RelaySets();
