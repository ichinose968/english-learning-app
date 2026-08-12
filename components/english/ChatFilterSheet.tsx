"use client";

import { Check } from "lucide-react";
import {
  ChatSettings,
  ChatVolume,
  CHAT_TOPICS,
  CHAT_VOLUMES,
  Level,
  LEVELS,
} from "@/lib/english/types";

interface Props {
  settings: ChatSettings;
  // auto のときに実際に使われるレベル (単語レベルの測定値)
  autoLevel: Level | null;
  onChange: (next: ChatSettings) => void;
  onClose: () => void;
}

// 「会話設定」。AI会話画面の左上ボタンから開く全画面シート
export function ChatFilterSheet({
  settings,
  autoLevel,
  onChange,
  onClose,
}: Props) {
  const set = <K extends keyof ChatSettings>(key: K, value: ChatSettings[K]) =>
    onChange({ ...settings, [key]: value });

  const row = "flex items-center gap-3 px-4 py-3.5";
  const box =
    "overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800";
  const divider = "border-b border-zinc-100 dark:border-zinc-800";

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">会話設定</h2>
        <button
          onClick={onClose}
          aria-label="設定を閉じる"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-black"
        >
          <Check size={18} strokeWidth={3} />
        </button>
      </div>

      <div className="space-y-6">
        <section>
          <h3 className="mb-1 text-sm font-bold">AIの英語レベル</h3>
          <p className="mb-3 text-xs text-zinc-500">
            AIが使う語彙と文の難しさです。
          </p>
          <div className={box}>
            {[
              {
                key: "auto" as const,
                title: "自動設定",
                desc: `単語学習で測定したレベルに合わせます (現在 ${
                  autoLevel ?? "未測定"
                })`,
              },
              {
                key: "manual" as const,
                title: "手動設定",
                desc: "レベルを自分で選びます",
              },
            ].map((m) => (
              <label
                key={m.key}
                className={`${row} ${divider} last:border-b-0`}
              >
                <span className="flex-1 text-sm font-medium">
                  {m.title}
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    {m.desc}
                  </span>
                </span>
                <input
                  type="radio"
                  name="chatLevelMode"
                  checked={settings.levelMode === m.key}
                  onChange={() => set("levelMode", m.key)}
                  className="h-5 w-5 shrink-0 accent-[#4A99EA]"
                />
              </label>
            ))}
          </div>
          {settings.levelMode === "manual" && (
            <div className={`mt-3 ${box}`}>
              {LEVELS.map((l) => (
                <label
                  key={l.key}
                  className={`${row} ${divider} py-3 last:border-b-0`}
                >
                  <span className="flex-1 text-sm">
                    {l.key} {l.label}
                    <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                      {l.guide}
                    </span>
                  </span>
                  <input
                    type="radio"
                    name="chatManualLevel"
                    checked={settings.manualLevel === l.key}
                    onChange={() => set("manualLevel", l.key)}
                    className="h-5 w-5 shrink-0 accent-[#4A99EA]"
                  />
                </label>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold">会話量</h3>
          <p className="mb-3 text-xs text-zinc-500">
            AIが1回の返信で話す量です。
          </p>
          <div className={box}>
            {CHAT_VOLUMES.map((v) => (
              <label
                key={v.key}
                className={`${row} ${divider} last:border-b-0`}
              >
                <span className="flex-1 text-sm font-medium">
                  {v.label}
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    {v.desc}
                  </span>
                </span>
                <input
                  type="radio"
                  name="chatVolume"
                  checked={settings.volume === v.key}
                  onChange={() => set("volume", v.key as ChatVolume)}
                  className="h-5 w-5 shrink-0 accent-[#4A99EA]"
                />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold">会話トピック</h3>
          <p className="mb-3 text-xs text-zinc-500">
            話題の軸です。おまかせにすると興味テーマから選びます。
          </p>
          <div className="flex flex-wrap gap-2">
            {[{ key: "", label: "おまかせ" }]
              .concat(CHAT_TOPICS.map((t) => ({ key: t, label: t })))
              .map((t) => (
                <button
                  key={t.key || "auto"}
                  onClick={() => set("topic", t.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    settings.topic === t.key
                      ? "border-[#4A99EA] bg-[#4A99EA]/10 text-[#4A99EA]"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
                  }`}
                >
                  {t.label}
                </button>
              ))}
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold">添削</h3>
          <p className="mb-3 text-xs text-zinc-500">
            オンにすると、AIの返信の前に「メッセージ添削」があなたの英語を直します。
          </p>
          <div className={box}>
            <label className={row}>
              <span className="flex-1 text-sm font-medium">
                送信した英語を添削する
                <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                  文法の誤りや不自然な言い方があるときだけ出ます。日本語で書いたときは出ません
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.correction}
                onChange={(e) => set("correction", e.target.checked)}
                className="h-5 w-5 shrink-0 accent-[#4A99EA]"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
