# woniu

一个浏览器回帖思路助手。它可以在浏览网页或 X 长文时读取当前页面内容，结合你的个人背景和表达偏好，生成有水准的回帖角度。

## 当前版本

这是一个 Chrome/Edge Manifest V3 插件原型，特点：

- 右侧悬浮面板，随时打开或关闭。
- 在 X/Twitter 信息流里，每条帖子用户名旁显示一个小图标，点击即可查看这条帖子的干货总结和回复建议。
- 优先读取你选中的文字；没有选中文字时，会尝试抓取当前网页正文或 X 页面可见长文。
- 在浏览器本地保存模型 API Key、个人信息、表达偏好和反馈记忆。
- 支持 MiniMax、OpenAI、DeepSeek、Qwen、Kimi、Gemini、Claude 和自定义 OpenAI-compatible，默认使用 MiniMax。
- 没有 API Key 时，会降级生成一段可复制给 Codex 或 MiniMax 网页端的提示词。
- 输出结构化回帖思路：内容摘要、可回应点、多个观点角度、示例开头和风险提醒。
- 支持对生成结果标记“有用/没用”，后续生成时会参考这些偏好。

## 安装到浏览器

1. 打开 Chrome 或 Edge。
2. 地址栏输入 `chrome://extensions` 或 `edge://extensions`。
3. 打开“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择这个文件夹：`/Users/liugancheng/woniu`。
6. 点击插件图标，先进入“设置”，填写模型配置和个人偏好。

## 模型配置

### 推荐：有 MiniMax Token Plan API Key

设置页保持默认即可：

- 模型提供方：`MiniMax`
- API Base URL：`https://api.minimax.io/v1`
- 模型：`MiniMax-M2.7`

然后填写你的 MiniMax API Key。

如果你所在账户给的是中国区接口，可以把 API Base URL 改成：

`https://api.minimaxi.com/v1`

### 可选模型提供方

设置页已经内置常用模型下拉：

| 提供方 | 默认接口 | 常用模型 |
| --- | --- | --- |
| MiniMax | `https://api.minimax.io/v1` | `MiniMax-M2.7`, `MiniMax-M2.7-highspeed`, `MiniMax-M2.5`, `MiniMax-M2`, `MiniMax-Text-01` |
| OpenAI | `https://api.openai.com/v1` | `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-chat`, `deepseek-reasoner` |
| 通义千问 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3.6-plus`, `qwen3.6-flash`, `qwen3-max`, `qwen3.5-plus`, `qwen3.5-flash`, `qwen3-coder-plus` |
| Kimi / Moonshot | `https://api.moonshot.ai/v1` | `kimi-k2.6`, `kimi-k2.5`, `kimi-k2-thinking`, `moonshot-v1-128k` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-3.1-flash-lite-preview`, `gemini-2.5-pro`, `gemini-2.5-flash` |
| Claude | `https://api.anthropic.com/v1` | `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`, `claude-opus-4-1-20250805` |
| 自定义 OpenAI-compatible | 手动填写 | 手动填写模型 ID |

OpenAI 提供方使用 Responses API。其他提供方默认使用 OpenAI-compatible Chat Completions，也就是 `/chat/completions`。

### 有 OpenAI API Key

设置页选择：

- 模型提供方：`OpenAI`
- API Base URL：`https://api.openai.com/v1`
- 模型：填写你账号可用的模型

### 没有任何 API Key

也可以先试用：

- 插件会抓取网页内容。
- 点击“生成思路”后，会生成一段完整提示词。
- 点击“复制完整提示词”，再粘贴到 Codex、MiniMax 网页端或其他聊天工具里。

这种模式不能自动返回结果到浏览器面板，但适合先验证产品流程。

## 使用方式

1. 打开一篇文章、帖子或 X 长文。
2. 最好先选中你想回应的那段文字。
3. 点击页面右侧的“回帖”按钮，或点击浏览器插件图标里的“打开助手”。
4. 选择回复模式，点击“生成思路”。
5. 复制你喜欢的示例开头，再自己加工成最终回复。

## X/Twitter 单帖图标

加载扩展后，在 X/Twitter 的信息流里，每条可识别的帖子用户名旁会出现一个小图标。点击后会弹出一个小浮层：

- 干货总结：提炼这条帖子的核心信息。
- 关键点：列出值得注意的论点或隐含前提。
- 回复建议：给出几个可复制的回复方向。
- 注意：提醒事实、语气或立场风险。

同一条帖子点过后会在当前页面内缓存结果，重复点不会再次请求模型。

## 隐私说明

- API Key、个人信息和反馈记忆默认保存在浏览器本地。
- 插件会把你选择或抓取的网页文本发送给你在设置页选择的模型 API 以生成结果。
- 当前版本没有后端服务器，也不会把你的数据同步到项目作者的服务器。
