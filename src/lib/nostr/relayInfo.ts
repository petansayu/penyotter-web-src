/**
 * リレーの情報（NIP-11、技術資料 10.6、Android 版の RelayInfoService・RelayDetails）。リレーの URL を https に置き換えて
 * `Accept: application/nostr+json` で読む。応答は 128KB まで、5 秒で打ち切る。検索リレーが NIP-50 に対応しているか・
 * 有料か・認証が必要かを見分けるのと、リレーの情報画面に使う。読めなければ null。この画面を開いている間は読み直さない。
 */

export interface RelayInfo { name?: string; supportedNips: number[]; authRequired: boolean; paymentRequired: boolean }

export interface RelayDetails extends RelayInfo {
  url: string;
  description: string;
  icon?: string;
  banner?: string;
  pubkey?: string;
  contact: string;
  software: string;
  version: string;
  restrictedWrites: boolean;
  limits: { label: string; value: number }[];
  countries: string[];
  languages: string[];
  tags: string[];
  links: { label: string; url: string }[];
  fees: string[];
}

const cache = new Map<string, Promise<RelayDetails | null>>();

export function relayInfo(url: string): Promise<RelayInfo | null> {
  return relayDetails(url);
}

export function relayDetails(url: string): Promise<RelayDetails | null> {
  let info = cache.get(url);
  if (!info) {
    info = load(url);
    cache.set(url, info);
  }
  return info;
}

const https = (value: unknown) => (typeof value === "string" && value.trim().startsWith("https://") ? value.trim().slice(0, 2048) : undefined);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const strings = (value: unknown, max: number) =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim().slice(0, 40)))].slice(0, max) : [];

function period(seconds: number) {
  if (seconds % 31_536_000 === 0) return `${seconds / 31_536_000}年ごと`;
  if (seconds % 2_592_000 === 0) return `${seconds / 2_592_000}か月ごと`;
  if (seconds % 86_400 === 0) return `${seconds / 86_400}日ごと`;
  return `${seconds}秒ごと`;
}

/** NIP-11 の応答を読む（リンクは https だけ、文字数を制限する）。 */
export function parseRelayDetails(url: string, raw: Record<string, unknown>): RelayDetails {
  const limitation = (typeof raw.limitation === "object" && raw.limitation ? raw.limitation : {}) as Record<string, unknown>;
  const limit = (name: string) => (Number.isInteger(limitation[name]) && (limitation[name] as number) > 0 ? (limitation[name] as number) : 0);
  const nips = Array.isArray(raw.supported_nips)
    ? [...new Set(raw.supported_nips.map((v) => (typeof v === "number" ? Math.trunc(v) : typeof v === "string" ? Number.parseInt(v, 10) : NaN)).filter((n) => n >= 0 && n <= 9999))].sort((a, b) => a - b)
    : [];
  const fees: string[] = [];
  const feeObject = (typeof raw.fees === "object" && raw.fees ? raw.fees : {}) as Record<string, unknown>;
  for (const [key, label] of [["admission", "入会"], ["subscription", "利用"], ["publication", "投稿"]] as const) {
    const list = Array.isArray(feeObject[key]) ? (feeObject[key] as unknown[]).slice(0, 5) : [];
    for (const fee of list) {
      const f = (fee ?? {}) as Record<string, unknown>;
      if (typeof f.amount !== "number" || f.amount < 0) continue;
      const seconds = typeof f.period === "number" && f.period > 0 ? f.period : 0;
      fees.push(`${label}: ${f.amount} ${text(f.unit, 10) || "msats"}${seconds ? `・${period(seconds)}` : ""}`);
    }
  }
  const software = text(raw.software, 200);
  const links = ([["posting_policy", "投稿のポリシー"], ["payments_url", "支払い"], ["terms_of_service", "利用規約"], ["privacy_policy", "プライバシー"]] as const)
    .flatMap(([key, label]) => (https(raw[key]) ? [{ label, url: https(raw[key])! }] : []));
  const pubkey = typeof raw.pubkey === "string" && /^[0-9a-f]{64}$/i.test(raw.pubkey.trim()) ? raw.pubkey.trim().toLowerCase() : undefined;
  return {
    url,
    name: text(raw.name, 120) || undefined,
    description: text(raw.description, 3000),
    icon: https(raw.icon),
    banner: https(raw.banner),
    pubkey,
    contact: text(raw.contact, 200),
    software: software.startsWith("git+https://") ? software.slice(4) : software,
    version: text(raw.version, 60),
    supportedNips: nips,
    authRequired: limitation.auth_required === true,
    paymentRequired: limitation.payment_required === true,
    restrictedWrites: limitation.restricted_writes === true,
    limits: ([["min_pow_difficulty", "必要な PoW"], ["max_message_length", "メッセージの長さの上限"], ["max_subscriptions", "購読数の上限"], ["max_content_length", "本文の長さの上限"]] as const)
      .map(([key, label]) => ({ label, value: limit(key) })).filter((l) => l.value > 0),
    countries: strings(raw.relay_countries, 20),
    languages: strings(raw.language_tags, 20),
    tags: strings(raw.tags, 20),
    links,
    fees,
  };
}

async function load(url: string): Promise<RelayDetails | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), {
      headers: { Accept: "application/nostr+json" },
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) return null;
    const body = await response.text();
    if (body.length > 128 * 1024) return null;
    const raw = JSON.parse(body) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    return parseRelayDetails(url, raw as Record<string, unknown>);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
