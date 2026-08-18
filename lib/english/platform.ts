// ネイティブ版 (Capacitor で包んだ iOS / Android) かどうかの判定。
//
// **`@capacitor/core` を import しないこと。** このリポジトリ (claudecode) には
// Capacitor が入っておらず、入れる予定も無い。ネイティブの成果物を作るのは
// デプロイ側だけで、`components/english` と `lib/english` は両方に同じものを置く
// という決まりなので、**片方にしか無い依存を掴んだ時点でもう片方がビルドできなくなる。**
//
// Capacitor は WebView に `window.Capacitor` を注入するので、それを見れば足りる。
// 判定に使うのは `isNativePlatform()` 一択。**オリジンで判定しない**
// (Android は `https://localhost`、iOS は `capacitor://localhost` で、
// 手元の開発サーバーの `http://localhost:3100` と紛らわしい)。
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return cap?.isNativePlatform?.() === true;
}

// ---- Android の戻るボタン ----
//
// **既定では、戻るボタンを押した瞬間にアプリごと終了する。** 画面の履歴が1つも
// 無いためで、シートを開いていようがチュートリアルの途中だろうが関係なく落ちる
// (エミュレータで実測)。Android の利用者は戻るを常用するので、そのままでは出せない。
//
// **開いているものを1つずつ閉じる形にする。** 画面側は「開いている間だけ
// 閉じ方を登録する」だけでよく、どれが手前かは登録順 (後勝ち) で決まる。
// 登録が空のときだけアプリを終了する。
type BackHandler = () => void;

const backHandlers: BackHandler[] = [];

/** 開いているあいだ登録する。戻り値を呼ぶと解除。**解除を忘れると閉じられない層が残る** */
export function pushBackHandler(fn: BackHandler): () => void {
  backHandlers.push(fn);
  return () => {
    const i = backHandlers.lastIndexOf(fn);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

interface CapacitorAppPlugin {
  addListener?: (
    name: string,
    fn: () => void,
  ) => Promise<{ remove?: () => void }>;
  exitApp?: () => void;
}

function appPlugin(): CapacitorAppPlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (
    window as {
      Capacitor?: { Plugins?: { App?: CapacitorAppPlugin } };
    }
  ).Capacitor;
  return cap?.Plugins?.App ?? null;
}

/**
 * 戻るボタンの受け口を1つだけ作る。**アプリ全体で1回だけ呼ぶ**（`EnglishScreen`）。
 *
 * `@capacitor/app` を import せず `window.Capacitor.Plugins.App` から取るのは、
 * **このリポジトリに Capacitor が入っていないから**（冒頭のコメントと同じ理由）。
 * プラグインが無い環境（Web・開発）では何もしない。
 */
export function startBackButtonBridge(): () => void {
  const app = appPlugin();
  if (!app?.addListener) return () => {};
  const handle = app.addListener("backButton", () => {
    const fn = backHandlers[backHandlers.length - 1];
    if (fn) {
      fn();
      return;
    }
    // 何も開いていないときだけ、既定どおりアプリを閉じる
    app.exitApp?.();
  });
  return () => {
    handle.then((h) => h.remove?.()).catch(() => {});
  };
}
