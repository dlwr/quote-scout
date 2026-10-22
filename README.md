# quote-scout

長い Web 記事の中から、自分が Tumblr に引用しそうな箇所をハイライトするユーザースクリプト。

自分の Tumblr ブログの過去の quote 投稿（リブログ含む直近200件）を好みの例として Claude に渡し、記事本文から引用しそうな箇所を最大10個選ばせ、ページ上でハイライトする。

## インストール

Tampermonkey / Violentmonkey で次を開く。

https://raw.githubusercontent.com/dlwr/quote-scout/main/quote-scout.user.js

## 使い方

1. 一度 tumblr.com を開く。tumblr.com のページが提供している `window.tumblr.apiFetch` を使って過去の引用を読み込み、スクリプトのストレージに保存する（初回はブログ名を聞かれる）。7日経つと、次に tumblr.com を開いたときに読み込み直す
2. 記事のページで、ユーザースクリプトマネージャのメニューから「引用候補をハイライト」を選ぶ。初回は Anthropic の API キーを聞かれる

ブログ名や API キーを変えたいときはメニューの「設定をリセット」。

本文は `article` → `main` → `body` の順で最初に見つかった要素から取る。1回の実行で記事全文と過去の引用を Claude Sonnet 5.5 に送るので、長い記事ほど料金がかかる。

## 開発

```
npm test
```
