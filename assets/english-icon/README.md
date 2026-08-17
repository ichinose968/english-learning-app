# Eng. アイコン素材

英語学習アプリ (`/english`) のアイコン一式。ここの SVG が唯一の原本で、
PNG / ICO はすべて `scripts/generate-english-icons.mjs` が生成する。
**生成物を手で編集しない。** 直すときは SVG を直して再生成する。

```bash
node scripts/generate-english-icons.mjs
```

## デザイン

- ロゴタイプ: Didot Bold の `Eng.` のアウトライン。ピリオドだけアクセント色。
- 背景 `#000000` / 文字 `#FFFFFF` / ピリオド `#4A99EA`（アプリのアクセント色）
- 書体は**アウトライン化済み**なので、生成に Didot のインストールは要らない。
  字形を変えたいときだけ macOS の `Didot.ttc` と fontTools が必要（下記）。

Didot を選んだのは太い線と細い線の落差が出るため。文字幅は
「太らせずに大きくする」= 字面幅を canvas の 80% に取る方針で、
太さを足すと落差が 9.2 → 4.4 まで落ちて Didot を選んだ意味が消える。

## 原本

| ファイル | 用途 | 字面幅 |
| --- | --- | --- |
| `icon.svg` | フル正方形。iOS / App Store / PWA `any` | 80% |
| `icon-maskable.svg` | PWA `maskable` / Android アダプティブ。マスクで欠けない中央安全域に収めた版 | 58% |
| `icon-foreground.svg` | Android アダプティブの前景（背景透過） | 58% |
| `icon-background.svg` | Android アダプティブの背景（黒ベタ） | — |
| `icon-compact.svg` | モノグラム `E.`。ファビコン専用 | 52% |
| `splash.svg` | 起動画面 2732 角 | 23% |

`Eng.` は 16px まで落ちると潰れて読めないため、ファビコンだけ `E.` に切り替える
（アプリアイコンはフルロゴ、タブはモノグラム、という使い分け）。

## 字形そのものを作り直す場合

macOS の Didot からアウトラインを取り直す手順。

```bash
python3 -m venv .venv && .venv/bin/pip install fonttools
```

`/System/Library/Fonts/Supplemental/Didot.ttc` の **index 2** が Bold。
`fontTools.pens.svgPathPen` で glyph を取り、`Transform(1,0,0,-1,x,0)` で
y 軸を反転して SVG 座標系に落とし、advance width で送る。
字面の bbox を canvas 中央に合わせる（`g` のディセンダを含めた bbox で中央寄せ）。
