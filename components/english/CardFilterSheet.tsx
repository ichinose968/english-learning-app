"use client";

import { useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import {
  CARD_FIELDS,
  CardSource,
  EnglishData,
  Level,
  LEVELS,
  VocabSettings,
} from "@/lib/english/types";

// 出題範囲はチェックの組み合わせで決める (両方オンなら混ぜて出す)
function sourceOf(words: boolean, idioms: boolean): CardSource {
  return words && idioms ? "both" : words ? "words" : "idioms";
}

interface Props {
  settings: VocabSettings;
  onChange: (next: VocabSettings) => void;
  setData: React.Dispatch<React.SetStateAction<EnglishData>>;
  onClose: () => void;
}

// 「スワイプ設定」。カード画面の左上ボタンから開く全画面シート
export function CardFilterSheet({ settings, onChange, onClose }: Props) {
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [levelError, setLevelError] = useState<string | null>(null);

  const set = <K extends keyof VocabSettings>(
    key: K,
    value: VocabSettings[K],
  ) => onChange({ ...settings, [key]: value });

  const useWords = settings.cardSource !== "idioms";
  const useIdioms = settings.cardSource !== "words";

  const toggleSource = (kind: "words" | "idioms", checked: boolean) => {
    const next = kind === "words" ? [checked, useIdioms] : [useWords, checked];
    if (!next[0] && !next[1]) {
      setSourceError("出題範囲は少なくとも1つ選んでください。");
      return;
    }
    setSourceError(null);
    set("cardSource", sourceOf(next[0], next[1]));
  };

  const toggleField = (key: string, checked: boolean) => {
    const next = { ...settings.cardFields, [key]: checked };
    if (Object.values(next).every((v) => !v)) {
      setFieldError("スワイプ時に表示する項目は少なくとも1つ選んでください。");
      return;
    }
    setFieldError(null);
    set("cardFields", next as VocabSettings["cardFields"]);
  };

  const toggleLevel = (level: Level, checked: boolean) => {
    const next = checked
      ? [...settings.manualLevels, level]
      : settings.manualLevels.filter((l) => l !== level);
    if (next.length === 0) {
      setLevelError("出題するレベルは少なくとも1つ選んでください。");
      return;
    }
    setLevelError(null);
    // 表示順を LEVELS に合わせて保つ
    set(
      "manualLevels",
      LEVELS.filter((l) => next.includes(l.key)).map((l) => l.key),
    );
  };

  const errorLine = (msg: string) => (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
      <AlertCircle size={14} /> {msg}
    </p>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">スワイプ設定</h2>
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
          <h3 className="mb-1 text-sm font-bold">出題範囲</h3>
          <p className="mb-3 text-xs text-zinc-500">
            カードに出す種類を選びます。両方選ぶと混ぜて出題します。
          </p>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <label className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5 dark:border-zinc-800">
              <span className="flex-1 text-sm font-medium">語彙</span>
              <input
                type="checkbox"
                checked={useWords}
                onChange={(e) => toggleSource("words", e.target.checked)}
                className="h-5 w-5 shrink-0 accent-[#4A99EA]"
              />
            </label>
            <label className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex-1 text-sm font-medium">イディオム</span>
              <input
                type="checkbox"
                checked={useIdioms}
                onChange={(e) => toggleSource("idioms", e.target.checked)}
                className="h-5 w-5 shrink-0 accent-[#4A99EA]"
              />
            </label>
          </div>
          {sourceError && errorLine(sourceError)}
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold">単語の難易度設定</h3>
          <p className="mb-3 text-xs text-zinc-500">
            出題する単語のレベルの決め方です。
          </p>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            {[
              {
                key: "auto" as const,
                title: "自動設定",
                desc: "最初の10問で測定し、直近の正解率で自動調整します",
              },
              {
                key: "manual" as const,
                title: "手動設定",
                desc: "出題するレベルを自分で選びます (複数可)",
              },
            ].map((m) => (
              <label
                key={m.key}
                className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5 last:border-b-0 dark:border-zinc-800"
              >
                <span className="flex-1 text-sm font-medium">
                  {m.title}
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                    {m.desc}
                  </span>
                </span>
                <input
                  type="radio"
                  name="levelMode"
                  checked={settings.levelMode === m.key}
                  onChange={() => {
                    setLevelError(null);
                    set("levelMode", m.key);
                  }}
                  className="h-5 w-5 shrink-0 accent-[#4A99EA]"
                />
              </label>
            ))}
          </div>
          {settings.levelMode === "manual" && (
            <>
              <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                {LEVELS.map((l) => (
                  <label
                    key={l.key}
                    className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 last:border-b-0 dark:border-zinc-800"
                  >
                    <span className="flex-1 text-sm">
                      {l.key} {l.label}
                      <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                        {l.guide}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.manualLevels.includes(l.key)}
                      onChange={(e) => toggleLevel(l.key, e.target.checked)}
                      className="h-5 w-5 shrink-0 accent-[#4A99EA]"
                    />
                  </label>
                ))}
              </div>
              {levelError && errorLine(levelError)}
            </>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold">スワイプ時に表示する項目</h3>
          <p className="mb-3 text-xs text-zinc-500">
            カードをめくる前 (回答する前) の面に出す情報です。
          </p>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            {CARD_FIELDS.map((f) => (
              <label
                key={f.key}
                className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 last:border-b-0 dark:border-zinc-800"
              >
                <span className="flex-1 text-sm">{f.label}</span>
                <input
                  type="checkbox"
                  checked={settings.cardFields[f.key]}
                  onChange={(e) => toggleField(f.key, e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-[#4A99EA]"
                />
              </label>
            ))}
          </div>
          {fieldError && errorLine(fieldError)}
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold">演習モードの出題</h3>
          <p className="mb-3 text-xs text-zinc-500">
            演習では、まだ見ていないカードと一度でも回答したカードを混ぜて出します。
          </p>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <label className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex-1 text-sm font-medium">
                新出の割合
                <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                  10枚あたり新出 {Math.round(settings.drillNewRatio / 10)} 枚 /
                  既出 {10 - Math.round(settings.drillNewRatio / 10)} 枚。
                  在庫が尽きた側はもう片方で埋めます
                </span>
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={10}
                  value={settings.drillNewRatio}
                  onChange={(e) =>
                    set(
                      "drillNewRatio",
                      Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                    )
                  }
                  className="w-20 rounded-full border border-zinc-200 bg-transparent px-3 py-1.5 text-right text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700"
                />
                <span className="text-sm text-zinc-500">%</span>
              </div>
            </label>
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold">学習進捗度</h3>
          <p className="mb-3 text-xs text-zinc-500">
            初回で正解したカードは、その時点で学習完了になります。それ以外は
            ○ が続いた回数で判定します。
          </p>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <label className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex-1 text-sm font-medium">
                学習完了とみなす回数
                <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                  この回数連続で ○ なら学習完了。△ や × を挟むと数え直し
                </span>
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.masterKnownCount}
                onChange={(e) =>
                  set(
                    "masterKnownCount",
                    Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                  )
                }
                className="w-20 rounded-full border border-zinc-200 bg-transparent px-3 py-1.5 text-right text-sm outline-none focus:border-[#4A99EA] dark:border-zinc-700"
              />
            </label>
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-sm font-bold">回答後の動作</h3>
          <p className="mb-3 text-xs text-zinc-500">
            オンにすると、カード裏の解説 (意味・例文)
            を見ずにそのまま次のカードへ進みます。
          </p>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <label className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3.5 dark:border-zinc-800">
              <span className="flex-1 text-sm font-medium">
                演習で解説を飛ばす
                <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                  知っている / 知らないの仕分けに徹する
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.skipReveal.drill}
                onChange={(e) =>
                  set("skipReveal", {
                    ...settings.skipReveal,
                    drill: e.target.checked,
                  })
                }
                className="h-5 w-5 shrink-0 accent-[#4A99EA]"
              />
            </label>
            <label className="flex items-center gap-3 px-4 py-3.5">
              <span className="flex-1 text-sm font-medium">
                復習で解説を飛ばす
                <span className="mt-0.5 block text-xs font-normal text-zinc-500">
                  意味を確認せずに回すとき
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.skipReveal.review}
                onChange={(e) =>
                  set("skipReveal", {
                    ...settings.skipReveal,
                    review: e.target.checked,
                  })
                }
                className="h-5 w-5 shrink-0 accent-[#4A99EA]"
              />
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
