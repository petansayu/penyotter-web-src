/** 日時を指定して見るダイアログ（JumpDialog）を開いているか。「その他」・カラム表示の左の列・ホームのタブから開く。 */
class JumpDialogState {
  open = $state(false);
}
export const jumpDialog = new JumpDialogState();
