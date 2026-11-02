<script lang="ts">
  import type { ReceivedBadge } from "../domain/badges";
  import { profileHref } from "../router.svelte";
  import { badges } from "../store/badges.svelte";
  import { displayName, requestProfiles } from "../store/cache.svelte";
  import { viewer } from "../store/viewer.svelte";
  import Icon from "./Icon.svelte";
  import BadgeDetail from "./BadgeDetail.svelte";

  let opened = $state<ReceivedBadge | null>(null);

  /**
   * 自分のバッジ（Android 版の BadgesPanel）。飾っているもの（並べ替え・外す）と、もらったもの（飾る）。「保存」まで
   * 何も送らない。
   */
  const shown = $derived(badges.order.flatMap((address) => badges.byAddress.get(address) ?? []));
  const others = $derived(badges.received.filter((b) => !badges.order.includes(b.badge.address)));

  $effect(() => {
    if (viewer.ready) void badges.load();
  });
  $effect(() => {
    requestProfiles([...badges.byAddress.values()].map((b) => b.badge.issuer));
  });
</script>

{#snippet row(item: ReceivedBadge)}
  <button type="button" class="open" onclick={() => (opened = item)} aria-label="バッジ「{item.badge.name}」の詳細"></button>
  <span class="picture">{#if item.badge.thumb}<img src={item.badge.thumb} alt="" referrerpolicy="no-referrer" loading="lazy" />{:else}🏅{/if}</span>
  <span class="text">
    <strong>{item.badge.name}</strong>
    <small><a href={profileHref(item.badge.issuer)}>{displayName(item.badge.issuer)}</a>さんから</small>
    {#if item.badge.description}<small class="description">{item.badge.description}</small>{/if}
  </span>
{/snippet}

{#if opened}<BadgeDetail badge={opened.badge} awardedAt={opened.time} close={() => (opened = null)} />{/if}
<section class="badges-panel">
  <h2>バッジ</h2>
  <p class="muted">もらったバッジを、プロフィールに飾れます。並べ替えたり外したりしてから「保存」を押すと、プロフィールのバッジの一覧（NIP-58）を公開します。</p>
  {#if !viewer.canSign}<p class="error">このアカウントでは署名できないため、飾るバッジを変えられません。</p>{/if}
  {#if badges.loading}<p class="muted">読み込んでいます…</p>{/if}
  {#if badges.message}<p class="error">{badges.message}</p>{/if}

  <h3>飾っているバッジ（{shown.length}）</h3>
  {#if badges.loaded && shown.length === 0}<p class="muted">飾っているバッジはありません</p>{/if}
  <ul>
    {#each shown as item, i (item.badge.address)}
      <li>
        {@render row(item)}
        <button type="button" class="icon" disabled={i === 0} onclick={() => badges.move(item.badge.address, -1)} aria-label="上へ" title="上へ"><Icon name="arrowUpward" size={18} /></button>
        <button type="button" class="icon" disabled={i === shown.length - 1} onclick={() => badges.move(item.badge.address, 1)} aria-label="下へ" title="下へ"><Icon name="arrowDownward" size={18} /></button>
        <button type="button" class="text-button" onclick={() => badges.hide(item.badge.address)}>外す</button>
      </li>
    {/each}
  </ul>
  {#if badges.kept.length > 0}<p class="muted">読み込めなかったバッジ {badges.kept.length}件は、そのまま残します。</p>{/if}

  <h3>もらったバッジ（{others.length}）</h3>
  {#if badges.loaded && others.length === 0}<p class="muted">{badges.received.length === 0 ? "もらったバッジはありません" : "もらったバッジは、すべて飾っています"}</p>{/if}
  <ul>
    {#each others as item (item.badge.address)}
      <li>
        {@render row(item)}
        <button type="button" class="text-button" onclick={() => badges.show(item.badge.address)}>飾る</button>
      </li>
    {/each}
  </ul>

  <div class="footer">
    <button type="button" class="outline" disabled={badges.loading || badges.saving} onclick={() => badges.load(true)}>再取得</button>
    <button type="button" class="outline" disabled={!badges.changed || badges.saving} onclick={() => badges.revert()}>元に戻す</button>
    <button type="button" class="filled" disabled={!viewer.canSign || !badges.loaded || !badges.changed || badges.saving} onclick={() => badges.save()}>{badges.saving ? "保存しています…" : "保存"}</button>
  </div>
</section>

<style>
  .badges-panel {
    padding: 12px 16px 24px;
  }
  h2 {
    margin: 4px 0 8px;
    font-size: 1.2rem;
  }
  h3 {
    margin: 16px 0 6px;
    font-size: 1rem;
  }
  .muted {
    color: var(--muted);
    font-size: 0.9em;
  }
  .error {
    color: #d33;
    font-size: 0.9em;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
  }
  /* 行のどこを押しても詳細を開く（右のボタンは上に重ねて押せるようにする） */
  .open {
    position: absolute;
    inset: 0;
    background: none;
    border: none;
    cursor: pointer;
  }
  .icon,
  .text-button,
  .text a {
    position: relative;
    z-index: 1;
  }
  .picture {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    overflow: hidden;
    border-radius: 8px;
    background: var(--surface-low);
    font-size: 20px;
  }
  .picture img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .text strong,
  .text small {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .text small {
    color: var(--muted);
  }
  .text a {
    color: inherit;
  }
  .icon,
  .text-button {
    flex: none;
    padding: 4px 8px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  button:disabled {
    color: var(--outline);
    cursor: default;
  }
  .footer {
    display: flex;
    gap: 8px;
    margin-top: 20px;
  }
  .footer button {
    flex: 1;
    padding: 8px 12px;
    font: inherit;
    border-radius: 999px;
    cursor: pointer;
  }
  .outline {
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
  }
  .filled {
    color: var(--on-primary);
    background: var(--primary);
    border: none;
  }
  .filled:disabled {
    color: var(--muted);
    background: var(--surface-low);
  }
</style>
