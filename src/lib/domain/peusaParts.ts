/**
 * スーパーぺぇうさモードが変えるところ（部品）と強さ（Android 版の PeusaPart・PeusaLevel と同じ）。弱・中・強は
 * 決まった組で、かすたむは部品を一つずつ選ぶ。
 */
export const PEUSA_PARTS = [
  { id: "theme", label: "ぺぇうさの色" },
  { id: "othersAvatars", label: "みんなのアイコン" },
  { id: "ownAvatar", label: "自分のアイコン（季節のぺぇうさ）" },
  { id: "channelIcons", label: "チャンネルのアイコン" },
  { id: "appIcons", label: "画面下のタブとメニューのアイコン" },
  { id: "peek", label: "画面下からのぞくぺぇうさ" },
  { id: "hearts", label: "押すと飛び散るハート" },
  { id: "celebration", label: "投稿・リアクション・リポストのときのぺぇうさ" },
  { id: "mood", label: "ホームの上の時間のぺぇうさ" },
  { id: "placeholders", label: "読み込み中と空の画面のぺぇうさ" },
  { id: "snackbar", label: "うまくいかなかったときの「なんてこと!!」" },
  { id: "partyEmoji", label: "隠しメッセージの :party_pe:" },
] as const;

export type PeusaPart = (typeof PEUSA_PARTS)[number]["id"];
export type PeusaLevel = "weak" | "medium" | "strong" | "custom";
export const PEUSA_LEVELS: [PeusaLevel, string][] = [["weak", "弱"], ["medium", "中"], ["strong", "強"], ["custom", "かすたむ"]];

const BASE: PeusaPart[] = ["theme", "celebration", "mood", "placeholders", "snackbar", "partyEmoji"];
const ALL = PEUSA_PARTS.map((part) => part.id) as PeusaPart[];

/** 強さごとの部品。かすたむは custom（選んだもの）。 */
export function peusaPartsOf(level: PeusaLevel, custom: readonly PeusaPart[]): Set<PeusaPart> {
  switch (level) {
    case "weak":
      return new Set(BASE);
    case "medium":
      return new Set([...BASE, "othersAvatars", "ownAvatar"]);
    case "strong":
      return new Set(ALL);
    case "custom":
      return new Set(custom);
  }
}

/** 保存した部品を読む（知らないものは除く）。まだ選んでいなければ中と同じ。 */
export function readPeusaCustom(saved: unknown): PeusaPart[] {
  if (!Array.isArray(saved)) return [...peusaPartsOf("medium", [])];
  return ALL.filter((part) => saved.includes(part));
}
