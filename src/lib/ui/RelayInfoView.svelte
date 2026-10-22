<script lang="ts">
  import { relayDetails, type RelayDetails } from "../nostr/relayInfo";
  import { profileHref } from "../router.svelte";
  import { viewer } from "../store/viewer.svelte";

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
