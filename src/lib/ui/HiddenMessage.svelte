<script lang="ts">
  /**
   * 隠しメッセージ（セクシー餃子、Android 版の HiddenMessageView）。見える文字を虹色の点線で囲み、押すと下に開く。
   */
  let { visible, message }: { visible: string; message: string } = $props();
  let open = $state(false);
</script>

<button type="button" class="hidden-visible" class:open onclick={() => (open = !open)} aria-expanded={open} title={open ? "隠しメッセージを閉じる" : "隠しメッセージを開く"}>{visible || "🥟"}</button>{#if open}<span class="hidden-message" role="note">{message}</span>{/if}

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
