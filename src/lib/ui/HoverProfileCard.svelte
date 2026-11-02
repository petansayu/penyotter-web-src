<script lang="ts">
  import { nip19 } from "nostr-tools";
  import { profileHref } from "../router.svelte";
  import { displayName, profiles, requestProfiles } from "../store/cache.svelte";
  import { lists } from "../store/lists.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Avatar from "./Avatar.svelte";

  /**
   * プロフィールのホバーカード（Amethyst を参考に）。マウスでアイコンや名前（data-profile-hover の付いたもの）に
   * 0.25 秒のせると、近くに小さなプロフィールを出す。フォロー・ミュート・DM もここから。マウスで操作する画面だけで、
   * 指で触れたときは出さない（スマホでは今までどおり、押すとプロフィールの画面）。
   */
  const SHOW_MS = 250;
  const HIDE_MS = 200;
  const WIDTH = 300;

  let pubkey = $state<string | null>(null);
  let position = $state({ top: 0, left: 0, above: false });
  let card = $state<HTMLElement>();
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const profile = $derived(pubkey ? profiles.get(pubkey)?.profile : undefined);
  const self = $derived(pubkey === viewer.pubkey);
  const following = $derived(!!pubkey && viewer.follows.includes(pubkey));
  const muted = $derived(!!pubkey && viewer.mutedPubkeys.has(pubkey));

  function place(target: Element) {
    const rect = target.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - WIDTH - 8);
    // 下に場所がなければ上に出す
    const above = rect.bottom + 240 > window.innerHeight && rect.top > 260;
    position = { top: above ? rect.top - 6 : rect.bottom + 6, left, above };
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    pubkey = null;
  }

  $effect(() => {
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !canHover.matches) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (card?.contains(target)) {
        clearTimeout(hideTimer);
        return;
      }
      const trigger = target.closest<HTMLElement>("[data-profile-hover]");
      const key = trigger?.dataset.profileHover;
      if (!trigger || !key) return;
      clearTimeout(hideTimer);
      if (key === pubkey) return;
      clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        if (!trigger.isConnected) return;
        requestProfiles([key]);
        place(trigger);
        pubkey = key;
      }, SHOW_MS);
    };
    const out = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
      if (next && (card?.contains(next) || (next.closest<HTMLElement>("[data-profile-hover]")?.dataset.profileHover === pubkey && pubkey))) return;
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => (pubkey = null), HIDE_MS);
    };
    const key = (event: KeyboardEvent) => event.key === "Escape" && hide();
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("hashchange", hide);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("hashchange", hide);
      hide();
    };
  });
</script>

{#if pubkey}
  <div class="hover-card" class:above={position.above} bind:this={card} role="dialog" aria-label="{displayName(pubkey)} のプロフィール" data-testid="hover-profile"
    style:top="{position.top}px" style:left="{position.left}px" style:width="{WIDTH}px">
    <a class="head" href={profileHref(pubkey)} onclick={hide}>
      <Avatar {pubkey} size={48} />
      <span class="names">
        <strong>{displayName(pubkey)}</strong>
        {#if profile?.name && profile.name !== displayName(pubkey)}<small>@{profile.name}</small>{/if}
        {#if profile?.nip05}<small class="nip05">{profile.nip05}</small>{/if}
      </span>
    </a>
    {#if following && !self}<span class="badge">フォロー中</span>{/if}
    {#if muted}<span class="badge muted-badge">ミュート中</span>{/if}
    {#if profile?.about}<p class="about">{profile.about}</p>{/if}
    <div class="actions">
      <a class="action" href={profileHref(pubkey)} onclick={hide}>プロフィール</a>
      {#if viewer.canSign && !self}
        {#if following}
          <button type="button" class="action" disabled={lists.busy.has(3) || !viewer.ready} onclick={() => lists.unfollow(pubkey!)}>フォローを外す</button>
        {:else}
          <button type="button" class="action filled" disabled={lists.busy.has(3) || !viewer.ready} onclick={() => lists.follow(pubkey!)}>フォローする</button>
        {/if}
        <a class="action" href="#/messages/{nip19.npubEncode(pubkey)}" onclick={hide}>DM</a>
        <button type="button" class="action" disabled={lists.busy.has(10000) || !viewer.ready} onclick={() => (muted ? lists.unmuteUser(pubkey!) : lists.muteUser(pubkey!))}>{muted ? "ミュートを解除" : "ミュート"}</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .hover-card {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 14px;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
  }
  .hover-card.above {
    transform: translateY(-100%);
  }
  .head {
    display: flex;
    gap: 10px;
    align-items: center;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .names > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .names small {
    color: var(--muted);
    font-size: 0.8em;
  }
  .badge {
    align-self: flex-start;
    padding: 1px 8px;
    font-size: 0.75em;
    color: var(--primary);
    background: var(--primary-container);
    border-radius: 999px;
  }
  .muted-badge {
    color: var(--muted);
  }
  .about {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    font-size: 0.85em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .action {
    padding: 4px 12px;
    font: inherit;
    font-size: 0.85em;
    color: var(--primary);
    text-decoration: none;
    background: none;
    border: 1px solid var(--outline-variant);
    border-radius: 999px;
    cursor: pointer;
  }
  .action.filled {
    color: var(--on-primary);
    background: var(--primary);
    border-color: var(--primary);
  }
  .action:disabled {
    opacity: 0.5;
  }
</style>
