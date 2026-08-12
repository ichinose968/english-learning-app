// クライアントから /api/english/* を呼ぶときの共通のエラー文言。

/**
 * fetch はネットワーク層で失敗すると TypeError ("Failed to fetch") を投げる。
 * そのまま画面に出しても何が起きたか分からないので、接続状態を見て振り替える。
 *
 * Service Worker が動いていれば /api/* は圏外でも { error } を返すのでここまで
 * 来ないが、開発中と、登録直後でまだページが管理下に入っていない間は素の
 * TypeError が来る。
 */
export function requestErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof TypeError) {
    return typeof navigator !== "undefined" && navigator.onLine === false
      ? "オフラインです。接続を確認してからもう一度お試しください。"
      : "通信に失敗しました。接続を確認してからもう一度お試しください。";
  }
  return e instanceof Error && e.message ? e.message : fallback;
}
