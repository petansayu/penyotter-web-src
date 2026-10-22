<script lang="ts">
  import { summary } from "../store/publishSummary";
  import { viewer } from "../store/viewer.svelte";
  import { knownRelays, requestVanish } from "../store/writing";

  /**
   * 消去の依頼（NIP-62、Android 版の VanishDialog）。アカウントの投稿をすべて消すよう、リレーに頼む。取り消せないので、
   * 「消去」と入力するまで送れない。
   */
  let scope = $state<"all" | "some">("some");
  let chosen = $state(new Set<string>());
  let reason = $state("");
  let confirm = $state("");
  let sending = $state(false);
  let message = $state<string | null>(null);
  const relays = $derived(knownRelays());

  function toggle(url: string) {
    const next = new Set(chosen);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    chosen = next;
  }

  async function send() {
    sending = true;
    message = "送っています…";
    try {
      const result = await requestVanish(scope === "all" ? null : [...chosen], reason);
      message = `消去を依頼しました（${summary(result)}）`;
      confirm = "";
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      sending = false;
    }
  }
</script>

{#if !viewer.canSign}
  <p class="muted">署名できるアカウントでログインしてください。</p>
{:else}
  <p class="warn">このアカウントの投稿をすべて消すよう、リレーに頼みます（NIP-62）。自分宛ての DM も含みます。<strong>取り消せません。</strong>対応していないリレーや、ほかの場所に写された分は残ります。</p>
  <fieldset>
    <label><input type="radio" bind:group={scope} value="some" />選んだリレーだけ</label>
    <label><input type="radio" bind:group={scope} value="all" />すべてのリレー（ALL_RELAYS。知っているリレー {relays.length} 件へ送ります）</label>
  </fieldset>
  {#if scope === "some"}
    <ul class="relays">
      {#each relays as url (url)}
        <li><label><input type="checkbox" checked={chosen.has(url)} onchange={() => toggle(url)} /><code>{url}</code></label></li>
      {/each}
    </ul>
  {/if}
  <label class="field"><span>理由（任意、1,000 文字まで）</span><textarea rows="2" maxlength="1000" bind:value={reason}></textarea></label>
  <label class="field"><span>確かめのため「消去」と入力してください</span><input type="text" bind:value={confirm} /></label>
  <button type="button" class="danger" disabled={sending || confirm !== "消去" || (scope === "some" && chosen.size === 0)} onclick={send}>消去を依頼する</button>
  {#if message}<p class="muted">{message}</p>{/if}
{/if}

<style>
  .warn {
    padding: 10px 12px;
    color: #c33;
    background: rgb(204 51 51 / 0.08);
    border-radius: 10px;
  }
  .muted {
    color: var(--muted);
  }
  fieldset {
    display: grid;
    gap: 6px;
    margin: 8px 0;
    padding: 0;
    border: none;
  }
  .relays {
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
  }
  .relays label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
  }
  code {
    overflow-wrap: anywhere;
  }
  .field {
    display: grid;
    gap: 4px;
    margin: 8px 0;
    font-size: 0.9em;
    color: var(--muted);
  }
  .field input,
  .field textarea {
    font: inherit;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .danger {
    padding: 8px 18px;
    font: inherit;
    font-weight: 600;
    color: #fff;
    background: #c33;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .danger:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
