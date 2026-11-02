<script lang="ts">
  import { tick, untrack } from "svelte";
  import { profileHref } from "../router.svelte";
  import { Conversation } from "../store/conversation.svelte";
  import { displayName } from "../store/cache.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Avatar from "./Avatar.svelte";
  import NoteCard from "./NoteCard.svelte";
  import { scrollOwner } from "./scroll";

  /** 2 人の会話（Android 版の ConversationPanel）。2 人のあいだの投稿だけを古い順に。上で前を読み足す。 */
  let { a, b }: { a: string; b: string } = $props();

  let conversation = $state<Conversation | null>(null);
  let list = $state<HTMLElement>();

  $effect(() => {
    const [x, y] = [a, b];
    if (!viewer.ready) return;
    untrack(() => {
      const current = new Conversation(x, y);
      conversation = current;
      void current.older().then(async () => {
        await tick();
        // 最初は、いちばん新しいやり取り（下の端）を見せる
        list?.lastElementChild?.scrollIntoView({ block: "end" });
      });
    });
  });

  /** 前を足すと上に増えるので、見ていた位置がずれないように、足した分だけ下げる。 */
  async function older() {
    const current = conversation;
    if (!current) return;
    const before = list?.scrollHeight ?? 0;
    await current.older();
    await tick();
    const added = (list?.scrollHeight ?? 0) - before;
    if (added > 0) (scrollOwner(list) ?? window).scrollBy({ top: added });
  }
</script>

<section class="conversation">
  <h2>
    <a href={profileHref(a)}><Avatar pubkey={a} size={24} />{displayName(a)}</a>
    <span>と</span>
    <a href={profileHref(b)}><Avatar pubkey={b} size={24} />{displayName(b)}</a>
    <span>の会話</span>
  </h2>
  {#if conversation}
    {#if conversation.message}<p class="note">{conversation.message}</p>{/if}
    <button type="button" class="more" disabled={conversation.loading || conversation.done} onclick={older}>
      {conversation.done ? "これより前のやり取りはありません" : conversation.loading ? "読み込んでいます…" : "↑ さらに前を読む"}
    </button>
    <div bind:this={list}>
      {#each conversation.events as event (event.id)}
        <div class="item" class:right={event.pubkey === b}><NoteCard note={event} /></div>
      {/each}
    </div>
    {#if !conversation.loading && conversation.events.length === 0}<p class="note">2 人のあいだのやり取りは見つかりませんでした</p>{/if}
  {/if}
</section>

<style>
  .conversation {
    padding-bottom: 24px;
  }
  h2 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 12px 16px 8px;
    font-size: 1.05rem;
  }
  h2 a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text);
    text-decoration: none;
  }
  h2 span {
    color: var(--muted);
    font-weight: normal;
  }
  .note {
    margin: 8px 16px;
    color: var(--muted);
    font-size: 0.9em;
  }
  .more {
    display: block;
    width: calc(100% - 32px);
    margin: 8px 16px;
    padding: 8px;
    font: inherit;
    color: var(--primary);
    background: var(--surface-low);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .more:disabled {
    color: var(--muted);
    cursor: default;
  }
  .item {
    border-bottom: 1px solid var(--outline-variant);
  }
  /* 相手側（b）の投稿は、左に線を引いて見分けやすくする */
  .item.right {
    box-shadow: inset 4px 0 0 var(--secondary-container);
  }
</style>
