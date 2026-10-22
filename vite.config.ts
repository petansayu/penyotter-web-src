import { svelte } from '@sveltejs/vite-plugin-svelte'
import { existsSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

/**
 * ビルドのとき、Service Worker（dist/sw.js）を書き出す。scripts/sw-template.js に、版（ビルドした時刻）と、
 * 先に保存しておくファイルの一覧（この版の JavaScript・CSS・アイコン・manifest）を入れる。
 */
function pwaServiceWorker(): Plugin {
  return {
    name: 'penyotter-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = [
        ...Object.keys(bundle).filter((file) => !file.endsWith('.map') && file !== 'index.html'),
        'manifest.webmanifest',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
        'icons/apple-touch-icon.png',
        'icons/favicon-48.png',
      ]
      const source = readFileSync(new URL('./scripts/sw-template.js', import.meta.url), 'utf8')
        .replace('const VERSION = "__VERSION__";', `const VERSION = "${Date.now()}";`)
        .replace('const FILES = __FILES__;', `const FILES = ${JSON.stringify(files)};`)
      if (source.includes('__VERSION__') || source.includes('__FILES__')) this.error('sw-template.js の版とファイルの一覧を入れられませんでした')
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

/**
 * ビルドのとき、使っているオープンソースソフトウェアのライセンス文をまとめて dist/licenses.txt に書き出す
 * （設定の「このアプリについて」から開く）。アイコン（Material Design Icons）は Apache License 2.0 の本文を付ける。
 */
function licenses(): Plugin {
  const packages = ['svelte', 'nostr-tools', '@noble/curves', '@noble/hashes', '@noble/ciphers', '@scure/base', 'markdown-it', 'linkify-it', 'mdurl', 'uc.micro', 'entities', 'punycode.js', 'uqr', 'emojibase-data']
  return {
    name: 'penyotter-licenses',
    apply: 'build',
    generateBundle() {
      const parts = ['ぺにょったー（Web 版）が使っているオープンソースソフトウェアのライセンス文です。', '']
      for (const name of packages) {
        const dir = new URL(`./node_modules/${name}/`, import.meta.url)
        const pkg = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8')) as { version: string; license?: string }
        const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT.txt', 'license'].map((f) => new URL(f, dir)).find((url) => existsSync(url))
        if (!file) this.error(`${name} のライセンス文が見つかりません`)
        parts.push('='.repeat(72), `${name} ${pkg.version}（${pkg.license ?? ''}）`, '='.repeat(72), readFileSync(file, 'utf8').trim(), '')
      }
      parts.push('='.repeat(72), 'Material Design Icons（Google LLC、Apache License 2.0）', '='.repeat(72),
        readFileSync(new URL('./node_modules/typescript/LICENSE.txt', import.meta.url), 'utf8').split('END OF TERMS AND CONDITIONS')[0].trim(), '')
      this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: parts.join(String.fromCharCode(10)) })
    },
  }
}

/**
 * 絵文字ピッカーのデータ（emojibase-data の日本語版）から、使う項目（絵文字・名前・種類・並び順・タグ）だけを残す。
 * 種類のないもの（地域指標の 1 文字など）と、肌の色などの部品（種類 2）は除く。
 */
function trimEmojiData(): Plugin {
  return {
    name: 'penyotter-emoji-data',
    // JSON を JavaScript に変える前に削る
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('emojibase-data') || !id.endsWith('compact.json')) return null
      const entries = (JSON.parse(code) as { unicode: string; label: string; group?: number; order?: number; tags?: string[] }[])
        .filter((e) => e.group !== undefined && e.group !== 2)
        .map(({ unicode, label, group, order, tags }) => ({ unicode, label, group, order, tags }))
      return { code: JSON.stringify(entries), map: null }
    },
  }
}

const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), trimEmojiData(), pwaServiceWorker(), licenses()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  // 静的なサイトのどこ（GitHub Pages のサブパスなど）に置いても動くように、相対パスで書き出す
  base: './',
})
