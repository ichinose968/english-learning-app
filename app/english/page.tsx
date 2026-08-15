import type { Metadata, Viewport } from "next";
import { EnglishApp } from "@/components/english/EnglishApp";
import { ServiceWorkerRegistrar } from "@/components/english/ServiceWorkerRegistrar";

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
    // ページ自体は一切スクロールさせない。スクロールはすべて EnglishApp 内部の
    // コンテナで行う (ボトムナビがずれる原因になるため)。
    //
    // **`h-svh` ではなく `fixed inset-0` で留める。** `h-svh` はホーム画面から
    // 起動した iOS で画面より短く解決され、ページ側にスクロールが生まれて
    // ヘッダーと下タブが指で動いていた。`fixed inset-0` はレイアウトビューポートに
    // 張り付くので動かない。ドキュメント側のスクロールとラバーバンドは
    // globals.css の `html:has(.dark)` で塞ぐ。
    //
    // **ビューポートが画面より短い件を CSS で埋めようとしないこと。**
    // 一度 `bottom: calc(-1 * env(safe-area-inset-top))` で伸ばしたが、
    // 伸びるのは `main` だけで、単語詳細やシートなどの `fixed` は
    // ビューポート基準のままなので、両者がずれて下タブがシートの下から覗き、
    // ラベルも画面の外へ出た。**原因は `apple-mobile-web-app-status-bar-style` で、
    // 直し方は layout.tsx 側 (`black`) だけ。**
    // ただし iOS はホーム画面に追加した時点の値を焼き込むので、
    // 既にアイコンを持っている端末では一度削除して追加し直す必要がある。
    //
    // dark は端末がライトモードでもこのアプリだけダークにするための印
    // (globals.css の @custom-variant dark が拾う)。english-app は入力欄の
    // フォントサイズを16px以上に保つ指定の足場で、これも globals.css 側にある
    <main className="english-app dark fixed inset-0 flex flex-col items-center bg-white dark:bg-black">
      {/* オフラインで使えるようにするための Service Worker。画面には何も出さない */}
      <ServiceWorkerRegistrar />
      {/* ヘッダーは設定への導線を持つので EnglishApp 側 (クライアント) に置く */}
      <div className="flex h-full w-full max-w-2xl flex-col border-zinc-200 dark:border-zinc-800 sm:border-x">
        <EnglishApp />
      </div>
    </main>
  );
}
