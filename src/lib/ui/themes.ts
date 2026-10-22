/**
 * カラーテーマ（Android 版の ColorTheme・colorSchemeFor と同じ色）。CSS の変数にして :root に置く。
 * うさぎは Android 版と同じく指定の色をそのまま使う。じぶんで作るテーマは customTheme.ts。「壁紙に合わせる」は Web 版にはない。
 */

type Group = "special" | "standard" | "vivid" | "neon" | "duo";
interface Palette { background: string; text: string; muted: string; surface: string; primary: string; second?: string }
/** 色を 1 つずつ指定するテーマ（Android 版の CustomTheme）。 */
interface Exact { background: string; primary: string; accent: string; text: string; subText: string; surface: string; border?: string; buttonText?: string }

export interface Theme { id: string; label: string; group: Group; light: Palette; dark: Palette; exact?: { light: Exact; dark: Exact } }

const p = (background: string, text: string, muted: string, surface: string, primary: string, second?: string): Palette =>
  ({ background, text, muted, surface, primary, second });

export const THEMES: Theme[] = [
  {
    id: "usagi", label: "うさぎ", group: "special",
    light: p("#FFFFFF", "#2A0A2E", "#3B7EAE", "#D8FAFF", "#FF7EC7", "#FF97C3"),
    dark: p("#0A0414", "#F4ECFF", "#7796AD", "#0E2E3A", "#FFB4D2", "#E58AAF"),
    exact: {
      light: { background: "#FFFFFF", primary: "#FF7EC7", accent: "#FF97C3", text: "#2A0A2E", subText: "#3B7EAE", surface: "#D8FAFF" },
      dark: { background: "#0A0414", primary: "#FFB4D2", accent: "#E58AAF", text: "#F4ECFF", subText: "#7796AD", surface: "#0E2E3A", border: "#A1CCEA" },
    },
  },
  { id: "sky", label: "そら", group: "standard", light: p("#F8F9FB", "#20252B", "#747D87", "#EAF0F5", "#568DAA"), dark: p("#14181C", "#E2E6EA", "#9AA3AC", "#242C32", "#9BC7DF") },
  { id: "sakura", label: "さくら", group: "standard", light: p("#FBF8F9", "#2A2226", "#82747B", "#F5EAEF", "#C26A8A"), dark: p("#1A1517", "#EDE3E7", "#A8999F", "#2E2328", "#F2A7C3") },
  { id: "wakaba", label: "わかば", group: "standard", light: p("#F7FAF7", "#1F2721", "#717D74", "#E7F1E9", "#4E8F5E"), dark: p("#141A16", "#E1E8E3", "#97A39A", "#222D25", "#9BD3A8") },
  { id: "fuji", label: "ふじ", group: "standard", light: p("#F9F8FC", "#24222C", "#78748A", "#EEEBF6", "#7B6BB0"), dark: p("#17151D", "#E6E3EF", "#A19CB3", "#28243A", "#BDB2EE") },
  { id: "mikan", label: "みかん", group: "standard", light: p("#FBF9F6", "#2A241F", "#857A70", "#F4EDE5", "#C0723A"), dark: p("#1B1714", "#EDE6DF", "#A99E94", "#2E2620", "#F2B582") },
  { id: "sumi", label: "すみ", group: "standard", light: p("#FAFAFA", "#1E1E1E", "#757575", "#EEEEEE", "#4A5058"), dark: p("#121212", "#E6E6E6", "#9E9E9E", "#262626", "#C9CDD2") },
  { id: "yozora", label: "よぞら", group: "standard", light: p("#F8F9FB", "#20252B", "#747D87", "#EAF0F5", "#4F7FD0"), dark: p("#000000", "#E4E7EC", "#9097A0", "#1A1A1A", "#8FB8FF") },
  { id: "soda", label: "ソーダ", group: "vivid", light: p("#EEF9FF", "#0B2533", "#4E6C7D", "#CDEEFF", "#0088D9"), dark: p("#03141F", "#E3F4FF", "#8FB3C7", "#0B2E42", "#3FD0FF") },
  { id: "ichigo", label: "いちご", group: "vivid", light: p("#FFF3F6", "#33101C", "#85566A", "#FFD6E2", "#E0105E"), dark: p("#1F070F", "#FFE6EE", "#C28A9E", "#3F1022", "#FF5C93") },
  { id: "lemon", label: "レモン", group: "vivid", light: p("#FFFCE8", "#2B2600", "#7A6F2E", "#FFF2A8", "#A86A00"), dark: p("#1A1702", "#FFF8D6", "#BDB27A", "#3A3308", "#FFD60A") },
  { id: "tropical", label: "トロピカル", group: "vivid", light: p("#EDFFF7", "#06261C", "#4D7A6A", "#C4F4E0", "#00A37A"), dark: p("#021A14", "#DDFFF2", "#86BBA8", "#08392C", "#2BF0B4") },
  { id: "neon", label: "ネオン", group: "neon", light: p("#F6F2FF", "#1E1236", "#6E5F8F", "#E6DBFF", "#7C3AED"), dark: p("#0B0618", "#F1EAFF", "#A99BC9", "#23123F", "#00F0D0") },
  { id: "neon-pink", label: "ネオンピンク", group: "neon", light: p("#FFF0FA", "#2E0822", "#7A4A68", "#FFD1F0", "#E5007E"), dark: p("#0F0210", "#FFE8F7", "#C493B4", "#3A0A33", "#FF3DCB") },
  { id: "neon-lime", label: "ネオンライム", group: "neon", light: p("#F6FFE8", "#142200", "#52663A", "#DFFFB8", "#4C9A00"), dark: p("#060B02", "#EEFFD9", "#9DBB82", "#1A2E08", "#9DFF1F") },
  { id: "cyber", label: "サイバー", group: "duo", light: p("#FFF5FD", "#2A0A2E", "#6B4A70", "#D8FAFF", "#E0109F", "#00A9C7"), dark: p("#0A0414", "#F4ECFF", "#A79BC4", "#0E2E3A", "#FF2BD6", "#00E5FF") },
  { id: "sunset", label: "サンセット", group: "duo", light: p("#FFF7F0", "#2B1A0F", "#7A6556", "#E2E6FF", "#E8630A", "#3949D6"), dark: p("#0F0B1E", "#FFEFE3", "#B7A6C4", "#1F2350", "#FF8A3D", "#7C8CFF") },
  { id: "pop", label: "ポップ", group: "duo", light: p("#FBFFF0", "#1F1A2E", "#5E5A70", "#EADCFF", "#5AA800", "#7B2FF7"), dark: p("#0E0A1A", "#F2FFE0", "#A8A2C0", "#2A1650", "#B6FF3B", "#A66BFF") },
  { id: "coral-reef", label: "コーラルリーフ", group: "duo", light: p("#F0FFFC", "#0F2A27", "#4F6E6A", "#FFE0D6", "#00A396", "#F2643D"), dark: p("#041816", "#E0FFFB", "#8DBCB6", "#3A1A12", "#2CE8D5", "#FF8A66") },
];

export const GROUP_LABELS: Record<Group, string> = { special: "とくべつ", standard: "", vivid: "ビビッド", neon: "ネオン", duo: "反対色" };

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
/** Compose の lerp と同じ（sRGB のまま混ぜる）。 */
export const mix = (a: string, b: string, t: number) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
/** 相対輝度（Compose の luminance と同じ式）。 */
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface Scheme {
  background: string; text: string; muted: string; primary: string; onPrimary: string; secondary: string; tertiary: string;
  surface: string; surfaceLow: string; container: string; primaryContainer: string; secondaryContainer: string; outline: string; outlineVariant: string;
}

/** Android 版の colorSchemeFor（うさぎは customColorScheme）と同じ決め方で、使う色を出す。 */
export function schemeFor(theme: Theme, dark: boolean): Scheme {
  if (theme.exact) {
    const e = theme.exact[dark ? "dark" : "light"];
    const border = e.border ?? mix(e.background, e.text, 0.27);
    // 淡いボタンの文字は濃い色にする（Android 版の CustomPalette.resolve と同じ考え方）
    const buttonText = e.buttonText ?? (luminance(e.primary) > 0.3 ? (dark ? e.background : e.text) : "#FFFFFF");
    return {
      background: e.background, text: e.text, muted: e.subText, primary: e.primary, onPrimary: buttonText,
      secondary: mix(e.accent, e.subText, 0.4), tertiary: e.accent,
      surface: e.surface, surfaceLow: mix(e.background, e.surface, 0.5), container: mix(e.background, e.surface, 0.75),
      primaryContainer: mix(e.background, e.primary, 0.22), secondaryContainer: mix(e.background, e.accent, 0.26),
      outline: border, outlineVariant: mix(e.background, border, 0.45),
    };
  }
  const t = theme[dark ? "dark" : "light"];
  const tone = t.second ?? t.primary;
  const colorful = theme.group !== "standard";
  const iconTone = theme.group === "special" ? t.primary : tone;
  const muted = colorful ? mix(t.muted, iconTone, 0.5) : t.muted;
  const onPrimary = theme.group === "special" && luminance(t.primary) > 0.3 ? (dark ? t.background : t.text) : dark ? "#381E72" : "#FFFFFF";
  return {
    background: t.background, text: t.text, muted, primary: t.primary, onPrimary,
    secondary: mix(iconTone, muted, 0.4), tertiary: tone,
    surface: t.surface, surfaceLow: mix(t.background, t.surface, 0.5), container: mix(t.background, t.surface, 0.75),
    primaryContainer: mix(t.background, t.primary, 0.22), secondaryContainer: mix(t.background, tone, colorful ? 0.26 : 0.16),
    outline: mix(t.background, t.text, 0.27), outlineVariant: mix(t.background, t.text, 0.1),
  };
}

export type Mode = "system" | "light" | "dark";

/** テーマを :root の CSS 変数に置く。 */
export function applyTheme(theme: Theme, dark: boolean) {
  const scheme = schemeFor(theme, dark);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(scheme)) root.style.setProperty(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
  root.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", scheme.background);
}
