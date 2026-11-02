<script lang="ts">
  import { deck } from "../store/deck.svelte";
  import { peusa, peusaClearRandom, peusaPicture, peusaStrong } from "../store/peusa.svelte";
  import { settings } from "../store/settings.svelte";

  /**
   * スーパーぺぇうさモードの、画面の上に出るもの（Android 版の PeusaCelebrationOverlay・PeusaUnlockDialog・PeusaPeek・
   * peusaHearts）。受理されたときにぽんと出るぺぇうさ（押せないので操作の邪魔をしない）と、オンにしたときのお祝い。
   * 強のあいだは、画面の下の端からぺぇうさがのぞき（ときどき入れ替わる）、押したところから水色のハートが飛び散る
   * （どちらも押せないので、下の操作はそのまま効く）。
   */
  const strong = $derived(peusaStrong());
  let peek = $state(peusaClearRandom());
  let peeking = $state(false);
  $effect(() => {
    if (!strong) return;
    let timer = setTimeout(function cycle() {
      if (peeking) {
        peeking = false;
        timer = setTimeout(cycle, 1500);
      } else {
        peek = peusaClearRandom();
        peeking = true;
        timer = setTimeout(cycle, 25_000);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      peeking = false;
    };
  });

  const HEARTS = 7;
  let bursts = $state<{ id: number; x: number; y: number; turn: number }[]>([]);
  let nextBurst = 0;
  $effect(() => {
    if (!strong) return;
    const tapped = (event: PointerEvent) => {
      const burst = { id: nextBurst++, x: event.clientX, y: event.clientY, turn: Math.random() * 360 };
      bursts = [...bursts.slice(-7), burst];
      setTimeout(() => (bursts = bursts.filter((b) => b.id !== burst.id)), 800);
    };
    window.addEventListener("pointerdown", tapped, { capture: true, passive: true });
    return () => window.removeEventListener("pointerdown", tapped, { capture: true });
  });
  let shown = $state<string | null>(null);

  $effect(() => {
    const current = peusa.celebration;
    if (!current || !settings.peusaMode) return;
    shown = current.picture;
    const timer = setTimeout(() => (shown = null), 1500);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!peusa.unlocking) return;
    const timer = setTimeout(() => (peusa.unlocking = false), 2800);
    return () => clearTimeout(timer);
  });
</script>

{#if strong}
  <img class="peek" class:deck={deck.active} class:up={peeking} src={peek} alt="" width="104" height="104" data-testid="peusa-peek" />
  {#each bursts as burst (burst.id)}
    <div class="burst" style:left="{burst.x}px" style:top="{burst.y}px" aria-hidden="true">
      {#each Array.from({ length: HEARTS }, (_, i) => burst.turn + (i * 360) / HEARTS) as angle, i (i)}
        <svg class="heart" style:--angle="{angle}deg" viewBox="0 0 24 24" width="18" height="18"><path d="m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
      {/each}
    </div>
  {/each}
{/if}
{#if shown}
  {#key peusa.celebration?.at}<img class="celebration" src={shown} alt="" width="150" height="150" data-testid="peusa-celebration" />{/key}
{/if}
{#if peusa.unlocking}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="unlock-back" onclick={() => (peusa.unlocking = false)}>
    <div class="unlock" role="status" aria-label="スーパーぺぇうさモード オン！" data-testid="peusa-unlock">
      <img src={peusaPicture("unlock-title")} alt="スーパーぺぇうさモード オン！" width="220" height="220" />
      <img class="cheer" src={peusaPicture("unlock")} alt="" width="200" height="200" />
    </div>
  </div>
{/if}

<style>
  /* 画面下のタブ（z-index 20）の後ろから、上半分だけのぞく */
  .peek {
    position: fixed;
    left: max(28px, calc(50% - var(--column) / 2 + 28px));
    bottom: calc(40px + env(safe-area-inset-bottom));
    z-index: 15;
    pointer-events: none;
    transform: translateY(100%);
    transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .peek.up {
    transform: translateY(0);
  }
  .peek.deck {
    left: 28px;
    bottom: -18px;
  }
  .burst {
    position: fixed;
    z-index: 80;
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .heart {
    position: absolute;
    left: -9px;
    top: -9px;
    fill: #8fd3f7;
    animation: scatter 0.75s ease-out forwards;
  }
  @keyframes scatter {
    from {
      opacity: 1;
      transform: rotate(var(--angle)) translateY(-12px) rotate(calc(-1 * var(--angle))) scale(1);
    }
    to {
      opacity: 0;
      transform: rotate(var(--angle)) translateY(-60px) rotate(calc(-1 * var(--angle))) translateY(-14px) scale(0.65);
    }
  }
  .celebration {
    position: fixed;
    left: 50%;
    bottom: calc(140px + env(safe-area-inset-bottom));
    z-index: 60;
    pointer-events: none;
    animation: pop 1.5s ease-out forwards;
  }
  @keyframes pop {
    0% {
      opacity: 0;
      transform: translateX(-50%) scale(0.3);
    }
    18% {
      opacity: 1;
      transform: translateX(-50%) scale(1.08);
    }
    28%,
    82% {
      opacity: 1;
      transform: translateX(-50%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateX(-50%) scale(0.9);
    }
  }
  .unlock-back {
    position: fixed;
    inset: 0;
    z-index: 70;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.4);
  }
  .unlock {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
    background: var(--container);
    border-radius: 28px;
    animation: grow 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .cheer {
    margin-top: -36px;
  }
  @keyframes grow {
    from {
      transform: scale(0.3);
    }
    to {
      transform: scale(1);
    }
  }
</style>
