'use strict';

const path = require('node:path');
const express = require('express');
const { refreshFeed, loadCache, buildStats } = require('./lib/scraper');
const { CATEGORY_META, SOURCES } = require('./lib/sources');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const AUTO_REFRESH_HOURS = Number(process.env.AUTO_REFRESH_HOURS || 6);
const REFRESH_INTERVAL_MINUTES = Number(process.env.REFRESH_INTERVAL_MINUTES || 30);
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

let data = null;
let refreshing = false;
let lastError = null;
let lastAttemptAt = null;
let nextRefreshAt = null;

function scheduleNextRefresh() {
  if (REFRESH_INTERVAL_MINUTES <= 0) {
    nextRefreshAt = null;
    return;
  }
  nextRefreshAt = new Date(Date.now() + REFRESH_INTERVAL_MINUTES * 60_000).toISOString();
}

function startScheduler() {
  if (REFRESH_INTERVAL_MINUTES <= 0) return;
  scheduleNextRefresh();
  setInterval(() => {
    if (!refreshing) void runRefresh();
  }, REFRESH_INTERVAL_MINUTES * 60_000);
}

function publicStatus() {
  return {
    ok: Boolean(data?.items?.length),
    refreshing,
    updatedAt: data?.updatedAt || null,
    lastAttemptAt,
    lastError,
    nextRefreshAt,
    refreshIntervalMinutes: REFRESH_INTERVAL_MINUTES,
    itemCount: data?.items?.length || 0,
    stats: data?.stats || buildStats([]),
    sources: data?.sources || [],
    categories: CATEGORY_META,
    sourceDefinitions: SOURCES.map(({ id, name, short, scope, org, url, color }) => ({
      id,
      name,
      short,
      scope,
      org,
      url,
      color,
    })),
    serverTime: new Date().toISOString(),
  };
}

async function runRefresh() {
  if (refreshing) return;
  refreshing = true;
  lastError = null;
  lastAttemptAt = new Date().toISOString();
  try {
    data = await refreshFeed({ log: () => {} });
  } catch (error) {
    lastError = error.message;
    console.error('[refresh] 失败：', error);
  } finally {
    refreshing = false;
    scheduleNextRefresh();
  }
}

app.get('/api/feed', (req, res) => {
  if (!data) {
    res.status(503).json({ ok: false, error: '数据尚未准备完成', status: publicStatus() });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    updatedAt: data.updatedAt,
    items: data.items,
    sources: data.sources,
    stats: data.stats,
    categories: CATEGORY_META,
    note: data.note,
  });
});

app.get('/api/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicStatus());
});

app.post('/api/refresh', (req, res) => {
  if (refreshing) {
    res.status(409).json({ ok: false, error: '正在更新，请稍候', status: publicStatus() });
    return;
  }
  void runRefresh();
  res.status(202).json({ ok: true, message: '已开始更新', status: publicStatus() });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, items: data?.items?.length || 0, updatedAt: data?.updatedAt || null });
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    etag: true,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  console.log('[server] 读取本地聚合缓存…');
  data = await loadCache();
  if (!data?.items?.length) {
    console.log('[server] 没有可用缓存，首次抓取可能需要一分钟。');
    await runRefresh();
  } else {
    console.log(`[server] 已载入 ${data.items.length} 条信息（${data.updatedAt}）`);
    const ageHours = (Date.now() - new Date(data.updatedAt).getTime()) / 3_600_000;
    if (AUTO_REFRESH_HOURS > 0 && ageHours > AUTO_REFRESH_HOURS) {
      console.log(`[server] 缓存已 ${ageHours.toFixed(1)} 小时，后台刷新中…`);
      setTimeout(() => void runRefresh(), 1200);
    }
  }

  app.listen(PORT, HOST, () => {
    console.log(`[server] 伟长汇已启动： http://${HOST}:${PORT}`);
    console.log(
      `[server] 自动抓取已开启：每 ${REFRESH_INTERVAL_MINUTES} 分钟巡检一次官方来源（REFRESH_INTERVAL_MINUTES=0 可关闭）`
    );
    startScheduler();
  });
}

start().catch((error) => {
  console.error('[server] 启动失败：', error);
  process.exitCode = 1;
});
