import type { NextConfig } from "next";

// **`output: "export"` を無条件に書かないこと。** 書くと Vercel 側のビルドまで
// 静的化され、`/api/english/reading` が消えて読解の生成が丸ごと動かなくなる。
// しかも**警告が出ない**（ビルドは成功し、ルート表には `ƒ /api/english/reading` と
// 出るのに `out/` に api ディレクトリが生成されない）ので、気づくのは
// アプリを動かしてからになる。
//
// 静的書き出しが要るのは Capacitor に同梱するときだけなので、
// `npm run build:cap` から `CAP_BUILD=1` を渡したときにだけ効かせる。
const CAP = process.env.CAP_BUILD === "1";

const nextConfig: NextConfig = {
  // iPhone実機 (WKWebView) からLAN経由で開発サーバーへアクセスするための許可
  allowedDevOrigins: ["192.168.0.244"],
  ...(CAP
    ? {
        output: "export" as const,
        // WebView は file:// 相当のパスを引くので、ディレクトリ + index.html の
        // 形にしておく。**Vercel 側には絶対に混ぜないこと。**
        // trailingSlash は API にも効き、POST が 308 で末尾スラッシュへ飛ぶ
        trailingSlash: true,
        // 静的書き出しでは next/image の最適化サーバーが無い
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
