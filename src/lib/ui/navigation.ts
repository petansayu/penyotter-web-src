import { getContext, setContext } from "svelte";

/**
 * 画面の中のリンク（`#/e/…` `#/p/…`）の開き方。ふつうは URL の # を変える。カラム表示の列の中では、その列の中で開く
 * （列が `provideNavigator` で開き方を渡す）。replace は、今の画面を置き換える（戻ったときに同じ画面へ来ないように）。
 */

type Navigator = (href: string, options?: { replace?: boolean }) => void;

const KEY = Symbol("navigator");

export function provideNavigator(navigator: Navigator) {
  setContext(KEY, navigator);
}

/** コンポーネントの初めに呼ぶ。返した関数で画面を開く。 */
export function useNavigate(): Navigator {
  return getContext<Navigator | undefined>(KEY) ?? ((href, options) => (options?.replace ? location.replace(href) : (location.hash = href)));
}
