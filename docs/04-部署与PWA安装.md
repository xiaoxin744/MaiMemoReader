# 部署与 PWA 安装

## 〇、已经部署好的实例（2026-10-28）

| 项目 | 值 |
| --- | --- |
| 站点 | <https://ice-one531.github.io/MaiMemoReader/> |
| 仓库 | <https://github.com/Ice-one531/MaiMemoReader> |
| 分支 | `main` = 源码（不含 `.github`）、`gh-pages` = 构建产物 |
| Pages 来源 | **Deploy from a branch** → `gh-pages` / `/`（legacy，非 Actions） |
| 部署方式 | `scripts\deploy-github.ps1`（GitHub REST API，本机不需要 git / gh） |

更新站点的固定动作：

```powershell
cd E:\MaiMemoReader\app
npm run build
cd ..
.\scripts\deploy-github.ps1 -Token <你的 PAT>
```

脚本会重新上传 `main` 与 `gh-pages` 并等待 Pages 构建完成。若用 GitHub Actions 自动构建，请把 `.github/` 推上去，并在 Settings → Pages 把 Source 改成 **GitHub Actions**（两种发布方式不能同时生效）。

---

三种运行场景：本地开发、本地生产预览、GitHub Pages 公开部署。三者使用同一套代码，只有 `base` 可能不同。

---

## 一、本地开发

```bash
cd E:\MaiMemoReader\app
npm install
npm run dev
```

打开 <http://localhost:5173>。

> 本项目放在 **exFAT** 盘上（E:），exFAT 不支持符号链接。`app/pnpm-workspace.yaml` 已设 `nodeLinker: hoisted`，用 pnpm 也能装；用 npm 则本来就是平铺结构，无需额外处理。若 npm 装完提示 `esbuild` 未执行安装脚本，不影响构建。

- 开发模式**不注册** Service Worker（避免缓存干扰热更新）；
- 支持局域网访问（`vite --host` 已在配置里），手机连同一 WiFi 可用 `http://<电脑IP>:5173` 试真机布局；
- iPhone 上 `http://局域网IP` 不是安全上下文，PWA 安装与 Service Worker 不生效——真机安装请用后文的 HTTPS 部署。

## 二、本地生产构建与预览

```bash
npm run build      # 先 tsc --noEmit，再 vite build
npm run preview    # http://localhost:4173
```

产物在 `app/dist/`：

```
dist/index.html
dist/assets/index-<hash>.css
dist/assets/index-<hash>.js
dist/manifest.webmanifest
dist/sw.js
dist/icons/…
```

`preview` 下 Service Worker 会生效（`import.meta.env.PROD` 为真），可以验证离线打开、安装提示等行为。

## 三、GitHub Pages 部署

### 3.1 准备仓库

**把整个 `E:\MaiMemoReader\` 目录作为仓库根**（最简单，工作流按这个结构写）：

```
<repo>/
├─ .github/workflows/deploy.yml   ← 部署工作流（在根目录）
├─ README.md / AGENTS.md / docs/
├─ scripts/
└─ app/                           ← 源码在这里
   ├─ index.html
   ├─ package.json
   ├─ src/ public/ tests/ worker/
   └─ …
```

```bash
cd E:\MaiMemoReader
git init
git add .
git commit -m "init: MaiMemo Reader"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

工作流里 `working-directory: app`，产物上传路径是 `app/dist`。若你更想把 `app/` 里的内容直接当仓库根，把 `.github/` 一起移进 `app/`、并把工作流里的两个 `app/` 路径去掉即可。

> `node_modules/`、`dist/`、`.env` 已在 `.gitignore` 里排除；不要把本机导出的 JSON 提交上去。

### 3.2 打开 Pages

仓库 → Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。

### 3.3 推送即自动部署

`deploy.yml` 会依次执行：安装依赖 → 类型检查 → 跑测试 → 构建 → 复制 `404.html` → 上传并部署。

关键点：

```yaml
env:
  VITE_BASE: /${{ github.event.repository.name }}/
```

- **项目页**（`https://<user>.github.io/<repo>/`）：子路径必须带仓库名，所以用上面的写法；
- **用户页 / 组织页**（`https://<user>.github.io/`）：把这一行改成 `VITE_BASE: /`；
- 不设置也可以：`base` 默认 `./`，相对路径在子路径下同样能跑。设成绝对路径的好处是资源 URL 更明确、缓存键更稳定。

`404.html` 是给直接访问不存在路径时的兜底。本项目用 hash 路由（`#/read/...`），正常使用其实不需要它，但保留能减少误报。

### 3.4 首次部署后要做的事

1. 打开 `https://<user>.github.io/<repo>/`，确认能看到引导页；
2. 浏览器 DevTools → Application → Manifest，确认无报错、图标齐全；
3. Application → Service Workers，确认 `sw.js` 已 activated；
4. 设置 → 关于，确认「接口与隐私」段落可读（说明构建正常）。

### 3.5 更新发布

改完代码推送 `main` 即自动重新构建部署。

Service Worker 的更新策略：`public/sw.js` 里 `VERSION` 决定缓存名。发版时把它加一（例如 `v1.0.1`），旧缓存会在 `activate` 阶段被清理；导航请求走 network-first，所以用户下次打开会拿到新 HTML。

若发现用户仍看到旧界面，排查顺序：`VERSION` 是否改 → 是否有第二个 SW 在抢 scope → 是否被浏览器强缓存。

---

## 四、墨墨官方授权的域名配置

OIDC 模式要求「主页 URL」和「登录回调地址」同域，且应用审核通过。

1. 到 <https://open.maimemo.com/app> 创建应用，类型选 **纯前端应用**（PKCE，无 client_secret）。
2. 主页 URL 填部署后的地址，例如 `https://yourname.github.io/memo-reader/`。
3. 登录回调地址填**同一个地址**（不带 `#` 与查询参数）——本项目回调地址取 `location.origin + pathname`，与此完全一致。
4. 权限只勾选只读学习数据相关项。
5. 审核通过后，把 `client_id` 填进「设置 → 墨墨背单词 → 官方授权」，点「开始墨墨授权登录」。

注意事项：

- 应用类型创建后不可修改，选错要重建应用；
- 名字里不能含「墨墨」「MaiMemo」「官方」等字样，否则审核不过；
- 应用审核通过 + 主页域名，才会被允许跨域请求开放 API；
- 换域名（例如以后绑定自定义域名）需要同步改开放平台配置，否则授权回调会失败。

## 五、可选：Cloudflare Worker 中继

仅当浏览器直连墨墨失败、或想看到准确错误码时部署。

```bash
cd app
npm i -g wrangler
wrangler login
wrangler deploy worker/maimemo-relay.js --name memo-relay
```

`worker/wrangler.toml` 里把 `ALLOWED_ORIGIN` 改成你的 Pages 域名（含协议）。也可以在 `env.ALLOWED_ORIGIN` 里用 secret 配置。

部署完得到 `https://memo-relay.<account>.workers.dev`，填进「设置 → 墨墨背单词 → 中继地址」。

验证：

```bash
curl -i -X OPTIONS "https://memo-relay.<account>.workers.dev/maimemo/api/v1/memo/study/get_study_progress" \
  -H "Origin: https://yourname.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

期望 204 且带 `access-control-allow-origin`。

中继的能力边界（刻意做窄）：只转发 `/api/v1/memo/**`，只允许 GET / POST，必须带 Bearer，不解析、不记录、不缓存、不做任意 URL 代理。

---

## 六、PWA 安装

### iPhone / iPad

1. Safari 打开部署地址；
2. 分享 → 添加到主屏幕；
3. 从图标启动，确认顶部没有地址栏（standalone）。

已针对以下细节做过处理：

- `viewport-fit=cover` + `env(safe-area-inset-*)`：适配灵动岛与底部手势区；
- 底部导航留出 `safe-area-inset-bottom`；
- 输入框 `font-size ≥ 16px` 由系统缩放策略接管，避免聚焦时页面被放大；
- 滚动使用被动监听，长文不卡顿。

### Windows

Chrome / Edge 地址栏安装图标，或菜单 → 应用 → 安装。安装后可固定到任务栏，窗口独立、无浏览器 UI。

### 离线能力

- 静态资源（HTML / JS / CSS / 图标 / manifest）由 Service Worker 缓存 → 断网仍能打开应用；
- 已生成的文章、题目、作答记录存在 IndexedDB → 断网可读、可做题；
- **生成新文章需要联网**（要调 DeepSeek），离线时会给出网络错误提示，不会假装在生成。

### 更新

重新部署后，用户下次打开会拉新 HTML；SW 在后台更新，必要时刷新一次即可。若长期不更新，检查 `sw.js` 的 `VERSION`。

---

## 七、部署后必测清单

- [ ] 首页能打开，引导可跳过
- [ ] 演示数据可载入 → 能进阅读器 → 点词有释义 → 能答题 → 能看解析
- [ ] 设置里填写 DeepSeek Key → 「验证 Key」返回连接正常
- [ ] 设置里填写墨墨 Token → 「连接测试」返回进度（或明确的失败原因）
- [ ] 生成流程能跑完（正文阶段有实时预览）
- [ ] 生成中断后首页出现恢复入口，继续不会重跑已完成阶段
- [ ] manifest / SW 无控制台报错
- [ ] iOS 主屏启动、Windows 安装正常
- [ ] 断网后能打开已保存的文章
- [ ] 导出 JSON 不含任何密钥

---

## 八、常见部署问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 页面白屏，控制台 404 `/assets/...` | `base` 与部署路径不匹配 | 设 `VITE_BASE=/<repo>/`，或在用户页设为 `/` |
| 图标 / manifest 404 | 同上，或 `public/` 未被提交 | 检查 `dist/icons` 是否存在，`public/icons` 是否在仓库里 |
| Service Worker 注册失败 | 非 HTTPS、或 scope 不在站点根下 | Pages 默认 HTTPS；本地用 `npm run preview` 验证 |
| 授权回调 404 或跳到错误页 | 回调地址与开放平台登记不一致 | 统一为 `origin + pathname`，不要带 `#` |
| 授权后回到首页但未登录 | `state` 校验失败 / 上下文过期（10 分钟） | 重新点授权；确认没有在网络代理里丢掉 `sessionStorage` |
| 手机装上后仍显示浏览器栏 | 用了微信 / Chrome for iOS 添加 | 改用 Safari 添加 |
| 更新后仍是旧版本 | SW 缓存未失效 | 改 `VERSION` 重新部署，或强刷一次 |
| 请求被 CORS 拦 | 墨墨错误响应不带跨域头 / 域名未审核 | 配置 Worker 中继后重试 |

---

## 九、成本与配额提醒

- GitHub Pages：公开仓库免费；私有仓库需相应计划。
- Cloudflare Workers：免费额度足够这个转发量。
- DeepSeek：按量计费，页面会显示估算。用 `deepseek-flash` 一次完整生成通常在 ¥0.05 以内，`deepseek-v4-pro` 约 ¥0.2 上下（受篇幅与缓存命中影响）。
- 墨墨开放 API：免费，但有频控；本项目一次同步只发 2 个请求。
