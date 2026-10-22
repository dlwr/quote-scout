// ==UserScript==
// @name         Quote Scout
// @namespace    https://github.com/dlwr/quote-scout
// @version      0.3.0
// @description  長い記事の中から、自分が Tumblr に引用しそうな箇所をハイライトする
// @match        *://*/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      api.anthropic.com
// @downloadURL  https://raw.githubusercontent.com/dlwr/quote-scout/main/quote-scout.user.js
// @updateURL    https://raw.githubusercontent.com/dlwr/quote-scout/main/quote-scout.user.js
// ==/UserScript==

const MODEL = "claude-sonnet-5-5";
const EXAMPLE_LIMIT = 200;
const EXAMPLE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const HIGHLIGHT = "quote-scout";

function extractQuote(post) {
  const blocks = post.content?.length ? post.content : post.trail?.[0]?.content || [];
  const block = blocks.find((b) => b.type === "text" && (b.subtype === "quote" || b.subtype === "indented"));
  return block ? block.text.replace(/^“|”$/g, "").trim() : null;
}

async function collectQuotes(fetchPage, limit) {
  const quotes = [];
  for (let offset = 0; quotes.length < limit; ) {
    const posts = await fetchPage(offset);
    if (!posts.length) break;
    offset += posts.length;
    for (const post of posts) {
      const quote = extractQuote(post);
      if (quote && quotes.length < limit) quotes.push(quote.slice(0, 400));
    }
  }
  return quotes;
}

function findMatch(texts, quote) {
  const positions = [];
  let haystack = "";
  texts.forEach((text, i) => {
    for (let j = 0; j < text.length; j++) {
      if (/\s/.test(text[j])) continue;
      haystack += text[j];
      positions.push([i, j]);
    }
  });
  const needle = quote.replace(/\s+/g, "");
  const at = needle ? haystack.indexOf(needle) : -1;
  if (at < 0) return null;
  const [lastNode, lastOffset] = positions[at + needle.length - 1];
  return { start: positions[at], end: [lastNode, lastOffset + 1] };
}

if (typeof module !== "undefined") {
  module.exports = { extractQuote, collectQuotes, findMatch };
} else {
  GM_registerMenuCommand("引用候補をハイライト", () => run().catch((e) => alert(`quote-scout: ${e.message}`)));
  GM_registerMenuCommand("設定をリセット", () => {
    for (const key of ["anthropicApiKey", "tumblrBlog", "examples"]) GM_setValue(key, null);
  });
  if (location.hostname === "www.tumblr.com") refreshExamples().catch((e) => console.warn("[quote-scout]", e));
}

function setting(key, message, fallback = "") {
  let value = GM_getValue(key, "");
  if (!value) {
    value = (prompt(message, fallback) || "").trim();
    if (!value) throw new Error(`${key} が未設定`);
    GM_setValue(key, value);
  }
  return value;
}

function request(opts) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      ...opts,
      onload: (res) => {
        if (res.status >= 400) reject(new Error(`${res.status} ${res.responseText.slice(0, 200)}`));
        else resolve(JSON.parse(res.responseText));
      },
      onerror: () => reject(new Error(`通信エラー: ${opts.url.split("?")[0]}`)),
    });
  });
}

async function refreshExamples() {
  const cached = GM_getValue("examples", null);
  if (cached && Date.now() - cached.at < EXAMPLE_CACHE_MS) return;

  let apiFetch;
  for (let i = 0; i < 50 && !apiFetch; i++) {
    apiFetch = unsafeWindow.tumblr?.apiFetch;
    if (!apiFetch) await new Promise((r) => setTimeout(r, 200));
  }
  if (!apiFetch) throw new Error("window.tumblr.apiFetch が見つからない");

  const blog = setting("tumblrBlog", "quote-scout: 過去の引用を集める Tumblr ブログ名", "dlwr");
  const quotes = await collectQuotes(async (offset) => {
    const { response } = await apiFetch(`/v2/blog/${encodeURIComponent(blog)}/posts`, {
      queryParams: { type: "quote", limit: 20, offset },
    });
    return response.posts.filter((p) => p.objectType === "post");
  }, EXAMPLE_LIMIT);
  GM_setValue("examples", { at: Date.now(), quotes });
}

function loadExamples() {
  const cached = GM_getValue("examples", null);
  if (!cached?.quotes.length) throw new Error("過去の引用がまだ無い。tumblr.com を一度開くと読み込まれる");
  return cached.quotes;
}

async function pickQuotes(examples, article) {
  const apiKey = setting("anthropicApiKey", "Anthropic の API キー");
  const res = await request({
    method: "POST",
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    data: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      fallbacks: "default",
      output_config: {
        effort: "medium",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              quotes: { type: "array", items: { type: "string" } },
            },
            required: ["quotes"],
            additionalProperties: false,
          },
        },
      },
      system:
        "ユーザーは気に入った文章の一節を Tumblr に quote として投稿している。過去に引用した文章からユーザーの好みを読み取り、与えられた記事本文の中からユーザーが引用しそうな箇所を最大10個、引用しそうな順に選ぶ。text は記事本文から一字一句そのまま抜き出すこと（要約・言い換え・省略をしない）。長さは過去の引用に合わせる。",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `<past_quotes>\n${examples.map((q) => `<quote>${q}</quote>`).join("\n")}\n</past_quotes>`,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: `<article title="${document.title}">\n${article}\n</article>` },
          ],
        },
      ],
    }),
  });
  if (res.stop_reason === "refusal") throw new Error("Claude が応答を拒否した");
  const text = res.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`応答に本文が無い (stop_reason: ${res.stop_reason})`);
  return JSON.parse(text).quotes;
}

function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement.closest("script, style, noscript") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function locate(root, quotes) {
  const nodes = textNodes(root);
  const texts = nodes.map((n) => n.data);
  return quotes.flatMap((quote) => {
    const match = findMatch(texts, quote);
    if (!match) return [];
    const range = document.createRange();
    range.setStart(nodes[match.start[0]], match.start[1]);
    range.setEnd(nodes[match.end[0]], match.end[1]);
    return [range];
  });
}

async function run() {
  const examples = loadExamples();
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const ranges = locate(root, await pickQuotes(examples, root.innerText));
  if (!ranges.length) return alert("quote-scout: 引用しそうな箇所は見つからなかった");

  const style = document.createElement("style");
  style.textContent = `::highlight(${HIGHLIGHT}) { background-color: #ffe066; color: #000; }`;
  document.head.append(style);
  CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
  ranges[0].startContainer.parentElement.scrollIntoView({ behavior: "smooth", block: "center" });
}
