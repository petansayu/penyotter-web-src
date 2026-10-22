<script lang="ts">
  import { tick } from "svelte";
  import { nip19 } from "nostr-tools";
  import { insertAt } from "../domain/emojiData";
  import { DUMPLING, encodeHidden, MAX_HIDDEN_BYTES, mightHide, splitHidden } from "../domain/hiddenMessages";
  import { insertMention, mentionCandidates, mentionQuery, type MentionPerson, type MentionQuery } from "../domain/mentions";
  import { EXPIRATION_CHOICES, expirationLabel } from "../domain/publishing";
  import { eventsOf, pool } from "../nostr/pool";
  import { displayName, keepProfiles, profiles } from "../store/cache.svelte";
  import { searchRelays } from "../store/search.svelte";
  import EmojiPicker from "./EmojiPicker.svelte";
  import { composer } from "../store/composer.svelte";
  import { deck } from "../store/deck.svelte";
  import { viewer } from "../store/viewer.svelte";
  import { TEST_RELAY } from "../nostr/testMode";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import NoteCard from "./NoteCard.svelte";

  /**
   * 右下の鉛筆のボタンと投稿欄（Android 版の ComposerPanel。普通の投稿・返信・引用）。docked はカラム表示の左の
   * メニューの横に置く形（開くかどうかは Deck が決める。開いたままにするピンつき）。
   */
  let { docked = false }: { docked?: boolean } = $props();
  const label = $derived(composer.mode === "reply" ? "返信" : composer.mode === "quote" ? "引用" : "投稿");
  let field = $state<HTMLTextAreaElement>();
  let picker = $state<HTMLInputElement>();
  let emojiOpen = $state(false);
  let expiryOpen = $state(false);
  let hiddenOpen = $state(false);
  let draftsOpen = $state(false);
  let posterOpen = $state(false);
  let hiddenVisible = $state(DUMPLING);
  let hiddenMessage = $state("");
  const hiddenBytes = $derived(new TextEncoder().encode(hiddenMessage).length);

  /** 隠しメッセージを入れる（Android 版の HiddenMessageDialog）。見える文字は空白だけにはできない。 */
  async function insertHidden() {
    if (!hiddenVisible.trim() || !hiddenMessage || hiddenBytes > MAX_HIDDEN_BYTES) return;
    hiddenOpen = false;
    await insertEmoji(encodeHidden(hiddenVisible, hiddenMessage));
    hiddenMessage = "";
  }
  const hiddenCount = $derived(mightHide(composer.text) ? splitHidden(composer.text).filter((p) => p.type === "hidden").length : 0);

  // メンションの補完（技術資料 9.3）
  let query = $state<MentionQuery | null>(null);
  let chosen = $state(0);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const candidates = $derived.by((): MentionPerson[] => {
    if (!query) return [];
    const people = [...profiles].slice(-2000).map(([pubkey, { profile }]) => ({ pubkey, ...profile }));
    return mentionCandidates(query.text, people, new Set(viewer.follows));
  });

  function updateQuery() {
    const cursor = field?.selectionStart ?? 0;
    const next = field && field.selectionStart === field.selectionEnd ? mentionQuery(composer.text, cursor) : null;
    if (next?.text !== query?.text || next?.start !== query?.start) chosen = 0;
    query = next;
    clearTimeout(searchTimer);
    // 候補が 3 件未満で 2 文字以上なら、検索リレーにも問い合わせる
    if (next && next.text.length >= 2) {
      const text = next.text;
      searchTimer = setTimeout(() => {
        if (query?.text !== text || candidates.length >= 3) return;
        const relays = searchRelays(viewer.pubkey);
        if (relays.length === 0) return;
        void pool.fetch(relays, [{ kinds: [0], search: text, limit: 20 }]).then((fetched) => {
          const events = eventsOf(fetched);
          // 見つけた人はプロフィールの保存分に入り、候補に出る
          keepProfiles(events);
        });
      }, 400);
    }
  }

  async function chooseMention(person: MentionPerson) {
    if (!query) return;
    const result = insertMention(composer.text, query, person.pubkey);
    if (result.text.length > 20000) {
      composer.message = "本文の上限（20000文字）を超えるため入れられません";
      return;
    }
    composer.text = result.text;
    composer.saveDraft();
    query = null;
    await tick();
    field?.focus();
    field?.setSelectionRange(result.cursor, result.cursor);
  }

  /** 本文でメンションしている人（入力欄では nostr:npub1… のまま見えるので、名前を下に出す）。 */
  const mentioned = $derived.by(() => {
    const keys: string[] = [];
    for (const match of composer.text.matchAll(/nostr:((?:npub|nprofile)1[023456789acdefghjklmnpqrstuvwxyz]+)/gi)) {
      try {
        const decoded = nip19.decode(match[1].toLowerCase());
        const pubkey = decoded.type === "npub" ? decoded.data : decoded.type === "nprofile" ? decoded.data.pubkey : null;
        if (pubkey && !keys.includes(pubkey)) keys.push(pubkey);
      } catch {
        // 打ちかけのものは出さない
      }
    }
    return keys;
  });

  /** 絵文字をカーソルの位置に入れる（Android 版の EmojiPalette.insert）。カスタム絵文字は :名前: で入れる。 */
  async function insertEmoji(content: string, emoji?: { shortcode: string; url: string }) {
    const text = emoji ? `:${emoji.shortcode}:` : content;
    const start = field?.selectionStart ?? composer.text.length;
    const end = field?.selectionEnd ?? start;
    const result = insertAt(composer.text, start, end, text);
    if (!result) {
      composer.message = "本文の上限（20000文字）を超えるため入れられません";
      return;
    }
    if (emoji) composer.rememberEmoji(emoji);
    composer.text = result.text;
    composer.saveDraft();
    await tick();
    field?.focus();
    field?.setSelectionRange(result.cursor, result.cursor);
  }

  function keepFocus(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (document.activeElement === field && target.closest("button") && !target.closest("input, textarea, label")) event.preventDefault();
  }

  function paste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
    if (files.length === 0) return;
    event.preventDefault();
    void composer.attach(files);
  }

  function drop(event: DragEvent) {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    event.preventDefault();
    void composer.attach(files);
  }

  $effect(() => {
    if (composer.open) field?.focus();
  });

  function keydown(event: KeyboardEvent) {
    if (query && candidates.length > 0 && !event.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        chosen = (chosen + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length;
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        void chooseMention(candidates[chosen]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        query = null;
        return;
      }
    }
    // Ctrl+Enter（Mac は ⌘+Enter）で送る
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void composer.send();
    }
    if (event.key === "Escape") composer.hide();
  }
</script>

{#if composer.open || docked}
  <!-- ボタンを押しても本文から入力のカーソルを外さない。外れるとスマホではキーボードが閉じて投稿欄が動き、
       押した場所がずれて、送るボタンを 2 回押さないと送れなかった -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="panel" class:docked role={docked ? "region" : "dialog"} aria-label="投稿欄" onmousedown={keepFocus}>
    {#if TEST_RELAY}<p class="test">テストモード: 手元のテスト用リレー（{TEST_RELAY}）にだけ送ります</p>{/if}
    {#if composer.target}
      <div class="target-head">
        <span>{composer.mode === "reply" ? "返信先" : "引用元"}</span>
        <button type="button" class="icon" onclick={() => composer.show("post")} aria-label="{label}をやめて、普通の投稿にする" title="{label}をやめる"><Icon name="close" size={18} /></button>
      </div>
      <div class="target">
        <NoteCard note={composer.target} nested />
      </div>
    {/if}
    <div class="row">
      {#if viewer.pubkey}
        {#if viewer.signableAccounts.length > 1}
          <span class="poster-anchor">
            <button type="button" class="poster" onclick={() => (posterOpen = !posterOpen)} aria-expanded={posterOpen} aria-label="投稿するアカウントを選ぶ（今は {displayName(composer.poster ?? viewer.pubkey)}）" title="投稿するアカウントを選ぶ"><Avatar pubkey={composer.poster ?? viewer.pubkey} size={36} /></button>
            {#if posterOpen}
              <span class="menu poster-menu" role="menu">
                {#each viewer.signableAccounts as account (account.pubkey)}
                  <button type="button" role="menuitem" class:on={(composer.poster ?? viewer.pubkey) === account.pubkey} onclick={() => { composer.setPoster(account.pubkey); posterOpen = false; }}><Avatar pubkey={account.pubkey} size={22} />{displayName(account.pubkey)}</button>
                {/each}
              </span>
            {/if}
          </span>
        {:else}<Avatar pubkey={viewer.pubkey} size={36} />{/if}
      {/if}
      <textarea
        bind:this={field}
        bind:value={composer.text}
        oninput={() => { composer.saveDraft(); updateQuery(); }}
        onkeyup={(event) => { if (event.key.startsWith("Arrow") && !(query && candidates.length > 0 && (event.key === "ArrowUp" || event.key === "ArrowDown"))) updateQuery(); }}
        onclick={updateQuery}
        onblur={() => setTimeout(() => (query = null), 150)}
        onkeydown={keydown}
        onpaste={paste}
        ondrop={drop}
        ondragover={(event) => event.dataTransfer?.types.includes("Files") && event.preventDefault()}
        rows={docked ? 8 : 5}
        placeholder={composer.mode === "reply" ? "返信を書く" : composer.mode === "quote" ? "引用して書く" : "いまどうしてる？"}
        aria-label="本文"
      ></textarea>
      <button type="button" class="send" onclick={() => composer.send()} disabled={!composer.canSend} aria-label={composer.unsent ? `同じ${label}を再送` : `${label}する`} title={composer.unsent ? "同じ内容を再送" : `${label}する`}>
        <Icon name="send" size={20} />
      </button>
    </div>
    {#if query && candidates.length > 0}
      <ul class="mentions" role="listbox" aria-label="メンションの候補">
        {#each candidates as person, i (person.pubkey)}
          <li role="option" aria-selected={i === chosen}>
            <button type="button" class:chosen={i === chosen} onmousedown={(event) => event.preventDefault()} onclick={() => void chooseMention(person)}>
              <Avatar pubkey={person.pubkey} size={24} />
              <span class="who"><strong>{displayName(person.pubkey)}</strong>{#if person.name && person.name !== person.displayName}<small>@{person.name}</small>{/if}</span>
              {#if viewer.follows.includes(person.pubkey)}<small class="following">フォロー中</small>{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if mentioned.length > 0}
      <p class="note">メンション: {mentioned.map((pubkey) => `@${displayName(pubkey)}`).join("、")}</p>
    {/if}
    {#if hiddenCount > 0}<p class="note">{DUMPLING} 隠しメッセージが{hiddenCount}件入っています（入力欄では見えません）</p>{/if}
    {#if composer.expiresAfter}
      <p class="note">この投稿は{expirationLabel(composer.expiresAfter)}で消えるよう依頼します（対応していないリレーやアプリには残ることがあります）</p>
    {/if}
    {#if composer.contentWarning !== null}
      <label class="warning">
        <span>内容の注意書き</span>
        <input type="text" value={composer.contentWarning} maxlength="200" oninput={(event) => composer.setContentWarning(event.currentTarget.value)} />
      </label>
    {/if}
    {#if hiddenOpen}
      <div class="hidden-form" role="group" aria-label="隠しメッセージ">
        <p>見える文字の後ろに、見えないメッセージを隠します（Amethyst などで読めます）。</p>
        <label><span>見える文字</span><input type="text" bind:value={hiddenVisible} /></label>
        <label><span>隠すメッセージ</span><textarea rows="2" bind:value={hiddenMessage}></textarea></label>
        <div class="hidden-actions">
          <small class:over={hiddenBytes > MAX_HIDDEN_BYTES}>{hiddenBytes} / {MAX_HIDDEN_BYTES} バイト</small>
          <button type="button" class="text" onclick={() => (hiddenOpen = false)}>やめる</button>
          <button type="button" class="text" disabled={!hiddenVisible.trim() || !hiddenMessage || hiddenBytes > MAX_HIDDEN_BYTES} onclick={() => void insertHidden()}>入れる</button>
        </div>
      </div>
    {/if}
    {#if draftsOpen}
      <div class="drafts" role="group" aria-label="リレーの下書き">
        <div class="drafts-head">
          <strong>リレーの下書き（NIP-37）</strong>
          <button type="button" class="text" disabled={composer.remoteBusy || !composer.text.trim()} onclick={() => void composer.saveToRelays()}>今の内容を保存</button>
        </div>
        <p class="hint">暗号化して保存し、あなただけが読めます。90 日たつと消えます。</p>
        {#if composer.remoteMessage}<p class="hint">{composer.remoteMessage}</p>{/if}
        {#each composer.remoteDrafts ?? [] as draft (draft.identifier)}
          <div class="draft" class:current={composer.remote?.identifier === draft.identifier}>
            <button type="button" class="draft-open" onclick={() => { draftsOpen = false; void composer.openDraft(draft); }}>
              <span>{draft.content.slice(0, 80) || "（本文なし）"}</span>
              <small>{draft.kind === 1111 ? "コメント・" : draft.tags.some((t) => t[0] === "e") ? "返信・" : ""}{new Date(draft.savedAt * 1000).toLocaleString("ja-JP")}</small>
            </button>
            <button type="button" class="icon" disabled={composer.remoteBusy} onclick={() => void composer.removeDraft(draft)} aria-label="この下書きを消す" title="消す"><Icon name="delete" size={16} /></button>
          </div>
        {/each}
      </div>
    {/if}
    {#if composer.attachments.length > 0 || composer.uploading > 0}
      <div class="attachments">
        {#each composer.attachments as attachment, i (attachment.url + i)}
          <span class="thumb">
            {#if attachment.type.startsWith("video/")}<video src={attachment.url} muted preload="metadata"></video>{:else}<img src={attachment.url} alt="" referrerpolicy="no-referrer" />{/if}
            <button type="button" onclick={() => composer.detach(i)} aria-label="外す" title="外す"><Icon name="close" size={14} /></button>
          </span>
        {/each}
        {#each Array.from({ length: composer.uploading }) as _, i (i)}<span class="thumb loading">送っています…</span>{/each}
      </div>
    {/if}
    {#if composer.mode === "post" && composer.attachments.length > 0}
      <div class="kinds" role="radiogroup" aria-label="投稿形式">
        <span>投稿形式</span>
        <button type="button" role="radio" aria-checked={composer.mediaKind === null} class:on={composer.mediaKind === null} onclick={() => composer.setMediaKind(null)}>通常投稿</button>
        {#if composer.attachments.some((a) => a.type.startsWith("image/"))}<button type="button" role="radio" aria-checked={composer.mediaKind === 20} class:on={composer.mediaKind === 20} onclick={() => composer.setMediaKind(20)}>画像</button>{/if}
        {#if composer.attachments.some((a) => a.type.startsWith("video/"))}
          <button type="button" role="radio" aria-checked={composer.mediaKind === 21} class:on={composer.mediaKind === 21} onclick={() => composer.setMediaKind(21)}>動画</button>
          <button type="button" role="radio" aria-checked={composer.mediaKind === 22} class:on={composer.mediaKind === 22} onclick={() => composer.setMediaKind(22)}>短い動画</button>
        {/if}
      </div>
    {/if}
    {#if composer.message}<p class="message" role="status">{composer.message}</p>{/if}
    <div class="actions">
      <input bind:this={picker} type="file" accept="image/*,video/*" multiple hidden onchange={(event) => { const files = event.currentTarget.files; if (files) void composer.attach(files); event.currentTarget.value = ""; }} />
      <span class="emoji-anchor">
        <button type="button" class="icon attach-emoji" class:active={emojiOpen} onclick={() => (emojiOpen = !emojiOpen)} aria-label="絵文字を入れる" aria-expanded={emojiOpen} title="絵文字を入れる"><Icon name="insertEmoticon" size={20} /></button>
        {#if emojiOpen}<EmojiPicker placement="above" title="絵文字を入れる" close={() => (emojiOpen = false)} pick={(content, emoji) => void insertEmoji(content, emoji)} />{/if}
      </span>
      <button type="button" class="icon tool" class:warned={composer.contentWarning !== null} onclick={() => composer.setContentWarning(composer.contentWarning === null ? "センシティブな内容" : null)} aria-pressed={composer.contentWarning !== null} aria-label="センシティブな内容として投稿する" title="センシティブな内容として投稿する（注意書き）"><Icon name={composer.contentWarning !== null ? "visibilityOff" : "visibility"} size={20} /></button>
      <span class="menu-anchor">
        <button type="button" class="icon tool" class:on={!!composer.expiresAfter} onclick={() => (expiryOpen = !expiryOpen)} aria-expanded={expiryOpen} aria-label={composer.expiresAfter ? `${expirationLabel(composer.expiresAfter)}で消える投稿（変更する）` : "消える投稿にする"} title="消える投稿"><Icon name="timer" size={20} /></button>
        {#if expiryOpen}
          <span class="menu" role="menu">
            <button type="button" role="menuitem" onclick={() => { composer.setExpiration(null); expiryOpen = false; }}>消えない（ふつうの投稿）</button>
            {#each EXPIRATION_CHOICES as choice (choice.seconds)}
              <button type="button" role="menuitem" class:on={composer.expiresAfter === choice.seconds} onclick={() => { composer.setExpiration(choice.seconds); expiryOpen = false; }}>{choice.label}で消える</button>
            {/each}
          </span>
        {/if}
      </span>
      {#if viewer.canSign}<button type="button" class="icon tool" class:on={draftsOpen} onclick={() => { draftsOpen = !draftsOpen; if (draftsOpen && composer.remoteDrafts === null) void composer.loadDrafts(); }} aria-expanded={draftsOpen} aria-label="下書き一覧" title="リレーの下書き"><Icon name="listAlt" size={20} /></button>{/if}
      <button type="button" class="icon tool dumpling" class:on={hiddenOpen} onclick={() => (hiddenOpen = !hiddenOpen)} aria-label="隠しメッセージを入れる" title="隠しメッセージを入れる">{DUMPLING}</button>
      <button type="button" class="icon attach" onclick={() => picker?.click()} disabled={composer.attachments.length + composer.uploading >= 4} aria-label="画像・動画を付ける" title="画像・動画を付ける（貼り付け・ドラッグでも）"><Icon name="addPhoto" size={20} /></button>
      <span class="count" class:over={composer.remaining < 0}>{composer.remaining.toLocaleString("en-US")}</span>
      {#if docked}
        <button type="button" class="icon pin" class:active={deck.pinComposer} onclick={() => deck.setPinComposer(!deck.pinComposer)} aria-pressed={deck.pinComposer} aria-label="開いたままにする" title="開いたままにする"><Icon name="pushPin" size={18} /></button>
      {/if}
      <button type="button" class="icon tool" onclick={() => { composer.hide(); if (docked) deck.setPinComposer(false); }} aria-label="投稿欄をたたむ" title="投稿欄をたたむ"><Icon name="expandMore" size={22} /></button>
    </div>
  </div>
{:else}
  <button type="button" class="fab" onclick={() => composer.show()} aria-label="投稿する" title="投稿する"><Icon name="edit" /></button>
{/if}

<style>
  .fab {
    position: fixed;
    right: max(16px, calc(50vw - var(--column) / 2 + 16px));
    bottom: calc(76px + env(safe-area-inset-bottom));
    z-index: 20;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border: none;
    border-radius: 16px;
    background: var(--primary);
    color: var(--on-primary);
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.2);
    cursor: pointer;
  }
  .panel {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(60px + env(safe-area-inset-bottom));
    z-index: 20;
    width: min(100%, var(--column));
    padding: 12px 16px;
    background: var(--container);
    border-top: 1px solid var(--outline-variant);
    box-shadow: 0 -4px 12px rgb(0 0 0 / 0.12);
  }
  /* 文字を打っている間は下のタブを隠すので、投稿欄をいちばん下（キーボードのすぐ上）に置く */
  :global(:root.typing) .panel:not(.docked) {
    bottom: env(safe-area-inset-bottom);
  }
  /* カラム表示では、左のメニューの横に置く */
  .panel.docked {
    position: static;
    transform: none;
    width: auto;
    padding: 12px;
    background: none;
    border: none;
    box-shadow: none;
  }
  .docked .row {
    gap: 8px;
  }
  .pin.active {
    color: var(--primary);
    background: var(--secondary-container);
  }
  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0 0 48px;
  }
  .docked .attachments {
    margin-left: 44px;
  }
  .thumb {
    position: relative;
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    overflow: hidden;
    border-radius: 8px;
    background: var(--surface-low);
    border: 1px solid var(--outline-variant);
    font-size: 0.7em;
    color: var(--muted);
    text-align: center;
  }
  .thumb img,
  .thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb button {
    position: absolute;
    top: 2px;
    right: 2px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    color: #fff;
    background: rgb(0 0 0 / 0.6);
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .attach {
    color: var(--primary);
  }
  .poster-anchor {
    position: relative;
  }
  .poster {
    padding: 0;
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .poster-menu {
    top: 40px;
    bottom: auto;
  }
  .poster-menu button {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin: 6px 0 0 48px;
    font-size: 0.8em;
    color: var(--muted);
  }
  .kinds button {
    padding: 2px 10px;
    font: inherit;
    color: var(--text);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 8px;
    cursor: pointer;
  }
  .kinds button.on {
    background: var(--secondary-container);
    border-color: var(--primary);
  }
  .drafts {
    margin: 8px 0 0 48px;
    padding: 8px 10px;
    background: var(--background);
    border: 1px solid var(--outline-variant);
    border-radius: 10px;
  }
  .drafts-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .hint {
    margin: 2px 0;
    font-size: 0.8em;
    color: var(--muted);
  }
  .draft {
    display: flex;
    align-items: center;
    gap: 4px;
    border-top: 1px solid var(--outline-variant);
  }
  .draft.current {
    background: var(--secondary-container);
  }
  .draft-open {
    display: grid;
    flex: 1;
    min-width: 0;
    padding: 6px 4px;
    font: inherit;
    text-align: left;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .draft-open span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .draft-open small {
    font-size: 0.75em;
    color: var(--muted);
  }
  .tool.warned {
    color: #d33;
  }
  .tool.on {
    color: var(--primary);
    background: var(--secondary-container);
  }
  .dumpling {
    font-size: 17px;
  }
  .menu-anchor {
    position: relative;
  }
  .menu {
    position: absolute;
    bottom: 36px;
    left: 0;
    z-index: 5;
    display: grid;
    min-width: 180px;
    padding: 4px 0;
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.2);
  }
  .menu button {
    padding: 8px 14px;
    text-align: left;
    color: var(--text);
    background: none;
    border: none;
  }
  .menu button.on,
  .menu button:hover {
    background: var(--secondary-container);
  }
  .mentions {
    margin: 4px 0 0 48px;
    padding: 4px 0;
    list-style: none;
    max-height: 240px;
    overflow-y: auto;
    background: var(--background);
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
  }
  .mentions button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    font: inherit;
    text-align: left;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .mentions button.chosen {
    background: var(--secondary-container);
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .who strong,
  .who small {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .who small,
  .following {
    font-size: 0.75em;
    color: var(--muted);
  }
  .following {
    margin-left: auto;
  }
  .note {
    margin: 6px 0 0 48px;
    font-size: 0.8em;
    color: var(--primary);
  }
  .warning,
  .hidden-form label {
    display: grid;
    gap: 2px;
    margin: 6px 0 0 48px;
    font-size: 0.8em;
    color: var(--muted);
  }
  .warning input,
  .hidden-form input,
  .hidden-form textarea {
    font: inherit;
    font-size: 1.15em;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .hidden-form {
    margin-top: 6px;
  }
  .hidden-form p {
    margin: 0 0 0 48px;
    font-size: 0.8em;
    color: var(--muted);
  }
  .hidden-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 48px;
  }
  .hidden-actions small {
    margin-right: auto;
    color: var(--muted);
  }
  .hidden-actions small.over {
    color: #d33;
  }
  .emoji-anchor {
    position: relative;
  }
  .emoji-anchor :global(.picker) {
    left: 0;
    right: auto;
  }
  .attach-emoji {
    color: var(--primary);
  }
  .attach-emoji.active {
    background: var(--secondary-container);
  }
  .attach:disabled {
    color: var(--outline);
    cursor: default;
  }
  .target-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--muted);
    font-size: 0.85em;
  }
  .target {
    max-height: 160px;
    overflow-y: auto;
    margin-bottom: 8px;
  }
  .target :global(article.nested) {
    margin-top: 4px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    color: var(--muted);
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .row {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  textarea {
    flex: 1;
    min-width: 0;
    font: inherit;
    line-height: 1.6;
    padding: 8px 10px;
    border: 1px solid var(--outline);
    border-radius: 10px;
    background: var(--background);
    color: var(--text);
    resize: vertical;
  }
  .test {
    margin: 0 0 8px;
    padding: 4px 8px;
    font-size: 0.8em;
    color: #8a5a00;
    background: #fff3cd;
    border-radius: 6px;
  }
  .message {
    margin: 8px 0 0 48px;
    font-size: 0.85em;
    color: var(--muted);
  }
  /* 道具の段（Android 版の投稿欄の下の段）。スマホの幅に収まるよう詰め、入りきらなければ折り返す */
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin-top: 6px;
  }
  .count {
    margin-left: auto;
    padding: 0 4px;
    font-size: 0.8em;
    color: var(--muted);
  }
  .count.over {
    color: #d33;
  }
  .actions button {
    font: inherit;
    cursor: pointer;
  }
  .text {
    color: var(--primary);
    background: none;
    border: none;
    padding: 8px 12px;
  }
  /* 送るボタンは本文の右に、アイコンだけ（Android 版と同じ） */
  .send {
    display: grid;
    flex: none;
    place-items: center;
    align-self: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--primary);
    color: var(--on-primary);
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
