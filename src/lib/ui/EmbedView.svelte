<script lang="ts">
  import { serviceName, type Embed } from "../domain/embeds";
  import { settings } from "../store/settings.svelte";
  import Icon from "./Icon.svelte";

  /**
   * 埋め込み（YouTube・X など）。読み込むとそのサービスへ通信する（IP アドレスなどが伝わる）ので、設定「埋め込みを
   * 自動で読み込む」がオフのときは、押したときだけ読み込む。iframe は sandbox で、できることを絞る。
   */
  let { embed }: { embed: Embed } = $props();

  let clicked = $state(false);
  const loaded = $derived(clicked || settings.autoEmbeds);
  let height = $state<number | null>(null);
  let frame = $state<HTMLIFrameElement>();

  const src = $derived(embed.service === "x" ? `${embed.src}&theme=${settings.dark ? "dark" : "light"}&lang=ja` : embed.src);

  // X の埋め込みは、中身の高さを postMessage で知らせてくる
  $effect(() => {
    if (!loaded || embed.service !== "x") return;
    const listen = (event: MessageEvent) => {
      if (event.origin !== "https://platform.twitter.com" || event.source !== frame?.contentWindow) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        const resize = data?.["twttr.embed"];
        const value = resize?.method === "twttr.private.resize" ? Number(resize.params?.[0]?.height) : NaN;
        // 数ピクセル足して、枠の中にスクロールバーが出ないようにする
        if (value > 0 && value < 5000) height = Math.ceil(value) + 4;
      } catch {
        // ほかの知らせは使わない
      }
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  });

  const style = $derived(
    height ? `height: ${height}px` : embed.height ? `height: ${embed.height}px` : `aspect-ratio: ${1 / (embed.aspect ?? 9 / 16)}`,
  );
</script>

<div class="embed {embed.service}" class:vertical={(embed.aspect ?? 0) > 1}>
  {#if loaded}
    <iframe
      bind:this={frame}
      {src}
      title={embed.label}
      style={style}
      loading="lazy"
      referrerpolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
      allow="encrypted-media; picture-in-picture; fullscreen; autoplay"
      allowfullscreen
    ></iframe>
  {:else}
    <button type="button" class="placeholder" onclick={() => (clicked = true)} aria-label="{embed.label}を読み込む">
      {#if embed.thumbnail && settings.showImages}<img src={embed.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" />{/if}
      <span class="caption">
        <Icon name="playArrow" size={22} />
        <span><strong>{embed.label}</strong><small>押すと {serviceName(embed.service)} から読み込みます</small></span>
      </span>
    </button>
  {/if}
  <a class="open" href={embed.url} target="_blank" rel="noopener noreferrer nofollow"><Icon name="openInNew" size={14} />{serviceName(embed.service)} で開く</a>
</div>

<style>
  .embed {
    margin-top: 8px;
    max-width: 560px;
  }
  .embed.vertical {
    max-width: 320px;
  }
  iframe {
    display: block;
    width: 100%;
    border: none;
    border-radius: 12px;
    background: var(--surface-low);
  }
  .placeholder {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    font: inherit;
    color: var(--text);
    text-align: left;
    background: var(--surface-low);
    border: 1px solid var(--outline-variant);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
  }
  .placeholder img {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
  }
  .caption {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
  }
  .placeholder img + .caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    color: #fff;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.7));
  }
  .caption > span {
    display: grid;
  }
  .caption small {
    font-size: 0.75em;
    opacity: 0.8;
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-size: 0.75em;
    color: var(--muted);
    text-decoration: none;
  }
</style>
