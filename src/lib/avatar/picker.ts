import { sha256 } from "@noble/hashes/sha2.js";
import { nip19 } from "nostr-tools";
import artJson from "./art.json";

export type Role = "line" | "body" | "accent" | "accentCenter" | "eye" | "cheek" | "blush" | "highlight";
/** 描く手順の1つ: [役割, SVG の path, 塗るか, 線の太さ, 本体の形で切り抜くか, 不透明度]。 */
export type AvatarOp = [Role, string, boolean, number, boolean, number];
export interface AvatarCharacter {
  number: number; slug: string; name: string; accent: string | null;
  clip: string[]; figure: AvatarOp[]; faces: AvatarOp[][];
  palettes: number[]; accentsByPalette: number[][];
}
export interface AvatarArt {
  version: string; scale: number; line: string; eye: string; cheek: string; expressions: string[];
  palettes: { id: string; background: string; body: string }[];
  accentColors: Record<string, { id: string; color: string; center: string }[]>;
  characters: AvatarCharacter[];
}
export const art = artJson as unknown as AvatarArt;

/** 公開鍵から決めた生成アバター。添字は [art] の各一覧のもの。accent は装飾のないキャラクターでは null。 */
export interface AvatarChoice { character: number; palette: number; expression: number; accent: number | null }

/** 16進64桁（大文字・前後の空白を許す）か npub を、小文字の16進にする。どちらでもなければ null。 */
export function normalize(raw: string): string | null {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  if (!value.toLowerCase().startsWith("npub1")) return null;
  try {
    const decoded = nip19.decode(value.toLowerCase());
    return decoded.type === "npub" ? decoded.data : null;
  } catch {
    return null;
  }
}

const cache = new Map<string, AvatarChoice | null>();

/**
 * プロフィール画像のない人のアバターを公開鍵から決める（Android 版の AvatarPicker と同じ結果）。不正な鍵なら null。
 *
 * 種は `"<生成バージョン>:" + 正規化した16進の公開鍵`。特性ごとに `種 + ":" + ラベル` の SHA-256 を取り、
 * 先頭8バイトを符号なしの big-endian 整数として候補数で割った余りを添字にする。
 */
export function chooseAvatar(pubkey: string): AvatarChoice | null {
  const cached = cache.get(pubkey);
  if (cached !== undefined) return cached;
  const hex = normalize(pubkey);
  const choice = hex ? pick(hex) : null;
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(pubkey, choice);
  return choice;
}

function pick(hex: string): AvatarChoice {
  const seed = `${art.version}:${hex}`;
  const character = index(seed, "character", art.characters.length);
  const ch = art.characters[character];
  const slot = index(seed, "palette", ch.palettes.length);
  const expression = index(seed, "expression", art.expressions.length);
  const options = ch.accent ? ch.accentsByPalette[slot] : null;
  const accent = options ? options[index(seed, "accent", options.length)] : null;
  return { character, palette: ch.palettes[slot], expression, accent };
}

function index(seed: string, label: string, count: number): number {
  const hash = sha256(new TextEncoder().encode(`${seed}:${label}`));
  let value = 0n;
  for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(hash[i]);
  return Number(value % BigInt(count));
}
