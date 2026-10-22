# ぺにょったー Web 版

Nostr クライアント「ぺにょったー」の Web 版のソースコードです。

- アプリ: https://penyotter.pages.dev
- Android 版の配布と、外部向けの技術資料（リレーの使い方・イベントの作り方・表示の解釈）: https://github.com/petansayu/penyotter-releases

このリポジトリは、非公開のリポジトリで開発したものを区切りごとに写して公開しています。細かい変更の履歴はありません。

## できること

- 見るだけで使う（npub・nprofile・NIP-05）か、ブラウザ拡張（NIP-07）・リモート署名（NIP-46 の `bunker://`・`nostrconnect://`）でログインして使う
- ホーム（フォロー中・グローバル）、通知、検索、プロフィール、投稿の詳細、パブリックチャット（NIP-28）、DM（NIP-17、旧方式の NIP-04 も）、ブックマーク、リスト
- 投稿・返信・引用・リアクション（カスタム絵文字）・リポスト・削除、画像・動画の投稿（Blossom・NIP-96）、記事（NIP-23）、投票（NIP-88）、zap、ステータス、リレーへの下書き（NIP-37）
- フォロー・ミュート・ブックマーク・絵文字リストの書き換えは、取り直し・確認・履歴つき（取得に失敗した空の一覧で上書きしないように）
- 横長の画面ではカラム表示、PWA（ホーム画面に追加できる）

## 秘密鍵について

このアプリは秘密鍵（nsec・ncryptsec）を受け付けず、ブラウザにも保存しません。署名はブラウザ拡張（NIP-07）かリモート署名（NIP-46）に頼みます。リモート署名の接続用の鍵（利用者の秘密鍵とは別の、その場で作る鍵）は、ふだんはタブの中だけに置き、ログインのときに「このブラウザに記憶する」を選んだときだけブラウザに保存します。

## 動かす

Node 24 が要ります。

```sh
npm install
npm run dev         # http://localhost:5173
npm test            # 単体テスト（vitest）
npm run check       # 型の確認（svelte-check）
npm run build       # dist/ に静的なファイルを書き出す
npm run preview     # ビルドしたものを開く（Service Worker はビルドしたものだけで動く）
```

公開のリレーに送らずに試すときは、手元のテスト用のリレーと投稿先を使うテストモードがあります。

```sh
npm run test-relay    # 手元のテスト用リレー（ws://127.0.0.1:7777）
npm run test-blossom  # 手元のテスト用の画像の投稿先（http://127.0.0.1:7779）
npm run dev:test      # テストモード（http://localhost:5174）。テスト用リレーにだけ読み書きし、使い捨ての鍵で署名する
npm run test-bunker   # 手元のテスト用リモート署名（NIP-46）
```

`scripts/make-icons.mjs`・`scripts/export-avatars.mjs` は、非公開の Android 版のソースからアイコンとアバターの定義を作り直すためのもので、このリポジトリだけでは動きません（作ったものは `public/icons/`・`src/lib/avatar/art.json` に入っています）。

## 作り

Svelte 5（runes）＋ TypeScript ＋ Vite。鍵・NIP-19・署名の確認は nostr-tools、リレーとの接続は自前です。

| 場所 | 中身 |
|---|---|
| `src/lib/nostr/` | リレーの接続と取得（`pool.ts`）、受け取ったイベントの確かめ方（`events.ts`）、相手のリレー（`outbox.ts`）、署名役（`signer.ts`・`remoteSigner.ts`） |
| `src/lib/domain/` | 本文の読み取り・スレッド・通知・投稿の組み立てなど、画面によらない決まり（単体テストつき） |
| `src/lib/store/` | 見る人・投稿とプロフィールの保存・一覧・各画面の状態 |
| `src/lib/ui/` | 画面の部品とカラーテーマ |

リレーの読み方・イベントの作り方・表示の解釈は、Android 版の技術資料（上のリンクの `design/`）に合わせています。Web 版だけで変えたところは、コードのコメントに「Web 版だけ」と書いています。

## ライセンス

MIT License（`LICENSE`）。使っている部品のライセンスは、アプリの「設定」→「このアプリについて」で見られます（ビルドのときに `dist/licenses.txt` に書き出します）。

## 謝辞

カラム表示の操作は Rabbit（syusui-s/rabbit）を参考にさせてもらいました。ありがとうございます。
