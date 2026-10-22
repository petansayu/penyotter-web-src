<script lang="ts">
  import { useNavigate } from "./navigation";
  import { untrack } from "svelte";
  import { nip05 } from "nostr-tools";
  import { activeFilters, NO_FILTERS, parseQuery, type SearchFilters, type SearchQuery } from "../domain/search";
  import { fetchFromAuthor } from "../nostr/outbox";
  import { eventsOf } from "../nostr/pool";
  import { profileHref, searchHref, threadHref } from "../router.svelte";
  import { displayName, keepNotes, profiles } from "../store/cache.svelte";
  import { Search, searchRelays } from "../store/search.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import NoteCard from "./NoteCard.svelte";
  import SearchFiltersForm from "./SearchFiltersForm.svelte";

  /** 検索の画面。npub・note・NIP-05 などの識別子は、その画面へ移る。文字と #タグは結果を出す。 */
  /** onsearch があれば、検索語が変わったとき URL を変えずにそれを呼ぶ（カラム表示の検索の列）。 */
  let { q, onsearch }: { q: string; onsearch?: (q: string) => void } = $props();
  const navigate = useNavigate();

  let input = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let tab = $state<"posts" | "people">("posts");
  let search = $state<Search>();
  /** 同じ検索語で「検索」を押したときに探し直すための数。 */
  let runs = $state(0);
  /** 当てている絞り込み。 */
  let filters = $state<SearchFilters>(NO_FILTERS);
  let filtersOpen = $state(false);
  const filterCount = $derived(activeFilters(filters));

  // 検索語が変わったら（URL の q）探し直す
  $effect(() => {
    const value = q;
    void runs;
    const applied = filters;
    untrack(() => {
      input = value;
      error = null;
      search = undefined;
      if (!value) {
        // 検索語なしでも、絞り込みだけで探せる
        if (activeFilters(applied) === 0) return;
        const current = new Search({ type: "filtered" }, applied);
        search = current;
        tab = "posts";
        void current.start();
        return;
      }
      let query: SearchQuery;
      try {
        query = parseQuery(value);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        return;
      }
      if (query.type !== "text" && query.type !== "tag") return void open(query);
      const current = new Search(query, applied);
      search = current;
      tab = "posts";
      void current.start();
    });
  });

  /** 識別子の検索は、その画面を開く。 */
  async function open(query: SearchQuery) {
    busy = true;
    try {
      switch (query.type) {
        case "author":
          navigate(profileHref(query.pubkey, query.relays), { replace: true });
          return;
        case "event":
          navigate(threadHref(query.id, query.author, query.relays), { replace: true });
          return;
        case "nip05": {
          const profile = await nip05.queryProfile(query.value).catch(() => null);
          if (profile) navigate(profileHref(profile.pubkey, profile.relays ?? []), { replace: true });
          else error = "NIP-05 から公開鍵を見つけられませんでした。";
          return;
        }
        case "address": {
          const fetched = await fetchFromAuthor(query.pubkey, [{ kinds: [query.kind], authors: [query.pubkey], "#d": [query.identifier] }], viewer.readRelays, query.relays);
          const found = eventsOf(fetched).sort((a, b) => b.created_at - a.created_at)[0];
          if (found) {
            keepNotes([found]);
            navigate(threadHref(found.id, found.pubkey), { replace: true });
          } else error = "その記事・イベントを見つけられませんでした。";
          return;
        }
      }
    } finally {
      busy = false;
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value && filterCount === 0) return;
    // 同じ検索語でもう一度押したら探し直す
    if (value === q) runs++;
    else if (onsearch) onsearch(value);
    else location.hash = searchHref(value);
  }

  const stateLabel: Record<string, string> = { waiting: "待機中", loading: "読み込み中", done: "完了", partial: "一部", failed: "応答なし", skipped: "使わない" };
  const hasSearchRelays = $derived(searchRelays(viewer.pubkey).length > 0);
</script>

<form class="bar" onsubmit={submit} role="search">
  <Icon name="search" size={20} />
  <input bind:value={input} placeholder="キーワード・#タグ・npub・note・NIP-05" enterkeyhint="search" autocomplete="off" spellcheck="false" aria-label="検索語" />
  <button type="button" class="filter-toggle" class:on={filterCount > 0} aria-expanded={filtersOpen} onclick={() => (filtersOpen = !filtersOpen)}>
    絞り込み{filterCount > 0 ? ` ${filterCount}` : ""}
  </button>
  <button type="submit" disabled={busy}>検索</button>
</form>
{#if filtersOpen}
  <SearchFiltersForm value={filters} apply={(next) => { filters = next; filtersOpen = false; runs++; }} />
{/if}

{#if error}<p class="note error" role="alert">{error}</p>{/if}
{#if busy}<p class="note">開いています…</p>{/if}

{#if !search && !error && !busy}
  <div class="help">
    <p>キーワードは NIP-50 に対応した検索リレーで探します{hasSearchRelays ? "" : "（検索リレーが設定されていません。設定の「検索リレー」で足せます）"}。</p>
    <p><code>#タグ</code> はタグで、<code>npub</code>・<code>nprofile</code>・NIP-05 はプロフィール、<code>note</code>・<code>nevent</code>・<code>naddr</code> は投稿を開きます。</p>
    <p>空白で区切ると全部を含むもの、<code>-語</code> はその語を含まないもの、<code>"..."</code> はひとまとまりで探します。</p>
  </div>
{/if}

{#if search}
  <div class="tabs" role="tablist">
    <button type="button" role="tab" aria-selected={tab === "posts"} class:active={tab === "posts"} onclick={() => (tab = "posts")}>投稿 {search.results.length}</button>
    <button type="button" role="tab" aria-selected={tab === "people"} class:active={tab === "people"} onclick={() => (tab = "people")}>ユーザー {search.people.length}</button>
  </div>
  {#if search.statuses.length > 0}
    <ul class="statuses">
      {#each search.statuses as status (status.url)}
        <li class={status.state}>{status.url.replace(/^wss:\/\//, "")}: {stateLabel[status.state]}{status.state === "done" || status.state === "partial" ? ` ${status.count}件` : ""}{status.note ? `（${status.note}）` : ""}</li>
      {/each}
    </ul>
  {/if}
  {#if search.message}<p class="note">{search.message}</p>{/if}

  {#if tab === "posts"}
    {#each search.results as note (note.id)}
      <div class="item"><NoteCard {note} /></div>
    {:else}
      <p class="note">{search.loading ? "探しています…" : "見つかりませんでした"}</p>
    {/each}
    {#if search.results.length > 0 && !search.finished}
      <div class="footer"><button type="button" class="more" onclick={() => search?.more()} disabled={search.loading}>{search.loading ? "探しています…" : "さらに探す"}</button></div>
    {/if}
  {:else}
    {#each search.people as pubkey (pubkey)}
      {@const profile = profiles.get(pubkey)?.profile}
      <a class="person" href={profileHref(pubkey)}>
        <Avatar {pubkey} size={44} />
        <span class="info">
          <strong>{displayName(pubkey)}</strong>
          {#if profile?.nip05}<small>{profile.nip05.replace(/^_@/, "")}</small>{/if}
          {#if profile?.about}<span class="about">{profile.about}</span>{/if}
        </span>
      </a>
    {:else}
      <p class="note">{search.loading ? "探しています…" : "見つかりませんでした"}</p>
    {/each}
  {/if}
{/if}

<style>
  .item {
    content-visibility: auto;
    contain-intrinsic-size: auto 200px;
  }
  /* 絵文字のパレットや「…」のメニューを開いている項目は、はみ出した部分も描く（content-visibility は描く範囲を
     項目の中に限るので、開いたパレットが切り取られて見えなくなっていた） */
  .item:has(:global(.picker), :global(.menu), :global(.mentions)) {
    content-visibility: visible;
  }
  .bar {
    position: sticky;
    top: var(--sticky-top, 52px);
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--background);
    border-bottom: 1px solid var(--outline-variant);
    color: var(--muted);
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 8px 12px;
    border: 1px solid var(--outline);
    border-radius: 999px;
    background: var(--surface-low);
    color: var(--text);
  }
  .bar button {
    flex: none;
    font: inherit;
    font-weight: 600;
    padding: 8px 16px;
    border: none;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    cursor: pointer;
  }
  .bar .filter-toggle {
    font-weight: normal;
    padding: 8px 12px;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
  }
  .bar .filter-toggle.on {
    color: var(--text);
    background: var(--secondary-container);
    border-color: transparent;
  }
  .note {
    color: var(--muted);
    padding: 12px 16px;
    margin: 0;
    font-size: 0.9em;
  }
  .error {
    color: #d33;
  }
  .help {
    padding: 8px 16px;
    color: var(--muted);
    font-size: 0.9em;
    line-height: 1.7;
  }
  code {
    background: var(--surface);
    border-radius: 4px;
    padding: 0 4px;
  }
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--outline-variant);
  }
  .tabs button {
    flex: 1;
    font: inherit;
    padding: 10px;
    color: var(--muted);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
  }
  .tabs button.active {
    color: var(--primary);
    font-weight: 600;
    border-bottom-color: var(--primary);
  }
  .statuses {
    list-style: none;
    margin: 0;
    padding: 6px 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: 0.75em;
    color: var(--muted);
    border-bottom: 1px solid var(--outline-variant);
  }
  .statuses .failed {
    color: #d33;
  }
  .person {
    display: flex;
    gap: 12px;
    padding: 10px 16px;
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px solid var(--outline-variant);
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .info small {
    color: var(--muted);
  }
  .about {
    color: var(--muted);
    font-size: 0.9em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .footer {
    display: flex;
    justify-content: center;
    padding: 16px;
  }
  .more {
    font: inherit;
    color: var(--primary);
    background: var(--primary-container);
    border: none;
    border-radius: 999px;
    padding: 8px 20px;
    cursor: pointer;
  }
</style>
