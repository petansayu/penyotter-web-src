<script lang="ts">
  import { settings } from "../store/settings.svelte";
  import { DEFAULT_DARK, DEFAULT_LIGHT, LIMIT, NAME_LIMIT, nextName, resolvePalette, SLOTS, themeOf, type CustomPalette, type SavedTheme } from "./customTheme";
  import { schemeFor } from "./themes";

  /**
   * じぶんで作るカラーテーマ（Android 版の CustomThemeEditor）。名前を付けて 20 個まで。選んでいるテーマを、ライト・
   * ダークに分けて 1 色ずつ変える（背景とメインの色のほかは「自動」にできる）。
   */
  const selected = $derived(settings.savedThemes.find((t) => `custom:${t.id}` === settings.theme));
  let editingDark = $state(settings.dark);

  function create(from?: SavedTheme) {
    if (settings.savedThemes.length >= LIMIT) return;
    const theme: SavedTheme = {
      id: crypto.randomUUID(),
      name: from ? nextName(settings.savedThemes, from.name) : nextName(settings.savedThemes),
      light: { ...(from?.light ?? DEFAULT_LIGHT) },
      dark: { ...(from?.dark ?? DEFAULT_DARK) },
    };
    settings.setSavedThemes([...settings.savedThemes, theme]);
    settings.theme = `custom:${theme.id}`;
  }

  function update(change: (theme: SavedTheme) => SavedTheme) {
    if (!selected) return;
    const id = selected.id;
    settings.setSavedThemes(settings.savedThemes.map((t) => (t.id === id ? change(t) : t)));
  }

  function setColor(key: keyof CustomPalette, value: string | null) {
    update((t) => ({ ...t, [editingDark ? "dark" : "light"]: { ...t[editingDark ? "dark" : "light"], [key]: value } }));
  }

  function remove() {
    if (!selected) return;
    const id = selected.id;
    settings.setSavedThemes(settings.savedThemes.filter((t) => t.id !== id));
    settings.theme = "sky";
  }

  const palette = $derived(selected ? selected[editingDark ? "dark" : "light"] : null);
  const resolved = $derived(palette ? resolvePalette(palette, editingDark) : null);
</script>

<h3>じぶんで作る</h3>
<div class="themes">
  {#each settings.savedThemes as saved (saved.id)}
    {@const scheme = schemeFor(themeOf(saved), settings.dark)}
    <button type="button" class="theme" class:active={settings.theme === `custom:${saved.id}`} onclick={() => (settings.theme = `custom:${saved.id}`)}
      style:background={scheme.background} style:color={scheme.text}>
      <span class="swatch" style:background={scheme.primary} style:border-color={scheme.surface}></span>
      {saved.name}
    </button>
  {/each}
  <button type="button" class="theme add" disabled={settings.savedThemes.length >= LIMIT} onclick={() => create()}>＋ 新しく作る</button>
</div>
{#if settings.savedThemes.length >= LIMIT}<p class="muted">保存できるのは {LIMIT} 個までです。</p>{/if}

{#if selected && palette && resolved}
  <div class="editor">
    <label class="name"><span>テーマの名前</span><input type="text" maxlength={NAME_LIMIT} value={selected.name} oninput={(e) => { const name = e.currentTarget.value.trim(); if (name) update((t) => ({ ...t, name })); }} /></label>
    <div class="row">
      <div class="segmented" role="tablist">
        <button type="button" role="tab" class:active={!editingDark} aria-selected={!editingDark} onclick={() => (editingDark = false)}>ライト</button>
        <button type="button" role="tab" class:active={editingDark} aria-selected={editingDark} onclick={() => (editingDark = true)}>ダーク</button>
      </div>
      <button type="button" class="text" disabled={settings.savedThemes.length >= LIMIT} onclick={() => create(selected)}>複製</button>
      <button type="button" class="text danger" onclick={remove}>削除</button>
    </div>
    {#if editingDark !== settings.dark}<p class="muted">いまの画面は{settings.dark ? "ダーク" : "ライト"}なので、{editingDark ? "ダーク" : "ライト"}の色は見本だけで確かめてください。</p>{/if}
    <div class="preview" style:background={resolved.background} style:color={resolved.text} style:border-color={resolved.border}>
      <strong>見本</strong> <span style:color={resolved.subText}>3分前</span>
      <span class="chip" style:background={resolved.surface}>カード</span>
      <span class="button" style:background={resolved.primary} style:color={resolved.buttonText}>ボタン</span>
      <span style:color={resolved.accent}>●</span>
    </div>
    <ul class="slots">
      {#each SLOTS as slot (slot.key)}
        {@const value = palette[slot.key]}
        <li>
          <span class="label"><strong>{slot.label}</strong><small>{slot.hint}</small></span>
          {#if slot.optional}
            <label class="auto"><input type="checkbox" checked={value === null} onchange={(e) => setColor(slot.key, e.currentTarget.checked ? null : resolved[slot.key].toUpperCase())} />自動</label>
          {/if}
          <input type="color" value={resolved[slot.key]} disabled={slot.optional && value === null} oninput={(e) => setColor(slot.key, e.currentTarget.value.toUpperCase())} aria-label={slot.label} />
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
  }
  .theme {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    font: inherit;
    border: 2px solid var(--outline-variant);
    border-radius: 12px;
    cursor: pointer;
  }
  .theme.active {
    border-color: var(--primary);
  }
  .theme.add {
    justify-content: center;
    color: var(--primary);
    background: none;
    border-style: dashed;
  }
  .swatch {
    width: 18px;
    height: 18px;
    border: 3px solid;
    border-radius: 50%;
  }
  .muted {
    color: var(--muted);
    font-size: 0.85em;
  }
  .editor {
    display: grid;
    gap: 8px;
    margin-top: 12px;
  }
  .name {
    display: grid;
    gap: 4px;
    font-size: 0.85em;
    color: var(--muted);
  }
  .name input {
    font: inherit;
    font-size: 1.1em;
    padding: 6px 8px;
    color: var(--text);
    background: var(--background);
    border: 1px solid var(--outline);
    border-radius: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .segmented {
    display: flex;
    margin-right: auto;
  }
  .segmented button {
    padding: 4px 14px;
    font: inherit;
    color: var(--muted);
    background: none;
    border: 1px solid var(--outline);
    cursor: pointer;
  }
  .segmented button:first-child {
    border-radius: 999px 0 0 999px;
  }
  .segmented button:last-child {
    border-radius: 0 999px 999px 0;
  }
  .segmented button.active {
    color: var(--text);
    background: var(--secondary-container);
  }
  .text {
    padding: 4px 8px;
    font: inherit;
    color: var(--primary);
    background: none;
    border: none;
    cursor: pointer;
  }
  .danger {
    color: #c33;
  }
  .preview {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border: 1px solid;
    border-radius: 12px;
  }
  .chip,
  .button {
    padding: 2px 10px;
    border-radius: 999px;
  }
  .slots {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .slots li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--outline-variant);
  }
  .label {
    display: grid;
    flex: 1;
  }
  .label small {
    color: var(--muted);
    font-size: 0.75em;
  }
  .auto {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.85em;
  }
  input[type="color"] {
    width: 44px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--outline);
    border-radius: 6px;
    background: none;
  }
</style>
