<script lang="ts">
  import { chooseAvatar } from "../avatar/picker";
  import { profiles } from "../store/cache.svelte";
  import { settings } from "../store/settings.svelte";
  import GeneratedAvatar from "./GeneratedAvatar.svelte";

  /**
   * アイコン。画像がない・読み込みに失敗した・「アイコン画像を読み込む」がオフのときは、公開鍵から決まるオリジナルアバター。
   * alwaysPicture はプロフィール画面の大きなアイコン用（オフでも画像を出す。Android 版と同じ）。
   */
  let { pubkey, size = 44, alwaysPicture = false }: { pubkey: string; size?: number; alwaysPicture?: boolean } = $props();

  const picture = $derived(profiles.get(pubkey)?.profile.picture);
  let failed = $state<string | null>(null);
  const showPicture = $derived(!!picture && failed !== picture && (settings.avatarPictures || alwaysPicture));
  const choice = $derived(chooseAvatar(pubkey));
</script>

<span class="avatar" style:width="{size}px" style:height="{size}px">
  {#if showPicture}
    <img src={picture} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => (failed = picture ?? null)} />
  {:else if choice}
    <GeneratedAvatar {choice} />
  {/if}
</span>

<style>
  .avatar {
    display: inline-block;
    flex: none;
    border-radius: 50%;
    overflow: hidden;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
