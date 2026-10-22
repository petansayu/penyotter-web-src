<script lang="ts">
  import { tick, untrack } from "svelte";
  import { nip19 } from "nostr-tools";
  import { profileHref } from "../router.svelte";
  import { displayName } from "../store/cache.svelte";
  import { dms } from "../store/dm.svelte";
  import { summary } from "../store/publishSummary";
  import { settings } from "../store/settings.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Avatar from "./Avatar.svelte";
  import { clock } from "./clock.svelte";
  import Content from "./Content.svelte";
  import DmFileView from "./DmFileView.svelte";
  import Icon from "./Icon.svelte";
  import { useNavigate } from "./navigation";
  import { postTime } from "./time";

  /**
   * DM（Android 版の DirectMessagesPanel）。peer がなければ会話の一覧、あればその人との会話。送るのは NIP-17。
   * 見るだけのアカウントでは「DM を読めません」と出し、取得もしない。
   */
  let { peer = null }: { peer?: string | null } = $props();
  const navigate = useNavigate();

  let newPeer = $state("");
  let newError = $state<string | null>(null);
  let text = $state("");
  let sendMessage = $state<string | null>(null);
  let sending = $state(false);
  let bottom = $state<HTMLElement>();

  $effect(() => {
    if (viewer.ready) untrack(() => void dms.load());
  });

  const conversation = $derived(peer ? dms.conversations.find((c) => c.peer === peer) : undefined);
  const messages = $derived(conversation?.messages ?? []);

  // 開いている会話は読んだことにし、いちばん下を見せる（最後のメッセージが変わったときだけ）
  const lastId = $derived(messages.at(-1)?.id);
  $effect(() => {
    void lastId;
    const who = peer;
    if (!who) return;
    untrack(() => dms.markRead(who));
    void tick().then(() => bottom?.scrollIntoView({ block: "end" }));
  });

  function openNew() {
    newError = null;
    const raw = newPeer.trim().replace(/^nostr:/i, "");
    try {
      const decoded = nip19.decode(raw.toLowerCase());
      const pubkey = decoded.type === "npub" ? decoded.data : decoded.type === "nprofile" ? decoded.data.pubkey : null;
      if (!pubkey) throw new Error();
      newPeer = "";
      navigate(`#/messages/${nip19.npubEncode(pubkey)}`);
    } catch {
      newError = "npub を入れてください";
    }
  }

  /** 送り方。旧方式（NIP-04）は相手と時刻が公開される（Android 版の会話の画面と同じく選べる）。 */
  let legacy = $state(false);
  let filePicker = $state<HTMLInputElement>();

  async function sendFile(file: File | undefined) {
    if (!peer || !file) return;
    sending = true;
    sendMessage = "ファイルを暗号化して送っています…";
    try {
      const result = await dms.sendFile(peer, file);
      sendMessage = result.accepted > 0 ? null : summary(result);
    } catch (e) {
      sendMessage = e instanceof Error ? e.message : String(e);
    } finally {
      sending = false;
    }
  }

  async function send() {
    if (!peer || !text.trim()) return;
    sending = true;
    sendMessage = null;
    try {
      const result = legacy ? await dms.sendLegacy(peer, text) : await dms.send(peer, text);
      if (result.accepted > 0) text = "";
      else sendMessage = summary(result);
    } catch (e) {
      sendMessage = e instanceof Error ? e.message : String(e);
    } finally {
      sending = false;
    }
  }
</script>

{#if !viewer.canSign}
  <p class="notice">DMを読めません（見るだけのアカウントでは、DM を読み書きしません）。</p>
{:else if !peer}
  <section class="list">
    {#if dms.inbox && dms.inbox.length === 0}
      <p class="banner">DM 受信リレー（kind 10050）を公開していません。公開すると、NIP-17 の DM を受け取れます。<a href="#/settings/relays">設定「リレー」で公開する</a></p>
    {/if}
    <div class="new">
      <input bind:value={newPeer} placeholder="npub を入れて、新しい会話" aria-label="会話の相手の npub" spellcheck="false" onkeydown={(event) => event.key === "Enter" && openNew()} />
      <button type="button" class="outline" onclick={openNew}>開く</button>
    </div>
    {#if newError}<p class="error">{newError}</p>{/if}
    {#if dms.error}<p class="error">{dms.error}</p>{/if}
    {#if dms.loading && dms.conversations.length === 0}<p class="muted">読み込んでいます（署名役に復号を頼んでいます）…</p>{/if}
    {#if !dms.loading && dms.conversations.length === 0 && !dms.error}<p class="muted">DM はありません。</p>{/if}
  </section>
  <ul class="conversations">
    {#each dms.conversations as item (item.peer)}
      <li>
        <a href="#/messages/{nip19.npubEncode(item.peer)}" onclick={(event) => { event.preventDefault(); navigate(`#/messages/${nip19.npubEncode(item.peer)}`); }}>
          <Avatar pubkey={item.peer} size={40} />
          <span class="text">
            <strong>{displayName(item.peer)}</strong>
            <span>{item.last.pubkey === viewer.pubkey ? "あなた: " : ""}{item.last.content.replace(/\s+/g, " ").slice(0, 60)}</span>
          </span>
          <span class="when">{postTime(item.last.created_at, settings.timeDisplay, clock.now)}</span>
          {#if item.unread}<i class="dot" aria-label="未読"></i>{/if}
        </a>
      </li>
    {/each}
  </ul>
{:else}
  <section class="room">
    <header class="room-head">
      <a href={profileHref(peer)} class="who"><Avatar pubkey={peer} size={32} /><strong>{displayName(peer)}</strong></a>
    </header>
    {#if dms.loading && messages.length === 0}<p class="muted center">読み込んでいます…</p>{/if}
    {#if !dms.loading && messages.length === 0}<p class="muted center">まだメッセージはありません。</p>{/if}
    <div class="bubbles">
      {#each messages as message (message.id)}
        {@const mine = message.pubkey === viewer.pubkey}
        <div class="bubble-row" class:mine>
          <div class="bubble-col">
            <div class="bubble">{#if message.file}<DmFileView file={message.file} />{:else}<Content text={message.content} emojis={new Map()} hidden />{/if}</div>
            <span class="time">{postTime(message.created_at, settings.timeDisplay, clock.now)}{message.protocol === "nip04" ? "・旧方式（NIP-04）" : ""}</span>
          </div>
        </div>
      {/each}
      <span bind:this={bottom}></span>
    </div>
    <div class="input">
      <div class="input-row">
        {#if !legacy}
          <button type="button" class="attach" onclick={() => filePicker?.click()} disabled={sending} aria-label="ファイルを送る" title="ファイルを送る（暗号化して送ります）"><Icon name="addPhoto" size={20} /></button>
          <input bind:this={filePicker} type="file" hidden onchange={(e) => { void sendFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
        {/if}
        <textarea bind:value={text} rows="2" placeholder="メッセージ（エンターで改行）" aria-label="メッセージ"></textarea>
        <button type="button" class="send" onclick={send} disabled={sending || !text.trim()} aria-label="送信" title="送信"><Icon name="send" size={20} /></button>
      </div>
      <label class="muted small legacy"><input type="checkbox" bind:checked={legacy} />旧方式 NIP-04 で送る</label>
      {#if legacy}
        <p class="warn small">旧方式（NIP-04）では、内容は暗号化されますが、送った相手と時刻はリレーから見えます。ファイルは送れません。</p>
      {:else}
        <p class="muted small">NIP-17 で送ります（内容と相手は暗号化され、リレーからは見えません）。</p>
      {/if}
      {#if sendMessage}<p class="error">{sendMessage}</p>{/if}
    </div>
  </section>
{/if}

<style>
  .warn {
    color: #c33;
  }
  .notice {
    color: var(--muted);
    padding: 16px;
    margin: 0;
  }
  .list {
    display: grid;
    gap: 8px;
    padding: 8px 16px;
  }
  .banner {
    margin: 0;
    padding: 10px 12px;
    font-size: 0.9em;
    background: var(--surface-low);
    border-radius: 10px;
  }
  .banner a {
    display: block;
    margin-top: 4px;
    color: var(--primary);
  }
  .new {
    display: flex;
    gap: 8px;
  }
  .new input,
  textarea {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 0.95em;
    padding: 7px 10px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
    resize: vertical;
  }
  .outline {
    flex: none;
    font: inherit;
    font-size: 0.9em;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    padding: 4px 14px;
    cursor: pointer;
  }
  .muted {
    margin: 4px 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .small {
    font-size: 0.75em;
  }
  .center {
    text-align: center;
    padding: 16px;
  }
  .error {
    margin: 4px 0;
    color: #d33;
    font-size: 0.9em;
  }
  .conversations {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .conversations a {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--outline-variant);
  }
  .text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .text span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85em;
    color: var(--muted);
  }
  .when {
    flex: none;
    font-size: 0.75em;
    color: var(--muted);
  }
  .dot {
    position: absolute;
    top: 12px;
    left: 48px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #d33;
  }
  /* 入力欄が画面のいちばん下に来るように（上のバーと下のタブの分を引く） */
  .room {
    display: flex;
    flex-direction: column;
    min-height: calc(100dvh - 130px);
  }
  .room-head {
    padding: 8px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
    text-decoration: none;
  }
  .bubbles {
    flex: 1;
    padding: 8px 12px;
  }
  .bubble-row {
    display: flex;
    margin-top: 8px;
  }
  .bubble-row.mine {
    justify-content: flex-end;
  }
  .bubble-col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 80%;
  }
  .mine .bubble-col {
    align-items: flex-end;
  }
  .bubble {
    padding: 8px 12px;
    background: var(--surface-low);
    border-radius: 16px 16px 16px 4px;
    overflow-wrap: anywhere;
  }
  .mine .bubble {
    color: var(--on-primary);
    background: var(--primary);
    border-radius: 16px 16px 4px 16px;
  }
  .mine .bubble :global(a) {
    color: inherit;
    text-decoration: underline;
  }
  .time {
    font-size: 0.68em;
    color: var(--muted);
    margin: 2px 6px 0;
  }
  .input {
    position: sticky;
    bottom: 0;
    padding: 8px 12px;
    background: var(--container);
    border-top: 1px solid var(--outline-variant);
  }
  .input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .attach {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    color: var(--primary);
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .legacy {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .send {
    display: grid;
    place-items: center;
    flex: none;
    width: 42px;
    height: 42px;
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
