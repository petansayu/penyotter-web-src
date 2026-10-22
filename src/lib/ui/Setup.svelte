<script lang="ts">
  import { TEST_RELAY } from "../nostr/testMode";
  import BunkerLogin from "./BunkerLogin.svelte";
  import { resolveViewer, viewer } from "../store/viewer.svelte";

  /** 最初の画面。見る人の公開鍵（npub）か NIP-05 を入れる。秘密鍵は受け付けない。 */
  let input = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function loginNip07() {
    busy = true;
    error = null;
    try {
      await viewer.loginNip07();
      location.hash = "#/";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      viewer.set(await resolveViewer(input));
      location.hash = "#/";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <h1>ぺにょったー</h1>
  {#if viewer.adding}<p class="adding">アカウントを足します。<button type="button" class="cancel" onclick={() => (viewer.adding = false)}>やめる</button></p>{/if}
  <p>Nostr クライアント「ぺにょったー」の Web 版です。公開鍵（npub）か NIP-05 を入れると見るだけで使えます。投稿するときは、ブラウザ拡張（NIP-07）かリモート署名（NIP-46）でログインしてください。</p>
  <form onsubmit={submit}>
    <label for="viewer">見る人の npub か NIP-05</label>
    <input id="viewer" bind:value={input} placeholder="npub1… または name@example.com" autocomplete="off" spellcheck="false" required />
    <button type="submit" disabled={busy}>{busy ? "探しています…" : "はじめる"}</button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </form>
  <div class="or">投稿もするなら</div>
  <button type="button" class="nip07" onclick={loginNip07} disabled={busy}>ブラウザ拡張（NIP-07）でログイン</button>
  <div class="bunker"><BunkerLogin done={() => (location.hash = "#/")} /></div>
  <!-- QR コードのライブラリを含むので、開いたときだけ読み込む -->
  <div class="bunker">
    {#await import("./NostrConnectLogin.svelte") then { default: NostrConnectLogin }}<NostrConnectLogin done={() => (location.hash = "#/")} />{/await}
  </div>
  {#if TEST_RELAY}<p class="note">テストモード: 使い捨ての鍵の偽の拡張が入っています。投稿は手元のテスト用リレー（{TEST_RELAY}）にだけ送ります。</p>{/if}
  <p class="note">
    秘密鍵（nsec）は入力しないでください。この Web 版は秘密鍵を使いません。入れた公開鍵と見た目の設定は、このブラウザにだけ保存します。
  </p>
</section>

<style>
  .adding {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cancel {
    padding: 2px 10px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  section {
    padding: 48px 16px;
    max-width: 480px;
    margin: 0 auto;
  }
  h1 {
    color: var(--primary);
    margin: 0 0 8px;
  }
  form {
    display: grid;
    gap: 8px;
    margin: 24px 0;
  }
  label {
    font-weight: 600;
  }
  input {
    font: inherit;
    padding: 10px 12px;
    border: 1px solid var(--outline);
    border-radius: 10px;
    background: var(--surface-low);
    color: var(--text);
  }
  button {
    font: inherit;
    font-weight: 600;
    padding: 10px;
    border: none;
    border-radius: 999px;
    background: var(--primary);
    color: var(--on-primary);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
  }
  .or {
    margin-top: 8px;
    color: var(--muted);
    font-size: 0.9em;
  }
  .nip07 {
    width: 100%;
    margin-top: 8px;
    background: none;
    color: var(--primary);
    border: 1px solid var(--primary);
  }
  .bunker {
    margin-top: 24px;
  }
  .error {
    color: #d33;
    margin: 0;
  }
  .note {
    color: var(--muted);
    font-size: 0.9em;
  }
</style>
