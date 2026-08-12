// 単語・例文・長文の読み上げ。
//
// ブラウザ内蔵の Web Speech API だけで完結させている。追加のキーも費用も要らず、
// 認証の無い公開URLを他人に使われても請求が増えないため
// (Anthropic API には音声が無いので、クラウドTTSを使うなら別プロバイダの契約が要る)。
// 品質に不満が出たときは **このファイルの中だけ** を差し替えれば済むよう、
// 呼び出し側には speak / stopSpeaking / primeSpeech / isSpeechSupported しか見せない。
//
// ブラウザ専用APIなので、モジュールの読み込み時ではなく関数の中で window を見る。
// このファイルを import するのはクライアントコンポーネントだが、
// クライアントコンポーネントもサーバー側で1度描画されるため、
// トップレベルで speechSynthesis を触るとその時点で落ちる。

export const SPEECH_RATE_MIN = 0.5;
export const SPEECH_RATE_MAX = 1.5;
export const SPEECH_RATE_DEFAULT = 1;

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// 素性の分かっている英語の音声。上から順に探す。
//
// **名前で選ばないと事故る。** macOS には Albert / Bad News / Bahh / Boing …といった
// ジョーク音声が en-US として大量に入っており、しかもアルファベット順で先頭に来る。
// 実測 (macOS Chrome): 英語の音声180件中 en-US が28件あり、そのうち default が立っているものは
// **1つも無い** (default は Kyoko(ja-JP) だけ)。素直に「en-US の先頭」を取ると Albert になり、
// 単語をふざけた声で読み上げることになる。localService もすべて true なので区別に使えない。
const PREFERRED_VOICES = [
  // Apple (iOS / macOS)。iOS ではこのあたりが既定で入っている
  "Samantha",
  "Ava",
  "Allison",
  "Susan",
  "Alex",
  "Tom",
  "Aaron",
  "Nicky",
  // Chrome / Android
  "Google US English",
  "Google UK English Female",
  "Google UK English Male",
  // Edge / Windows
  "Microsoft Aria",
  "Microsoft Jenny",
  "Microsoft Guy",
  "Microsoft Zira",
  "Microsoft David",
  // 英米以外の英語圏 (上が無いときの受け皿)
  "Daniel",
  "Karen",
  "Moira",
  "Rishi",
];

// 上のどれも見つからなかったときに避ける音声 (macOS のジョーク音声)。
// 完全な一覧ではないので、あくまで最後の保険として使う
const NOVELTY_VOICES = new Set(
  [
    "Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos",
    "Deranged", "Good News", "Jester", "Junior", "Kathy", "Organ",
    "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox", "Bruce",
    "Ralph", "Fred", "Princess", "Hysterical", "Pipe Organ", "Grandma",
    "Grandpa", "Eddy", "Flo", "Reed", "Rocko", "Sandy", "Shelley",
  ].map((n) => n.toLowerCase()),
);

// 英語の音声を1つ選ぶ。
//
// getVoices() は非同期で、Safari も Chrome も初回は空配列を返すことがある。
// そのときは voiceschanged を待って選び直す (待たずに諦めると、
// アプリを開いて最初の1回だけ端末の既定言語=日本語の声で英単語を読んでしまう)。
let cachedVoice: SpeechSynthesisVoice | null = null;
let voiceListenerAttached = false;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!isSpeechSupported()) return null;
  if (cachedVoice) return cachedVoice;

  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    // まだ読み込めていない。次に埋まったタイミングで選び直す
    if (!voiceListenerAttached) {
      voiceListenerAttached = true;
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        cachedVoice = null;
        pickVoice();
      });
    }
    return null;
  }

  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (en.length === 0) return null;

  // 1. 素性の分かっている音声を、PREFERRED_VOICES の並び順で探す。
  //    同名が複数あるときは en-US を優先する
  for (const name of PREFERRED_VOICES) {
    const hits = en.filter((v) =>
      v.name.toLowerCase().includes(name.toLowerCase()),
    );
    if (hits.length === 0) continue;
    cachedVoice =
      hits.find((v) => v.lang.replace("_", "-") === "en-US") ?? hits[0];
    return cachedVoice;
  }
  // 2. 端末の既定が英語ならそれ
  const def = en.find((v) => v.default);
  if (def) {
    cachedVoice = def;
    return cachedVoice;
  }
  // 3. ジョーク音声を除いた中から en-US → en-GB → 先頭
  const sane = en.filter((v) => !NOVELTY_VOICES.has(v.name.toLowerCase()));
  const pool = sane.length > 0 ? sane : en;
  cachedVoice =
    pool.find((v) => v.lang.replace("_", "-") === "en-US") ??
    pool.find((v) => v.lang.replace("_", "-") === "en-GB") ??
    pool[0];
  return cachedVoice;
}

// iOS Safari は「ユーザー操作の中から呼ばれた speak」でしか音を出さない。
// カードが出た瞬間の自動読み上げは操作ではないので、そのままだと無音になる。
// 最初のタップの中で無音の発話を1回通しておくと、以後は自動でも鳴る。
let primed = false;

export function primeSpeech(): void {
  if (primed || !isSpeechSupported()) return;
  primed = true;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    // 解錠に失敗しても読み上げ自体は試させる (端末によっては元から不要)
  }
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return;
  window.speechSynthesis.cancel();
}

// 読み上げの速さはアプリ全体で1つなので、呼び出しごとに渡さずここに持つ。
// 設定の持ち主は EnglishApp で、そこから setSpeechRate() を呼んで同期する。
// カード・カード詳細・単語一覧・長文の4か所が読み上げを持つので、
// prop で配って回ると、渡し忘れた画面だけ速さが既定に戻る事故が起きる。
let currentRate = SPEECH_RATE_DEFAULT;

export function setSpeechRate(rate: number): void {
  currentRate = clampRate(rate);
}

// 読み上げる。前の発話は必ず止めてから始める。
// 止めないと、カードを続けてめくったときに読み上げが順番待ちで溜まり、
// 何枚も前の単語を読み続けることになる。
export function speak(text: string, opts: { onEnd?: () => void } = {}): void {
  if (!isSpeechSupported()) return;
  const body = text.trim();
  if (!body) return;

  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(body);
  const voice = pickVoice();
  if (voice) u.voice = voice;
  // 声が選べていなくても lang は必ず英語にする。
  // 指定が無いと端末の既定言語で読まれ、英単語がローマ字読みになる
  u.lang = voice?.lang ?? "en-US";
  u.rate = currentRate;
  if (opts.onEnd) {
    u.addEventListener("end", opts.onEnd);
    u.addEventListener("error", opts.onEnd);
  }
  window.speechSynthesis.speak(u);
}

export function clampRate(rate: number | undefined): number {
  if (typeof rate !== "number" || !Number.isFinite(rate)) {
    return SPEECH_RATE_DEFAULT;
  }
  return Math.max(SPEECH_RATE_MIN, Math.min(SPEECH_RATE_MAX, rate));
}
