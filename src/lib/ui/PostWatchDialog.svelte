<script lang="ts">
  import { MAX_WORDS, WATCH_MODES, watchWords, type WatchMode, type WatchRule } from "../domain/watchedPosts";
  import { displayName } from "../store/cache.svelte";
  import { notifications } from "../store/notifications.svelte";
  import { postWatch } from "../store/postWatch.svelte";

  /**
   * 投稿のお知らせの条件（Android 版の PostWatchDialog）。rule は今の条件（まだ選んでいなければ null）。保存とやめるは
   * そのまま postWatch に書く。
   */
  let { me, pubkey, rule, close }: { me: string; pubkey: string; rule: WatchRule | null; close: () => void } = $props();

  let dialog = $state<HTMLDialogElement>();
  // 開いたときの条件から始める（開いている間に外で変わっても、入力中の値は変えない）
  const initial = (() => rule)();
  let mode = $state<WatchMode>(initial?.mode ?? "links");
  let words = $state(initial?.words.join(" ") ?? "");
  let replies = $state(initial?.replies ?? false);
  let error = $state<string | null>(null);

  $effect(() => {
    dialog?.showModal();
  });

  function save() {
    try {
      postWatch.put(me, { pubkey, mode, words: mode === "words" ? watchWords(words) : [], replies, since: Math.floor(Date.now() / 1000) });
      notifications.watchesChanged();
      dialog?.close();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  function stop() {
    try {
      postWatch.remove(me, pubkey);
    } catch {
      // 保存できなくても閉じる
    }
    dialog?.close();
  }
</script>

<dialog bind:this={dialog} onclose={close} aria-label="投稿をお知らせに出す">
  <h3>投稿をお知らせに出す</h3>
  <p class="muted">{displayName(pubkey)}さんの新しい投稿を、通知の「投稿」に出します。この設定はこのブラウザだけに保存し、だれにも公開しません。</p>
  <div class="modes">
    {#each WATCH_MODES as option (option.mode)}
      <label><input type="radio" name="watch-mode" value={option.mode} bind:group={mode} onchange={() => (error = null)} />{option.label}{option.mode === "links" ? "（ポッドキャストやブログの更新など）" : ""}</label>
    {/each}
  </div>
  {#if mode === "words"}
    <label class="words"><span>言葉（空白かカンマで区切って{MAX_WORDS}つまで）</span><input type="text" bind:value={words} oninput={() => (error = null)} /></label>
  {/if}
  <label class="check"><input type="checkbox" bind:checked={replies} />返信も含める</label>
  {#if error}<p class="error">{error}</p>{/if}
  {#if initial}<button type="button" class="stop" onclick={stop}>お知らせをやめる</button>{/if}
  <div class="buttons">
    <button type="button" onclick={() => dialog?.close()}>キャンセル</button>
    <button type="button" class="filled" onclick={save}>保存</button>
  </div>
</dialog>

<style>
  dialog {
    width: min(92vw, 420px);
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
  .muted {
    margin: 4px 0;
    font-size: 0.85em;
    color: var(--muted);
  }
  .modes {
    display: grid;
    gap: 6px;
    margin: 10px 0;
  }
  .modes label,
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .words {
    display: grid;
    gap: 4px;
    margin-bottom: 8px;
    font-size: 0.85em;
    color: var(--muted);
  }
  .words input {
    font: inherit;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .error {
    margin: 6px 0 0;
    font-size: 0.85em;
    color: #c33;
  }
  .stop {
    margin-top: 10px;
    padding: 4px 0;
    font: inherit;
    color: #c33;
    background: none;
    border: none;
    cursor: pointer;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
  .buttons button {
    padding: 6px 16px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: 1px solid var(--outline);
    border-radius: 999px;
    cursor: pointer;
  }
  .buttons .filled {
    color: var(--on-primary, #fff);
    background: var(--primary);
    border: none;
  }
</style>
