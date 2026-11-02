<script lang="ts">
  import { untrack } from "svelte";
  import type { Event } from "../nostr/events";
  import { reactionDisplay } from "../domain/emojis";
  import { reactionVisible } from "../domain/hiddenMessages";
  import HiddenMessage from "./HiddenMessage.svelte";
  import { profileHref, relayHref } from "../router.svelte";
  import { displayName } from "../store/cache.svelte";
  import { Thread } from "../store/thread.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import NoteCard from "./NoteCard.svelte";
  import PackEmoji from "./PackEmoji.svelte";
  import MutedNote from "./MutedNote.svelte";
  import { quotesOf } from "../store/conversation.svelte";
  import { isMuted, mutedLabel } from "../store/mutes";
  import { settings } from "../store/settings.svelte";

  /** 投稿の詳細（技術資料 5.4）。返信元・選んだ投稿・返信（字下げ）を並べる。 */
  let { id, relays = [], author }: { id: string; relays?: string[]; author?: string } = $props();

  let thread = $state<Thread>();
  /** この投稿を引用した投稿（null は読み込み中）。 */
  let quotes = $state<Event[] | null>(null);
  let quotesOpen = $state(false);
  let reactionsOpen = $state(false);
  let repostsOpen = $state(false);
  /** 反応を開いたリアクション。 */
  let openNested = $state(new Set<string>());

  /** リアクションの見せ方（文字か画像）。 */
  const label = (event: Event): { text: string; url?: string; hidden?: string } => {
    const shown = reactionDisplay(event);
    const base = shown.type === "like" ? { text: "+" } : shown.type === "image" ? { url: shown.url, text: `:${shown.shortcode}:` } : { text: shown.text };
    return { ...base, hidden: shown.hidden };
  };

  /** リアクションへのリアクションを、絵文字ごとの数に（多い順）。 */
  function countsOf(events: Event[]) {
    const groups = new Map<string, { event: Event; count: number }>();
    for (const event of events) {
      // 隠しメッセージ付きも、見える絵文字でまとめる
      const key = reactionVisible(event.content.trim()) || "+";
      const group = groups.get(key);
      if (group) group.count++;
      else groups.set(key, { event, count: 1 });
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }

  function toggleNested(id: string) {
    const next = new Set(openNested);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    openNested = next;
  }

  $effect(() => {
    const [key, hints, by] = [id, relays, author];
    return untrack(() => {
      const current = new Thread(key, hints, by);
      thread = current;
      quotes = null;
      quotesOpen = false;
      void quotesOf(key, by, hints).then((found) => thread === current && (quotes = found), () => thread === current && (quotes = []));
      reactionsOpen = false;
      repostsOpen = false;
      openNested = new Set();
      void current.load();
      return () => current.stop();
    });
  });

  /** 返信一覧からは、ミュートしている投稿と、それへの返信（字下げで下に続く分）を除く。 */
  const shownReplies = $derived.by(() => {
    const replies = thread?.replies ?? [];
    const result: typeof replies = [];
    let skipBelow: number | null = null;
    for (const reply of replies) {
      if (skipBelow !== null && reply.depth > skipBelow) continue;
      skipBelow = null;
      if (isMuted(reply.event)) skipBelow = reply.depth;
      else result.push(reply);
    }
    return result;
  });
</script>

{#snippet emoji(shown: { text: string; url?: string; hidden?: string }, event: Event)}
  {#if shown.hidden}
    <HiddenMessage visible={shown.text} message={shown.hidden} dialog>{#if shown.url}<img src={shown.url} alt={shown.text} referrerpolicy="no-referrer" />{:else}{shown.text}{/if}</HiddenMessage>
  {:else if shown.url}<PackEmoji shortcode={shown.text.slice(1, -1)} url={shown.url} tags={event.tags} owner={event.pubkey} />{:else}{shown.text}{/if}
{/snippet}

{#if thread}
  {#if thread.ancestors?.truncated}<p class="note">返信元をすべては表示していません</p>{/if}
  {#each thread.ancestors?.ancestors ?? [] as note (note.id)}
    <!-- 返信元の流れのミュートしている投稿は、流れが途切れないよう札にする（設定で「完全に隠す」なら詰める） -->
    {#if !isMuted(note)}<NoteCard {note} />
    {:else if !settings.hideMuted}<div class="muted-ancestor"><MutedNote label={mutedLabel(note)}><NoteCard {note} /></MutedNote></div>{/if}
  {/each}
  {#if thread.selected}
    {#if thread.selected.kind === 30023}
      <!-- 記事の表示（Markdown の変換）は大きいので、記事を開いたときだけ読み込む -->
      {#await import("./ArticleView.svelte")}<p class="note">記事を読み込んでいます…</p>{:then { default: ArticleView }}<ArticleView note={thread.selected} />{/await}
    {:else}<NoteCard note={thread.selected} selected />{/if}
    <div class="meta">
      <span class="relays">{#if thread.relays.length > 0}見つかったリレー: {#each thread.relays as url, i (url)}{i > 0 ? "、" : ""}<a href={relayHref(url)}>{url.replace(/^wss:\/\//, "")}</a>{/each}{/if}</span>
      <button type="button" class="toggle" class:open={reactionsOpen} onclick={() => (reactionsOpen = !reactionsOpen)} aria-expanded={reactionsOpen} aria-label="リアクション {thread.reactions.length}件{thread.interactionsComplete ? "" : "以上"}">
        <Icon name="favoriteBorder" size={16} />{thread.reactions.length}{thread.interactionsComplete ? "" : "+"}
      </button>
      <button type="button" class="toggle" class:open={repostsOpen} onclick={() => (repostsOpen = !repostsOpen)} aria-expanded={repostsOpen} aria-label="リポスト {thread.reposts.length}件{thread.interactionsComplete ? "" : "以上"}">
        <Icon name="repeat" size={16} />{thread.reposts.length}{thread.interactionsComplete ? "" : "+"}
      </button>
    </div>
    {#if reactionsOpen}
      <ul class="who">
        {#each thread.reactions as reaction (reaction.id)}
          {@const shown = label(reaction)}
          {@const nested = thread.reactionReactions.get(reaction.id) ?? []}
          <li>
            <a href={profileHref(reaction.pubkey)}><Avatar pubkey={reaction.pubkey} size={28} /><strong>{displayName(reaction.pubkey)}</strong></a>
            <span class="emoji">{@render emoji(shown, reaction)}</span>
            {#if nested.length > 0}
              <button type="button" class="chips" class:open={openNested.has(reaction.id)} onclick={() => toggleNested(reaction.id)} aria-label={openNested.has(reaction.id) ? "このリアクションへの反応をたたむ" : "このリアクションへの反応を見る"}>
                {#each countsOf(nested).slice(0, 3) as group (group.event.id)}
                  {@const g = label(group.event)}
                  <span>{#if g.url}<img src={g.url} alt={g.text} referrerpolicy="no-referrer" />{:else}{g.text}{/if} {group.count}</span>
                {/each}
                {#if countsOf(nested).length > 3}…{/if}
              </button>
            {/if}
          </li>
          {#if openNested.has(reaction.id)}
            {#each nested as inner (inner.id)}
              {@const g = label(inner)}
              <li class="inner">
                <a href={profileHref(inner.pubkey)}><Avatar pubkey={inner.pubkey} size={22} /><strong>{displayName(inner.pubkey)}</strong></a>
                <span class="emoji">{@render emoji(g, inner)}</span>
              </li>
            {/each}
          {/if}
        {/each}
      </ul>
    {/if}
    {#if repostsOpen}
      <ul class="who">
        {#each thread.reposts as repost (repost.id)}
          <li><a href={profileHref(repost.pubkey)}><Avatar pubkey={repost.pubkey} size={28} /><strong>{displayName(repost.pubkey)}</strong></a><span class="emoji">リポスト</span></li>
        {/each}
      </ul>
    {/if}
  {/if}
  {#if thread.pendingReplies.length > 0}
    <button type="button" class="new-replies" onclick={() => thread?.acknowledgeReplies()}>新しい返信 {thread.pendingReplies.length}件</button>
  {/if}
  {#if thread.message}<p class="note">{thread.message}</p>{/if}
  {#each shownReplies as reply (reply.event.id)}
    <div class="reply" style:padding-left="{Math.min(reply.depth, 6) * 16}px">
      <NoteCard note={reply.event} />
    </div>
  {/each}
  {#if thread.loading}<p class="note">読み込んでいます…</p>{:else if thread.selected && shownReplies.length === 0}<p class="note">返信はまだありません</p>{/if}
  {#if thread.selected && quotes && quotes.length > 0}
    <!-- この投稿を引用した投稿（Android 版と同じ。q タグで指すもの） -->
    <button type="button" class="quotes-toggle" aria-expanded={quotesOpen} onclick={() => (quotesOpen = !quotesOpen)}>
      引用した投稿（{quotes.length}）{quotesOpen ? "▲" : "▼"}
    </button>
    {#if quotesOpen}
      {#each quotes as quote (quote.id)}<div class="quote-item"><NoteCard note={quote} /></div>{/each}
    {/if}
  {/if}
{/if}

<style>
  .quotes-toggle {
    display: block;
    width: 100%;
    padding: 12px 16px;
    font: inherit;
    font-weight: 600;
    text-align: left;
    color: var(--primary);
    background: none;
    border: none;
    border-top: 1px solid var(--outline-variant);
    cursor: pointer;
  }
  .quote-item {
    border-top: 1px solid var(--outline-variant);
  }
  .muted-ancestor {
    padding: 0 16px 8px;
  }
  .note,
  .relays {
    color: var(--muted);
    padding: 8px 16px;
    margin: 0;
    font-size: 0.9em;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-right: 8px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .relays {
    flex: 1;
    min-width: 0;
    font-size: 0.8em;
    overflow-wrap: anywhere;
  }
  .relays a {
    color: inherit;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 4px 8px;
    font: inherit;
    font-size: 0.8em;
    color: var(--muted);
    background: none;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .toggle.open {
    background: var(--secondary-container);
  }
  .who {
    margin: 0;
    padding: 4px 0;
    list-style: none;
    border-bottom: 1px solid var(--outline-variant);
  }
  .who li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 16px;
  }
  .who li.inner {
    padding-left: 52px;
  }
  .who a {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--text);
    text-decoration: none;
    font-size: 0.85em;
  }
  .who strong {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .emoji {
    color: var(--muted);
  }
  .emoji img,
  .emoji :global(.pack-emoji img),
  .chips img {
    height: 1.2em;
    vertical-align: middle;
  }
  .chips {
    display: inline-flex;
    gap: 6px;
    padding: 2px 8px;
    font: inherit;
    font-size: 0.8em;
    color: var(--text);
    background: var(--surface-low);
    border: none;
    border-radius: 12px;
    cursor: pointer;
  }
  .chips.open {
    background: var(--secondary-container);
  }
  .new-replies {
    margin: 6px 12px;
    padding: 6px 12px;
    font: inherit;
    font-size: 0.85em;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
</style>
