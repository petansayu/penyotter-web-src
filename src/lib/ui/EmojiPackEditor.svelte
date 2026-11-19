<script lang="ts">
  import { onMount } from "svelte";
  import { MAX_TITLE, PACK_KIND, packEmojis, packIdentifier, packTitle, suggestedShortcode, validEmoji } from "../domain/emojiPackEditing";
  import { setReferences } from "../domain/emojis";
  import type { Event } from "../nostr/events";
  import { emojis } from "../store/emojis.svelte";
  import { lists } from "../store/lists.svelte";
  import { myEmojiPacks } from "../store/myEmojiPacks.svelte";
  import { uploadFile } from "../store/upload";
  import { viewer } from "../store/viewer.svelte";

  /**
   * 自分の絵文字パック（kind 30030。Android 版の EmojiPackEditor）。パックを作る（自分の絵文字リストに入れるか選ぶ）、
   * 画像を選んで絵文字を足す、消す、名前を変える、あとから絵文字リストに入れる。
   */
  let { close }: { close: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let newTitle = $state("");
  let addToList = $state(true);
  /** 開いているパックの識別子。 */
  let openId = $state<string | null>(null);
  let shortcode = $state("");
  let url = $state("");
  let rename = $state("");
  let uploading = $state(false);
  let error = $state<string | null>(null);
  let picker = $state<HTMLInputElement>();

  onMount(() => {
    dialog?.showModal();
    void myEmojiPacks.load();
  });

  const opened = $derived(myEmojiPacks.packs.find((p) => packIdentifier(p.tags) === openId) ?? null);
  const inList = $derived(new Set((emojis.listEvent ? setReferences(emojis.listEvent) : []).map((s) => `${s.author}:${s.identifier}`)));
  const busy = $derived(myEmojiPacks.busy || lists.busy.has(10030));

  async function create() {
    error = null;
    if (await myEmojiPacks.create(newTitle, addToList)) newTitle = "";
  }

  function open(pack: Event) {
    openId = packIdentifier(pack.tags);
    rename = packTitle(pack);
    shortcode = "";
    url = "";
    error = null;
  }

  /** 画像を選んで、設定の画像投稿先へアップロードし、名前の候補をファイル名から入れる。 */
  async function upload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    uploading = true;
    error = null;
    try {
      url = (await uploadFile(file)).url;
      if (!shortcode.trim()) shortcode = suggestedShortcode(file.name);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      uploading = false;
    }
  }

  async function addEmoji() {
    if (!openId) return;
    const code = shortcode.trim();
    const image = url.trim();
    if (!validEmoji(code, image)) {
      error = "名前（英数字・_・-）と HTTPS の画像 URL を確かめてください";
      return;
    }
    error = null;
    if (await myEmojiPacks.change(openId, { type: "add", shortcode: code, url: image })) {
      shortcode = "";
      url = "";
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} onclose={close} aria-label="自分の絵文字パック" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
  <input bind:this={picker} type="file" accept="image/*" hidden onchange={(event) => { void upload(event.currentTarget.files); event.currentTarget.value = ""; }} />
  {#if opened && openId}
    {@const id = openId}
    <h3><button type="button" class="back" onclick={() => (openId = null)} aria-label="パックの一覧に戻る">←</button>{packTitle(opened)}</h3>
    <h4>名前</h4>
    <div class="row">
      <input bind:value={rename} maxlength={MAX_TITLE} aria-label="パックの名前" />
      <button type="button" disabled={busy || !rename.trim() || rename.trim() === packTitle(opened)} onclick={() => myEmojiPacks.change(id, { type: "rename", title: rename })}>名前を変える</button>
    </div>
    {#if !inList.has(`${viewer.pubkey}:${id}`)}
      <button type="button" class="wide" disabled={busy} onclick={() => lists.addEmojiSet(`${PACK_KIND}:${viewer.pubkey}:${id}`)}>自分の絵文字リストに入れる</button>
    {/if}
    <h4>絵文字を足す</h4>
    <div class="row">
      <button type="button" disabled={busy || uploading} onclick={() => picker?.click()}>{uploading ? "アップロードしています…" : "画像を選ぶ"}</button>
      <input bind:value={shortcode} placeholder="名前（例: party_cat）" aria-label="絵文字の名前" />
    </div>
    <div class="row">
      <input bind:value={url} placeholder="https://…" aria-label="HTTPS の画像 URL" />
      <button type="button" disabled={busy || !shortcode.trim() || !url.trim()} onclick={addEmoji}>追加</button>
    </div>
    <ul>
      {#each packEmojis(opened) as emoji (emoji.shortcode + emoji.url)}
        <li><img src={emoji.url} alt=":{emoji.shortcode}:" referrerpolicy="no-referrer" /><span>{emoji.shortcode}</span><button type="button" disabled={busy} onclick={() => myEmojiPacks.change(id, { type: "remove", ...emoji })}>削除</button></li>
      {:else}
        <li class="muted">まだ絵文字がありません</li>
      {/each}
    </ul>
  {:else}
    <h3>自分の絵文字パック</h3>
    <h4>新しいパック</h4>
    <div class="row">
      <input bind:value={newTitle} maxlength={MAX_TITLE} placeholder="パックの名前" aria-label="新しいパックの名前" />
      <button type="button" disabled={busy || !newTitle.trim()} onclick={create}>作る</button>
    </div>
    <label class="check"><input type="checkbox" bind:checked={addToList} />自分の絵文字リストにも入れる</label>
    <ul>
      {#each myEmojiPacks.packs as pack (pack.id)}
        <li>
          <button type="button" class="pack" onclick={() => open(pack)}>
            <span>{packTitle(pack)}</span><small>{packEmojis(pack).length} 個{inList.has(`${viewer.pubkey}:${packIdentifier(pack.tags)}`) ? "・リストに入っています" : ""}</small>
          </button>
        </li>
      {:else}
        {#if !myEmojiPacks.loading}<li class="muted">まだパックがありません</li>{/if}
      {/each}
    </ul>
  {/if}
  {#if myEmojiPacks.loading || busy}<p class="muted">{busy ? "絵文字パックを公開しています…" : "読み込んでいます…"}</p>{/if}
  {#if myEmojiPacks.message}<p class="error">{myEmojiPacks.message}</p>{/if}
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
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    overflow-wrap: anywhere;
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
    margin-bottom: 6px;
  }
  .row input {
    flex: 1;
    min-width: 120px;
    font: inherit;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9em;
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
  li > span {
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
  .wide {
    margin: 4px 0;
  }
  .back {
    padding: 2px 10px;
  }
  .pack {
    display: flex;
    flex: 1;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    color: var(--text);
    text-align: left;
    border: none;
    border-radius: 8px;
  }
  .pack:hover {
    background: var(--surface-low);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
  }
</style>
