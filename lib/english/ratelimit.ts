// サーバー専用: 読解の生成にかける上限 (app/api/english/reading から使う)。
//
// **なぜ要るか。** このAPIは公開URLで、1回の生成が claude-opus-5 の
// max_tokens 16000 を使う。上限が無いあいだ、費用の天井は
// **Anthropic のアカウント残高そのもの**だった。ストアで配ると
// 利用料は全部リポジトリ所有者の請求になるので、ここが空いたままでは公開できない。
//
// **なぜ外部の置き場所が要るか。** route.ts はサーバーレス関数なので、
// インスタンス内の Map は並列の呼び出しどうしで共有されず、上限にならない。
// リクエストをまたいで数えられる場所が別に要る。
//
// **なぜ SDK を入れないか。** @upstash/redis は REST を fetch で叩く薄い包みで、
// ここで使うのは INCR と EXPIRE の2つだけ。依存を1つ増やすより直接書くほうが短く、
// **Upstash と Vercel KV のどちらの環境変数名でも動く**ようにできる
// (どちらを選ぶかはユーザーの都合で決まるので、コードを触らずに切り替えられるほうがよい)。

// 環境変数は2系統を受ける。Upstash を直接契約した場合と、
// Vercel のダッシュボードから足した場合で名前が違うため
function redisConfig(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export function rateLimitConfigured(): boolean {
  return redisConfig() !== null;
}

// ---- 上限の値 ----
// **費用の天井を担うのは日次の総本数だけ。** トークンは自己発行なので
// 無限に作れて、トークン単位の上限は公平性のためのものでしかない。
// IP単位はその中間で、1人が延々と回すのを止める。
//
// 数字は環境変数で動かせるようにしてある。**上げるときは費用を計算してから**
// 上げること (1本あたり入力2,000〜3,000 / 出力3,500〜7,000トークンの見積もりで
// おおよそ $0.10〜0.20)。
function limitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const LIMITS = {
  get global() {
    return limitFromEnv("READING_LIMIT_GLOBAL", 100);
  },
  get ip() {
    return limitFromEnv("READING_LIMIT_IP", 40);
  },
  get token() {
    return limitFromEnv("READING_LIMIT_TOKEN", 20);
  },
};

// 1日の区切りは UTC。**利用者がほぼ日本なので JST のほうが自然に見えるが、
// 費用は日付の切り方に依存しないうえ、UTC のほうが鍵の作り方が単純で
// 夏時間もない。** 変えるならここ1か所。
function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// 期限は「その日の残り + 余裕1時間」。固定で24時間にすると、
// 日付が変わったあとも前日の鍵が残って無駄にメモリを食う
function secondsUntilTomorrow(now: Date): number {
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.ceil((end - now.getTime()) / 1000) + 3600;
}

/**
 * INCR して、初回だけ EXPIRE を張る。
 *
 * Upstash の REST はパイプラインを配列の配列で受け取り、結果を配列で返す。
 * **EXPIRE は毎回打つのではなく、INCR の戻りが 1 のとき (= その鍵が
 * いま作られた) だけ打つ。** 毎回打つと、上限に当たり続けているあいだ
 * 期限が延び続けて日付が変わってもリセットされない。
 */
async function incrementDaily(
  cfg: { url: string; token: string },
  key: string,
  ttlSeconds: number,
  signal: AbortSignal,
): Promise<number> {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([["INCR", key]]),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const body = (await res.json()) as { result?: number; error?: string }[];
  const first = Array.isArray(body) ? body[0] : undefined;
  if (!first || typeof first.result !== "number") {
    throw new Error(`upstash unexpected response: ${JSON.stringify(body)}`);
  }
  const count = first.result;
  if (count === 1) {
    // 期限だけは失敗しても致命的でないので、待たずに投げっぱなしにしない。
    // ここで待たないと、次の呼び出しまでに張られていない可能性がある
    await fetch(`${cfg.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([["EXPIRE", key, String(ttlSeconds)]]),
      signal,
      cache: "no-store",
    }).catch(() => {});
  }
  return count;
}

export type LimitScope = "global" | "ip" | "token";

export type LimitResult =
  | { ok: true; unconfigured: boolean }
  | { ok: false; scope: LimitScope; status: number };

/**
 * 日次の上限を3種類まとめて見る。
 *
 * **置き場所が設定されていないときは通す (`unconfigured: true`)。**
 * ここで止めると、環境変数を入れ忘れた瞬間に本番のアプリが丸ごと使えなくなる。
 * 代わりに呼び出し側が毎回 console.error を出して、ログで気づけるようにしてある。
 * **ストアに出す前に必ず設定すること。**
 *
 * **Redis に届かなかったときも通す。** 一過性の障害でアプリを止める価値はない
 * (費用の最終的な天井は Anthropic Console 側の spend limit が持つ)。
 * ただし待ち続けると読解の生成そのものが遅くなるので、2秒で諦める。
 */
export async function checkReadingLimits(args: {
  ip: string | null;
  token: string | null;
  now?: Date;
}): Promise<LimitResult> {
  const cfg = redisConfig();
  if (!cfg) return { ok: true, unconfigured: true };

  const now = args.now ?? new Date();
  const day = dayKey(now);
  const ttl = secondsUntilTomorrow(now);

  // 順番が意味を持つ。**総本数を最初に見る**ので、
  // 全体の天井に当たっていれば個別の鍵を無駄に増やさない
  const checks: { scope: LimitScope; key: string; limit: number }[] = [
    { scope: "global", key: `reading:global:${day}`, limit: LIMITS.global },
  ];
  if (args.ip) {
    checks.push({ scope: "ip", key: `reading:ip:${args.ip}:${day}`, limit: LIMITS.ip });
  }
  if (args.token) {
    checks.push({
      scope: "token",
      key: `reading:token:${args.token}:${day}`,
      limit: LIMITS.token,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    for (const c of checks) {
      const count = await incrementDaily(cfg, c.key, ttl, controller.signal);
      if (count > c.limit) {
        // 総本数は運用側の都合なので 503、個人の使いすぎは 429。
        // net.ts の statusMessage がこの2つを別々の文言に振り分ける
        return {
          ok: false,
          scope: c.scope,
          status: c.scope === "global" ? 503 : 429,
        };
      }
    }
    return { ok: true, unconfigured: false };
  } catch (e) {
    console.error("[english/ratelimit] Redis に届かなかったので通した", e);
    return { ok: true, unconfigured: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 呼び出し元のIPを取る。
 *
 * **Next.js 16 の `NextRequest` には `.ip` も `.geo` も無い** (型定義で確認済み。
 * 訓練データの知識だと `req.ip` を使いたくなるが、もう生えていない)。
 * Vercel は `x-forwarded-for` にクライアント側から順に積むので先頭を取る。
 * `x-real-ip` は一部の環境しか出さないので保険。
 */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || null;
}

/**
 * `Authorization: Bearer <token>` から無記名トークンを取る。
 *
 * **これは本人確認ではない。** クライアントが自分で作った UUID を送っているだけで、
 * 誰でも新しいものを作れる。目的は「同じ端末からの回数を数えること」だけで、
 * 費用の天井は日次の総本数とIP単位が担う。
 * サーバーにユーザーのデータを持たない方針 (学習記録は端末側が正) と、
 * アカウントを作ると審査項目が増えるのを避ける狙いから、この形にしてある。
 */
export function bearerToken(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return null;
  // 鍵に混ぜるので、長さと文字種を絞る。UUID を想定している
  const raw = m[1].trim().slice(0, 64);
  return /^[A-Za-z0-9._:-]+$/.test(raw) ? raw : null;
}
