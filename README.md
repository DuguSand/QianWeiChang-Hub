# 伟长汇 · 钱伟长学院信息聚合

一个会自动巡检官方来源、筛选学生相关信息并持续更新的小站。面向上海大学全体学生，优先呈现钱伟长学院 / 伟长书院内容，同时收录全校性的讲座、活动、奖助、教务与交流信息。

不是把通知逐条手工贴进页面，而是由抓取器访问官方栏目，自动分类、提取正文、识别截止日期，再交给前端按视角重新编排。

## 两种运行方式

- **本地 Node 服务**：Express 提供 API、静态页面和定时抓取。
- **Cloudflare Pages**：纯静态托管。Cloudflare 在构建时运行抓取脚本，生成静态 JSON；GitHub Actions 定时调用 Deploy Hook 触发重新构建。

## 已实现

- **自动抓取**：Node 服务每 30 分钟巡检 14 个官方栏目；Pages 每次重建时抓取最新信息。
- **增量缓存**：列表先入库，正文按需补全；刷新失败不会清空旧数据。
- **相关性筛选**：学院专属信息优先；过滤教职工、招标采购、教师项目申报等非学生向内容；默认只看近两年的有效信息。
- **自动分类**：通知公告、讲座论坛、活动预告、奖助评优、教学教务、国际交流、学院动态。
- **正文与截止日**：从官方正文中提取摘要、地点、活动日期，并识别“报名 / 申请 / 提交 / 截止”等语义附近的截止日期。
- **检索与筛选**：关键词、信息范围、时间范围、截止状态、内容栏目；支持最新发布、最早发布、截止优先三种排序。
- **截止日历**：按日查看截止与活动节点，导出 `.ics` 到系统日历。
- **我的收藏**：收藏、未读状态保存在当前浏览器。

## 本地运行

要求 Node.js 20.18+（仓库使用 Node 22）。

```bash
npm install
npm run refresh   # 可选：首次手动抓取；没有缓存时 npm start 会自动抓取
npm start
```

打开 <http://127.0.0.1:4173>。

Windows 也可以直接双击 `start.bat`。

本地模式使用 [public/config.js](public/config.js:1) 中的 `/api/feed` 和 `/api/status`，由 [server.js](server.js:1) 提供接口。

## 部署到 Cloudflare Pages

Cloudflare Pages 不能运行 Express，所以生产环境采用静态构建：

```text
Cloudflare Pages（连接 GitHub 仓库）
  ├─ npm run build
  │    ├─ 尝试 npm run refresh，抓取最新数据
  │    ├─ 失败时使用 data/seed-feed.json 快照
  │    └─ 生成 dist/
  └─ 发布 dist/ 到 *.pages.dev
```

前端静态模式下读取：

```text
/data/feed.json
/data/status.json
```

### Cloudflare Pages 设置

在 Cloudflare Pages 的 Git 集成页面填写：

```text
Production branch: main
Framework preset: None
Build command: npm run build
Build output directory: dist
Root directory: 留空（仓库根目录）
```

建议在环境变量中设置：

```text
NODE_VERSION=22
```

> 注意：**不需要在仓库根目录额外放一个 `index.html`。**
>
> 页面源文件是 [public/index.html](public/index.html:1)，构建时会复制到 `dist/index.html`。
> 如果把 Build output directory 设成 `public` 或仓库根目录，就会缺少 `dist/config.js` 和 `/data/*.json`，页面无法正常加载。

### 构建产物

```text
dist/
├─ index.html
├─ styles.css
├─ app.js
├─ config.js       静态模式配置
├─ favicon.svg
├─ _headers
└─ data/
   ├─ feed.json
   └─ status.json
```

### 自动更新

Git 集成本身只会在推送时重建。为了定时刷新：

1. Cloudflare Pages 项目 → **Settings → Builds & deployments → Deploy hooks**；
2. 创建一个 Deploy Hook，例如命名为 `scheduled-refresh`；
3. 复制 Hook URL；
4. 在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加 Secret：

```text
CLOUDFLARE_DEPLOY_HOOK = 上一步的 Deploy Hook URL
```

仓库中的 [.github/workflows/pages-rebuild.yml](.github/workflows/pages-rebuild.yml:1) 会每 2 小时调用这个 Hook，触发 Cloudflare 重新执行 `npm run build`。

如果暂时没有配置 `CLOUDFLARE_DEPLOY_HOOK`，定时任务只会给出一条警告并跳过，不会导致部署失败；推送 `main` 时仍会正常触发 Cloudflare 构建。

### 关于数据快照

`npm run build` 会先尝试抓取官方站点。如果 Cloudflare 构建机的网络访问不到学院或学校官网，会自动退回到仓库中的 [data/seed-feed.json](data/seed-feed.json:1)，保证页面仍然可以构建和访问。

更新快照：

```bash
npm run refresh
cp data/feed.json data/seed-feed.json
git add data/seed-feed.json
git commit -m "chore: update feed snapshot"
git push
```

`data/feed.json` 是本地运行缓存，不提交到 Git；`data/seed-feed.json` 是静态部署的兜底快照。

### 本地预览静态构建

```bash
npm run build:pages
npm run preview:pages
```

打开 <http://127.0.0.1:4174>。静态版本会隐藏“刷新”按钮，显示“随部署更新”。

### 手动部署（可选）

如果不用 Git 集成，也可以本地构建后直接上传：

```bash
npm run build
npx wrangler pages deploy dist --project-name=你的项目名
```

## 数据更新机制

| 环境 | 更新方式 |
| --- | --- |
| 本地 Node | 每 30 分钟自动巡检，页面每 45 秒检查更新，可手动刷新 |
| Cloudflare Pages | 每次 Git 推送触发构建；Deploy Hook 每 2 小时触发一次重建 |
| 静态页面 | 读取部署时的 `/data/*.json`，不直接请求官方站点 |

## 配置

本地 Node 服务支持以下环境变量：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PORT` | `4173` | 网站端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `REFRESH_INTERVAL_MINUTES` | `30` | 自动巡检间隔；设为 `0` 关闭定时任务 |
| `AUTO_REFRESH_HOURS` | `6` | 启动时缓存超过多少小时就在后台补一次刷新 |
| `MAX_AGE_DAYS` | `800` | 只保留多少天内的信息 |
| `MAX_DETAILS` | `78` | 一次刷新最多补全多少篇正文 |

示例：

```bash
REFRESH_INTERVAL_MINUTES=15 PORT=8080 npm start
```

## 数据来源

学院 / 书院：

- 钱伟长学院通知公告、学院动态、钱伟长讲坛、团学动态、奖助学金、国际交流
- 伟长书院通知公告、活动预告、书院动态

全校：

- 上海大学通知公告、学术报告、文化信息
- 上海大学本科生院通知公告
- 上海大学学生工作部通知公告

所有来源均为公开页面，只做列表与正文的只读聚合，不登录、不绕过权限、不绕过验证码。内容版权归原发布单位所有，页面保留原文链接。

## 项目结构

```text
server.js                   本地 Express 服务、API、定时巡检
lib/sources.js              14 个官方栏目配置
lib/scraper.js              列表抓取、正文提取、增量缓存、去重
lib/classify.js             分类、标签、摘要、截止日识别
public/index.html           页面结构
public/styles.css           页面样式与响应式布局
public/app.js               信息流、筛选、检索、收藏、日历、ICS
public/config.js            本地/静态模式接口配置
scripts/refresh.js          命令行抓取
scripts/reclassify.js       缓存重分类
scripts/build-pages.js      生成静态 dist/，支持抓取失败回退
scripts/preview-pages.js    本地预览 dist
.github/workflows/pages-rebuild.yml  定时触发 Cloudflare Deploy Hook
data/feed.json              本地抓取缓存（不提交 Git）
data/seed-feed.json         静态部署兜底快照（提交 Git）
dist/                       Cloudflare Pages 构建产物（不提交 Git）
test/classify.test.js       分类 / 日期识别测试
.nvmrc                      Node 版本
```

## 说明

- 截止日期是机器从正文中识别的，可能有遗漏或误差；重要节点请务必打开原文确认。
- 微信公众号文章如果阻止自动抓取，会保留标题和原文链接，正文回退为“阅读原文”提示。
- 静态部署版不提供页面内的即时刷新；要更新数据，重新运行构建或等待 Deploy Hook 定时触发。
- 本站不是上海大学或钱伟长学院官方站点。
