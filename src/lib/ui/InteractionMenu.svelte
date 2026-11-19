<script lang="ts">
  import { PALETTE, reactionDisplay } from "../domain/emojis";
  import { profileHref } from "../router.svelte";
  import { actions } from "../store/actions.svelte";
  import { displayName } from "../store/cache.svelte";
  import { interactionMenu } from "../store/interactionMenu.svelte";
  import { settings } from "../store/settings.svelte";
  import { viewer } from "../store/viewer.svelte";
  import type { Event } from "../nostr/events";
  import EmojiPicker from "./EmojiPicker.svelte";
  import Icon from "./Icon.svelte";

  /**
   * リアクション・リポストのメニュー（Android 版の InteractionMenu）。投稿と同じように、それにリアクションしたり
   * リポストしたりする（NIP-25・NIP-18 はどのイベントにも認めている。リポストは kind 16 になる）。
   */

  /** 上の段に並べるリアクション: 1 タップのものと標準の絵文字で 6 つ（チャットのメニューと同じ）。 */
  const quickReactions = $derived.by(() => {
    const list: { content: string; emoji?: { shortcode: string; url: string } }[] = [{ content: settings.oneTap.content, emoji: settings.oneTap.emoji }];
    for (const item of [{ text: "+" }, ...PALETTE]) if (!list.some((c) => c.content === item.text)) list.push({ content: item.text });
    return list.slice(0, 6);
  });
  let paletteFor = $state<Event | null>(null);

  function close() {
    interactionMenu.event = null;
  }

  /** メニューを閉じてから、そのイベントで操作する。 */
  function act(run: (event: Event) => void) {
    const event = interactionMenu.event;
    close();
    if (event) run(event);
  }

  const shown = (event: Event) => {
    const display = reactionDisplay(event);
    return display.type === "like" ? { text: "♡" } : display.type === "image" ? { text: `:${display.shortcode}:`, url: display.url } : { text: display.text };
  };
</script>

{#if interactionMenu.event}
  {@const target = interactionMenu.event}
  {@const what = target.kind === 7 ? "リアクション" : "リポスト"}
  {@const reacted = actions.reactionTo(target.id)}
  {@const reposted = actions.repostOf(target.id)}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="sheet-back" onclick={close}>
    <div class="sheet" role="menu" tabindex="-1" aria-label="{what}の操作" data-testid="interaction-menu" onclick={(event) => event.stopPropagation()}>
      <p class="sheet-head">
        <span class="who">{displayName(target.pubkey)} の{what}</span>
        {#if target.kind === 7}{@const label = shown(target)}<span class="emoji">{#if label.url}<img src={label.url} alt={label.text} referrerpolicy="no-referrer" />{:else}{label.text}{/if}</span>{/if}
      </p>
      {#if viewer.canSign}
        <div class="quick" role="group" aria-label="リアクション">
          {#each quickReactions as choice (choice.content)}
            <button type="button" class:chosen={reacted?.content === choice.content} onclick={() => act((e) => void actions.react(e, choice.content, choice.emoji))} aria-label="{choice.content === '+' ? 'いいね' : choice.content}でリアクション">
              {#if choice.emoji}<img src={choice.emoji.url} alt=":{choice.emoji.shortcode}:" referrerpolicy="no-referrer" />{:else if choice.content === "+"}♡{:else}{choice.content}{/if}
            </button>
          {/each}
          <button type="button" onclick={() => act((e) => (paletteFor = e))} aria-label="絵文字を選んでリアクション"><Icon name="add" size={20} /></button>
        </div>
        {#if reacted}<button type="button" role="menuitem" onclick={() => act((e) => void actions.unreact(e))}>リアクションを取り消す</button>{/if}
        <button type="button" role="menuitem" onclick={() => act((e) => void actions.toggleRepost(e))}><Icon name="repeat" size={18} />{reposted ? "リポストを取り消す" : `この${what}をリポスト`}</button>
      {:else}
        <p class="note">署名できるアカウントでは、ここからリアクションやリポストができます</p>
      {/if}
      <a role="menuitem" href={profileHref(target.pubkey)} onclick={close}><Icon name="person" size={18} />{displayName(target.pubkey)} のプロフィール</a>
      <button type="button" class="cancel" onclick={close}>閉じる</button>
    </div>
  </div>
{/if}

{#if paletteFor}
  {@const target = paletteFor}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="sheet-back" onclick={() => (paletteFor = null)}>
    <div class="palette" onclick={(event) => event.stopPropagation()}>
      <EmojiPicker hiddenInput close={() => (paletteFor = null)} pick={(content, emoji) => { paletteFor = null; void actions.react(target, content, emoji); }} />
    </div>
  </div>
{/if}

<style>
  .sheet-back {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgb(0 0 0 / 0.35);
  }
  .sheet {
    display: grid;
    width: min(100%, 480px);
    padding: 8px 0 calc(8px + env(safe-area-inset-bottom));
    background: var(--container);
    border-radius: 16px 16px 0 0;
  }
  .sheet-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 20px 8px;
    color: var(--muted);
    font-size: 0.85em;
  }
  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .emoji {
    font-size: 1.3em;
    color: var(--text);
  }
  .emoji img,
  .quick img {
    height: 1.2em;
  }
  .quick {
    display: flex;
    gap: 4px;
    padding: 4px 12px 8px;
    overflow-x: auto;
  }
  .quick button {
    display: grid;
    flex: none;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    font-size: 20px;
    color: var(--text);
    background: var(--surface-low);
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .quick button.chosen {
    background: var(--secondary-container);
  }
  .sheet > button,
  .sheet > a {
    display: flex;
    align-items: center;
    gap: 10px;
    font: inherit;
    text-align: left;
    padding: 12px 20px;
    color: var(--text);
    text-decoration: none;
    background: none;
    border: none;
    cursor: pointer;
  }
  .sheet > button:hover,
  .sheet > a:hover {
    background: var(--surface-low);
  }
  .sheet .cancel {
    justify-content: center;
    color: var(--muted);
  }
  .note {
    margin: 4px 20px 8px;
    color: var(--muted);
    font-size: 0.85em;
  }
  .palette {
    position: absolute;
    left: 50%;
    bottom: 0;
    width: min(100%, 420px);
    transform: translateX(-50%);
  }
  .palette :global(.picker) {
    position: static;
    width: 100%;
  }
</style>
