<script lang="ts" module>
  import { parseListAddress, parseRelayParam, type ColumnType, type DeckColumn as Column } from "../domain/deck";
  import { displayName as nameOf } from "../store/cache.svelte";
  import type { IconName } from "./Icon.svelte";

  /** 列の種類ごとのアイコン（列の見出しと左のメニュー）。 */
  export const COLUMN_ICONS: Record<ColumnType, IconName> = {
    home: "home",
    global: "public",
    notifications: "notificationsNone",
    search: "search",
    profile: "person",
    posts: "article",
    reactions: "favoriteBorder",
    relays: "dns",
    list: "listAlt",
  };

  /** 列の見出し（名前を付けていればその名前）。me は見る人の公開鍵。 */
  export function columnTitle(column: Column, me: string | null): string {
    if (column.name) return column.name;
    const who = (prefix: string, own: string) => (column.param === me ? own : `${prefix}: ${nameOf(column.param ?? "")}`);
    switch (column.type) {
      case "home": return "ホーム";
      case "global": return "グローバル";
      case "notifications": return "通知";
      case "search": return column.param ? `検索: ${column.param}` : "検索";
      case "profile": return column.param === me ? "自分のプロフィール" : nameOf(column.param ?? "");
      case "posts": return who("投稿", "自分の投稿");
      case "reactions": return who("リアクション", "自分のリアクション");
      case "relays": {
        const hosts = parseRelayParam(column.param ?? "").map((url) => new URL(url).host);
        return `リレー: ${hosts[0] ?? ""}${hosts.length > 1 ? ` ほか ${hosts.length - 1}` : ""}`;
      }
      case "list": return `リスト: ${parseListAddress(column.param)?.identifier ?? ""}`;
    }
  }
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { COLUMN_WIDTHS, FILTERABLE, passesFilter, WIDTH_LABELS, type ColumnFilter, type ColumnWidth, type DeckColumn } from "../domain/deck";
  import type { Card } from "../store/feed.svelte";
  import { parseRoute, type Route } from "../router.svelte";
  import { displayName } from "../store/cache.svelte";
  import ColumnFeed from "./ColumnFeed.svelte";
  import { deck } from "../store/deck.svelte";
  import { viewer } from "../store/viewer.svelte";
  import HomeFeed from "./HomeFeed.svelte";
  import Icon from "./Icon.svelte";
  import { provideNavigator } from "./navigation";
  import NotificationsPanel from "./NotificationsPanel.svelte";
  import Profile from "./Profile.svelte";
  import RouteView from "./RouteView.svelte";
  import SearchPanel from "./SearchPanel.svelte";

  /**
   * カラム表示の列 1 つ。見出し（押すと一番上へ、「…」で見出しの下に設定）と、中身。列の中の投稿・プロフィールの
   * リンクは、その列の中で開き、「戻る」で一覧に戻る（一覧は隠して残すので、読んでいた位置に戻れる）。
   * ハッシュタグは検索の列を右端に足す。
   */
  let { column, index, count, onshow }: { column: DeckColumn; index: number; count: number; onshow: (id: string) => void } = $props();

  let body = $state<HTMLElement>();
  let settingsOpen = $state(false);
  /** 列の中で開いた画面と、開く前のスクロール位置。最後が今の画面。 */
  let stack = $state<{ route: Route; scroll: number }[]>([]);
  const current = $derived(stack.at(-1)?.route);

  const title = $derived(columnTitle(column, viewer.pubkey));
  const filterable = $derived(FILTERABLE.has(column.type));
  const accept = $derived.by(() => {
    const filter = column.filter;
    return filter ? (card: Card) => passesFilter(filter, card.note.content, !!card.repost) : undefined;
  });
  let relayText = $state("");
  let relayError = $state(false);

  function setFilter(change: Partial<ColumnFilter>) {
    deck.setFilter(column.id, { ...column.filter, ...change });
  }

  function saveRelays() {
    const before = column.param;
    deck.setParam(column.id, relayText);
    const after = deck.columns.find((c) => c.id === column.id)?.param;
    relayError = after === before && parseRelayParam(relayText).join(" ") !== before;
  }

  $effect(() => {
    if (settingsOpen) relayText = (column.param ?? "").split(" ").join(String.fromCharCode(10));
  });
  const currentTitle = $derived(current?.name === "thread" ? "投稿" : current?.name === "profile" ? displayName(current.pubkey) : "");

  async function open(route: Route, replace = false) {
    const scroll = body?.scrollTop ?? 0;
    if (replace && stack.length > 0) stack = [...stack.slice(0, -1), { route, scroll: stack[stack.length - 1].scroll }];
    else stack = [...stack, { route, scroll }];
    await tick();
    body?.scrollTo(0, 0);
  }

  async function back() {
    const last = stack.at(-1);
    if (!last) return;
    stack = stack.slice(0, -1);
    await tick();
    body?.scrollTo(0, last.scroll);
  }

  async function backToList() {
    const first = stack[0];
    if (!first) return;
    stack = [];
    await tick();
    body?.scrollTo(0, first.scroll);
  }

  provideNavigator((href, options) => {
    const route = parseRoute(href);
    if (route.name === "thread" || route.name === "profile") void open(route, options?.replace);
    else if (options?.replace) location.replace(href);
    else location.hash = href;
  });

  // 列の中のリンクは、この列の中で開く（新しいタブで開く操作はそのまま）
  function interceptLink(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest("a");
    const href = link?.getAttribute("href");
    if (!link || !href?.startsWith("#/") || link.target) return;
    const route = parseRoute(href);
    if (route.name === "thread" || route.name === "profile") {
      event.preventDefault();
      void open(route);
    } else if (route.name === "search" && route.q) {
      event.preventDefault();
      const id = deck.add("search", route.q);
      if (id) onshow(id);
    }
  }

  function toTop() {
    body?.scrollTo({ top: 0, behavior: "smooth" });
  }
</script>

<section class="column" style:width="{COLUMN_WIDTHS[column.width]}px" bind:this={body} aria-label={title} data-column-id={column.id} data-column-type={column.type} onclickcapture={interceptLink}>
  <header>
    {#if current}
      <div class="bar">
        <button type="button" class="back" onclick={back} title="戻る"><Icon name="arrowBack" size={20} /><span>戻る</span></button>
        <span class="sub">{currentTitle}</span>
        {#if stack.length > 1}<button type="button" class="icon" onclick={backToList} aria-label="{title}に戻る" title="{title}に戻る"><Icon name="close" size={20} /></button>{/if}
      </div>
    {:else}
      <div class="bar">
        <button type="button" class="title" onclick={toTop} title="一番上へ">
          <Icon name={COLUMN_ICONS[column.type]} size={20} /><span>{title}</span>
        </button>
        <button type="button" class="icon" class:active={settingsOpen} onclick={() => (settingsOpen = !settingsOpen)} aria-label="列の設定" aria-expanded={settingsOpen} title="列の設定"><Icon name="moreHoriz" size={20} /></button>
      </div>
      {#if settingsOpen}
        <div class="settings">
          <div class="label">列の幅</div>
          <div class="widths" role="radiogroup" aria-label="列の幅">
            {#each Object.entries(WIDTH_LABELS) as [value, label] (value)}
              <button type="button" role="radio" aria-checked={column.width === value} class:active={column.width === value} onclick={() => deck.setWidth(column.id, value as ColumnWidth)}>{label}</button>
            {/each}
          </div>
          <label class="field">
            <span class="label">名前（空なら種類から）</span>
            <input value={column.name ?? ""} onchange={(event) => deck.setName(column.id, event.currentTarget.value)} placeholder={columnTitle({ ...column, name: undefined }, viewer.pubkey)} maxlength="40" />
          </label>
          {#if column.type === "relays"}
            <label class="field">
              <span class="label">リレー（1 行に 1 件、12 件まで）</span>
              <textarea bind:value={relayText} rows="3" spellcheck="false"></textarea>
            </label>
            <div class="inline">
              <button type="button" class="small" onclick={saveRelays}>リレーを保存</button>
              {#if relayError}<span class="error">wss:// のリレーを 1 件以上入れてください</span>{/if}
            </div>
          {/if}
          {#if filterable}
            <div class="label"><Icon name="filterList" size={16} /> 絞り込み</div>
            <label class="field">
              <span class="label">どれかを含む投稿だけ（空白区切り）</span>
              <input value={column.filter?.include ?? ""} onchange={(event) => setFilter({ include: event.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="label">どれかを含む投稿は出さない（空白区切り）</span>
              <input value={column.filter?.exclude ?? ""} onchange={(event) => setFilter({ exclude: event.currentTarget.value })} />
            </label>
            <label class="check"><input type="checkbox" checked={!!column.filter?.japanese} onchange={(event) => setFilter({ japanese: event.currentTarget.checked })} />ひらがな・カタカナを含む投稿だけ</label>
            {#if column.type !== "reactions"}
              <label class="check"><input type="checkbox" checked={!!column.filter?.hideReposts} onchange={(event) => setFilter({ hideReposts: event.currentTarget.checked })} />リポストを出さない</label>
            {/if}
          {/if}
          <div class="row">
            <button type="button" class="icon" disabled={index === 0} onclick={() => { deck.move(column.id, -1); onshow(column.id); }} aria-label="左へ動かす" title="左へ動かす"><Icon name="chevronLeft" size={20} /></button>
            <button type="button" class="icon" disabled={index === count - 1} onclick={() => { deck.move(column.id, 1); onshow(column.id); }} aria-label="右へ動かす" title="右へ動かす"><Icon name="chevronRight" size={20} /></button>
            <span class="spacer"></span>
            <button type="button" class="icon danger" onclick={() => deck.remove(column.id)} aria-label="この列を消す" title="この列を消す"><Icon name="delete" size={20} /></button>
          </div>
        </div>
      {/if}
    {/if}
  </header>
  <div class="body" hidden={!!current}>
    {#if column.type === "home"}
      <HomeFeed show="following" {accept} />
    {:else if column.type === "global"}
      <HomeFeed show="global" {accept} />
    {:else if column.type === "notifications" && viewer.pubkey}
      <NotificationsPanel me={viewer.pubkey} />
    {:else if column.type === "search"}
      <SearchPanel q={column.param ?? ""} onsearch={(q) => deck.setParam(column.id, q)} />
    {:else if column.type === "profile" && column.param}
      {#key column.param}<Profile pubkey={column.param} />{/key}
    {:else}
      {#key column.param}<ColumnFeed {column} {accept} />{/key}
    {/if}
  </div>
  {#if current}
    {#key stack.length}<div class="body"><RouteView route={current} /></div>{/key}
  {/if}
</section>

<style>
  .column {
    /* 列の中の見出し（ホームのタブ・通知の絞り込み・検索欄）は、列の見出しの下に貼りつく */
    --sticky-top: 48px;
    flex: none;
    height: 100dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-right: 1px solid var(--outline-variant);
    background: var(--background);
  }
  header {
    position: sticky;
    top: 0;
    z-index: 8;
    background: color-mix(in srgb, var(--background) 92%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--outline-variant);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 48px;
    padding: 0 4px 0 8px;
  }
  .title,
  .back {
    display: flex;
    align-items: center;
    gap: 8px;
    font: inherit;
    font-weight: 700;
    color: var(--text);
    background: none;
    border: none;
    padding: 8px 4px;
    cursor: pointer;
    text-align: left;
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .title span,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title :global(svg) {
    color: var(--primary);
  }
  .back {
    flex: none;
    color: var(--primary);
  }
  .sub {
    flex: 1;
    min-width: 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    color: var(--muted);
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .icon.active {
    color: var(--text);
    background: var(--secondary-container);
  }
  .icon:disabled {
    color: var(--outline);
    cursor: default;
  }
  .icon.danger {
    color: #d33;
  }
  .settings {
    display: grid;
    gap: 8px;
    padding: 8px 12px 6px;
    border-top: 1px solid var(--outline-variant);
  }
  .label {
    font-size: 0.85em;
    color: var(--muted);
  }
  .widths {
    display: flex;
    gap: 6px;
  }
  .widths button {
    flex: 1;
    font: inherit;
    font-size: 0.9em;
    padding: 6px 0;
    color: var(--muted);
    background: none;
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    cursor: pointer;
  }
  .widths button.active {
    color: var(--text);
    font-weight: 700;
    background: var(--secondary-container);
    border-color: transparent;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field input,
  .field textarea {
    font: inherit;
    font-size: 0.9em;
    padding: 6px 8px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
    resize: vertical;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9em;
  }
  .label :global(svg) {
    vertical-align: -3px;
  }
  .inline {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .small {
    font: inherit;
    font-size: 0.85em;
    padding: 4px 12px;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  .error {
    color: #d33;
    font-size: 0.85em;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 -8px;
  }
  .spacer {
    flex: 1;
  }
  .body {
    padding-bottom: 96px;
  }
</style>
