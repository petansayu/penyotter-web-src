import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { installDevSigner } from './lib/nostr/devSigner'
import { pwa } from './lib/store/pwa.svelte'

// テストモードだけ、使い捨ての鍵で署名する偽の NIP-07 を入れる（本番用のビルドでは何もしない）
installDevSigner()
// PWA の Service Worker（ビルドしたものだけ）
pwa.register()

// 画面の部品（あとから読むもの）が読めなかったら、1 度だけ開き直す（公開の切り替えの途中に開いていたときなど）。
// 開き直しても読めないときは、繰り返さない
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('reloaded-after-preload-error')) return
    sessionStorage.setItem('reloaded-after-preload-error', '1')
  } catch {
    return
  }
  event.preventDefault()
  location.reload()
})
window.addEventListener('load', () => {
  // 読み込めたら、次に失敗したときにまた 1 度だけ開き直せるように戻す
  setTimeout(() => {
    try {
      sessionStorage.removeItem('reloaded-after-preload-error')
    } catch {
      // 使えないブラウザでは何もしない
    }
  }, 10_000)
})

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
