import type { Metadata } from "next";
import { EnglishApp } from "@/components/english/EnglishApp";

export const metadata: Metadata = {
  title: "英語学習 - 最適な教材を自動作成",
  description:
    "レベルと興味に合わせて、単語・文法・長文読解の教材をAIが自動生成する英語学習アプリ",
};

export default function EnglishPage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-2xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">英語学習</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            あなたのレベルと興味に合わせて、最適な教材をAIが自動作成します。間違えた単語は長文読解に織り込まれて再登場します。
          </p>
        </header>
        <EnglishApp />
      </div>
    </main>
  );
}
