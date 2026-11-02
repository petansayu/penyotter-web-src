import { byNewest, type Event } from "../nostr/events";
import { fetchFromAuthor, loadRelayLists, relayLists } from "../nostr/outbox";
import { eventsOf, pool } from "../nostr/pool";
import { relaySet } from "../nostr/relayUrl";
import { keepNotes, requestProfiles } from "./cache.svelte";
import { isMuted } from "./mutes";
import { viewer } from "./viewer.svelte";

/**
 * この投稿を引用した投稿（Android 版の QuoteSync）。`q` タグでその投稿を指すもの（kind 1・1111）を、読み込み
 * リレー・投稿のリレー・作者の読み込みリレー（引用は相手の読み込みリレーにも送られる）から。新しい順。
 */
export async function quotesOf(id: string, author: string | undefined, hints: string[] = []): Promise<Event[]> {
  if (author) await loadRelayLists([author], viewer.readRelays);
  const inbox = author ? relayLists.get(author)?.list?.read.slice(0, 4) ?? [] : [];
  const relays = relaySet([...viewer.readRelays, ...hints, ...inbox]);
  const events = eventsOf(await pool.fetch(relays, [{ kinds: [1, 1111], "#q": [id], limit: 200 }]))
    .filter((event) => event.tags.some((t) => t[0] === "q" && t[1] === id) && !isMuted(event))
    .sort(byNewest);
  keepNotes(events, null);
  requestProfiles(events.map((event) => event.pubkey));
  return events;
}

/**
 * 2 人の会話（Android 版の ConversationController）。a が b に宛てた投稿（`p` に b）と、b が a に宛てた投稿を、
 * それぞれの書き込みリレーから読む。古い順に並べ、さかのぼって読み足す。
 */
export class Conversation {
  events = $state<Event[]>([]);
  loading = $state(false);
  done = $state(false);
  message = $state<string | null>(null);
  private until: number | undefined;

  constructor(readonly a: string, readonly b: string) {}

  async older() {
    if (this.loading || this.done) return;
    this.loading = true;
    this.message = null;
    try {
      const page = (from: string, to: string) =>
        fetchFromAuthor(from, [{ kinds: [1, 1111], authors: [from], "#p": [to], limit: 40, ...(this.until !== undefined ? { until: this.until } : {}) }], viewer.readRelays);
      const [fromA, fromB] = await Promise.all([page(this.a, this.b), page(this.b, this.a)]);
      const known = new Set(this.events.map((e) => e.id));
      const fresh = [...eventsOf(fromA), ...eventsOf(fromB)].filter((e) => !known.has(e.id) && !isMuted(e) &&
        ((e.pubkey === this.a && e.tags.some((t) => t[0] === "p" && t[1] === this.b)) || (e.pubkey === this.b && e.tags.some((t) => t[0] === "p" && t[1] === this.a))));
      if (fresh.length === 0) {
        this.done = true;
        return;
      }
      keepNotes(fresh, null);
      requestProfiles([this.a, this.b]);
      this.until = Math.min(...fresh.map((e) => e.created_at)) - 1;
      this.events = [...this.events, ...fresh].sort((x, y) => x.created_at - y.created_at || (x.id < y.id ? -1 : 1));
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }
}
