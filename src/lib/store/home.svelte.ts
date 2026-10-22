import { Feed, HOME_KINDS } from "./feed.svelte";
import { globalSource, homeSource } from "./sources";

/**
 * ホームの 2 つの一覧（フォロー中・グローバル）。どちらを出しているかは、見る人ごとにブラウザに保存する。
 * グローバルは初めて開いたときに読む。ほかの画面を開いている間も残す。
 */

export type HomeTab = "following" | "global";

class Home {
  following = $state<Feed>();
  global = $state<Feed>();
  tab = $state<HomeTab>("following");
  private pubkey: string | null = null;
  private ready = false;

  /** 見る人が決まったらすぐ呼ぶ。保存分を出す（リレーには問い合わせない）。 */
  open(pubkey: string) {
    this.close();
    this.pubkey = pubkey;
    try {
      this.tab = localStorage.getItem(`home-tab.${pubkey}`) === "global" ? "global" : "following";
    } catch {
      this.tab = "following";
    }
    const following = new Feed(HOME_KINDS, homeSource());
    this.following = following;
    void following.showSaved();
    if (this.tab === "global") this.ensureGlobal();
  }

  /** 見る人のリレーのリストとフォロー一覧を読んだら呼ぶ。 */
  start() {
    this.ready = true;
    void this.following?.start();
    void this.global?.start();
  }

  choose(tab: HomeTab) {
    this.tab = tab;
    try {
      if (this.pubkey) localStorage.setItem(`home-tab.${this.pubkey}`, tab);
    } catch {
      // 保存できなくてもこの間は使える
    }
    if (tab === "global") this.ensureGlobal();
  }

  /** グローバルで読むリレーを変えたら呼ぶ。読み直す。 */
  resetGlobal() {
    this.global?.stop();
    this.global = undefined;
    if (this.tab === "global") this.ensureGlobal();
  }

  close() {
    this.following?.stop();
    this.global?.stop();
    this.following = undefined;
    this.global = undefined;
    this.ready = false;
  }

  /** グローバルを読み始める（まだなら）。グローバルの列を開いたときにも呼ぶ。 */
  ensureGlobal() {
    if (this.global) return;
    const global = new Feed(HOME_KINDS, globalSource());
    this.global = global;
    void global.showSaved();
    if (this.ready) void global.start();
  }
}

export const home = new Home();
