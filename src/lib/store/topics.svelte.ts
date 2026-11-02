import { related, WINDOW, type Breadth } from "../domain/probableFlow";
import type { Event } from "../nostr/events";
import { fetchFromAuthors } from "../nostr/outbox";
import { eventsOf, pool } from "../nostr/pool";
import type { Feed } from "./feed.svelte";
import { globalRelays } from "./global";
import type { HomeTab } from "./home.svelte";
import { isMuted } from "./mutes";
import { viewer } from "./viewer.svelte";

/**
 * いまの話題・直前の流れ・たぶんこの流れ（Android 版の TopicsPanel・ProbableFlowPanel）。数えるのはホームの一覧に
 * ある投稿と、「新着」にたまっている投稿（いちばん新しい話）。
 */

/** ホームの一覧の、人が書いた短い投稿（リポスト・リアクションの列は除く）と、新着にたまっている分。 */
export function talkEvents(feed: Feed | undefined): Event[] {
  if (!feed) return [];
  const shown = feed.cards.filter((card) => !card.repost && !card.reaction && card.note.kind === 1).map((card) => card.note);
  const known = new Set(shown.map((e) => e.id));
  return [...shown, ...feed.pending.filter((e) => e.kind === 1 && !known.has(e.id) && !isMuted(e))];
}

/** 直前の流れのダイアログ（投稿欄といまの話題の行から開く）。 */
class FlowSummaryState {
  open = $state(false);
  tab = $state<HomeTab>("following");
  show(tab: HomeTab) {
    this.tab = tab;
    this.open = true;
  }
}
export const flowSummary = new FlowSummaryState();

/** いまの話題の行の、たたんだか・時間の長さ（このブラウザに覚える）。 */
class TopicsUi {
  folded = $state(false);
  window = $state(1);
  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem("topics-ui") ?? "{}") as { folded?: boolean; window?: number };
      this.folded = saved.folded === true;
      if (typeof saved.window === "number" && saved.window >= 0 && saved.window <= 2) this.window = saved.window;
    } catch {
      // 覚えていなければ最初の値
    }
  }
  save() {
    try {
      localStorage.setItem("topics-ui", JSON.stringify({ folded: this.folded, window: this.window }));
    } catch {
      // 保存できなくても動く
    }
  }
}
export const topicsUi = new TopicsUi();

/** たぶんこの流れ。選んだ投稿の前後 30 分を読み（ホームの範囲: フォロー中かグローバル）、ホームにある分と合わせて推定する。 */
export class ProbableFlow {
  pool = $state<Event[]>([]);
  breadth = $state<Breadth>("normal");
  loading = $state(true);
  message = $state<string | null>(null);
  readonly seed: Event;
  readonly scope: HomeTab;
  readonly flow = $derived.by(() => related(this.seed, this.pool, this.breadth));

  constructor(seed: Event, scope: HomeTab, known: Event[]) {
    this.seed = seed;
    this.scope = scope;
    this.pool = known.filter((e) => Math.abs(e.created_at - seed.created_at) <= WINDOW);
  }

  async load() {
    const filter = { kinds: [1], since: this.seed.created_at - WINDOW, until: this.seed.created_at + WINDOW, limit: 500 };
    try {
      let fetched;
      if (this.scope === "global") {
        const chosen = globalRelays(viewer.pubkey);
        fetched = await pool.fetch(chosen.length > 0 ? chosen : viewer.readRelays, [filter]);
      } else {
        const authors = [...new Set([...viewer.follows, ...(viewer.pubkey ? [viewer.pubkey] : [])])];
        const pinned = viewer.pubkey ? [{ author: viewer.pubkey, relays: viewer.writeRelays }] : [];
        fetched = await fetchFromAuthors(authors, filter, viewer.alwaysOn, undefined, 4000, pinned);
      }
      const known = new Set(this.pool.map((e) => e.id));
      this.pool = [...this.pool, ...eventsOf(fetched).filter((e) => e.kind === 1 && !known.has(e.id) && !isMuted(e))];
    } catch {
      this.message = "前後の投稿を読めませんでした。ホームにある分だけで推定しています。";
    } finally {
      this.loading = false;
    }
  }
}
