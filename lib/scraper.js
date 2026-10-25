'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const cheerio = require('cheerio');
const { SOURCES } = require('./sources');
const {
  parseDateFromList,
  parseDeadline,
  parseEventDate,
  parseLocation,
  inferCategory,
  detectTags,
  makeSummary,
  relevanceScore,
  normalizeSpace,
} = require('./classify');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'feed.json');
const DAY = 24 * 60 * 60 * 1000;
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 800);
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 QianWeiChangHub/1.0';

function hashId(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function fetchText(url, { timeout = 13000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function isArticleLink(href) {
  if (!href) return false;
  if (href.startsWith('javascript:') || href.startsWith('#')) return false;
  return /(?:^|\/)info\/\d+\/\d+\.htm/i.test(href) || /^https?:\/\/mp\.weixin\.qq\.com\/s\//i.test(href);
}

function isStudentFacing(title) {
  const staffOnly =
    /教职工|教职员工|外教|教师参与|教师教学|教师发展|教师培训|辅导员|职称|岗位聘任|人才招聘|招聘|招标|采购|询价|成交|废标|基建|修缮|停电|停水|燃气|工会|离退休|统战|巡察|中层干部|干部|党支部书记|党委|教工|导师队伍建设|课程思政教学改革项目负责人/;
  const facultyProject =
    /课程建设项目|教学学术研究项目|教材.*项目|重点课程.*(?:申报|立项)|教改项目|教学成果奖|教学名师|教学竞赛|课程教学设计竞赛|专业动态优化调整专项建设|人工智能赋能教育教学专项建设|课程思政教育教学改革研究项目|示范课程立项建设|教师校内自习辅导|文化艺术奖拟推荐/;
  const signalText = title.replace(/本科生院|研究生院/g, '');
  const studentSignal = /学生|本科生|研究生|奖学金|助学金|就业|考试|选课|社团|志愿者|新生|毕业生|学位|学籍/;
  if (studentSignal.test(signalText)) return true;
  return !staffOnly.test(title) && !facultyProject.test(title);
}

function cleanTitle(title) {
  return normalizeSpace(title)
    .replace(/^(·|•|-|\||更多|详情)+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findNearbyDate($, anchor) {
  let node = anchor.closest('tr, li, .news-item, .list-item, .article-item, .item');
  if (!node.length) node = anchor.parent().parent();
  for (let depth = 0; depth < 5 && node.length; depth += 1) {
    const text = node.text();
    // 列表项的日期通常位于末尾；摘要正文中也可能出现日期，优先取尾部日期。
    const date = parseDateFromList(text.slice(-120)) || parseDateFromList(text);
    if (date) return date;

    // 部分栏目（如“学术报告”“文化信息”）用“日 / 月”两个数字表示日期，不带年份。
    const dayMonth = node
      .find('.sj p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);
    if (dayMonth.length >= 2) {
      const day = Number(dayMonth[0]);
      const month = Number(dayMonth[1]);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        const now = new Date();
        let dt = new Date(now.getFullYear(), month - 1, day, 12);
        if (dt.getTime() > now.getTime() + 10 * DAY) {
          dt = new Date(now.getFullYear() - 1, month - 1, day, 12);
        }
        const y = dt.getFullYear();
        return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    node = node.parent();
  }
  return null;
}

function parseListPage(html, pageUrl, source) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    if (!isArticleLink(href)) return;
    const url = absoluteUrl(href, pageUrl);
    if (!url || seen.has(url)) return;

    let title =
      anchor.attr('title') ||
      anchor.find('h1, h2, h3, h4, .bt, .title, .tit, .article-title').first().text() ||
      anchor.text();
    title = cleanTitle(String(title).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '');
    if (title.length < 5 || title.length > 150) return;
    if (/^(首页|尾页|上页|下页|更多|返回|上一篇|下一篇|上一条|下一条)$/.test(title)) return;

    const publishedAt = findNearbyDate($, anchor);
    if (!publishedAt) return;

    seen.add(url);
    items.push({
      id: hashId(url),
      title,
      url,
      sourceId: source.id,
      sourceName: source.name,
      sourceShort: source.short,
      org: source.org,
      scope: source.scope,
      category: inferCategory(source, title),
      publishedAt,
      summary: '',
      content: '',
      deadline: null,
      eventDate: null,
      location: null,
      tags: detectTags(title),
      detailFetchedAt: null,
      detailStatus: 'pending',
      firstSeenAt: new Date().toISOString(),
    });
  });

  let nextUrl = null;
  $('a').each((_, element) => {
    const text = $(element).text().replace(/\s+/g, '');
    if (text === '下页' || text === '下一页') {
      const href = $(element).attr('href');
      if (href && !href.startsWith('javascript:')) nextUrl = absoluteUrl(href, pageUrl);
    }
  });

  return { items, nextUrl };
}

function extractArticle(html, pageUrl) {
  const $ = cheerio.load(html);
  const metaDescription = normalizeSpace(
    $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || ''
  );
  const candidates = [
    '#vsb_content_2',
    '#vsb_content',
    '.v_news_content',
    '.wp_articlecontent',
    '.article-content',
    '.article_content',
    '.news-content',
    '.detail-content',
    '.content-page .content',
    '#js_content',
  ];

  let bestText = '';
  for (const selector of candidates) {
    const node = $(selector).first();
    if (!node.length) continue;
    node.find('script, style, noscript, iframe').remove();
    const text = normalizeSpace(node.text());
    if (text.length > bestText.length) bestText = text;
  }

  if (bestText.length < 80) {
    const fallback = $('body').clone();
    fallback
      .find(
        'script, style, noscript, header, footer, nav, iframe, .header, .footer, .nav, .menu, .sidebar, .breadcrumb, .search, .bottom, .copyright, .leftlink, .navbar, .head, .header-nav'
      )
      .remove();
    bestText = normalizeSpace(fallback.text());
  }

  const content = bestText
    .replace(/^[\s\S]{0,160}?创建时间[:：][\s\S]{0,160}?浏览次数[:：][\s\S]{0,30}?返回\s*/, '')
    .replace(/上一条[:：].*$/s, '')
    .replace(/下一条[:：].*$/s, '')
    .replace(/版权所有[\s\S]*$/s, '')
    .slice(0, 8000)
    .trim();

  const title =
    normalizeSpace($('meta[property="og:title"]').attr('content') || '') ||
    normalizeSpace($('title').text()).replace(/-上海大学.*$/, '').trim();

  return { content, metaDescription, title, pageUrl };
}

async function scrapeSource(source, log = () => {}) {
  const startedAt = new Date().toISOString();
  let pageUrl = source.url;
  const visited = new Set();
  const items = [];
  const errors = [];

  for (let page = 0; page < source.pages; page += 1) {
    if (!pageUrl || visited.has(pageUrl)) break;
    visited.add(pageUrl);
    try {
      const html = await fetchText(pageUrl);
      const parsed = parseListPage(html, pageUrl, source);
      items.push(...parsed.items);
      pageUrl = parsed.nextUrl;
      if (!parsed.items.length) break;
    } catch (error) {
      errors.push(`${page + 1}页: ${error.message}`);
      break;
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }

  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * DAY);
  const recent = unique.filter((item) => {
    const date = new Date(`${item.publishedAt}T12:00:00`);
    if (Number.isNaN(date.getTime()) || date < cutoff) return false;
    if (item.scope === 'university' && !isStudentFacing(item.title)) return false;
    return true;
  });

  if (unique.length === 0 && errors.length === 0) errors.push('页面结构解析失败');
  const status = {
    id: source.id,
    name: source.name,
    short: source.short,
    org: source.org,
    scope: source.scope,
    url: source.url,
    color: source.color,
    ok: unique.length > 0,
    count: recent.length,
    parsedCount: unique.length,
    fetchedAt: new Date().toISOString(),
    startedAt,
    error: errors.join('；') || (recent.length === 0 ? '近两年暂无更新' : null),
  };

  log(
    `${status.ok ? '✓' : '×'} ${source.short} ${recent.length} 条${
      status.error ? ` (${status.error})` : ''
    }`
  );
  return { items: recent, status };
}

function mergeDetails(item, detail, previous) {
  const content = detail.content || '';
  const summary =
    makeSummary(content, item.title) ||
    makeSummary(detail.metaDescription, item.title) ||
    previous?.summary ||
    '该条信息来自官方渠道，点击「阅读原文」查看完整内容。';
  const category = inferCategory(
    { id: item.sourceId, category: item.category, scope: item.scope },
    item.title
  );

  return {
    ...item,
    category,
    summary,
    content,
    deadline: parseDeadline(content, item.publishedAt) || (previous?.deadline ?? null),
    eventDate: parseEventDate(content, item.publishedAt, category) || (previous?.eventDate ?? null),
    location: parseLocation(content) || (previous?.location ?? null),
    tags: detectTags(item.title, summary),
    detailFetchedAt: new Date().toISOString(),
    detailStatus: content ? 'ok' : 'external',
  };
}

function dedupeItems(items) {
  const byUrl = new Map();
  for (const item of items) {
    const key = item.url.replace(/^http:/, 'https:');
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, item);
      continue;
    }
    // 同一链接被多个栏目收录时，优先保留学院来源与更完整的正文。
    const existingScore = (existing.scope === 'college' ? 2 : 0) + (existing.content ? 1 : 0);
    const nextScore = (item.scope === 'college' ? 2 : 0) + (item.content ? 1 : 0);
    if (nextScore > existingScore) byUrl.set(key, item);
  }

  const byTitle = new Map();
  for (const item of byUrl.values()) {
    const key = `${item.title.replace(/\s+/g, '')}__${item.publishedAt}`;
    const existing = byTitle.get(key);
    if (!existing) {
      byTitle.set(key, item);
      continue;
    }
    const existingScore = (existing.scope === 'college' ? 2 : 0) + (existing.content ? 1 : 0);
    const nextScore = (item.scope === 'college' ? 2 : 0) + (item.content ? 1 : 0);
    if (nextScore > existingScore) byTitle.set(key, item);
  }
  return [...byTitle.values()];
}

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.items)) throw new Error('缓存格式不正确');
    return data;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[cache] 读取缓存失败：', error.message);
    return null;
  }
}

async function saveCache(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${CACHE_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(temp, CACHE_FILE);
}

function buildStats(items) {
  const counts = { total: items.length, college: 0, university: 0, categories: {}, unread: 0 };
  for (const item of items) {
    if (item.scope === 'college') counts.college += 1;
    else counts.university += 1;
    counts.categories[item.category] = (counts.categories[item.category] || 0) + 1;
  }
  const today = new Date();
  counts.deadlines = items.filter((item) => {
    if (!item.deadline) return false;
    const dt = new Date(`${item.deadline}T23:59:59`);
    return dt >= today && dt <= new Date(today.getTime() + 21 * 24 * 60 * 60 * 1000);
  }).length;
  counts.featured = items.filter((item) => relevanceScore(item) >= 125).length;
  return counts;
}

async function refreshFeed({ log = console.log, maxDetails = Number(process.env.MAX_DETAILS || 78) } = {}) {
  const startedAt = new Date().toISOString();
  log('[refresh] 开始抓取官方渠道…');

  const scraped = await mapLimit(SOURCES, 3, (source) => scrapeSource(source, log));
  const statuses = scraped.map((entry) => entry.status);
  const listItems = scraped.flatMap((entry) => entry.items);
  const previousData = await loadCache();
  const previousById = new Map((previousData?.items || []).map((item) => [item.id, item]));

  const merged = listItems.map((item) => {
    const previous = previousById.get(item.id);
    if (!previous) return item;
    return {
      ...item,
      firstSeenAt: previous.firstSeenAt || item.firstSeenAt,
      summary: previous.summary || '',
      content: previous.content || '',
      deadline: previous.deadline || null,
      eventDate: previous.eventDate || null,
      location: previous.location || null,
      tags: previous.tags?.length ? previous.tags : item.tags,
      detailFetchedAt: previous.detailFetchedAt || null,
      detailStatus: previous.detailStatus || 'pending',
    };
  });

  const needDetails = merged
    .filter((item) => !item.detailFetchedAt || !item.content)
    .sort((a, b) => {
      const byDate = b.publishedAt.localeCompare(a.publishedAt);
      if (byDate !== 0) return byDate;
      return relevanceScore(b) - relevanceScore(a);
    })
    .slice(0, maxDetails);

  log(`[refresh] 列表 ${merged.length} 条，补全正文 ${needDetails.length} 条…`);
  let completed = 0;
  const detailResults = await mapLimit(needDetails, 5, async (item) => {
    try {
      if (/mp\.weixin\.qq\.com/i.test(item.url)) {
        const html = await fetchText(item.url, { timeout: 9000 });
        const detail = extractArticle(html, item.url);
        if (detail.content.length < 30) return { id: item.id, detail: null };
        return { id: item.id, detail };
      }
      const html = await fetchText(item.url, { timeout: 11000 });
      const detail = extractArticle(html, item.url);
      return { id: item.id, detail };
    } catch {
      return { id: item.id, detail: null };
    } finally {
      completed += 1;
      if (completed % 15 === 0) log(`[refresh] 正文进度 ${completed}/${needDetails.length}`);
    }
  });

  const detailMap = new Map(detailResults.filter((entry) => entry.detail).map((entry) => [entry.id, entry.detail]));
  const withDetails = merged.map((item) => {
    const detail = detailMap.get(item.id);
    if (detail) return mergeDetails(item, detail, previousById.get(item.id));
    if (item.detailFetchedAt) return item;
    return {
      ...item,
      summary: item.summary || '该条信息来自官方渠道，点击「阅读原文」查看完整内容。',
      detailFetchedAt: new Date().toISOString(),
      detailStatus: 'external',
    };
  });

  const items = dedupeItems(withDetails)
    .sort((a, b) => {
      const byDate = b.publishedAt.localeCompare(a.publishedAt);
      if (byDate !== 0) return byDate;
      return relevanceScore(b) - relevanceScore(a);
    })
    .slice(0, 400);

  const data = {
    version: 1,
    updatedAt: new Date().toISOString(),
    startedAt,
    items,
    sources: statuses,
    stats: buildStats(items),
    note: '内容版权归原发布单位所有，本站仅聚合公开信息并保留原文链接。',
  };

  await saveCache(data);
  log(`[refresh] 完成：${items.length} 条，${statuses.filter((s) => s.ok).length}/${statuses.length} 个来源正常。`);
  return data;
}

module.exports = {
  refreshFeed,
  loadCache,
  saveCache,
  buildStats,
  extractArticle,
  parseListPage,
  fetchText,
  dedupeItems,
  CACHE_FILE,
};
