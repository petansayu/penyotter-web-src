<script lang="ts">
  import { untrack } from "svelte";
  import { withoutMedia, mediaOf, withoutQuoteLink, quoteCardId } from "../domain/content";
  import { actionLines, formatSats, reactedTo, sats, type ActionLine, type NotificationGroup } from "../domain/notifications";
  import type { Event } from "../nostr/events";
  import { profileHref, threadHref } from "../router.svelte";
  import { displayName, notes } from "../store/cache.svelte";
  import { fetchTarget, notifications } from "../store/notifications.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import NoteCard from "./NoteCard.svelte";
  import { useNavigate } from "./navigation";
  import { clock } from "./clock.svelte";
  import { settings } from "../store/settings.svelte";
  import { plainTap } from "./tap";
  import { fullTime, postTime } from "./time";

  /** 通知 1 枚（Android 版の NotificationCard）。返信・引用はその投稿、反応はまとめた行と対象の投稿。 */
  let { group, me }: { group: NotificationGroup; me: string } = $props();

  const navigate = useNavigate();
  const VISIBLE_LINES = 4;
  const unread = $derived(group.events.some((event) => !notifications.read.has(event.id)));
  const lines = $derived(group.kind === "actions" || group.kind === "action" ? actionLines(group) : []);
  const target = $derived(group.target ? notes.get(group.target) : undefined);
  const reacted = $derived(target?.kind === 7 ? reactedTo(target) : null);
  const reactedPost = $derived(reacted ? notes.get(reacted.id) : undefined);
  const totalSats = $derived(lines.reduce((sum, line) => sum + (line.type === "zap" ? sats(line.receipt.msats) ?? 0 : 0), 0));
  const zapCount = $derived(lines.filter((line) => line.type === "zap").length);
  let expanded = $state(false);
  const shownLines = $derived(expanded || lines.length <= VISIBLE_LINES ? lines : lines.slice(0, VISIBLE_LINES));
  const label = $derived.by(() => {
    if (group.kind === "reply") return "返信";
    if (group.kind === "quote") return "引用";
    if (!group.target) return "あなたのプロフィール";
    if (!target) return "対象の投稿";
    if (target.kind === 7) return "あなたのリアクション";
    if (target.pubkey !== me) return "関連する投稿";
    return null;
  });
  let opening = $state(false);
  let failed = $state(false);

  // 画面に出たら既読にする
  let element = $state<HTMLElement>();
  $effect(() => {
    const ids = group.events.map((event) => event.id);
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) untrack(() => notifications.markRead(ids));
    });
    observer.observe(element);
    return () => observer.disconnect();
  });

  /** 投稿の 2 行の要約。 */
  function summary(note: Event) {
    const body = withoutQuoteLink(withoutMedia(note.content, mediaOf(note)), quoteCardId(note)).replace(/\s+/g, " ").trim();
    return body || (mediaOf(note).length > 0 ? "（画像）" : "（本文なし）");
  }

  const names = (actors: string[]) =>
    actors.length <= 2 ? actors.map(displayName).join("、") : `${actors.slice(0, 2).map(displayName).join("、")} ほか${actors.length - 2}人`;

  /** 対象の投稿を開く。手元になければ読んでから。 */
  async function openTarget() {
    notifications.markRead(group.events.map((event) => event.id));
    let note = target;
    if (!note && group.target) {
      opening = true;
      failed = false;
      note = (await fetchTarget(group.target, me)) ?? undefined;
      opening = false;
    }
    if (note?.kind === 7) {
      const ref = reactedTo(note);
      const post = ref ? notes.get(ref.id) ?? (await fetchTarget(ref.id, ref.author ?? me)) : null;
      if (post) navigate(threadHref(post.id, post.pubkey));
      else failed = true;
      return;
    }
    if (note) navigate(threadHref(note.id, note.pubkey));
    else failed = true;
  }
</script>

{#snippet head(icon: "reply" | "formatQuote" | null, text: string | null)}
  <div class="label">
    <span class="dot" class:unread></span>
    {#if icon}<Icon name={icon} size={14} />{/if}
    <span class="text">{[text, group.kind === "actions" || group.kind === "action" ? postTime(group.time, settings.timeDisplay, clock.now) : null].filter(Boolean).join(" · ")}</span>
    {#if zapCount > 1 && totalSats > 0}<span class="zap-total">合計 {formatSats(totalSats)}</span>{/if}
  </div>
{/snippet}

{#snippet line(item: ActionLine)}
  <div class="line">
    <span class="mark">
      {#if item.type === "zap"}<span class="zap"><Icon name="bolt" size={20} label="zap" /></span>
      {:else if item.type === "reposts"}<Icon name="repeat" size={20} label="リポスト" />
      {:else if item.emoji}<img class="emoji" src={item.emoji} alt={item.content} title={item.content} referrerpolicy="no-referrer" />
      {:else if item.content === "+"}<Icon name="favoriteBorder" size={20} label="いいね" />
      {:else}<span class="reaction">{item.content}</span>{/if}
    </span>
    {#if item.type === "zap"}
      <div class="who">
        <a class="actor" href={profileHref(item.receipt.sender)}><Avatar pubkey={item.receipt.sender} size={24} /><span>{displayName(item.receipt.sender)}</span></a>
        <span class="sats">{formatSats(sats(item.receipt.msats))}</span>
        {#if item.receipt.message}<div class="message">{item.receipt.message}</div>{/if}
      </div>
    {:else}
      <div class="who">
        <span class="avatars">
          {#each item.actors.slice(0, 6) as pubkey (pubkey)}<a href={profileHref(pubkey)} aria-label={displayName(pubkey)}><Avatar {pubkey} size={24} /></a>{/each}
        </span>
        <span class="names">{names(item.actors)}</span>
      </div>
    {/if}
  </div>
{/snippet}

<!-- 反応のまとめのカードは、どこを押しても対象の投稿を開く（Android 版の「対象の投稿を開く」）。返信・引用は中の投稿カードが開く -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="card" class:tappable={group.kind !== "reply" && group.kind !== "quote" && !!group.target} bind:this={element} data-unread={unread}
  onclick={(event) => { if (group.kind !== "reply" && group.kind !== "quote" && group.target && plainTap(event)) void openTarget(); }}>
  {#if group.kind === "reply" || group.kind === "quote"}
    {@render head(group.kind === "quote" ? "formatQuote" : "reply", label)}
    <NoteCard note={group.events[0]} />
  {:else}
    {@render head(null, label)}
    {#each shownLines as item, i (i)}{@render line(item)}{/each}
    {#if lines.length > VISIBLE_LINES}
      <button type="button" class="more" onclick={() => (expanded = !expanded)}>{expanded ? "折りたたむ" : `ほか${lines.length - VISIBLE_LINES}件を表示`}</button>
    {/if}
    {#if target?.kind === 7}
      <button type="button" class="summary" onclick={openTarget}>
        <span class="chip">{#if target.content.trim() === "+" || !target.content.trim()}<Icon name="favoriteBorder" size={14} />{:else}{target.content}{/if}</span>
        <span class="body">{reactedPost ? summary(reactedPost) : "リアクションした投稿は未取得です"}</span>
      </button>
    {:else if target && group.kind === "action"}
      <button type="button" class="summary" onclick={openTarget}><span class="body">{summary(target)}</span></button>
    {:else if target}
      <NoteCard note={target} />
    {:else if group.target}
      <button type="button" class="summary" onclick={openTarget} disabled={opening}>
        <span class="body">{opening ? "対象の投稿を取得しています…" : failed ? "対象の投稿を取得できませんでした。押すと再試行します。" : `対象の投稿は未取得です · ${group.target.slice(0, 10)}…`}</span>
      </button>
    {/if}
    <div class="spacer" title={fullTime(group.time)}></div>
  {/if}
</div>

<style>
  .card {
    border-bottom: 1px solid var(--outline-variant);
    padding-top: 6px;
  }
  .card :global(article) {
    border-bottom: none;
  }
  .label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px 0;
    color: var(--muted);
    font-size: 0.8em;
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: none;
  }
  .dot.unread {
    background: var(--primary);
  }
  .zap-total,
  .sats,
  .zap {
    color: #e8a317;
    font-weight: 600;
  }
  .line {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 4px 16px;
  }
  .mark {
    flex: none;
    width: 44px;
    height: 24px;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .reaction {
    font-size: 1.2em;
    line-height: 1;
    max-width: 44px;
    overflow: hidden;
    white-space: nowrap;
  }
  .emoji {
    height: 22px;
    max-width: 44px;
    object-fit: contain;
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
  }
  .actor {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
  }
  .avatars {
    display: inline-flex;
  }
  .avatars a + a {
    margin-left: -6px;
  }
  .names {
    color: var(--muted);
    font-size: 0.9em;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message {
    flex-basis: 100%;
    font-size: 0.9em;
  }
  .more {
    margin-left: 72px;
    font: inherit;
    font-size: 0.85em;
    color: var(--primary);
    background: none;
    border: none;
    padding: 4px 0;
    cursor: pointer;
  }
  .summary {
    display: flex;
    gap: 6px;
    width: calc(100% - 72px);
    margin: 2px 16px 8px 72px;
    padding: 0;
    font: inherit;
    font-size: 0.85em;
    text-align: left;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .summary .body {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    color: var(--text);
  }
  .spacer {
    height: 4px;
  }
  .card.tappable {
    cursor: pointer;
  }
</style>
