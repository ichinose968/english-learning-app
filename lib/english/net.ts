// クライアントから /api/english/* を呼ぶときの共通処理 (URLの解決とエラー文言)。

/**
 * `/api/english/*` の絶対URLを作る。
 *
 * **Capacitor でストアに出すと、アプリのオリジンは `capacitor://localhost`
 * (Android は `https://localhost`) になり、APIは Vercel に残る。**
 * 相対パスのままだと同梱物の中を探しにいって必ず失敗するので、
 * ビルド時に `NEXT_PUBLIC_API_BASE` を渡して前置する。
 *
 * **PWA と開発では空のままにする。** 同一オリジンなので相対パスで正しく、
 * わざわざ絶対URLにすると CORS を通る経路が増えるだけで何も得しない。
 *
 * 単語・イディオム・文法の静的JSON (worddb.ts / grammardb.ts) はここを通さない。
 * あれはネイティブ版でも同梱物として端末内にあるので、相対のままが正しい。
 */
export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? "";
  if (!base) return path;
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * 公開サイト上のページ (プライバシーポリシー / サポート) のURL。
 *
 * **同梱物ではなく公開URLを開く。** ネイティブ版は端末内に写しを持っているが、
 * そちらを開くと**文面を直しても古いものが残り、ストアの掲載URLと食い違う**。
 * 審査でも見られる項目なので、常に配信中のものを見せる。
 * PWA と開発では `apiUrl` と同じく相対パスのままにする (同一オリジンなので正しい)。
 */
export function siteUrl(path: string): string {
  return apiUrl(path);
}

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

// APIがJSON以外を返したときの文言。**必ずHTTPステータスを混ぜる。**
// ユーザーは何も分からなくても、報告してもらえれば原因が一意に絞れる
function statusMessage(status: number): string {
  if (status === 429)
    return "リクエストが集中しています。少し待ってからもう一度お試しください。";
  if (status === 503)
    return "今は生成の受付を停止しています。時間をおいてもう一度お試しください。";
  if (status === 504 || status === 408)
    return `生成に時間がかかりすぎました。文章の長さを短くしてお試しください。(HTTP ${status})`;
  if (status === 404)
    return `生成サーバーに接続できませんでした。アプリを再起動してお試しください。(HTTP ${status})`;
  if (status >= 500)
    return `サーバー側でエラーが発生しました。時間をおいてお試しください。(HTTP ${status})`;
  return `リクエストが受け付けられませんでした。(HTTP ${status})`;
}

/**
 * `/api/english/*` の応答を読む。**`res.json()` を直に呼んではいけない。**
 *
 * 元は `await res.json()` を裸で呼んでいたので、本文がJSONでないときに
 * SyntaxError が投げられ、`requestErrorMessage` が TypeError しか振り替えない
 * ため **JSのパースエラーの文面がそのまま画面の赤字に出ていた**。
 * これは例外的な経路ではなく、
 *   - maxDuration (120秒) 超えの 504（HTML が返る）
 *   - デプロイ中の 404（HTML）
 *   - 未捕捉例外の 500（本文0バイト。実測済み）
 *   - レート制限の 429 / 503
 * が全部ここを通る。
 *
 * 成功時だけパース済みの本体を返し、それ以外は読める文言にして throw する。
 * 呼び出し側は今までどおり catch して `requestErrorMessage` に渡せばよい。
 */
export async function readApiJson<T>(
  res: Response,
  fallback: string,
): Promise<T> {
  // .json() ではなく .text() で受けてから自分でパースする。
  // 中身がHTMLでも空でもここで例外にならない
  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const apiError =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { error?: unknown }).error
      : undefined;

  // サーバーが用意した文言が読めたときは、それを最優先で出す
  if (typeof apiError === "string" && apiError) throw new Error(apiError);
  if (!res.ok) throw new Error(statusMessage(res.status));
  // 200 なのに中身がJSONでない場合 (SWやプロキシがHTMLを返したときなど)。
  // **配列も弾く。** `typeof [] === "object"` なので、素直に書くと素通りして
  // 呼び出し側で `result.passageEn` が undefined のまま保存されてしまう
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(fallback);
  }
  return parsed as T;
}
