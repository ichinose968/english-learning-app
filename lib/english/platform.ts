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
