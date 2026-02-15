# Traced

> **Not a new word. Just a familiar one, revisited.**
> You've met this word before — Traced helps you remember where.

一个 Chrome 扩展，帮你在真实阅读中积累英语词汇。不是传统单词本，而是追踪你和每个单词"相遇"的工具。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 功能介绍

### 划词翻译

在任意网页选中单词，点击墨滴图标即可翻译。支持三种模式：

- **标准模式** — 中文释义 + 古诗词联想 + 网文风格旁白，三合一
- **诗词模式** — 展开完整古诗词原文
- **网文模式** — 展开网文风格的夸张旁白

翻译卡片上可以点击喇叭图标听发音，点击 **Trace** 按钮收藏单词。每次查词自动记录语境（上下文句子、来源页面）。

### 智能高亮

页面上自动高亮你正在学的词汇，用颜色区分熟悉程度：

- 🔴 红色 — 新词（分数低）
- 🟡 黄色 — 学习中
- 🟢 绿色 — 即将掌握

通过快捷键 `Alt+W` 切换三种显示模式：关闭 → 仅 Traced → 全部词汇。

`Alt+Q` 可以开关段落翻译，鼠标悬停段落自动显示中文译文。

### 词库系统

内置 8 个词库，覆盖主流考试和场景：

| 词库 | 说明 |
|------|------|
| CET-4 / CET-6 | 大学英语四六级 |
| 高考 | 高考英语 |
| 考研 | 研究生入学考试 |
| 小学 | 小学英语基础词 |
| 编程 | 开发者常用术语 |
| 日常 | 日常高频词 |
| Top 10K | 常用一万词 |

在设置页的**词库管理**中勾选你的目标词库。也可以创建自定义词库并批量导入单词。

### 智能扩展

即使不在任何词库中，如果一个词在你的阅读中反复出现，Traced 会自动把它纳入你的学习范围。条件：

- 在 3 万词词典中存在
- 排除超高频基础词（rank < 2000）
- 在多个页面遇见过多次

可在设置页的词库管理中开关。

### 噪音词过滤

the、have、is 这类你肯定已经认识的常见词，默认被锁定，不会出现在高亮和学习列表中。如果某个词被误锁，可以手动解锁。

### 页面掌控度

打开 Popup（点击扩展图标），顶部环形图显示：**当前页面中，你目标词库的词掌握了多少**。

- 百分比实时计算
- 100% 时显示金色星星
- 列出阻碍满分的 Top 3 未掌握高频词

### 抽卡复习

在 Dashboard 页面可以随机抽取单词卡片：

- 正面：单词 + 挖空的上下文句子
- 背面：释义 + 来源页面
- 三档评分：认识 / 眼熟 / 不认识

基于间隔重复算法，优先复习快要忘记的词。

### 词汇管理

Popup 底部展示当前页面的词汇列表，支持按词频或页面顺序排序。左滑可以快速 Trace 收藏。

在设置页的 **Library** 标签可以查看全部词汇，搜索、筛选、查看遇见历史。

### 隐私

- 所有数据存在本地浏览器（IndexedDB），不上传任何内容
- 仅翻译时将选中文本发送到你自己配置的 API
- API Key 仅存储在本地

---

## 安装

```bash
git clone https://github.com/huanianzs/traced.git
cd traced
npm install
npm run build
```

在 Chrome 中加载：
1. 打开 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序** → 选择 `dist` 文件夹

开发模式（热重载）：
```bash
npm run dev
```

---

## 配置

### API 配置（必需）

翻译功能需要一个 OpenAI 兼容的 API。在 Settings 标签中填写：

- **Base URL** — API 地址（如 `https://api.openai.com/v1`）
- **API Key** — 你的密钥
- **Model** — 模型名（如 `gpt-4o-mini`）

支持 OpenAI、DeepSeek、Qwen、本地 Ollama 等任何兼容 API。可配置多个 Provider，自动故障转移。

### 选择目标词库

在设置页的词库管理中，勾选你正在准备的考试词库（如 CET-6、考研）。

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| Alt+W | 切换单词翻译模式（关闭 → 仅 Traced → 全部） |
| Alt+Q | 切换段落翻译 |

---

## 技术栈

| 层 | 技术 |
|----|------|
| 框架 | React 19 + TypeScript 5.9 |
| 构建 | Vite 7 + @crxjs/vite-plugin |
| 样式 | Tailwind CSS 4 |
| 存储 | Dexie.js (IndexedDB) |
| 扩展标准 | Manifest V3 |
| 多语言 | en / zh-CN / zh-TW |

---

## License

[MIT](LICENSE) © 2026 huanianzs
