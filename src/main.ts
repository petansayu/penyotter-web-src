import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { installDevSigner } from './lib/nostr/devSigner'
import { pwa } from './lib/store/pwa.svelte'

// テストモードだけ、使い捨ての鍵で署名する偽の NIP-07 を入れる（本番用のビルドでは何もしない）
installDevSigner()
// PWA の Service Worker（ビルドしたものだけ）
pwa.register()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
