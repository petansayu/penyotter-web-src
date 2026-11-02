/** ミニアプリの一覧（MiniAppsDialog）を開いているか。「その他」とカラム表示の左の列から開く。 */
class MiniAppsDialogState {
  open = $state(false);
}
export const miniAppsDialog = new MiniAppsDialogState();
