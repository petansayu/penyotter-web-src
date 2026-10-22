<script lang="ts">
  import { buildZapRequest, checkZapInfo, lnurlOf, lnurlpEndpoint, parseLightningAddress } from "../domain/zaps";
  import type { Event } from "../nostr/events";
  import { profiles } from "../store/cache.svelte";
  import { viewer } from "../store/viewer.svelte";

  /**
   * ⚡ Zap を送る（Android 版の ZapDialog）。相手の lud16 から LNURL を調べ、zap リクエスト（kind 9734）を署名して
   * 請求書をもらい、`lightning:` でウォレットに渡す。Web 版だけ: ブラウザに WebLN（window.webln）があればそれで払える。
   * 請求書の文字もコピーできる（ブラウザから開けるウォレットがないことがあるため）。支払いは利用者がウォレットで行う。
   */
  let { note, close }: { note: Event; close: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  let sats = $state("21");
  let comment = $state("");
  let busy = $state(false);
  let message = $state<string | null>(null);
  let invoice = $state<string | null>(null);
  const webln = typeof window !== "undefined" ? (window as unknown as { webln?: { enable(): Promise<void>; sendPayment(pr: string): Promise<unknown> } }).webln : undefined;

  $effect(() => {
    dialog?.showModal();
  });

  async function getJson(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`応答 ${response.status}`);
      const text = await response.text();
      if (text.length > 100_000) throw new Error("応答が大きすぎます");
      return JSON.parse(text) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }

  async function request() {
    const amount = Number(sats);
    if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000) return;
    busy = true;
    message = "請求書を取得しています…";
    try {
      const address = parseLightningAddress(profiles.get(note.pubkey)?.profile.lud16 ?? "");
      const endpoint = lnurlpEndpoint(address);
      const millisats = amount * 1000;
      const { callback } = checkZapInfo(await getJson(endpoint), millisats);
      const lnurl = lnurlOf(endpoint);
      const signer = await viewer.getSigner();
      const zap = await signer.sign(buildZapRequest(note, millisats, lnurl, viewer.writeRelays, comment, Math.floor(Date.now() / 1000)));
      const url = new URL(callback);
      url.searchParams.set("amount", String(millisats));
      url.searchParams.set("nostr", JSON.stringify(zap));
      url.searchParams.set("lnurl", lnurl);
      const response = await getJson(url.toString());
      const pr = typeof response.pr === "string" && /^ln/i.test(response.pr) ? response.pr : null;
      if (!pr) throw new Error(typeof response.reason === "string" ? response.reason.slice(0, 200) : "請求書を取得できませんでした");
      invoice = pr;
      message = "ウォレットで支払ってください。";
    } catch (e) {
      message = e instanceof Error && e.message ? e.message : "請求書を取得できませんでした";
    } finally {
      busy = false;
    }
  }

  async function payWithWebln() {
    if (!webln || !invoice) return;
    try {
      await webln.enable();
      await webln.sendPayment(invoice);
      message = "支払いました";
    } catch (e) {
      message = e instanceof Error ? e.message : "支払えませんでした";
    }
  }
</script>

<dialog bind:this={dialog} onclose={close} aria-label="Zap">
  <h3>⚡ Zap</h3>
  {#if !invoice}
    <label><span>sats</span><input type="text" inputmode="numeric" value={sats} oninput={(e) => (sats = e.currentTarget.value.replace(/\D/g, "").slice(0, 8))} /></label>
    <label><span>コメント（任意）</span><textarea rows="2" maxlength="500" bind:value={comment}></textarea></label>
  {:else}
    <p class="invoice"><code>{invoice.slice(0, 40)}…</code></p>
    <div class="pay">
      <a class="filled" href="lightning:{invoice}">ウォレットで開く</a>
      {#if webln}<button type="button" class="outline" onclick={payWithWebln}>WebLN で払う</button>{/if}
      <button type="button" class="outline" onclick={() => navigator.clipboard.writeText(invoice ?? "").then(() => (message = "請求書をコピーしました"))}>請求書をコピー</button>
    </div>
  {/if}
  {#if message}<p class="muted">{message}</p>{/if}
  <div class="buttons">
    <button type="button" class="outline" disabled={busy} onclick={() => dialog?.close()}>{invoice ? "閉じる" : "キャンセル"}</button>
    {#if !invoice}<button type="button" class="filled" disabled={busy || !(Number(sats) > 0)} onclick={request}>{busy ? "請求書を取得中…" : "請求書をもらう"}</button>{/if}
  </div>
</dialog>

<style>
  dialog {
    width: min(92vw, 400px);
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  h3 {
    margin: 0 0 8px;
  }
  label {
    display: grid;
    gap: 4px;
    margin: 8px 0;
    font-size: 0.85em;
    color: var(--muted);
  }
  input,
  textarea {
    font: inherit;
    font-size: 1.1em;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .invoice code {
    overflow-wrap: anywhere;
    font-size: 0.85em;
  }
  .pay,
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;
  }
  .filled,
  .outline {
    padding: 6px 14px;
    font: inherit;
    font-size: 0.9em;
    border-radius: 999px;
    cursor: pointer;
    text-decoration: none;
  }
  .filled {
    color: var(--on-primary);
    background: var(--primary);
    border: none;
  }
  .outline {
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
  }
  button:disabled {
    opacity: 0.5;
  }
  .muted {
    font-size: 0.85em;
    color: var(--muted);
  }
</style>
