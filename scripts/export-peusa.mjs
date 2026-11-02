// スーパーぺぇうさモードの絵を、Web 版と Android 版に書き出す。
// 実行: node scripts/export-peusa.mjs [Android 版の作業フォルダ]
//   → public/peusa/<名前>.webp（Web 版）と、Android 版の app/src/main/res/drawable-nodpi/peusa_<名前>.webp（生成ファイル。手で直さない）
//   → 顔の一覧（Web 版の src/lib/store/peusa-faces.ts と Android 版の ui/PeusaFaces.kt。生成ファイル）
//   → 背景を塗った顔の、背景を透明にした版（Android 版の design/peusa/clear/*.png。素材として残す）
//
// 元の絵は Android 版の design/peusa/*.png（利用者の描いたもの。1024 四方くらい）。場面の絵は 512、顔（アイコン）は 256 に
// 縮めて WebP にする。元の絵は Android 版のリポジトリにだけ置く。名前に英数字と - _ 以外（日本語など）があるものは、
// 書き出す名前を face-x<名前の SHA-1 の先頭 8 桁> にする（Android のリソース名に使えないため）。
// 背景が透明な絵は、黒い線がダークモードの背景に沈まないよう、絵の周りを白で縁取る（シールのように）。縁は、絵の形
// （透明でないところ）をぼかしてから濃くして広げ、白く塗ったものを絵の下に敷いて作る。背景を塗った絵はそのまま。
// ほかの人のアイコンは、face- で始まる絵のうち、季節の顔（自分のアイコン用）でないもの。増やすと、みんなの顔が
// 一度だけ入れ替わる（公開鍵を顔の数で割った余りで選ぶため）。
// 背景を塗った顔は、周りの白（ふちから続く明るいところ）を透明にした版も作り、clear-<名前> として書き出す（強の
// モードで画面の端からのぞくぺぇうさや、タブ・メニューのアイコンに使う）。元の絵を消したら、書き出した絵も消す。

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = process.argv[2] ?? process.env.PENYOTTER_ANDROID_DIR;
if (!androidDir) {
  console.error("Android 版の作業フォルダを、引数か環境変数 PENYOTTER_ANDROID_DIR で渡してください");
  process.exit(1);
}
const android = resolve(androidDir);
const source = join(android, "design", "peusa");
const clearSource = join(source, "clear");
const web = join(here, "..", "public", "peusa");
const res = join(android, "app", "src", "main", "res", "drawable-nodpi");
mkdirSync(web, { recursive: true });
mkdirSync(clearSource, { recursive: true });

/** 自分のアイコン用の季節の顔（ほかの人のアイコンには使わない）。 */
const SEASONAL = new Set(["face-plain", "face-spring", "face-summer", "face-autumn", "face-winter"]);

/** 書き出す名前（英数字と - _ だけ）。 */
function exportName(name) {
  if (/^[A-Za-z0-9_-]+$/.test(name)) return name;
  return `face-x${createHash("sha1").update(name).digest("hex").slice(0, 8)}`;
}
const resourceName = (name) => `peusa_${name.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase()}`;

/** 白い縁を付けた絵（縁の太さは大きさの 1/75 ほど）。 */
async function outlined(input, size) {
  const art = await sharp(input).resize(size, size).ensureAlpha().png().toBuffer();
  const { data: alpha } = await sharp(art).extractChannel(3).blur(size / 140).raw().toBuffer({ resolveWithObject: true });
  const halo = Buffer.alloc(size * size * 4, 255);
  for (let i = 0; i < size * size; i++) halo[i * 4 + 3] = Math.min(255, alpha[i] * 8);
  return sharp(halo, { raw: { width: size, height: size, channels: 4 } }).composite([{ input: art }]);
}

/** 背景まで塗ってある（透明なところがない）絵か。 */
async function opaque(file) {
  const { hasAlpha } = await sharp(file).metadata();
  return !hasAlpha || (await sharp(file).stats()).channels[3].min === 255;
}

/**
 * 背景を透明にした PNG。ふちから続く明るい（白っぽい）ところを背景とみなして透明にする。線で囲まれた中の白（目の光など）は
 * 残る。背景のすぐ隣の、線と背景の間の中間の色は、明るさに応じて半透明にする（線のふちが白く浮かないように）。
 */
async function cleared(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const light = (i) => Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]) >= 225;
  const background = new Uint8Array(width * height);
  const queue = [];
  for (let x = 0; x < width; x++) queue.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) queue.push(y * width, y * width + width - 1);
  while (queue.length) {
    const i = queue.pop();
    if (background[i] || !light(i)) continue;
    background[i] = 1;
    const x = i % width;
    if (x > 0) queue.push(i - 1);
    if (x < width - 1) queue.push(i + 1);
    if (i >= width) queue.push(i - width);
    if (i < width * (height - 1)) queue.push(i + width);
  }
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = data[i * 3];
    out[i * 4 + 1] = data[i * 3 + 1];
    out[i * 4 + 2] = data[i * 3 + 2];
    let alpha = 255;
    if (background[i]) {
      alpha = 0;
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 0; // 透明なところの色はそろえる（PNG が小さくなる）
    }
    else {
      const x = i % width;
      const edge = (x > 0 && background[i - 1]) || (x < width - 1 && background[i + 1]) || (i >= width && background[i - width]) || (i < width * (height - 1) && background[i + width]);
      if (edge) {
        // 白に近いほど透明に（中間の色は、黒い線を白に混ぜたものとみなす）
        const lightness = Math.min(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
        alpha = Math.max(0, Math.min(255, Math.round(((255 - lightness) / (255 - 120)) * 255)));
        if (alpha > 0) for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.round(255 - (255 - data[i * 3 + c]) * 255 / alpha));
      }
    }
    out[i * 4 + 3] = alpha;
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 9, adaptiveFiltering: true });
}

// 背景を塗った顔から、背景を透明にした版を作る（元の顔を消したら、透明にした版も消す）
const sources = readdirSync(source).filter((f) => f.endsWith(".png")).sort();
const clearNames = new Set();
for (const file of sources) {
  const name = basename(file, ".png");
  if (!name.startsWith("face-") || !(await opaque(join(source, file)))) continue;
  clearNames.add(file);
  await (await cleared(join(source, file))).toFile(join(clearSource, file));
}
for (const file of readdirSync(clearSource)) if (!clearNames.has(file)) rmSync(join(clearSource, file));

/** 書き出す絵: [元のファイル, 書き出す名前]。 */
const outputs = [
  ...sources.map((file) => [join(source, file), exportName(basename(file, ".png"))]),
  ...[...clearNames].sort().map((file) => [join(clearSource, file), `clear-${exportName(basename(file, ".png"))}`]),
];

// 元の絵を消したら、書き出した絵も消す
const names = new Set(outputs.map(([, name]) => name));
for (const file of readdirSync(web).filter((f) => f.endsWith(".webp"))) {
  if (!names.has(basename(file, ".webp"))) rmSync(join(web, file));
}
const resources = new Set([...names].map((name) => `${resourceName(name)}.webp`));
for (const file of readdirSync(res).filter((f) => f.startsWith("peusa_") && f.endsWith(".webp"))) {
  if (!resources.has(file)) rmSync(join(res, file));
}

const faces = [];
const clears = [];
for (const [path, name] of outputs) {
  const face = name.startsWith("face-") || name.startsWith("clear-");
  const size = face ? 256 : 512;
  const image = (await opaque(path))
    ? sharp(path).resize(size, size).removeAlpha().webp({ quality: 88, effort: 4 })
    : (await outlined(path, size)).webp({ quality: 88, alphaQuality: 100, effort: 4 });
  const resource = resourceName(name);
  const buffer = await image.toBuffer();
  await sharp(buffer).toFile(join(web, `${name}.webp`));
  await sharp(buffer).toFile(join(res, `${resource}.webp`));
  if (name.startsWith("face-") && !SEASONAL.has(name)) faces.push(name);
  if (name.startsWith("clear-")) clears.push(name);
  console.log(`${basename(path)} → peusa/${name}.webp, ${resource}.webp`);
}
faces.sort();
clears.sort();

const list = (items, indent, format) => items.map((item) => `${indent}${format(item)},`).join("\n");
writeFileSync(
  join(here, "..", "src", "lib", "store", "peusa-faces.ts"),
  `// scripts/export-peusa.mjs が書き出す（手で直さない）。\n\n/** ほかの人のアイコンにするぺぇうさの顔。 */\nexport const PEUSA_FACES = [\n${list(faces, "  ", (f) => `"${f}"`)}\n];\n\n/** 背景を透明にした顔（強のモードの、のぞくぺぇうさ・タブとメニューのアイコン）。 */\nexport const PEUSA_CLEAR = [\n${list(clears, "  ", (f) => `"${f}"`)}\n];\n`,
);
writeFileSync(
  join(android, "app", "src", "main", "java", "app", "pestr", "reader", "ui", "PeusaFaces.kt"),
  `// Written by the Web version's scripts/export-peusa.mjs; do not edit by hand.\npackage app.pestr.reader.ui\n\nimport app.pestr.reader.R\n\n/** ぺぇうさ's faces for everyone else's icon. */\ninternal val peusaFaces = listOf(\n${list(faces, "    ", (f) => `R.drawable.${resourceName(f)}`)}\n)\n\n/** The faces without their background (the strong mode: ぺぇうさ peeking in, the tab and menu icons). */\ninternal val peusaClearFaces = listOf(\n${list(clears, "    ", (f) => `R.drawable.${resourceName(f)}`)}\n)\n`,
);
console.log(`ほかの人の顔: ${faces.length} 種類、背景を透明にした顔: ${clears.length} 種類`);
