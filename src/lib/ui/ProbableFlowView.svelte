<script lang="ts">
  import { tick, untrack } from "svelte";
  import { BREADTHS, WINDOW } from "../domain/probableFlow";
  import type { Event } from "../nostr/events";
  import { requestNote } from "../store/cache.svelte";
  import { home } from "../store/home.svelte";
  import { ProbableFlow, talkEvents } from "../store/topics.svelte";
  import { viewer } from "../store/viewer.svelte";
  import NoteCard from "./NoteCard.svelte";

  /**
   * たぶんこの流れ（Android 版の ProbableFlowPanel）。選んだ投稿と同じ話題らしい前後の投稿を古い順に。選んだ投稿に
   * 印、ほかの投稿にはつながった理由の言葉。推定なので外れることがある。
   */
  let { id, author, scope }: { id: string; author?: string; scope: "following" | "global" } = $props();

  let seed = $state<Event | null>(null);
  let missing = $state(false);
  let flow = $state<ProbableFlow | null>(null);
  let list = $state<HTMLElement>();

  $effect(() => {
    const [key, by] = [id, author];
    untrack(() => {
      seed = null;
      missing = false;
      void requestNote(key, [], by).then((event) => {
        if (key !== id) return;
        if (event) seed = event;
        else missing = true;
      });
    });
  });

  $effect(() => {
    const [event, chosen] = [seed, scope];
    if (!event || !viewer.ready) return;
    untrack(() => {
      const current = new ProbableFlow(event, chosen, talkEvents(chosen === "global" ? home.global : home.following));
      flow = current;
      void current.load().then(async () => {
        await tick();
        list?.querySelector("[data-seed]")?.scrollIntoView({ block: "center" });
      });
    });
  });
</script>

<section class="flow">
  {#if missing}
    <p class="note">投稿が見つかりませんでした</p>
  {:else if flow}
    <p class="note">推定です。関係ない投稿が混じることがあります（{scope === "global" ? "グローバル" : "フォロー中"}の前後 {WINDOW / 60} 分から）</p>
    <div class="breadth" role="radiogroup" aria-label="拾う範囲">
      {#each BREADTHS as option (option.value)}
        <button type="button" role="radio" aria-checked={flow.breadth === option.value} class:on={flow.breadth === option.value} onclick={() => (flow!.breadth = option.value)}>{option.label}</button>
      {/each}
    </div>
    <p class="note">{flow.loading ? `前後の投稿を読んでいます…（${flow.flow.length} 件）` : `${flow.flow.length} 件`}</p>
    {#if flow.message}<p class="note">{flow.message}</p>{/if}
    <div bind:this={list}>
      {#each flow.flow as linked (linked.event.id)}
        <div class="item" class:seed={linked.seed} data-seed={linked.seed ? "" : undefined}>
          {#if linked.words.length > 0}<p class="why">共通の言葉: {linked.words.join("・")}</p>{/if}
          <NoteCard note={linked.event} />
        </div>
      {/each}
    </div>
    {#if !flow.loading && flow.flow.length <= 1}<p class="note">つながりのありそうな投稿は見つかりませんでした。「広く」にすると増えることがあります。</p>{/if}
  {:else}
    <p class="note">読み込んでいます…</p>
  {/if}
</section>

<style>
  .note {
    margin: 0;
    padding: 8px 16px 0;
    font-size: 0.85em;
    color: var(--muted);
  }
  .breadth {
    display: flex;
    margin: 8px 16px 0;
    border: 1px solid var(--outline-variant);
    border-radius: 999px;
    overflow: hidden;
  }
  .breadth button {
    flex: 1;
    padding: 6px;
    font: inherit;
    font-size: 0.85em;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .breadth button + button {
    border-left: 1px solid var(--outline-variant);
  }
  .breadth button.on {
    font-weight: 600;
    background: var(--primary-container);
  }
  .flow > div {
    margin-top: 8px;
    border-top: 1px solid var(--outline-variant);
  }
  .item.seed {
    background: var(--secondary-container, var(--primary-container));
  }
  .why {
    margin: 0;
    padding: 6px 16px 0;
    font-size: 0.75em;
    color: var(--primary);
  }
</style>
