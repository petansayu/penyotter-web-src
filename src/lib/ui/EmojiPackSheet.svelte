<script lang="ts">
  import { setReferences } from "../domain/emojis";
  import { displayName, requestProfiles } from "../store/cache.svelte";
  import { emojiPacks } from "../store/emojiPacks.svelte";
  import { emojis } from "../store/emojis.svelte";
  import { lists } from "../store/lists.svelte";
  import { viewer } from "../store/viewer.svelte";

  /**
   * 見かけたカスタム絵文字と、それが入っているパック（Android 版の EmojiPackSheet）。パックごと、または絵文字だけを
   * 自分の絵文字リスト（kind 10030）に足す。書き換えは絵文字リストの編集と同じ手順（技術資料 7 章）。
   */
  const PREVIEW = 40;
  const current = $derived(emojiPacks.current);
  const emoji = $derived(current?.emoji ?? null);
  const busy = $derived(lists.busy.has(10030));
  const ownSets = $derived(new Set(emojis.listEvent ? setReferences(emojis.listEvent).map((r) => `30030:${r.author}:${r.identifier}`) : []));
  const ownedEmoji = $derived(!!emoji && emojis.custom.some((e) => e.url === emoji.url));
  const owned = (address: string) => ownSets.has(address) || emojis.custom.some((e) => e.set === address);

  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (current && dialog && !dialog.open) dialog.showModal();
    if (!current && dialog?.open) dialog.close();
  });
  $effect(() => {
    if (current) requestProfiles(current.packs.map((p) => p.author));
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} onclose={() => emojiPacks.close()} aria-label="絵文字パック" data-testid="emoji-pack-sheet"
  onclick={(event) => { event.stopPropagation(); if (event.target === dialog) dialog?.close(); }} onkeydown={(event) => event.stopPropagation()}>
  {#if current}
    {#if emoji}
      <div class="head">
        <img class="big" src={emoji.url} alt=":{emoji.shortcode}:" referrerpolicy="no-referrer" />
        <div>
          <strong>:{emoji.shortcode}:</strong>
          <small>{ownedEmoji ? "この絵文字は追加済みです" : "カスタム絵文字"}</small>
        </div>
      </div>
      <button type="button" class="wide" disabled={!viewer.canSign || ownedEmoji || busy} onclick={() => lists.addEmoji(emoji.shortcode, emoji.url)}>
        {ownedEmoji ? "この絵文字は追加済み" : "この絵文字だけ追加"}
      </button>
      <hr />
    {/if}
    <h4>{emoji ? "入っているパック" : "絵文字パック"}</h4>
    {#if current.loading}<p class="muted">{current.message ?? "パックを探しています…"}</p>
    {:else if current.packs.length === 0}<p class="muted">{current.message ?? "パックは見つかりませんでした"}</p>
    {:else if current.similar}<p class="muted">同じ画像の絵文字が入っているパックは見つかりませんでした。名前が同じ絵文字が入っているパックです（画像が違うことがあります）。</p>{/if}
    {#each current.packs as pack (pack.address)}
      {@const has = owned(pack.address)}
      <section class="pack">
        <strong>{pack.title}</strong>
        <small>作った人: {displayName(pack.author)} ・ {pack.emojis.length}個</small>
        <div class="grid">
          {#each pack.emojis.slice(0, PREVIEW) as item (item.shortcode + item.url)}<img src={item.url} alt=":{item.shortcode}:" title=":{item.shortcode}:" loading="lazy" referrerpolicy="no-referrer" />{/each}
        </div>
        {#if pack.emojis.length > PREVIEW}<small>ほか {pack.emojis.length - PREVIEW}個</small>{/if}
        <button type="button" class="wide primary" disabled={!viewer.canSign || has || busy} onclick={() => lists.addEmojiSet(pack.address)}>
          {has ? "このパックは追加済み" : "このパックを追加"}
        </button>
      </section>
    {/each}
    {#if !viewer.canSign}<p class="error">このアカウントでは絵文字を追加できません（署名できないため）</p>{/if}
    {#if busy}<p class="muted">絵文字リストを公開しています…</p>{/if}
    <div class="buttons"><button type="button" onclick={() => dialog?.close()}>閉じる</button></div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(94vw, 460px);
    max-height: 85vh;
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 10px;
  }
  .head div {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .big {
    width: 64px;
    height: 64px;
    object-fit: contain;
  }
  h4 {
    margin: 4px 0 8px;
    font-size: 0.95em;
  }
  hr {
    margin: 12px 0;
    border: none;
    border-top: 1px solid var(--outline-variant);
  }
  .pack {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    margin-bottom: 10px;
    background: var(--background);
    border-radius: 10px;
    overflow-wrap: anywhere;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .grid img {
    width: 28px;
    height: 28px;
    object-fit: contain;
  }
  small,
  .muted {
    color: var(--muted);
    font-size: 0.8em;
  }
  .error {
    color: #c33;
    font-size: 0.85em;
  }
  button {
    padding: 6px 12px;
    font: inherit;
    font-size: 0.9em;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  button.primary {
    color: var(--on-primary, #fff);
    background: var(--primary);
    border-color: var(--primary);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .wide {
    width: 100%;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
  }
</style>
