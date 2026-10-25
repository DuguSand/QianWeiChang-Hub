'use strict';

const { loadCache, saveCache, buildStats } = require('../lib/scraper');
const { SOURCES } = require('../lib/sources');
const { inferCategory, detectTags } = require('../lib/classify');

(async () => {
  const data = await loadCache();
  if (!data) throw new Error('没有可重建的缓存');
  const byId = new Map(SOURCES.map((source) => [source.id, source]));
  data.items = data.items.map((item) => {
    const source = byId.get(item.sourceId) || { id: item.sourceId, category: item.category };
    const category = inferCategory(source, item.title);
    return {
      ...item,
      category,
      tags: detectTags(item.title, item.summary || ''),
    };
  });
  data.stats = buildStats(data.items);
  data.updatedAt = new Date().toISOString();
  await saveCache(data);
  console.log(`已重分类 ${data.items.length} 条`);
})();
