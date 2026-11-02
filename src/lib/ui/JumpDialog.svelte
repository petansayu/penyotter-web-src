<script lang="ts">
  import { atHref } from "../router.svelte";
  import { home } from "../store/home.svelte";
  import { jumpDialog } from "../store/jump.svelte";
  import { useNavigate } from "./navigation";

  /**
   * 日時を指定して見る（Android 版の JumpDialog）。日時と範囲（フォロー中・グローバル）を選ぶと、その時刻の前後の
   * タイムライン（#/at/…）を開く。「その他」のメニュー、カラム表示の左の列、ホームのタブの時計から開く。
   */
  const navigate = useNavigate();
  let dialog = $state<HTMLDialogElement>();
  let at = $state("");
  let scope = $state<"following" | "global">("following");

  /** datetime-local の値（このブラウザの時刻、分まで）。 */
  const localValue = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  $effect(() => {
    if (!jumpDialog.open || !dialog) return;
    // 開くたびに、1 時間前とホームのいまのタブから始める
    at = localValue(new Date(Date.now() - 60 * 60 * 1000));
    scope = home.tab === "global" ? "global" : "following";
    dialog.showModal();
  });

  function jump(event: SubmitEvent) {
    event.preventDefault();
    const time = new Date(at).getTime();
    if (!Number.isFinite(time)) return;
    dialog?.close();
    navigate(atHref(time / 1000, scope));
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} onclose={() => (jumpDialog.open = false)} aria-label="日時を指定して見る" data-testid="jump-dialog"
  onclick={(event) => { event.stopPropagation(); if (event.target === dialog) dialog?.close(); }} onkeydown={(event) => event.stopPropagation()}>
  <form onsubmit={jump}>
    <h3>日時を指定して見る</h3>
    <p class="muted">その時刻の前後のタイムラインを開きます。</p>
    <label>日時 <input type="datetime-local" bind:value={at} required /></label>
    <div class="scope" role="radiogroup" aria-label="範囲">
      <button type="button" role="radio" aria-checked={scope === "following"} class:on={scope === "following"} onclick={() => (scope = "following")}>フォロー中</button>
      <button type="button" role="radio" aria-checked={scope === "global"} class:on={scope === "global"} onclick={() => (scope = "global")}>グローバル</button>
    </div>
    <div class="actions">
      <button type="button" class="text" onclick={() => dialog?.close()}>やめる</button>
      <button type="submit" class="filled" disabled={!at}>見る</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(92vw, 380px);
    color: var(--text);
    background: var(--container);
    border: 1px solid var(--outline-variant);
    border-radius: 16px;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h3,
  p {
    margin: 0;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85em;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.9em;
  }
  input {
    padding: 6px 8px;
    font: inherit;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline-variant);
    border-radius: 8px;
  }
  .scope {
    display: flex;
    border: 1px solid var(--outline-variant);
    border-radius: 999px;
    overflow: hidden;
  }
  .scope button {
    flex: 1;
    padding: 6px;
    font: inherit;
    font-size: 0.9em;
    color: var(--text);
    background: none;
    border: none;
    cursor: pointer;
  }
  .scope button + button {
    border-left: 1px solid var(--outline-variant);
  }
  .scope button.on {
    font-weight: 600;
    background: var(--primary-container);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    padding: 6px 16px;
    font: inherit;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .text {
    color: var(--primary);
    background: none;
  }
  .filled {
    color: var(--on-primary);
    background: var(--primary);
  }
</style>
