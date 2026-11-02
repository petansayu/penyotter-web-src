<script lang="ts">
  import { calendarWeeks, countByDay, dayKey, level, WEEKS } from "../domain/calendar";
  import { fetchFromAuthor } from "../nostr/outbox";
  import { eventsOf } from "../nostr/pool";
  import { atHref } from "../router.svelte";
  import { displayName } from "../store/cache.svelte";
  import { HOME_KINDS } from "../store/feed.svelte";
  import { viewer } from "../store/viewer.svelte";
  import { useNavigate } from "./navigation";

  /**
   * 投稿カレンダー（Android 版の PostCalendarDialog）。直近 12 週の、日ごとの投稿の数を濃さで出す。日を押すと、その日の
   * 0 時からの「この人だけ」の前後の投稿を開く。
   */
  let { pubkey, close }: { pubkey: string; close: () => void } = $props();

  const navigate = useNavigate();
  const weeks = calendarWeeks(new Date(), WEEKS);
  const since = weeks[0][0]!;
  let counts = $state<Map<string, number> | null>(null);
  /** 数えた最初の時刻。投稿が多くて読みきれなかったときは、それより前の日を「未取得」にする。 */
  let countedFrom = $state<number | null>(null);
  let dialog = $state<HTMLDialogElement>();

  $effect(() => {
    dialog?.showModal();
  });

  /** 投稿をさかのぼって読み、日ごとに数える（3,000 件まで）。 */
  $effect(() => {
    const key = pubkey;
    void (async () => {
      const times: number[] = [];
      const seen = new Set<string>();
      let until: number | undefined;
      for (let page = 0; page < 6; page++) {
        const fetched = await fetchFromAuthor(key, [{ kinds: [...HOME_KINDS, 1111, 6, 16], authors: [key], since, limit: 500, ...(until !== undefined ? { until } : {}) }], viewer.readRelays);
        const events = eventsOf(fetched).filter((e) => e.pubkey === key && !seen.has(e.id));
        for (const event of events) {
          seen.add(event.id);
          times.push(event.created_at);
        }
        if (key !== pubkey) return;
        counts = countByDay(times);
        if (events.length === 0) return;
        until = Math.min(...events.map((e) => e.created_at)) - 1;
        if (until < since) return;
      }
      countedFrom = Math.min(...times);
    })();
  });

  const total = $derived(counts ? [...counts.values()].reduce((a, b) => a + b, 0) : 0);
  const dayLabel = (time: number) => new Date(time * 1000).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
  /** 月の名前は、その月の 1 日を含む週（と最初の週）の上にだけ出す。 */
  const monthOf = (week: (number | null)[], index: number) => {
    const first = week.find((d) => d !== null && new Date(d * 1000).getDate() === 1) ?? (index === 0 ? week.find((d) => d !== null) : undefined);
    return first ? `${new Date(first * 1000).getMonth() + 1}月` : "";
  };

  function open(time: number) {
    dialog?.close();
    navigate(atHref(time, "author", pubkey));
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} onclose={close} aria-label="投稿カレンダー" data-testid="post-calendar"
  onclick={(event) => { event.stopPropagation(); if (event.target === dialog) dialog?.close(); }} onkeydown={(event) => event.stopPropagation()}>
  <h3>{displayName(pubkey)} の投稿カレンダー</h3>
  <p class="muted">{counts === null ? "読み込んでいます…" : `直近 ${WEEKS} 週で ${total.toLocaleString()} 件${countedFrom !== null ? `（投稿が多いため、${new Date(countedFrom * 1000).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}から数えています）` : ""}`}。日を押すと、その日のタイムラインを開きます。</p>
  <div class="grid">
    <div class="days">{#each ["日", "月", "火", "水", "木", "金", "土"] as d, i (i)}<span>{i % 2 === 1 ? d : ""}</span>{/each}</div>
    {#each weeks as week, w (w)}
      <div class="week">
        <span class="month">{monthOf(week, w)}</span>
        {#each week as day, d (d)}
          {#if day === null}<span class="cell empty"></span>
          {:else}
            {@const count = counts?.get(dayKey(day)) ?? 0}
            {@const counted = countedFrom === null || dayKey(day) >= dayKey(countedFrom)}
            <button type="button" class="cell level{level(count)}" class:uncounted={!counted} title="{dayLabel(day)} {counted ? `${count}件` : '未取得'}" aria-label="{dayLabel(day)} {counted ? `${count}件` : '未取得'}" onclick={() => open(day)}></button>
          {/if}
        {/each}
      </div>
    {/each}
  </div>
  <div class="legend"><span>少</span>{#each [0, 1, 2, 3, 4] as l (l)}<span class="cell level{l}"></span>{/each}<span>多</span></div>
  <div class="actions"><button type="button" onclick={() => dialog?.close()}>閉じる</button></div>
</dialog>

<style>
  dialog {
    width: min(94vw, 520px);
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h3 {
    margin: 0 0 4px;
  }
  .muted {
    margin: 0 0 12px;
    color: var(--muted);
    font-size: 0.85em;
  }
  .grid {
    display: flex;
    gap: 3px;
    overflow-x: auto;
  }
  .days,
  .week {
    display: grid;
    grid-template-rows: 14px repeat(7, 1fr);
    gap: 3px;
  }
  .days span {
    font-size: 0.7em;
    color: var(--muted);
    line-height: 1;
  }
  .days span:first-child {
    visibility: hidden;
  }
  .month {
    font-size: 0.7em;
    color: var(--muted);
    white-space: nowrap;
    line-height: 1;
  }
  .cell {
    display: block;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 4px;
  }
  button.cell {
    cursor: pointer;
  }
  .cell.empty {
    background: none;
  }
  .level0 {
    background: color-mix(in srgb, var(--outline-variant) 60%, transparent);
  }
  .cell.uncounted {
    background: none;
    outline: 1px dashed var(--outline-variant);
    outline-offset: -1px;
  }
  .level1 {
    background: color-mix(in srgb, var(--primary) 25%, transparent);
  }
  .level2 {
    background: color-mix(in srgb, var(--primary) 45%, transparent);
  }
  .level3 {
    background: color-mix(in srgb, var(--primary) 70%, transparent);
  }
  .level4 {
    background: var(--primary);
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 0.75em;
  }
  .legend .cell {
    width: 12px;
    height: 12px;
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
