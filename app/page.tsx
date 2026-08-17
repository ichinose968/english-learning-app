import type { Metadata, Viewport } from "next";
import { EnglishScreen } from "@/components/english/EnglishScreen";

// **ここで `redirect("/english")` を使わないこと。**
// サーバーリダイレクトは `output: "export"` で表現できず、出来上がる
// `out/index.html` は `<html id="__next_error__">` の空ページになる
// (meta refresh も入らない)。**Capacitor が既定で開くのはこの index.html** なので、
// 放置すると起動が永久に白いままになる。
// リダイレクトではなく、学習画面そのものをここから出す。
//
// `/english` も残す。既存のホーム画面アイコン・`public/english-sw.js` の
// `SHELL_HTML_URL`・manifest の `start_url` がそこを指しているため。

export const metadata: Metadata = {
  title: "Eng. - 英語学習",
  description:
    "レベルと興味に合わせて、単語・文法・長文読解の教材をAIが自動生成する英語学習アプリ",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  interactiveWidget: "resizes-content",
};

export default function Home() {
  return <EnglishScreen />;
}
