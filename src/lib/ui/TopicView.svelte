<script lang="ts">
  import { matching } from "../domain/topics";
  import { home } from "../store/home.svelte";
  import { talkEvents } from "../store/topics.svelte";
  import NoteCard from "./NoteCard.svelte";

  /** いまの話題の言葉を含む投稿（Android 版の TopicPanel）。ホームの一覧から、その時間の分を古い順に。 */
  let { word, since, until, tab }: { word: string; since: number; until: number; tab: "following" | "global" } = $props();

  const events = $derived(matching(talkEvents(tab === "global" ? home.global : home.following), word, since, until));
  const clock = (time: number) => new Date(time * 1000).toLocaleTimeString("ja-JP", { hour: "numeric", minute: "2-digit" });
</script>

<section class="topic">
  <p class="head">「{word}」を含む投稿（{clock(since)}〜{clock(until)}、{tab === "global" ? "グローバル" : "フォロー中"}）</p>
  {#each events as event (event.id)}
    <div class="item"><NoteCard note={event} /></div>
  {:else}
    <p class="head">この時間の投稿は見つかりませんでした</p>
  {/each}
</section>

<style>
  .head {
    margin: 0;
    padding: 10px 16px;
    font-size: 0.85em;
    color: var(--muted);
    border-bottom: 1px solid var(--outline-variant);
  }
</style>
