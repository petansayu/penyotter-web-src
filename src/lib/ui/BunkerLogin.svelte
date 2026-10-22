<script lang="ts">
  import { viewer } from "../store/viewer.svelte";

  /** リモート署名（NIP-46）の bunker:// を貼ってつなぐ欄。最初の画面と設定で使う。 */
  let { done }: { done?: () => void } = $props();

  let input = $state("");
  let remember = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = null;
    try {
      await viewer.loginBunker(input, remember);
      input = "";
      done?.();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<form class="bunker" onsubmit={submit}>
  <label for="bunker">リモート署名（NIP-46）の bunker://</label>
  <input id="bunker" bind:value={input} placeholder="bunker://…" autocomplete="off" spellcheck="false" required />
  <label class="check">
    <input type="checkbox" bind:checked={remember} />
    このブラウザに記憶する（自分の端末だけで使ってください）
  </label>
  <p class="hint">
    記憶しないときは、タブを閉じると接続が切れます（次は貼り直します）。記憶すると、接続用の鍵をこのブラウザに保存します。この鍵を知られると、署名アプリの許可の設定しだいで署名を頼まれることがあるので、署名アプリ側で許可を絞っておくと安心です。
  </p>
  <button type="submit" disabled={busy}>{busy ? "つないでいます…（署名アプリで承認してください）" : "リモート署名でつなぐ"}</button>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</form>

<style>
  .bunker {
    display: grid;
    gap: 8px;
  }
  label {
    font-weight: 600;
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-weight: normal;
    font-size: 0.9em;
  }
  .check input {
    margin-top: 3px;
  }
  input:not([type]) {
    font: inherit;
    padding: 10px 12px;
    border: 1px solid var(--outline);
    border-radius: 10px;
    background: var(--surface-low);
    color: var(--text);
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.8em;
    line-height: 1.6;
  }
  button {
    font: inherit;
    font-weight: 600;
    padding: 10px;
    border-radius: 999px;
    background: none;
    color: var(--primary);
    border: 1px solid var(--primary);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
  }
  .error {
    color: #d33;
    margin: 0;
  }
</style>
