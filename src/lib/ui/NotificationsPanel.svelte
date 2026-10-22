<script lang="ts">
  import { scrollOwnerToTop } from "./scroll";
  import { untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { notificationGroups, NOTIFICATION_TYPES } from "../domain/notifications";
  import { byNewest } from "../nostr/events";
  import { notifications } from "../store/notifications.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Icon from "./Icon.svelte";
  import NotificationCard from "./NotificationCard.svelte";

  /** 通知の画面（Android 版の NotificationsPanel）。 */
  let { me }: { me: string } = $props();

  /** 新しい zap・リアクション・リポストのうち、1 件ずつのカードにする数。 */
  const MAX_SEPARATE = 50;

  // 開いたときに未読だったもの・開いている間に届いたものは、次に開くまで 1 件ずつのカードのままにする
  // （読んでいる間にカードがまとまって動かないように）
  const seen = new Set<string>();
  const fresh = new SvelteSet<string>();
  $effect(() => {
    const ids = [...notifications.events.keys()];
    untrack(() => {
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (!notifications.read.has(id)) fresh.add(id);
      }
    });
  });

  const groups = $derived.by(() => {
    const separate = new Set([...notifications.events.values()].filter((event) => fresh.has(event.id)).sort(byNewest).slice(0, MAX_SEPARATE).map((event) => event.id));
    return notificationGroups(notifications.events.values(), me, {
      type: notifications.type,
      follows: notifications.following ? new Set(viewer.follows) : null,
      muted: viewer.mutedPubkeys,
      mutedNotes: viewer.mutedEvents,
      separate,
    });
  });

  // 通知は 500 件まで並ぶ。全部を一度に組み立てると開くときに固まるので、上から STEP 件ずつ出し、
  // 下の端が近づいたら足す（Timeline と同じ）
  const STEP = 12;
  let limit = $state(STEP);
  const shown = $derived(groups.slice(0, limit));
  let sentinel = $state<HTMLElement>();
  let near = $state(false);
  $effect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => (near = entries.some((entry) => entry.isIntersecting)), { rootMargin: "800px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  });
  $effect(() => {
    if (near && limit < groups.length) {
      const timer = setTimeout(() => (limit += STEP), 50);
      return () => clearTimeout(timer);
    }
  });

  let filtersEl = $state<HTMLElement>();

  function choose(type = notifications.type, following = notifications.following) {
    notifications.filter(type, following);
    limit = STEP;
    scrollOwnerToTop(filtersEl);
  }
</script>

<div class="filters" bind:this={filtersEl}>
  <div class="row">
    <button type="button" class="chip" class:active={notifications.following} onclick={() => choose(undefined, true)}>フォロー中</button>
    <button type="button" class="chip" class:active={!notifications.following} onclick={() => choose(undefined, false)}>グローバル</button>
    <button type="button" class="icon" onclick={() => notifications.refresh()} disabled={notifications.loading} aria-label="再取得" title="再取得"><Icon name="refresh" size={20} /></button>
    <button type="button" class="icon" onclick={() => notifications.markAllRead()} disabled={notifications.unread === 0} aria-label="すべて既読" title="すべて既読"><Icon name="doneAll" size={20} /></button>
  </div>
  <div class="row types">
    {#each NOTIFICATION_TYPES as { type, label } (type)}
      <button type="button" class="chip" class:active={notifications.type === type} style:flex-grow={label.length + 2} onclick={() => choose(type)}>{label}</button>
    {/each}
  </div>
  {#if notifications.loading}<div class="progress"></div>{/if}
</div>

{#if notifications.message}<p class="note">{notifications.message}</p>{/if}
{#if notifications.following && viewer.follows.length === 0}<p class="note">フォロー情報はまだ取得できていません</p>{/if}

{#each shown as group (group.key)}
  <div class="item"><NotificationCard {group} {me} /></div>
{:else}
  <p class="note">{notifications.loading ? "通知を読み込んでいます" : "取得済みの通知はありません"}</p>
{/each}

<div bind:this={sentinel}></div>
{#if !notifications.finished && groups.length > 0 && limit >= groups.length}
  <div class="footer">
    <button type="button" class="older" onclick={() => notifications.older()} disabled={notifications.loading}>過去の通知を読み込む</button>
  </div>
{/if}

<style>
  /* 通知は 500 件まで並ぶので、画面の外のものは描かない（Timeline と同じ） */
  .item {
    content-visibility: auto;
    contain-intrinsic-size: auto 160px;
  }
  /* 絵文字のパレットや「…」のメニューを開いている項目は、はみ出した部分も描く（content-visibility は描く範囲を
     項目の中に限るので、開いたパレットが切り取られて見えなくなっていた） */
  .item:has(:global(.picker), :global(.menu), :global(.mentions)) {
    content-visibility: visible;
  }
  .filters {
    position: sticky;
    top: var(--sticky-top, 52px);
    z-index: 5;
    background: var(--background);
    border-bottom: 1px solid var(--outline-variant);
    padding: 6px 12px 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .types {
    gap: 4px;
    margin-top: 6px;
  }
  .chip {
    flex: 1 1 0;
    min-width: 0;
    height: 30px;
    padding: 0 4px;
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--muted);
    background: none;
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
    cursor: pointer;
  }
  .chip.active {
    color: var(--text);
    background: var(--surface);
    border-color: transparent;
  }
  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    color: var(--text);
    background: none;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .icon:disabled {
    color: var(--outline);
    cursor: default;
  }
  .progress {
    height: 2px;
    margin: 6px -12px -8px;
    background: linear-gradient(90deg, transparent, var(--primary), transparent);
    background-size: 50% 100%;
    background-repeat: no-repeat;
    animation: slide 1.2s linear infinite;
  }
  @keyframes slide {
    from { background-position: -50% 0; }
    to { background-position: 150% 0; }
  }
  .note {
    color: var(--muted);
    padding: 12px 16px;
    margin: 0;
    font-size: 0.9em;
  }
  .footer {
    display: flex;
    justify-content: center;
    padding: 16px;
  }
  .older {
    font: inherit;
    color: var(--primary);
    background: var(--primary-container);
    border: none;
    border-radius: 999px;
    padding: 8px 20px;
    cursor: pointer;
  }
</style>
