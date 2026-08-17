// この端末を表す無記名トークン。読解の生成でレート制限の単位に使う。
//
// **本人確認ではない。** クライアントが自分で作った UUID を送るだけで、
// 消せば新しいものが手に入る。目的は「同じ端末からの回数を数えること」だけで、
// 費用の天井はサーバー側の日次の総本数とIP単位が担う (lib/english/ratelimit.ts)。
//
// **アカウントは作らない。** サーバーに持つべきユーザーのデータが無く
// (学習記録は端末側が正)、アカウントを提供するとストアの審査項目
// (削除導線など) が増えるため。将来ここを本物のユーザー識別に差し替えるときも、
// 送り方 (`Authorization: Bearer`) は変わらないので呼び出し側は無傷で済む。

const KEY = "english-app-token";

// **学習記録 (IndexedDB) には入れない。** あちらは版番号つきの衝突検知と
// まとめ書きを持つ1レコードで、そこにトークンを混ぜると
// 「保存が競合した」だけでトークンまで巻き戻る。用途も寿命も違うので分ける。
// localStorage を使うのはここだけで、入るのは36文字のUUID1つ。
// 容量で溢れる心配は無い (溢れて壊れたのは背景画像込みの全記録を入れていた頃の話)。
let cached: string | null = null;

function newToken(): string {
  // crypto.randomUUID は**セキュアコンテキストでないと生えない**
  // (http:// の実機確認などで落ちる)。生成物を捨てるより、粗くても続ける
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * この端末のトークンを返す。無ければ作って保存する。
 *
 * **保存に失敗してもトークンは返す。** プライベートモードなどで
 * localStorage が使えないときに null を返すと、そのセッションが
 * 丸ごとトークン無し = IP単位の上限だけになる。
 * 保存できなくても、その起動中は同じ値を使い回せるほうがよい。
 */
export function appToken(): string {
  if (cached) return cached;
  if (typeof window === "undefined") return "";
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9._:-]+$/.test(saved) && saved.length <= 64) {
      cached = saved;
      return saved;
    }
  } catch {
    // 読めないだけなら作り直す
  }
  const token = newToken();
  cached = token;
  try {
    window.localStorage.setItem(KEY, token);
  } catch {
    // 保存できなくてもこの起動中は cached が効く
  }
  return token;
}

/** `/api/english/*` に付けるヘッダ。トークンが作れなければ何も付けない */
export function authHeaders(): Record<string, string> {
  const token = appToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
