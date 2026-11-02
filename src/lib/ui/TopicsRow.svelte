<script lang="ts">
  import { currentTopics, MIN_PEOPLE, WINDOWS } from "../domain/topics";
  import { topicHref } from "../router.svelte";
  import type { Feed } from "../store/feed.svelte";
  import { flowSummary, talkEvents, topicsUi } from "../store/topics.svelte";
  import Icon from "./Icon.svelte";

  /**
   * いまの話題（Android 版の TopicsRow）。ホームのタブの下に、ふだんより多くの人が使っている言葉を並べる（人数で数える）。
   * 言葉を押すと、その時間のその言葉の投稿。右のボタンで直前の流れ。たたんだか・時間の長さはこのブラウザに覚える。
   */
  let { feed, tab }: { feed: Feed | undefined; tab: "following" | "global" } = $props();

  // 1 分ごとに数え直す（時間の範囲が進むので）
  let now = $state(Math.floor(Date.now() / 1000));
  $effect(() => {
    const timer = setInterval(() => (now = Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(timer);
  });
  const [windowSeconds, windowLabel] = $derived(WINDOWS[topicsUi.window]);
  const topics = $derived(topicsUi.folded ? [] : currentTopics(talkEvents(feed), Math.max(now, Math.floor(Date.now() / 1000)), windowSeconds));

  function fold() {
    topicsUi.folded = !topicsUi.folded;
    topicsUi.save();
  }
  function choose(event: globalThis.Event) {
    topicsUi.window = Number((event.currentTarget as HTMLSelectElement).value);
    topicsUi.save();
  }
  const href = (word: string) => {
    const at = Math.floor(Date.now() / 1000);
    return topicHref(word, at - windowSeconds, at, tab);
  };
</script>

<div class="topics" data-testid="topics-row">
  <button type="button" class="toggle" onclick={fold} aria-expanded={!topicsUi.folded}>
    <span class="arrow" class:folded={topicsUi.folded}><Icon name="expandMore" size={16} /></span>いまの話題
  </button>
  {#if !topicsUi.folded}
    <select aria-label="時間の長さ" value={topicsUi.window} onchange={choose}>
      {#each WINDOWS as [, label], i (i)}<option value={i}>{label}</option>{/each}
    </select>
    <div class="chips">
      {#each topics as topic (topic.word)}
        <a class="chip" href={href(topic.word)} data-testid="topic-chip">{topic.word}<small>{topic.people}人</small></a>
      {:else}
        <span class="none">まだありません（{MIN_PEOPLE}人以上が使った言葉を出します）</span>
      {/each}
    </div>
    <button type="button" class="summary" onclick={() => flowSummary.show(tab)} aria-label="直前の流れ" title="直前の流れ"><Icon name="forum" size={18} /></button>
  {:else}
    <span class="rest"></span>
  {/if}
</div>

<style>
  .topics {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 8px;
    border-bottom: 1px solid var(--outline-variant);
  }
  .toggle {
    display: flex;
    align-items: center;
    flex: none;
    padding: 6px 4px;
    font: inherit;
    font-size: 0.8em;
    font-weight: 600;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .arrow {
    display: flex;
    transition: transform 0.15s;
  }
  .arrow.folded {
    transform: rotate(-90deg);
  }
  select {
    flex: none;
    font: inherit;
    font-size: 0.8em;
    color: var(--primary);
    background: none;
    border: none;
    cursor: pointer;
  }
  .chips {
    display: flex;
    flex: 1;
    gap: 6px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .chip {
    flex: none;
    padding: 4px 10px;
    font-size: 0.8em;
    color: var(--primary);
    text-decoration: none;
    white-space: nowrap;
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
  }
  .chip small {
    margin-left: 6px;
    color: var(--muted);
  }
  .none {
    font-size: 0.75em;
    color: var(--muted);
    white-space: nowrap;
  }
  .rest {
    flex: 1;
  }
  .summary {
    display: flex;
    flex: none;
    padding: 6px;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
</style>
