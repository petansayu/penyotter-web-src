<script lang="ts">
  import { untrack } from "svelte";
  import { profileHref, router } from "./lib/router.svelte";
  import { settings } from "./lib/store/settings.svelte";
  import { notifications } from "./lib/store/notifications.svelte";
  import { actions } from "./lib/store/actions.svelte";
  import { deck } from "./lib/store/deck.svelte";
  import { composer } from "./lib/store/composer.svelte";
  import { dms } from "./lib/store/dm.svelte";
  import { home } from "./lib/store/home.svelte";
  import { lists } from "./lib/store/lists.svelte";
  import { pwa } from "./lib/store/pwa.svelte";
  import { toast } from "./lib/store/toast.svelte";
  import { viewer } from "./lib/store/viewer.svelte";
  import Composer from "./lib/ui/Composer.svelte";
  import { attachGestures, neighbor } from "./lib/ui/gestures";
  import HomeFeed from "./lib/ui/HomeFeed.svelte";
  import Icon from "./lib/ui/Icon.svelte";
  import { TEST_RELAY } from "./lib/nostr/testMode";
  import { pool } from "./lib/nostr/pool";
  import RouteView from "./lib/ui/RouteView.svelte";
  import ListConfirmDialog from "./lib/ui/ListConfirmDialog.svelte";
  import Setup from "./lib/ui/Setup.svelte";

  // 設定が変わるたびに当て直して保存する（apply が読む項目が変わると、もう一度走る）
  $effect(() => {
    settings.apply();
  });

  // 見る人が決まったら、リレーとフォローを読んでからホームを読む。ホームはほかの画面を開いている間も残す
  $effect(() => {
    const pubkey = viewer.pubkey;
    if (!pubkey) return;
    return untrack(() => {
      deck.load(pubkey);
      home.open(pubkey);
      actions.load();
      notifications.prepare(pubkey);
      void viewer.load().then(() => {
        if (viewer.pubkey !== pubkey) return;
        // 読んだフォロー・ミュート一覧を履歴と比べて取り込む（大きく減っていたら知らせる）
        void lists.adopt();
        home.start();
        // 通知は開いていなくても読む（タブの印のため）
        notifications.start(pubkey);
      });
      return () => {
        home.close();
        notifications.stop();
      };
    });
  });

  // 設定でオンにしていて署名できるときだけ、リレーの認証（NIP-42）に答える
  $effect(() => {
    const enabled = settings.relayAuth && viewer.canSign;
    pool.authenticator = enabled
      ? async (url, challenge) => {
          try {
            const signer = await viewer.getSigner();
            return await signer.sign({ kind: 22242, created_at: Math.floor(Date.now() / 1000), tags: [["relay", url], ["challenge", challenge]], content: "" });
          } catch {
            return null;
          }
        }
      : null;
  });

  const route = $derived(router.route);
  const onHome = $derived(route.name === "home");

  // カラム表示のときは、画面全体ではなく列ごとに動かす
  $effect(() => {
    document.documentElement.classList.toggle("deck", deck.active && !!viewer.pubkey);
  });

  // ホームのスクロール位置を、ほかの画面から戻ったときに戻す
  let homeScroll = 0;
  let wasHome = true;
  $effect(() => {
    const now = onHome;
    untrack(() => {
      if (deck.active) return;
      if (now && !wasHome) requestAnimationFrame(() => window.scrollTo(0, homeScroll));
      else if (!now && wasHome) window.scrollTo(0, 0);
      wasHome = now;
    });
  });
  function rememberScroll() {
    if (onHome && !deck.active) homeScroll = window.scrollY;
  }

  // スマホの指の操作（Android 版と同じ）: 左右のスワイプで隣のタブへ、いちばん上で引っぱって読み直す
  let mainElement = $state<HTMLElement>();
  let pullDistance = $state(0);
  let pullReady = $state(false);
  let refreshing = $state(false);
  // Android 版と同じく、スワイプで回るのはホーム・通知・検索・チャットの 4 つ
  const tabHrefs = ["#/", "#/notifications", "#/search", "#/chat"];
  const tabIndex = $derived.by(() => {
    if (route.name === "home") return 0;
    if (route.name === "notifications") return 1;
    if (route.name === "search") return 2;
    if (route.name === "chat" && route.channel === null) return 3;
    return -1;
  });
  /** 「その他」のメニュー（Android 版の MoreMenu: プロフィール・DM・ブックマーク・設定）。 */
  let moreOpen = $state(false);
  const inMore = $derived(route.name === "messages" || route.name === "bookmarks" || route.name === "settings" || (route.name === "profile" && route.pubkey === viewer.pubkey));

  $effect(() => {
    if (!mainElement || deck.active) return;
    return attachGestures(mainElement, {
      swipe: (direction) => {
        if (tabIndex < 0 || composer.open) return;
        location.hash = tabHrefs[neighbor(tabIndex, direction, tabHrefs.length)];
      },
      canPull: () => (route.name === "home" || route.name === "notifications") && !refreshing,
      pull: async () => {
        refreshing = true;
        try {
          if (route.name === "notifications") notifications.refresh();
          else await (home.tab === "global" ? home.global : home.following)?.start();
        } finally {
          refreshing = false;
        }
      },
      pulling: (distance, ready) => {
        pullDistance = distance;
        pullReady = ready;
      },
    });
  });

  // 文字を打っている間（スマホのキーボードが出ている間）は、下のタブを隠す（Android 版と同じ）
  let typing = $state(false);
  const coarse = window.matchMedia("(pointer: coarse)");
  function focusChanged() {
    const active = document.activeElement;
    typing = coarse.matches && !!active?.matches("textarea, input:not([type=checkbox]):not([type=radio]):not([type=file]), [contenteditable]");
  }
  $effect(() => {
    document.documentElement.classList.toggle("typing", typing);
  });

  function tapHome(event: MouseEvent) {
    // 開いている画面のタブをもう一度押すと一番上へ
    if (onHome) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }
</script>

<svelte:window onscroll={rememberScroll} onfocusin={focusChanged} onfocusout={() => setTimeout(focusChanged, 0)} />

{#if !viewer.pubkey || viewer.adding}
  <main><Setup /></main>
{:else}
  {#if deck.active}
    <!-- カラム表示は横長の画面だけで使うので、別に読み込む -->
    {#await import("./lib/ui/Deck.svelte") then { default: Deck }}<Deck />{/await}
  {:else}
    <header class="bar">
      {#if !onHome}<button type="button" class="back" onclick={() => history.back()} aria-label="戻る"><Icon name="arrowBack" /></button>{/if}
      <a class="logo" href="#/" onclick={tapHome}>ぺにょったー</a>
      <span class="badge">{viewer.canSign ? "Web 版" : "Web 版・見るだけ"}</span>
      {#if TEST_RELAY}<span class="badge test">テストモード</span>{/if}
    </header>

    {#if pullDistance > 0 || refreshing}
      <div class="pull" class:ready={pullReady} style:height="{refreshing ? 40 : pullDistance}px" role="status">
        {refreshing ? "読み込んでいます…" : pullReady ? "離すと読み直します" : "引っぱって読み直す"}
      </div>
    {/if}
    <main bind:this={mainElement}>
      <div hidden={!onHome}><HomeFeed /></div>
      <RouteView {route} />
    </main>

    <nav class="tabs" class:hidden-by-keyboard={typing}>
      <a href="#/" class:active={onHome} onclick={tapHome}><span><Icon name="home" /></span>ホーム</a>
      <a href="#/notifications" class:active={route.name === "notifications"} onclick={(event) => {
        if (route.name === "notifications") { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
      }}>
        <span class="badged"><Icon name="notificationsNone" />{#if notifications.unread > 0}<i class="badge-dot" aria-label="未読があります"></i>{/if}</span>通知
      </a>
      <a href="#/search" class:active={route.name === "search"}><span><Icon name="search" /></span>検索</a>
      <a href="#/chat" class:active={route.name === "chat"}><span><Icon name="forum" /></span>チャット</a>
      <button type="button" class:active={inMore || moreOpen} onclick={() => (moreOpen = !moreOpen)} aria-expanded={moreOpen}>
        <span class="badged"><Icon name="menu" />{#if dms.unreadCount > 0}<i class="badge-dot" aria-label="DM の未読があります"></i>{/if}</span>その他
      </button>
    </nav>
  {/if}

  {#if moreOpen && !deck.active}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="more-back" onclick={() => (moreOpen = false)}>
      <nav class="more-sheet" aria-label="その他">
        <a href={profileHref(viewer.pubkey)} onclick={() => (moreOpen = false)}><Icon name="person" />プロフィール</a>
        <a href="#/messages" onclick={() => (moreOpen = false)}><Icon name="mail" />DM{#if dms.unreadCount > 0}<span class="count">{dms.unreadCount}</span>{/if}</a>
        <a href="#/bookmarks" onclick={() => (moreOpen = false)}><Icon name="bookmarkBorder" />ブックマーク</a>
        <a href="#/settings" onclick={() => (moreOpen = false)}><Icon name="settings" />設定</a>
      </nav>
    </div>
  {/if}
  <!-- チャットと DM には自分の入力欄があるので、投稿欄は引用するときだけ出す（Android 版と同じ） -->
  {#if viewer.canSign && !deck.active && (composer.open || (route.name !== "chat" && route.name !== "messages"))}<Composer />{/if}
  <ListConfirmDialog />
  {#if toast.message}<div class="toast" role="status">{toast.message}</div>{/if}
  {#if pwa.updateReady}
    <div class="update" role="status">
      新しい版があります
      <button type="button" onclick={() => pwa.reload()}>読み込み直す</button>
    </div>
  {/if}
{/if}

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 52px;
    padding: 0 16px;
    background: color-mix(in srgb, var(--background) 92%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--outline-variant);
  }
  .logo {
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--primary);
    text-decoration: none;
  }
  .badge {
    font-size: 0.75rem;
    color: var(--secondary);
    background: var(--secondary-container);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .update {
    position: fixed;
    top: calc(8px + env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 8px 8px 16px;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    font-size: 0.9em;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.2);
  }
  .update button {
    font: inherit;
    font-weight: 600;
    padding: 4px 12px;
    border: none;
    border-radius: 999px;
    background: var(--on-primary);
    color: var(--primary);
    cursor: pointer;
  }
  .toast {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(80px + env(safe-area-inset-bottom));
    z-index: 30;
    max-width: min(90vw, 480px);
    padding: 10px 16px;
    border-radius: 10px;
    background: var(--text);
    color: var(--background);
    font-size: 0.9em;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.2);
  }
  .badge.test {
    color: #8a5a00;
    background: #fff3cd;
  }
  .back {
    display: grid;
    place-items: center;
    color: var(--text);
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    width: 40px;
    height: 40px;
    margin-left: -8px;
  }
  main {
    padding-bottom: 72px;
  }
  .tabs {
    position: fixed;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 100%;
    max-width: var(--column);
    display: flex;
    background: var(--container);
    border-top: 1px solid var(--outline-variant);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .tabs button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 0;
    font: inherit;
    font-size: 0.75rem;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .tabs button span {
    display: grid;
    place-items: center;
    width: 56px;
    height: 28px;
    border-radius: 999px;
  }
  .tabs button.active {
    color: var(--text);
    font-weight: 600;
  }
  .tabs button.active span {
    background: var(--secondary-container);
  }
  .more-back {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgb(0 0 0 / 0.35);
  }
  .more-sheet {
    display: grid;
    width: min(100%, var(--column));
    padding: 8px 0 calc(72px + env(safe-area-inset-bottom));
    background: var(--container);
    border-radius: 16px 16px 0 0;
  }
  .more-sheet a {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 24px;
    color: var(--text);
    text-decoration: none;
  }
  .more-sheet a:hover {
    background: var(--surface-low);
  }
  .more-sheet .count {
    margin-left: auto;
    padding: 0 8px;
    font-size: 0.8em;
    color: #fff;
    background: #d33;
    border-radius: 999px;
  }
  .tabs.hidden-by-keyboard {
    display: none;
  }
  .pull {
    display: grid;
    place-items: center;
    overflow: hidden;
    font-size: 0.8em;
    color: var(--muted);
    transition: height 0.1s;
  }
  .pull.ready {
    color: var(--primary);
    font-weight: 600;
  }
  .tabs a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 0;
    font-size: 0.75rem;
    color: var(--muted);
    text-decoration: none;
  }
  .tabs a span {
    display: grid;
    place-items: center;
    width: 56px;
    height: 28px;
    border-radius: 999px;
  }
  .tabs a.active {
    color: var(--text);
    font-weight: 600;
  }
  .badged {
    position: relative;
  }
  .badge-dot {
    position: absolute;
    top: 2px;
    left: calc(50% + 6px);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #d33;
  }
  .tabs a.active span {
    background: var(--secondary-container);
  }
</style>
