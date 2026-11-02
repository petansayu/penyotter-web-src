/**
 * 本文のカラーコード（Android 版の ColorCodes）。# のあとの 16 進が 6・8 桁ならいつも色、3・4 桁（#fff・#cafe）は、
 * 投稿の t タグ（ハッシュタグ）にあるときと、4 桁の数字だけ（#2026 のような年）のときを除いて色。
 */
export interface ColorCode { code: string; css: string; alpha: number }

export function colorOf(digits: string, tags: string[][]): ColorCode | null {
  if (!/^[0-9a-fA-F]+$/.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return null;
  if (digits.length <= 4 && tags.some((t) => t.length >= 2 && t[0] === "t" && t[1].toLowerCase() === digits.toLowerCase())) return null;
  if (digits.length === 4 && /^\d+$/.test(digits)) return null;
  const full = digits.length <= 4 ? [...digits].map((c) => c + c).join("") : digits;
  const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
  return { code: `#${digits}`, css: `#${full}`, alpha };
}
