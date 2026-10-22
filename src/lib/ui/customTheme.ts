import { mix, type Theme } from "./themes";

/**
 * じぶんで作るカラーテーマ（Android 版の CustomTheme・SavedThemes）。ライト・ダークそれぞれ、背景とメインの色は必ず
 * 決め、ほかは null（自動で決める）にできる。名前を付けて 20 個まで、このブラウザに保存する（Android 版も端末ごと）。
 */

export interface CustomPalette {
  background: string;
  primary: string;
  accent: string | null;
  text: string | null;
  subText: string | null;
  surface: string | null;
  border: string | null;
  buttonText: string | null;
}
export interface SavedTheme { id: string; name: string; light: CustomPalette; dark: CustomPalette }

export const LIMIT = 20;
export const NAME_LIMIT = 30;
const STORAGE_KEY = "custom-themes";
const auto = { accent: null, text: null, subText: null, surface: null, border: null, buttonText: null };
/** 最初は「そら」と同じ見た目から。 */
export const DEFAULT_LIGHT: CustomPalette = { background: "#F8F9FB", primary: "#568DAA", ...auto };
export const DEFAULT_DARK: CustomPalette = { background: "#14181C", primary: "#9BC7DF", ...auto };

export const SLOTS: { key: keyof CustomPalette; label: string; hint: string; optional: boolean }[] = [
  { key: "background", label: "背景", hint: "画面の地の色", optional: false },
  { key: "primary", label: "メインの色", hint: "ボタン・リンク・選択中の印", optional: false },
  { key: "accent", label: "アクセントの色", hint: "選択中のチップなど小さな部分", optional: true },
  { key: "text", label: "文字", hint: "本文や名前", optional: true },
  { key: "subText", label: "補助の文字", hint: "時刻・説明・操作アイコン", optional: true },
  { key: "surface", label: "カード・チップの背景", hint: "引用や入力欄などの面", optional: true },
  { key: "border", label: "枠線", hint: "区切り線や枠", optional: true },
  { key: "buttonText", label: "ボタンの文字", hint: "メインの色のボタンに乗る文字", optional: true },
];

const HEX = /^#[0-9A-Fa-f]{6}$/;

function luminance(hex: string) {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 自動の色を決める（Android 版の CustomPalette.resolve と同じ）。 */
export function resolvePalette(p: CustomPalette, dark: boolean): Required<{ [K in keyof CustomPalette]: string }> {
  const text = p.text ?? (luminance(p.background) > 0.4 ? "#1E2328" : "#E8EBEE");
  return {
    background: p.background,
    primary: p.primary,
    accent: p.accent ?? p.primary,
    text,
    subText: p.subText ?? mix(text, p.background, 0.42),
    surface: p.surface ?? mix(p.background, p.primary, dark ? 0.18 : 0.11),
    border: p.border ?? mix(p.background, text, 0.27),
    buttonText: p.buttonText ?? (luminance(p.primary) > 0.45 ? "#111111" : "#FFFFFF"),
  };
}

/** 保存したテーマを、ほかのテーマと同じ形にする（色をそのまま使う exact）。 */
export function themeOf(saved: SavedTheme): Theme {
  const light = resolvePalette(saved.light, false);
  const dark = resolvePalette(saved.dark, true);
  const plain = (r: typeof light) => ({ background: r.background, text: r.text, muted: r.subText, surface: r.surface, primary: r.primary, second: r.accent });
  return { id: `custom:${saved.id}`, label: saved.name, group: "special", light: plain(light), dark: plain(dark), exact: { light, dark } };
}

function palette(raw: unknown, fallback: CustomPalette): CustomPalette {
  const value = (raw ?? {}) as Record<string, unknown>;
  const color = (key: keyof CustomPalette) => (typeof value[key] === "string" && HEX.test(value[key] as string) ? (value[key] as string).toUpperCase() : null);
  return {
    background: color("background") ?? fallback.background,
    primary: color("primary") ?? fallback.primary,
    accent: color("accent"), text: color("text"), subText: color("subText"), surface: color("surface"), border: color("border"), buttonText: color("buttonText"),
  };
}

export function readSavedThemes(): SavedTheme[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: SavedTheme[] = [];
    for (const item of raw) {
      const value = (item ?? {}) as Record<string, unknown>;
      if (typeof value.id !== "string" || !value.id || seen.has(value.id) || typeof value.name !== "string") continue;
      seen.add(value.id);
      result.push({ id: value.id, name: value.name.slice(0, NAME_LIMIT) || "じぶんのテーマ", light: palette(value.light, DEFAULT_LIGHT), dark: palette(value.dark, DEFAULT_DARK) });
    }
    return result.slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function writeSavedThemes(themes: SavedTheme[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(themes.slice(0, LIMIT)));
  } catch {
    // 保存できなくてもこの間は使える
  }
}

/** まだ使っていない名前（じぶんのテーマ、じぶんのテーマ 2、…）。 */
export function nextName(themes: SavedTheme[], base = "じぶんのテーマ"): string {
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base} ${i}`;
    if (!themes.some((t) => t.name === name)) return name;
  }
}
