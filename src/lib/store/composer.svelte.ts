import { home } from "./home.svelte";
import { loadRelayLists, writeRelays } from "../nostr/outbox";
import { relaySet } from "../nostr/relayUrl";
import { buildFileMetadata, buildMediaPost, MAX_ATTACHMENTS, type Attachment } from "../domain/media";
import { buildEvent, MAX_BODY, withClientTag, type ComposeMode } from "../domain/publishing";
import type { Event } from "../nostr/events";
import { publish } from "../nostr/pool";
import { SignerError } from "../nostr/signer";
import { deliveryRelays } from "./actions.svelte";
import { keepNotes, requestNote } from "./cache.svelte";
import { deleteRemoteDraft, loadRemoteDrafts, saveRemoteDraft } from "./remoteDrafts";
import type { RemoteDraft } from "../domain/drafts";
import { summary } from "./publishSummary";
import { toast } from "./toast.svelte";
import { settings } from "./settings.svelte";
import { emojis } from "./emojis.svelte";
import { uploadFile } from "./upload";
import { viewer } from "./viewer.svelte";

/**
 * 投稿欄（普通の投稿・返信・引用）。書きかけは見る人と欄（投稿、返信先・引用元ごと）ごとにブラウザに保存する。
 * 署名したイベントは受理されるまで覚え、再送では同じイベント（同じ ID・署名）を送る（技術資料 6.1）。
 * 送り先は書き込みリレー。返信・引用は、相手の読み込みリレーにも送る（ゆるアウトボックス）。
 */

type Mode = Exclude<ComposeMode, "like">;

class Composer {
  open = $state(false);
  mode = $state<Mode>("post");
  /** 返信先・引用元。 */
  target = $state<Event | undefined>(undefined);
  text = $state("");
  sending = $state(false);
  /** 結果の知らせ（「x/y リレーが受理しました」など）。 */
  message = $state<string | null>(null);
  /** 署名したが、まだどこにも受理されていないイベント。再送で同じものを送る。 */
  unsent = $state<Event | null>(null);
  /** 付けた画像・動画（アップロード済み）。書きかけとしては保存しない。 */
  attachments = $state<Attachment[]>([]);
  /** 投稿するアカウント（null ならログイン中のアカウント。Android 版の ComposerState.poster）。受理したら・閉じたら戻す。 */
  poster = $state<string | null>(null);
  /** 画像・動画の投稿の形式（kind 20・21・22。null なら普通の投稿）。 */
  mediaKind = $state<number | null>(null);
  /** アップロード中の数。 */
  uploading = $state(0);
  /** 注意書き（null なら付けない）。 */
  contentWarning = $state<string | null>(null);
  /** 消える投稿（何秒後か。null なら消えない）。 */
  expiresAfter = $state<number | null>(null);
  /** リレーの下書きから開いたとき、その下書き（受理されたら消す）。 */
  remote = $state<{ identifier: string; kind: number } | null>(null);
  /** リレーの下書きの一覧（開いたときに読む）。 */
  remoteDrafts = $state<RemoteDraft[] | null>(null);
  remoteMessage = $state<string | null>(null);
  remoteBusy = $state(false);
  /** 絵文字のパレットから入れたカスタム絵文字（送るときに emoji タグにする）。 */
  private picked: { shortcode: string; url: string }[] = [];

  /** カスタム絵文字を本文に入れたら覚える。 */
  rememberEmoji(emoji: { shortcode: string; url: string }) {
    this.picked = [emoji, ...this.picked.filter((e) => e.shortcode !== emoji.shortcode)];
  }

  setContentWarning(value: string | null) {
    this.contentWarning = value;
    this.unsent = null;
  }

  setExpiration(seconds: number | null) {
    this.expiresAfter = seconds;
    this.unsent = null;
  }

  /** 今の本文をリレーに下書きとして保存する（NIP-37。消える投稿の設定は入れない）。 */
  async saveToRelays() {
    if (!viewer.pubkey || !this.text.trim() || this.remoteBusy) return;
    this.remoteBusy = true;
    this.remoteMessage = "保存しています…";
    try {
      const template = buildEvent(viewer.pubkey, { mode: this.mode, body: this.text, target: this.target, media: this.attachments, customEmojis: [...this.picked, ...emojis.custom], contentWarning: this.contentWarning }, Math.floor(Date.now() / 1000), { clientTag: settings.clientTag });
      // 保存した下書きと今の欄は結び付けない（Android 版と同じ。続きは一覧から開いたときだけ結び付く）
      const identifier = this.remote?.identifier ?? crypto.randomUUID();
      const result = await saveRemoteDraft(identifier, template);
      this.remoteMessage = result.accepted > 0 ? `下書きをリレーに保存しました（${summary(result)}）` : summary(result);
      await this.loadDrafts(false);
    } catch (e) {
      this.remoteMessage = e instanceof Error && e.message ? e.message : "下書きをリレーに保存できませんでした";
    } finally {
      this.remoteBusy = false;
    }
  }

  /** リレーの下書きを読む。 */
  async loadDrafts(showBusy = true) {
    if (showBusy) {
      this.remoteBusy = true;
      this.remoteMessage = "読み込んでいます…";
    }
    try {
      const { drafts, failed } = await loadRemoteDrafts();
      this.remoteDrafts = drafts;
      if (showBusy) this.remoteMessage = failed > 0 ? `${failed}件の下書きを復号できませんでした` : drafts.length === 0 ? "リレーの下書きはありません" : null;
    } catch (e) {
      this.remoteMessage = e instanceof Error ? e.message : String(e);
    } finally {
      if (showBusy) this.remoteBusy = false;
    }
  }

  /** リレーの下書きの続きを書く。返信は返信先が見つかれば返信の欄で開く。 */
  async openDraft(draft: RemoteDraft) {
    const ref = draft.kind === 1111
      ? draft.tags.find((t) => t[0] === "e")?.[1]
      : (draft.tags.find((t) => t[0] === "e" && t[3] === "reply") ?? draft.tags.find((t) => t[0] === "e" && t[3] === "root"))?.[1];
    const target = ref ? await requestNote(ref) : null;
    this.show(target ? "reply" : "post", target ?? undefined);
    this.text = draft.content;
    this.contentWarning = draft.tags.find((t) => t[0] === "content-warning")?.[1] ?? null;
    this.remote = { identifier: draft.identifier, kind: draft.kind };
    this.saveDraft();
    this.remoteMessage = null;
  }

  async removeDraft(draft: RemoteDraft) {
    this.remoteBusy = true;
    try {
      const result = await deleteRemoteDraft(draft.identifier, draft.kind);
      this.remoteMessage = result.accepted > 0 ? "下書きを消しました" : summary(result);
      if (result.accepted > 0) this.remoteDrafts = (this.remoteDrafts ?? []).filter((d) => d.identifier !== draft.identifier);
      if (this.remote?.identifier === draft.identifier) this.remote = null;
    } catch (e) {
      this.remoteMessage = e instanceof Error ? e.message : String(e);
    } finally {
      this.remoteBusy = false;
    }
  }

  /** 送り先。ほかのアカウントで投稿するときは、その人の書き込みリレー（分からなければログイン中の人の）。 */
  private async relaysFor(author: string, target: Event | undefined): Promise<string[]> {
    if (author === viewer.pubkey) return this.mode === "post" ? viewer.writeRelays : deliveryRelays(target);
    await loadRelayLists([author], viewer.readRelays);
    const theirs = writeRelays(author);
    const base = theirs.length > 0 ? theirs : viewer.writeRelays;
    if (this.mode === "post") return base;
    const extra = (await deliveryRelays(target)).filter((url) => !viewer.writeRelays.includes(url));
    return relaySet([...base, ...extra]);
  }

  /** 投稿するアカウントを選ぶ。 */
  setPoster(pubkey: string | null) {
    this.poster = pubkey === viewer.pubkey ? null : pubkey;
    this.unsent = null;
  }

  /** 送れる状態か。 */
  get canSend() {
    return !this.sending && this.uploading === 0 && (!!this.text.trim() || this.attachments.length > 0) && this.remaining >= 0 && (this.mediaKind === null || this.attachments.length > 0);
  }

  /** 画像・動画を付ける（選んだ・貼り付けた・落としたファイル）。4 つまで。 */
  async attach(files: Iterable<File>) {
    const room = MAX_ATTACHMENTS - this.attachments.length - this.uploading;
    const chosen = [...files].slice(0, Math.max(0, room));
    if (chosen.length === 0) {
      this.message = `画像・動画は ${MAX_ATTACHMENTS} つまでです`;
      return;
    }
    this.message = null;
    await Promise.all(chosen.map(async (file) => {
      this.uploading++;
      try {
        const attachment = await uploadFile(file);
        this.attachments = [...this.attachments, attachment];
        this.unsent = null;
        // 画像のメタデータ（kind 1063）も送る。送れなくても添付は失敗にしない（技術資料 6.3）
        void viewer.getSigner().then((s) => s.sign(buildFileMetadata(attachment, Math.floor(Date.now() / 1000)))).then((e) => publish(viewer.writeRelays, e)).catch(() => {});
      } catch (e) {
        this.message = e instanceof Error ? e.message : String(e);
      } finally {
        this.uploading--;
      }
    }));
  }

  setMediaKind(kind: number | null) {
    this.mediaKind = kind;
    this.unsent = null;
  }

  detach(index: number) {
    this.attachments = this.attachments.filter((_, i) => i !== index);
    this.unsent = null;
    if (this.attachments.length === 0) this.mediaKind = null;
  }

  get remaining() {
    return MAX_BODY - this.text.length;
  }

  /** 書きかけの保存先（Android 版の下書きの欄と同じく、普通の投稿・返信先・引用元ごと）。 */
  private draftKey() {
    const slot = this.mode === "post" || !this.target ? "post" : `${this.mode}:${this.target.id}`;
    return viewer.pubkey ? `composer-draft.${viewer.pubkey}.${slot}` : null;
  }

  /** 欄を開く。返信・引用なら相手の投稿を渡す。 */
  show(mode: Mode = "post", target?: Event) {
    if (this.mode !== mode || this.target?.id !== target?.id) {
      this.mode = mode;
      this.target = target;
      this.unsent = null;
      this.contentWarning = null;
      this.expiresAfter = null;
      this.remote = null;
      const saved = this.draftKey();
      try {
        this.text = saved ? localStorage.getItem(saved) ?? "" : "";
      } catch {
        this.text = "";
      }
    }
    this.open = true;
    this.message = null;
  }

  hide() {
    this.open = false;
    this.poster = null;
  }

  /** 書きかけを保存する（入力のたび）。 */
  saveDraft() {
    const saved = this.draftKey();
    if (saved) {
      try {
        if (this.text) localStorage.setItem(saved, this.text);
        else localStorage.removeItem(saved);
      } catch {
        // 保存できなくても書ける
      }
    }
    // 本文を書き換えたら、前に署名したものは送らない
    this.unsent = null;
  }

  /** 署名して送る。前に署名して受理されなかったものがあれば、それを送り直す。 */
  async send() {
    if (this.sending || !viewer.pubkey) return;
    const author = this.poster ?? viewer.pubkey;
    this.sending = true;
    this.message = "署名しています…";
    const target = this.target;
    try {
      let event = this.unsent;
      if (!event) {
        const now = Math.floor(Date.now() / 1000);
        const template = this.mode === "post" && this.mediaKind !== null
          ? withClientTag(buildMediaPost(this.mediaKind, this.text, this.attachments, now, this.expiresAfter), settings.clientTag)
          : buildEvent(author, { mode: this.mode, body: this.text, target, media: this.attachments, customEmojis: [...this.picked, ...emojis.custom], contentWarning: this.contentWarning, expiresAfter: this.expiresAfter }, now, { clientTag: settings.clientTag });
        const signer = await viewer.signerFor(author);
        event = await signer.sign(template);
        this.unsent = event;
      }
      this.message = "送っています…";
      const relays = await this.relaysFor(author, target);
      const signed = event;
      const result = await publish(relays, signed, (later) => {
        if (this.unsent === null) this.message = summary(later);
      });
      this.message = summary(result);
      if (result.accepted > 0) {
        keepNotes([signed]);
        // ホームのフォロー中にもすぐ出す（自分の書き込みリレーを読んでいなくても見えるように）
        if (signed.pubkey === viewer.pubkey) home.following?.add([signed]);
        this.unsent = null;
        this.text = "";
        this.attachments = [];
        this.contentWarning = null;
        this.expiresAfter = null;
        this.mediaKind = null;
        this.poster = null;
        this.saveDraft();
        // リレーの下書きから書いた投稿が受理されたら、その下書きも消す（失敗は知らせるだけ）
        const remote = this.remote;
        this.remote = null;
        if (remote) void deleteRemoteDraft(remote.identifier, remote.kind).catch(() => toast.show("リレーの下書きを消せませんでした"));
        // 返信・引用が受理されたら、普通の投稿の欄に戻す（Android 版 0.180.0 と同じ）
        // スマホ（指で操作する画面）では、普通の投稿でも欄を閉じ、キーボードも閉じる（利用者の要望、2026-10-22）
        const touch = window.matchMedia("(pointer: coarse)").matches;
        if (this.mode !== "post" || touch) {
          this.mode = "post";
          this.target = undefined;
          this.open = false;
          this.poster = null;
          if (touch && document.activeElement instanceof HTMLElement) document.activeElement.blur();
          // 欄を閉じるので、結果はトーストで知らせる
          toast.show(this.message);
        }
      }
    } catch (e) {
      this.message = e instanceof SignerError || e instanceof Error ? e.message : String(e);
    } finally {
      this.sending = false;
    }
  }
}

export const composer = new Composer();
