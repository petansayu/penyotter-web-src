<script lang="ts">
  import type { Card, Feed } from "../store/feed.svelte";
  import NoteCard from "./NoteCard.svelte";

  /**
   * 一覧。下の端が見えたら続きを出し、出し切ったら続きを読む。accept はカラムの列の絞り込み。
   * 読んだ投稿を全部並べると（ホームでは 900 件ほどになる）スクロールが重くなるので、上から STEP 件ずつ出す。
   * 出した分も、画面の外にあるものは描かない（CSS の content-visibility）。
   */
  let { feed, empty = "投稿がありません", accept }: { feed: Feed; empty?: string; accept?: (card: Card) => boolean } = $props();

  const STEP = 40;
  const cards = $derived(accept ? feed.cards.filter(accept) : feed.cards);
  let limit = $state(STEP);
  const shown = $derived(cards.slice(0, limit));

  let sentinel = $state<HTMLElement>();

  /** 下の端が近いか。近いままなら、出す分を増やすたびに続けて増やす（観測は変わったときしか知らせないため）。 */
  let near = $state(false);

  $effect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      near = entries.some((entry) => entry.isIntersecting);
      if (near && limit >= cards.length) void feed.more();
    }, { rootMargin: "800px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (near && limit < cards.length) {
      // 描いたあとにもう一度確かめる
      const timer = setTimeout(() => (limit += STEP), 50);
      return () => clearTimeout(timer);
    }
  });
</script>

{#each shown as card (card.key)}
  <div class="item"><NoteCard note={card.note} repost={card.repost} reaction={card.reaction} /></div>
{/each}

<div class="footer" bind:this={sentinel}>
  {#if feed.loading}
    <span>読み込んでいます…</span>
  {:else if feed.message}
    <span>{feed.message}</span>
    {#if !feed.finished}<button type="button" onclick={() => feed.more()}>もう一度読む</button>{/if}
  {:else if feed.finished && limit >= cards.length}
    <span>{cards.length === 0 ? empty : "ここまでです"}</span>
  {:else}
    <button type="button" onclick={() => (limit < cards.length ? (limit += STEP) : feed.more())}>さらに読む</button>
  {/if}
</div>

<style>
  /* 画面の外のカードは、配置と描画を飛ばす（高さは前に描いたときのもの、まだなら 200px とみなす） */
  .item {
    content-visibility: auto;
    contain-intrinsic-size: auto 200px;
  }
  /* 絵文字のパレットや「…」のメニューを開いている項目は、はみ出した部分も描く（content-visibility は描く範囲を
     項目の中に限るので、開いたパレットが切り取られて見えなくなっていた） */
  .item:has(:global(.picker), :global(.menu), :global(.mentions)) {
    content-visibility: visible;
  }
  .footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 24px 16px 48px;
    color: var(--muted);
  }
  button {
    font: inherit;
    color: var(--primary);
    background: var(--primary-container);
    border: none;
    border-radius: 999px;
    padding: 8px 20px;
    cursor: pointer;
  }
</style>
