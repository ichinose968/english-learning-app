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
    // **`h-svh` ではなく `fixed inset-0` で留める。** ホーム画面から起動した iOS では
    // `100svh` が画面の高さより下のセーフエリアぶん短く解決され、`main` の下に
    // 地色の帯が残っていた。そこへ下タブが自前で `env(safe-area-inset-bottom)` を
    // 足すので余白が二重になり、タブが画面の下端から約90px浮いていた (実機で報告された)。
    // 同じ理由でページ側にスクロールが生まれ、ヘッダーと下タブが指で動いてしまっていた。
    // `fixed inset-0` は `viewportFit: "cover"` のレイアウトビューポート
    // (= セーフエリアを含む画面全体) にぴったり張り付くので、どちらも消える。
    // ドキュメント側のスクロールとラバーバンドは globals.css の `html:has(.dark)` で塞ぐ。
    //
    // dark は端末がライトモードでもこのアプリだけダークにするための印
    // (globals.css の @custom-variant dark が拾う)。english-app は入力欄の
    // フォントサイズを16px以上に保つ指定の足場で、これも globals.css 側にある
    <main
      className="english-app dark fixed inset-0 flex flex-col items-center bg-white dark:bg-black"
      // **古い起動設定で追加された PWA を救うための補正。**
      // iOS はホーム画面に追加した時点の `apple-mobile-web-app-status-bar-style` を
      // 焼き込むので、HTML を "black" に直しても、既にアイコンを持っている人は
      // "black-translucent" のまま起動する。その設定だとビューポートの高さが
      // 「ステータスバーが不透明だったとき」の値になり、画面より上インセットぶん
      // (実測で 852 − 793 = 59px) 短いまま上詰めで置かれる。余りは画面の下に残る。
      // ここで下端を同じだけ伸ばすと、そのぶんを取り返して下タブが画面の下端に付く。
      // **新しい設定で追加し直した端末では上インセットが 0 になるので、この式は
      // そのまま 0 になって何もしない。** どちらでも正しく、後で消す必要もない
      style={{ bottom: "calc(-1 * env(safe-area-inset-top))" }}
    >
      {/* オフラインで使えるようにするための Service Worker。画面には何も出さない */}
      <ServiceWorkerRegistrar />
      {/* ヘッダーは設定への導線を持つので EnglishApp 側 (クライアント) に置く */}
      <div className="flex h-full w-full max-w-2xl flex-col border-zinc-200 dark:border-zinc-800 sm:border-x">
        <EnglishApp />
      </div>
    </main>
  );
}
