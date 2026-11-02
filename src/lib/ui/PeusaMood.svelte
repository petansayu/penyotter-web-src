<script lang="ts">
  import { peusaMood } from "../store/peusa.svelte";

  /** スーパーぺぇうさモードの、時間ごとのぺぇうさ（Android 版の PeusaMood）。小さく出し、押すと大きく出す。 */
  let now = $state(new Date());
  $effect(() => {
    const timer = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(timer);
  });
  const picture = $derived(peusaMood(now.getHours(), now.getMinutes()));
  let dialog = $state<HTMLDialogElement>();
</script>

{#if picture}
  <button type="button" class="mood" onclick={() => dialog?.showModal()} aria-label="ぺぇうさを見る" data-testid="peusa-mood"><img src={picture} alt="" width="36" height="36" /></button>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <dialog bind:this={dialog} onclick={() => dialog?.close()} aria-label="ぺぇうさ"><img src={picture} alt="" width="300" height="300" /></dialog>
{/if}

<style>
  .mood {
    display: flex;
    margin-left: auto;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
  }
  dialog {
    padding: 8px;
    background: var(--container);
    border: none;
    border-radius: 24px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
</style>
