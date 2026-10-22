<script lang="ts">
  import type { Media } from "../domain/content";
  import { blossomAlternatives } from "../domain/media";
  import { blossomServers, requestBlossomServers } from "../store/blossomServers.svelte";
  import Icon from "./Icon.svelte";
  import { attachZoom, type ZoomState } from "./zoom";

  /** 画像・動画。4 枚まで並べ、残りは「+N」（Android 版の MediaGrid）。押すとビューアで全部見られる。 */
  let { media, author }: { media: Media[]; author?: string } = $props();

  /** 読めなかった画像は、作者の Blossom サーバー（kind 10063）の同じハッシュの画像を順に試す。 */
  let fallbacks = $state(new Map<string, string[]>());
  const srcOf = (url: string) => fallbacks.get(url)?.[0] ?? url;
  // 作者のサーバー一覧は先に読んでおく（Android 版もタイムラインの作者の分を読む）
  $effect(() => {
    if (author && media.some((m) => !m.video)) requestBlossomServers(author);
  });
  function failed(url: string) {
    if (!author) return;
    const tried = fallbacks.get(url);
    if (tried) {
      if (tried.length > 0) fallbacks = new Map(fallbacks).set(url, tried.slice(1));
      return;
    }
    requestBlossomServers(author);
    const alternatives = blossomAlternatives(url, blossomServers.get(author) ?? []);
    if (alternatives.length > 0) fallbacks = new Map(fallbacks).set(url, alternatives);
  }

  const shown = $derived(media.slice(0, 4));
  let viewing = $state<number | null>(null);
  let dialog = $state<HTMLDialogElement>();

  function open(index: number) {
    viewing = index;
    dialog?.showModal();
  }

  function step(delta: number) {
    if (viewing === null) return;
    viewing = (viewing + delta + media.length) % media.length;
    zoom = { scale: 1, x: 0, y: 0 };
  }

  // 画像は指で拡大・移動、拡大していなければ左右のスワイプで前後へ（Android 版の ViewerImage）
  let zoom = $state<ZoomState>({ scale: 1, x: 0, y: 0 });
  let stage = $state<HTMLElement>();
  $effect(() => {
    if (!stage) return;
    return attachZoom(stage, (next) => (zoom = next), (direction) => media.length > 1 && step(direction));
  });

  function keydown(event: KeyboardEvent) {
    if (event.key === "ArrowRight") step(1);
    if (event.key === "ArrowLeft") step(-1);
  }
</script>

<div class="grid count-{shown.length}">
  {#each shown as item, i (item.url)}
    <button type="button" class="cell" onclick={() => open(i)} aria-label="画像を開く">
      {#if item.video}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={item.url} preload="metadata" muted playsinline></video>
        <span class="play"><Icon name="playArrow" size={40} /></span>
      {:else}
        <img src={srcOf(item.url)} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => failed(item.url)} />
      {/if}
      {#if i === 3 && media.length > 4}<span class="more">+{media.length - 4}</span>{/if}
    </button>
  {/each}
</div>

<dialog bind:this={dialog} onclose={() => { viewing = null; zoom = { scale: 1, x: 0, y: 0 }; }} onkeydown={keydown}>
  {#if viewing !== null}
    {@const item = media[viewing]}
    {#if item.video}
      <div class="viewer">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={item.url} controls autoplay playsinline></video>
      </div>
    {:else}
      <div class="viewer zoomable" bind:this={stage}>
        <img src={srcOf(item.url)} alt="" referrerpolicy="no-referrer" draggable="false" style:transform="translate({zoom.x}px, {zoom.y}px) scale({zoom.scale})" />
      </div>
    {/if}
    <div class="bar">
      {#if media.length > 1}
        <button type="button" onclick={() => step(-1)} aria-label="前へ"><Icon name="chevronLeft" /></button>
        <span>{viewing + 1} / {media.length}</span>
        <button type="button" onclick={() => step(1)} aria-label="次へ"><Icon name="chevronRight" /></button>
      {/if}
      <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label="元の画像を開く" title="元の画像を開く"><Icon name="openInNew" /></a>
      <button type="button" onclick={() => dialog?.close()} aria-label="閉じる" title="閉じる"><Icon name="close" /></button>
    </div>
  {/if}
</dialog>

<style>
  .grid {
    display: grid;
    gap: 4px;
    margin-top: 8px;
    border-radius: 12px;
    overflow: hidden;
    grid-template-columns: 1fr 1fr;
  }
  .count-1 {
    grid-template-columns: 1fr;
  }
  .cell {
    position: relative;
    padding: 0;
    border: none;
    background: var(--surface);
    cursor: zoom-in;
    aspect-ratio: 1;
    overflow: hidden;
  }
  .count-1 .cell {
    aspect-ratio: auto;
    max-height: 480px;
  }
  .count-3 .cell:first-child {
    grid-row: span 2;
    aspect-ratio: auto;
  }
  .cell img,
  .cell video {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .count-1 .cell img,
  .count-1 .cell video {
    max-height: 480px;
    object-fit: contain;
  }
  .more,
  .play {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 1.6rem;
    font-weight: bold;
    background: rgb(0 0 0 / 0.45);
  }
  .play {
    background: rgb(0 0 0 / 0.2);
  }
  dialog {
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: none;
    background: rgb(0 0 0 / 0.92);
    color: #fff;
  }
  dialog[open] {
    display: flex;
    flex-direction: column;
  }
  .viewer {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
  }
  .viewer img,
  .viewer video {
    max-width: 100%;
    max-height: calc(100dvh - 64px);
    object-fit: contain;
  }
  /* 指の操作をアプリで受け取る（ブラウザの拡大・スクロールにしない） */
  .viewer.zoomable {
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }
  .viewer.zoomable img {
    transition: transform 0.05s linear;
  }
  .bar {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }
  .bar button,
  .bar a {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    color: #fff;
    background: rgb(255 255 255 / 0.15);
    border: none;
    border-radius: 50%;
    padding: 0;
    font: inherit;
    cursor: pointer;
    text-decoration: none;
  }
</style>
