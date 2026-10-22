<script lang="ts">
  import { onMount } from "svelte";
  import { EMOJI_GROUPS, groupEmojis, searchEmojis, withRecent, type EmojiEntry } from "../domain/emojiData";

  /**
   * すべての Unicode 絵文字から選ぶ（Android 版の androidx EmojiPickerView）。名前で探す・種類で分ける・最近使ったもの。
   * 絵文字のデータ（emojibase-data の日本語版）は、初めて開いたときに読む。
   */
  let { pick, selected = null }: { pick: (emoji: string) => void; selected?: string | null } = $props();

  const RECENT_KEY = "recent-emoji";
  let entries = $state<EmojiEntry[] | null>(null);
  let failed = $state(false);
  let query = $state("");
  let group = $state<number | "recent">("recent");
  let recent = $state<string[]>(readRecent());

  function readRecent(): string[] {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
      return Array.isArray(saved) ? saved.filter((e): e is string => typeof e === "string").slice(0, 24) : [];
    } catch {
      return [];
    }
  }

  onMount(() => {
    import("emojibase-data/ja/compact.json").then(
      (module) => {
        entries = (module.default as EmojiEntry[]).filter((e) => e.group !== undefined && e.group !== 2);
        if (recent.length === 0) group = 0;
      },
      () => (failed = true),
    );
  });

  const groups = $derived(entries ? groupEmojis(entries) : null);
  const labels = $derived(new Map((entries ?? []).map((e) => [e.unicode, e.label])));
  const shown = $derived.by((): { unicode: string; label: string }[] => {
    if (!entries || !groups) return [];
    if (query.trim()) return searchEmojis(entries, query);
    if (group === "recent") return recent.map((unicode) => ({ unicode, label: labels.get(unicode) ?? unicode }));
    return groups.get(group) ?? [];
  });

  function choose(emoji: string) {
    recent = withRecent(recent, emoji);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      // 覚えられなくても選べる
    }
    pick(emoji);
  }
</script>

<div class="unicode-picker">
  <input class="search" bind:value={query} placeholder="絵文字を名前で探す（例: うさぎ）" aria-label="絵文字を名前で探す" />
  {#if !query.trim()}
    <div class="groups" role="tablist" aria-label="絵文字の種類">
      <button type="button" role="tab" aria-selected={group === "recent"} class:active={group === "recent"} onclick={() => (group = "recent")}>最近</button>
      {#each EMOJI_GROUPS as item (item.id)}
        <button type="button" role="tab" aria-selected={group === item.id} class:active={group === item.id} onclick={() => (group = item.id)}>{item.label}</button>
      {/each}
    </div>
  {/if}
  <div class="grid-wrap">
    {#if failed}
      <p class="note">絵文字の一覧を読み込めませんでした</p>
    {:else if !entries}
      <p class="note">読み込んでいます…</p>
    {:else if shown.length === 0}
      <p class="note">{query.trim() ? "見つかりませんでした" : group === "recent" ? "まだ使った絵文字はありません" : ""}</p>
    {:else}
      <div class="grid">
        {#each shown as item (item.unicode)}
          <button type="button" class:selected={selected === item.unicode} title={item.label} aria-label={item.label} onclick={() => choose(item.unicode)}>{item.unicode}</button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .unicode-picker {
    display: grid;
    gap: 6px;
  }
  .search {
    font: inherit;
    font-size: 0.9em;
    padding: 6px 10px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
  }
  .groups {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: thin;
  }
  .groups button {
    flex: none;
    font: inherit;
    font-size: 0.75em;
    padding: 3px 9px;
    color: var(--muted);
    background: none;
    border: 1px solid var(--outline-variant);
    border-radius: 999px;
    cursor: pointer;
  }
  .groups button.active {
    color: var(--text);
    font-weight: 600;
    background: var(--secondary-container);
    border-color: transparent;
  }
  .grid-wrap {
    height: 240px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
    gap: 2px;
  }
  .grid button {
    display: grid;
    place-items: center;
    height: 36px;
    font-size: 1.35rem;
    line-height: 1;
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
  }
  .grid button:hover {
    background: var(--surface-low);
  }
  .grid button.selected {
    border-color: var(--primary);
    background: var(--secondary-container);
  }
  .note {
    margin: 8px 0;
    color: var(--muted);
    font-size: 0.85em;
  }
</style>
