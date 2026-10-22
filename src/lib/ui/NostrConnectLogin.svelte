<script lang="ts">
  import { onDestroy } from "svelte";
  import { renderSVG } from "uqr";
  import { NOSTR_CONNECT_RELAYS } from "../nostr/remoteSigner";
  import { viewer } from "../store/viewer.svelte";
  import Icon from "./Icon.svelte";

  /**
   * nostrconnect://（NIP-46 の、Web 版から接続を始める形）を QR コードと文字で出し、署名アプリ（Amber など）で
   * 読み取ってもらう。最初の画面と設定で使う。開いたときだけ読み込む（QR コードのライブラリを含むため）。
   */
  let { done }: { done?: () => void } = $props();

  let remember = $state(false);
  let session = $state<{ uri: string; cancel: () => void } | null>(null);
  let error = $state<string | null>(null);
  let copied = $state(false);
  // QR コードは、ここで作った文字から描く（外から来た文字は入らない）
  const qr = $derived(session ? renderSVG(session.uri, { pixelSize: 4, whiteColor: "#ffffff", blackColor: "#000000" }) : "");

  function start() {
    error = null;
    const started = viewer.startNostrConnect(remember);
    session = started;
    started.done.then(() => {
      session = null;
      done?.();
    }).catch((e) => {
      if (session === started) {
        session = null;
        error = e instanceof Error ? e.message : String(e);
      }
    });
  }

  function cancel() {
    session?.cancel();
    session = null;
  }

  async function copy() {
    if (!session) return;
    await navigator.clipboard.writeText(session.uri);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  onDestroy(() => session?.cancel());
</script>

<div class="connect">
  <p class="title">署名アプリで読み取ってつなぐ（nostrconnect://）</p>
  {#if session}
    <div class="qr" aria-label="nostrconnect:// の QR コード">{@html qr}</div>
    <p class="hint">署名アプリ（Amber など）で読み取るか、下の文字を貼って、承認してください。このスマートフォンで署名アプリを使うときは「署名アプリで開く」を押してください。5 分たつと待つのをやめます。</p>
    <div class="uri">
      <code>{session.uri.slice(0, 48)}…</code>
      <button type="button" class="icon" onclick={copy} aria-label="nostrconnect:// をコピー" title="コピー"><Icon name="contentCopy" size={18} /></button>
    </div>
    {#if copied}<p class="hint">コピーしました</p>{/if}
    <div class="actions">
      <a class="open" href={session.uri}>署名アプリで開く</a>
      <button type="button" class="text" onclick={cancel}>やめる</button>
    </div>
    <p class="hint">返事を待っています…（リレー: {NOSTR_CONNECT_RELAYS.map((url) => url.replace(/^wss:\/\//, "")).join("、")}）</p>
  {:else}
    <label class="check">
      <input type="checkbox" bind:checked={remember} />
      このブラウザに記憶する（自分の端末だけで使ってください）
    </label>
    <button type="button" class="start" onclick={start}>nostrconnect:// を出す</button>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .connect {
    display: grid;
    gap: 8px;
  }
  .title {
    margin: 0;
    font-weight: 600;
  }
  .qr {
    width: min(220px, 70vw);
    justify-self: center;
    padding: 8px;
    background: #fff;
    border-radius: 8px;
    line-height: 0;
  }
  .qr :global(svg) {
    width: 100%;
    height: auto;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.8em;
    line-height: 1.6;
  }
  .uri {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8em;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--surface);
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 0.9em;
  }
  .check input {
    margin-top: 3px;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  button,
  .open {
    font: inherit;
    cursor: pointer;
    border-radius: 999px;
    text-decoration: none;
  }
  .start,
  .open {
    padding: 10px 16px;
    font-weight: 600;
    text-align: center;
    color: var(--primary);
    background: none;
    border: 1px solid var(--primary);
  }
  .text {
    color: var(--primary);
    background: none;
    border: none;
    padding: 8px 12px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    color: var(--muted);
    background: none;
    border: none;
  }
  .error {
    margin: 0;
    color: #d33;
  }
</style>
