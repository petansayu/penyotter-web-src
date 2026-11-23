<script lang="ts">
  import { relayDetails, type RelayDetails } from "../nostr/relayInfo";
  import { profileHref, relayFeedHref } from "../router.svelte";
  import { viewer } from "../store/viewer.svelte";
  import { lists } from "../store/lists.svelte";
  import { RELAY_BLOCK_NOTE } from "./relayBlock";

  /** リレーの情報画面（NIP-11、Android 版の RelayInfoScreen）。このアカウントでの使い方も出す。 */
  let { url }: { url: string } = $props();

  let details = $state<RelayDetails | null | undefined>(undefined);
  $effect(() => {
    const current = url;
    details = undefined;
    void relayDetails(current).then((d) => current === url && (details = d));
  });

  const usage = $derived(
    [viewer.readRelays.includes(url) && "読み込み", viewer.writeRelays.includes(url) && "書き込み", viewer.alwaysOn.includes(url) && "常時接続"].filter(Boolean).join("・"),
  );

  // リレーのブロック（技術資料 4.6）
  const blocked = $derived(viewer.isBlocked(url));
  let asking = $state(false);
  async function changeBlock(value: boolean) {
    asking = false;
    await lists.blockRelay(url, value);
  }
</script>

<section class="relay">
  {#if details?.banner}<img class="banner" src={details.banner} alt="" referrerpolicy="no-referrer" />{/if}
  <div class="head">
    {#if details?.icon}<img class="icon" src={details.icon} alt="" referrerpolicy="no-referrer" />{/if}
    <div>
      <h2>{details?.name ?? url.replace(/^wss?:\/\//, "")}</h2>
      <code>{url}</code>
    </div>
  </div>
  <p class="usage">このアカウントでの使い方: {usage || "使っていません"}</p>
  {#if blocked}<p class="blocked">ブロック中のリレーです。読み込みにも書き込みにも使いません。</p>{/if}
  {#if viewer.canSign}
    <div class="block">
      {#if blocked}
        <button type="button" class="outline" disabled={lists.busy.has(10006)} onclick={() => changeBlock(false)}>ブロックを解除</button>
      {:else if asking}
        <p><strong>このリレーをブロックしますか？</strong></p>
        <p class="muted">{RELAY_BLOCK_NOTE} ブロックしたリレーの一覧は公開されます。</p>
        <button type="button" class="text" onclick={() => (asking = false)}>やめる</button>
        <button type="button" class="filled danger" disabled={lists.busy.has(10006)} onclick={() => changeBlock(true)}>ブロック</button>
      {:else}
        <button type="button" class="outline danger" onclick={() => (asking = true)}>このリレーをブロック</button>
      {/if}
    </div>
  {/if}
  {#if url.startsWith("wss://") && !blocked}<p class="usage"><a href={relayFeedHref(url)}>このリレーのタイムライン</a></p>{/if}
  {#if details === undefined}
    <p class="muted">読み込んでいます…</p>
  {:else if details === null}
    <p class="muted">リレーの情報（NIP-11）を読めませんでした。</p>
  {:else}
    {#if details.description}<p class="description">{details.description}</p>{/if}
    <dl>
      {#if details.authRequired || details.paymentRequired || details.restrictedWrites}
        <dt>制限</dt><dd>{[details.authRequired && "認証が必要", details.paymentRequired && "有料", details.restrictedWrites && "書き込みに制限あり"].filter(Boolean).join("・")}</dd>
      {/if}
      {#each details.limits as limit (limit.label)}<dt>{limit.label}</dt><dd>{limit.value.toLocaleString("en-US")}</dd>{/each}
      {#if details.fees.length > 0}<dt>料金</dt><dd>{details.fees.join("、")}</dd>{/if}
      {#if details.supportedNips.length > 0}<dt>対応している NIP</dt><dd>{details.supportedNips.join(", ")}</dd>{/if}
      {#if details.software}<dt>ソフトウェア</dt><dd>{#if details.software.startsWith("https://")}<a href={details.software} target="_blank" rel="noopener noreferrer nofollow">{details.software}</a>{:else}{details.software}{/if}{details.version ? ` ${details.version}` : ""}</dd>{/if}
      {#if details.countries.length > 0}<dt>国</dt><dd>{details.countries.join(", ")}</dd>{/if}
      {#if details.languages.length > 0}<dt>言語</dt><dd>{details.languages.join(", ")}</dd>{/if}
      {#if details.tags.length > 0}<dt>タグ</dt><dd>{details.tags.join(", ")}</dd>{/if}
      {#if details.contact}<dt>連絡先</dt><dd>{details.contact}</dd>{/if}
      {#if details.pubkey}<dt>運営者</dt><dd><a href={profileHref(details.pubkey)}>プロフィールを開く</a></dd>{/if}
    </dl>
    {#each details.links as link (link.url)}<p><a href={link.url} target="_blank" rel="noopener noreferrer nofollow">{link.label}</a></p>{/each}
  {/if}
</section>

<style>
  .relay {
    padding: 0 0 16px;
  }
  .blocked {
    color: #c33;
    font-size: 0.9em;
  }
  .block {
    margin: 8px 16px;
  }
  .block p {
    margin: 4px 0;
  }
  .block button {
    min-height: 40px;
    padding: 0 16px;
    margin: 4px 8px 4px 0;
    border-radius: 20px;
    border: 1px solid var(--outline);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .block button.text {
    border-color: transparent;
  }
  .block button.danger {
    color: #c33;
  }
  .block button.filled.danger {
    background: #c33;
    border-color: #c33;
    color: #fff;
  }
  .block button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .banner {
    display: block;
    width: 100%;
    max-height: 140px;
    object-fit: cover;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px 0;
  }
  .icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  code {
    font-size: 0.8em;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .usage,
  .muted,
  .description,
  dl,
  p {
    margin: 8px 16px;
  }
  .usage {
    font-size: 0.85em;
    color: var(--primary);
  }
  .muted {
    color: var(--muted);
  }
  .description {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    font-size: 0.9em;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  a {
    color: var(--primary);
  }
</style>
