<script lang="ts">
  import type { CustomEmoji } from "../domain/emojis";
  import { MAX_HIDDEN_BYTES, withHiddenReaction } from "../domain/hiddenMessages";
  import { emojis } from "../store/emojis.svelte";
  import UnicodeEmojiPicker from "./UnicodeEmojiPicker.svelte";
  import { viewer } from "../store/viewer.svelte";
  let editing = $state(false);

  /**
   * 絵文字のパレット（Android 版の ReactionDialog と投稿欄の絵文字）。「標準」はすべての Unicode 絵文字、「カスタム」は
   * 自分のカスタム絵文字（NIP-30）。選んだら pick を呼ぶ。placement は開く向き（投稿欄では上に開く）。
   */
  let { pick: chosen, close, placement = "below", title = "リアクション", hiddenInput = false }: {
    pick: (content: string, emoji?: CustomEmoji) => void;
    close: () => void;
    placement?: "below" | "above";
    title?: string;
    /** リアクションのとき、押した絵文字の後ろに隠しメッセージ（セクシー餃子）を付ける入力欄を出す（Android 版の ReactionDialog）。 */
    hiddenInput?: boolean;
  } = $props();

  let secret = $state("");
  const secretBytes = $derived(new TextEncoder().encode(secret).length);
  function pick(content: string, emoji?: CustomEmoji) {
    if (secret && secretBytes > MAX_HIDDEN_BYTES) return;
    chosen(secret ? withHiddenReaction(content, secret) : content, emoji);
  }

  let tab = $state<"standard" | "custom">("standard");
  let query = $state("");
  const custom = $derived(emojis.custom.filter((e) => !query || e.shortcode.toLowerCase().includes(query.toLowerCase())).slice(0, 300));

  $effect(() => {
    void emojis.load();
  });

  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") close();
  }
</script>

<div class="picker {placement}" role="dialog" aria-label={title} tabindex="-1" onkeydown={keydown}>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" aria-selected={tab === "standard"} class:active={tab === "standard"} onclick={() => (tab = "standard")}>標準</button>
    <button type="button" role="tab" aria-selected={tab === "custom"} class:active={tab === "custom"} onclick={() => (tab = "custom")}>カスタム</button>
  </div>
  {#if hiddenInput}
    <label class="secret">
      <span>🥟</span>
      <input type="text" bind:value={secret} placeholder="隠しメッセージ（任意）" aria-label="リアクションに付ける隠しメッセージ" />
      {#if secret}<small class:over={secretBytes > MAX_HIDDEN_BYTES}>{secretBytes}/{MAX_HIDDEN_BYTES}</small>{/if}
    </label>
  {/if}
  {#if tab === "standard"}
    <UnicodeEmojiPicker pick={(emoji) => pick(emoji)} />
  {:else}
    {#if emojis.custom.length > 12}<input class="search" bind:value={query} placeholder="名前で絞る" aria-label="カスタム絵文字を名前で絞る" />{/if}
    <div class="grid-wrap">
      {#if emojis.loading}
        <p class="note">読み込んでいます…</p>
      {:else if emojis.custom.length === 0}
        <p class="note">カスタム絵文字（NIP-30 の kind 10030）はありません</p>
      {:else}
        <div class="grid">
          {#each custom as item (item.shortcode + item.url)}
            <button type="button" title=":{item.shortcode}:" aria-label=":{item.shortcode}:" onclick={() => pick(`:${item.shortcode}:`, item)}>
              <img src={item.url} alt=":{item.shortcode}:" loading="lazy" referrerpolicy="no-referrer" />
            </button>
          {/each}
        </div>
      {/if}
    </div>
    {#if viewer.canSign}<button type="button" class="edit" onclick={() => (editing = true)}>絵文字リストを編集</button>{/if}
  {/if}
</div>
{#if editing}{#await import("./EmojiListEditor.svelte") then { default: EmojiListEditor }}<EmojiListEditor close={() => (editing = false)} />{/await}{/if}

<style>
  .secret {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 8px 0;
    font-size: 0.85em;
  }
  .secret input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 4px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .secret small {
    color: var(--muted);
  }
  .secret small.over {
    color: #c33;
  }
  .edit {
    display: block;
    margin: 4px 8px 6px auto;
    padding: 2px 8px;
    font: inherit;
    font-size: 0.8em;
    color: var(--primary);
    background: none;
    border: none;
    cursor: pointer;
  }
  .picker {
    position: absolute;
    right: 0;
    z-index: 25;
    display: grid;
    gap: 6px;
    width: min(340px, 92vw);
    padding: 8px;
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
  }
  /* 上に開くと、一覧の上の方の投稿ではヘッダーに隠れるので、投稿では下に開く */
  .picker.below {
    top: 100%;
  }
  .picker.above {
    bottom: 100%;
  }
  .tabs {
    display: flex;
    border: 1px solid var(--outline);
    border-radius: 999px;
    overflow: hidden;
  }
  .tabs button {
    flex: 1;
    font: inherit;
    font-size: 0.85em;
    padding: 5px 0;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .tabs button.active {
    font-weight: 600;
    background: var(--secondary-container);
  }
  .search {
    font: inherit;
    font-size: 0.9em;
    padding: 6px 10px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
  }
  .grid-wrap {
    height: 270px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
    gap: 2px;
  }
  .grid button {
    display: grid;
    place-items: center;
    height: 36px;
    background: none;
    border: none;
    border-radius: 8px;
    cursor: pointer;
  }
  .grid button:hover {
    background: var(--surface-low);
  }
  .grid img {
    max-width: 28px;
    max-height: 28px;
    object-fit: contain;
  }
  .note {
    margin: 4px 0;
    color: var(--muted);
    font-size: 0.8em;
  }
</style>
