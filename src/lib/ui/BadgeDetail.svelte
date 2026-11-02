<script lang="ts">
  import type { Badge } from "../domain/badges";
  import { profileHref } from "../router.svelte";
  import { badges } from "../store/badges.svelte";
  import { displayName, requestProfiles } from "../store/cache.svelte";
  import { settings } from "../store/settings.svelte";
  import Avatar from "./Avatar.svelte";
  import { fullTime } from "./time";

  /**
   * バッジの詳細（Android 版の BadgeDetailDialog）。大きな画像・名前・説明・作った人・（分かるときは）もらった日と、
   * 作った人が贈った「もらった人」の一覧。
   */
  let { badge, awardedAt, close }: { badge: Badge; awardedAt?: number; close: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let holders = $state<string[] | null>(null);
  let failed = $state(false);

  $effect(() => {
    dialog?.showModal();
  });
  $effect(() => {
    const current = badge;
    holders = null;
    failed = false;
    badges.holders(current).then((found) => current === badge && (holders = found), () => current === badge && (failed = true));
  });
  $effect(() => {
    requestProfiles([badge.issuer, ...(holders ?? []).slice(0, 60)]);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} onclose={close} aria-label="バッジ「{badge.name}」" data-testid="badge-detail"
  onclick={(event) => { event.stopPropagation(); if (event.target === dialog) dialog?.close(); }} onkeydown={(event) => event.stopPropagation()}>
  <div class="picture">{#if badge.image ?? badge.thumb}<img src={badge.image ?? badge.thumb} alt="バッジの画像" referrerpolicy="no-referrer" />{:else}<span>🏅</span>{/if}</div>
  <h3>{badge.name}</h3>
  {#if badge.description}<p class="description">{badge.description}</p>{/if}
  <a class="issuer" href={profileHref(badge.issuer)} onclick={() => dialog?.close()}>
    <Avatar pubkey={badge.issuer} size={32} />
    <span><small>作った人</small><strong>{displayName(badge.issuer)}</strong></span>
  </a>
  {#if awardedAt}<p class="muted">もらった日: {fullTime(awardedAt)}</p>{/if}
  <hr />
  <h4>{holders === null ? "もらった人" : `もらった人（${holders.length}人）`}</h4>
  {#if failed}<p class="muted">読み込めませんでした</p>
  {:else if holders === null}<p class="muted">読み込んでいます…</p>
  {:else if holders.length === 0}<p class="muted">見つかりませんでした</p>
  {:else}
    <ul>
      {#each holders.slice(0, 200) as pubkey (pubkey)}
        <li><a href={profileHref(pubkey)} onclick={() => dialog?.close()}><Avatar {pubkey} size={28} /><span>{displayName(pubkey)}</span></a></li>
      {/each}
    </ul>
  {/if}
  <div class="actions"><button type="button" onclick={() => dialog?.close()}>閉じる</button></div>
</dialog>

<style>
  dialog {
    width: min(94vw, 460px);
    max-height: 88vh;
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .picture {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 12px;
    background: var(--surface-low);
    font-size: 64px;
  }
  .picture img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  h3 {
    margin: 12px 0 4px;
    font-size: 1.25rem;
  }
  .description {
    margin: 0 0 8px;
    white-space: pre-wrap;
  }
  .issuer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    color: var(--text);
    text-decoration: none;
  }
  .issuer span {
    display: grid;
  }
  .issuer small,
  .muted {
    color: var(--muted);
    font-size: 0.85em;
  }
  hr {
    border: none;
    border-top: 1px solid var(--outline-variant);
  }
  h4 {
    margin: 8px 0;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li a {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    color: var(--text);
    text-decoration: none;
  }
  li span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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
