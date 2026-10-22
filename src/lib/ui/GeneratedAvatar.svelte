<script lang="ts">
  import { art, type AvatarChoice, type AvatarOp, type Role } from "../avatar/picker";

  /** プロフィール画像のない人のオリジナルアバター（Android 版の GeneratedAvatar と同じ形）。四角く描くので、丸くするのは呼ぶ側。 */
  let { choice }: { choice: AvatarChoice } = $props();

  const clipId = $props.id();
  const character = $derived(art.characters[choice.character]);
  const palette = $derived(art.palettes[choice.palette]);
  const accent = $derived(character.accent && choice.accent !== null ? art.accentColors[character.accent][choice.accent] : null);
  const inset = 64 * (1 - art.scale);
  const ops = $derived<AvatarOp[]>([...character.figure, ...character.faces[choice.expression]]);

  function color(role: Role): string {
    switch (role) {
      case "line": return art.line;
      case "eye": return art.eye;
      case "cheek":
      case "blush": return art.cheek;
      case "highlight": return "#FFFFFF";
      case "body": return palette.body;
      case "accent": return accent?.color ?? palette.body;
      case "accentCenter": return accent?.center ?? palette.body;
    }
  }
</script>

<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect width="128" height="128" fill={palette.background} />
  {#if character.clip.length > 0}
    <defs>
      <clipPath id={clipId}>
        {#each character.clip as d, i (i)}<path {d} />{/each}
      </clipPath>
    </defs>
  {/if}
  <g transform="translate({inset} {inset}) scale({art.scale})">
    {#each ops as [role, d, fill, stroke, clip, alpha], i (i)}
      <path
        {d}
        fill={fill ? color(role) : "none"}
        fill-opacity={alpha}
        stroke={stroke > 0 ? color(role) : "none"}
        stroke-opacity={alpha}
        stroke-width={stroke}
        stroke-linecap="round"
        stroke-linejoin="round"
        clip-path={clip && character.clip.length > 0 ? `url(#${clipId})` : undefined}
      />
    {/each}
  </g>
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
