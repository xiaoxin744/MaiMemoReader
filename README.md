# MaiMemo Reader · 墨墨 AI 英语精读

> 读取你在墨墨背单词当天的学习数据，由 DeepSeek 判断哪些词值得进文章、写成符合四六级 / 考研风格的原创英文，再配上阅读理解与原文依据。
>
> 纯前端 PWA：无服务器、无账号体系、无中央数据库。所有凭证、文章、作答记录只存在你自己的设备上。

**在线地址**：<https://ice-one531.github.io/MaiMemoReader/>
（GitHub Pages，仓库 `Ice-one531/MaiMemoReader`；源码在 `main`，构建产物在 `gh-pages`，Pages 从 `gh-pages` 分支发布）

```
E:\MaiMemoReader\
├─ README.md                 ← 你正在看的文件
├─ AGENTS.md                 ← 长期记忆：架构约定、接口硬事实、维护清单与维护记录
├─ docs\                     ← 使用说明、文件清单、接口测试报告、部署指南、测试记录
├─ app\                      ← 全部源代码（React + TypeScript + Vite）
│  ├─ src\
│  ├─ public\                ← PWA manifest、Service Worker、图标
│  ├─ tests\                 ← 66 个单元 / 集成 / 页面渲染测试
│  └─ worker\                ← 可选的 Cloudflare Worker 中继
├─ scripts\                  ← 图标生成脚本
└─ .github\workflows\        ← GitHub Pages 自动部署（在根目录，推整个文件夹即可）
```

---

## 1. 它解决什么问题

墨墨每天给你 100–200 个词，但「背过」不等于「会用」。这个项目做一件事：

**把当天这批词里真正值得练的那些，放进一篇你目标考试风格的原创英文里，让你在语境中再遇见它们一次，并用真题式题目检验你是否真的读懂。**

关键点在于「AI 选词」而不是「规则排序」：

- 忘记 / 模糊 / 新学 / 认识 的记忆状态是主要依据；
- 词汇之间的语义能不能组成一个主题、能不能撑起一篇文章，由模型判断；
- 不适合的词会**明确放弃并给出理由**，不为了覆盖率硬塞；
- 词太多且主题分散时，允许拆成 2–3 篇，但默认只生成你点开的那一篇，避免无谓花费。

## 2. 快速开始（本机）

```bash
cd E:\MaiMemoReader\app
npm install          # 或 pnpm install（项目在 exFAT 盘上，已配 nodeLinker: hoisted）
npm run dev          # http://localhost:5173
```

> E: 是 exFAT，不支持符号链接，所以 `pnpm-workspace.yaml` 已设 `nodeLinker: hoisted`；用 npm 安装则本来就无需处理。
> 如果 npm 提示 esbuild 的安装脚本被跳过，不影响构建（实测可用）。

生产构建与本地预览：

```bash
npm run build
npm run preview      # http://localhost:4173
```

第一次打开会看到三步引导，可以直接「用演示数据开始」——不填任何 Key 也能完整体验读文章、点词、做题、看解析、恢复任务。

## 3. 需要准备的凭证

| 用途 | 获取方式 | 存在哪 |
| --- | --- | --- |
| 墨墨学习数据 | App：我的 → 更多设置 → 实验功能 → 开放 API；或 open.maimemo.com/open/api/v1/tokens/openapi | 只在本机（IndexedDB / sessionStorage） |
| AI 生成（二选一） | **DeepSeek 官方**：platform.deepseek.com → API keys；**自定义 OpenAI 兼容服务**：Base URL + 模型名 + 可选 Key（OpenAI / 通义 / Ollama / LM Studio 等） | 默认仅当前会话，勾选后才长期保存 |

自定义接口要求服务端提供 `POST <Base URL>/chat/completions`，并允许浏览器跨域（CORS）；本地 Ollama / LM Studio 需要显式开启跨域。自定义模式下不会发送 DeepSeek 专有的 thinking / 联网检索参数，费用由服务商结算，应用不估算金额。

也可以走墨墨官方 OIDC 授权（Authorization Code + PKCE），但需要先在 open.maimemo.com/app 创建「纯前端应用」并通过审核，回调地址必须与站点域名一致。详见 `docs/03-接口调研与跨域测试.md`。

## 4. 主要功能

- **今日页**：进度环、按记忆状态分组的词块、同步今日数据、未完成任务恢复入口。
- **生成页**：四种考试模式（CET-4 / CET-6 / 考研英一 / 考研英二）、题材、篇幅、难度、题量、单篇或自动组篇、AI 接口与模型、联网开关；真实阶段进度 + 流式预览 + 随机等待文案。
- **阅读器**：杂志式排版、首字下沉、目标词高亮（识别词形变化）、点词看语境释义（可让 AI 现生成并缓存）、译文开关、专注模式、词汇覆盖分析、收藏、Markdown 导出。
- **答题**：四选一、逐题作答、统一交卷、分数与逐题解析、原文依据定位高亮、可重复练习并保留记录。
- **任务恢复**：分阶段落盘（IndexedDB），正文完成而命题中断时只重跑命题；正文断开则保留选词方案；不自动重发可能重复计费的请求。
- **书架**：搜索、按考试筛选、收藏、最佳成绩、删除、全量导出 / 导入（不含密钥）。
- **PWA**：可安装到 iPhone 主屏与 Windows 桌面，静态资源离线可用，API 响应永不进入缓存。

## 5. 技术选型

React 18 + TypeScript + Vite 5，零 UI 框架、零状态库、零 IndexedDB 封装库：

- 路由：hash 路由（`#/read/...`），GitHub Pages 子路径下无需服务端回退；
- 存储：手写 IndexedDB 封装（`src/lib/db.ts`），按账号隔离；
- 样式：`src/styles/index.css` 一套设计令牌，纸感底色 + 墨色 + 朱砂强调，暗色模式与「减少动态效果」均有支持；
- 网络：`fetch` 直连墨墨与所选 AI 接口；DeepSeek 官方走 SSE 流式解析，自定义 OpenAI 兼容服务同样走 SSE，不支持时自动降级为整包 JSON；
- 测试：Vitest + jsdom + fake-indexeddb，覆盖词形匹配、结构化校验、费用核算、管线成功 / 失败路径、自定义接口兼容与页面渲染（66 例）。

## 6. 已知边界（先看这里，避免误期待）

- 墨墨的学习数据接口官方仍标注「公测」，字段可能调整；当天没在 App 内初始化学习时拿不到数据。
- 浏览器**直连**墨墨：预检可过，但墨墨的错误响应不带跨域头，所以「Token 错误」在浏览器里表现为网络失败，前端无法区分；项目提供连接测试与可选 Worker 中继来定位。
- 官方授权模式需要应用审核，且回调域名必须与登记的主页域名一致；未审核时先用个人 Token 或演示模式。
- iOS 切到后台会暂停网络请求。生成过程中断后点「继续」从已完成阶段续跑，不会重复计费。
- 费用仅在 DeepSeek 官方模式下按官方定价表 + 返回 usage **估算**，最终以 DeepSeek 账单为准；自定义接口由你的服务商结算，应用不显示金额。

完整文档：

- [使用说明](docs/01-使用说明.md)
- [文件清单与用途](docs/02-文件清单与用途.md)
- [接口调研与跨域测试](docs/03-接口调研与跨域测试.md)
- [部署与 PWA 安装](docs/04-部署与PWA安装.md)
- [测试记录](docs/05-测试记录.md)
