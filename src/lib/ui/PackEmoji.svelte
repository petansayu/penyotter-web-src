<script lang="ts">
  import { emojiPacks } from "../store/emojiPacks.svelte";

  /**
   * 押すと、その絵文字とパックの画面（EmojiPackSheet）を開くカスタム絵文字（Android 版の EmojiText の emojiDetail）。
   * リンクやカードの中にも置くので button ではなく span にし、押した操作をまわりに渡さない。
   */
  let { shortcode, url, tags, owner, class: className = "" }: { shortcode: string; url: string; tags: string[][]; owner: string | null; class?: string } = $props();

  function open(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    emojiPacks.open({ shortcode, url }, tags, owner);
  }
</script>

<span class="pack-emoji" role="button" tabindex="0" title=":{shortcode}:" aria-label=":{shortcode}: の絵文字パックを見る"
  onclick={open} onkeydown={(event) => (event.key === "Enter" || event.key === " ") && open(event)}
  ><img class={className} src={url} alt=":{shortcode}:" loading="lazy" referrerpolicy="no-referrer" /></span>

<style>
  .pack-emoji {
    cursor: pointer;
    display: inline-flex;
    vertical-align: middle;
  }
  /* 呼び出し元の class はこのコンポーネントの中の img には効かないので、大きさの既定をここで決める（呼び出し元は :global で上書きする） */
  .pack-emoji img {
    height: 1.2em;
    max-width: 3em;
    object-fit: contain;
    vertical-align: middle;
  }
  .pack-emoji:focus-visible {
    outline: 2px solid var(--primary);
    border-radius: 4px;
  }
</style>
