<script lang="ts">
  import { untrack } from "svelte";
  import { tallyPoll, type Poll } from "../domain/extraEvents";
  import type { Event } from "../nostr/events";
  import { summary } from "../store/publishSummary";
  import { viewer } from "../store/viewer.svelte";
  import { loadPollResponses, vote } from "../store/writing";

  /**
   * 投票（NIP-88、Android 版の PollView）。答えを読み、選択肢ごとの数を出す。締め切り前で署名できるなら投票できる
   * （選び直して送ると、新しい答えで数え直す）。
   */
  let { poll }: { poll: Poll } = $props();

  let responses = $state<Event[]>([]);
  let loaded = $state(false);
  let chosen = $state(new Set<string>());
  let sending = $state(false);
  let message = $state<string | null>(null);

  const tally = $derived(tallyPoll(poll, responses, viewer.pubkey));
  const closed = $derived(poll.endsAt !== undefined && Date.now() / 1000 >= poll.endsAt);
  const total = $derived(Math.max(1, [...tally.votes.values()].reduce((a, b) => a + b, 0)));

  $effect(() => {
    const current = poll;
    untrack(() => {
      void loadPollResponses(current).then((events) => {
        responses = events;
        loaded = true;
        chosen = new Set(tallyPoll(current, events, viewer.pubkey).mine);
      });
    });
  });

  function pick(id: string) {
    if (closed) return;
    const next = new Set(poll.multiple ? chosen : []);
    if (chosen.has(id) && poll.multiple) next.delete(id);
    else next.add(id);
    chosen = next;
  }

  async function send() {
    sending = true;
    message = "送っています…";
    try {
      const { event, result } = await vote(poll, chosen);
      message = summary(result);
      if (result.accepted > 0) responses = [...responses, event];
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      sending = false;
    }
  }
</script>

<div class="poll" role="group" aria-label="投票">
  {#each poll.options as [id, label] (id)}
    {@const count = tally.votes.get(id) ?? 0}
    <button type="button" class="option" class:chosen={chosen.has(id)} class:mine={tally.mine.has(id)} disabled={closed || !viewer.canSign} onclick={() => pick(id)} aria-pressed={chosen.has(id)}>
      <span class="bar" style:width="{loaded ? (count / total) * 100 : 0}%"></span>
      <span class="mark">{poll.multiple ? (chosen.has(id) ? "☑" : "☐") : chosen.has(id) ? "◉" : "○"}</span>
      <span class="label">{label}</span>
      {#if loaded}<span class="count">{count}</span>{/if}
    </button>
  {/each}
  <div class="foot">
    <small>{loaded ? `${tally.voters}人が投票` : "読み込んでいます…"}{poll.multiple ? "・複数選択" : ""}{poll.endsAt ? `・${closed ? "締め切りました" : `締め切り ${new Date(poll.endsAt * 1000).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}` : ""}</small>
    {#if viewer.canSign && !closed}
      <button type="button" class="send" disabled={sending || chosen.size === 0} onclick={send}>{tally.mine.size > 0 ? "投票し直す" : "投票する"}</button>
    {/if}
  </div>
  {#if message}<small class="message">{message}</small>{/if}
</div>

<style>
  .poll {
    display: grid;
    gap: 6px;
    margin-top: 8px;
  }
  .option {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    overflow: hidden;
    font: inherit;
    text-align: left;
    color: var(--text);
    background: var(--surface-low);
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    cursor: pointer;
  }
  .option:disabled {
    cursor: default;
  }
  .option.chosen {
    border-color: var(--primary);
  }
  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--secondary-container);
    transition: width 0.3s;
  }
  .mark,
  .label,
  .count {
    position: relative;
  }
  .mark {
    color: var(--primary);
  }
  .label {
    flex: 1;
  }
  .option.mine .label {
    font-weight: 600;
  }
  .count {
    font-size: 0.85em;
    color: var(--muted);
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .foot small,
  .message {
    color: var(--muted);
    font-size: 0.8em;
  }
  .send {
    padding: 4px 14px;
    font: inherit;
    font-size: 0.85em;
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .send:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
