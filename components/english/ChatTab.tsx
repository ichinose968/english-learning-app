"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Mic,
  RotateCcw,
  SendHorizontal,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { ChatMessage, EnglishData } from "@/lib/english/types";
import { ChatFilterSheet } from "./ChatFilterSheet";
import { ConfirmButton } from "./ConfirmButton";
import { Sheet } from "./Sheet";

interface Props {
  data: EnglishData;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
}

type Mode = "text" | "voice";

// 履歴はlocalStorageに入るので、増えすぎないよう直近だけ残す
const HISTORY_LIMIT = 50;

export function ChatTab({ data, setData }: Props) {
  const [mode, setMode] = useState<Mode>("text");
  // タブを切り替えたときのスライド方向 (右のタブへ動いたら正)
  const [slideFrom, setSlideFrom] = useState(24);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const messages = data.chat;
  const chat = data.settings.chat;
  // 自動設定のときは単語学習で測ったレベルに合わせる
  // 測定前かつ旧フローの settings.level も無ければ B1 から始める
  const autoLevel = data.vocabLevel.current ?? data.settings.level ?? "B1";
  const activeLevel = chat.levelMode === "manual" ? chat.manualLevel : autoLevel;

  // 新しい発言が増えたら一覧の末尾へ。ページ自体は動かさない
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  const push = (msgs: ChatMessage[]) =>
    setData((prev) => ({ ...prev, chat: [...prev.chat, ...msgs].slice(-HISTORY_LIMIT) }));

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    const mine: ChatMessage = {
      role: "user",
      text,
      t: new Date().toISOString(),
    };
    const history = [...messages, mine];
    setDraft("");
    setError(null);
    push([mine]);
    setSending(true);
    try {
      const res = await fetch("/api/english/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: activeLevel,
          interests: data.settings.interests,
          topic: chat.topic,
          volume: chat.volume,
          correction: chat.correction,
          // 添削と返信は直前のユーザー発言に対して作るので、添削は履歴から外す
          messages: history
            .filter((m) => m.role !== "correction")
            .map((m) => ({ role: m.role, text: m.text })),
        }),
      });
      const json = (await res.json()) as {
        reply?: string;
        correction?: string;
        error?: string;
      };
      if (!res.ok || !json.reply) {
        throw new Error(json.error ?? "返信を取得できませんでした。");
      }
      const now = new Date().toISOString();
      // 添削はAIの返信より前に置く
      const added: ChatMessage[] = [];
      if (json.correction && json.correction.trim()) {
        added.push({ role: "correction", text: json.correction.trim(), t: now });
      }
      added.push({ role: "assistant", text: json.reply, t: now });
      push(added);
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました。");
    } finally {
      setSending(false);
    }
  };

  const modeTabs = (
    <div className="flex shrink-0 items-stretch border-b border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => setFilterOpen((v) => !v)}
        aria-label="会話設定"
        aria-expanded={filterOpen}
        className="mr-1 flex w-11 shrink-0 items-center justify-center text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
      >
        <SlidersHorizontal size={20} />
      </button>
      {(
        [
          { key: "text" as Mode, label: "テキスト" },
          { key: "voice" as Mode, label: "ボイス" },
        ]
      ).map((m) => (
        <button
          key={m.key}
          onClick={() => {
            if (m.key === mode) return;
            setSlideFrom(m.key === "voice" ? 24 : -24);
            setMode(m.key);
          }}
          className={`relative flex-1 py-3 text-sm transition-colors ${
            mode === m.key
              ? "font-bold"
              : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          }`}
        >
          {m.label}
          {mode === m.key && (
            <span className="absolute inset-x-0 bottom-0 mx-auto h-1 w-14 rounded-full bg-[#4A99EA]" />
          )}
        </button>
      ))}
    </div>
  );

  // 会話設定は上のタブの下から、画面の下へ向けて開く
  const sheet = (
    <Sheet
      side="bottom"
      open={filterOpen}
      onClose={() => setFilterOpen(false)}
      top={138}
      bottom={0}
    >
      <ChatFilterSheet
        settings={chat}
        autoLevel={autoLevel}
        onChange={(next) =>
          setData((prev) => ({
            ...prev,
            settings: { ...prev.settings, chat: next },
          }))
        }
        onClose={() => setFilterOpen(false)}
      />
    </Sheet>
  );

  const slideStyle = {
    "--tab-slide-from": `${slideFrom}px`,
  } as React.CSSProperties;

  if (mode === "voice") {
    return (
      <div className="flex h-full flex-col gap-3">
        {sheet}
        {modeTabs}
        <div
          key="voice"
          style={slideStyle}
          className="tab-slide flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-black"
        >
          <Mic className="text-zinc-300 dark:text-zinc-600" size={32} />
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            ボイスチャットは準備中です。
          </p>
          <p className="max-w-xs text-xs text-zinc-400">
            声で話しかけて、AIの音声で返してもらう機能です。今はテキストチャットをお使いください。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {sheet}
      {modeTabs}

      {/* 伸び縮みするのはここだけ。タブと入力欄は動かさない */}
      <div
        key="text"
        ref={listRef}
        style={slideStyle}
        className="tab-slide flex-1 space-y-3 overflow-y-auto overscroll-contain"
      >
        {messages.length === 0 && !sending && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-black">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              AIと英語で雑談できます。
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              あなたのレベルに合わせた英語で返ってきます。日本語で書いても大丈夫です。
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {[
                "Hi! What should we talk about today?",
                "週末の予定を英語で話したい",
                "Ask me about my day.",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setDraft(s)}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          // 添削は吹き出しではなく、幅いっぱいの注釈として出す
          m.role === "correction" ? (
            <div
              key={`${m.t}-${i}`}
              className="rounded-2xl border border-dashed border-[#4A99EA]/60 bg-[#4A99EA]/5 px-3.5 py-3"
            >
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-[#4A99EA]">
                <Sparkles size={13} /> メッセージ添削
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                {m.text}
              </p>
            </div>
          ) : (
            <div
              key={`${m.t}-${i}`}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-md bg-[#4A99EA] text-white"
                    : "rounded-bl-md bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {m.text}
              </div>
            </div>
          ),
        )}

        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2.5 text-sm text-zinc-500 dark:bg-zinc-800">
              <Loader2 className="animate-spin" size={14} /> 入力中...
            </div>
          </div>
        )}

        {error && <p className="text-center text-xs text-red-500">{error}</p>}
      </div>

      {/* リセットは常に置いておく。出し入れすると入力欄の位置がずれるため */}
      <div className="flex h-[30px] shrink-0 items-center justify-center">
        <ConfirmButton
          label="会話をリセット"
          question="会話をすべて消しますか？"
          confirmLabel="消す"
          icon={<RotateCcw size={13} />}
          disabled={messages.length === 0}
          onConfirm={() => setData((prev) => ({ ...prev, chat: [] }))}
        />
      </div>

      {/* 入力欄。一覧が伸びても位置が変わらないよう縮まない枠にする */}
      <div className="flex shrink-0 items-end gap-2 rounded-2xl border border-zinc-200 bg-white p-1.5 dark:border-zinc-800 dark:bg-black">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // スマホでは改行を優先するので、送信は送信ボタンから
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="メッセージを入力"
          className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-snug outline-none"
        />
        <button
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          aria-label="送信"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#4A99EA] text-white transition-colors hover:bg-[#3d87d4] disabled:opacity-30"
        >
          <SendHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}
