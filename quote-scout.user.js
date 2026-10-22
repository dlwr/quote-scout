// ==UserScript==
// @name         Quote Scout
// @namespace    https://github.com/dlwr/quote-scout
// @version      0.1.0
// @description  長い記事の中から、自分が Tumblr に引用しそうな箇所をハイライトする
// @match        *://*/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.anthropic.com
// @connect      api.tumblr.com
// @downloadURL  https://raw.githubusercontent.com/dlwr/quote-scout/main/quote-scout.user.js
// @updateURL    https://raw.githubusercontent.com/dlwr/quote-scout/main/quote-scout.user.js
// ==/UserScript==

const MODEL = "claude-opus-5-5";
const EXAMPLE_LIMIT = 200;
const EXAMPLE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const PANEL_ID = "quote-scout";

function extractQuote(post) {
  const blocks = post.content?.length ? post.content : post.trail?.[0]?.content || [];
  const block = blocks.find((b) => b.type === "text" && (b.subtype === "quote" || b.subtype === "indented"));
  return block ? block.text.replace(/^“|”$/g, "").trim() : null;
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

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function shareUrl(quote, title, url) {
  const params = new URLSearchParams({
    posttype: "quote",
    content: quote,
    caption: `<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`,
    canonicalUrl: url,
  });
  return `https://www.tumblr.com/widgets/share/tool?${params}`;
}

if (typeof module !== "undefined") {
  module.exports = { extractQuote, findMatch, shareUrl };
} else {
  GM_registerMenuCommand("引用候補をハイライト", () => run().catch((e) => showPanel(`失敗: ${e.message}`)));
  GM_registerMenuCommand("API キーを設定し直す", () => {
    for (const key of ["anthropicApiKey", "tumblrApiKey", "tumblrBlog"]) GM_setValue(key, "");
  });
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

async function fetchExamples() {
  const cached = GM_getValue("examples", null);
  if (cached && Date.now() - cached.at < EXAMPLE_CACHE_MS) return cached.quotes;

  const blog = setting("tumblrBlog", "引用を集める Tumblr ブログ名", "dlwr");
  const apiKey = setting("tumblrApiKey", "Tumblr の OAuth consumer key（api_key として使う）");
  const quotes = [];
  for (let offset = 0; quotes.length < EXAMPLE_LIMIT; offset += 20) {
    const params = new URLSearchParams({ api_key: apiKey, npf: "true", limit: "20", offset: String(offset) });
    const { response } = await request({
      method: "GET",
      url: `https://api.tumblr.com/v2/blog/${encodeURIComponent(blog)}.tumblr.com/posts/quote?${params}`,
    });
    if (!response.posts.length) break;
    for (const post of response.posts) {
      const quote = extractQuote(post);
      if (quote) quotes.push(quote.slice(0, 400));
    }
  }
  GM_setValue("examples", { at: Date.now(), quotes });
  return quotes;
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
              quotes: {
                type: "array",
                items: {
                  type: "object",
                  properties: { text: { type: "string" }, reason: { type: "string" } },
                  required: ["text", "reason"],
                  additionalProperties: false,
                },
              },
            },
            required: ["quotes"],
            additionalProperties: false,
          },
        },
      },
      system:
        "ユーザーは気に入った文章の一節を Tumblr に quote として投稿している。過去に引用した文章からユーザーの好みを読み取り、与えられた記事本文の中からユーザーが引用しそうな箇所を最大10個、引用しそうな順に選ぶ。text は記事本文から一字一句そのまま抜き出すこと（要約・言い換え・省略をしない）。長さは過去の引用に合わせる。reason はなぜ好みに合うかを一文で。",
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
      n.parentElement.closest(`script, style, noscript, #${PANEL_ID}`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function locate(root, quotes) {
  const nodes = textNodes(root);
  const texts = nodes.map((n) => n.data);
  return quotes.map((q) => {
    const match = findMatch(texts, q.text);
    if (!match) return { ...q, range: null };
    const range = document.createRange();
    range.setStart(nodes[match.start[0]], match.start[1]);
    range.setEnd(nodes[match.end[0]], match.end[1]);
    return { ...q, range };
  });
}

function showPanel(content) {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(360px,calc(100vw - 32px));max-height:60vh;overflow:auto;background:#fff;color:#222;border:1px solid #999;box-shadow:0 2px 12px rgba(0,0,0,.25);font:14px/1.5 system-ui,sans-serif;padding:8px 12px;";
    document.body.append(panel);
  }
  panel.replaceChildren();
  const close = document.createElement("button");
  close.textContent = "閉じる";
  close.style.cssText = "float:right;font:inherit;";
  close.onclick = () => {
    panel.remove();
    CSS.highlights?.delete(PANEL_ID);
  };
  panel.append(close);
  if (typeof content === "string") panel.append(content);
  else panel.append(...content);
}

function renderResults(located) {
  return located.map((q) => {
    const item = document.createElement("div");
    item.style.cssText = "border-top:1px solid #ddd;padding:6px 0;clear:both;";
    const text = document.createElement(q.range ? "a" : "span");
    text.textContent = q.text.length > 120 ? `${q.text.slice(0, 120)}…` : q.text;
    if (q.range) {
      text.href = "#";
      text.style.color = "inherit";
      text.onclick = (e) => {
        e.preventDefault();
        q.range.startContainer.parentElement.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    } else {
      text.style.color = "#888";
      text.title = "本文中に見つからなかった";
    }
    const reason = document.createElement("div");
    reason.textContent = q.reason;
    reason.style.cssText = "color:#666;font-size:12px;";
    const post = document.createElement("a");
    post.textContent = "Tumblr に引用";
    post.href = shareUrl(q.text, document.title, location.href);
    post.target = "_blank";
    post.rel = "noopener";
    post.style.cssText = "font-size:12px;";
    item.append(text, reason, post);
    return item;
  });
}

async function run() {
  showPanel("過去の引用を読み込み中…");
  const examples = await fetchExamples();
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  showPanel(`引用候補を探しています…（過去の引用 ${examples.length} 件を参照）`);
  const located = locate(root, await pickQuotes(examples, root.innerText));

  if (CSS.highlights) {
    const style = document.createElement("style");
    style.textContent = `::highlight(${PANEL_ID}) { background-color: #ffe066; color: #000; }`;
    document.head.append(style);
    CSS.highlights.set(PANEL_ID, new Highlight(...located.filter((q) => q.range).map((q) => q.range)));
  }
  showPanel(located.length ? renderResults(located) : "引用しそうな箇所は見つからなかった");
}
