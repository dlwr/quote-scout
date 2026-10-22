# quote-scout

長い Web 記事の中から、自分が Tumblr に引用しそうな箇所をハイライトするユーザースクリプト。

自分の Tumblr ブログの過去の quote 投稿（リブログ含む直近200件）を好みの例として Claude に渡し、記事本文から引用しそうな箇所を最大10個選ばせる。選ばれた箇所はページ上でハイライトされ、右下のパネルから該当箇所へのジャンプと Tumblr の quote 投稿画面を開ける。

## インストール

Tampermonkey / Violentmonkey で次を開く。

https://raw.githubusercontent.com/dlwr/quote-scout/main/quote-scout.user.js

## 使い方

ユーザースクリプトマネージャのメニューから「引用候補をハイライト」を選ぶ。初回は次を聞かれる（スクリプトストレージに保存される）。

- 引用を集める Tumblr ブログ名
- Tumblr の OAuth consumer key（https://www.tumblr.com/oauth/apps で登録したアプリのもの）
- Anthropic の API キー

過去の引用は7日間キャッシュする。キーを変えたいときはメニューの「API キーを設定し直す」。

本文は `article` → `main` → `body` の順で最初に見つかった要素から取る。1回の実行で記事全文と過去の引用を Claude Opus 5.5 に送るので、長い記事ほど料金がかかる。

## 開発

```
npm test
```
