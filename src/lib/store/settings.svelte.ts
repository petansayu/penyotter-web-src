import { applyTheme, THEMES, type Mode, type Theme } from "../ui/themes";
import { readSavedThemes, themeOf, writeSavedThemes, type SavedTheme } from "../ui/customTheme";

/**
 * 見た目などの設定。ブラウザごとに保存する（Android 版の「見た目」の端末ごとの設定 AppearanceSettings と同じ項目と
 * 最初の値）。
 */

const STORAGE_KEY = "appearance";

export type TimeDisplay = "relative" | "absolute";
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

/** ♡ボタンで送る 1 タップリアクション（Android 版の ReactionChoice）。content は「+」・絵文字・`:名前:`。 */
export interface OneTap {
  content: string;
  emoji?: { shortcode: string; url: string };
}

interface Saved {
  theme: string;
  mode: Mode;
  avatarPictures: boolean;
  clientTag: boolean;
  relayAuth: boolean;
  columns: boolean;
  timeDisplay: TimeDisplay;
  textScale: TextScale;
  compactPosts: boolean;
  showAvatars: boolean;
  showClientTags: boolean;
  showStatuses: boolean;
  showImages: boolean;
  showVideos: boolean;
  revealSensitive: boolean;
  autoEmbeds: boolean;
  oneTap: OneTap;
}

const DEFAULTS: Saved = {
  theme: "sky",
  mode: "system",
  avatarPictures: true,
  clientTag: true,
  relayAuth: false,
  columns: true,
  timeDisplay: "relative",
  textScale: 1,
  compactPosts: true,
  showAvatars: true,
  showClientTags: true,
  showStatuses: true,
  showImages: true,
  showVideos: true,
  revealSensitive: false,
  autoEmbeds: false,
  oneTap: { content: "+" },
};

function readOneTap(raw: unknown): OneTap {
  if (typeof raw !== "object" || raw === null) return DEFAULTS.oneTap;
  const value = raw as Record<string, unknown>;
  const content = typeof value.content === "string" ? value.content : "";
  if (!content || content.length > 32 || /\s/.test(content)) return DEFAULTS.oneTap;
  const emoji = value.emoji as Record<string, unknown> | undefined;
  if (/^:[A-Za-z0-9_-]+:$/.test(content)) {
    const shortcode = content.slice(1, -1);
    if (emoji && emoji.shortcode === shortcode && typeof emoji.url === "string" && emoji.url.startsWith("https://")) return { content, emoji: { shortcode, url: emoji.url } };
    return DEFAULTS.oneTap;
  }
  return { content };
}

function read(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<keyof Saved, unknown>>;
    const flag = (key: keyof Saved) => (typeof saved[key] === "boolean" ? (saved[key] as boolean) : (DEFAULTS[key] as boolean));
    return {
      theme: THEMES.some((theme) => theme.id === saved.theme) || (typeof saved.theme === "string" && saved.theme.startsWith("custom:")) ? (saved.theme as string) : DEFAULTS.theme,
      mode: saved.mode === "light" || saved.mode === "dark" ? saved.mode : "system",
      avatarPictures: flag("avatarPictures"),
      clientTag: flag("clientTag"),
      relayAuth: flag("relayAuth"),
      columns: flag("columns"),
      timeDisplay: saved.timeDisplay === "absolute" ? "absolute" : "relative",
      textScale: TEXT_SCALES.includes(saved.textScale as TextScale) ? (saved.textScale as TextScale) : 1,
      compactPosts: flag("compactPosts"),
      showAvatars: flag("showAvatars"),
      showClientTags: flag("showClientTags"),
      showStatuses: flag("showStatuses"),
      showImages: flag("showImages"),
      showVideos: flag("showVideos"),
      revealSensitive: flag("revealSensitive"),
      autoEmbeds: flag("autoEmbeds"),
      oneTap: readOneTap(saved.oneTap),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

class Settings {
  theme = $state(DEFAULTS.theme);
  mode = $state<Mode>(DEFAULTS.mode);
  /** アイコン画像を読み込む。オフなら全員オリジナルアバター。 */
  avatarPictures = $state(true);
  /** 投稿にクライアントタグ（["client", "ぺにょったー", …]）を付ける。 */
  clientTag = $state(true);
  /** 認証（NIP-42）を求めるリレーに答える。最初はオフ（利用者が選んだ方式、2026-10-21）。 */
  relayAuth = $state(false);
  /** 横長の画面では、画面を縦の列（カラム）に並べる。 */
  columns = $state(true);
  /** 投稿時刻を「◯分前」で出すか、日時で出すか。 */
  timeDisplay = $state<TimeDisplay>("relative");
  /** 文字の大きさ（小・標準・大・特大）。 */
  textScale = $state<TextScale>(1);
  /** 投稿の間隔を詰める。 */
  compactPosts = $state(true);
  showAvatars = $state(true);
  /** 投稿元のクライアント名を、時刻の左に出す。 */
  showClientTags = $state(true);
  /** ステータス（kind 30315）を名前の下に出す。 */
  showStatuses = $state(true);
  /** 投稿の画像を出す（オフなら、押すと出す）。 */
  showImages = $state(true);
  showVideos = $state(true);
  /** 注意書き付きの投稿を、たたまずに出す。 */
  revealSensitive = $state(false);
  /** 埋め込み（YouTube・X など）を押さなくても読み込む（Web 版だけ。最初はオフ）。 */
  autoEmbeds = $state(false);
  oneTap = $state<OneTap>(DEFAULTS.oneTap);
  /** じぶんで作ったカラーテーマ（このブラウザに保存）。 */
  savedThemes = $state<SavedTheme[]>(readSavedThemes());
  private systemDark = $state(false);

  /** 今のテーマ（じぶんで作ったものは custom:<ID>。消えていたら「そら」）。 */
  get currentTheme(): Theme {
    if (this.theme.startsWith("custom:")) {
      const saved = this.savedThemes.find((t) => `custom:${t.id}` === this.theme);
      if (saved) return themeOf(saved);
    }
    return THEMES.find((theme) => theme.id === this.theme) ?? THEMES[1];
  }

  /** じぶんで作ったテーマを保存し直す。 */
  setSavedThemes(themes: SavedTheme[]) {
    this.savedThemes = themes;
    writeSavedThemes(themes);
  }

  constructor() {
    Object.assign(this, read());
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    this.systemDark = query.matches;
    query.addEventListener("change", (event) => (this.systemDark = event.matches));
  }

  get dark() {
    return this.mode === "dark" || (this.mode === "system" && this.systemDark);
  }

  private snapshot(): Saved {
    return {
      theme: this.theme,
      mode: this.mode,
      avatarPictures: this.avatarPictures,
      clientTag: this.clientTag,
      relayAuth: this.relayAuth,
      columns: this.columns,
      timeDisplay: this.timeDisplay,
      textScale: this.textScale,
      compactPosts: this.compactPosts,
      showAvatars: this.showAvatars,
      showClientTags: this.showClientTags,
      showStatuses: this.showStatuses,
      showImages: this.showImages,
      showVideos: this.showVideos,
      revealSensitive: this.revealSensitive,
      autoEmbeds: this.autoEmbeds,
      oneTap: this.oneTap,
    };
  }

  /** 変わるたびにテーマと文字の大きさを当て直して保存する。App から $effect で呼ぶ。 */
  apply() {
    const saved = this.snapshot();
    applyTheme(this.currentTheme, this.dark);
    document.documentElement.style.fontSize = `${15 * this.textScale}px`;
    document.documentElement.classList.toggle("compact-posts", this.compactPosts);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // 保存できなくてもこの間は使える
    }
  }
}

export const settings = new Settings();
