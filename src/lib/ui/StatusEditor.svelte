<script lang="ts">
  import { onMount } from "svelte";
  import type { StatusType } from "../domain/extraEvents";
  import type { Event } from "../nostr/events";
  import { summary } from "../store/publishSummary";
  import { loadOwnStatuses, saveStatus } from "../store/writing";

  /**
   * 自分のステータス（NIP-38）の書き換え（Android 版の StatusDialog）。開くときに読み直し、ふだん（general）と
   * 音楽（music）を別々に保存する。空にして保存すると消える。
   */
  let { close }: { close: () => void } = $props();

  let base = $state<Record<StatusType, Event | undefined> | null>(null);
  let values = $state<Record<StatusType, string>>({ general: "", music: "" });
  let busy = $state<StatusType | null>(null);
  let message = $state<string | null>("読み込んでいます…");

  onMount(() => {
    loadOwnStatuses()
      .then((loaded) => {
        base = loaded;
        values = { general: loaded.general?.content ?? "", music: loaded.music?.content ?? "" };
        message = null;
      })
      .catch((e) => (message = e instanceof Error ? e.message : String(e)));
  });

  async function save(type: StatusType) {
    if (!base) return;
    busy = type;
    message = "送っています…";
    try {
      const result = await saveStatus(type, base[type], values[type]);
      message = summary(result);
      if (result.accepted > 0) base = await loadOwnStatuses().catch(() => base);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }
</script>

<div class="editor" role="group" aria-label="ステータスを設定">
  {#each [["general", "● ステータス"], ["music", "♫ 聴いている音楽"]] as [type, label] (type)}
    <label>
      <span>{label}</span>
      <span class="row">
        <input type="text" maxlength="500" bind:value={values[type as StatusType]} disabled={!base} placeholder="空にして保存すると消えます" />
        <button type="button" disabled={!base || busy !== null} onclick={() => save(type as StatusType)}>保存</button>
      </span>
    </label>
  {/each}
  {#if message}<small>{message}</small>{/if}
  <button type="button" class="close" onclick={close}>閉じる</button>
</div>

<style>
  .editor {
    display: grid;
    gap: 8px;
    margin: 8px 0;
    padding: 10px 12px;
    background: var(--surface-low);
    border-radius: 12px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 0.85em;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 6px;
  }
  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 1.1em;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  button {
    padding: 4px 12px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  .close {
    justify-self: end;
    border: none;
  }
  small {
    color: var(--muted);
  }
</style>
