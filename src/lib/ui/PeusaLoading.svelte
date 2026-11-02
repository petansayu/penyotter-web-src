<script lang="ts">
  import { peusaPicture } from "../store/peusa.svelte";

  /** スーパーぺぇうさモードの、読み込み中（とろけたぺぇうさが、ゆらゆら）。 */
  let { size = 72 }: { size?: number } = $props();
</script>

<img class="peusa-loading" src={peusaPicture("loading")} alt="読み込んでいます" width={size} height={size} data-testid="peusa-loading" />

<style>
  .peusa-loading {
    display: block;
    margin: 0 auto;
    animation: sway 1.4s ease-in-out infinite alternate;
  }
  @keyframes sway {
    from {
      transform: rotate(-8deg);
    }
    to {
      transform: rotate(8deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .peusa-loading {
      animation: none;
    }
  }
</style>
