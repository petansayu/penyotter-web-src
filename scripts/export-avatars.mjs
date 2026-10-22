// オリジナルアバターの描画定義を Android 版の design/avatars から書き出す。
// 実行: node scripts/export-avatars.mjs [Android 版の作業フォルダ]
//   → src/lib/avatar/art.json（生成ファイル。手で直さない）
//
// Android 版の export-kotlin.mjs と同じものを JSON にする。候補の並び順は公開鍵から選ぶときの添字なので、
// Android 版で形・候補・並び順を変えたら（生成バージョンが上がったら）ここも作り直す。

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Android 版の作業フォルダ（引数か、環境変数 PENYOTTER_ANDROID_DIR）。Android 版のソースは非公開なので、公開用のリポジトリでは使えない
const androidDir = process.argv[2] ?? process.env.PENYOTTER_ANDROID_DIR;
if (!androidDir) {
  console.error("Android 版の作業フォルダを、引数か環境変数 PENYOTTER_ANDROID_DIR で渡してください");
  process.exit(1);
}
const android = resolve(androidDir);
const avatars = join(android, "design", "avatars");
const { CHARACTERS, EXPRESSION_IDS, INK, SAFE_SCALE, drawOps } = await import(pathToFileURL(join(avatars, "generate.mjs")).href);
const { ACCENT_COLORS, PALETTE_SETS, accentsFor, palettesFor } = await import(pathToFileURL(join(avatars, "variants.mjs")).href);

const OUT = join(here, "..", "src", "lib", "avatar", "art.json");
const VERSION = "penyotter-avatar-v1";
const KIND = Object.keys(ACCENT_COLORS);
const flowerCenter = (accent) => (accent.id === "yellow" ? "#F6AE5E" : "#FFD66E");
const round = (n) => Number(n.toFixed(3));

// [役割, path, 塗るか, 線の太さ, 切り抜くか, 不透明度]
const op = (o) => [o.role, o.d, o.fill, round(o.stroke), !!o.clip, round(o.alpha)];

function character(ch) {
  const base = drawOps(ch, "normal");
  // 顔（頬・目・口）より前は表情で変わらない
  const faceStart = base.ops.findIndex((o) => o.role === "cheek");
  const palettes = palettesFor(ch);
  return {
    number: ch.id,
    slug: ch.slug,
    name: ch.name,
    accent: ch.accentKind ?? null,
    clip: base.clip,
    figure: base.ops.slice(0, faceStart).map(op),
    faces: EXPRESSION_IDS.map((e) => drawOps(ch, e).ops.slice(faceStart).map(op)),
    palettes: palettes.map((p) => PALETTE_SETS.indexOf(p)),
    accentsByPalette: ch.accentKind
      ? palettes.map((p) => accentsFor(ch.accentKind, p).map((a) => ACCENT_COLORS[ch.accentKind].colors.indexOf(a)))
      : [],
  };
}

const art = {
  generated: "node scripts/export-avatars.mjs で作り直す。手で直さない。",
  version: VERSION,
  scale: SAFE_SCALE,
  line: INK.line,
  eye: INK.eye,
  cheek: INK.cheek,
  expressions: EXPRESSION_IDS,
  palettes: PALETTE_SETS.map((p) => ({ id: p.id, background: p.bg, body: p.body })),
  accentColors: Object.fromEntries(KIND.map((k) => [k, ACCENT_COLORS[k].colors.map((a) => ({ id: a.id, color: a.hex, center: flowerCenter(a) }))])),
  characters: CHARACTERS.map(character),
};

const json = JSON.stringify(art);
writeFileSync(OUT, json);
console.log(`書き出した: ${OUT}（${art.characters.length} 種、${Math.round(json.length / 1024)} KB）`);
