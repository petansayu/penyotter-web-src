<script lang="ts">
  import { summarize } from "../domain/topics";
  import { profileHref, threadHref, topicHref } from "../router.svelte";
  import { displayName } from "../store/cache.svelte";
  import { home } from "../store/home.svelte";
  import { flowSummary, talkEvents } from "../store/topics.svelte";
  import Avatar from "./Avatar.svelte";
  import { useNavigate } from "./navigation";

  /**
   * 直前の流れ（Android 版の FlowSummarySheet）。話している人・話題の言葉・言葉の多い投稿・勢いを、ホームの一覧から
   * 並べる。文章にはしない（AI のサービスに投稿を送ることになるので）。
   */
  const navigate = useNavigate();
  const WINDOWS: [number, string][] = [[15 * 60, "15分"], [30 * 60, "30分"], [60 * 60, "1時間"]];
  let choice = $state(0);
  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    if (flowSummary.open) dialog?.showModal();
  });

  const [windowSeconds, label] = $derived(WINDOWS[choice]);
  const feed = $derived(flowSummary.tab === "global" ? home.global : home.following);
  const summary = $derived(flowSummary.open ? summarize(talkEvents(feed), Math.floor(Date.now() / 1000), windowSeconds) : null);
  const clock = (time: number) => new Date(time * 1000).toLocaleTimeString("ja-JP", { hour: "numeric", minute: "2-digit" });

  function go(href: string) {
    dialog?.close();
    navigate(href);
  }
  function topic(word: string) {
    const at = Math.floor(Date.now() / 1000);
    go(topicHref(word, at - windowSeconds, at, flowSummary.tab));
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} onclose={() => (flowSummary.open = false)} aria-label="直前の流れ" data-testid="flow-summary"
  onclick={(event) => { event.stopPropagation(); if (event.target === dialog) dialog?.close(); }} onkeydown={(event) => event.stopPropagation()}>
  <h3>直前の流れ（{flowSummary.tab === "global" ? "グローバル" : "フォロー中"}）</h3>
  <div class="windows">
    {#each WINDOWS as [, text], i (i)}<button type="button" class:on={i === choice} onclick={() => (choice = i)}>{text}</button>{/each}
  </div>
  {#if summary}
    {#if summary.count === 0}
      <p class="muted">この{label}の投稿はありません</p>
    {:else}
      <p>この{label}で {summary.count} 件（その前の{label}は {summary.before} 件）</p>
      <h4>話している人</h4>
      <div class="people">
        {#each summary.people.slice(0, 16) as [pubkey, count] (pubkey)}
          <button type="button" class="person" onclick={() => go(profileHref(pubkey))}><Avatar {pubkey} size={22} /><span>{displayName(pubkey)}</span> {count}</button>
        {/each}
      </div>
      <h4>話題の言葉</h4>
      {#if summary.topics.length === 0}
        <p class="muted">2人以上が使った言葉はありません</p>
      {:else}
        <div class="chips">
          {#each summary.topics as t (t.word)}<button type="button" class="chip" onclick={() => topic(t.word)}>{t.word}<small>{t.people}人</small></button>{/each}
        </div>
      {/if}
      {#if summary.highlights.length > 0}
        <h4>話題の言葉が多い投稿</h4>
        {#each summary.highlights as event (event.id)}
          <button type="button" class="post" onclick={() => go(threadHref(event.id, event.pubkey))}>
            <Avatar pubkey={event.pubkey} size={28} />
            <span><strong>{displayName(event.pubkey)}・{clock(event.created_at)}</strong><span class="text">{event.content}</span></span>
          </button>
        {/each}
      {/if}
    {/if}
  {/if}
  <div class="actions"><button type="button" onclick={() => dialog?.close()}>閉じる</button></div>
</dialog>

<style>
  dialog {
    width: min(94vw, 520px);
    max-height: 86vh;
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h3 {
    margin: 0 0 8px;
  }
  h4 {
    margin: 14px 0 6px;
    font-size: 0.85em;
  }
  p {
    margin: 8px 0 0;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85em;
  }
  .windows {
    display: flex;
    gap: 6px;
  }
  .windows button,
  .chip {
    padding: 4px 12px;
    font: inherit;
    font-size: 0.85em;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    cursor: pointer;
  }
  .windows button.on {
    color: var(--text);
    background: var(--primary-container);
  }
  .chip small {
    margin-left: 6px;
    color: var(--muted);
  }
  .people,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
  }
  .person {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    font: inherit;
    font-size: 0.8em;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .person span {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .post {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 6px 0;
    font: inherit;
    text-align: left;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .post strong {
    display: block;
    font-size: 0.8em;
  }
  .post .text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    font-size: 0.9em;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 8px;
  }
  .actions button {
    padding: 6px 14px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: none;
    cursor: pointer;
  }
</style>
