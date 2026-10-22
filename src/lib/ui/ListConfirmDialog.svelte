<script lang="ts">
  import { LIST_LABELS, lists } from "../store/lists.svelte";
  import { displayName } from "../store/cache.svelte";

  /** 一覧の書き換えの確認（技術資料 7.2、Android 版の FollowPrompt）。外れる・増える項目を出す。 */
  const confirmation = $derived(lists.confirmation);
  const SHOWN = 50;

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (confirmation && dialog && !dialog.open) dialog.showModal();
    if (!confirmation && dialog?.open) dialog.close();
  });

  const message = $derived.by(() => {
    if (!confirmation) return "";
    const name = LIST_LABELS[confirmation.kind];
    switch (confirmation.reason) {
      case "missing": return `${name}がリレーにもこのブラウザにも見つかりませんでした。新しく作ると、ほかのアプリで作った${name}があっても置き換わります。`;
      case "emptied": return `${name}が空になります。`;
      case "many-removed": return `${name}から ${confirmation.diff.removed.length} 件が外れます。`;
    }
  });

  function label(tag: string[]) {
    switch (tag[0]) {
      case "p": return `人: ${displayName(tag[1])}`;
      case "e": return `投稿: ${tag[1].slice(0, 12)}…`;
      case "t": return `#${tag[1]}`;
      case "word": return `語: ${tag[1]}`;
      default: return `${tag[0]}: ${tag[1]}`;
    }
  }
</script>

<dialog bind:this={dialog} oncancel={(event) => { event.preventDefault(); confirmation?.answer(false); }} aria-label="一覧の書き換えの確認">
  {#if confirmation}
    <h2>送る前に確かめてください</h2>
    <p>{message}</p>
    {#each [["外れる", confirmation.diff.removed], ["増える", confirmation.diff.added]] as const as [title, tags] (title)}
      {#if tags.length > 0}
        <h3>{title}（{tags.length} 件）</h3>
        <ul>
          {#each tags.slice(0, SHOWN) as tag, i (i)}<li>{label(tag)}</li>{/each}
          {#if tags.length > SHOWN}<li class="muted">ほか {tags.length - SHOWN} 件</li>{/if}
        </ul>
      {/if}
    {/each}
    <div class="actions">
      <button type="button" class="text" onclick={() => confirmation.answer(false)}>やめる</button>
      <button type="button" class="ok" onclick={() => confirmation.answer(true)}>続ける</button>
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(92vw, 440px);
    max-height: 80dvh;
    padding: 16px 20px;
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1.1rem;
  }
  h3 {
    margin: 12px 0 4px;
    font-size: 0.95rem;
  }
  p {
    margin: 0;
  }
  ul {
    margin: 0;
    padding-left: 20px;
    max-height: 30dvh;
    overflow-y: auto;
    font-size: 0.9em;
  }
  .muted {
    color: var(--muted);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  button {
    font: inherit;
    cursor: pointer;
    border-radius: 999px;
    padding: 6px 18px;
  }
  .text {
    color: var(--primary);
    background: none;
    border: none;
  }
  .ok {
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    font-weight: 600;
  }
</style>
