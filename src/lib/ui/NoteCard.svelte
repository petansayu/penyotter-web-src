<script lang="ts">
  import { untrack } from "svelte";
  import { clientName, contentWarning, isLongBody, proxyOrigin, subjectToShow } from "../domain/cardInfo";
  import { reactionDisplay } from "../domain/emojis";
  import { embedsIn } from "../domain/embeds";
  import { visibleText } from "../domain/hiddenMessages";
  import { parsePoll } from "../domain/extraEvents";
  import { compact } from "../domain/interactions";
  import { emojisOf, mediaOf, quoteCards, withoutMedia, withoutQuoteLink } from "../domain/content";
  import { address, parent } from "../domain/threads";
  import { isHex64, tagValue, type Event } from "../nostr/events";
  import { profileHref, threadHref, writeHref } from "../router.svelte";
  import { displayName, notes, profiles, requestNote } from "../store/cache.svelte";
  import { actions } from "../store/actions.svelte";
  import { composer } from "../store/composer.svelte";
  import { counts, deletedNotes, requestInteractions } from "../store/interactions.svelte";
  import { lists } from "../store/lists.svelte";
  import { settings } from "../store/settings.svelte";
  import { requestStatuses, statuses } from "../store/statuses.svelte";
  import { toast } from "../store/toast.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Avatar from "./Avatar.svelte";
  import { clock } from "./clock.svelte";
  import Content from "./Content.svelte";
  import EmbedView from "./EmbedView.svelte";
  import EmojiPicker from "./EmojiPicker.svelte";
  import HiddenMessage from "./HiddenMessage.svelte";
  import Icon from "./Icon.svelte";
  import MediaGrid from "./MediaGrid.svelte";
  import PollView from "./PollView.svelte";
  import QuoteCard from "./QuoteCard.svelte";
  import { useNavigate } from "./navigation";
  import { plainTap } from "./tap";
  import { fullTime, postTime } from "./time";

  /**
   * 投稿 1 件（Android 版の NoteCell と PostActions）。nested は引用カードの中（引用カードをさらに入れない）。
   * reaction はリアクションの列で、その人のリアクション。
   *
   * 並び: リポスト・リアクションの印 → 名前・@ユーザー名・クライアント名・時刻 → ステータス → 返信元 → 注意書き →
   * 件名・本文（長ければ「続きを読む」）→ 引用カード → 画像・動画 → 橋渡し元 → 操作（返信・引用・リポスト・
   * 1 タップリアクション・絵文字・「…」）。
   */
  let { note, repost, reaction, nested = false, selected = false }: { note: Event; repost?: Event; reaction?: Event; nested?: boolean; selected?: boolean } = $props();

  const MEDIA_KINDS = [20, 21, 22, 34235, 34236];
  const navigate = useNavigate();

  /** カードのどこを押しても投稿詳細を開く（投稿詳細で選んでいる投稿は除く）。引用カードは引用元を開く。 */
  function tapCard(event: MouseEvent) {
    if (selected || !plainTap(event)) return;
    event.stopPropagation();
    navigate(href);
  }
  const media = $derived(mediaOf(note));
  // 引用カードは q タグと本文の note・nevent を 3 件まで（Android 版の Quotes.cards）。引用カードの中では出さない
  const quotes = $derived(nested ? [] : quoteCards(note));
  const body = $derived(withoutQuoteLink(withoutMedia(note.content, media), quotes.map((q) => q.id)));
  const emojis = $derived(emojisOf(note));
  const profile = $derived(profiles.get(note.pubkey)?.profile);
  /** 名前の横の @ユーザー名（表示名と別の name があるとき）。 */
  const username = $derived(profile?.name && profile.displayName && profile.name !== profile.displayName ? profile.name : null);
  const client = $derived(settings.showClientTags ? clientName(note) : null);
  const status = $derived(settings.showStatuses && !nested ? statuses.get(note.pubkey)?.[0] : undefined);
  const warning = $derived(contentWarning(note));
  const subject = $derived(note.kind === 1 || note.kind === 1111 ? subjectToShow(note, body) : null);
  const title = $derived(note.kind !== 1 && note.kind !== 1111 ? tagValue(note, "title") ?? tagValue(note, "subject") : null);
  const proxy = $derived(proxyOrigin(note));
  /** 本文のリンクの埋め込み（YouTube・X など、2 件まで。引用カードの中では出さない）。 */
  const embeds = $derived(nested ? [] : embedsIn(body));
  const long = $derived(isLongBody(visibleText(body)));
  const parentId = $derived(parent(note));
  const parentNote = $derived(parentId ? notes.get(parentId) : undefined);
  /** 返信先として名前を出す人（作者以外の最初の p。引用カードの中だけ）。 */
  const replyTo = $derived.by(() => {
    if (parentId === null) return null;
    return note.tags.find((tag) => tag[0] === "p" && isHex64(tag[1]) && tag[1] !== note.pubkey)?.[1] ?? null;
  });
  const poll = $derived(note.kind === 1068 ? parsePoll(note) : null);
  let reporting = $state(false);
  let zapping = $state(false);
  // 本文として描く種類（技術資料 8.5。42 はパブリックチャットのメッセージ）
  const known = $derived([1, 1111, 42, 30023, 1068, ...MEDIA_KINDS].includes(note.kind));
  const href = $derived(threadHref(note.id, note.pubkey));
  const count = $derived(counts.get(note.id));
  const deleted = $derived(deletedNotes.has(note.id));
  const mine = $derived(note.pubkey === viewer.pubkey);

  /** 削除が依頼された投稿を開いているか。 */
  let shown = $state(false);
  /** 注意書き付きの投稿を開いたか。 */
  let revealed = $state(false);
  /** 長い本文を開いたか。 */
  let expanded = $state(false);
  let mediaRevealed = $state(false);
  /** 設定で出さない画像・動画（押すと出す）。 */
  const hiddenMedia = $derived(mediaRevealed ? 0 : media.filter((item) => (item.video ? !settings.showVideos : !settings.showImages)).length);
  const shownMedia = $derived(mediaRevealed ? media : media.filter((item) => (item.video ? settings.showVideos : settings.showImages)));
  /** リポスト・引用のメニューを開いているか。 */
  let menuOpen = $state(false);
  /** 絵文字のパレットを開いているか。 */
  let pickerOpen = $state(false);
  /** 「…」のメニューを開いているか。confirming は削除の確かめ中。 */
  let moreOpen = $state(false);
  let confirming = $state(false);
  let moreAnchor = $state<HTMLElement>();
  let jsonDialog = $state<HTMLDialogElement>();
  let parentState = $state<"loading" | "missing" | null>(null);

  // 返信元を読む（なければ取りに行く）
  $effect(() => {
    const id = parentId;
    if (!id || nested || notes.has(id)) return;
    untrack(() => {
      parentState = "loading";
      const hint = note.tags.find((tag) => tag[0] === "e" && tag[1] === id)?.[2];
      void requestNote(id, hint ? [hint] : [], replyTo ?? undefined).then((found) => (parentState = found ? null : "missing"));
    });
  });

  function retryParent() {
    if (!parentId) return;
    parentState = "loading";
    void requestNote(parentId, [], replyTo ?? undefined).then((found) => (parentState = found ? null : "missing"));
  }

  async function copy(text: string, label: string) {
    moreOpen = false;
    try {
      await navigator.clipboard.writeText(text);
      toast.show(`${label}をコピーしました`);
    } catch {
      toast.show("コピーできませんでした");
    }
  }

  async function share() {
    moreOpen = false;
    try {
      await navigator.share({ text: note.content });
    } catch {
      // 共有をやめたときも何もしない
    }
  }

  /** 1 タップリアクション（設定の「リアクション」で選んだもの）。リアクション済みなら取り消す。 */
  function oneTap() {
    if (actions.reactionTo(note.id)) void actions.unreact(note);
    else void actions.react(note, settings.oneTap.content, settings.oneTap.emoji);
  }

  // メニューの外を押したら閉じる（開いている間だけ聞く。一覧には投稿が千件ほど並ぶので）
  $effect(() => {
    if (!moreOpen) return;
    const close = (event: MouseEvent) => {
      if (moreAnchor?.contains(event.target as Node)) return;
      moreOpen = false;
      confirming = false;
    };
    window.addEventListener("click", close, true);
    return () => window.removeEventListener("click", close, true);
  });

  let element = $state<HTMLElement>();

  // 画面に近づいたものから読む。引用カードの中の投稿も、削除の依頼を確かめる（数は出さない）
  $effect(() => {
    const target = note;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      untrack(() => {
        requestInteractions(target);
        if (settings.showStatuses) requestStatuses([target.pubkey]);
      });
    }, { rootMargin: "600px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  });

  const countLabel = (value: number) => {
    const label = compact(value);
    return label && count && !count.complete ? `≥${label}` : label;
  };
</script>

{#snippet moreMenu()}
  <span class="more-anchor" bind:this={moreAnchor}>
    <button type="button" class="action more" onclick={() => { moreOpen = !moreOpen; confirming = false; }} aria-label="投稿のその他操作" aria-haspopup="menu" aria-expanded={moreOpen} title="その他"><Icon name="moreHoriz" size={18} /></button>
    {#if moreOpen}
      <span class="menu more-menu" role="menu">
        {#if confirming}
          <span class="confirm">投稿を削除しますか？ 削除をリレーに依頼します。ほかのアプリやリレーには残ることがあります。</span>
          <button type="button" role="menuitem" class="danger" onclick={() => { moreOpen = false; confirming = false; void actions.deletePost(note); }}>削除する</button>
          <button type="button" role="menuitem" onclick={() => (confirming = false)}>やめる</button>
        {:else}
          <button type="button" role="menuitem" onclick={() => { moreOpen = false; jsonDialog?.showModal(); }}>イベントJSONを確認</button>
          <button type="button" role="menuitem" onclick={() => copy(`nostr:${href.replace("#/e/", "")}`, "投稿ID")}>IDをコピー</button>
          <button type="button" role="menuitem" onclick={() => copy(note.id, "イベントID")}>イベントID（16進）をコピー</button>
          <button type="button" role="menuitem" onclick={() => copy(note.content, "投稿本文")}>テキストをコピー</button>
          {#if typeof navigator.share === "function"}<button type="button" role="menuitem" onclick={share}>テキストを共有</button>{/if}
          {#if viewer.canSign && profiles.get(note.pubkey)?.profile.lud16}
            <button type="button" role="menuitem" onclick={() => { moreOpen = false; zapping = true; }}>⚡ Zapを送る</button>
          {/if}
          {#if viewer.canSign}
            {@const addressRef = note.kind >= 30000 && note.kind < 40000 ? address(note) : null}
            {@const bookmarked = viewer.bookmarks.has(note.id) || (!!addressRef && viewer.bookmarks.has(addressRef))}
            <button type="button" role="menuitem" disabled={lists.busy.has(10003)} onclick={() => { moreOpen = false; void (bookmarked ? lists.unbookmark({ id: note.id, address: addressRef }) : lists.bookmark({ id: note.id, address: addressRef })); }}>{bookmarked ? "ブックマークから外す" : "ブックマークに追加"}</button>
          {/if}
          {#if viewer.canSign && !mine}
            <button type="button" role="menuitem" disabled={lists.busy.has(10000)} onclick={() => { moreOpen = false; void lists.mutePost(note.id); }}>この投稿をミュート</button>
            <button type="button" role="menuitem" disabled={lists.busy.has(10000)} onclick={() => { moreOpen = false; void lists.muteUser(note.pubkey); }}>{displayName(note.pubkey)} をミュート</button>
            <button type="button" role="menuitem" class="danger" onclick={() => { moreOpen = false; reporting = true; }}>通報</button>
          {/if}
          {#if viewer.canSign && mine && note.kind === 30023}
            <a role="menuitem" class="menu-link" href={writeHref(tagValue(note, "d") ?? "")} onclick={() => (moreOpen = false)}>この記事を編集</a>
          {/if}
          {#if viewer.canSign && mine}
            <button type="button" role="menuitem" class="danger" disabled={actions.busy.has(note.id)} onclick={() => (confirming = true)}>投稿を削除</button>
          {/if}
        {/if}
      </span>
    {/if}
  </span>
{/snippet}

{#snippet actionRow()}
  {#if viewer.canSign}
    {@const liked = actions.reactionTo(note.id)}
    {@const reposted = actions.repostOf(note.id)}
    {@const busy = actions.busy.has(note.id)}
    {@const shownReaction = liked ? reactionDisplay(liked) : reactionDisplay({ ...note, kind: 7, content: settings.oneTap.content, tags: settings.oneTap.emoji ? [["emoji", settings.oneTap.emoji.shortcode, settings.oneTap.emoji.url]] : [] })}
    <div class="actions" aria-label="操作">
      <button type="button" class="action" title="返信" aria-label="返信する（{count?.replies ?? 0} 件）" onclick={() => composer.show("reply", note)}>
        <Icon name="chatBubbleOutline" size={18} />{count ? countLabel(count.replies) : ""}
      </button>
      <button type="button" class="action" title="引用してタイムラインに投稿" aria-label="引用してタイムラインに投稿" onclick={() => composer.show("quote", note)}>
        <Icon name="formatQuote" size={18} />
      </button>
      <span class="menu-anchor">
        <button type="button" class="action" class:on={reposted} title="リポスト" aria-label="リポスト（{count?.reposts ?? 0} 件）" aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy} onclick={() => (menuOpen = !menuOpen)}>
          <Icon name="repeat" size={18} />{count ? countLabel(count.reposts) : ""}
        </button>
        {#if menuOpen}
          <span class="menu" role="menu">
            <button type="button" role="menuitem" onclick={() => { menuOpen = false; void actions.toggleRepost(note); }}>{reposted ? "リポストを取り消す" : "リポスト"}</button>
            <button type="button" role="menuitem" onclick={() => { menuOpen = false; composer.show("quote", note); }}>引用</button>
          </span>
        {/if}
      </span>
      <button type="button" class="action" class:liked title={liked ? "リアクションを取り消す" : "1タップでリアクション"} aria-label="{liked ? "リアクションを取り消す" : "1タップでリアクション"}（{count?.reactions ?? 0} 件）" aria-pressed={!!liked} disabled={busy} onclick={oneTap}>
        {#if shownReaction.type === "image"}<img class="reaction" class:dim={!liked} src={shownReaction.url} alt=":{shownReaction.shortcode}:" referrerpolicy="no-referrer" />
        {:else if shownReaction.type === "text"}<span class="reaction" class:dim={!liked}>{shownReaction.text}</span>
        {:else}<Icon name={liked ? "favorite" : "favoriteBorder"} size={18} />{/if}{count ? countLabel(count.reactions) : ""}
      </button>
      <span class="menu-anchor picker-anchor">
        <button type="button" class="action" title="絵文字でリアクション" aria-label="絵文字でリアクション" aria-haspopup="dialog" aria-expanded={pickerOpen} disabled={busy} onclick={() => (pickerOpen = !pickerOpen)}>
          <Icon name="insertEmoticon" size={18} />
        </button>
        {#if pickerOpen}
          <EmojiPicker hiddenInput close={() => (pickerOpen = false)} pick={(content, emoji) => { pickerOpen = false; void actions.react(note, content, emoji); }} />
        {/if}
      </span>
      {@render moreMenu()}
    </div>
  {:else}
    <div class="actions" aria-label="反応">
      <span class="action" title="返信" aria-label="返信 {count?.replies ?? 0} 件"><Icon name="chatBubbleOutline" size={18} />{count ? countLabel(count.replies) : ""}</span>
      <span class="action" title="リポスト" aria-label="リポスト {count?.reposts ?? 0} 件"><Icon name="repeat" size={18} />{count ? countLabel(count.reposts) : ""}</span>
      <span class="action" title="リアクション" aria-label="リアクション {count?.reactions ?? 0} 件"><Icon name="favoriteBorder" size={18} />{count ? countLabel(count.reactions) : ""}</span>
      {@render moreMenu()}
    </div>
  {/if}
{/snippet}

{#snippet bodyParts()}
  {#if note.kind === 30023}
    <a class="article" {href}>
      {#if settings.showImages && tagValue(note, "image")}<img src={tagValue(note, "image")} alt="" loading="lazy" referrerpolicy="no-referrer" />{/if}
      <strong>{title ?? "（題名なし）"}</strong>
      {#if tagValue(note, "summary")}<span>{tagValue(note, "summary")}</span>{/if}
      <small>記事</small>
    </a>
  {:else if known}
    {#if title}<div class="title">{title}</div>{/if}
    {#if subject}<div class="title">{subject}</div>{/if}
    {#if body}
      <div class="body" class:clamped={long && !expanded}><Content text={body} {emojis} hidden /></div>
      {#if long}<button type="button" class="expand" onclick={() => (expanded = !expanded)}>{expanded ? "折りたたむ" : "続きを読む"}</button>{/if}
    {/if}
    {#if poll}<PollView {poll} />{/if}
    {#each quotes as q (q.id)}<QuoteCard id={q.id} relays={q.relays} author={q.author} />{/each}
    {#if shownMedia.length > 0}<MediaGrid media={shownMedia} author={note.pubkey} />{/if}
    {#each embeds as embed (embed.src)}<EmbedView {embed} />{/each}
    {#if hiddenMedia > 0}<button type="button" class="expand" onclick={() => (mediaRevealed = true)}><Icon name="image" size={16} />画像・動画を表示（{hiddenMedia}）</button>{/if}
    {#if proxy}
      {#if proxy.url}<a class="proxy" href={proxy.url} target="_blank" rel="noopener noreferrer nofollow"><Icon name="public" size={13} />{proxy.label} からの投稿・元の投稿を開く</a>
      {:else}<span class="proxy"><Icon name="public" size={13} />{proxy.label} からの投稿</span>{/if}
    {/if}
  {:else}
    <p class="muted">{tagValue(note, "alt") ?? `表示できない種類の投稿です（kind ${note.kind}）`}</p>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article class:nested class:selected class:tappable={!selected} bind:this={element} onclick={tapCard}>
  {#if repost}
    <a class="repost" href={profileHref(repost.pubkey)}><Icon name="repeat" size={16} />{displayName(repost.pubkey)} がリポスト</a>
  {/if}
  {#if reaction}
    {@const reacted = reactionDisplay(reaction)}
    <a class="repost" href={profileHref(reaction.pubkey)}>
      {#if reacted.hidden}
        <HiddenMessage visible={reacted.type === "text" ? reacted.text : reacted.type === "image" ? `:${reacted.shortcode}:` : "❤️"} message={reacted.hidden} dialog>
          {#if reacted.type === "image"}<img class="reaction" src={reacted.url} alt=":{reacted.shortcode}:" referrerpolicy="no-referrer" />{:else if reacted.type === "text"}<span class="reaction">{reacted.text}</span>{:else}<Icon name="favorite" size={16} />{/if}
        </HiddenMessage>
      {:else if reacted.type === "image"}<img class="reaction" src={reacted.url} alt=":{reacted.shortcode}:" referrerpolicy="no-referrer" />
      {:else if reacted.type === "text"}<span class="reaction">{reacted.text}</span>
      {:else}<Icon name="favorite" size={16} />{/if}{displayName(reaction.pubkey)} がリアクション
    </a>
  {/if}
  {#if deleted}
    <div class="deleted" class:open={shown}>
      <span>削除が依頼された投稿です（リレーに残っています）</span>
      <button type="button" onclick={() => (shown = !shown)}>{shown ? "たたむ" : "表示する"}</button>
      {#if viewer.canSign && mine}<button type="button" disabled={actions.busy.has(note.id)} onclick={() => actions.deletePost(note)}>削除を再送</button>{/if}
    </div>
  {/if}
  {#if !deleted || shown}
  <div class="row">
    {#if !nested && settings.showAvatars}
      <a class="avatar" href={profileHref(note.pubkey)} aria-label={displayName(note.pubkey)}><Avatar pubkey={note.pubkey} /></a>
    {/if}
    <div class="main">
      <header>
        {#if nested && settings.showAvatars}<Avatar pubkey={note.pubkey} size={20} />{/if}
        <a class="name" href={profileHref(note.pubkey)}>{displayName(note.pubkey)}</a>
        {#if username && !nested}<span class="username">@{username}</span>{/if}
        <span class="spacer"></span>
        {#if client}<span class="client" title="投稿元のクライアント">{client}</span>{/if}
        <a class="time" {href} title={fullTime(note.created_at)}>{postTime(note.created_at, settings.timeDisplay, clock.now)}</a>
      </header>
      {#if status}
        <div class="status"><span class="mark">{status.type === "music" ? "♫" : "●"}</span><span class="text">{status.content}</span></div>
      {/if}
      {#if parentId && !nested}
        {#if parentNote}
          <a class="parent" href={threadHref(parentNote.id, parentNote.pubkey)}>
            <Icon name="reply" size={15} />
            <span class="parent-text"><strong>{displayName(parentNote.pubkey)}</strong><span>{visibleText(withoutMedia(parentNote.content, mediaOf(parentNote))).trim() || "メディア投稿"}</span></span>
          </a>
        {:else}
          <div class="parent">
            <Icon name="reply" size={15} />
            <span class="parent-text"><span>{parentState === "missing" ? "返信元が見つかりません" : parentState === "loading" ? "返信元を取得中…" : "返信元は未取得です"}</span></span>
            {#if parentState === "missing"}<button type="button" class="retry" onclick={retryParent}>再試行</button>{/if}
          </div>
        {/if}
      {:else if replyTo}
        <div class="reply-to"><Icon name="reply" size={15} /><a href={profileHref(replyTo)}>@{displayName(replyTo)}</a> への返信</div>
      {/if}

      {#if warning && !revealed && !settings.revealSensitive}
        <div class="warning">
          <div class="warning-head"><Icon name="visibilityOff" size={18} /><strong>センシティブな内容</strong></div>
          <p>{warning}</p>
          <button type="button" onclick={() => (revealed = true)}>表示する</button>
        </div>
      {:else}
        {@render bodyParts()}
      {/if}
      {#if !nested}{@render actionRow()}{/if}
    </div>
  </div>
  {/if}
</article>

{#if zapping}{#await import("./ZapDialog.svelte") then { default: ZapDialog }}<ZapDialog {note} close={() => (zapping = false)} />{/await}{/if}
{#if reporting}{#await import("./ReportDialog.svelte") then { default: ReportDialog }}<ReportDialog target={{ note, pubkey: note.pubkey }} close={() => (reporting = false)} />{/await}{/if}

<dialog class="json" bind:this={jsonDialog} aria-label="イベントJSON">
  <div class="json-head">
    <strong>イベントJSON</strong>
    <button type="button" onclick={() => copy(JSON.stringify(note, null, 2), "イベントJSON")}>コピー</button>
    <button type="button" onclick={() => jsonDialog?.close()} aria-label="閉じる"><Icon name="close" size={18} /></button>
  </div>
  <pre>{JSON.stringify(note, null, 2)}</pre>
</dialog>

<style>
  .actions {
    display: flex;
    gap: 4px;
    margin: 6px 0 -4px -6px;
    max-width: 360px;
  }
  .action {
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    padding: 0 6px;
    color: var(--muted);
    font: inherit;
    font-size: 0.8em;
    background: none;
    border: none;
    border-radius: 999px;
  }
  button.action {
    cursor: pointer;
  }
  button.action:hover:not(:disabled) {
    background: var(--surface-low);
  }
  button.action:disabled {
    opacity: 0.5;
  }
  .action.on {
    color: var(--primary);
  }
  .action.liked {
    color: #e0245e;
  }
  .menu-anchor {
    position: relative;
    flex: 1;
    display: flex;
  }
  .picker-anchor {
    flex: none;
  }
  .reaction {
    font-size: 1.15em;
    line-height: 1;
  }
  img.reaction {
    height: 18px;
    max-width: 36px;
    object-fit: contain;
  }
  .menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 15;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    padding: 4px 0;
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 10px;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
  }
  .menu button {
    font: inherit;
    font-size: 0.9em;
    text-align: left;
    padding: 8px 14px;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .menu .menu-link {
    display: block;
    padding: 8px 14px;
    color: var(--text);
    text-decoration: none;
  }
  .menu button:hover {
    background: var(--surface-low);
  }
  .menu button:disabled {
    color: var(--outline);
    cursor: default;
  }
  .more-anchor {
    position: relative;
    flex: none;
    display: flex;
  }
  .action.more {
    flex: none;
  }
  .more-menu {
    left: auto;
    right: 0;
    min-width: 220px;
  }
  .menu .danger {
    color: #d33;
  }
  .confirm {
    padding: 8px 14px;
    font-size: 0.85em;
    color: var(--muted);
    max-width: 260px;
  }
  .deleted {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    color: var(--muted);
    font-size: 0.9em;
  }
  .deleted.open {
    margin-bottom: 8px;
  }
  .deleted button {
    font: inherit;
    color: var(--primary);
    background: none;
    border: none;
    padding: 4px 0;
    cursor: pointer;
  }
  article {
    padding: 12px 16px;
    border-bottom: 1px solid var(--outline-variant);
  }
  /* 設定「投稿間隔をコンパクトにする」 */
  :global(:root.compact-posts) article:not(.nested) {
    padding-top: 8px;
    padding-bottom: 6px;
  }
  article.tappable {
    cursor: pointer;
  }
  @media (hover: hover) {
    article.tappable:not(.nested):hover {
      background: color-mix(in srgb, var(--surface-low) 60%, transparent);
    }
  }
  article.selected {
    background: var(--surface-low);
  }
  article.nested {
    margin-top: 8px;
    padding: 8px 12px;
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    background: var(--surface-low);
    font-size: 0.95em;
  }
  .row {
    display: flex;
    gap: 12px;
  }
  .avatar {
    flex: none;
    height: 44px;
  }
  .main {
    flex: 1;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin-bottom: 2px;
  }
  .name {
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    flex: none;
    color: var(--muted);
    font-size: 0.78em;
    text-decoration: none;
  }
  .repost,
  .reply-to {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
    font-size: 0.85em;
    margin-bottom: 4px;
    text-decoration: none;
  }
  .repost {
    padding-left: 28px;
  }
  .reply-to a {
    color: var(--primary);
    text-decoration: none;
  }
  .title {
    font-weight: 600;
    margin-bottom: 4px;
  }
  .article {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 4px;
    padding: 12px;
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    color: var(--text);
    text-decoration: none;
  }
  .article img {
    width: 100%;
    max-height: 200px;
    object-fit: cover;
    border-radius: 8px;
  }
  .article span {
    color: var(--muted);
    font-size: 0.9em;
  }
  .article small {
    color: var(--secondary);
  }
  .muted {
    color: var(--muted);
  }
  .username {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75em;
    color: var(--muted);
  }
  .spacer {
    flex: 1;
  }
  .client {
    flex: none;
    max-width: 7em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.65em;
    color: color-mix(in srgb, var(--muted) 65%, transparent);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 3px;
    font-size: 0.78em;
    min-width: 0;
  }
  .status .mark {
    color: var(--primary);
    font-size: 0.85em;
  }
  .status .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .parent {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0 6px;
    padding: 6px 9px;
    border-radius: 6px;
    background: var(--surface-low);
    color: var(--muted);
    font-size: 0.78em;
    text-decoration: none;
  }
  .parent-text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .parent-text strong {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .parent-text span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .retry,
  .expand {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font: inherit;
    font-size: 0.85em;
    color: var(--primary);
    background: none;
    border: none;
    padding: 4px 0;
    cursor: pointer;
  }
  .body.clamped {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 8;
    line-clamp: 8;
    overflow: hidden;
  }
  .warning {
    margin: 4px 0;
    padding: 12px;
    border-radius: 12px;
    background: var(--surface-low);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
  }
  .warning-head {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }
  .warning-head strong {
    color: var(--text);
  }
  .warning p {
    margin: 6px 0;
    font-size: 0.85em;
    color: var(--muted);
  }
  .warning button {
    display: block;
    margin-left: auto;
    font: inherit;
    color: var(--primary);
    background: none;
    border: none;
    cursor: pointer;
  }
  .proxy {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-size: 0.75em;
    color: var(--muted);
    text-decoration: none;
  }
  a.proxy {
    color: var(--primary);
  }
  .reaction.dim {
    opacity: 0.55;
    filter: grayscale(0.4);
  }
  .json {
    width: min(92vw, 640px);
    max-height: 80dvh;
    padding: 12px 16px;
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
  }
  .json::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .json-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .json-head strong {
    flex: 1;
  }
  .json-head button {
    display: inline-flex;
    align-items: center;
    font: inherit;
    font-size: 0.85em;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline-variant);
    border-radius: 999px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .json pre {
    margin: 8px 0 0;
    max-height: 65dvh;
    overflow: auto;
    font-size: 0.8em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
