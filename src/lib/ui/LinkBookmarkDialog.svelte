<script lang="ts">
  import { MAX_TITLE, normalizeLink } from "../domain/linkBookmarks";
  import type { Event } from "../nostr/events";
  import { linkBookmarks } from "../store/linkBookmarks.svelte";
  import { viewer } from "../store/viewer.svelte";

  /** リンクをブックマークに足す（Android 版の LinkBookmarkDialog）。url は最初の値（「＋」なら空）、from は見つけた投稿。 */
  let { url: initialUrl = "", from, close }: { url?: string; from?: Event; close: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let url = $state((() => initialUrl)());
  let title = $state("");
  let isPublic = $state(false);
  let error = $state<string | null>(null);
  const valid = $derived(normalizeLink(url) !== null);

  $effect(() => {
    dialog?.showModal();
  });

  async function add() {
    error = null;
    try {
      await linkBookmarks.add(url, title, isPublic, from);
      dialog?.close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<dialog bind:this={dialog} onclose={close} aria-label="リンクをブックマーク">
  <h3>リンクをブックマーク</h3>
  <label class="field"><span>URL</span><input type="url" bind:value={url} placeholder="https://…" /></label>
  {#if url.trim() && !valid}<p class="error">http か https の URL を入力してください</p>{/if}
  <label class="field"><span>題名（空ならホスト名）</span><input type="text" maxlength={MAX_TITLE} bind:value={title} /></label>
  <label class="choice"><input type="radio" name="link-visibility" value={false} bind:group={isPublic} />非公開（このブラウザだけ）</label>
  <label class="choice" class:disabled={!viewer.canSign}><input type="radio" name="link-visibility" value={true} bind:group={isPublic} disabled={!viewer.canSign} />{viewer.canSign ? "公開（リレーに保存）" : "公開（署名できるアカウントで使えます）"}</label>
  {#if isPublic}<p class="error">公開のブックマークは、だれでも見られます（NIP-B0、kind 39701）。</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
  <div class="buttons">
    <button type="button" onclick={() => dialog?.close()}>キャンセル</button>
    <button type="button" class="filled" disabled={!valid || linkBookmarks.busy} onclick={add}>追加</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(92vw, 420px);
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h3 {
    margin: 0 0 10px;
  }
  .field {
    display: grid;
    gap: 4px;
    margin-bottom: 8px;
    font-size: 0.85em;
    color: var(--muted);
  }
  .field input {
    font: inherit;
    font-size: 1rem;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
  }
  .choice.disabled {
    color: var(--muted);
  }
  .error {
    margin: 4px 0;
    font-size: 0.85em;
    color: #c33;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
  .buttons button {
    padding: 6px 16px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  .buttons .filled {
    color: var(--on-primary, #fff);
    background: var(--primary);
    border: none;
  }
  .buttons button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
