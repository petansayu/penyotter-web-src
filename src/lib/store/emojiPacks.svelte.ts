import { setReferences, type CustomEmoji } from "../domain/emojis";
import { MAX_FOLLOWED, MAX_LISTED, newestPacks, packAddressIn, packsContaining, packsNamed, popularReferences, type EmojiPack } from "../domain/emojiPacks";
import { latest, newer, type Event } from "../nostr/events";
import { fetchFromAuthor, fetchFromAuthors } from "../nostr/outbox";
import { eventsOf } from "../nostr/pool";
import { emojis } from "./emojis.svelte";
import { viewer } from "./viewer.svelte";

/** 開いている絵文字の画面（Android 版の EmojiPackLookup）。emoji がなければ、リンクから開いたパック。 */
export interface EmojiPackLookup {
  emoji: CustomEmoji | null;
  loading: boolean;
  packs: EmojiPack[];
  /** packs は画像の URL ではなく名前が同じ絵文字のパック（画像が違うことがある）。 */
  similar: boolean;
  /** 探している途中は、今どこを探しているか。終わったら、見つからなかったときの知らせ。 */
  message: string | null;
}

/**
 * 見かけたカスタム絵文字のパックを探す（Android 版の ComposerController.lookupEmojiPack）。画像の URL が同じ絵文字を、
 * emoji タグの 4 つめが指すパック → 使った人の絵文字リスト（kind 10030）のパック（60 件まで）→ 使った人が作った
 * パック → 自分とフォロー中の人の絵文字リストのパック（指している人の多い順に 150 件まで。ほかの人の絵文字を借りて
 * リアクションした人のため）の順に探す。どこにもなければ、それまでに読んだパックから名前が同じ絵文字を探す
 * （画像の URL が変わった絵文字のため）。
 */
class EmojiPacks {
  current = $state<EmojiPackLookup | null>(null);
  private run = 0;

  close() {
    this.run++;
    this.current = null;
  }

  /** 投稿・リアクションの絵文字から開く。tags はその絵文字があったイベントのタグ、owner は使った人。 */
  open(emoji: CustomEmoji, tags: string[][], owner: string | null) {
    const run = ++this.run;
    this.current = { emoji, loading: true, packs: [], similar: false, message: null };
    if (viewer.canSign) void emojis.load();
    const stage = (message: string) => {
      if (run === this.run && this.current) this.current = { ...this.current, message };
    };
    void this.find(emoji, tags, owner, stage).then(
      ({ packs, similar }) => run === this.run && (this.current = { emoji, loading: false, packs, similar, message: packs.length ? null : "この絵文字が入っているパックは見つかりませんでした" }),
      () => run === this.run && (this.current = { emoji, loading: false, packs: [], similar: false, message: "パックを探せませんでした" }),
    );
  }

  /** naddr のリンク（kind 30030）から開く。 */
  openAt(author: string, identifier: string, hints: string[] = []) {
    const run = ++this.run;
    this.current = { emoji: null, loading: true, packs: [], similar: false, message: null };
    if (viewer.canSign) void emojis.load();
    void this.fetchPack(author, identifier, hints).then(
      (packs) => run === this.run && (this.current = { emoji: null, loading: false, packs, similar: false, message: packs.length ? null : "絵文字パックが見つかりませんでした" }),
      () => run === this.run && (this.current = { emoji: null, loading: false, packs: [], similar: false, message: "パックを探せませんでした" }),
    );
  }

  private async fetchPack(author: string, identifier: string, hints: string[] = []): Promise<EmojiPack[]> {
    const fetched = await fetchFromAuthor(author, [{ kinds: [30030], authors: [author], "#d": [identifier], limit: 5 }], viewer.readRelays, hints);
    return newestPacks(eventsOf(fetched).filter((e) => e.pubkey === author));
  }

  /** 絵文字リストが指すパック（作った人の書き込みリレーと読み込みリレーから）。 */
  private async fetchPacks(refs: { author: string; identifier: string }[]): Promise<EmojiPack[]> {
    if (refs.length === 0) return [];
    const authors = [...new Set(refs.map((r) => r.author))];
    const fetched = await fetchFromAuthors(authors, { kinds: [30030], "#d": [...new Set(refs.map((r) => r.identifier))], limit: Math.min(500, refs.length * 2) }, viewer.readRelays);
    const wanted = new Set(refs.map((r) => `30030:${r.author}:${r.identifier}`));
    return newestPacks(eventsOf(fetched)).filter((p) => wanted.has(p.address));
  }

  private async find(emoji: CustomEmoji, tags: string[][], owner: string | null, stage: (message: string) => void): Promise<{ packs: EmojiPack[]; similar: boolean }> {
    const seen = new Map<string, EmojiPack>();
    const withUrl = (packs: EmojiPack[]) => {
      for (const pack of packs) seen.set(pack.address, pack);
      return packsContaining(packs, emoji.url);
    };
    const named = packAddressIn(tags, emoji.url);
    if (named) {
      const found = withUrl(await this.fetchPack(named.author, named.identifier));
      if (found.length > 0) return { packs: found, similar: false };
    }
    if (owner) {
      stage("使った人の絵文字リストから探しています…");
      const list = latest(eventsOf(await fetchFromAuthor(owner, [{ kinds: [10030], authors: [owner], limit: 5 }], viewer.readRelays)).filter((e) => e.pubkey === owner));
      const listed = withUrl(await this.fetchPacks(list ? setReferences(list).slice(0, MAX_LISTED) : []));
      if (listed.length > 0) return { packs: listed, similar: false };
      const own = await fetchFromAuthor(owner, [{ kinds: [30030], authors: [owner], limit: 50 }], viewer.readRelays);
      const made = withUrl(newestPacks(eventsOf(own).filter((e) => e.pubkey === owner)));
      if (made.length > 0) return { packs: made, similar: false };
    }
    const people = [...new Set([viewer.pubkey, ...viewer.follows])].filter((p): p is string => !!p && p !== owner).slice(0, 500);
    if (people.length > 0) {
      stage("フォロー中の人の絵文字リストからも探しています…");
      const fetched = await fetchFromAuthors(people, { kinds: [10030] }, viewer.readRelays);
      const lists = [...latestByAuthor(eventsOf(fetched).filter((e) => e.kind === 10030)).values()];
      const refs = popularReferences(lists, MAX_FOLLOWED + seen.size).filter((r) => !seen.has(`30030:${r.author}:${r.identifier}`)).slice(0, MAX_FOLLOWED);
      const found = withUrl(await this.fetchPacks(refs));
      if (found.length > 0) return { packs: found, similar: false };
    }
    return { packs: packsNamed([...seen.values()], emoji.shortcode), similar: true };
  }
}

/** 人ごとにいちばん新しいイベント。 */
function latestByAuthor(events: Event[]): Map<string, Event> {
  const result = new Map<string, Event>();
  for (const event of events) if (newer(event, result.get(event.pubkey))) result.set(event.pubkey, event);
  return result;
}

export const emojiPacks = new EmojiPacks();
