<script lang="ts">
  import { REPORT_TYPES } from "../domain/extraEvents";
  import type { Event } from "../nostr/events";
  import { displayName } from "../store/cache.svelte";
  import { summary } from "../store/publishSummary";
  import { toast } from "../store/toast.svelte";
  import { report } from "../store/writing";

  /** 通報（NIP-56、Android 版の ReportDialog）。投稿か人を、種類と理由（1,000 文字まで）を付けて通報する。 */
  let { target, close }: { target: { note?: Event; pubkey: string }; close: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let type = $state("spam");
  let reason = $state("");
  let sending = $state(false);
  let message = $state<string | null>(null);

  $effect(() => {
    dialog?.showModal();
  });

  async function send() {
    sending = true;
    message = "送っています…";
    try {
      const result = await report(target, type, reason);
      if (result.accepted > 0) {
        toast.show(`通報しました（${summary(result)}）`);
        close();
      } else message = summary(result);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      sending = false;
    }
  }
</script>

<dialog bind:this={dialog} onclose={close} aria-label="通報">
  <h3>{target.note ? "投稿を通報" : `${displayName(target.pubkey)} を通報`}</h3>
  <p class="muted">通報は公開されます（kind 1984）。リレーやほかのアプリが、この情報を使うことがあります。</p>
  <div class="types">
    {#each REPORT_TYPES as option (option.value)}
      <label><input type="radio" name="report-type" value={option.value} bind:group={type} />{option.label}</label>
    {/each}
  </div>
  <label class="reason"><span>理由（任意）</span><textarea rows="3" maxlength="1000" bind:value={reason}></textarea></label>
  {#if message}<p class="muted">{message}</p>{/if}
  <div class="buttons">
    <button type="button" onclick={() => dialog?.close()}>やめる</button>
    <button type="button" class="danger" disabled={sending} onclick={send}>通報する</button>
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
    margin: 0 0 8px;
  }
  .muted {
    margin: 4px 0;
    font-size: 0.85em;
    color: var(--muted);
  }
  .types {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin: 8px 0;
  }
  .types label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .reason {
    display: grid;
    gap: 4px;
    font-size: 0.85em;
    color: var(--muted);
  }
  textarea {
    font: inherit;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
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
  .buttons .danger {
    color: #fff;
    background: #c33;
    border: none;
  }
</style>
