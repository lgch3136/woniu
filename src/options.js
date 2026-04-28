const DEFAULTS = {
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

const PROVIDER_PRESETS = {
  minimax: {
    baseUrl: "https://api.minimax.io/v1",
    models: [
      ["MiniMax-M2.7", "MiniMax M2.7"],
      ["MiniMax-M2.7-highspeed", "MiniMax M2.7 高速"],
      ["MiniMax-M2.5", "MiniMax M2.5"],
      ["MiniMax-M2.5-highspeed", "MiniMax M2.5 高速"],
      ["MiniMax-M2", "MiniMax M2"],
      ["MiniMax-M1", "MiniMax M1"],
      ["MiniMax-Text-01", "MiniMax Text 01"]
    ]
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    models: [
      ["gpt-5.5", "GPT-5.5"],
      ["gpt-5.4", "GPT-5.4"],
      ["gpt-5.4-mini", "GPT-5.4 mini"],
      ["gpt-5.4-nano", "GPT-5.4 nano"]
    ]
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    models: [
      ["deepseek-v4-pro", "DeepSeek V4 Pro"],
      ["deepseek-v4-flash", "DeepSeek V4 Flash"],
      ["deepseek-chat", "DeepSeek Chat（旧版）"],
      ["deepseek-reasoner", "DeepSeek Reasoner（旧版）"]
    ]
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      ["qwen3.6-plus", "Qwen3.6 Plus"],
      ["qwen3.6-flash", "Qwen3.6 Flash"],
      ["qwen3-max", "Qwen3 Max"],
      ["qwen3.5-plus", "Qwen3.5 Plus"],
      ["qwen3.5-flash", "Qwen3.5 Flash"],
      ["qwen3-coder-plus", "Qwen3 Coder Plus"],
      ["qwen-plus", "Qwen Plus"],
      ["qwen-flash", "Qwen Flash"]
    ]
  },
  kimi: {
    baseUrl: "https://api.moonshot.ai/v1",
    models: [
      ["kimi-k2.6", "Kimi K2.6"],
      ["kimi-k2.5", "Kimi K2.5"],
      ["kimi-k2-thinking", "Kimi K2 Thinking"],
      ["moonshot-v1-128k", "Moonshot v1 128k"],
      ["moonshot-v1-32k", "Moonshot v1 32k"]
    ]
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      ["gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview"],
      ["gemini-3-flash-preview", "Gemini 3 Flash Preview"],
      ["gemini-3.1-flash-lite-preview", "Gemini 3.1 Flash-Lite Preview"],
      ["gemini-2.5-pro", "Gemini 2.5 Pro"],
      ["gemini-2.5-flash", "Gemini 2.5 Flash"]
    ]
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      ["claude-opus-4-7", "Claude Opus 4.7"],
      ["claude-sonnet-4-6", "Claude Sonnet 4.6"],
      ["claude-haiku-4-5-20251001", "Claude Haiku 4.5"],
      ["claude-opus-4-1-20250805", "Claude Opus 4.1"]
    ]
  },
  compatible: {
    baseUrl: "",
    models: [
      ["", "手动填写模型 ID"]
    ]
  }
};

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const feedbackSummary = document.getElementById("feedbackSummary");
const clearFeedbackButton = document.getElementById("clearFeedback");
const providerSelect = document.getElementById("provider");
const modelPresetSelect = document.getElementById("modelPreset");

load();

providerSelect.addEventListener("change", () => {
  applyProviderPreset(providerSelect.value, true);
});

modelPresetSelect.addEventListener("change", () => {
  if (modelPresetSelect.value) {
    document.getElementById("model").value = modelPresetSelect.value;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const patch = {
    provider: String(data.get("provider") || DEFAULTS.provider).trim(),
    apiKey: String(data.get("apiKey") || "").trim(),
    baseUrl: String(data.get("baseUrl") || DEFAULTS.baseUrl).trim().replace(/\/+$/, ""),
    model: String(data.get("model") || DEFAULTS.model).trim(),
    replyCount: clampNumber(Number(data.get("replyCount")), 2, 6, DEFAULTS.replyCount),
    profile: String(data.get("profile") || "").trim(),
    expertise: String(data.get("expertise") || "").trim(),
    voice: String(data.get("voice") || "").trim(),
    goals: String(data.get("goals") || "").trim(),
    boundaries: String(data.get("boundaries") || "").trim(),
    memory: String(data.get("memory") || "").trim()
  };

  await chrome.storage.local.set(patch);
  showStatus("已保存");
});

clearFeedbackButton.addEventListener("click", async () => {
  await chrome.storage.local.set({ feedback: [] });
  renderFeedback([]);
  showStatus("反馈已清空");
});

async function load() {
  const values = await chrome.storage.local.get(DEFAULTS);
  applyProviderPreset(values.provider || DEFAULTS.provider, false);

  for (const key of Object.keys(DEFAULTS)) {
    const input = document.getElementById(key);
    if (!input || key === "feedback") {
      continue;
    }
    input.value = values[key] ?? DEFAULTS[key];
  }

  syncModelPreset(values.model || DEFAULTS.model);
  renderFeedback(values.feedback || []);
}

function applyProviderPreset(provider, shouldResetModel) {
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.compatible;
  providerSelect.value = PROVIDER_PRESETS[provider] ? provider : "compatible";
  modelPresetSelect.innerHTML = "";

  for (const [value, label] of preset.models) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    modelPresetSelect.append(option);
  }

  if (!preset.models.some(([value]) => value === "")) {
    const customOption = document.createElement("option");
    customOption.value = "";
    customOption.textContent = "自定义模型 ID";
    modelPresetSelect.append(customOption);
  }

  if (shouldResetModel) {
    document.getElementById("baseUrl").value = preset.baseUrl;
    const firstModel = preset.models[0]?.[0] || "";
    document.getElementById("model").value = firstModel;
    syncModelPreset(firstModel);
  }
}

function syncModelPreset(model) {
  const exists = Array.from(modelPresetSelect.options).some((option) => option.value === model);
  modelPresetSelect.value = exists ? model : "";
}

function renderFeedback(feedback) {
  if (!Array.isArray(feedback) || feedback.length === 0) {
    feedbackSummary.textContent = "暂无反馈";
    return;
  }

  const up = feedback.filter((item) => item.rating === "up").length;
  const down = feedback.filter((item) => item.rating === "down").length;
  feedbackSummary.textContent = `已记录 ${feedback.length} 条反馈，其中有用 ${up} 条，没用 ${down} 条。`;
}

function showStatus(message) {
  statusEl.textContent = message;
  window.setTimeout(() => {
    statusEl.textContent = "";
  }, 1800);
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
