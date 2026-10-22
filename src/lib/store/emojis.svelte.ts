import { resolveCatalog, setReferences, type CustomEmoji } from "../domain/emojis";
import { latest, type Event } from "../nostr/events";
import { eventsOf, pool } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { viewer } from "./viewer.svelte";

/**
 * 自分のカスタム絵文字（NIP-30。Android 版の EmojiCatalogService.refresh）。パレットを初めて開いたときに、
 * 読み込み・書き込みリレーから kind 10030 を読み、指している絵文字セット（kind 30030）を作者と d で取り直す。
 */
class Emojis {
  custom = $state<CustomEmoji[]>([]);
  /** 読んだ絵文字リスト（kind 10030）。編集の画面で使う。 */
  listEvent = $state<Event>();
  loading = $state(false);
  private loadedFor: string | null = null;

  /** 読み直す（絵文字リストを書き換えたあと）。 */
  reload() {
    this.loadedFor = null;
    return this.load();
  }

  async load() {
    const me = viewer.pubkey;
    if (!me || this.loadedFor === me || this.loading) return;
    this.loading = true;
    try {
      const relays = relaySet([...viewer.readRelays, ...viewer.writeRelays]);
      const list = latest(eventsOf(await pool.fetch(relays, [{ kinds: [10030], authors: [me], limit: 5 }])).filter((e) => e.pubkey === me));
      this.listEvent = list;
      if (!list) {
        this.custom = [];
        this.loadedFor = me;
        return;
      }
      const refs = setReferences(list);
      const sets = [];
      for (let i = 0; i < refs.length; i += 50) {
        const chunk = refs.slice(i, i + 50);
        const fetched = await pool.fetch(relays, [{ kinds: [30030], authors: [...new Set(chunk.map((r) => r.author))], "#d": [...new Set(chunk.map((r) => r.identifier))], limit: 500 }]);
        sets.push(...eventsOf(fetched));
      }
      if (viewer.pubkey !== me) return;
      this.custom = resolveCatalog(list, sets);
      this.loadedFor = me;
    } finally {
      this.loading = false;
    }
  }
}

export const emojis = new Emojis();
