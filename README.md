# 伟长汇 · 钱伟长学院信息聚合

一个会自动巡检官方来源、筛选学生相关信息并持续更新的小站。面向上海大学全体学生，优先呈现钱伟长学院 / 伟长书院内容，同时收录全校性的讲座、活动、奖助、教务与交流信息。

不是把通知逐条手工贴进页面，而是由抓取器访问官方栏目，自动分类、提取正文、识别截止日期，再交给前端按视角重新编排。

## 两种运行方式

- **本地 Node 服务**：Express 提供 API、静态页面和定时抓取。
- **Cloudflare Pages**：纯静态部署，前端读取构建时生成的 JSON；定时抓取交给 GitHub Actions。

## 已实现

- **自动抓取**：Node 服务每 30 分钟巡检 14 个官方栏目；Pages 部署由 GitHub Actions 定时触发重新抓取和发布。
- **增量缓存**：列表先入库，正文按需补全；刷新失败不会清空旧数据。
- **相关性筛选**：学院专属信息优先；过滤教职工、招标采购、教师项目申报等非学生向内容；默认只看近两年的有效信息。
- **自动分类**：通知公告、讲座论坛、活动预告、奖助评优、教学教务、国际交流、学院动态。
- **正文与截止日**：从官方正文中提取摘要、地点、活动日期，并识别“报名 / 申请 / 提交 / 截止”等语义附近的截止日期。
- **检索与筛选**：关键词、信息范围、时间范围、截止状态、内容栏目；支持最新发布、最早发布、截止优先三种排序。
- **截止日历**：按日查看截止与活动节点，导出 `.ics` 到系统日历。
- **我的收藏**：收藏、未读状态保存在当前浏览器。

## 本地运行

要求 Node.js 18+（开发环境为 Node 24）。

```bash
npm install
npm run refresh   # 可选：首次手动抓取；没有缓存时 npm start 会自动抓取
npm start
```

打开 <http://127.0.0.1:4173>。

Windows 也可以直接双击 `start.bat`。

本地模式使用 [public/config.js](public/config.js:1) 中的 `/api/feed` 和 `/api/status`，并由 [server.js](server.js:1) 提供接口。

## 部署到 Cloudflare Pages

Cloudflare Pages 不能运行 Express 服务，所以生产环境采用：

```text
GitHub Actions
  ├─ npm run refresh      抓取最新数据，生成 data/feed.json
  ├─ npm run build:pages  生成静态 dist/
  └─ wrangler pages deploy
```

前端静态模式下读取：

```text
/data/feed.json
/data/status.json
```

构建产物包含：

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

### 1. 本地构建和预览

```bash
npm run refresh
npm run build:pages
npm run preview:pages
```

打开 <http://127.0.0.1:4174> 检查静态版本。静态版本会隐藏“刷新”按钮，显示“随部署更新”。

### 2. GitHub Actions 自动抓取并部署（推荐）

这是目前 [.github/workflows/pages.yml](.github/workflows/pages.yml:1) 已经写好的方式：

1. 在 Cloudflare 创建 Pages 项目，项目名例如 `weichang-hub`；
2. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API Token，需要有 Cloudflare Pages 编辑权限 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| Variable（可选） | `CLOUDFLARE_PAGES_PROJECT` | Pages 项目名，不设置时默认 `weichang-hub` |

3. 推送 `main` 分支，或在 GitHub Actions 页面手动运行 `Deploy WeiChang Hub to Cloudflare Pages`。

工作流会：

- 在每次推送 `main` 时部署；
- 每 2 小时自动重新抓取并部署；
- 运行 `npm test`；
- 用 `npm run refresh` 生成最新缓存；
- 用 `npm run build:pages` 生成 `dist`；
- 通过 Wrangler 上传到 Cloudflare Pages。

首次创建 Pages 项目也可以使用 Wrangler：

```bash
npx wrangler pages project create weichang-hub --production-branch=main
```

API Token 建议使用自定义模板：

```text
Account → Cloudflare Pages → Edit
Account → Account Settings → Read
```

### 3. 使用 Cloudflare Pages Git 集成

如果不想使用 GitHub Actions，也可以在 Cloudflare 里直接连接仓库：

```text
Framework preset: None
Build command: npm ci && npm run refresh && npm run build:pages
Build output directory: dist
Node version: 20
```

这样每次推送 `main` 都会重新抓取和构建。  
Cloudflare 构建环境必须能够访问学院和学校官网；如果构建网络受限，建议改用上面的 GitHub Actions 方式。

> Git 集成和 GitHub Actions Direct Upload 不要同时启用，否则会重复部署并互相覆盖。

### 4. 手动部署

```bash
npm run refresh
npm run build:pages
npx wrangler pages deploy dist --project-name=weichang-hub
```

首次执行 Wrangler 时需要登录 Cloudflare 或提供 API Token。

## 数据更新机制

| 环境 | 更新方式 |
| --- | --- |
| 本地 Node | 每 30 分钟自动巡检，页面每 45 秒检查更新，可手动刷新 |
| Cloudflare Pages | GitHub Actions 每 2 小时重新抓取并部署；推送 `main` 也会部署 |
| 静态页面 | 页面读取部署时的 `/data/*.json`，不直接访问官方站点 |

`data/feed.json` 是抓取缓存，不提交到 Git。  
GitHub Actions 会在每次部署前重新生成它，因此从仓库克隆后不需要手动准备缓存。

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
scripts/build-pages.js      生成 Cloudflare Pages 静态目录 dist
scripts/preview-pages.js    本地预览 dist
.github/workflows/pages.yml 定时抓取并部署到 Cloudflare Pages
data/feed.json              本地抓取缓存（不提交 Git）
dist/                       Cloudflare Pages 构建产物（不提交 Git）
test/classify.test.js       分类 / 日期识别测试
```

## 说明

- 截止日期是机器从正文中识别的，可能有遗漏或误差；重要节点请务必打开原文确认。
- 微信公众号文章如果阻止自动抓取，会保留标题和原文链接，正文回退为“阅读原文”提示。
- 静态部署版不提供页面内的即时刷新；要更新数据，重新运行构建或等待 GitHub Actions 定时部署。
- 本站不是上海大学或钱伟长学院官方站点。
