<script lang="ts">
  import type { Card } from "../store/feed.svelte";
  import { globalRelays } from "../store/global";
  import { home } from "../store/home.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Timeline from "./Timeline.svelte";

  /**
   * ホームの一覧。tabs は 1 列のときのタブ付き（フォロー中・グローバル）。カラムの列では、フォロー中だけか
   * グローバルだけを出す。
   */
  let { show = "tabs", accept }: { show?: "tabs" | "following" | "global"; accept?: (card: Card) => boolean } = $props();

  const tab = $derived(show === "tabs" ? home.tab : show);

  // グローバルだけの列は、開いたときにグローバルを読み始める
  $effect(() => {
    if (show === "global") home.ensureGlobal();
  });
</script>

{#if viewer.error}<p class="notice">{viewer.error}</p>{/if}
{#if viewer.relayListChange}
  <p class="notice">プロフィールのリレーリストに変更があります（ほかのアプリで更新されたようです）。
    <a href="#/settings/relays">確かめる</a>
  </p>
{/if}
{#if !viewer.ready}<p class="notice">リレーとフォロー一覧を読んでいます…</p>{/if}
{#if show === "tabs"}
  <div class="home-tabs" role="tablist">
    <button type="button" role="tab" aria-selected={home.tab === "following"} class:active={home.tab === "following"} onclick={() => home.choose("following")}>フォロー中</button>
    <button type="button" role="tab" aria-selected={home.tab === "global"} class:active={home.tab === "global"} onclick={() => home.choose("global")}>グローバル</button>
  </div>
{/if}
{#if tab === "following" && home.following}<Timeline feed={home.following} empty="フォロー中の人の投稿がありません" {accept} />{/if}
{#if tab === "global" && home.global}
  {#if globalRelays(viewer.pubkey).length === 0}<p class="notice">グローバルは読み込みリレーから読んでいます。設定の「グローバルで読むリレー」で変えられます。</p>{/if}
  <Timeline feed={home.global} empty="投稿がありません" {accept} />
{/if}

<style>
  .home-tabs {
    position: sticky;
    top: var(--sticky-top, 52px);
    z-index: 5;
    display: flex;
    background: var(--background);
    border-bottom: 1px solid var(--outline-variant);
  }
  .home-tabs button {
    flex: 1;
    font: inherit;
    font-weight: 600;
    padding: 10px;
    color: var(--muted);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .home-tabs button.active {
    color: var(--primary);
    border-bottom-color: var(--primary);
  }
  .notice {
    color: var(--muted);
    padding: 12px 16px;
    margin: 0;
  }
</style>
