<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * ミュートしている投稿の札（引用カード・投稿の詳細の返信元）。名前・アイコン・本文は出さず、「表示する」を押すと
   * 中身（children）を出す。設定で「完全に隠す」にしたときは、呼び出し側が札も出さない。
   */
  let { label, children }: { label: string; children: Snippet } = $props();
  let shown = $state(false);
</script>

{#if shown}
  {@render children()}
{:else}
  <div class="muted-note">
    <span>{label}</span>
    <button type="button" onclick={(event) => { event.preventDefault(); event.stopPropagation(); shown = true; }}>表示する</button>
  </div>
{/if}

<style>
  .muted-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    padding: 8px 12px;
    border: 1px dashed var(--outline);
    border-radius: 12px;
    color: var(--muted);
    font-size: 0.85em;
  }
  .muted-note span {
    flex: 1;
  }
  button {
    padding: 2px 10px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
</style>
