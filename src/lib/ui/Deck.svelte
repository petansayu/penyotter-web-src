<script lang="ts">
  import { tick } from "svelte";
  import { profileHref, router, SETTINGS_TITLES } from "../router.svelte";
  import { composer } from "../store/composer.svelte";
  import { deck } from "../store/deck.svelte";
  import { notifications } from "../store/notifications.svelte";
  import { dms } from "../store/dm.svelte";
  import { viewer } from "../store/viewer.svelte";
  import { TEST_RELAY } from "../nostr/testMode";
  import AddColumn from "./AddColumn.svelte";
  import Composer from "./Composer.svelte";
  import DeckColumn, { COLUMN_ICONS, columnTitle } from "./DeckColumn.svelte";
  import Icon from "./Icon.svelte";
  import RouteView from "./RouteView.svelte";

  /**
   * カラム表示（横長の画面）。左のメニューに、投稿・検索・列ごとのアイコン（番号つき。押すとその列へ、ドラッグで
   * 並べ替え）・列を足す・プロフィール・設定。投稿欄はメニューの横に開く。設定など列にない画面は、右端の
   * 「詳細の列」に出し、×で閉じる。
   */

  const route = $derived(router.route);
  const detailOpen = $derived(route.name !== "home");
  const detailTitle = $derived.by(() => {
    switch (route.name) {
      case "profile": return route.pubkey === viewer.pubkey ? "自分のプロフィール" : "プロフィール";
      case "thread": return "投稿";
      case "notifications": return "通知";
      case "search": return "検索";
      case "settings": return route.page ? SETTINGS_TITLES[route.page] : "設定";
      case "mutes": return "ミュート";
      case "history": return "一覧の履歴";
      case "bookmarks": return "ブックマーク";
      case "write": return "記事を書く";
      case "relay": return "リレーの情報";
      case "chat": return "チャット";
      case "messages": return "DM";
      default: return "";
    }
  });
  const composerShown = $derived(viewer.canSign && (composer.open || deck.pinComposer));

  let strip = $state<HTMLElement>();
  let detail = $state<HTMLElement>();
  let adding = $state(false);
  let addAnchor = $state<HTMLElement>();
  let searching = $state(false);
  let searchAnchor = $state<HTMLElement>();
  let searchText = $state("");
  /** 光らせている列（左のメニューから移ったとき）。 */
  let flashed = $state<string | null>(null);
  /** キーボードで選んでいる列の番号と、その列で選んでいる投稿。 */
  let focused = $state(0);
  let selected: HTMLElement | null = null;
  let helpOpen = $state(false);

  const KEYS: [string, string][] = [
    ["h / ←", "左の列へ"],
    ["l / →", "右の列へ"],
    ["1〜9", "その番号の列へ"],
    ["0", "いちばん右の列へ"],
    ["j / ↓", "次の投稿"],
    ["k / ↑", "前の投稿"],
    ["Enter", "選んだ投稿を開く"],
    ["Backspace", "列の中で戻る"],
    ["n", "投稿欄を開く"],
    ["r", "選んだ投稿に返信"],
    ["f", "選んだ投稿にいいね"],
    ["t", "選んだ投稿をリポスト"],
    ["?", "このキーの一覧"],
  ];
  /** ドラッグ中の列と、落とす先の位置。 */
  let dragging = $state<string | null>(null);
  let dropAt = $state<number | null>(null);

  // 詳細の列を開いた・中身が変わったら、一番上から見せ、列が画面の外なら見える位置まで横に動かす
  $effect(() => {
    void route;
    if (!detailOpen) return;
    void tick().then(() => {
      detail?.scrollTo(0, 0);
      detail?.scrollIntoView({ inline: "end", block: "nearest", behavior: "smooth" });
    });
  });

  /** 列を見える位置へ動かし、少しのあいだ光らせる。もう見えているなら一番上へ。 */
  async function showColumn(id: string) {
    await tick();
    const element = strip?.querySelector<HTMLElement>(`[data-column-id="${id}"]`);
    if (!element || !strip) return;
    const box = element.getBoundingClientRect();
    const view = strip.getBoundingClientRect();
    if (box.left >= view.left && box.right <= view.right + 1) element.scrollTo({ top: 0, behavior: "smooth" });
    else element.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    flashed = id;
    setTimeout(() => {
      if (flashed === id) flashed = null;
    }, 700);
  }

  /** キーボードで列を選ぶ（見える位置へ動かす）。 */
  function focusColumn(index: number) {
    const count = deck.columns.length;
    if (count === 0) return;
    focused = Math.max(0, Math.min(count - 1, index));
    select(null);
    void showColumn(deck.columns[focused].id);
  }

  function columnElement(): HTMLElement | null {
    const column = deck.columns[Math.min(focused, deck.columns.length - 1)];
    return column ? strip?.querySelector<HTMLElement>(`[data-column-id="${column.id}"]`) ?? null : null;
  }

  function select(article: HTMLElement | null) {
    selected?.classList.remove("kb-selected");
    selected = article;
    if (!article) return;
    article.classList.add("kb-selected");
    article.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** 選んでいる列の、今出ている投稿（引用カードの中は除く）。 */
  function articles(column: HTMLElement): HTMLElement[] {
    const body = column.querySelector(":scope > .body:not([hidden])");
    return body ? [...body.querySelectorAll<HTMLElement>("article:not(.nested)")] : [];
  }

  function step(delta: 1 | -1) {
    const column = columnElement();
    if (!column) return;
    const list = articles(column);
    if (list.length === 0) return;
    const index = selected && selected.isConnected ? list.indexOf(selected) : -1;
    if (index < 0) {
      // まだ選んでいなければ、見えているいちばん上の投稿から
      const top = column.getBoundingClientRect().top + 48;
      return select(list.find((article) => article.getBoundingClientRect().bottom > top) ?? list[0]);
    }
    select(list[Math.max(0, Math.min(list.length - 1, index + delta))]);
  }

  /** 選んでいる投稿の中のボタン・リンク（引用カードの中のものは除く）。 */
  function own<T extends HTMLElement>(selector: string): T | null {
    if (!selected?.isConnected) return null;
    return [...selected.querySelectorAll<T>(selector)].find((element) => element.closest("article") === selected) ?? null;
  }

  async function repostSelected() {
    const button = own<HTMLButtonElement>('button[aria-haspopup="menu"].action');
    if (!button || button.disabled || button.classList.contains("on")) return;
    button.click();
    await tick();
    const item = [...(button.parentElement?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])].find((element) => element.textContent === "リポスト");
    item?.click();
  }

  function keydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (helpOpen) {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        helpOpen = false;
      }
      return;
    }
    const key = event.key;
    const run = (action: () => void) => {
      event.preventDefault();
      action();
    };
    if (key === "h" || key === "ArrowLeft") return run(() => focusColumn(focused - 1));
    if (key === "l" || key === "ArrowRight") return run(() => focusColumn(focused + 1));
    if (/^[1-9]$/.test(key)) return run(() => focusColumn(Number(key) - 1));
    if (key === "0") return run(() => focusColumn(deck.columns.length - 1));
    if (key === "j" || key === "ArrowDown") return run(() => step(1));
    if (key === "k" || key === "ArrowUp") return run(() => step(-1));
    if (key === "?") return run(() => (helpOpen = true));
    if (key === "Backspace") return run(() => columnElement()?.querySelector<HTMLButtonElement>(":scope > header .back")?.click());
    if (key === "Enter" && selected) return run(() => own<HTMLAnchorElement>("a.time")?.click());
    if (!viewer.canSign) return;
    if (key === "n") return run(() => composer.show());
    if (key === "r" && selected) return run(() => own<HTMLButtonElement>('button.action[title="返信"]')?.click());
    if (key === "f" && selected) {
      return run(() => {
        const like = own<HTMLButtonElement>("button.action[aria-pressed]");
        if (like && like.getAttribute("aria-pressed") === "false" && !like.disabled) like.click();
      });
    }
    if (key === "t" && selected) return run(() => void repostSelected());
  }

  function closeDetail() {
    location.hash = "#/";
  }

  function toggleComposer() {
    if (composerShown) {
      composer.hide();
      deck.setPinComposer(false);
    } else composer.show();
  }

  function submitSearch(event: SubmitEvent) {
    event.preventDefault();
    const q = searchText.trim();
    if (!q) return;
    const id = deck.add("search", q);
    searching = false;
    searchText = "";
    if (id) void showColumn(id);
  }

  function dragOver(event: DragEvent, index: number) {
    if (!dragging) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropAt = event.clientY < box.top + box.height / 2 ? index : index + 1;
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    if (dragging && dropAt !== null) {
      const from = deck.columns.findIndex((c) => c.id === dragging);
      // 自分より後ろへ落とすときは、自分が抜けた分だけ前へずれる
      deck.moveTo(dragging, dropAt > from ? dropAt - 1 : dropAt);
    }
    dragging = null;
    dropAt = null;
  }

</script>

<svelte:window onkeydown={keydown} onclick={(event) => {
  if (adding && !addAnchor?.contains(event.target as Node)) adding = false;
  if (searching && !searchAnchor?.contains(event.target as Node)) searching = false;
}} />

<div class="deck">
  <nav class="rail" aria-label="メニュー">
    {#if viewer.canSign}
      <button type="button" class="compose" class:active={composerShown} onclick={toggleComposer} aria-label="投稿する" aria-expanded={composerShown} title="投稿する"><Icon name="edit" /></button>
    {/if}
    <span class="anchor" bind:this={searchAnchor}>
      <button type="button" class="round" class:active={searching} onclick={() => (searching = !searching)} aria-label="検索の列を足す" aria-expanded={searching} title="検索"><Icon name="search" /></button>
      {#if searching}
        <form class="popup search" onsubmit={submitSearch}>
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={searchText} placeholder="キーワード・#タグ" aria-label="検索語" autofocus />
          <button type="submit" aria-label="検索の列を足す" title="検索の列を足す"><Icon name="search" size={20} /></button>
        </form>
      {/if}
    </span>

    <ol class="columns" ondragover={(event) => dragging && event.preventDefault()} ondrop={drop}>
      {#each deck.columns as column, index (column.id)}
        <li class:drop-before={dropAt === index && dragging !== null} class:drop-after={dropAt === index + 1 && index === deck.columns.length - 1 && dragging !== null}>
          <button
            type="button"
            class="column-button"
            class:dragging={dragging === column.id}
            class:focused={focused === index}
            draggable="true"
            ondragstart={(event) => { dragging = column.id; event.dataTransfer?.setData("text/plain", column.id); }}
            ondragend={() => { dragging = null; dropAt = null; }}
            ondragover={(event) => dragOver(event, index)}
            onclick={() => { focused = index; select(null); void showColumn(column.id); }}
            title="{columnTitle(column, viewer.pubkey)}（ドラッグで並べ替え）"
            aria-label="{index + 1}番目の列: {columnTitle(column, viewer.pubkey)}"
          >
            <Icon name={COLUMN_ICONS[column.type]} />
            <span class="number">{index + 1}</span>
            {#if column.type === "notifications" && notifications.unread > 0}<i class="badge-dot" aria-label="未読があります"></i>{/if}
          </button>
        </li>
      {/each}
    </ol>

    <span class="anchor" bind:this={addAnchor}>
      <button type="button" class="plain" class:active={adding} onclick={() => (adding = !adding)} title="列を足す" aria-label="列を足す" aria-expanded={adding}><Icon name="add" /></button>
      {#if adding}<span class="popup up"><AddColumn close={() => (adding = false)} added={(id) => showColumn(id)} /></span>{/if}
    </span>
    <a class="plain" href="#/chat" class:active={route.name === "chat"} title="チャット" aria-label="チャット"><Icon name="forum" /></a>
    {#if viewer.canSign}
      <a class="plain badged-link" href="#/messages" class:active={route.name === "messages"} title="DM" aria-label="DM"><Icon name="mail" />{#if dms.unreadCount > 0}<i class="badge-dot" aria-label="DM の未読があります"></i>{/if}</a>
    {/if}
    <a class="plain" href="#/bookmarks" class:active={route.name === "bookmarks"} title="ブックマーク" aria-label="ブックマーク"><Icon name="bookmarkBorder" /></a>
    {#if viewer.pubkey}
      <a class="plain" href={profileHref(viewer.pubkey)} class:active={route.name === "profile" && route.pubkey === viewer.pubkey} title="自分のプロフィール" aria-label="自分のプロフィール"><Icon name="person" /></a>
    {/if}
    <a class="plain" href="#/settings" class:active={route.name === "settings"} title="設定" aria-label="設定"><Icon name="settings" /></a>
    <button type="button" class="plain" class:active={helpOpen} onclick={() => (helpOpen = !helpOpen)} title="キーボードの操作（?）" aria-label="キーボードの操作"><Icon name="keyboard" /></button>
    {#if TEST_RELAY}<span class="test" title="テストモード">テスト</span>{/if}
    {#if !viewer.canSign}<span class="readonly" title="見るだけ">見る<br />だけ</span>{/if}
  </nav>

  {#if helpOpen}
    <div class="help" role="dialog" aria-label="キーボードの操作">
      <div class="help-head">
        <strong>キーボードの操作</strong>
        <button type="button" class="icon" onclick={() => (helpOpen = false)} aria-label="閉じる" title="閉じる（Esc）"><Icon name="close" size={20} /></button>
      </div>
      <dl>
        {#each KEYS as [keys, label] (keys)}<dt>{keys}</dt><dd>{label}</dd>{/each}
      </dl>
      <p class="muted">入力欄に文字を打っている間は効きません。n・r・f・t は署名できるときだけです。</p>
    </div>
  {/if}

  {#if composerShown}
    <aside class="composer-side"><Composer docked /></aside>
  {/if}

  <div class="strip" bind:this={strip}>
    {#each deck.columns as column, index (column.id)}
      <div class="slot" class:flashed={flashed === column.id}>
        <DeckColumn {column} {index} count={deck.columns.length} onshow={showColumn} />
      </div>
    {/each}
    {#if deck.columns.length === 0}
      <p class="empty">列がありません。左の「＋」で足せます。</p>
    {/if}
    {#if detailOpen}
      <section class="detail" bind:this={detail} aria-label={detailTitle}>
        <header>
          <button type="button" class="icon" onclick={() => history.back()} aria-label="戻る" title="戻る"><Icon name="arrowBack" size={20} /></button>
          <span class="title">{detailTitle}</span>
          <button type="button" class="icon" onclick={closeDetail} aria-label="閉じる" title="閉じる"><Icon name="close" size={20} /></button>
        </header>
        <div class="body"><RouteView {route} /></div>
      </section>
    {/if}
  </div>
</div>

<style>
  .deck {
    display: flex;
    height: 100dvh;
  }
  .rail {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 64px;
    padding: 12px 0 8px;
    background: var(--container);
    border-right: 1px solid var(--outline-variant);
  }
  .compose,
  .round {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    cursor: pointer;
  }
  .compose {
    color: var(--on-primary);
    background: var(--primary);
    border: none;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.15);
  }
  .compose.active {
    outline: 3px solid var(--secondary-container);
  }
  .round {
    color: var(--primary);
    background: none;
    border: 1.5px solid var(--primary);
  }
  .round.active {
    background: var(--secondary-container);
  }
  .anchor {
    position: relative;
  }
  .popup {
    position: absolute;
    top: 0;
    left: calc(100% + 12px);
    z-index: 30;
  }
  .popup.up {
    top: auto;
    bottom: 0;
  }
  .search {
    display: flex;
    gap: 6px;
    width: 280px;
    padding: 10px;
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
  }
  .search input {
    flex: 1;
    min-width: 0;
    font: inherit;
    padding: 6px 10px;
    border: 1px solid var(--outline);
    border-radius: 8px;
    background: var(--background);
    color: var(--text);
  }
  .search button {
    display: grid;
    place-items: center;
    width: 36px;
    border: none;
    border-radius: 8px;
    color: var(--on-primary);
    background: var(--primary);
    cursor: pointer;
  }
  .columns {
    flex: 1;
    min-height: 0;
    width: 100%;
    margin: 6px 0;
    padding: 6px 0;
    list-style: none;
    overflow-y: auto;
    border-top: 1px solid var(--outline-variant);
    border-bottom: 1px solid var(--outline-variant);
  }
  .columns li {
    display: flex;
    justify-content: center;
    border-top: 2px solid transparent;
    border-bottom: 2px solid transparent;
  }
  .columns li.drop-before {
    border-top-color: var(--primary);
  }
  .columns li.drop-after {
    border-bottom-color: var(--primary);
  }
  .column-button {
    position: relative;
    display: grid;
    place-items: center;
    width: 48px;
    height: 44px;
    color: var(--primary);
    background: none;
    border: none;
    border-radius: 12px;
    cursor: pointer;
  }
  .column-button:hover {
    background: var(--surface-low);
  }
  .column-button.focused {
    background: var(--secondary-container);
  }
  .help {
    position: fixed;
    left: 76px;
    bottom: 16px;
    z-index: 40;
    width: 300px;
    padding: 12px 16px;
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
  }
  .help-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .help dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 8px 0;
    font-size: 0.9em;
  }
  .help dt {
    font-family: ui-monospace, monospace;
    color: var(--primary);
  }
  .help dd {
    margin: 0;
  }
  .help .muted {
    margin: 0;
    color: var(--muted);
    font-size: 0.8em;
  }
  .column-button.dragging {
    opacity: 0.4;
  }
  .number {
    position: absolute;
    right: 4px;
    bottom: 2px;
    font-size: 0.7rem;
    color: var(--muted);
  }
  .badge-dot {
    position: absolute;
    top: 6px;
    right: 10px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #d33;
  }
  .plain {
    display: grid;
    place-items: center;
    width: 48px;
    height: 40px;
    color: var(--primary);
    background: none;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    text-decoration: none;
  }
  .badged-link {
    position: relative;
  }
  .plain.active {
    color: var(--text);
    background: var(--secondary-container);
  }
  .plain:hover:not(.active) {
    background: var(--surface-low);
  }
  .test,
  .readonly {
    font-size: 0.7rem;
    text-align: center;
    color: var(--secondary);
    background: var(--secondary-container);
    border-radius: 8px;
    padding: 2px 6px;
  }
  .test {
    color: #8a5a00;
    background: #fff3cd;
  }
  .composer-side {
    flex: none;
    width: 320px;
    height: 100dvh;
    overflow-y: auto;
    background: var(--container);
    border-right: 1px solid var(--outline-variant);
  }
  .strip {
    flex: 1;
    min-width: 0;
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .slot {
    display: flex;
    outline: 3px solid transparent;
    outline-offset: -3px;
    transition: outline-color 0.3s;
  }
  .slot.flashed {
    outline-color: var(--primary);
  }
  .empty {
    color: var(--muted);
    padding: 16px;
  }
  .detail {
    --sticky-top: 48px;
    flex: none;
    width: 520px;
    height: 100dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
    border-right: 1px solid var(--outline-variant);
    background: var(--background);
    box-shadow: -2px 0 8px rgb(0 0 0 / 0.06);
  }
  .detail header {
    position: sticky;
    top: 0;
    z-index: 8;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 48px;
    padding: 0 4px;
    background: color-mix(in srgb, var(--background) 92%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--outline-variant);
  }
  .detail .title {
    flex: 1;
    font-weight: 700;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    color: var(--muted);
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .body {
    padding-bottom: 96px;
  }
</style>
