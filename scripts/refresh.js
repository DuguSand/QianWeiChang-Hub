'use strict';

const { refreshFeed } = require('../lib/scraper');

refreshFeed({ log: (message) => console.log(message) })
  .then((data) => {
    console.log(`\n完成。共 ${data.items.length} 条信息，缓存：data/feed.json`);
    console.log(`涉及 ${data.sources.filter((source) => source.ok).length}/${data.sources.length} 个来源。`);
    const latest = data.items.slice(0, 5);
    for (const item of latest) {
      console.log(`- [${item.publishedAt}] ${item.title} (${item.scope})`);
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
