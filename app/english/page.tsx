import type { Metadata } from "next";
import { EnglishApp } from "@/components/english/EnglishApp";

export const metadata: Metadata = {
  title: "英語学習 - 最適な教材を自動作成",
  description:
    "レベルと興味に合わせて、単語・文法・長文読解の教材をAIが自動生成する英語学習アプリ",
};

export default function EnglishPage() {
  return (
    // ページ自体は一切スクロールさせない。高さを画面ぴったりに固定し、
    // スクロールはすべて EnglishApp 内部のコンテナで行う (ボトムナビがずれる原因になるため)
    <main className="flex h-svh flex-col items-center bg-white dark:bg-black">
      {/* ヘッダーは設定への導線を持つので EnglishApp 側 (クライアント) に置く */}
      <div className="flex h-full w-full max-w-2xl flex-col border-zinc-200 dark:border-zinc-800 sm:border-x">
        <EnglishApp />
      </div>
    </main>
  );
}
