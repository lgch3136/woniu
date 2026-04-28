const DEFAULT_SETTINGS = {
  provider: "minimax",
  apiKey: "",
  baseUrl: "https://api.minimax.io/v1",
  model: "MiniMax-M2.7",
  replyCount: 4,
  profile: "",
  expertise: "",
  voice: "清醒、克制、有信息量，不油腻，不装腔。",
  goals: "提出一个有价值的补充、追问或反驳，让回复显得有思考而不是情绪输出。",
  boundaries: "不做人身攻击，不编造事实，不蹭极端立场，不输出违法、歧视、骚扰内容。",
  memory: "",
  feedback: []
};

const MAX_CONTEXT_CHARS = 12000;
const MAX_FEEDBACK_ITEMS = 30;

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const patch = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) {
      patch[key] = value;
    }
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GENERATE_REPLY_IDEAS") {
    generateReplyIdeas(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "GENERATE_POST_BRIEF") {
    generatePostBrief(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "SAVE_FEEDBACK") {
    saveFeedback(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    loadSettings()
      .then((settings) => sendResponse({ ok: true, settings: sanitizeSettings(settings) }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  return false;
});

async function generatePostBrief(payload = {}) {
  const settings = await loadSettings();
  const context = String(payload.context || "").trim().slice(0, 6000);

  if (context.length < 30) {
    throw new Error("这条帖子内容太少，无法总结。");
  }

  if (!settings.apiKey) {
    return buildManualPostBriefResult({
      settings,
      context,
      page: payload.page || {}
    });
  }

  const page = payload.page || {};
  if (settings.provider === "openai") {
    return generatePostBriefWithOpenAI({ settings, context, page });
  }

  return generatePostBriefWithChatCompletions({ settings, context, page });
}

async function generateReplyIdeas(payload = {}) {
  const settings = await loadSettings();

  if (!settings.apiKey) {
    return buildManualPromptResult({
      settings,
      context: String(payload.context || "").trim().slice(0, MAX_CONTEXT_CHARS),
      page: payload.page || {},
      mode: payload.mode || "balanced"
    });
  }

  const context = String(payload.context || "").trim().slice(0, MAX_CONTEXT_CHARS);
  if (context.length < 30) {
    throw new Error("当前页面内容太少。请先选中一段你想回应的文字，再生成思路。");
  }

  if (settings.provider === "openai") {
    return generateWithOpenAI({
      settings,
      context,
      page: payload.page || {},
      mode: payload.mode || "balanced"
    });
  }

  return generateWithChatCompletions({
    settings,
    context,
    page: payload.page || {},
    mode: payload.mode || "balanced"
  });
}

async function generateWithOpenAI({ settings, context, page, mode }) {
  const requestBody = buildOpenAIRequest({
    settings,
    context,
    page,
    mode
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`OpenAI API 请求失败：${detail}`);
  }

  return parseModelResult(data);
}

async function generatePostBriefWithOpenAI({ settings, context, page }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(buildOpenAIPostBriefRequest({ settings, context, page }))
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(`OpenAI API 请求失败：${detail}`);
  }

  return parsePostBriefResult(data);
}

async function generateWithChatCompletions({ settings, context, page, mode }) {
  const response = await fetch(buildChatCompletionsUrl(settings), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(buildChatCompletionsRequest({ settings, context, page, mode }))
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error?.message || data?.base_resp?.status_msg || `${response.status} ${response.statusText}`;
    throw new Error(`${providerLabel(settings.provider)} API 请求失败：${detail}`);
  }

  return parseModelResult(data);
}

async function generatePostBriefWithChatCompletions({ settings, context, page }) {
  const response = await fetch(buildChatCompletionsUrl(settings), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(buildChatCompletionsPostBriefRequest({ settings, context, page }))
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.error?.message || data?.base_resp?.status_msg || `${response.status} ${response.statusText}`;
    throw new Error(`${providerLabel(settings.provider)} API 请求失败：${detail}`);
  }

  return parsePostBriefResult(data);
}

async function saveFeedback(payload = {}) {
  const settings = await loadSettings();
  const feedback = Array.isArray(settings.feedback) ? settings.feedback : [];
  const item = {
    ideaTitle: String(payload.ideaTitle || "").slice(0, 120),
    rating: payload.rating === "down" ? "down" : "up",
    note: String(payload.note || "").slice(0, 300),
    mode: String(payload.mode || "balanced"),
    createdAt: new Date().toISOString()
  };

  feedback.unshift(item);
  await chrome.storage.local.set({
    feedback: feedback.slice(0, MAX_FEEDBACK_ITEMS)
  });
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function sanitizeSettings(settings) {
  return {
    ...settings,
    apiKey: settings.apiKey ? "已设置" : ""
  };
}

function buildOpenAIRequest({ settings, context, page, mode }) {
  return {
    model: settings.model || "gpt-5.4-mini",
    input: [
      {
        role: "system",
        content: buildSystemPrompt(settings)
      },
      {
        role: "user",
        content: buildUserPrompt({ settings, context, page, mode })
      }
    ],
    reasoning: {
      effort: "low"
    },
    text: {
      format: {
        type: "json_schema",
        name: "reply_ideas_result",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "response_points", "ideas", "follow_up_questions"],
          properties: {
            summary: {
              type: "string"
            },
            response_points: {
              type: "array",
              items: { type: "string" }
            },
            ideas: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "stance", "core", "reasoning", "draft", "risk"],
                properties: {
                  title: { type: "string" },
                  stance: {
                    type: "string",
                    enum: ["agree", "challenge", "extend", "question", "reframe"]
                  },
                  core: { type: "string" },
                  reasoning: { type: "string" },
                  draft: { type: "string" },
                  risk: { type: "string" }
                }
              }
            },
            follow_up_questions: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      }
    },
    max_output_tokens: 2200
  };
}

function buildOpenAIPostBriefRequest({ settings, context, page }) {
  return {
    model: settings.model || "gpt-5.4-mini",
    input: [
      {
        role: "system",
        content: buildSystemPrompt(settings)
      },
      {
        role: "user",
        content: buildPostBriefPrompt({ context, page })
      }
    ],
    reasoning: {
      effort: "low"
    },
    text: {
      format: {
        type: "json_schema",
        name: "post_brief_result",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "key_points", "reply_suggestions", "caution"],
          properties: {
            summary: { type: "string" },
            key_points: {
              type: "array",
              items: { type: "string" }
            },
            reply_suggestions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["angle", "reason", "draft"],
                properties: {
                  angle: { type: "string" },
                  reason: { type: "string" },
                  draft: { type: "string" }
                }
              }
            },
            caution: { type: "string" }
          }
        }
      }
    },
    max_output_tokens: 1400
  };
}

function buildChatCompletionsRequest({ settings, context, page, mode }) {
  return {
    model: settings.model || DEFAULT_SETTINGS.model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(settings)
      },
      {
        role: "user",
        content: [
          buildUserPrompt({ settings, context, page, mode }),
          "",
          "请只输出一个 JSON 对象，不要使用 Markdown 代码块，不要输出解释文字。JSON 字段必须是：summary、response_points、ideas、follow_up_questions。"
        ].join("\n")
      }
    ],
    max_tokens: 2200
  };
}

function buildChatCompletionsPostBriefRequest({ settings, context, page }) {
  return {
    model: settings.model || DEFAULT_SETTINGS.model,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(settings)
      },
      {
        role: "user",
        content: [
          buildPostBriefPrompt({ context, page }),
          "",
          "请只输出一个 JSON 对象，不要使用 Markdown 代码块，不要输出解释文字。JSON 字段必须是：summary、key_points、reply_suggestions、caution。"
        ].join("\n")
      }
    ],
    max_tokens: 1400
  };
}

function buildSystemPrompt(settings) {
  const feedback = Array.isArray(settings.feedback) ? settings.feedback.slice(0, 10) : [];

  return [
    "你是一个中文回帖思路编辑。你的任务不是代替用户发布最终回复，而是给用户提供有水准、可加工的回帖角度。",
    "你要重视信息密度、逻辑边界、语气分寸和社交场景。回复思路应该像一个思考过的人写的，而不是模板化赞同或情绪化反驳。",
    "如果原文信息不足，要明确指出不确定性，避免编造事实。不要输出人身攻击、骚扰、歧视、煽动仇恨、违法建议或隐私侵犯内容。",
    "",
    "用户个人资料：",
    settings.profile || "用户暂未填写。",
    "",
    "用户专业/兴趣领域：",
    settings.expertise || "用户暂未填写。",
    "",
    "用户表达风格：",
    settings.voice || DEFAULT_SETTINGS.voice,
    "",
    "用户回帖目标：",
    settings.goals || DEFAULT_SETTINGS.goals,
    "",
    "用户边界：",
    settings.boundaries || DEFAULT_SETTINGS.boundaries,
    "",
    "长期偏好记忆：",
    settings.memory || "暂无。",
    "",
    "近期反馈：",
    feedback.length
      ? feedback.map((item) => `- ${item.rating === "up" ? "喜欢" : "不喜欢"}：${item.ideaTitle}${item.note ? `；备注：${item.note}` : ""}`).join("\n")
      : "暂无。"
  ].join("\n");
}

function buildPostBriefPrompt({ context, page }) {
  return [
    "请分析下面这一条社交媒体帖子，只做单帖级别判断，不要把整页其他帖子混进来。",
    "",
    "输出要求：",
    "- summary：用 1-2 句中文提炼这条帖子的干货，不要复述废话。",
    "- key_points：列出 2-4 个真正值得注意的信息、论点或隐含前提。",
    "- reply_suggestions：给 3 条回复建议，每条包含 angle、reason、draft。draft 控制在 80 字以内。",
    "- caution：指出一个回复时容易踩的事实、语气或立场风险。",
    "- 如果帖子只是情绪表达或信息不足，要直接说明，不要强行拔高。",
    "",
    "页面信息：",
    `标题：${page.title || "未知"}`,
    `地址：${page.url || "未知"}`,
    "",
    "帖子内容：",
    context
  ].join("\n");
}

function buildUserPrompt({ settings, context, page, mode }) {
  const modeText = {
    balanced: "平衡：既指出价值，也保留判断边界。",
    sharp: "锐利：观点更鲜明，但保持克制和论证，不攻击人。",
    gentle: "温和：语气友好，适合低冲突互动。",
    question: "追问：用高质量问题推进讨论。",
    professional: "专业：偏事实、框架、概念澄清和经验判断。"
  }[mode] || "平衡";

  return [
    `请基于以下网页内容，生成 ${Number(settings.replyCount) || DEFAULT_SETTINGS.replyCount} 条中文回帖思路。`,
    `当前模式：${modeText}`,
    "",
    "输出要求：",
    "- summary：概括原文核心主张。",
    "- response_points：列出值得回应的切入点。",
    "- ideas：每条都要包含鲜明但不过度的观点、理由、可直接改写的开头、风险提醒。",
    "- draft 不是最终长回复，控制在 80 字以内，像一个自然的人会发的开头。",
    "- 不要迎合极端情绪，不要编造原文没有的信息。",
    "",
    "页面信息：",
    `标题：${page.title || "未知"}`,
    `地址：${page.url || "未知"}`,
    "",
    "网页内容：",
    context
  ].join("\n");
}

function parseModelResult(data) {
  const text = extractResponseText(data);
  if (!text) {
    throw new Error("模型没有返回可解析的文本。");
  }

  const cleaned = stripCodeFence(removeThinkBlocks(text));
  try {
    const parsed = JSON.parse(extractJsonObject(cleaned));
    return normalizeResult(parsed);
  } catch (error) {
    return normalizeResult({
      summary: "模型返回了非 JSON 文本。",
      response_points: ["可以参考原始输出自行整理。"],
      ideas: [
        {
          title: "原始输出",
          stance: "reframe",
          core: cleaned.slice(0, 500),
          reasoning: "结构化解析失败，但保留模型原文方便你查看。",
          draft: cleaned.slice(0, 120),
          risk: "建议重新生成，或检查模型是否支持结构化输出。"
        }
      ],
      follow_up_questions: []
    });
  }
}

function parsePostBriefResult(data) {
  const text = extractResponseText(data);
  if (!text) {
    throw new Error("模型没有返回可解析的文本。");
  }

  const cleaned = stripCodeFence(removeThinkBlocks(text));
  try {
    return normalizePostBrief(JSON.parse(extractJsonObject(cleaned)));
  } catch (error) {
    return normalizePostBrief({
      summary: "模型返回了非 JSON 文本。",
      key_points: ["可以参考原始输出自行整理。"],
      reply_suggestions: [
        {
          angle: "原始输出",
          reason: "结构化解析失败，但保留模型原文方便你查看。",
          draft: cleaned.slice(0, 600)
        }
      ],
      caution: "建议重新生成，或检查当前模型是否稳定遵循 JSON 输出。"
    });
  }
}

function extractResponseText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const chatText = data?.choices?.[0]?.message?.content;
  if (typeof chatText === "string") {
    return chatText;
  }

  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function normalizePostBrief(result) {
  const suggestions = Array.isArray(result.reply_suggestions) ? result.reply_suggestions : [];

  return {
    summary: String(result.summary || "").trim(),
    key_points: toStringArray(result.key_points).slice(0, 4),
    reply_suggestions: suggestions.slice(0, 4).map((item) => ({
      angle: String(item.angle || "回复角度").trim(),
      reason: String(item.reason || "").trim(),
      draft: String(item.draft || "").trim()
    })),
    caution: String(result.caution || "").trim()
  };
}

function normalizeResult(result) {
  const ideas = Array.isArray(result.ideas) ? result.ideas : [];

  return {
    summary: String(result.summary || "").trim(),
    response_points: toStringArray(result.response_points).slice(0, 5),
    ideas: ideas.slice(0, 6).map((idea) => ({
      title: String(idea.title || "未命名角度").trim(),
      stance: String(idea.stance || "reframe").trim(),
      core: String(idea.core || "").trim(),
      reasoning: String(idea.reasoning || "").trim(),
      draft: String(idea.draft || "").trim(),
      risk: String(idea.risk || "").trim()
    })),
    follow_up_questions: toStringArray(result.follow_up_questions).slice(0, 4)
  };
}

function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function stripCodeFence(text) {
  return String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function removeThinkBlocks(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractJsonObject(text) {
  const value = String(text || "").trim();
  if (value.startsWith("{") && value.endsWith("}")) {
    return value;
  }

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return value.slice(start, end + 1);
  }

  return value;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, "");
}

function buildChatCompletionsUrl(settings) {
  if (settings.provider === "compatible" && !String(settings.baseUrl || "").trim()) {
    throw new Error("自定义 OpenAI-compatible 提供方需要填写 API Base URL。");
  }

  const baseUrl = normalizeBaseUrl(settings.baseUrl || DEFAULT_SETTINGS.baseUrl);
  if (/\/(?:chat\/completions|text\/chatcompletion_v2)$/i.test(baseUrl)) {
    return baseUrl;
  }

  return `${baseUrl}/chat/completions`;
}

function providerLabel(provider) {
  return {
    minimax: "MiniMax",
    deepseek: "DeepSeek",
    qwen: "Qwen",
    kimi: "Kimi",
    gemini: "Gemini",
    anthropic: "Claude",
    compatible: "OpenAI-compatible"
  }[provider] || "模型";
}

function buildManualPromptResult({ settings, context, page, mode }) {
  const prompt = [
    buildSystemPrompt(settings),
    "",
    buildUserPrompt({
      settings,
      context: context.slice(0, 5000),
      page,
      mode
    }),
    "",
    "请直接给出结构化中文结果：",
    "1. 原文核心主张",
    "2. 值得回应的切入点",
    "3. 3-5 条回帖思路，每条包含：立场、核心观点、理由、80 字以内示例开头、风险提醒",
    "4. 可以继续追问的问题"
  ].join("\n");

  return {
    summary: "还没有配置 API Key，已生成可复制给 Codex 或 MiniMax 网页端的提示词。",
    response_points: [
      "自动生成需要在设置页填写 MiniMax Token Plan API Key 或 OpenAI API Key。",
      "现在可以先复制下面这段提示词到 Codex 或 MiniMax 网页端使用。"
    ],
    ideas: [
      {
        title: "复制给 Codex / MiniMax 的提示词",
        stance: "reframe",
        core: "这是无 API Key 降级方案：插件负责抓网页内容和组织提示词，模型生成这一步由你手动粘贴完成。",
        reasoning: "浏览器插件无法直接调用当前 Codex 会话；它只能调用可 HTTP 请求的模型 API，或把提示词交给你手动使用。",
        draft: prompt,
        risk: "提示词可能较长。若网页内容很长，建议先选中最想回应的段落再生成。"
      }
    ],
    follow_up_questions: []
  };
}

function buildManualPostBriefResult({ settings, context, page }) {
  const prompt = [
    buildSystemPrompt(settings),
    "",
    buildPostBriefPrompt({
      context: context.slice(0, 5000),
      page
    }),
    "",
    "请直接给出结构化中文结果：",
    "1. 这条帖子的干货总结",
    "2. 2-4 个关键点",
    "3. 3 条回复建议，每条包含角度、理由、80 字以内示例回复",
    "4. 一个回复风险提醒"
  ].join("\n");

  return {
    summary: "还没有配置 API Key，已生成可复制给 Codex 或 MiniMax 网页端的单帖分析提示词。",
    key_points: [
      "自动总结需要在设置页填写 MiniMax 国内版 Token Plan API Key。",
      "当前可以先复制提示词，粘贴到 Codex 或 MiniMax 网页端使用。"
    ],
    reply_suggestions: [
      {
        angle: "复制给 Codex / MiniMax 的提示词",
        reason: "浏览器插件无法直接调用当前 Codex 会话；没有 API Key 时只能先把帖子内容和任务要求整理成提示词。",
        draft: prompt
      }
    ],
    caution: "提示词可能较长。若帖子很长，建议先点进单帖详情页再生成。"
  };
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}
