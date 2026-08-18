"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Square, Volume2, X } from "lucide-react";
import { SavedReading } from "@/lib/english/types";
import { primeSpeech, speak, stopSpeaking } from "@/lib/english/speech";

// **word** のマーカーをハイライトに変換して本文を描画する。
// wordAction がその語のクリック処理を返したときは、押せるハイライトにする
export function renderPassage(
  passage: string,
  wordAction?: (text: string) => (() => void) | null,
) {
  return passage.split(/\n+/).map((para, pi) => (
    <p key={pi} className="mb-3 leading-relaxed">
      {para.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
        const m = part.match(/^\*\*([^*]+)\*\*$/);
        if (m) {
          const action = wordAction?.(m[1]) ?? null;
          if (action) {
            return (
              <button
                key={i}
                onClick={action}
                className="rounded bg-[#4A99EA]/20 px-0.5 font-bold text-[#4A99EA] underline decoration-[#4A99EA]/50 underline-offset-2"
              >
                {m[1]}
              </button>
            );
          }
          return (
            <mark
              key={i}
              className="rounded bg-[#4A99EA]/20 px-0.5 font-bold text-[#4A99EA]"
            >
              {m[1]}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </p>
  ));
}

const CHOICE_LABEL = ["A", "B", "C", "D", "E"];

// 長文を画面いっぱい (少しだけ余白を残す) のポップアップで開く。
// 設問は先に全部選んでから、下の「解答を確認」でまとめて答え合わせする
export function ReadingSheet({
  reading,
  onClose,
  onScored,
  wordAction,
  dismissOnBackdrop = true,
}: {
  reading: SavedReading;
  onClose: () => void;
  onScored: (score: { correct: number; total: number }) => void;
  // ハイライトされた語のクリック処理 (単語詳細を開く)。null ならただの強調表示
  wordAction?: (text: string) => (() => void) | null;
  // 背面のクリックで閉じてよいか。単語詳細をこの上に重ねているあいだは false。
  // 詳細は列幅 (max-w-2xl) に絞ってあるので、PCでは列の外のクリックが
  // ここまで素通りしてくる。塞がないと、詳細を開いたまま脇を押しただけで
  // 背後の長文が閉じ、解答の選択状態まで失われる
  dismissOnBackdrop?: boolean;
}) {
  const total = reading.questions.length;
  // 本文を読み上げ中か (トグルの見た目と、読み終わりの戻しに使う)
  const [speaking, setSpeaking] = useState(false);
  const [picks, setPicks] = useState<(number | null)[]>(
    Array(total).fill(null),
  );
  const [graded, setGraded] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  // 開閉とも同じ演出 (背面のフェードとパネルの拡縮) を対称に使う
  const visible = shown && !closing;

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // 閉じたあとも読み上げが続かないようにする
  useEffect(() => () => stopSpeaking(), []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 300);
  };

  const answered = picks.filter((p) => p !== null).length;
  const correct = picks.filter(
    (p, i) => p === reading.questions[i].answerIndex,
  ).length;

  const grade = () => {
    setGraded(true);
    onScored({ correct, total });
  };

  return (
    <div
      onClick={dismissOnBackdrop ? close : undefined}
      className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: visible ? "scale(1)" : "scale(0.96)",
          transition: "transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
          // **セーフエリアの逃げはパネル自身が持つ。** 中の header に padding を足す形
          // (CardDetailSheet の流儀) だと、中身は下がっても角丸・枠線・影の上辺が
          // ステータスバーの裏に残る。あちらのパネルは全面べた塗りで角丸も枠線も
          // 持たないので、同じ書き方をそのまま持ち込めない。
          // 0.75rem は元の inset-3 と同じ浮かせ量。背面が fixed inset-0 なので、
          // この top / bottom はビューポート基準に解決する
          top: "calc(0.75rem + env(safe-area-inset-top))",
          bottom: "calc(0.75rem + env(safe-area-inset-bottom))",
        }}
        // 背面 (暗転) は画面全体のままにして、パネルだけ本体と同じ列幅に収める。
        // 上下は style 側が持つので、横だけクラスで 12px
        className="absolute inset-x-3 mx-auto flex max-w-2xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-black"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="min-w-0 flex-1 text-base font-semibold leading-snug tracking-tight">
            {reading.title}
          </h3>
          {/* 本文の読み上げ。長いので押しっぱなしではなくトグルにする */}
          <button
            onClick={() => {
              if (speaking) {
                stopSpeaking();
                setSpeaking(false);
                return;
              }
              primeSpeech();
              setSpeaking(true);
              // ハイライト用の ** は読み上げに混ぜない
              speak(reading.passageEn.replace(/\*\*/g, ""), {
                onEnd: () => setSpeaking(false),
              });
            }}
            aria-label={speaking ? "読み上げを止める" : "本文を読み上げる"}
            aria-pressed={speaking}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
              speaking
                ? "bg-[#4A99EA] text-white"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {speaking ? <Square size={15} strokeWidth={3} /> : <Volume2 size={18} />}
          </button>
          <button
            onClick={close}
            aria-label="長文を閉じる"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-black"
          >
            <X size={18} strokeWidth={3} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {/* 本文・語注・和訳・設問はすべてAIがその場で作ったもので、
              事前生成DBの単語・文法とは出どころが違う。
              本文の**上**に置く (読み終わってから断られても遅い) */}
          <p className="mb-3 text-xs text-zinc-500">
            AIが生成した教材です。内容が正確とは限りません。
          </p>
          <div className="text-[15px]">
            {renderPassage(reading.passageEn, wordAction)}
          </div>

          {reading.glossary.length > 0 && (
            <div className="mt-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
              <p className="mb-1.5 text-xs font-medium text-zinc-500">語注</p>
              <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {reading.glossary.map((g, i) => (
                  <li key={i}>
                    <span className="font-medium">{g.word}</span>
                    <span className="text-zinc-500"> : {g.meaningJa}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={() => setShowTranslation(!showTranslation)}
            className="mt-3 flex items-center gap-1 text-sm text-[#4A99EA]"
          >
            <ChevronDown
              size={15}
              className={`transition-transform ${showTranslation ? "rotate-180" : ""}`}
            />
            全文和訳を{showTranslation ? "隠す" : "表示"}
          </button>
          {showTranslation && (
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {reading.translationJa}
            </p>
          )}

          <div className="mt-5 space-y-4">
            <h4 className="text-sm font-medium text-zinc-500">内容理解クイズ</h4>
            {reading.questions.map((q, qi) => (
              <div
                key={qi}
                className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <p className="text-sm font-medium leading-relaxed">
                  Q{qi + 1}. {q.question}
                </p>
                <div className="mt-3 grid gap-2">
                  {q.choices.map((c, ci) => {
                    const picked = picks[qi] === ci;
                    const isAnswer = ci === q.answerIndex;
                    // 答え合わせ後は、正解を青・選んだ誤答を赤で示す
                    const cls = graded
                      ? isAnswer
                        ? "border-[#4A99EA] bg-[#4A99EA]/10 text-[#4A99EA]"
                        : picked
                          ? "border-red-500 bg-red-500/10 text-red-500"
                          : "border-zinc-200 text-zinc-500 dark:border-zinc-700"
                      : picked
                        ? "border-[#4A99EA] bg-[#4A99EA]/10 text-[#4A99EA]"
                        : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500";
                    return (
                      <button
                        key={ci}
                        disabled={graded}
                        onClick={() =>
                          setPicks((prev) =>
                            prev.map((p, i) => (i === qi ? ci : p)),
                          )
                        }
                        className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${cls}`}
                      >
                        <span className="shrink-0 text-xs text-zinc-400">
                          {CHOICE_LABEL[ci]}
                        </span>
                        <span className="flex-1">{c}</span>
                      </button>
                    );
                  })}
                </div>
                {graded && (
                  <p className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    {q.explanationJa}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          {graded ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">
                <span className="text-zinc-500">正解 </span>
                <span className="text-lg font-semibold tabular-nums">
                  {correct}
                </span>
                <span className="text-zinc-500"> / {total}</span>
              </p>
              <button
                onClick={close}
                className="rounded-lg bg-[#4A99EA] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#3d87d4]"
              >
                閉じる
              </button>
            </div>
          ) : (
            <button
              onClick={grade}
              disabled={answered < total}
              className="w-full rounded-lg bg-[#4A99EA] py-2.5 text-sm font-medium text-white hover:bg-[#3d87d4] disabled:opacity-40"
            >
              {answered < total
                ? `解答を確認 (あと${total - answered}問)`
                : "解答を確認"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
