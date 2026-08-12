import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "英語学習 - 最適な教材を自動作成",
  description:
    "レベルと興味に合わせて、単語・文法・長文読解の教材を自動作成する英語学習アプリ",
  appleWebApp: {
    capable: true,
    title: "英語学習",
    statusBarStyle: "black-translucent",
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
