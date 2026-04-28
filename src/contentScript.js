const ROOT_ID = "reply-ideas-assistant-root";
const INLINE_STYLE_ID = "reply-ideas-assistant-inline-style";
const MAX_CONTEXT_CHARS = 12000;
const MAX_POST_CONTEXT_CHARS = 6000;

let state = {
  root: null,
  shadow: null,
  panelOpen: false,
  lastResult: null,
  lastContext: "",
  postObserver: null,
  postEnhanceTimer: null,
  postBriefCache: new Map()
};

init();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TOGGLE_PANEL") {
    togglePanel(true);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

function init() {
  if (document.getElementById(ROOT_ID)) {
    return;
  }

  const host = document.createElement("div");
  host.id = ROOT_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const styleLink = document.createElement("link");
  styleLink.rel = "stylesheet";
  styleLink.href = chrome.runtime.getURL("src/content.css");

  shadow.append(styleLink, renderShell());
  state.root = host;
  state.shadow = shadow;

  bindEvents();
  installInlineStyles();
  setupPostEnhancements();
}

function renderShell() {
  const wrapper = document.createElement("div");
  wrapper.className = "ria";
  wrapper.innerHTML = `
    <button class="ria-fab" type="button" data-action="toggle" aria-label="打开蜗牛回帖助手">
      <span>回帖</span>
    </button>

    <section class="ria-panel" aria-label="蜗牛回帖助手">
      <header class="ria-panel-header">
        <div>
          <strong>蜗牛回帖助手</strong>
          <span>基于当前页面生成观点角度</span>
        </div>
        <button class="ria-icon-button" type="button" data-action="close" aria-label="关闭">×</button>
      </header>

      <div class="ria-controls">
        <label>
          <span>回复模式</span>
          <select data-role="mode">
            <option value="balanced">平衡</option>
            <option value="sharp">锐利</option>
            <option value="gentle">温和</option>
            <option value="question">追问</option>
            <option value="professional">专业</option>
          </select>
        </label>
        <button class="ria-secondary" type="button" data-action="refresh-context">重新抓取</button>
      </div>

      <label class="ria-context-label">
        <span>待分析内容</span>
        <textarea data-role="context" spellcheck="false" placeholder="选中网页文字后点击重新抓取，或直接在这里粘贴内容。"></textarea>
      </label>

      <div class="ria-actions">
        <button class="ria-primary" type="button" data-action="generate">生成思路</button>
        <button class="ria-secondary" type="button" data-action="options">设置</button>
      </div>

      <p class="ria-status" data-role="status"></p>
      <div class="ria-result" data-role="result"></div>
    </section>

    <section class="ria-post-popover" data-role="post-popover" aria-label="单帖干货总结">
      <header class="ria-post-popover-head">
        <div>
          <strong>单帖干货</strong>
          <span data-role="post-source">这条帖子</span>
        </div>
        <button class="ria-icon-button" type="button" data-action="close-post-popover" aria-label="关闭">×</button>
      </header>
      <div class="ria-post-popover-body" data-role="post-popover-body"></div>
    </section>
  `;
  return wrapper;
}

function bindEvents() {
  const shadow = state.shadow;

  shadow.querySelector('[data-action="toggle"]').addEventListener("click", () => togglePanel());
  shadow.querySelector('[data-action="close"]').addEventListener("click", () => closePanel());
  shadow.querySelector('[data-action="refresh-context"]').addEventListener("click", () => fillContext(true));
  shadow.querySelector('[data-action="generate"]').addEventListener("click", generateIdeas);
  shadow.querySelector('[data-action="options"]').addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
  shadow.querySelector('[data-action="close-post-popover"]').addEventListener("click", closePostPopover);
  document.addEventListener("click", (event) => {
    if (!state.shadow.querySelector('[data-role="post-popover"]')?.classList.contains("is-open")) {
      return;
    }

    const target = event.target;
    if (target instanceof Element && target.closest(".ria-inline-trigger")) {
      return;
    }

    if (event.composedPath().includes(state.root)) {
      return;
    }

    closePostPopover();
  }, true);
}

function installInlineStyles() {
  if (document.getElementById(INLINE_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = INLINE_STYLE_ID;
  style.textContent = `
    .ria-inline-trigger {
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 6px;
      border: 1px solid rgba(25, 107, 95, 0.26);
      border-radius: 999px;
      background: rgba(247, 250, 246, 0.96);
      color: #196b5f;
      cursor: pointer;
      vertical-align: middle;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
    }

    .ria-inline-trigger:hover {
      background: #eef5ef;
      border-color: rgba(25, 107, 95, 0.5);
      transform: translateY(-1px);
    }

    .ria-inline-trigger:active {
      transform: translateY(0) scale(0.96);
    }

    .ria-inline-trigger svg {
      width: 14px;
      height: 14px;
      display: block;
      pointer-events: none;
    }
  `;
  document.head.append(style);
}

function setupPostEnhancements() {
  if (!isXPage() || !document.body) {
    return;
  }

  enhanceXPosts();
  state.postObserver = new MutationObserver(schedulePostEnhancement);
  state.postObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function schedulePostEnhancement() {
  window.clearTimeout(state.postEnhanceTimer);
  state.postEnhanceTimer = window.setTimeout(enhanceXPosts, 350);
}

function enhanceXPosts() {
  if (!isXPage()) {
    return;
  }

  const articles = Array.from(document.querySelectorAll("article"));
  for (const article of articles) {
    if (!(article instanceof HTMLElement) || article.dataset.riaEnhanced === "true") {
      continue;
    }

    const target = findPostIconTarget(article);
    if (!target) {
      continue;
    }

    const context = extractPostText(article);
    if (context.length < 25) {
      continue;
    }

    article.dataset.riaEnhanced = "true";
    const button = document.createElement("button");
    button.className = "ria-inline-trigger";
    button.type = "button";
    button.title = "查看这条帖子的干货总结和回复建议";
    button.setAttribute("aria-label", "查看这条帖子的干货总结和回复建议");
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6.5 5.75h11M6.5 10h11M6.5 14.25h7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        <path d="M16.5 17.2l1.05 2.05 1.05-2.05 2.05-1.05-2.05-1.05-1.05-2.05-1.05 2.05-2.05 1.05 2.05 1.05Z" fill="currentColor"/>
      </svg>
    `;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPostBrief(article, button);
    });

    target.append(button);
  }
}

function findPostIconTarget(article) {
  return article.querySelector('[data-testid="User-Name"]')
    || article.querySelector('a[href*="/status/"]')?.parentElement
    || article.querySelector('div[dir="ltr"]')?.parentElement;
}

async function openPostBrief(article, button) {
  const context = extractPostText(article).slice(0, MAX_POST_CONTEXT_CHARS);
  const postUrl = extractPostUrl(article);
  const cacheKey = postUrl || hashText(context.slice(0, 800));

  positionPostPopover(button);
  renderPostPopoverLoading(postUrl);

  if (context.length < 30) {
    renderPostPopoverError("这条帖子内容太少，无法总结。");
    return;
  }

  if (state.postBriefCache.has(cacheKey)) {
    renderPostBrief(state.postBriefCache.get(cacheKey), cacheKey);
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_POST_BRIEF",
      payload: {
        context,
        page: {
          title: document.title,
          url: postUrl || location.href
        }
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "生成失败。");
    }

    state.postBriefCache.set(cacheKey, response.result);
    renderPostBrief(response.result, cacheKey);
  } catch (error) {
    renderPostPopoverError(error instanceof Error ? error.message : String(error));
  }
}

function positionPostPopover(button) {
  const popover = state.shadow.querySelector('[data-role="post-popover"]');
  const rect = button.getBoundingClientRect();
  const width = Math.min(380, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left - 18, window.innerWidth - width - 12));
  const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 560));

  popover.style.width = `${width}px`;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.classList.add("is-open");
}

function closePostPopover() {
  state.shadow.querySelector('[data-role="post-popover"]').classList.remove("is-open");
}

function renderPostPopoverLoading(postUrl) {
  const source = state.shadow.querySelector('[data-role="post-source"]');
  const body = state.shadow.querySelector('[data-role="post-popover-body"]');
  source.textContent = postUrl ? "X 帖子" : "当前帖子";
  body.innerHTML = `
    <div class="ria-post-loading">
      <span></span>
      <span></span>
      <span></span>
    </div>
    <p class="ria-post-muted">正在提炼干货和回复建议...</p>
  `;
}

function renderPostPopoverError(message) {
  const body = state.shadow.querySelector('[data-role="post-popover-body"]');
  body.innerHTML = `
    <p class="ria-post-error">${escapeHtml(message)}</p>
    <button class="ria-secondary" type="button" data-action="post-open-options">检查设置</button>
  `;
  body.querySelector('[data-action="post-open-options"]').addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function renderPostBrief(result, cacheKey) {
  const body = state.shadow.querySelector('[data-role="post-popover-body"]');
  const suggestions = Array.isArray(result.reply_suggestions) ? result.reply_suggestions : [];
  const keyPoints = Array.isArray(result.key_points) ? result.key_points : [];

  body.innerHTML = `
    <section class="ria-post-section">
      <h3>干货总结</h3>
      <p>${escapeHtml(result.summary || "暂无总结")}</p>
    </section>
    ${keyPoints.length ? `
      <section class="ria-post-section">
        <h3>关键点</h3>
        <ul>${keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
      </section>
    ` : ""}
    <section class="ria-post-section">
      <h3>回复建议</h3>
      <div class="ria-post-suggestions">
        ${suggestions.map((item) => renderPostSuggestion(item)).join("")}
      </div>
    </section>
    ${result.caution ? `<p class="ria-post-muted"><strong>注意：</strong>${escapeHtml(result.caution)}</p>` : ""}
  `;

  body.querySelectorAll('[data-action="post-copy"]').forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.copy || "");
      await chrome.runtime.sendMessage({
        type: "SAVE_FEEDBACK",
        payload: {
          rating: "up",
          ideaTitle: button.dataset.angle || "单帖回复建议",
          note: "用户复制了单帖浮层里的建议。",
          mode: "post"
        }
      });
      button.textContent = "已复制";
    });
  });
}

function renderPostSuggestion(item) {
  const angle = String(item.angle || "回复角度");
  const draft = String(item.draft || "");
  const reason = String(item.reason || "");
  const copyLabel = draft.length > 180 ? "复制完整提示词" : "复制回复";

  return `
    <article class="ria-post-suggestion">
      <strong>${escapeHtml(angle)}</strong>
      ${reason ? `<p>${escapeHtml(reason)}</p>` : ""}
      <blockquote>${escapeHtml(draft.length > 360 ? `${draft.slice(0, 360)}...` : draft)}</blockquote>
      <button type="button" data-action="post-copy" data-angle="${escapeAttribute(angle)}" data-copy="${escapeAttribute(draft)}">${copyLabel}</button>
    </article>
  `;
}

function extractPostText(article) {
  const clone = article.cloneNode(true);
  clone.querySelectorAll("button, svg, img, video, [aria-hidden='true'], .ria-inline-trigger").forEach((node) => node.remove());
  return cleanText(clone.innerText || clone.textContent || "");
}

function extractPostUrl(article) {
  const link = Array.from(article.querySelectorAll('a[href*="/status/"]'))
    .map((node) => node.getAttribute("href"))
    .find(Boolean);

  if (!link) {
    return "";
  }

  try {
    const url = new URL(link, location.origin);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch (error) {
    return "";
  }
}

function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `post-${Math.abs(hash)}`;
}

function togglePanel(forceOpen = false) {
  state.panelOpen = forceOpen || !state.panelOpen;
  state.shadow.querySelector(".ria-panel").classList.toggle("is-open", state.panelOpen);

  if (state.panelOpen) {
    fillContext(false);
  }
}

function closePanel() {
  state.panelOpen = false;
  state.shadow.querySelector(".ria-panel").classList.remove("is-open");
}

function fillContext(force) {
  const textarea = state.shadow.querySelector('[data-role="context"]');
  if (!force && textarea.value.trim().length > 0) {
    return;
  }

  const extraction = extractPageContext();
  state.lastContext = extraction.text;
  textarea.value = extraction.text;
  setStatus(extraction.source ? `已抓取：${extraction.source}` : "没有抓到足够内容，请选中文字或手动粘贴。");
}

async function generateIdeas() {
  const textarea = state.shadow.querySelector('[data-role="context"]');
  const mode = state.shadow.querySelector('[data-role="mode"]').value;
  const context = textarea.value.trim();

  if (context.length < 30) {
    setStatus("内容太少。请先选中一段文字，或把要回应的内容粘贴进来。", true);
    return;
  }

  setLoading(true);
  setStatus("正在生成思路...");
  renderResult(null);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_REPLY_IDEAS",
      payload: {
        mode,
        context,
        page: {
          title: document.title,
          url: location.href
        }
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "生成失败。");
    }

    state.lastResult = response.result;
    renderResult(response.result, mode);
    setStatus("已生成。");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setLoading(false);
  }
}

function extractPageContext() {
  const selected = cleanText(window.getSelection()?.toString() || "");
  if (selected.length >= 30) {
    return {
      source: "选中文字",
      text: selected.slice(0, MAX_CONTEXT_CHARS)
    };
  }

  if (isXPage()) {
    const xText = extractXText();
    if (xText.length >= 30) {
      return {
        source: "X 页面可见内容",
        text: xText.slice(0, MAX_CONTEXT_CHARS)
      };
    }
  }

  const readable = extractReadableText();
  return {
    source: readable.length >= 30 ? "网页正文" : "",
    text: readable.slice(0, MAX_CONTEXT_CHARS)
  };
}

function isXPage() {
  return /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(location.hostname);
}

function extractXText() {
  const articles = Array.from(document.querySelectorAll("article"))
    .filter(isVisible)
    .slice(0, 12)
    .map((node) => cleanText(node.innerText))
    .filter((text) => text.length > 20);

  return dedupeLines(articles.join("\n\n"));
}

function extractReadableText() {
  const selectors = [
    "article",
    "main",
    "[role='main']",
    ".article",
    ".post",
    ".entry-content",
    ".content",
    "body"
  ];

  const candidates = selectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .filter(isVisible)
    .map((node) => ({
      node,
      text: cleanText(node.innerText || node.textContent || "")
    }))
    .filter((item) => item.text.length > 80)
    .sort((a, b) => scoreText(b.text) - scoreText(a.text));

  return candidates[0]?.text || "";
}

function scoreText(text) {
  const lengthScore = Math.min(text.length, 8000);
  const paragraphScore = (text.match(/\n/g) || []).length * 80;
  return lengthScore + paragraphScore;
}

function isVisible(node) {
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function cleanText(text) {
  return dedupeLines(
    String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function dedupeLines(text) {
  const blocked = new Set([
    "reply",
    "repost",
    "like",
    "share",
    "views",
    "view",
    "bookmark",
    "copy link",
    "关注",
    "回复",
    "转发",
    "喜欢",
    "分享",
    "查看",
    "收藏"
  ]);
  const seen = new Set();

  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || /^\d+$/.test(line) || /^·$/.test(line)) {
        return false;
      }
      if (blocked.has(line.toLowerCase())) {
        return false;
      }
      const key = line.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .join("\n")
    .trim();
}

function renderResult(result, mode = "balanced") {
  const container = state.shadow.querySelector('[data-role="result"]');
  container.innerHTML = "";

  if (!result) {
    return;
  }

  const summary = document.createElement("section");
  summary.className = "ria-summary";
  summary.innerHTML = `
    <h3>原文判断</h3>
    <p>${escapeHtml(result.summary || "暂无摘要")}</p>
  `;
  container.append(summary);

  if (Array.isArray(result.response_points) && result.response_points.length > 0) {
    const points = document.createElement("section");
    points.className = "ria-points";
    points.innerHTML = `
      <h3>可回应点</h3>
      <ul>${result.response_points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
    `;
    container.append(points);
  }

  const ideas = Array.isArray(result.ideas) ? result.ideas : [];
  ideas.forEach((idea) => {
    const draft = String(idea.draft || "");
    const draftPreview = draft.length > 500 ? `${draft.slice(0, 500)}...` : draft;
    const copyLabel = draft.length > 500 ? "复制完整提示词" : "复制开头";
    const card = document.createElement("article");
    card.className = "ria-card";
    card.innerHTML = `
      <div class="ria-card-head">
        <span>${escapeHtml(stanceLabel(idea.stance))}</span>
        <h3>${escapeHtml(idea.title)}</h3>
      </div>
      <p class="ria-core">${escapeHtml(idea.core)}</p>
      <p><strong>理由：</strong>${escapeHtml(idea.reasoning)}</p>
      <blockquote>${escapeHtml(draftPreview)}</blockquote>
      <p class="ria-risk"><strong>风险：</strong>${escapeHtml(idea.risk || "注意语气和事实边界。")}</p>
      <div class="ria-card-actions">
        <button type="button" data-action="copy" data-copy="${escapeAttribute(draft)}">${copyLabel}</button>
        <button type="button" data-action="feedback-up" data-title="${escapeAttribute(idea.title)}">有用</button>
        <button type="button" data-action="feedback-down" data-title="${escapeAttribute(idea.title)}">没用</button>
      </div>
    `;
    container.append(card);
  });

  if (Array.isArray(result.follow_up_questions) && result.follow_up_questions.length > 0) {
    const questions = document.createElement("section");
    questions.className = "ria-points";
    questions.innerHTML = `
      <h3>可以继续追问</h3>
      <ul>${result.follow_up_questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul>
    `;
    container.append(questions);
  }

  container.querySelectorAll('[data-action="copy"]').forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.copy || "");
      await chrome.runtime.sendMessage({
        type: "SAVE_FEEDBACK",
        payload: {
          rating: "up",
          ideaTitle: button.closest(".ria-card")?.querySelector("h3")?.textContent || "",
          note: "用户复制了这条开头。",
          mode
        }
      });
      setStatus("已复制。");
    });
  });

  container.querySelectorAll('[data-action="feedback-up"], [data-action="feedback-down"]').forEach((button) => {
    button.addEventListener("click", async () => {
      const rating = button.dataset.action === "feedback-up" ? "up" : "down";
      await chrome.runtime.sendMessage({
        type: "SAVE_FEEDBACK",
        payload: {
          rating,
          ideaTitle: button.dataset.title || "",
          mode
        }
      });
      setStatus(rating === "up" ? "已记录：这类思路更适合你。" : "已记录：减少类似思路。");
    });
  });
}

function stanceLabel(value) {
  return {
    agree: "赞同补充",
    challenge: "提出异议",
    extend: "延展信息",
    question: "追问推进",
    reframe: "换个框架"
  }[value] || "观点";
}

function setStatus(message, isError = false) {
  const status = state.shadow.querySelector('[data-role="status"]');
  status.textContent = message || "";
  status.classList.toggle("is-error", Boolean(isError));
}

function setLoading(isLoading) {
  const button = state.shadow.querySelector('[data-action="generate"]');
  button.disabled = isLoading;
  button.textContent = isLoading ? "生成中..." : "生成思路";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
