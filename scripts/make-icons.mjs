// アプリのアイコン（PWA・ホーム画面・ブラウザのタブ）を、Android 版のランチャーアイコンの絵から作る。
// 実行: node scripts/make-icons.mjs [Android 版の作業フォルダ]
//   → public/icons/*.png（生成ファイル。手で直さない）
//
// 元は Android 版の app/src/main/res/drawable-nodpi/ic_launcher_art.jpg（黒い背景に水色のうさぎ、1280 四方）。
// maskable は、丸や角丸に切り抜かれても欠けないよう、絵を小さくして黒い余白を足す（安全域は中央の 80% の円）。

import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
// Android 版の作業フォルダ（引数か、環境変数 PENYOTTER_ANDROID_DIR）。Android 版のソースは非公開なので、公開用のリポジトリでは使えない
const androidDir = process.argv[2] ?? process.env.PENYOTTER_ANDROID_DIR;
if (!androidDir) {
  console.error("Android 版の作業フォルダを、引数か環境変数 PENYOTTER_ANDROID_DIR で渡してください");
  process.exit(1);
}
const android = resolve(androidDir);
const source = join(android, "app", "src", "main", "res", "drawable-nodpi", "ic_launcher_art.jpg");
const out = join(here, "..", "public", "icons");
mkdirSync(out, { recursive: true });

const black = { r: 0, g: 0, b: 0, alpha: 1 };

async function plain(size, name) {
  await sharp(source).resize(size, size).png().toFile(join(out, name));
}

/** 絵を scale の大きさにして、黒い余白で size 四方にする。 */
async function padded(size, scale, name) {
  const inner = Math.round(size * scale);
  const art = await sharp(source).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: black } })
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toFile(join(out, name));
}

await plain(192, "icon-192.png");
await plain(512, "icon-512.png");
await padded(512, 0.8, "maskable-512.png");
await plain(180, "apple-touch-icon.png");
await plain(48, "favicon-48.png");
console.log(`書き出した: ${out}`);
