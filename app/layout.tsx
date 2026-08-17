import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eng. - 英語学習",
  description:
    "レベルと興味に合わせて、単語・文法・長文読解の教材を自動作成する英語学習アプリ",
  appleWebApp: {
    capable: true,
    title: "Eng.",
    // **"black-translucent" にしない。** ホーム画面から起動した iOS では、
    // Webビューはステータスバーの下まで広がるのに、ビューポートの高さは
    // 「ステータスバーが不透明だったとき」の値 (画面852 − 上インセット59 = 793) を返し、
    // 位置は上詰めになる。余った59pxが画面の下に取り残され、`fixed inset-0` の
    // 下タブも単語詳細も下端に届かなくなっていた (実機の実測値で確定)。
    // "black" ならビューポートがステータスバーの下から始まり、画面の下端まで届く。
    // アプリの地色は黒なのでステータスバーの見た目は変わらない
    statusBarStyle: "black",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

// スマホでの表示用。ホーム画面から起動したときにノッチ領域まで背景を敷く
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // html に高さを固定すると本文がはみ出しても伸びず、スマホで縦スクロールできなくなる
    <html lang="ja" className="antialiased">
      <body className="min-h-svh flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
