import Link from "next/link";
import { Wordmark } from "./Wordmark";

// プライバシーポリシーとサポートの共通の枠。
//
// **アプリ本体とは組み方が違う。** 本体はアプリシェル（`h-svh` に固定して、
// 中の1つのコンテナだけをスクロールさせる）だが、こちらは読み物なので
// ページごとふつうに縦スクロールさせる。無理に本体へ合わせると、
// 長い文章が枠に閉じ込められてスクロールバーが二重になる。
//
// 配色だけは本体に合わせて常にダークにする（`dark` クラス。globals.css の
// `@custom-variant dark` が「端末がダーク **または** `.dark` の中」で効くようにしてある）。
// ストアの審査員も一般の利用者もここへ来るので、アプリと地続きに見せる。
export function DocPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="dark min-h-svh bg-black text-zinc-100">
      <div
        className="mx-auto w-full max-w-2xl px-5 pb-16"
        // ホーム画面やアプリから開いたときに、題名がステータスバーへ潜らないようにする
        style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}
      >
        <header className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <Link href="/english" className="flex items-center gap-2">
            <Wordmark className="h-6 text-zinc-100" />
            <span className="sr-only">Eng. のトップへ</span>
          </Link>
          <Link
            href="/english"
            className="rounded-full border border-zinc-700 px-3 py-1.5 text-[13px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            アプリへ戻る
          </Link>
        </header>

        <h1 className="mt-8 text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-[13px] text-zinc-500">最終更新: {updated}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-zinc-300">
          {children}
        </div>
      </div>
    </main>
  );
}

// 節。見出しと本文の間隔をここで揃える
export function DocSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[17px] font-bold text-zinc-100">{heading}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

// 箇条書き。素の <ul> だと Tailwind のリセットで印が消える
export function DocList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2 pl-5">
      {items.map((item, i) => (
        <li key={i} className="list-disc">
          {item}
        </li>
      ))}
    </ul>
  );
}

// 問い合わせ先。**2ページで同じ文字列を持たない**（食い違うと、どちらが正しいか
// 分からなくなる。ストアの掲載情報とも突き合わせられる必要がある）
export const CONTACT_EMAIL = "kurohaichinose968@gmail.com";

export function ContactLink() {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="text-[#4A99EA] underline underline-offset-2"
    >
      {CONTACT_EMAIL}
    </a>
  );
}
