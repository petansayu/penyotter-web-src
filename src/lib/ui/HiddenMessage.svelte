<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * 隠しメッセージ（セクシー餃子、Android 版の HiddenMessageView）。見える文字を虹色の点線で囲み、押すと下に開く。
   * dialog なら画面の上に開く（リアクションの一覧や通知のように、下に開く場所がないところ。Android 版の revealInDialog）。
   * children を渡すと、見える文字の代わりにそれ（カスタム絵文字の画像など）を囲む。
   */
  let { visible, message, dialog = false, children }: { visible: string; message: string; dialog?: boolean; children?: Snippet } = $props();
  let open = $state(false);
  let box = $state<HTMLDialogElement>();

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    if (dialog) box?.showModal();
    else open = !open;
  }
</script>

<button type="button" class="hidden-visible" class:open onclick={toggle} aria-expanded={open} title={open ? "隠しメッセージを閉じる" : "隠しメッセージを開く"} aria-label="{visible}（隠しメッセージを開く）">{#if children}{@render children()}{:else}{visible || "🥟"}{/if}</button>{#if open && !dialog}<span class="hidden-message" role="note">{message}</span>{/if}
{#if dialog}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <dialog bind:this={box} class="hidden-dialog" aria-label="隠しメッセージ" onclick={(event) => { event.stopPropagation(); if (event.target === box) box?.close(); }}>
    <p class="hidden-message">{message}</p>
    <button type="button" class="close" onclick={() => box?.close()}>閉じる</button>
  </dialog>
{/if}

<style>
  .hidden-visible {
    display: inline;
    padding: 0 2px;
    font: inherit;
    color: inherit;
    background: none;
    border: 2px dotted transparent;
    border-radius: 6px;
    border-image: linear-gradient(90deg, #ff6b6b, #ffb347, #ffe66d, #6bcb77, #4d96ff, #b06bff) 1;
    cursor: pointer;
  }
  .hidden-dialog {
    width: min(90vw, 360px);
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 14px;
  }
  .hidden-dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  .close {
    display: block;
    margin-left: auto;
    padding: 4px 14px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: none;
    cursor: pointer;
  }
  .hidden-message {
    display: block;
    margin: 4px 0;
    padding: 6px 10px;
    border-left: 3px solid var(--primary);
    border-radius: 4px;
    background: var(--surface-low);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
