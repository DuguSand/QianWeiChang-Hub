'use strict';

const assert = require('node:assert');
const {
  parseDeadline,
  parseEventDate,
  inferCategory,
  detectTags,
  makeSummary,
} = require('../lib/classify');

assert.equal(
  parseDeadline('请于2026年10月31日之前将材料发送至邮箱。', '2026-10-20'),
  '2026-10-31',
  '应识别“日期+之前”形式的截止时间'
);

assert.equal(
  parseDeadline('报名时间：2026年10月1日至10月12日。', '2026-09-28'),
  '2026-10-12',
  '日期区间应取结束日期'
);

assert.equal(
  parseDeadline('活动将于2026年11月2日举行，欢迎参加。', '2026-10-20'),
  null,
  '普通活动日期不是截止时间'
);

assert.equal(
  parseDeadline('请于10月31日前提交申请表。', '2026-10-08'),
  '2026-10-31',
  '应识别无年份月日'
);

assert.equal(
  parseEventDate('讲座时间：2026年11月6日 14:00，地点：宝山校区。', '2026-10-20', 'lecture'),
  '2026-11-06',
  '应识别讲座日期'
);

assert.equal(
  inferCategory({ id: 'shu-tzgg', category: 'notice' }, '关于开展2026年本科生校长奖学金评选工作的通知'),
  'award'
);
assert.equal(
  inferCategory({ id: 'bksy-tzgg', category: 'teaching' }, '关于2026-2027学年秋季学期选课的通知'),
  'teaching'
);
assert.equal(
  inferCategory({ id: 'qwc-xsbg', category: 'lecture' }, '钱伟长讲坛第103讲：《汽车芯片自主可控之路》'),
  'lecture'
);
assert.equal(
  inferCategory({ id: 'shu-whxx', category: 'activity' }, '2025上海美术学院本科课程案例展'),
  'activity'
);
assert.equal(
  inferCategory({ id: 'qwc-xwdt', category: 'news' }, '钱伟长学院举行2026届本科生毕业典礼'),
  'news'
);

const tags = detectTags('钱伟长学院2026年本科生科研创新论坛报名通知', '欢迎申报科研项目');
assert.ok(tags.includes('钱伟长'));
assert.ok(tags.includes('科研创新'));

const summary = makeSummary(
  '为做好2026年本科生科研创新论坛筹备工作，现面向全院学生征集学术海报与口头报告。请于2026年11月10日前提交摘要。',
  '关于举办2026年本科生科研创新论坛的通知'
);
assert.ok(summary.length <= 110);
assert.ok(summary.includes('科研创新'));

console.log('✓ classify tests passed');
