<script lang="ts">
  import { peusaPicture } from "../store/peusa.svelte";

  /** スーパーぺぇうさモードの、空の画面（Android 版の PeusaEmpty）。ぺぇうさと、ひとこと。 */
  let { picture, message }: { picture: string; message: string } = $props();
</script>

<div class="peusa-empty" data-testid="peusa-empty">
  <img src={peusaPicture(picture)} alt="" width="160" height="160" />
  <p>{message}</p>
</div>

<style>
  .peusa-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 24px 16px;
  }
  p {
    margin: 0;
    color: var(--muted);
  }
</style>
