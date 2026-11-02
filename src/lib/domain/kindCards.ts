/**
 * このアプリが描かない種類の投稿から読み取れるもの（Android 版の KindCards）。「表示できない」だけでなく、よくある
 * タグから題名・概要・画像・リンクを拾い、よく見る種類には名前を付ける。JSON や暗号文らしい本文は出さず、
 * ほかに読めるものがなければ「非公開の記録」とする。
 */
export interface KindCard {
  kind: number;
  name: string | null;
  title: string | null;
  summary: string | null;
  image: string | null;
  links: string[];
  alt: string | null;
  private: boolean;
}

const NAMES: Record<number, string> = {
  0: "プロフィール", 3: "フォロー一覧", 4: "DM（旧式）", 5: "削除の依頼", 7: "リアクション", 8: "バッジの授与",
  13: "封をしたメッセージ", 14: "DM", 16: "リポスト", 40: "チャンネルの作成", 41: "チャンネルの情報",
  1018: "投票の回答", 1063: "ファイルの情報", 1311: "配信のチャット", 1617: "git のパッチ", 1621: "git の issue",
  1984: "通報", 1985: "ラベル", 9041: "zap の目標", 9734: "zap の依頼", 9735: "zap", 9802: "ハイライト",
  10000: "ミュート一覧", 10001: "ピン留め", 10002: "リレーリスト", 10003: "ブックマーク", 10030: "使う絵文字",
  10050: "DM 受信リレー", 13194: "ウォレットの情報", 22242: "リレーの認証", 23194: "ウォレットへの依頼",
  24133: "リモート署名", 27235: "HTTP 認証", 30000: "フォローセット", 30002: "リレーセット", 30008: "飾るバッジ",
  30009: "バッジ", 30017: "お店", 30018: "商品", 30024: "記事の下書き", 30030: "絵文字セット",
  30078: "アプリのデータ", 30311: "ライブ配信", 30315: "ステータス", 30402: "出品", 30403: "出品（下書き）",
  30617: "git のリポジトリ", 30618: "git のリポジトリの状態", 31234: "下書き", 31922: "予定（日付）",
  31923: "予定（時刻）", 31924: "カレンダー", 31925: "予定への返事", 31989: "アプリのおすすめ",
  31990: "アプリの情報", 34550: "コミュニティ", 39000: "グループの情報",
};

export function kindName(kind: number): string | null {
  if (NAMES[kind]) return NAMES[kind];
  if (kind >= 5000 && kind <= 5999) return "DVM への依頼";
  if (kind >= 6000 && kind <= 6999) return "DVM の結果";
  if (kind === 7000) return "DVM の進み具合";
  return null;
}

const BASE64ISH = /^[A-Za-z0-9+/=_\-?:]{40,}$/;

export function kindCard(kind: number, tags: string[][], content: string): KindCard {
  const tag = (...names: string[]) => {
    for (const name of names) {
      const value = tags.find((t) => t.length >= 2 && t[0] === name)?.[1]?.trim();
      if (value) return value;
    }
    return null;
  };
  const text = content.trim();
  const machine = text.startsWith("{") || text.startsWith("[");
  const sealed = !machine && text.length > 0 && (text.includes("?iv=") || (BASE64ISH.test(text) && !text.includes(" ")));
  // 本文が Markdown のこと（出品など）があるので、見出しと強調の印だけ落とす
  const prose = text && !machine && !sealed ? text.replace(/^#{1,6}\s+/gm, "").replace(/\*\*|__/g, "") : null;
  const links = [...new Set(tags.filter((t) => t.length >= 2 && (t[0] === "r" || t[0] === "url" || t[0] === "web") && t[1].startsWith("https://")).map((t) => t[1]))].slice(0, 3);
  const image = tag("image", "thumb", "picture", "banner");
  return {
    kind,
    name: kindName(kind),
    title: tag("title", "name", "subject")?.slice(0, 120) ?? null,
    summary: (tag("summary", "description") ?? prose)?.slice(0, 400) ?? null,
    image: image?.startsWith("https://") ? image : null,
    links,
    alt: tag("alt")?.slice(0, 500) ?? null,
    private: sealed || machine,
  };
}

export const kindLabel = (card: KindCard) => (card.name ? `kind ${card.kind}・${card.name}` : `kind ${card.kind}`);
export const isEmptyCard = (card: KindCard) => !card.title && !card.summary && !card.image && card.links.length === 0 && !card.alt;
/** 1 行にするとき（読めるものがなければ、種類だけ）。 */
export const kindLine = (card: KindCard) =>
  card.title ?? card.summary ?? card.alt ?? (card.private ? `非公開の記録です（${kindLabel(card)}）` : `表示できない種類の投稿です（${kindLabel(card)}）`);
