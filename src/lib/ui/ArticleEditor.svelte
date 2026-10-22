<script lang="ts">
  import { onMount } from "svelte";
  import { articleDraftIdentifier, articleFields, buildArticle, emptyArticle, newArticleIdentifier, type ArticleFields } from "../domain/drafts";
  import { latest, type Event } from "../nostr/events";
  import { eventsOf, pool, publish } from "../nostr/pool";
  import { relaySet } from "../nostr/relayUrl";
  import { threadHref } from "../router.svelte";
  import { keepNotes } from "../store/cache.svelte";
  import { summary } from "../store/publishSummary";
  import { saveRemoteDraft } from "../store/remoteDrafts";
  import { uploadFile } from "../store/upload";
  import { viewer } from "../store/viewer.svelte";

  /**
   * 記事を書く（NIP-23、Android 版の ArticleEditor、技術資料 6.11）。書いている内容はブラウザに自動で保存する
   * （localStorage `article-draft.<公開鍵>`）。下書きはリレーに暗号化して保存できる（NIP-37、識別子は article:<d>）。
   * identifier を渡すと、自分の記事のその版を読んで書き直す（published_at は最初の公開の時刻を残す）。
   */
  let { identifier = null }: { identifier?: string | null } = $props();

  const storageKey = $derived(viewer.pubkey ? `article-draft.${viewer.pubkey}` : null);
  let fields = $state<ArticleFields>(emptyArticle());
  let editing = $state(false);
  let preview = $state(false);
  let busy = $state(false);
  let uploading = $state(false);
  let message = $state<string | null>(null);
  let published = $state<Event | null>(null);
  let imagePicker = $state<HTMLInputElement>();
  let bodyPicker = $state<HTMLInputElement>();
  let bodyField = $state<HTMLTextAreaElement>();

  const previewNote = $derived.by((): Event | null => {
    try {
      return { ...buildArticle({ ...fields, identifier: fields.identifier || "preview" }, Math.floor(Date.now() / 1000)), id: "0".repeat(64), pubkey: viewer.pubkey ?? "0".repeat(64), sig: "" };
    } catch {
      return null;
    }
  });

  onMount(() => {
    if (identifier) {
      void loadOwn(identifier);
      return;
    }
    try {
      const saved = storageKey ? localStorage.getItem(storageKey) : null;
      if (saved) fields = { ...emptyArticle(), ...(JSON.parse(saved) as ArticleFields) };
    } catch {
      // 保存分が読めなければ新しく書く
    }
    if (!fields.identifier) fields.identifier = newArticleIdentifier(Math.floor(Date.now() / 1000));
  });

  async function loadOwn(d: string) {
    const me = viewer.pubkey;
    if (!me) return;
    message = "記事を読み込んでいます…";
    const fetched = await pool.fetch(relaySet([...viewer.writeRelays, ...viewer.readRelays]), [{ kinds: [30023], authors: [me], "#d": [d], limit: 5 }]);
    const note = latest(eventsOf(fetched).filter((e) => e.pubkey === me));
    if (!note) {
      message = "記事が見つかりませんでした";
      return;
    }
    fields = articleFields(note);
    editing = true;
    message = null;
  }

  /** 入力のたびにブラウザへ保存する（書き直しのときは保存しない）。 */
  function remember() {
    if (editing || !storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(fields));
    } catch {
      // 保存できなくても書ける
    }
  }

  async function attach(file: File | undefined, target: "image" | "body") {
    if (!file) return;
    uploading = true;
    message = "画像を送っています…";
    try {
      const { url } = await uploadFile(file);
      if (target === "image") fields.image = url;
      else {
        const at = bodyField?.selectionStart ?? fields.body.length;
        fields.body = `${fields.body.slice(0, at)}![](${url})${fields.body.slice(at)}`;
      }
      remember();
      message = null;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      uploading = false;
    }
  }

  async function saveDraft() {
    busy = true;
    message = "下書きを保存しています…";
    try {
      const template = buildArticle(fields, Math.floor(Date.now() / 1000), true);
      const result = await saveRemoteDraft(articleDraftIdentifier(fields), template);
      message = result.accepted > 0 ? `下書きをリレーに保存しました（${summary(result)}）` : summary(result);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function publishArticle() {
    busy = true;
    message = "署名しています…";
    try {
      const signer = await viewer.getSigner();
      const event = await signer.sign(buildArticle(fields, Math.floor(Date.now() / 1000)));
      message = "送っています…";
      const result = await publish(viewer.writeRelays, event);
      message = summary(result);
      if (result.accepted > 0) {
        keepNotes([event]);
        published = event;
        if (!editing && storageKey) localStorage.removeItem(storageKey);
      }
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function startOver() {
    fields = { ...emptyArticle(), identifier: newArticleIdentifier(Math.floor(Date.now() / 1000)) };
    editing = false;
    published = null;
    if (storageKey) localStorage.removeItem(storageKey);
  }
</script>

<section class="editor">
  <h2>{editing ? "記事を編集" : "記事を書く"}</h2>
  {#if !viewer.canSign}
    <p class="muted">署名できるアカウントでログインしてください。</p>
  {:else}
    {#if editing}<p class="muted">公開済みの記事を編集しています。公開すると、同じ記事の新しい版になります。</p>{/if}
    <label><span>題名</span><input type="text" maxlength="300" bind:value={fields.title} oninput={remember} disabled={busy} /></label>
    <label><span>概要（任意）</span><textarea rows="2" maxlength="600" bind:value={fields.summary} oninput={remember} disabled={busy}></textarea></label>
    <label>
      <span>見出し画像の URL（任意、https）</span>
      <span class="row">
        <input type="url" bind:value={fields.image} oninput={remember} disabled={busy} />
        <button type="button" class="outline" disabled={uploading || busy} onclick={() => imagePicker?.click()}>選ぶ</button>
      </span>
    </label>
    <label><span>ハッシュタグ（空白区切り・任意）</span><input type="text" bind:value={fields.hashtags} oninput={remember} disabled={busy} /></label>
    <div class="modes" role="tablist">
      <button type="button" role="tab" class:active={!preview} aria-selected={!preview} onclick={() => (preview = false)}>書く</button>
      <button type="button" role="tab" class:active={preview} aria-selected={preview} onclick={() => (preview = true)}>プレビュー</button>
      {#if !preview}<button type="button" class="outline insert" disabled={uploading || busy} onclick={() => bodyPicker?.click()}>画像を挿入</button>{/if}
    </div>
    {#if preview}
      <div class="preview">
        {#if previewNote}
          {#await import("./ArticleView.svelte") then { default: ArticleView }}<ArticleView note={previewNote} />{/await}
        {:else}<p class="muted">題名と本文を入れると、プレビューを出します。</p>{/if}
      </div>
    {:else}
      <label><span>本文（Markdown）</span><textarea class="body" rows="16" bind:this={bodyField} bind:value={fields.body} oninput={remember} disabled={busy}></textarea></label>
    {/if}
    <input bind:this={imagePicker} type="file" accept="image/*" hidden onchange={(e) => { void attach(e.currentTarget.files?.[0], "image"); e.currentTarget.value = ""; }} />
    <input bind:this={bodyPicker} type="file" accept="image/*" hidden onchange={(e) => { void attach(e.currentTarget.files?.[0], "body"); e.currentTarget.value = ""; }} />
    {#if message}<p class="muted" role="status">{message}</p>{/if}
    {#if published}<p><a href={threadHref(published.id, published.pubkey)}>公開した記事を開く</a></p>{/if}
    <div class="buttons">
      <button type="button" class="filled" disabled={busy || uploading} onclick={publishArticle}>{editing ? "更新を公開" : "公開"}</button>
      <button type="button" class="outline" disabled={busy || uploading} onclick={saveDraft}>下書きをリレーに保存</button>
    </div>
    <p class="muted small">書いている内容は、このブラウザに自動で保存されます。リレーに保存した下書きは暗号化され、あなただけが読めます（NIP-37）。</p>
    <button type="button" class="reset" onclick={startOver}>書きかけを消して新しく書く</button>
  {/if}
</section>

<style>
  .editor {
    display: grid;
    gap: 10px;
    padding: 12px 16px 24px;
  }
  h2 {
    margin: 4px 0;
    font-size: 1.2rem;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 0.85em;
    color: var(--muted);
  }
  input,
  textarea {
    font: inherit;
    font-size: 1.1em;
    padding: 8px 10px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .body {
    min-height: 300px;
    resize: vertical;
    font-family: ui-monospace, monospace;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row input {
    flex: 1;
    min-width: 0;
  }
  .modes {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .modes [role="tab"] {
    padding: 4px 14px;
    font: inherit;
    color: var(--muted);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  .modes [role="tab"].active {
    color: var(--text);
    background: var(--secondary-container);
  }
  .insert {
    margin-left: auto;
  }
  .preview {
    border: 1px solid var(--outline-variant);
    border-radius: 10px;
    min-height: 200px;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  button.filled,
  button.outline {
    padding: 6px 16px;
    font: inherit;
    border-radius: 999px;
    cursor: pointer;
  }
  .filled {
    font-weight: 600;
    color: var(--on-primary);
    background: var(--primary);
    border: none;
  }
  .outline {
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .small {
    font-size: 0.8em;
  }
  .reset {
    justify-self: start;
    padding: 4px 0;
    font: inherit;
    font-size: 0.85em;
    color: #c33;
    background: none;
    border: none;
    cursor: pointer;
  }
  a {
    color: var(--primary);
  }
</style>
