import { SvelteMap } from "svelte/reactivity";
import { decodeWatches, putWatch, type WatchRule } from "../domain/watchedPosts";

/**
 * 投稿のお知らせのルール（Android 版の PostWatchStore）。見る人ごとに localStorage の `post-watch.<公開鍵>` に置き、
 * リレーには送らない。「別の人に切り替える」で消す。
 */
class PostWatch {
  private readonly byOwner = new SvelteMap<string, WatchRule[]>();

  rules(me: string): WatchRule[] {
    const known = this.byOwner.get(me);
    if (known) return known;
    let rules: WatchRule[] = [];
    try {
      rules = decodeWatches(localStorage.getItem(`post-watch.${me}`));
    } catch {
      // 読めなければ空
    }
    this.byOwner.set(me, rules);
    return rules;
  }

  /** 足す・変える。足せないときは知らせる文の Error を投げる。 */
  put(me: string, rule: WatchRule) {
    this.save(me, putWatch(this.rules(me), rule));
  }

  remove(me: string, pubkey: string) {
    this.save(me, this.rules(me).filter((rule) => rule.pubkey !== pubkey));
  }

  private save(me: string, rules: WatchRule[]) {
    try {
      localStorage.setItem(`post-watch.${me}`, JSON.stringify(rules));
    } catch {
      throw new Error("お知らせの設定を保存できませんでした");
    }
    this.byOwner.set(me, rules);
  }
}

export const postWatch = new PostWatch();
