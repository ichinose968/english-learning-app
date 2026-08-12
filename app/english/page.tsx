import type { Metadata, Viewport } from "next";
import { EnglishApp } from "@/components/english/EnglishApp";

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

export default function EnglishPage() {
  return (
    // ページ自体は一切スクロールさせない。高さを画面ぴったりに固定し、
    // スクロールはすべて EnglishApp 内部のコンテナで行う (ボトムナビがずれる原因になるため)
    //
    // dark は端末がライトモードでもこのアプリだけダークにするための印
    // (globals.css の @custom-variant dark が拾う)。english-app は入力欄の
    // フォントサイズを16px以上に保つ指定の足場で、これも globals.css 側にある
    <main className="english-app dark flex h-svh flex-col items-center bg-white dark:bg-black">
      {/* ヘッダーは設定への導線を持つので EnglishApp 側 (クライアント) に置く */}
      <div className="flex h-full w-full max-w-2xl flex-col border-zinc-200 dark:border-zinc-800 sm:border-x">
        <EnglishApp />
      </div>
    </main>
  );
}
