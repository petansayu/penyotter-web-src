/**
 * 本文のリンクのうち、埋め込みで出せるもの（Web 版だけの機能）。サービスの公式の埋め込み用の URL（iframe）にする。
 * 埋め込みはそのサービスへ通信するので、最初は「読み込む」ボタンにし、押したとき（または設定で自動にしたとき）だけ
 * 読み込む。iframe で開ける先は、ここに書いたものだけ（public/_headers の frame-src と合わせる）。
 */

export type EmbedService = "youtube" | "x" | "spotify" | "soundcloud" | "niconico" | "vimeo" | "tiktok" | "instagram";

export interface Embed {
  service: EmbedService;
  /** 画面に出す名前（「YouTube の動画」など）。 */
  label: string;
  /** 元の URL（「元のページで開く」）。 */
  url: string;
  /** iframe の URL。X は表示の明るさを後で足す。 */
  src: string;
  /** 幅に対する高さ（16:9 なら 9/16）か、決まった高さ（ピクセル）。 */
  aspect?: number;
  height?: number;
  /** 読み込む前に出す画像（YouTube のサムネイル）。 */
  thumbnail?: string;
}

/** iframe で開いてよい先（CSP の frame-src と同じ）。 */
export const EMBED_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://platform.twitter.com",
  "https://open.spotify.com",
  "https://w.soundcloud.com",
  "https://embed.nicovideo.jp",
  "https://player.vimeo.com",
  "https://www.tiktok.com",
  "https://www.instagram.com",
];

/** 1 つの投稿に出す埋め込みの数。 */
export const MAX_EMBEDS = 2;

const SERVICE_NAMES: Record<EmbedService, string> = {
  youtube: "YouTube",
  x: "X",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  niconico: "ニコニコ動画",
  vimeo: "Vimeo",
  tiktok: "TikTok",
  instagram: "Instagram",
};
export const serviceName = (service: EmbedService) => SERVICE_NAMES[service];

/** YouTube の t=1h2m3s・90s・90 を秒に。 */
function seconds(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** URL を埋め込みにする。出せないものは null。 */
export function embedOf(raw: string): Embed | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const path = url.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com") {
    let id: string | undefined;
    let vertical = false;
    if (host === "youtu.be") id = path[0];
    else if (path[0] === "watch") id = url.searchParams.get("v") ?? undefined;
    else if (path[0] === "shorts" || path[0] === "live" || path[0] === "embed") {
      id = path[1];
      vertical = path[0] === "shorts";
    }
    if (!id || !YOUTUBE_ID.test(id)) return null;
    const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
    return {
      service: "youtube",
      label: vertical ? "YouTube ショート" : "YouTube の動画",
      url: raw,
      src: `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ""}`,
      aspect: vertical ? 16 / 9 : 9 / 16,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }

  if ((host === "x.com" || host === "twitter.com") && path[1] === "status" && /^\d{1,25}$/.test(path[2] ?? "")) {
    return { service: "x", label: `X のポスト（@${path[0]}）`, url: raw, src: `https://platform.twitter.com/embed/Tweet.html?id=${path[2]}&dnt=true`, height: 400 };
  }

  if (host === "open.spotify.com") {
    const parts = path[0]?.startsWith("intl-") ? path.slice(1) : path;
    const [type, id] = parts;
    if (["track", "album", "playlist", "episode", "show", "artist"].includes(type) && /^[A-Za-z0-9]{10,40}$/.test(id ?? "")) {
      const small = type === "track" || type === "episode";
      return { service: "spotify", label: "Spotify", url: raw, src: `https://open.spotify.com/embed/${type}/${id}`, height: small ? 152 : 352 };
    }
    return null;
  }

  if (host === "soundcloud.com" && path.length >= 2 && !["discover", "search", "you", "stream"].includes(path[0])) {
    const clean = `https://soundcloud.com/${path.join("/")}`;
    return { service: "soundcloud", label: "SoundCloud", url: raw, src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(clean)}&visual=false`, height: 166 };
  }

  const nico = host === "nicovideo.jp" || host === "sp.nicovideo.jp" ? (path[0] === "watch" ? path[1] : undefined) : host === "nico.ms" ? path[0] : undefined;
  if (nico && /^(sm|so|nm)\d{1,12}$/.test(nico)) {
    return { service: "niconico", label: "ニコニコ動画", url: raw, src: `https://embed.nicovideo.jp/watch/${nico}`, aspect: 9 / 16 };
  }

  if (host === "vimeo.com" && /^\d{1,12}$/.test(path[0] ?? "")) {
    return { service: "vimeo", label: "Vimeo の動画", url: raw, src: `https://player.vimeo.com/video/${path[0]}?dnt=1`, aspect: 9 / 16 };
  }

  if (host === "tiktok.com" && path[0]?.startsWith("@") && path[1] === "video" && /^\d{1,25}$/.test(path[2] ?? "")) {
    return { service: "tiktok", label: "TikTok の動画", url: raw, src: `https://www.tiktok.com/embed/v2/${path[2]}`, height: 740 };
  }

  if (host === "instagram.com" && (path[0] === "p" || path[0] === "reel") && /^[A-Za-z0-9_-]{5,40}$/.test(path[1] ?? "")) {
    return { service: "instagram", label: "Instagram の投稿", url: raw, src: `https://www.instagram.com/${path[0]}/${path[1]}/embed`, height: 560 };
  }

  return null;
}

/** 本文の URL から、埋め込みを MAX_EMBEDS 件まで（同じものは 1 回）。 */
export function embedsIn(text: string): Embed[] {
  const found: Embed[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'）」』】]+/g)) {
    const embed = embedOf(match[0].replace(/[.,!?。、！？)]+$/, ""));
    if (embed && !found.some((e) => e.src === embed.src)) found.push(embed);
    if (found.length >= MAX_EMBEDS) break;
  }
  return found;
}
