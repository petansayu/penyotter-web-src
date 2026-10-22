<script lang="ts">
  import { tick, untrack } from "svelte";
  import { chatPlacement, messageReplyTo } from "../domain/chat";
  import { visibleText } from "../domain/hiddenMessages";
  import { emojisOf } from "../domain/content";
  import type { Event } from "../nostr/events";
  import { nip19 } from "nostr-tools";
  import { profileHref } from "../router.svelte";
  import { actions } from "../store/actions.svelte";
  import { displayName } from "../store/cache.svelte";
  import { chat } from "../store/chat.svelte";
  import { composer } from "../store/composer.svelte";
  import { lists } from "../store/lists.svelte";
  import { summary } from "../store/publishSummary";
  import { settings } from "../store/settings.svelte";
  import { toast } from "../store/toast.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Avatar from "./Avatar.svelte";
  import { clock } from "./clock.svelte";
  import Content from "./Content.svelte";
  import Icon from "./Icon.svelte";
  import { useNavigate } from "./navigation";
  import { postTime } from "./time";

  /**
   * パブリックチャット（Android 版の PublicChatPanel・PublicChatBubbles・ChatMessageMenu）。channel がなければチャンネルの
   * 一覧、あればそのチャンネルの吹き出し。自分は右、ほかの人は左でアイコンと名前。同じ人が 5 分以内に続けた分はまとめ、
   * 日が変わるところに日付。吹き出しを押すと操作のメニュー。入力欄はエンターで改行し、送信はボタンだけ。
   */
  let { channel = null }: { channel?: string | null } = $props();
  const navigate = useNavigate();

  let tab = $state<"joined" | "discover">("joined");
  let query = $state("");
  let creating = $state(false);
  let newName = $state("");
  let newAbout = $state("");
  let newRelays = $state<string[]>([]);
  let createError = $state<string | null>(null);
  let text = $state("");
  let replyTo = $state<Event | null>(null);
  let menuFor = $state<Event | null>(null);
  let sendMessage = $state<string | null>(null);
  let bottom = $state<HTMLElement>();

  $effect(() => {
    void chat.load();
  });

  $effect(() => {
    const id = channel;
    untrack(() => {
      if (id) void chat.open(id);
      else chat.close();
    });
    return () => untrack(() => chat.close());
  });

  const info = $derived(channel ? chat.channels.get(channel) : undefined);
  const joined = $derived(channel ? chat.joined.includes(channel) : false);
  const shown = $derived(chat.messages.filter((m) => !viewer.mutedPubkeys.has(m.pubkey) && !viewer.mutedEvents.has(m.id)));
  const placement = $derived(chatPlacement(shown));
  const byId = $derived(new Map(chat.messages.map((m) => [m.id, m])));
  const list = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const all = [...chat.channels.values()].filter((c) => !viewer.mutedPubkeys.has(c.create.pubkey));
    const chosen = tab === "joined" ? all.filter((c) => chat.joined.includes(c.id)) : all;
    return chosen.filter((c) => !q || c.meta.name.toLowerCase().includes(q) || c.meta.about.toLowerCase().includes(q)).sort((a, b) => b.lastAt - a.lastAt);
  });

  // 新しいメッセージが来たら、いちばん下へ
  $effect(() => {
    void shown.length;
    void tick().then(() => bottom?.scrollIntoView({ block: "end" }));
  });

  function startCreate() {
    creating = true;
    newRelays = viewer.writeRelays.slice(0, 3);
  }

  async function create() {
    createError = null;
    try {
      const id = await chat.create(newName, newAbout, newRelays);
      creating = false;
      newName = "";
      newAbout = "";
      navigate(`#/chat/${id}`);
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    }
  }

  async function send() {
    if (!channel || !text.trim()) return;
    sendMessage = null;
    try {
      const result = await chat.send(channel, text, replyTo ?? undefined);
      if (result.accepted > 0) {
        text = "";
        replyTo = null;
      }
      sendMessage = result.accepted > 0 ? null : summary(result);
    } catch (e) {
      sendMessage = e instanceof Error ? e.message : String(e);
    }
  }

  async function toggleJoin() {
    if (!channel) return;
    try {
      toast.show(summary(await chat.setJoined(channel, !joined)));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.show(`${label}をコピーしました`);
    } catch {
      toast.show("コピーできませんでした");
    }
  }

  /** メニューを閉じてから、そのメッセージで操作する（閉じたあとは menuFor が空になるので先に取っておく）。 */
  function act(run: (message: Event) => void) {
    const message = menuFor;
    menuFor = null;
    if (message) run(message);
  }

  const snippet = (event: Event | undefined) => (event ? visibleText(event.content).replace(/\s+/g, " ").slice(0, 60) : "（読み込めていないメッセージ）");
  /** 通報するメッセージ。 */
  let reporting = $state<Event | null>(null);
</script>

{#if !channel}
  <section class="list">
    <div class="list-head">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "joined"} class:active={tab === "joined"} onclick={() => (tab = "joined")}>参加中</button>
        <button type="button" role="tab" aria-selected={tab === "discover"} class:active={tab === "discover"} onclick={() => (tab = "discover")}>みつける</button>
      </div>
      <button type="button" class="icon" onclick={() => chat.load(true)} disabled={chat.loading} aria-label="更新" title="更新"><Icon name="refresh" size={20} /></button>
      {#if viewer.canSign}<button type="button" class="icon" onclick={startCreate} aria-label="チャンネルを作る" title="チャンネルを作る"><Icon name="add" size={20} /></button>{/if}
    </div>
    <input class="search" bind:value={query} placeholder="チャンネルを名前で探す" aria-label="チャンネルを名前で探す" />
    {#if creating}
      <div class="create">
        <strong>チャンネルを作る</strong>
        <input bind:value={newName} placeholder="名前" aria-label="チャンネルの名前" maxlength="100" />
        <textarea bind:value={newAbout} rows="2" placeholder="説明（なくてもよい）" aria-label="チャンネルの説明"></textarea>
        <span class="muted">置くリレー（メッセージもここに送ります）</span>
        {#each viewer.writeRelays as relay (relay)}
          <label class="check"><input type="checkbox" checked={newRelays.includes(relay)} onchange={(event) => (newRelays = event.currentTarget.checked ? [...newRelays, relay] : newRelays.filter((r) => r !== relay))} />{relay.replace(/^wss:\/\//, "")}</label>
        {/each}
        {#if createError}<p class="error">{createError}</p>{/if}
        <div class="row-actions">
          <button type="button" class="text" onclick={() => (creating = false)}>やめる</button>
          <button type="button" class="filled" onclick={create}>作る</button>
        </div>
      </div>
    {/if}
    {#if chat.message}<p class="muted">{chat.message}</p>{/if}
    {#if chat.loading && list.length === 0}<p class="muted">読み込んでいます…</p>{/if}
    {#if !chat.loading && list.length === 0}<p class="muted">{tab === "joined" ? "参加中のチャンネルはありません。「みつける」から探せます。" : "チャンネルが見つかりませんでした。"}</p>{/if}
  </section>
  <ul class="channels">
    {#each list as item (item.id)}
      <li>
        <a href="#/chat/{item.id}" onclick={(event) => { event.preventDefault(); navigate(`#/chat/${item.id}`); }}>
          {#if item.meta.picture}<img class="picture" src={item.meta.picture} alt="" referrerpolicy="no-referrer" />{:else}<span class="picture initial">{item.meta.name.slice(0, 1)}</span>{/if}
          <span class="channel-text">
            <strong>{item.meta.name}</strong>
            {#if item.meta.about}<span>{item.meta.about}</span>{/if}
          </span>
          <span class="when">{postTime(item.lastAt, settings.timeDisplay, clock.now)}</span>
        </a>
      </li>
    {/each}
  </ul>
{:else}
  <section class="room">
    <header class="room-head">
      <span class="room-title">
        <strong>{info?.meta.name ?? "チャンネル"}</strong>
        {#if info?.meta.about}<span>{info.meta.about}</span>{/if}
      </span>
      {#if viewer.canSign}<button type="button" class="outline" onclick={toggleJoin}>{joined ? "退出" : "参加"}</button>{/if}
    </header>
    {#if chat.messagesLoading && shown.length === 0}<p class="muted center">読み込んでいます…</p>{/if}
    {#if !chat.messagesLoading && shown.length === 0}<p class="muted center">メッセージはまだありません</p>{/if}
    <div class="bubbles">
      {#each shown as message, i (message.id)}
        {@const mine = message.pubkey === viewer.pubkey}
        {@const place = placement[i]}
        {@const parentId = messageReplyTo(message)}
        {#if place.day}<div class="day">{place.day}</div>{/if}
        <div class="bubble-row" class:mine class:grouped={place.grouped}>
          {#if !mine}
            {#if place.grouped}<span class="avatar-space"></span>{:else}<a class="avatar" href={profileHref(message.pubkey)}><Avatar pubkey={message.pubkey} size={32} /></a>{/if}
          {/if}
          <div class="bubble-col">
            {#if !mine && !place.grouped}<span class="name">{displayName(message.pubkey)}</span>{/if}
            {#if parentId}<span class="reply-line"><Icon name="reply" size={13} />{byId.get(parentId) ? `${displayName(byId.get(parentId)!.pubkey)}: ` : ""}{snippet(byId.get(parentId))}</span>{/if}
            <button type="button" class="bubble" onclick={() => (menuFor = message)} aria-label="メッセージの操作">
              <Content text={message.content} emojis={emojisOf(message)} hidden />
            </button>
            <span class="time">{postTime(message.created_at, settings.timeDisplay, clock.now)}</span>
          </div>
        </div>
      {/each}
      <span bind:this={bottom}></span>
    </div>
    {#if viewer.canSign}
      <div class="input">
        {#if replyTo}
          <div class="replying"><Icon name="reply" size={14} /><span>{displayName(replyTo.pubkey)}: {snippet(replyTo)}</span><button type="button" class="icon" onclick={() => (replyTo = null)} aria-label="返信をやめる"><Icon name="close" size={16} /></button></div>
        {/if}
        <div class="input-row">
          <textarea bind:value={text} rows="2" placeholder="メッセージ（エンターで改行）" aria-label="メッセージ"></textarea>
          <button type="button" class="send" onclick={send} disabled={chat.sending || !text.trim()} aria-label="送信" title="送信"><Icon name="send" size={20} /></button>
        </div>
        {#if sendMessage}<p class="error">{sendMessage}</p>{/if}
      </div>
    {:else}
      <p class="muted center">見るだけのアカウントでは送れません。</p>
    {/if}
  </section>
{/if}

{#if menuFor}
  {@const target = menuFor}
  {@const mine = target.pubkey === viewer.pubkey}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="sheet-back" onclick={() => (menuFor = null)}>
    <div class="sheet" role="menu" tabindex="-1" aria-label="メッセージの操作" onclick={(event) => event.stopPropagation()}>
      <p class="sheet-preview">{snippet(target)}</p>
      {#if viewer.canSign}
        <button type="button" role="menuitem" onclick={() => act((m) => void actions.react(m, settings.oneTap.content, settings.oneTap.emoji))}>{settings.oneTap.content === "+" ? "♡" : settings.oneTap.content} でリアクション</button>
        <button type="button" role="menuitem" onclick={() => act((m) => (replyTo = m))}>返信</button>
        <button type="button" role="menuitem" onclick={() => act((m) => composer.show("quote", m))}>引用してタイムラインに投稿</button>
      {/if}
      <button type="button" role="menuitem" onclick={() => act((m) => void copy(m.content, "本文"))}>本文をコピー</button>
      <button type="button" role="menuitem" onclick={() => act((m) => void copy(`nostr:${nip19.neventEncode({ id: m.id, author: m.pubkey, kind: 42 })}`, "ID"))}>IDをコピー</button>
      <button type="button" role="menuitem" onclick={() => act((m) => navigate(profileHref(m.pubkey)))}>プロフィール</button>
      {#if viewer.canSign && !mine}
        <button type="button" role="menuitem" onclick={() => act((m) => void lists.muteUser(m.pubkey))}>{displayName(target.pubkey)} をミュート</button>
        <button type="button" role="menuitem" onclick={() => act((m) => void lists.mutePost(m.id))}>このメッセージをミュート</button>
        <button type="button" role="menuitem" class="danger" onclick={() => act((m) => (reporting = m))}>通報</button>
      {/if}
      <button type="button" class="cancel" onclick={() => (menuFor = null)}>閉じる</button>
    </div>
  </div>
{/if}

{#if reporting}
  {@const target = reporting}
  {#await import("./ReportDialog.svelte") then { default: ReportDialog }}<ReportDialog target={{ note: target, pubkey: target.pubkey }} close={() => (reporting = null)} />{/await}
{/if}

<style>
  .danger {
    color: #c33 !important;
  }
  .list {
    padding: 8px 16px;
    display: grid;
    gap: 8px;
  }
  .list-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tabs {
    flex: 1;
    display: flex;
    border: 1px solid var(--outline);
    border-radius: 999px;
    overflow: hidden;
  }
  .tabs button {
    flex: 1;
    font: inherit;
    font-size: 0.9em;
    padding: 6px 0;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .tabs button.active {
    font-weight: 600;
    background: var(--secondary-container);
  }
  .icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    color: var(--muted);
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .search,
  .create input,
  .create textarea,
  textarea {
    font: inherit;
    font-size: 0.95em;
    padding: 7px 10px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
    resize: vertical;
  }
  .create {
    display: grid;
    gap: 6px;
    padding: 10px;
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    background: var(--surface-low);
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.9em;
  }
  .row-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .text {
    font: inherit;
    color: var(--primary);
    background: none;
    border: none;
    cursor: pointer;
  }
  .filled {
    font: inherit;
    font-weight: 600;
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    border-radius: 999px;
    padding: 6px 18px;
    cursor: pointer;
  }
  .outline {
    flex: none;
    font: inherit;
    font-size: 0.85em;
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
  .center {
    text-align: center;
    padding: 16px;
  }
  .error {
    margin: 4px 0;
    color: #d33;
    font-size: 0.9em;
  }
  .channels {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .channels a {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--outline-variant);
  }
  .picture {
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    object-fit: cover;
  }
  .picture.initial {
    display: grid;
    place-items: center;
    font-weight: 700;
    color: var(--on-primary);
    background: var(--primary);
  }
  .channel-text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .channel-text span,
  .room-title span {
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
  /* 入力欄が画面のいちばん下に来るように（上のバーと下のタブの分を引く） */
  .room {
    display: flex;
    flex-direction: column;
    min-height: calc(100dvh - 130px);
  }
  .room-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .room-title {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .bubbles {
    flex: 1;
    padding: 8px 12px;
  }
  .day {
    margin: 12px auto 6px;
    width: fit-content;
    padding: 2px 10px;
    font-size: 0.75em;
    color: var(--muted);
    background: var(--surface-low);
    border-radius: 999px;
  }
  .bubble-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .bubble-row.grouped {
    margin-top: 3px;
  }
  .bubble-row.mine {
    justify-content: flex-end;
  }
  .avatar,
  .avatar-space {
    flex: none;
    width: 32px;
  }
  .bubble-col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 78%;
    min-width: 0;
  }
  .mine .bubble-col {
    align-items: flex-end;
  }
  .name {
    font-size: 0.75em;
    color: var(--muted);
    margin: 0 0 2px 4px;
  }
  .reply-line {
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.75em;
    color: var(--muted);
    margin: 0 4px 2px;
  }
  .bubble {
    font: inherit;
    text-align: left;
    color: var(--text);
    padding: 8px 12px;
    background: var(--surface-low);
    border: none;
    border-radius: 16px 16px 16px 4px;
    cursor: pointer;
    max-width: 100%;
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
  .replying {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8em;
    color: var(--muted);
  }
  .replying span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }
  .input-row textarea {
    flex: 1;
    min-width: 0;
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
  .sheet-preview {
    margin: 4px 16px 8px;
    color: var(--muted);
    font-size: 0.85em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sheet button {
    font: inherit;
    text-align: left;
    padding: 12px 20px;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .sheet button:hover {
    background: var(--surface-low);
  }
  .sheet .cancel {
    color: var(--muted);
    text-align: center;
  }
</style>
