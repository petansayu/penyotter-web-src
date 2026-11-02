<script lang="ts">
  import PeusaEmpty from "./PeusaEmpty.svelte";
  import PeusaLoading from "./PeusaLoading.svelte";
  import { settings } from "../store/settings.svelte";
  import type { Card, Feed } from "../store/feed.svelte";
  import NoteCard from "./NoteCard.svelte";
  import { scrollOwnerToTop, scrolledFromTop } from "./scroll";
  import { tick } from "svelte";
  import { beyond, feedTime, lineIndex, type ReadMarker } from "../domain/readMarker";
  import { loadMarker, saveMarker } from "../store/readMarker";
  import { viewer } from "../store/viewer.svelte";
  import { atHref } from "../router.svelte";
  import { useNavigate } from "./navigation";

  /**
   * 一覧。下の端が見えたら続きを出し、出し切ったら続きを読む。accept はカラムの列の絞り込み。
   * 読んだ投稿を全部並べると（ホームでは 900 件ほどになる）スクロールが重くなるので、上から STEP 件ずつ出す。
   * 出した分も、画面の外にあるものは描かない（CSS の content-visibility）。
   * bookmark はホームのタブ（しおりを覚える単位）。画面に出たいちばん新しい投稿を覚え、開き直したときやタブに戻った
   * ときに、それより新しい投稿との境目に「ここまで読みました」の線を出す。
   */
  let { feed, empty = "投稿がありません", accept, label, bookmark }: { feed: Feed; empty?: string; accept?: (card: Card) => boolean;
    label?: (card: Card) => string | null; bookmark?: "following" | "global" } = $props();

  const STEP = 40;
  const cards = $derived(accept ? feed.cards.filter(accept) : feed.cards);
  let limit = $state(STEP);
  const shown = $derived(cards.slice(0, limit));

  let sentinel = $state<HTMLElement>();
  let top = $state<HTMLElement>();

  // 読んでいる途中（一番上から下がっている）に届いた投稿は、「新着 N 件」にためる（Android 版と同じ）
  $effect(() => {
    const current = feed;
    current.hold = () => !!top && scrolledFromTop(top) > 200;
    return () => (current.hold = () => false);
  });

  // しおり。線は開いたとき（とタブに戻ったとき）の位置のまま動かさず、覚える位置だけ読み進めるたびに進める。
  const navigate = useNavigate();
  let marker = $state<ReadMarker | null>(null);
  let stored: ReadMarker | null = null;
  $effect(() => {
    const me = viewer.pubkey; const tab = bookmark;
    if (!me || !tab) return;
    stored = marker = loadMarker(me, tab);
    resumed = false;
    const back = () => { if (document.visibilityState === "visible") { stored = marker = loadMarker(me, tab); resumed = false; } };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  });
  const lineAt = $derived(bookmark && settings.readMarker ? lineIndex(cards, marker) : null);
  const farther = $derived(bookmark && settings.readMarker ? beyond(cards, marker) && !feed.finished : false);
  let lineBelow = $state(false);
  /** 線が画面に出たら（ボタンを押したら）、「前回の続きから」はこの回はもう出さない。 */
  let resumed = $state(false);
  const visible = new Map<Element, number>();

  /** 画面に出た投稿を数え、いちばん新しいものがしおりより新しければ覚える。 */
  function seen(node: HTMLElement, time: number) {
    if (!bookmark) return;
    node.dataset.time = String(time);
    observer?.observe(node);
    return { destroy: () => { observer?.unobserve(node); visible.delete(node); } };
  }
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.set(entry.target, Number((entry.target as HTMLElement).dataset.time));
      else visible.delete(entry.target);
    }
    const me = viewer.pubkey; const tab = bookmark;
    if (!me || !tab || document.visibilityState !== "visible" || visible.size === 0) return;
    const newest = Math.max(...visible.values());
    if (stored && stored.time >= newest) return;
    const card = cards.find((c) => feedTime(c) === newest);
    if (!card) return;
    stored = { time: newest, key: card.key };
    saveMarker(me, tab, stored);
  });
  $effect(() => () => observer?.disconnect());

  /** 線が画面より下にあるか（まだ出していない分にあるときも下）。 */
  function line(node: HTMLElement) {
    const watch = new IntersectionObserver(([entry]) => {
      lineBelow = !entry.isIntersecting && entry.boundingClientRect.top > 0;
      if (entry.isIntersecting) resumed = true;
    });
    watch.observe(node);
    return { destroy: () => { watch.disconnect(); lineBelow = false; } };
  }
  const lineHidden = $derived(lineAt !== null && lineAt >= limit);

  async function resume() {
    resumed = true;
    if (lineAt !== null) {
      if (lineAt >= limit) limit = lineAt + STEP;
      await tick();
      top?.parentElement?.querySelector(".read-line")?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (marker && bookmark) navigate(atHref(marker.time, bookmark));
  }

  function showNew() {
    feed.reveal();
    scrollOwnerToTop(top, "smooth");
  }

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

<span class="top" bind:this={top}></span>
{#if feed.pending.length > 0 || (!resumed && (lineBelow || lineHidden || farther))}
  <div class="floating">
    {#if feed.pending.length > 0}<button type="button" class="new" onclick={showNew}>↑ 新着 {feed.pending.length}件</button>{/if}
    {#if !resumed && (lineBelow || lineHidden || farther)}<button type="button" class="new resume" onclick={resume} data-testid="read-marker-jump">↓ 前回の続きから</button>{/if}
  </div>
{/if}
{#each shown as card, index (card.key)}
  {#if index === lineAt}<div class="read-line" use:line data-testid="read-marker"><span>ここまで読みました</span></div>{/if}
  <div class="item" use:seen={feedTime(card)}>
    {#if label?.(card)}<div class="activity">{label(card)}</div>{/if}
    <NoteCard note={card.note} repost={card.repost} reaction={card.reaction} />
  </div>
{/each}

<div class="footer" bind:this={sentinel}>
  {#if feed.loading && settings.peusaMode}
    <PeusaLoading />
  {:else if feed.loading}
    <span>読み込んでいます…</span>
  {:else if feed.message}
    <span>{feed.message}</span>
    {#if !feed.finished}<button type="button" onclick={() => feed.more()}>もう一度読む</button>{/if}
  {:else if feed.finished && limit >= cards.length && cards.length === 0 && settings.peusaMode}
    <PeusaEmpty picture={bookmark ? "empty-home" : "empty-search"} message={empty} />
  {:else if feed.finished && limit >= cards.length}
    <span>{cards.length === 0 ? empty : "ここまでです"}</span>
  {:else}
    <button type="button" onclick={() => (limit < cards.length ? (limit += STEP) : feed.more())}>さらに読む</button>
  {/if}
</div>

<style>
  .floating {
    position: sticky;
    top: calc(var(--sticky-top, 52px) + 8px);
    z-index: 6;
    display: flex;
    justify-content: center;
    gap: 8px;
    padding: 8px 0;
  }
  .read-line {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 0.75em;
    color: var(--primary);
    border-bottom: 1px solid var(--outline-variant);
  }
  .read-line::before,
  .read-line::after {
    content: "";
    flex: 1;
    border-top: 1px solid var(--primary);
  }
  .new.resume {
    color: var(--primary);
    background: var(--primary-container);
  }
  .new {
    flex: none;
    margin: 0;
    padding: 8px 18px;
    font: inherit;
    font-weight: 600;
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    border-radius: 999px;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
    cursor: pointer;
  }
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
  .activity {
    padding: 6px 16px 0 68px;
    font-size: 0.75em;
    color: var(--primary);
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
