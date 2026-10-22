<script lang="ts">
  import type { Route } from "../router.svelte";
  import { viewer } from "../store/viewer.svelte";
  import NotificationsPanel from "./NotificationsPanel.svelte";
  import Profile from "./Profile.svelte";
  import SearchPanel from "./SearchPanel.svelte";
  import ThreadView from "./ThreadView.svelte";

  /** ホーム以外の画面（プロフィール・投稿の詳細・通知・検索・設定）。1 列のときと、カラム表示の詳細の列で使う。 */
  let { route }: { route: Route } = $props();
</script>

{#if route.name === "profile"}
  {#key route.pubkey}<Profile pubkey={route.pubkey} relays={route.relays} />{/key}
{:else if route.name === "thread"}
  {#key route.id}<ThreadView id={route.id} relays={route.relays} author={route.author} />{/key}
{:else if route.name === "notifications" && viewer.pubkey}
  <NotificationsPanel me={viewer.pubkey} />
{:else if route.name === "search"}
  <SearchPanel q={route.q} />
{:else if route.name === "settings"}
  {#key route.page}{#await import("./Settings.svelte") then { default: Settings }}<Settings page={route.page} />{/await}{/key}
{:else if route.name === "mutes"}
  {#await import("./MutesPanel.svelte") then { default: MutesPanel }}<MutesPanel />{/await}
{:else if route.name === "history"}
  {#await import("./ListHistoryPanel.svelte") then { default: ListHistoryPanel }}<ListHistoryPanel />{/await}
{:else if route.name === "bookmarks"}
  {#await import("./BookmarksPanel.svelte") then { default: BookmarksPanel }}<BookmarksPanel />{/await}
{:else if route.name === "relay"}
  <!-- 開いたときだけ読み込む画面（本体を小さくするため） -->
  {#key route.url}{#await import("./RelayInfoView.svelte") then { default: RelayInfoView }}<RelayInfoView url={route.url} />{/await}{/key}
{:else if route.name === "write"}
  {#key route.identifier}{#await import("./ArticleEditor.svelte") then { default: ArticleEditor }}<ArticleEditor identifier={route.identifier} />{/await}{/key}
{:else if route.name === "chat"}
  {#key route.channel}{#await import("./ChatPanel.svelte") then { default: ChatPanel }}<ChatPanel channel={route.channel} />{/await}{/key}
{:else if route.name === "messages"}
  {#key route.peer}{#await import("./DmPanel.svelte") then { default: DmPanel }}<DmPanel peer={route.peer} />{/await}{/key}
{:else if route.name === "secretLink"}
  <p class="notice">秘密鍵（nsec・ncryptsec）のリンクは開きません。秘密鍵をリンクで受け取ったり、渡したりしないでください。</p>
{:else if route.name === "notFound"}
  <p class="notice">この画面は見つかりませんでした（{route.path}）。</p>
{/if}

<style>
  .notice {
    color: var(--muted);
    padding: 12px 16px;
    margin: 0;
  }
</style>
