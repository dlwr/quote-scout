const test = require("node:test");
const assert = require("node:assert");
const { extractQuote, collectQuotes, findMatch } = require("../quote-scout.user.js");

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

test("collectQuotes: 上限に達するまでページを辿って引用を集める", async () => {
  const quote = (t) => ({ content: [{ type: "text", text: t, subtype: "quote" }] });
  const offsets = [];
  const fetchPage = async (offset) => {
    offsets.push(offset);
    return [quote(`q${offset}`), { content: [{ type: "image" }] }, quote(`r${offset}`)];
  };
  assert.deepStrictEqual(await collectQuotes(fetchPage, 4), ["q0", "r0", "q3", "r3"]);
  assert.deepStrictEqual(offsets, [0, 3]);
});

test("collectQuotes: ポストが尽きたら止まる", async () => {
  const pages = [[{ content: [{ type: "text", text: "a", subtype: "quote" }] }], []];
  assert.deepStrictEqual(await collectQuotes(async () => pages.shift(), 10), ["a"]);
});
