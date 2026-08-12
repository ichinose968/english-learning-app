// 学習記録の書き換えのうち、複数の画面から使うもの
import {
  EnglishData,
  Level,
  ManualStatus,
  VocabEntry,
  WordDbEntry,
} from "./types";

// 手動でステータスを指定する。null なら指定を外して学習記録どおりの判定に戻す。
// 未学習の語に指定する場合は、記録を持たせるために空のエントリを作る
export function setStatusOverride(
  data: EnglishData,
  def: WordDbEntry,
  level: Level,
  next: ManualStatus | null,
): EnglishData {
  const vocab = { ...data.vocab };
  const entry = vocab[def.word];

  if (next === null) {
    if (!entry) return data;
    const rest = { ...entry };
    delete rest.statusOverride;
    // 指定のためだけに作ったエントリ (回答履歴なし) は丸ごと消す
    const untouched =
      rest.history.length === 0 &&
      rest.knownCount === 0 &&
      rest.unsureCount === 0 &&
      rest.unknownCount === 0;
    if (untouched) {
      delete vocab[def.word];
    } else {
      vocab[def.word] = rest;
    }
    return { ...data, vocab };
  }

  const base: VocabEntry = entry ?? {
    word: def.word,
    level,
    meaningJa: def.meaningJa,
    knownCount: 0,
    unsureCount: 0,
    unknownCount: 0,
    correctCount: 0,
    wrongCount: 0,
    needsReview: false,
    lastSeenAt: new Date().toISOString(),
    history: [],
  };
  vocab[def.word] = { ...base, statusOverride: next };
  return { ...data, vocab };
}

// 回答したら手動指定は外す。記録と食い違ったまま固定されると、
// タブの件数や出題対象が実態とずれるため
export function clearStatusOverride(entry: VocabEntry): VocabEntry {
  if (!entry.statusOverride) return entry;
  const rest = { ...entry };
  delete rest.statusOverride;
  return rest;
}
