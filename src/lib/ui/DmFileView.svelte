<script lang="ts">
  import { onDestroy } from "svelte";
  import { decryptFile, type DmFile } from "../domain/dm";

  /**
   * DM のファイル（NIP-17 の kind 15）。押したときに読み込んで、このブラウザで復号する。画像・動画はその場に出し、
   * ほかは保存のリンクにする。25MB を超えるものは読まない。
   */
  let { file }: { file: DmFile } = $props();

  let url = $state<string | null>(null);
  let busy = $state(false);
  let message = $state<string | null>(null);
  const kind = $derived(file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "file");

  async function open() {
    busy = true;
    message = null;
    try {
      const response = await fetch(file.url, { credentials: "omit", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error(`読み込めませんでした（${response.status}）`);
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length > 25 * 1024 * 1024 + 16) throw new Error("ファイルが大きすぎます");
      const plain = await decryptFile(data, file);
      url = URL.createObjectURL(new Blob([plain as BlobPart], { type: kind === "file" ? "application/octet-stream" : file.type }));
    } catch (e) {
      message = e instanceof Error ? e.message : "開けませんでした";
    } finally {
      busy = false;
    }
  }

  onDestroy(() => {
    if (url) URL.revokeObjectURL(url);
  });
</script>

{#if url}
  {#if kind === "image"}<img src={url} alt="" />
  {:else if kind === "video"}<!-- svelte-ignore a11y_media_has_caption --><video src={url} controls playsinline></video>
  {:else}<a href={url} download="file">ファイルを保存</a>{/if}
{:else}
  <button type="button" onclick={open} disabled={busy}>📎 {kind === "image" ? "画像" : kind === "video" ? "動画" : "ファイル"}{file.size ? `（${Math.ceil(file.size / 1024)}KB）` : ""}を開く</button>
{/if}
{#if message}<small>{message}</small>{/if}

<style>
  img,
  video {
    display: block;
    max-width: 100%;
    max-height: 320px;
    border-radius: 8px;
  }
  button {
    padding: 4px 8px;
    font: inherit;
    color: inherit;
    background: none;
    border: 1px dashed currentColor;
    border-radius: 8px;
    cursor: pointer;
  }
  a {
    color: inherit;
  }
  small {
    display: block;
    opacity: 0.8;
  }
</style>
