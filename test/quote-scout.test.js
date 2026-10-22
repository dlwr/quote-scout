const test = require("node:test");
const assert = require("node:assert");
const { extractQuote, findMatch, shareUrl } = require("../quote-scout.user.js");

test("extractQuote: 自分の quote 投稿は content の quote ブロックを返す", () => {
  const post = {
    content: [
      { type: "text", text: "草って書くのやめてる", subtype: "quote" },
      { type: "text", text: "— 出典" },
    ],
    trail: [],
  };
  assert.strictEqual(extractQuote(post), "草って書くのやめてる");
});

test("extractQuote: リブログは trail 先頭の indented ブロックを鉤括弧を外して返す", () => {
  const post = {
    content: [],
    trail: [{ content: [{ type: "text", text: "“みんな永久に馬鹿であれ”", subtype: "indented" }, { type: "text", text: "— via" }] }],
  };
  assert.strictEqual(extractQuote(post), "みんな永久に馬鹿であれ");
});

test("extractQuote: 引用ブロックが無ければ null", () => {
  assert.strictEqual(extractQuote({ content: [{ type: "image" }], trail: [] }), null);
});

test("findMatch: テキストノードをまたぐ一致の開始と終了位置を返す", () => {
  assert.deepStrictEqual(findMatch(["前置き。今日は", "いい天気", "ですね。後"], "今日はいい天気ですね。"), {
    start: [0, 4],
    end: [2, 4],
  });
});

test("findMatch: 空白や改行の違いは無視する", () => {
  assert.deepStrictEqual(findMatch(["a  quick\n brown", " fox"], "quick brown fox"), {
    start: [0, 3],
    end: [1, 4],
  });
});

test("findMatch: 見つからなければ null", () => {
  assert.strictEqual(findMatch(["abc"], "xyz"), null);
});

test("shareUrl: Tumblr の quote 投稿画面の URL を作る", () => {
  const url = new URL(shareUrl("本文", "記事タイトル", "https://example.com/a"));
  assert.strictEqual(url.origin + url.pathname, "https://www.tumblr.com/widgets/share/tool");
  assert.strictEqual(url.searchParams.get("posttype"), "quote");
  assert.strictEqual(url.searchParams.get("content"), "本文");
  assert.strictEqual(url.searchParams.get("caption"), '<a href="https://example.com/a">記事タイトル</a>');
  assert.strictEqual(url.searchParams.get("canonicalUrl"), "https://example.com/a");
});
