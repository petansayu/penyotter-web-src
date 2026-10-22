/** 画面の下に少しの間だけ出す知らせ（送信の結果など）。 */
class Toast {
  message = $state<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string, ms = 4000) {
    this.message = message;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => (this.message = null), ms);
  }
}

export const toast = new Toast();
