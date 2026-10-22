<script lang="ts">
  import { onMount } from "svelte";
  import { setReferences } from "../domain/emojis";
  import { emojis } from "../store/emojis.svelte";
  import { lists } from "../store/lists.svelte";

  /**
   * 絵文字リスト（kind 10030）の編集（Android 版の EmojiListEditor）。直接の絵文字（shortcode と https の画像）と、
   * 絵文字セット（30030:公開鍵:識別子）を足す・外す。書き換えはフォロー一覧と同じ手順（技術資料 7 章）。
   */
  let { close }: { close: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let shortcode = $state("");
  let url = $state("");
  let address = $state("");
  let error = $state<string | null>(null);

  const direct = $derived((emojis.listEvent?.tags ?? []).filter((t) => t[0] === "emoji" && t[1] && t[2]));
  const sets = $derived(emojis.listEvent ? setReferences(emojis.listEvent) : []);
  const busy = $derived(lists.busy.has(10030));

  // 開いたときに 1 回だけ読み直す（読み込み中の状態を見ると、変わるたびに読み直してしまう）
  onMount(() => {
    dialog?.showModal();
    void emojis.reload();
  });

  async function addEmoji() {
    const code = shortcode.trim();
    const image = url.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(code) || !image.startsWith("https://") || image.length > 2048) {
      error = "shortcode（英数字・_・-）と HTTPS の画像 URL を確かめてください";
      return;
    }
    error = null;
    if (await lists.addEmoji(code, image)) {
      shortcode = "";
      url = "";
    }
  }

  async function addSet() {
    const value = address.trim();
    if (!/^30030:[0-9a-f]{64}:.+$/.test(value)) {
      error = "30030:公開鍵:識別子 の形で入れてください";
      return;
    }
    error = null;
    if (await lists.addEmojiSet(value)) address = "";
  }
</script>

<!-- 投稿カードの中で開くので、押した操作がカードに届かないようにする（届くと投稿の詳細が開く） -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} onclose={close} aria-label="絵文字リストを編集" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
  <h3>絵文字リストを編集</h3>
  <h4>直接の絵文字</h4>
  <div class="row">
    <input bind:value={shortcode} placeholder="shortcode（例: party_cat）" aria-label="shortcode" />
    <input bind:value={url} placeholder="https://…" aria-label="HTTPS の画像 URL" />
    <button type="button" disabled={busy || !shortcode.trim() || !url.trim()} onclick={addEmoji}>追加</button>
  </div>
  <ul>
    {#each direct as tag (tag[1] + tag[2])}
      <li><img src={tag[2]} alt=":{tag[1]}:" referrerpolicy="no-referrer" /><span>{tag[1]}</span><button type="button" disabled={busy} onclick={() => lists.removeEmoji(tag[1], tag[2])}>削除</button></li>
    {/each}
  </ul>
  <h4>絵文字セット</h4>
  <div class="row">
    <input bind:value={address} placeholder="30030:公開鍵:識別子" aria-label="絵文字セットのアドレス" />
    <button type="button" disabled={busy || !address.trim()} onclick={addSet}>追加</button>
  </div>
  <ul>
    {#each sets as set (set.author + set.identifier)}
      <li><span>{set.identifier}</span><small>{set.author.slice(0, 16)}…</small><button type="button" disabled={busy} onclick={() => lists.removeEmojiSet(`30030:${set.author}:${set.identifier}`)}>削除</button></li>
    {/each}
  </ul>
  {#if emojis.loading || busy}<p class="muted">{busy ? "絵文字リストを公開しています…" : "読み込んでいます…"}</p>{/if}
  {#if error}<p class="error">{error}</p>{/if}
  <div class="buttons"><button type="button" onclick={() => dialog?.close()}>閉じる</button></div>
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
  h3 {
    margin: 0 0 8px;
  }
  h4 {
    margin: 12px 0 6px;
    font-size: 0.9em;
    color: var(--muted);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  input {
    flex: 1;
    min-width: 120px;
    font: inherit;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  ul {
    margin: 6px 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid var(--outline-variant);
  }
  li span {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  li img {
    width: 24px;
    height: 24px;
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
    padding: 4px 12px;
    font: inherit;
    font-size: 0.9em;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
  }
</style>
