'use strict';

const DAY = 24 * 60 * 60 * 1000;

const CATEGORY_RULES = [
  ['award', /奖学金|助学金|奖助|评优|优秀学生|优秀毕业生|资助|补助|补贴|勤工助学|助学贷款|困难认定|校长奖|宝钢|费孝通|励志|卓越奖学金/i],
  ['exchange', /国际交流|国际化|海外|出境|交换生|交换项目|访学|暑校|暑期课程|剑桥|牛津|联合培养|留学|global|study abroad/i],
  ['teaching', /选课|退课|补选|考试|注册|学籍|课程|教学|培养方案|成绩|四六级|转专业|推免|免试攻读|保研|毕业|学位|辅修|微专业|学分|校历|课堂|专业分流|学业导师|专项班|实验班|拔尖班|学期/i],
  ['lecture', /讲坛|讲座|报告会|学术报告|论坛|研讨会|沙龙|名师|院士|学术前沿|开讲|报告\d|讲\d讲/i],
  ['activity', /活动|大赛|竞赛|比赛|训练营|工作坊|开放日|展览|演出|音乐会|志愿服务|志愿者|社会实践|调研|见面会|分享会|宣讲会|典礼|晚会|运动会|招募/i],
];

const TAGS = [
  ['钱伟长', /钱伟长|伟长/],
  ['保研', /推免|免试攻读|保研/],
  ['奖助学金', /奖学金|助学金|奖助|资助|补助/],
  ['国际交流', /国际|海外|交换|访学|暑校|剑桥|留学/],
  ['科研创新', /科研|创新|大创|课题|论文|学术|实验室/],
  ['学科竞赛', /竞赛|大赛|比赛|挑战杯|数学建模|创新创业/],
  ['选课考试', /选课|退课|考试|四六级|等级考试|期末/],
  ['志愿服务', /志愿|公益|社会实践|支教/],
  ['讲座论坛', /讲坛|讲座|报告|论坛|沙龙/],
  ['新生', /新生|迎新/],
  ['毕业', /毕业|学位|离校/],
  ['党团建设', /党建|党支部|团学|团委|团支部/],
  ['心理健康', /心理|压力|情绪|心灵/],
  ['书院', /书院/],
];

function normalizeSpace(text = '') {
  return String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function parseDateParts(year, month, day) {
  let y = Number(year);
  if (y < 100) y += 2000;
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function toISODate(dt) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseAnyDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})/);
  if (!m) return null;
  return parseDateParts(m[1], m[2], m[3]);
}

function parseDateFromList(raw) {
  return toISODate(parseAnyDate(raw));
}

function extractDates(segment, publishedAt) {
  const dates = [];
  const pub = parseAnyDate(publishedAt);
  const fullRe = /(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/g;
  let match;
  while ((match = fullRe.exec(segment))) {
    const dt = parseDateParts(match[1], match[2], match[3]);
    if (dt) dates.push({ dt, index: match.index });
  }
  const shortRe = /(?<!20\d{2}[年./-])(\d{1,2})月(\d{1,2})日/g;
  while ((match = shortRe.exec(segment))) {
    if (dates.some((d) => Math.abs(d.index - match.index) < 10)) continue;
    let y = pub ? pub.getFullYear() : new Date().getFullYear();
    let dt = parseDateParts(y, match[1], match[2]);
    if (dt && pub && dt.getTime() < pub.getTime() - 45 * DAY) {
      dt = parseDateParts(y + 1, match[1], match[2]);
    }
    if (dt) dates.push({ dt, index: match.index });
  }
  return dates.sort((a, b) => a.index - b.index);
}

/**
 * 从正文中寻找“报名/申请/提交/截止”等语义附近的日期。
 * 同一语义片段中若出现日期区间，取最后一个日期作为截止日。
 */
function parseDeadline(content, publishedAt) {
  if (!content) return null;
  const text = normalizeSpace(content).replace(/\n+/g, ' ');
  const pub = parseAnyDate(publishedAt) || new Date();
  const trigger = /截止|报名|申请|提交|报送|反馈|推荐|申报|受理|确认|缴费|注册|寄送|上传|之前|前(?:提交|发送|完成|报送|反馈|报名|申请|将|把)/;
  const segments = text.split(/[。；;，,\n]/);
  const candidates = [];

  for (const segment of segments) {
    if (!trigger.test(segment)) continue;
    if (/^(创建时间|发布时间|浏览次数)/.test(segment.trim())) continue;
    const trimmed = segment.trim();
    if (!trimmed || trimmed.length > 220) continue;
    const dates = extractDates(trimmed, publishedAt);
    if (!dates.length) continue;
    const chosenEntry = dates[dates.length - 1];
    const chosen = chosenEntry.dt;
    if (chosen.getTime() <= pub.getTime()) continue;
    if (chosen.getTime() > pub.getTime() + 210 * DAY) continue;

    const around = trimmed.slice(
      Math.max(0, chosenEntry.index - 28),
      Math.min(trimmed.length, chosenEntry.index + 44)
    );
    const hasAction = /截止|报名|申请|提交|报送|反馈|推荐|申报|受理|确认|缴费|注册|寄送|上传/.test(around);
    const hasDeadlinePhrase = /截止|之前|前(?:提交|发送|完成|报送|反馈|报名|申请|将|把)/.test(around);
    if (!hasAction && !hasDeadlinePhrase) continue;
    candidates.push(chosen);
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a - b);
  return toISODate(candidates[0]);
}

function parseEventDate(content, publishedAt, category) {
  if (!content || !['lecture', 'activity'].includes(category)) return null;
  const text = normalizeSpace(content).replace(/\n+/g, ' ');
  const pub = parseAnyDate(publishedAt) || new Date();
  const re = /(?:活动|讲座|报告|论坛|沙龙|演出|展览|会议)?时间[：:]\s*([^。；\n]{0,60})/g;
  let match;
  while ((match = re.exec(text))) {
    if (/报名|截止|提交|申请/.test(match[0])) continue;
    const dates = extractDates(match[1], publishedAt);
    if (!dates.length) continue;
    const dt = dates[0].dt;
    if (dt.getTime() < pub.getTime() - 3 * DAY) continue;
    if (dt.getTime() > pub.getTime() + 210 * DAY) continue;
    return toISODate(dt);
  }
  return null;
}

function parseLocation(content) {
  if (!content) return null;
  const m = normalizeSpace(content).match(/(?:活动地点|讲座地点|报告地点|地点|地址)[：:]\s*([^\n。；]{2,60})/);
  if (!m) return null;
  const value = m[1]
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value || /^(另行通知|待定|见通知)$/.test(value)) return null;
  return value.slice(0, 50);
}

function inferCategory(source, title = '') {
  // 栏目属性明确的来源优先，避免“毕业作品展”被误判为教务通知。
  if (source.id === 'shu-whxx') return 'activity';
  if (source.id === 'shu-xsbg' || source.id === 'qwc-xsbg') return 'lecture';
  // 学院新闻栏目以“动态”为主，只把明确的讲坛/报告归入讲座。
  if (source.category === 'news') {
    if (/讲坛|讲座|学术报告|报告会|研讨会|论坛/.test(title)) return 'lecture';
    return 'news';
  }
  // “关于举办……论坛的通知”是活动，不是讲座预告。
  if (/举办.*(?:论坛|活动)|(?:论坛|活动).*通知/.test(title)) return 'activity';
  for (const [category, re] of CATEGORY_RULES) {
    if (re.test(title)) return category;
  }
  if (source.id === 'xgb-tzgg' && !/奖|助|评优|资助|评选/.test(title)) return 'notice';
  return source.category;
}

function detectTags(title = '', summary = '') {
  const text = `${title} ${summary}`;
  const tags = [];
  for (const [label, re] of TAGS) {
    if (re.test(text)) tags.push(label);
    if (tags.length >= 3) break;
  }
  return tags;
}

function truncateAtPunctuation(text, max = 104) {
  const value = normalizeSpace(text).replace(/\n/g, ' ');
  if (value.length <= max) return value;
  const sliced = value.slice(0, max);
  const lastPunctuation = Math.max(
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('；'),
    sliced.lastIndexOf('！'),
    sliced.lastIndexOf('？'),
    sliced.lastIndexOf('，')
  );
  if (lastPunctuation > max * 0.55) return sliced.slice(0, lastPunctuation + 1);
  return `${sliced.trim()}…`;
}

function makeSummary(content, title = '') {
  if (!content) return '';
  let text = normalizeSpace(content)
    .replace(/\n+/g, ' ')
    .replace(/上一条[:：].*$/s, '')
    .replace(/下一条[:：].*$/s, '')
    .replace(/版权所有.*$/s, '')
    .trim();
  if (title && text.startsWith(title)) text = text.slice(title.length).trim();
  text = text.replace(/^(创建时间|发布时间)[:：][^ ]+\s*/, '');
  return truncateAtPunctuation(text, 108);
}

function relevanceScore(item, now = new Date()) {
  let score = item.scope === 'college' ? 100 : 24;
  if (/钱伟长|伟长|拔尖|试点学院/.test(item.title)) score += 35;
  const categoryBoost = { award: 12, teaching: 10, exchange: 10, lecture: 6, activity: 6, notice: 4, news: 0 };
  score += categoryBoost[item.category] || 0;
  const published = parseAnyDate(item.publishedAt);
  if (published) {
    const days = Math.max(0, (now.getTime() - published.getTime()) / DAY);
    if (days <= 7) score += 20;
    else if (days <= 21) score += 12;
    else if (days <= 45) score += 5;
  }
  if (item.deadline) {
    const deadline = parseAnyDate(item.deadline);
    if (deadline && deadline.getTime() >= now.getTime() - DAY) score += 14;
    else score -= 6;
  }
  return score;
}

module.exports = {
  parseDateFromList,
  parseAnyDate,
  toISODate,
  parseDeadline,
  parseEventDate,
  parseLocation,
  inferCategory,
  detectTags,
  makeSummary,
  relevanceScore,
  normalizeSpace,
  truncateAtPunctuation,
};
