'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { CATEGORY_META } = require('../lib/sources');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist');
const FEED_FILE = path.join(ROOT, 'data', 'feed.json');

async function main() {
  let feed;
  try {
    feed = JSON.parse(await fs.readFile(FEED_FILE, 'utf8'));
  } catch (error) {
    throw new Error(
      `无法读取 data/feed.json，请先执行 npm run refresh 生成抓取缓存。\n原始错误：${error.message}`
    );
  }

  if (!Array.isArray(feed.items) || feed.items.length === 0) {
    throw new Error('data/feed.json 中没有可用条目，请先执行 npm run refresh。');
  }

  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.cp(PUBLIC_DIR, DIST_DIR, { recursive: true });

  const feedPayload = {
    ...feed,
    categories: CATEGORY_META,
    staticMode: true,
  };
  const status = {
    ok: true,
    staticMode: true,
    refreshing: false,
    updatedAt: feed.updatedAt || null,
    lastAttemptAt: feed.updatedAt || null,
    lastError: null,
    nextRefreshAt: null,
    refreshIntervalMinutes: 0,
    itemCount: feed.items.length,
    stats: feed.stats || {},
    sources: feed.sources || [],
    builtAt: new Date().toISOString(),
  };

  const dataDir = path.join(DIST_DIR, 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'feed.json'), JSON.stringify(feedPayload), 'utf8');
  await fs.writeFile(path.join(dataDir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');

  const config = `window.WEICHANG_CONFIG = ${JSON.stringify(
    {
      feedUrl: './data/feed.json',
      statusUrl: './data/status.json',
      staticMode: true,
      builtAt: status.builtAt,
    },
    null,
    2
  )};\n`;
  await fs.writeFile(path.join(DIST_DIR, 'config.js'), config, 'utf8');

  const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN

/data/feed.json
  Cache-Control: public, max-age=0, must-revalidate

/data/status.json
  Cache-Control: no-store
`;
  await fs.writeFile(path.join(DIST_DIR, '_headers'), headers, 'utf8');

  console.log('Cloudflare Pages 构建完成');
  console.log(`- 输出目录：${DIST_DIR}`);
  console.log(`- 信息条数：${feed.items.length}`);
  console.log(`- 抓取时间：${feed.updatedAt || '未知'}`);
  console.log('- 数据接口：/data/feed.json, /data/status.json');
}

main().catch((error) => {
  console.error(`[build:pages] ${error.message}`);
  process.exitCode = 1;
});
