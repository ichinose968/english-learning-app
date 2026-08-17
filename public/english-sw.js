/*
 * 英語学習アプリ (/english) 専用の Service Worker。
 *
 * スコープは /english だけに絞ってある。このリポジトリには / (EDINET分析)・/tasks・
 * /midterm・/analyze が同居していて、それらまでこのキャッシュ戦略に巻き込みたくない。
 * スクリプトを public 直下 (= /english-sw.js) に置いてあるので、登録側で
 * { scope: "/english" } を指定すれば絞り込める (スクリプトの位置より深いスコープは自由)。
 * /english/sw.js に置く手はスコープが /english/ になり、ページの URL である
 * /english (末尾スラッシュ無し) が前方一致しないので使えない。
 *
 * ページが Service Worker に管理されてしまえば、そのページからの fetch は
 * URL がスコープの外 (/english-words/*.json など) でもすべてここを通る。
 *
 * --- バージョンの上げ方 ---
 * VERSION      … シェル (HTML・アイコン) と /_next/static のキャッシュ。
 *                キャッシュの持ち方そのものを変えたときと、**アイコンを差し替えたとき**に上げる。
 *                アイコンはパスが同じまま中身だけ変わるので、上げないと
 *                導入済みの端末が古い絵を持ち続ける。
 * DATA_VERSION … 単語・イディオム・文法の静的JSON。**DBを再生成したら必ず上げる。**
 *                こちらは意図的に再検証しないので、上げないと古い語が残り続ける。
 */

// v2: アイコンを Eng. のロゴタイプに差し替えた
const VERSION = "v2";
// v2: C2 レベルを追加し、既存レベルにも語を足した (2026-08-17)
const DATA_VERSION = "v2";

const SHELL = `english-shell-${VERSION}`;
const ASSETS = `english-assets-${VERSION}`;
const DATA = `english-data-${DATA_VERSION}`;
const KEEP = new Set([SHELL, ASSETS, DATA]);

// ページ本体とは別に取っておくもの（HTMLは下の adoptShell が別扱いで入れる）
const SHELL_ASSET_URLS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

const SHELL_HTML_URL = "/english";

// ネットワーク待ちの上限。圏内だが極端に遅いときに、いつまでも白い画面を
// 見せずキャッシュへ落とすため
const NAV_TIMEOUT_MS = 3000;

const DATA_PREFIXES = ["/english-words/", "/english-idioms/", "/english-grammar/"];

// HTMLが読み込む JS / CSS を拾うための正規表現。Next.js は起動に要るチャンクを
// すべて <script src> と <link href> で書き出すので、属性値だけ見れば足りる
// （このアプリは next/dynamic も React.lazy も使っていないので、遅れて要求される
// チャンクは無い。使い始めたらここも直すこと）
const STATIC_REF = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;

/*
 * **HTMLは、それが読み込むチャンクを全部キャッシュできたときだけ採用する。**
 *
 * HTMLとチャンクは別のキャッシュに入っているので、素直に書くと
 * 「HTMLだけ新しい版に入れ替わり、チャンクは古い版のまま」という、
 * 一度も成立したことのない組み合わせがキャッシュに残る。
 * こうなると次にオフラインで起動したとき、HTMLは出るがスクリプトが
 * 1つも読めず、SSRの「読み込み中...」から永久に動かない
 * （オンラインに戻るまで自力で直らない）。
 *
 * 実際に起きうる筋書き: 新しい版をデプロイ → ユーザーがオンラインで開く →
 * HTML（小さい）は3秒以内に届いて採用される → チャンク（大きい）を
 * 取っている途中で画面を消す / トンネルに入る → 次の起動が圏外。
 * 回線が細いときほど起きやすい。
 *
 * 失敗したときは**シェルを更新しない**。ページ自体はネットワークから
 * 表示できている（今オンラインなのだから）ので、キャッシュは前の
 * 「HTMLとチャンクが揃った組み合わせ」を残しておくほうが安全。
 */
async function adoptShell(request, html, res) {
  const urls = [...new Set([...html.matchAll(STATIC_REF)].map((m) => m[1]))];
  const assets = await caches.open(ASSETS);
  await Promise.all(
    urls.map(async (u) => {
      if (await assets.match(u)) return;
      const r = await fetch(u);
      if (!r.ok) throw new Error(`asset ${u} -> ${r.status}`);
      await assets.put(u, r);
    }),
  );
  const shell = await caches.open(SHELL);
  await shell.put(request, res);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // addAll は1つでも失敗すると全部巻き戻るので、1件ずつ入れる
      await Promise.all(
        SHELL_ASSET_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {}),
        ),
      );
      // HTMLはチャンクとセットで採用する（上の adoptShell）。
      // ここで揃えておかないと、インストール直後に圏外へ出たユーザーが
      // 「HTMLはあるがスクリプトが無い」状態で起動して動かない
      try {
        const res = await fetch(new Request(SHELL_HTML_URL, { cache: "reload" }));
        if (res.ok) {
          await adoptShell(
            new Request(SHELL_HTML_URL),
            await res.clone().text(),
            res,
          );
        }
      } catch {
        // 次に成功した画面遷移が入れ直す
      }
      // 待機させず即座に新しい版へ入れ替える。/_next/static はハッシュ付きで
      // 別々に残るので、開いたままのページが読み込み済みのチャンクを失うことはない
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("english-") && !KEEP.has(n))
          .map((n) => caches.delete(n)),
      );
      // 初回インストールでも今開いているページを管理下に置く。
      // claim しないと、その訪問中に読み込む単語DBが1件もキャッシュされない
      await self.clients.claim();
    })(),
  );
});

// --- 戦略ごとの処理 ---

/*
 * キャッシュへの書き込みは必ず event.waitUntil に載せる。
 * respondWith はレスポンスを返した時点で解決するので、載せずに投げっぱなしにすると
 * ブラウザが Service Worker を停止したときに書き込みが取り消され、
 * 「取ったはずなのにキャッシュに無い」が起きる。単語DBは1件2〜4MBあり、
 * 書き終わるまでの時間も長い
 */
function keepAlive(event, promise) {
  event.waitUntil(promise.catch(() => {}));
  return promise;
}

// ハッシュ付きで中身が変わらないもの (/_next/static)。キャッシュ優先で一切問い合わせない
async function cacheFirst(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) keepAlive(event, cache.put(request, res.clone()));
  return res;
}

// キャッシュを即返しつつ裏で更新する。アイコンなど、更新はしたいが
// 待たせたくないもの向け
async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const update = keepAlive(
    event,
    fetch(request)
      .then(async (res) => {
        if (res.ok) await cache.put(request, res.clone());
        return res;
      })
      .catch(() => null),
  );
  if (hit) return hit;
  const res = await update;
  if (res) return res;
  return new Response("", { status: 504, statusText: "offline" });
}

// 画面遷移。オンラインなら必ず最新のHTMLを取りにいき、
// 遅い・圏外のときだけキャッシュへ落とす
async function navigationFirst(event, request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), NAV_TIMEOUT_MS),
      ),
    ]);
    if (res && res.ok) {
      // 本文を読む前にコピーを2つ取る。1つは中のチャンクを数えるため、
      // もう1つはキャッシュへ入れるため。res 自体はそのままページへ返す
      const forText = res.clone();
      const forCache = res.clone();
      keepAlive(
        event,
        forText.text().then((html) => adoptShell(request, html, forCache)),
      );
      return res;
    }
    if (res) return res;
  } catch {
    // 下のキャッシュへ
  }
  const hit =
    (await cache.match(request)) || (await cache.match(SHELL_HTML_URL));
  if (hit) return hit;
  return new Response(
    "<!doctype html><meta charset=utf-8><title>オフライン</title>" +
      "<body style=\"background:#000;color:#fff;font-family:system-ui;padding:24px\">" +
      "<p>オフラインです。接続を確認してから開き直してください。</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// APIはキャッシュしない。圏外のときだけ、呼び出し側が読める形
// ({ error }) で返して「Failed to fetch」を画面に出さないようにする
async function apiOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(
      JSON.stringify({
        error: "オフラインです。接続を確認してからもう一度お試しください。",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 他オリジン (もし増えても) はそのまま素通しする
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(apiOrOffline(request));
    return;
  }

  // ここから先は GET だけ扱う
  if (request.method !== "GET") return;

  // App Router のクライアント遷移 (RSC ペイロード) はキャッシュしない。
  // 混ぜるとHTMLとして扱われて壊れる
  if (url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationFirst(event, request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, request, ASSETS));
    return;
  }

  if (DATA_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    // 単語・文法DBは容量が大きい (合計 gzip 1.25MB) ので、起動のたびに
    // 再検証させない。更新は DATA_VERSION を上げて丸ごと入れ替える
    event.respondWith(cacheFirst(event, request, DATA));
    return;
  }

  event.respondWith(staleWhileRevalidate(event, request, SHELL));
});
