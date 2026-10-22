/**
 * 隠しメッセージ（セクシー餃子。Android 版の HiddenMessages、元は Amethyst の secret emoji）。見える文字の後ろに、
 * UTF-8 の 1 バイトを異体字セレクタ 1 文字にして隠す。0〜15 は VS1〜VS16、16〜255 は VS17〜VS256。0〜15 を U+E00F0
 * からに置く書き方も読む。1 文字だけの VS1〜16 や、漢字の後ろの 1 文字（IVS）、壊れた UTF-8、制御文字だけのものは
 * 隠しメッセージとみなさない。
 */

const VS_START = 0xfe00;
const VS_END = 0xfe0f;
const SHIFTED_START = 0xe00f0;
const SUPPLEMENT_START = 0xe0100;
const SUPPLEMENT_END = 0xe01ef;

function byteOf(codePoint: number): number | null {
  if (codePoint >= VS_START && codePoint <= VS_END) return codePoint - VS_START;
  if (codePoint >= SHIFTED_START && codePoint < SUPPLEMENT_START) return codePoint - SHIFTED_START;
  if (codePoint >= SUPPLEMENT_START && codePoint <= SUPPLEMENT_END) return codePoint - SUPPLEMENT_START + 16;
  return null;
}

const IDEOGRAPH = /\p{Ideographic}/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /^[\u0000-\u001f\u007f-\u009f]*$/;
const decoder = new TextDecoder("utf-8", { fatal: true });

export type HiddenPiece = { type: "text"; text: string } | { type: "hidden"; visible: string; message: string };

/** 隠しメッセージがあるかもしれないか（毎回の描画で呼んでよい軽さ）。U+DB40 は U+E00F0〜U+E01EF の上位サロゲート。 */
export function mightHide(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit === 0xdb40 || (unit >= VS_START && unit <= VS_END)) return true;
  }
  return false;
}

/** 文を、ふつうの部分と隠しメッセージ（見える文字とメッセージ）に分ける。セレクタは見せない。 */
export function splitHidden(text: string): HiddenPiece[] {
  if (!mightHide(text)) return [{ type: "text", text }];
  const chars = [...text];
  const pieces: HiddenPiece[] = [];
  let consumed = 0; // pieces に入れ終えた位置
  let visibleStart = 0; // 見える文字の始まり（空白の次か、前の隠しメッセージの次）
  let i = 0;
  while (i < chars.length) {
    const code = chars[i].codePointAt(0)!;
    if (byteOf(code) === null) {
      if (/\s/.test(chars[i])) visibleStart = i + 1;
      i++;
      continue;
    }
    const runStart = i;
    const bytes: number[] = [];
    while (i < chars.length) {
      const b = byteOf(chars[i].codePointAt(0)!);
      if (b === null) break;
      bytes.push(b);
      i++;
    }
    const message = decode(bytes, code, runStart > 0 ? chars[runStart - 1] : null);
    if (message === null) continue;
    const start = Math.max(visibleStart, consumed);
    if (start > consumed) pieces.push({ type: "text", text: chars.slice(consumed, start).join("") });
    pieces.push({ type: "hidden", visible: chars.slice(start, runStart).join(""), message });
    consumed = i;
    visibleStart = i;
  }
  if (consumed < chars.length) pieces.push({ type: "text", text: chars.slice(consumed).join("") });
  return pieces;
}

function decode(bytes: number[], first: number, before: string | null): string | null {
  if (bytes.length === 1 && ((first >= VS_START && first <= VS_END) || (before !== null && IDEOGRAPH.test(before)))) return null;
  try {
    const message = decoder.decode(new Uint8Array(bytes));
    return CONTROL.test(message) ? null : message;
  } catch {
    return null;
  }
}

/** 隠しメッセージのセレクタを除いた、見える文（長さの判定など）。 */
export function visibleText(text: string): string {
  return splitHidden(text).map((piece) => (piece.type === "text" ? piece.text : piece.visible)).join("");
}

/** 投稿欄で 1 タップで入れる見える文字。 */
export const DUMPLING = "🥟";
/** 投稿欄で隠せるメッセージの長さ（UTF-8 のバイト数。1 バイトが本文の 2 文字になる）。 */
export const MAX_HIDDEN_BYTES = 2000;

/** visible の後ろに message を隠す（Android 版の HiddenMessages.encode、Amethyst と同じ書き方）。 */
export function encodeHidden(visible: string, message: string): string {
  let result = visible;
  for (const byte of new TextEncoder().encode(message)) result += String.fromCodePoint(byte < 16 ? VS_START + byte : SUPPLEMENT_START + byte - 16);
  return result;
}
