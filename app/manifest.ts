import type { MetadataRoute } from "next";

// スマホのホーム画面に追加したときにアプリとして起動するための設定
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "英語学習 - 最適な教材を自動作成",
    short_name: "英語学習",
    description:
      "レベルと興味に合わせて単語・文法・長文読解の教材を自動作成する英語学習アプリ",
    start_url: "/english",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    lang: "ja",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // maskable は Android が円や角丸で切り抜くので、字面を中央 65% に縮めた別絵を渡す。
      // any と同じ絵を maskable として渡すと端の文字が欠ける
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
