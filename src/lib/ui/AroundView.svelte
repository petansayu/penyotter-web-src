<script lang="ts">
  import { tick, untrack } from "svelte";
  import { AROUND_SCOPES, type AroundScope } from "../domain/around";
  import type { Event } from "../nostr/events";
  import { aroundHref, atHref } from "../router.svelte";
  import { Around } from "../store/around.svelte";
  import { displayName, requestNote } from "../store/cache.svelte";
  import { viewer } from "../store/viewer.svelte";
  import NoteCard from "./NoteCard.svelte";
  import { useNavigate } from "./navigation";

  /**
   * 前後の投稿（Android 版の AroundPanel）。選んだ投稿（またはリポスト）を真ん中に、上にそのあと・下にその前を並べる。
   * 範囲（フォロー中・グローバル・この人だけ）を選べる。
   */
  let { id, at, scope, author }: { id?: string; at?: number; scope: AroundScope; author?: string } = $props();

  const navigate = useNavigate();
  let anchor = $state<Event | null>(null);
  let missing = $state(false);
  let around = $state<Around | null>(null);
  let list = $state<HTMLElement>();

  $effect(() => {
    const [key, by] = [id, author];
    if (!key) return;
    untrack(() => {
      anchor = null;
      missing = false;
      void requestNote(key, [], by).then((event) => {
        if (key !== id) return;
        if (event) anchor = event;
        else missing = true;
      });
    });
  });

  $effect(() => {
    const [event, chosen, time, by] = [anchor, scope, at, author];
    if ((!event && time === undefined) || !viewer.ready) return;
    untrack(() => {
      const current = event ? new Around(event, chosen) : new Around(null, chosen, { time: time!, author: by });
      around = current;
      void Promise.all([current.older(), current.newer()]).then(async () => {
        if (around !== current) return;
        await tick();
        list?.querySelector("[data-anchor]")?.scrollIntoView({ block: "center" });
      });
    });
  });

  /** 後ろを足すと上に増えるので、見ていた位置（選んだ投稿）がずれないように、足した分だけ下げる。 */
  async function newer() {
    const current = around;
    if (!current) return;
    const before = list?.scrollHeight ?? 0;
    const owner = scrollOwner();
    await current.newer();
    await tick();
    const added = (list?.scrollHeight ?? 0) - before;
    if (added > 0) owner.scrollBy({ top: added });
  }

  function scrollOwner(): HTMLElement | Window {
    let node = list?.parentElement ?? null;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 1) return node;
      node = node.parentElement;
    }
    return window;
  }

  const anchorAuthor = $derived(anchor?.pubkey ?? author ?? null);
  const scopeHref = (next: AroundScope) => (id ? aroundHref(id, next, author) : atHref(at ?? 0, next, author));
  /** 時刻から開いたとき、その時刻の線をどのカードの前に引くか（カードは新しい順）。 */
  const lineBefore = $derived(around && !around.anchor ? around.feed.cards.find((card) => (card.repost ?? card.note).created_at < around!.time)?.key ?? null : null);
</script>

<section class="around">
  <h2>{anchor && (anchor.kind === 6 || anchor.kind === 16) ? `${displayName(anchor.pubkey)} がリポストした前後` : at !== undefined ? `${new Date(at * 1000).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" })} ごろのタイムライン` : "前後の投稿"}</h2>
  <div class="scopes" role="radiogroup" aria-label="範囲">
    {#each AROUND_SCOPES as item (item.scope)}
      <button type="button" role="radio" aria-checked={scope === item.scope} class:active={scope === item.scope}
        disabled={item.scope === "author" && !anchorAuthor}
        onclick={() => navigate(scopeHref(item.scope))}>{item.scope === "author" && anchorAuthor ? `${displayName(anchorAuthor)} だけ` : item.label}</button>
    {/each}
  </div>
  {#if missing}<p class="note">投稿が見つかりませんでした</p>
  {:else if !anchor && at === undefined}<p class="note">投稿を読み込んでいます…</p>{/if}
  {#if around}
    {#if around.message}<p class="note">{around.message}</p>{/if}
    <button type="button" class="more" disabled={around.newerLoading || around.newerDone} onclick={newer}>
      {around.newerDone ? "これより後の投稿はありません" : around.newerLoading ? "読み込んでいます…" : "↑ さらに後を読む"}
    </button>
    <div bind:this={list}>
      {#each around.feed.cards as card (card.key)}
        {#if card.key === lineBefore}<div class="time-line" data-anchor>この時刻</div>{/if}
        {@const isAnchor = !!around.anchor && (card.key === around.anchor.id || card.note.id === around.anchor.id)}
        <div class="item" class:anchor={isAnchor} data-anchor={isAnchor ? "" : undefined}>
          <NoteCard note={card.note} repost={card.repost} reaction={card.reaction} />
        </div>
      {/each}
      {#if !around.anchor && lineBefore === null && around.feed.cards.length > 0}<div class="time-line" data-anchor>この時刻</div>{/if}
    </div>
    <button type="button" class="more" disabled={around.olderLoading || around.olderDone} onclick={() => around?.older()}>
      {around.olderDone ? "これより前の投稿はありません" : around.olderLoading ? "読み込んでいます…" : "↓ さらに前を読む"}
    </button>
  {/if}
</section>

<style>
  /* 時刻から開いたときの、その時刻の線 */
  .time-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 16px;
    color: var(--primary);
    font-size: 0.85em;
    font-weight: 600;
  }
  .time-line::before,
  .time-line::after {
    content: "";
    flex: 1;
    border-top: 2px solid var(--primary);
  }
  .around {
    padding-bottom: 24px;
  }
  h2 {
    margin: 12px 16px 8px;
    font-size: 1.1rem;
  }
  .scopes {
    display: flex;
    margin: 0 16px 8px;
    border: 1px solid var(--outline);
    border-radius: 999px;
    overflow: hidden;
  }
  .scopes button {
    flex: 1;
    min-width: 0;
    padding: 7px 4px;
    font: inherit;
    font-size: 0.9em;
    color: var(--text);
    background: none;
    border: none;
    border-right: 1px solid var(--outline);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .scopes button:last-child {
    border-right: none;
  }
  .scopes button.active {
    font-weight: 600;
    background: var(--secondary-container);
  }
  .note {
    margin: 8px 16px;
    color: var(--muted);
    font-size: 0.9em;
  }
  .more {
    display: block;
    width: calc(100% - 32px);
    margin: 8px 16px;
    padding: 8px;
    font: inherit;
    color: var(--primary);
    background: var(--surface-low);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .more:disabled {
    color: var(--muted);
    cursor: default;
  }
  .item {
    border-bottom: 1px solid var(--outline-variant);
  }
  /* 選んだ投稿は、左の線と背景で目立たせる */
  .item.anchor {
    background: var(--secondary-container);
    box-shadow: inset 4px 0 0 var(--primary);
  }
</style>
