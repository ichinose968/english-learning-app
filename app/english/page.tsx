import type { Metadata, Viewport } from "next";
import { EnglishScreen } from "@/components/english/EnglishScreen";

export const metadata: Metadata = {
  title: "英語学習 - 最適な教材を自動作成",
  description:
    "レベルと興味に合わせて、単語・文法・長文読解の教材をAIが自動生成する英語学習アプリ",
};

// このアプリは端末の設定によらず常にダークなので、
// ルートで端末設定に振り分けている theme-color もここで黒に固定する
export const viewport: Viewport = {
  themeColor: "#000000",
  // キーボードが出たぶんだけレイアウトの高さ (svh) を縮める。既定の resizes-visual だと
  // 高さが変わらないまま、入力欄を見せるためにページごと押し上げられてしまう
  interactiveWidget: "resizes-content",
};

// 画面の中身は EnglishScreen が持つ。**デプロイ用リポジトリでは `/` からも
// 同じものを出す**ため（Capacitor が開くのは out/index.html なので）。
export default function EnglishPage() {
  return <EnglishScreen />;
}
