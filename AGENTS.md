# AGENTS.md · 项目长期记忆

> 给未来的自己（或下一个接手的人 / Agent）看的操作手册。
> **每次改动涉及接口、数据结构、部署方式、依赖版本时，请顺手更新本文件末尾的「维护记录」。**
> 最后核对：2026-11-12

---

## 0. 一句话定位

纯前端 PWA：读取墨墨背单词**当日**学习数据 → AI 选词、组篇、命题 → 沉浸式精读 + 阅读理解 → 全部数据留在本机。
没有后端、没有账号体系、没有中央数据库；唯一的可选服务端组件是一个只做转发的 Cloudflare Worker。

---

## 1. 目录速查

```
E:\MaiMemoReader\
├─ AGENTS.md            ← 本文件（长期记忆 / 约定 / 维护清单）
├─ README.md            ← 对外介绍
├─ docs\                ← 01 使用说明 / 02 文件清单 / 03 接口与跨域 / 04 部署与 PWA / 05 测试记录
├─ app\                 ← 代码根（所有 npm 命令都在这里执行）
│  ├─ src\{api,ai,lib,state,components,pages,styles}
│  ├─ public\{manifest.webmanifest,sw.js,icons\}
│  ├─ tests\
│  ├─ worker\           ← 可选中继
│  ├─ pnpm-workspace.yaml / .npmrc  ← hoisted 安装（exFAT 不支持软链接）
│  └─ dist\             ← 构建产物（gitignore）
├─ .github\workflows\deploy.yml     ← 在仓库根，构建 app/ 并发布 app/dist（当前线上未启用）
└─ scripts\
   ├─ make_icons.py
   └─ deploy-github.ps1            ← 走 REST API 发布到 GitHub Pages（不需要 git / gh）
```

## 2. 常用命令（都在 `app\` 下）

```bash
npm install            # 或 pnpm install（exFAT 已配 nodeLinker: hoisted；esbuild 脚本被拦不影响构建）
npm run dev            # http://localhost:5173
npm run typecheck      # tsc --noEmit，必须保持 0 错误
npm test               # vitest run，当前 66 个用例
npm run build          # typecheck + vite build，产物在 dist/
npm run preview        # 预览生产构建
python ..\scripts\make_icons.py   # 重新生成图标（改配色后）
```

Node 20+。Windows 上如果 `node` 不在 PATH，用 Node 安装目录的绝对路径调用即可。

---

## 3. 架构约定（改代码前必须读）

### 3.1 认证双轨，共用一份数据层

`src/api/maimemo.ts` 定义 `MaimemoConnector`（`kind` / `label` / `accessToken()` / `test()`），
`TokenConnector` 与 `OidcConnector` 各自实现。**页面只依赖接口，不允许直接读 token 或拼接请求。**
这样任意一条认证路径都可以被整体删除而不牵动业务代码——这是设计约束，不要破坏。

### 3.2 生成链路

`src/ai/pipeline.ts` 是唯一编排点，阶段：`selection → article → questions → qa → save`。
硬性规则：

1. 每个阶段结束**立即**写 IndexedDB（`tasks` 表），流式正文另有 900ms 节流落盘；
2. 失败只标记当前任务 `failed / interrupted`，**已完成阶段的结果不得丢弃**；
3. **绝不自动重发**可能重复计费的请求，恢复必须由用户点击；
4. 质检（qa）属于增强阶段，失败只写备注，不阻断交付；
5. 只有 `task.status === 'complete'` 的文章才进书架。

模型调用统一经 `src/api/deepseek.ts` 的 `ApiTarget { provider, baseUrl, apiKey, model }`：`apiTargetOf(settings, model?)` 解析，`apiConfigError(target)` 校验，`pipeline.ts` 不再接收裸 `apiKey`。`provider='custom'` 表示用户自填的 OpenAI 兼容服务；DeepSeek 专有的 `thinking` / `reasoning_effort` / `/v1/tools/search` 只在 `provider='deepseek'` 时启用。任务创建时把 `apiProvider` 写进 `GenerateOptions`，恢复旧任务前必须校验它与当前设置一致。

### 3.3 结构化输出

所有模型输出都走 `src/ai/validate.ts` 收敛，页面只消费校验后的数据。
新增字段时：先改 `src/types.ts` → 改 prompt 的 JSON 结构说明 → 改 validate → 补测试。

### 3.4 存储与账号隔离

`src/lib/db.ts` 九张表：`kv / secrets / snapshots / articles / questions / attempts / tasks / glossary / sessions`。
所有业务记录带 `accountId`；`state/store.tsx` 里按 `settings.accountId` 过滤。
`accountId` 规则：个人 Token 模式为 `local`，OIDC 模式为 `oidc:<sub>`。

### 3.5 凭证

`src/lib/vault.ts`：内存 + `sessionStorage` 为默认，只有用户勾选才写 IndexedDB。
三把钥匙各自独立：`deepseekKey`、`customApiKey`、`maimemoToken`（另加 `oidc:<sub>` 令牌）。
**禁止**把密钥放进 `settings` 的持久化对象、日志、导出文件或构建产物（`saveSettings` 会剥离，导出会删除字段）。

### 3.6 路由与部署

hash 路由（`src/lib/router.ts`），地址形如 `#/read/<id>`、`#/generate?task=<id>&next=1`。
`vite.config.ts` 的 `base` 默认 `./`，`VITE_BASE` 可覆盖；这样同一份 `dist` 既能本地跑也能放 Pages 子路径。
OAuth 回调地址取 `origin + pathname`（不带 hash/query），必须与开放平台登记的主页域名一致。

**线上发布方式**（2026-10-28 起）：`scripts/deploy-github.ps1` 走 GitHub REST API，
源码推 `main`、构建产物推 `gh-pages`，Pages 用 **分支发布**（legacy），入口
<https://ice-one531.github.io/MaiMemoReader/>。

- 该脚本**故意不推 `.github/`**：分支发布与 Actions 发布只能二选一，同时存在会让 Actions 跑到失败；
- 改代码后必须 `npm run build` 再跑脚本，否则 `gh-pages` 还是旧的；
- 想切回 Actions：把 `.github/` 推上去，并在仓库 Settings → Pages 把 Source 改成 GitHub Actions；
- 上传走 Blob API（`encoding: base64`）——**不能**用 Trees API 的 `content` 字段塞 base64，那样会把 base64 文本当文件内容发布出去（踩过）。

### 3.7 Service Worker

`public/sw.js`：静态资源 stale-while-revalidate，导航 network-first + 离线回落。
**任何跨域请求、API 请求、带 `Authorization` 的请求都不得进入 Cache Storage。** 改这块时先读一遍现有限制。
改动静态资源后若行为异常，先把 `VERSION` 加一，再排查缓存。

### 3.8 设计体系

`src/styles/index.css` 单一入口：纸感底色 + 墨色 + 朱砂强调，衬线用于阅读、无衬线用于操作。
新增 UI 时优先复用现有类（`.btn`、`.chip`、`.tag`、`.card` 风格、`.meta`、`.eyebrow`），
不要引入 Tailwind / UI 组件库，也不要加"卡片堆叠"式 Dashboard。
暗色模式靠 `:root[data-theme="dark"]` 的令牌切换，不要写死颜色；动效需尊重 `data-motion="reduce"`。

---

## 4. 外部接口的硬事实（踩过的坑）

### 墨墨开放 API

- Base `https://open.maimemo.com/open`；`Authorization: Bearer <token>`。
- 用到：`POST /api/v1/memo/study/get_study_progress`（空 body）、`POST /api/v1/memo/study/get_today_items`（`{limit:1000}`）、`GET /api/v1/memo/vocabulary?spelling=`。
- **没有日期参数**，语义恒为「今天」；当天未在 App 内初始化就拿不到数据 → UI 要给"去打开 App 学习"的提示，而不是报错。
- 响应可能带 `{errors:[{code,msg,info}], success:false}`；错误码如 `common_unauthorized`、`common_not_found`。
- 频控 10s/20、60s/40、5h/2000；一次同步只发 2 个请求，别加轮询。
- **CORS 坑**：预检会回显任意 Origin（204 + `access-control-allow-origin`），但 **401/404 等错误响应不带 CORS 头** → 浏览器里"Token 错"和"跨域失败"都表现为 `Failed to fetch`。文案不要断言原因；需要精确定位时走中继。
- 官方文档还写明「应用审核通过和主页地址的域名会被允许跨域请求开放 API」，所以个人 Token 模式的跨域不是官方承诺，中继方案必须保留。
- 学习数据接口标注「公测」，字段全部按可选处理。

### 墨墨 OIDC

- issuer `https://accounts.maimemo.com/oidc`；auth `/auth`、token `/token`、me `/me`、revocation `/token/revocation`、end_session `/session/end`。
- 支持 `S256` PKCE；`token_endpoint_auth_methods_supported` 含 `none`（公开客户端）。
- token 端点错误响应**带 CORS 头**，可在浏览器里读到。
- 本项目不本地验签 id_token，只用 `sub` 做本地账号隔离；令牌只经 TLS 直取。

### DeepSeek

- Base `https://api.deepseek.com`；`POST /chat/completions`，`Authorization: Bearer sk-...`。
- 模型只有两个可用名：`deepseek-flash`、`deepseek-v4-pro`（旧名已下线但可调用，按 Flash 计费）。
- 思考模式**默认开启**；关闭用 `{"thinking":{"type":"disabled"}}`；思考模式下 `temperature` 无效。
- JSON 模式：`response_format:{type:'json_object'}` **且 prompt 必须含 "json" 字样与结构示例**；偶发空 content，需重试。
- 流式要拿 usage 需 `stream_options:{include_usage:true}`。
- Search：`POST /v1/tools/search`（`query/count/need_content`），1000 次 5 元，按成功且非空计费；Fetch：`/v1/tools/fetch`，25 QPS。
- 价格（元/百万 token）：flash 0.02/1/4，v4-pro 0.15/4.5/13.5（缓存命中/未命中/输出）；高峰（工作日 9–12、14–18）翻倍。
- 错误码：400/401/402/422/429/500/503；429 与 5xx 可安全重试，其余不要重试。
- **CORS 全通**：预检与错误响应均回显 Origin，浏览器直连成立。

### 自定义 OpenAI 兼容接口（2026-11-12 新增）

- 设置项：`apiProvider`（`deepseek` / `custom`）、`customApiBase`、`customApiModel`、`customApiKey` + `customApiKeyPersist`；两套配置并存，切换即生效。
- 协议只依赖 `POST <Base URL>/chat/completions`：默认 `stream:true` + `stream_options.include_usage`；非 `text/event-stream` 的整包 JSON 回包也兼容（读 `choices[0].message.content`）。
- 400 降级：仅当错误文本明确提到 `response_format|json_object|json mode` 或 `stream_options|include_usage` 时剥掉对应字段重试一次；400 表示请求未执行，不产生额外计费；其他 400 不重试。
- 不发 DeepSeek 专有字段；`temperature` 仅在调用方明确传入时透传。`/v1/tools/search` 在自定义模式下关闭。
- 费用：`costOf(..., 'custom')` 恒为 0，`UsageTotal.costKnown=false`，UI 显示「费用由服务商结算」；不要给自定义接口编造价格。
- 浏览器直连取决于服务商 CORS，**未逐一实测**；文档只能写「协议兼容」，不能写「已验证支持某服务」。
- 恢复旧任务时若 `task.options.apiProvider` 与当前 `settings.apiProvider` 不一致，阻止恢复并提示切回，避免模型名发错服务。

---

## 5. 不要做的事

1. 不要把任何密钥写进仓库、构建产物、日志、导出 JSON 或错误提示里。
2. 不要为了"覆盖当天所有单词"而降低文章质量；选词允许放弃，且必须写理由。
3. 不要在 Service Worker 里缓存 API 响应或带凭证的请求。
4. 不要在未完成时显示成功；进度条不得长期停在 99%。
5. 不要自动重发已断开或已计费的生成请求。
6. 不要引入服务器、数据库、账号系统、云队列来"让后台跑"。
7. 不要把用户数据发往第三方分析服务。
8. 不要用 UI 组件库或模板化 Dashboard 替换现有设计体系。
9. 不要提交 `node_modules`、`dist`、`.env`、导出的个人数据。
10. 不要在没有真实凭证时把接口测试写成"已验证成功"。

---

## 6. 改动后的自检清单

- [ ] `npm run typecheck` 0 错误
- [ ] `npm test` 全绿（新增逻辑要有用例）
- [ ] `npm run build` 成功，`dist/` 里 `manifest.webmanifest`、`sw.js`、`icons/` 齐全
- [ ] 涉及数据结构时：`types.ts` / validate / 导出导入 / 旧数据兼容都过一遍
- [ ] 涉及凭证时：默认不持久化、导出不含密钥、清除能清干净
- [ ] 涉及 AI 接口时：DeepSeek 与自定义两套都跑请求体断言（自定义不含 `thinking` / `reasoning_effort`；400 降级只重试一次）
- [ ] 涉及样式时：移动端（≤390px）与桌面（≥1280px）都看；暗色模式；减少动效
- [ ] 涉及部署时：`VITE_BASE` 子路径、OAuth 回调域名、`404.html` 回退
- [ ] 文档同步：README / docs 02 文件清单 / 本文件「维护记录」

---

## 7. 定期维护（建议每月 / 每次发版前）

**接口与模型**

1. 重新抓 `https://open.maimemo.com/api_bundle.yaml`，核对学习数据接口路径、字段、频控是否变化。
2. 重新抓 OIDC 发现文档，核对端点与支持的 PKCE / scope。
3. 查 DeepSeek 定价页与模型页：模型名、上下文、价格、thinking / JSON / Search 参数是否变化；变了就同步 `src/api/deepseek.ts` 的 `MODELS` 与文档。
4. 用 `curl` 复测两套 CORS（见 docs/03 的 3.1–3.3）：预检 + 错误路径是否仍与记录一致。

**代码**

5. `npm outdated` 看关键依赖（react / vite / typescript / vitest），升级后跑测试与构建。
6. 检查 `public/sw.js` 的 `VERSION` 是否随发版更新。
7. 跑一次真机流程：iPhone 添加到主屏 → 切后台 → 回前台 → 恢复任务；Windows 安装 → 离线打开已存文章。

**数据与隐私**

8. 确认导出文件仍不含 `deepseekKey` / `customApiKey` / `maimemoToken` / OIDC token。
9. 确认「清除本机数据」后 IndexedDB 九张表为空，且 SW 缓存未残留用户内容。

**文档**

10. 更新本文件末尾记录；docs/05 的复测清单勾选情况一并更新。

---

## 8. 已知待办 / 可继续做的事

- [ ] 官方 OIDC 应用审核通过后，补一次真实授权闭环与 GitHub Pages 正式域名的调用验证。
- [ ] 墨墨 200 成功响应的 CORS 头需要用真实 Token 复测，结论回填 docs/03。
- [ ] 自动组篇的第 2、3 篇目前需手动触发（成本考虑）；若要批量生成，需在 UI 明示总价。
- [ ] 阅读器可加"生词本"与跨文章复习（当前刻意不做跨日期调度）。
- [ ] 可补 `deepseek-v4-pro` 与 flash 的 A/B 题质对比记录。
- [ ] 可把 `docs/05` 的复测清单做成脚本化的 `scripts/probe-cors.mjs`。

---

## 9. 维护记录

| 日期 | 变更 | 核对人 |
| --- | --- | --- |
| 2026-10-28 | 项目初始化：墨墨双轨接入、DeepSeek 客户端、选词/成文/命题/质检管线、阅读器与答题、PWA 与部署配置、41 个测试、五份文档；完成 CORS 实测并记录墨墨错误响应缺 CORS 头这一关键结论。后续增补：`AGENTS.md` 长期记忆、`tests/pages.test.tsx` 页面渲染测试 | 初始构建 |
| 2026-10-28 | 上线 GitHub Pages：仓库 `Ice-one531/MaiMemoReader`，站点 <https://ice-one531.github.io/MaiMemoReader/>；新增 `scripts/deploy-github.ps1`（REST API 发布，无需 git）。踩坑两处：空仓库直接建 tree 返回 409（改用 Contents API 引导首个提交）；Trees API 的 `content` 不认 base64（改为 Blob API + `encoding: base64`），首次误把 base64 文本发布成站点，已重新发布并逐项校验 200 | 部署验证 |
| 2026-11-12 | 新增自定义 OpenAI 兼容接口：`ApiTarget`/`apiTargetOf`/`apiConfigError` 统一解析与校验；deepseek.ts 支持任意 Base URL、整包 JSON 兜底、400 可选参数降级；设置页「AI 接口」双轨（DeepSeek / 自定义）、三把密钥独立存储；pipeline/Reader 改用 target，自定义模式关闭 thinking/联网、费用标记 `costKnown=false`；恢复旧任务校验接口一致性；新增 `custom-api.test.ts` 9 例并补管线与页面用例，测试 66 例全绿，typecheck/build 通过；同步 README、docs 01/02/03/05 与本文件 | 实现与复核 |
