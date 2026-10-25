'use strict';

(() => {
  const CATEGORY_ORDER = ['notice', 'lecture', 'activity', 'award', 'teaching', 'exchange', 'news'];
  const FALLBACK_CATEGORIES = {
    notice: { label: '通知公告', color: '#b23a31', soft: '#f8e9e5' },
    lecture: { label: '讲座论坛', color: '#255a78', soft: '#e7f0f4' },
    activity: { label: '活动预告', color: '#a56525', soft: '#f8efe2' },
    award: { label: '奖助评优', color: '#6b4f8a', soft: '#f0ebf6' },
    teaching: { label: '教学教务', color: '#2f665d', soft: '#e6f1ed' },
    exchange: { label: '国际交流', color: '#2d6e8e', soft: '#e6f2f8' },
    news: { label: '学院动态', color: '#715d44', soft: '#f1ece4' },
  };
  const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  const VIEWS = ['feed', 'calendar', 'saved'];
  const SAVED_KEY = 'weichang-hub:saved:v1';
  const READ_KEY = 'weichang-hub:read:v1';
  const PAGE_SIZE = 10;
  const TIME_LABELS = { all: '全部', 7: '近 7 天', 30: '近 30 天', 90: '近 90 天' };
  const DEADLINE_LABELS = { all: '全部', upcoming: '有截止日', week: '7 天内', passed: '已截止' };

  const now = new Date();
  const state = {
    items: [],
    sources: [],
    categories: FALLBACK_CATEGORIES,
    updatedAt: null,
    status: null,
    view: 'feed',
    scope: 'all',
    category: 'all',
    timeFilter: 'all',
    deadlineFilter: 'all',
    q: '',
    sort: 'latest',
    pageSize: PAGE_SIZE,
    saved: loadSet(SAVED_KEY),
    read: loadSet(READ_KEY),
    calendarDate: new Date(now.getFullYear(), now.getMonth(), 1),
    selectedDay: isoDate(now),
    calendarTouched: false,
    drawerItemId: null,
    lastFocus: null,
    loading: true,
    error: null,
    refreshing: false,
    toastTimer: null,
    searchTimer: null,
  };

  const el = {};

  /* ---------- storage ---------- */

  function loadSet(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  }

  function saveSet(key, set) {
    try {
      localStorage.setItem(key, JSON.stringify([...set].slice(-1200)));
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  /* ---------- utilities ---------- */

  function parseISODate(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  }

  function isoDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`;
  }

  function startOfDay(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function dayDiff(dateString, from = startOfDay()) {
    const target = parseISODate(dateString);
    if (!target) return null;
    return Math.round((startOfDay(target) - startOfDay(from)) / 86400000);
  }

  function formatDateCN(value) {
    const date = parseISODate(value);
    if (!date) return '—';
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }

  function formatMonthDay(value) {
    const date = parseISODate(value);
    if (!date) return '—';
    return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, '0')}`;
  }

  function relativeTime(value) {
    if (!value) return '正在同步';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '刚刚';
    const diff = Date.now() - date.getTime();
    if (diff < 0) return '刚刚';
    const minutes = Math.floor(diff / 60000);
    if (minutes < 2) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} 天前`;
    return formatMonthDay(isoDate(date));
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeForCompare(value) {
    return String(value || '').replace(/[\s，。；：、“”‘’（）()【】[\]…—·,.!?！？:;"']/g, '');
  }

  function highlight(text, query) {
    const safe = esc(text);
    if (!query) return safe;
    const token = query.trim().split(/\s+/).find(Boolean);
    if (!token) return safe;
    try {
      return safe.replace(new RegExp(escapeRegExp(esc(token)), 'gi'), (match) => `<mark>${match}</mark>`);
    } catch {
      return safe;
    }
  }

  function safeUrl(url) {
    return /^https?:\/\//i.test(url || '') ? url : '#';
  }

  function categoryMeta(key) {
    return state.categories[key] || FALLBACK_CATEGORIES[key] || FALLBACK_CATEGORIES.notice;
  }

  function searchTokens() {
    return state.q
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);
  }

  function matchesQuery(item) {
    const tokens = searchTokens();
    if (!tokens.length) return true;
    const meta = categoryMeta(item.category);
    const haystack = [
      item.title,
      item.summary,
      item.content?.slice(0, 400),
      (item.tags || []).join(' '),
      item.sourceShort,
      item.sourceName,
      meta.label,
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  }

  /* ---------- data ---------- */

  async function loadFeed({ silent = false } = {}) {
    if (!silent) {
      state.loading = true;
      state.error = null;
      renderFeed();
    }
    try {
      const res = await fetch('/api/feed', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      state.items = Array.isArray(data.items) ? data.items : [];
      state.sources = Array.isArray(data.sources) ? data.sources : [];
      state.categories = data.categories || FALLBACK_CATEGORIES;
      state.updatedAt = data.updatedAt || null;
      state.error = null;
      state.loading = false;
      renderAll();
    } catch (error) {
      state.loading = false;
      state.error = error.message || '无法连接数据服务';
      renderFeed();
      renderStatus();
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (!res.ok) return null;
      const status = await res.json();
      state.status = status;
      return status;
    } catch {
      return null;
    }
  }

  async function checkStatus({ initial = false } = {}) {
    const status = await fetchStatus();
    if (!status) {
      renderStatus();
      return;
    }
    if (state.updatedAt && status.updatedAt && status.updatedAt !== state.updatedAt) {
      await loadFeed({ silent: true });
      if (!initial) toast('官方来源有更新，已自动同步');
    }
    renderStatus();
  }

  /* ---------- filtering ---------- */

  function passesTime(item) {
    if (state.timeFilter === 'all') return true;
    const published = parseISODate(item.publishedAt);
    if (!published) return false;
    const days = Number(state.timeFilter);
    return published >= addDays(startOfDay(), -(days - 1));
  }

  function passesDeadline(item) {
    if (state.deadlineFilter === 'all') return true;
    const days = dayDiff(item.deadline);
    if (days === null) return false;
    if (state.deadlineFilter === 'upcoming') return days >= 0;
    if (state.deadlineFilter === 'week') return days >= 0 && days <= 7;
    if (state.deadlineFilter === 'passed') return days < 0;
    return true;
  }

  function getFeedItems() {
    let items = state.items.filter((item) => matchesQuery(item) && passesTime(item) && passesDeadline(item));
    if (state.scope !== 'all') items = items.filter((item) => item.scope === state.scope);
    if (state.category !== 'all') items = items.filter((item) => item.category === state.category);

    if (state.sort === 'earliest') {
      items = [...items].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    } else if (state.sort === 'deadline') {
      items = [...items].sort((a, b) => {
        const aDays = a.deadline ? dayDiff(a.deadline) : null;
        const bDays = b.deadline ? dayDiff(b.deadline) : null;
        const aFuture = aDays !== null && aDays >= 0;
        const bFuture = bDays !== null && bDays >= 0;
        if (aFuture && bFuture) return aDays - bDays || b.publishedAt.localeCompare(a.publishedAt);
        if (aFuture) return -1;
        if (bFuture) return 1;
        return b.publishedAt.localeCompare(a.publishedAt);
      });
    } else {
      items = [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    }
    return items;
  }

  function getSavedItems() {
    return state.items
      .filter((item) => state.saved.has(item.id) && matchesQuery(item))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  /* ---------- rendering: shell ---------- */

  function renderAll() {
    renderStatus();
    renderSidebar();
    renderFilterLabels();
    renderFeed();
    renderCalendar();
    renderSaved();
    renderNavCount();
    updateSearchChrome();
  }

  function renderStatus() {
    const when = state.updatedAt ? `更新于 ${relativeTime(state.updatedAt)}` : '正在同步官方来源';
    setText('updated-text', when);
    setText('sidebar-updated', when);
    setText('auto-state', state.refreshing ? '正在同步' : '自动更新');
    const live = document.querySelector('.sidebar-live');
    if (live) live.classList.toggle('is-busy', state.refreshing);
    updateRefreshButtons();
  }

  function updateRefreshButtons() {
    if (!el.refreshBtn) return;
    el.refreshBtn.disabled = state.refreshing;
    el.refreshBtn.classList.toggle('is-spinning', state.refreshing);
    el.refreshBtn.setAttribute('aria-busy', String(state.refreshing));
  }

  function renderNavCount() {
    const count = state.saved.size;
    if (!el.navSavedCount) return;
    el.navSavedCount.hidden = count === 0;
    el.navSavedCount.textContent = String(count);
  }

  function updateSearchChrome() {
    if (!el.searchInput) return;
    el.searchInput.placeholder = state.view === 'saved' ? '搜索我的收藏' : '搜索通知、讲座、关键词';
  }

  /* ---------- rendering: sidebar + filter menus ---------- */

  function renderSidebar() {
    if (state.category !== 'all' && !CATEGORY_ORDER.includes(state.category)) {
      state.category = 'all';
    }

    const context = state.items.filter((item) => matchesQuery(item) && passesTime(item) && passesDeadline(item));
    const college = context.filter((item) => item.scope === 'college').length;
    const university = context.length - college;

    el.scopeFilters.innerHTML = [
      ['all', '全部信息', context.length],
      ['college', '院系专属', college],
      ['university', '全校机会', university],
    ]
      .map(
        ([value, label, count]) => `<button class="side-item${
          state.scope === value ? ' is-active' : ''
        }" type="button" data-scope="${value}" aria-pressed="${state.scope === value}">
          <span>${label}</span><span class="count">${count}</span>
        </button>`
      )
      .join('');

    const base = context.filter((item) => state.scope === 'all' || item.scope === state.scope);
    el.categoryFilters.innerHTML = [
      `<button class="side-item${state.category === 'all' ? ' is-active' : ''}" type="button"
        data-category="all" aria-pressed="${state.category === 'all'}">
        <span>全部栏目</span><span class="count">${base.length}</span>
      </button>`,
      ...CATEGORY_ORDER.map((key) => {
        const meta = categoryMeta(key);
        const count = base.filter((item) => item.category === key).length;
        return `<button class="side-item${state.category === key ? ' is-active' : ''}" type="button"
          data-category="${key}" aria-pressed="${state.category === key}"
          style="--cat:${meta.color};--cat-soft:${meta.soft}">
          <i class="cat-dot"></i><span>${meta.label}</span><span class="count">${count}</span>
        </button>`;
      }),
    ].join('');

    renderFilterLabels();
    renderActiveFilters();
  }

  function renderFilterLabels() {
    setText('time-value', TIME_LABELS[state.timeFilter]);
    setText('deadline-value', DEADLINE_LABELS[state.deadlineFilter]);
    setText('category-value', state.category === 'all' ? '全部' : categoryMeta(state.category).label);

    el.timeMenu.classList.toggle('is-active', state.timeFilter !== 'all');
    el.deadlineMenu.classList.toggle('is-active', state.deadlineFilter !== 'all');
    el.categoryMenu.classList.toggle('is-active', state.category !== 'all');

    document.querySelectorAll('[data-time]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.time === state.timeFilter);
    });
    document.querySelectorAll('[data-deadline]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.deadline === state.deadlineFilter);
    });

    el.categoryMenuOptions.innerHTML = [
      `<button type="button" data-category-filter="all" class="${state.category === 'all' ? 'is-selected' : ''}">全部栏目</button>`,
      ...CATEGORY_ORDER.map(
        (key) =>
          `<button type="button" data-category-filter="${key}" class="${
            state.category === key ? 'is-selected' : ''
          }">${categoryMeta(key).label}</button>`
      ),
    ].join('');

    document.querySelectorAll('[data-sort]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.sort === state.sort);
    });
  }

  function renderActiveFilters() {
    const chips = [];
    if (state.scope !== 'all') {
      chips.push(
        `<button class="filter-chip" type="button" data-clear="scope">${
          state.scope === 'college' ? '院系专属' : '全校机会'
        }<svg class="icon"><use href="#i-close"></use></svg></button>`
      );
    }
    if (state.category !== 'all') {
      chips.push(
        `<button class="filter-chip" type="button" data-clear="category">${esc(
          categoryMeta(state.category).label
        )}<svg class="icon"><use href="#i-close"></use></svg></button>`
      );
    }
    if (state.timeFilter !== 'all') {
      chips.push(
        `<button class="filter-chip" type="button" data-clear="time">时间：${TIME_LABELS[state.timeFilter]}<svg class="icon"><use href="#i-close"></use></svg></button>`
      );
    }
    if (state.deadlineFilter !== 'all') {
      chips.push(
        `<button class="filter-chip" type="button" data-clear="deadline">截止：${
          DEADLINE_LABELS[state.deadlineFilter]
        }<svg class="icon"><use href="#i-close"></use></svg></button>`
      );
    }
    if (state.q) {
      chips.push(
        `<button class="filter-chip" type="button" data-clear="q">搜索：${esc(
          state.q
        )}<svg class="icon"><use href="#i-close"></use></svg></button>`
      );
    }
    if (chips.length) {
      chips.push('<button class="filter-chip clear-all" type="button" data-clear="all">清除全部</button>');
      el.activeFilterBar.innerHTML = chips.join('');
      el.activeFilterBar.hidden = false;
    } else {
      el.activeFilterBar.innerHTML = '';
      el.activeFilterBar.hidden = true;
    }
  }

  /* ---------- rendering: feed ---------- */

  function renderFeed() {
    if (!el.feedList) return;
    if (state.loading && !state.items.length) {
      el.feedList.innerHTML = `<div class="loading-state">${Array.from({ length: 5 })
        .map(() => '<div class="skeleton-card"></div>')
        .join('')}</div>`;
      el.emptyState.hidden = true;
      el.loadMoreWrap.hidden = true;
      return;
    }

    if (state.error && !state.items.length) {
      el.feedList.innerHTML = `<div class="feed-error">
        <h3>数据服务暂时没有响应</h3>
        <p>${esc(state.error)}。请稍后刷新。</p>
        <button class="button button-outline" type="button" data-retry>重新连接</button>
      </div>`;
      el.emptyState.hidden = true;
      el.loadMoreWrap.hidden = true;
      return;
    }

    const all = getFeedItems();
    const visible = all.slice(0, state.pageSize);
    setText('result-count', all.length);
    el.feedList.innerHTML = visible.map((item, index) => renderCard(item, index)).join('');

    const empty = all.length === 0;
    el.emptyState.hidden = !empty;
    if (empty) el.feedList.innerHTML = '';

    const remaining = all.length - visible.length;
    el.loadMoreWrap.hidden = empty || remaining <= 0;
    if (!el.loadMoreWrap.hidden) {
      el.loadMoreCount.textContent = `还有 ${remaining} 条`;
      el.resultMeta.textContent = `显示 ${visible.length} / ${all.length}`;
      el.resultMetaBottom.textContent = `已显示 ${visible.length} / ${all.length}`;
    } else {
      el.resultMeta.textContent = empty ? '' : `${all.length} 条`;
    }

    renderActiveFilters();
  }

  function renderCard(item, index = 0) {
    const meta = categoryMeta(item.category);
    const date = parseISODate(item.publishedAt);
    const unread = !state.read.has(item.id);
    const today = date && isoDate(date) === isoDate(new Date());
    const deadline = deadlineText(item);
    const event = eventText(item);
    const tags = (item.tags || []).slice(0, 2);
    const saved = state.saved.has(item.id);

    return `<article class="feed-card${unread ? ' is-unread' : ' is-read'}" data-open="${esc(item.id)}"
      tabindex="0" role="button" aria-label="打开：${esc(item.title)}" style="--i:${index}">
      <div class="date-block">
        <span class="date-day">${date ? String(date.getDate()).padStart(2, '0') : '—'}</span>
        <span class="date-mon">${date ? MONTH_EN[date.getMonth()] : '—'}</span>
        <span class="date-year">${date ? date.getFullYear() : ''}</span>
        ${today ? '<span class="date-today">TODAY</span>' : ''}
      </div>
      <div class="card-body">
        <div class="card-top">
          <span class="category-tag" style="--cat:${meta.color};--cat-soft:${meta.soft}">${meta.label}</span>
          <span class="scope-tag ${item.scope}">${item.scope === 'college' ? '院系专属' : '全校机会'}</span>
          <span class="card-source">${esc(item.sourceName)}</span>
        </div>
        <h3 class="card-title">${highlight(item.title, state.q)}</h3>
        <p class="card-summary">${esc(item.summary || '该条信息来自官方渠道，点击查看完整内容。')}</p>
        <div class="card-foot">
          <div class="tag-row">
            ${tags.map((tag) => `<span class="mini-tag">${esc(tag)}</span>`).join('')}
            ${deadline ? `<span class="deadline-pill"><svg class="icon"><use href="#i-clock"></use></svg>${deadline}</span>` : ''}
            ${event ? `<span class="event-pill"><svg class="icon"><use href="#i-calendar"></use></svg>${event}</span>` : ''}
          </div>
          <div class="card-actions">
            <button class="card-save${saved ? ' is-saved' : ''}" type="button" data-save="${esc(item.id)}"
              aria-label="${saved ? '取消收藏' : '收藏'}" aria-pressed="${saved}">
              <svg class="icon"><use href="#i-bookmark"></use></svg>
            </button>
            <svg class="icon card-arrow" aria-hidden="true"><use href="#i-arrow"></use></svg>
          </div>
        </div>
      </div>
    </article>`;
  }

  function deadlineText(item) {
    if (!item.deadline) return '';
    const days = dayDiff(item.deadline);
    if (days === null) return '';
    if (days < 0) return days >= -3 ? '已截止' : '';
    if (days > 30) return '';
    if (days === 0) return '今日截止';
    return `剩 ${days} 天`;
  }

  function eventText(item) {
    if (!item.eventDate || item.deadline) return '';
    const days = dayDiff(item.eventDate);
    if (days === null || days < 0 || days > 30) return '';
    return `活动 ${formatMonthDay(item.eventDate)}`;
  }

  /* ---------- rendering: calendar ---------- */

  function renderCalendar() {
    if (!el.calendarGrid) return;
    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const gridStart = addDays(first, -offset);
    const todayISO = isoDate(new Date());
    const events = buildCalendarEvents();

    if (!state.selectedDay || !state.selectedDay.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)) {
      const todayKey = isoDate(new Date());
      const todayHas = events.has(todayKey) && todayKey.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);
      const firstEvent = [...events.keys()]
        .filter((key) => key.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`))
        .sort()[0];
      state.selectedDay = todayHas ? todayKey : firstEvent || isoDate(first);
    }

    if (!state.calendarTouched && !events.has(state.selectedDay)) {
      const todayKey = isoDate(new Date());
      const upcoming = [...events.keys()]
        .filter((key) => key.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`) && key >= todayKey)
        .sort()[0];
      if (upcoming) state.selectedDay = upcoming;
    }

    setText('calendar-year', String(year));
    setText('calendar-month', MONTH_CN[month]);
    const monthEvents = [...events.entries()].filter(([key]) =>
      key.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)
    );
    const monthCount = monthEvents.reduce((sum, [, list]) => sum + list.length, 0);
    setText('calendar-event-count', `本月 ${monthCount} 个节点`);

    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const date = addDays(gridStart, i);
      const key = isoDate(date);
      const outside = date.getMonth() !== month;
      const list = events.get(key) || [];
      const onlyEvent = list.length > 0 && list.every((event) => event.type === 'event');
      const visible = list.slice(0, 2);
      cells.push(`<button class="calendar-day${outside ? ' is-outside' : ''}${
        key === todayISO ? ' is-today' : ''
      }${key === state.selectedDay ? ' is-selected' : ''}${list.length ? ' has-events' : ''}${
        onlyEvent ? ' has-event-only' : ''
      }" type="button" data-date="${key}" aria-label="${key}${list.length ? `，${list.length} 个节点` : ''}">
        <span class="day-number">${date.getDate()}</span>
        <span class="day-events">
          ${visible
            .map(
              (event) =>
                `<span class="day-event${event.type === 'event' ? ' is-event' : ''}">${esc(
                  event.label
                )} ${esc(event.item.title.slice(0, 8))}</span>`
            )
            .join('')}
          ${list.length > 2 ? `<span class="day-more">+${list.length - 2}</span>` : ''}
        </span>
      </button>`);
    }
    el.calendarGrid.innerHTML = cells.join('');
    renderDayList(events);
  }

  function buildCalendarEvents() {
    const map = new Map();
    const add = (date, type, item) => {
      if (!date) return;
      if (!map.has(date)) map.set(date, []);
      const list = map.get(date);
      if (list.some((event) => event.item.id === item.id && event.type === type)) return;
      list.push({ type, item, label: type === 'deadline' ? '截止' : '活动' });
    };
    state.items.forEach((item) => {
      add(item.deadline, 'deadline', item);
      add(item.eventDate, 'event', item);
    });
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'deadline' ? -1 : 1;
        return a.item.title.localeCompare(b.item.title);
      });
    }
    return map;
  }

  function renderDayList(events) {
    const selected = state.selectedDay;
    const list = events.get(selected) || [];
    const date = parseISODate(selected);
    const isToday = selected === isoDate(new Date());
    setText('selected-day-title', isToday ? '今天' : date ? `${date.getMonth() + 1} 月 ${date.getDate()} 日` : '选择日期');
    setText(
      'selected-day-subtitle',
      date ? `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 · ${list.length} 个节点` : '选择日期查看节点'
    );

    if (!list.length) {
      el.calendarDayList.innerHTML =
        '<p class="day-list-empty">这一天暂时没有识别到截止日或活动日。<br />可以翻到有标记的日期，或回到信息流。</p>';
      return;
    }

    el.calendarDayList.innerHTML = list
      .map(
        (event) => `<div class="day-list-item" data-open="${esc(event.item.id)}" tabindex="0" role="button">
          <div class="day-list-time"><b>${String(date.getDate()).padStart(2, '0')}</b><span>${MONTH_EN[date.getMonth()]}</span></div>
          <div>
            <h4>${esc(event.item.title)}</h4>
            <p><span class="day-list-type${event.type === 'event' ? ' event' : ''}">${
              event.type === 'deadline' ? '截止' : '活动'
            }</span>${esc(event.item.sourceShort)}</p>
          </div>
        </div>`
      )
      .join('');
  }

  /* ---------- rendering: saved ---------- */

  function renderSaved() {
    if (!el.savedList) return;
    const items = getSavedItems();
    const total = state.saved.size;
    setText('saved-total', `${total} 条收藏`);
    if (el.clearSaved) el.clearSaved.hidden = total === 0;
    if (el.exportSavedIcs) el.exportSavedIcs.disabled = total === 0;

    const emptyTitle = el.savedEmpty?.querySelector('h3');
    const emptyText = el.savedEmpty?.querySelector('p');
    if (!items.length) {
      el.savedList.hidden = true;
      el.savedList.innerHTML = '';
      el.savedEmpty.hidden = false;
      if (emptyTitle) emptyTitle.textContent = total ? '收藏中没有匹配项' : '还没有收藏';
      if (emptyText)
        emptyText.textContent = total
          ? '试试换一个关键词，或回到信息流继续看看。'
          : '在信息卡片或详情页点击书签，重要信息就会留在这里。';
      return;
    }

    el.savedEmpty.hidden = true;
    el.savedList.hidden = false;
    el.savedList.innerHTML = items.map((item, index) => renderCard(item, index)).join('');
  }

  /* ---------- refresh ---------- */

  async function triggerRefresh() {
    if (state.refreshing) return;
    state.refreshing = true;
    renderStatus();
    toast('正在巡检官方来源…');
    let finalStatus = null;
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      if (!res.ok && res.status !== 409) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      const started = Date.now();
      while (Date.now() - started < 130000) {
        await delay(1400);
        const status = await fetchStatus();
        if (status) {
          finalStatus = status;
          if (!status.refreshing) break;
        }
      }
      if (finalStatus?.refreshing) throw new Error('抓取超时，请稍后重试');
      if (finalStatus?.lastError) throw new Error(finalStatus.lastError);
      state.refreshing = false;
      await loadFeed({ silent: true });
      toast(`更新完成，共 ${state.items.length} 条信息`);
    } catch (error) {
      toast(`更新失败：${error.message || '未知错误'}`, 'error');
    } finally {
      state.refreshing = false;
      renderStatus();
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /* ---------- drawer ---------- */

  function openDrawer(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    state.drawerItemId = id;
    state.lastFocus = document.activeElement;
    renderDrawer(item);
    el.drawer.classList.add('is-open');
    el.drawer.setAttribute('aria-hidden', 'false');
    el.drawerScrim.hidden = false;
    document.body.classList.add('drawer-open');
    markRead(id);
    setTimeout(() => el.drawer?.focus({ preventScroll: true }), 60);
  }

  function closeDrawer() {
    if (!el.drawer) return;
    el.drawer.classList.remove('is-open');
    el.drawer.setAttribute('aria-hidden', 'true');
    el.drawerScrim.hidden = true;
    document.body.classList.remove('drawer-open');
    state.drawerItemId = null;
    if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
      setTimeout(() => state.lastFocus.focus(), 25);
    }
  }

  function trapDrawerFocus(event) {
    const focusable = [...el.drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
      (node) => node.offsetParent !== null
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === el.drawer)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function renderDrawer(item) {
    const meta = categoryMeta(item.category);
    const saved = state.saved.has(item.id);
    el.drawerSource.textContent = item.sourceName || '官方来源';
    el.drawerBadges.innerHTML = `<span class="category-tag" style="--cat:${meta.color};--cat-soft:${meta.soft}">${meta.label}</span>
      <span class="scope-tag ${item.scope}">${item.scope === 'college' ? '院系专属' : '全校机会'}</span>`;
    el.drawerTitle.innerHTML = highlight(item.title, state.q);
    el.drawerMeta.innerHTML = `<span><svg class="icon"><use href="#i-calendar"></use></svg>${formatDateCN(
      item.publishedAt
    )}</span><span>来源 · ${esc(item.sourceName)}</span>`;

    const days = dayDiff(item.deadline);
    if (item.deadline) {
      el.drawerDeadline.hidden = false;
      el.drawerDeadline.className = `drawer-deadline${days !== null && days < 0 ? ' is-passed' : ''}`;
      const text =
        days === null
          ? '截止时间待确认'
          : days < 0
            ? `已于 ${formatDateCN(item.deadline)} 截止`
            : days === 0
              ? '今天是截止日'
              : `距截止还有 ${days} 天`;
      el.drawerDeadline.innerHTML = `<svg class="icon"><use href="#i-clock"></use></svg><b>${text}</b><span>${formatDateCN(
        item.deadline
      )}</span>`;
    } else {
      el.drawerDeadline.hidden = true;
      el.drawerDeadline.innerHTML = '';
    }

    const summary = item.summary || '';
    const normalizedSummary = normalizeForCompare(summary).slice(0, 24);
    const normalizedContent = normalizeForCompare(item.content || '').slice(0, 90);
    const duplicateSummary =
      summary.startsWith('该条信息来自') ||
      (normalizedSummary.length >= 12 && normalizedContent.includes(normalizedSummary));
    el.drawerSummary.hidden = duplicateSummary;
    el.drawerSummary.textContent = duplicateSummary ? '' : summary;
    el.drawerContent.innerHTML = formatContent(item);
    el.drawerTags.innerHTML = (item.tags || []).map((tag) => `<span class="drawer-tag">${esc(tag)}</span>`).join('');
    el.drawerLink.href = safeUrl(item.url);
    el.drawerSave.classList.toggle('is-saved', saved);
    el.drawerSave.querySelector('span').textContent = saved ? '已收藏' : '收藏';
    el.drawerSave.setAttribute('aria-pressed', String(saved));
  }

  function formatContent(item) {
    let content = (item.content || '').trim();
    if (content && content.startsWith(item.title)) content = content.slice(item.title.length).trim();
    content = content
      .replace(/上一条[:：][\s\S]*$/s, '')
      .replace(/下一条[:：][\s\S]*$/s, '')
      .replace(/版权所有[\s\S]*$/s, '')
      .slice(0, 6200)
      .trim();

    if (!content) {
      return '<p class="drawer-placeholder">正文位于官方原文页，聚合器未能提取到可读正文。点击底部「阅读原文」查看完整内容。</p>';
    }

    const paragraphs = [];
    if (content.includes('\n')) {
      content
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => paragraphs.push(line));
    } else {
      const sentences = content.match(/[^。！？!?]+[。！？!?]?/g) || [content];
      let buffer = '';
      for (const sentence of sentences) {
        buffer += sentence;
        if (buffer.length >= 110) {
          paragraphs.push(buffer.trim());
          buffer = '';
        }
      }
      if (buffer.trim()) paragraphs.push(buffer.trim());
    }

    return paragraphs
      .slice(0, 14)
      .map((paragraph) => `<p>${esc(paragraph)}</p>`)
      .join('');
  }

  /* ---------- saved / read ---------- */

  function toggleSave(id) {
    if (!id) return;
    if (state.saved.has(id)) {
      state.saved.delete(id);
      toast('已取消收藏');
    } else {
      state.saved.add(id);
      toast('已收藏');
    }
    saveSet(SAVED_KEY, state.saved);
    renderNavCount();
    document.querySelectorAll(`[data-save="${cssEscape(id)}"]`).forEach((button) => {
      const saved = state.saved.has(id);
      button.classList.toggle('is-saved', saved);
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', saved ? '取消收藏' : '收藏');
    });
    if (state.drawerItemId === id) {
      el.drawerSave.classList.toggle('is-saved', state.saved.has(id));
      el.drawerSave.querySelector('span').textContent = state.saved.has(id) ? '已收藏' : '收藏';
    }
    renderSaved();
  }

  function markRead(id) {
    if (state.read.has(id)) return;
    state.read.add(id);
    saveSet(READ_KEY, state.read);
    document.querySelectorAll(`[data-open="${cssEscape(id)}"]`).forEach((node) => {
      if (node.classList.contains('feed-card')) {
        node.classList.remove('is-unread');
        node.classList.add('is-read');
      }
    });
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* ---------- ics ---------- */

  function collectCalendarItems(days = 120, onlySaved = false) {
    const result = [];
    const today = startOfDay();
    const source = onlySaved ? state.items.filter((item) => state.saved.has(item.id)) : state.items;
    source.forEach((item) => {
      const add = (date, type) => {
        if (!date) return;
        const target = parseISODate(date);
        if (!target) return;
        const diff = Math.round((startOfDay(target) - today) / 86400000);
        if (diff < 0 || diff > days) return;
        result.push({ item, date, type });
      };
      add(item.deadline, 'deadline');
      add(item.eventDate, 'event');
    });
    result.sort((a, b) => a.date.localeCompare(b.date) || a.item.title.localeCompare(b.item.title));
    return result;
  }

  function downloadICS(entries, filename) {
    if (!entries.length) {
      toast('近期没有可导出的截止日或活动日');
      return;
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//WeiChang Hub//Qian Weichang College//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:伟长汇 · 截止与活动',
      'X-WR-TIMEZONE:Asia/Shanghai',
    ];
    entries.forEach(({ item, date, type }) => {
      const start = date.replace(/-/g, '');
      const end = isoDate(addDays(parseISODate(date), 1)).replace(/-/g, '');
      const summary = `${type === 'deadline' ? '截止' : '活动'}｜${item.title}`;
      const description = `${item.summary || ''}\n来源：${item.sourceName}\n原文：${item.url}`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${item.id}-${type}-${start}@weichanghub.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${end}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(description)}`,
        `URL:${item.url}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(`已导出 ${entries.length} 个日程节点`);
  }

  function icsEscape(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;');
  }

  /* ---------- views / filters ---------- */

  function go(view, { push = true, scroll = true } = {}) {
    const next = VIEWS.includes(view) ? view : 'feed';
    state.view = next;
    document.querySelectorAll('.view').forEach((section) => {
      section.hidden = section.id !== `view-${next}`;
    });
    document.querySelectorAll('[data-view-link]').forEach((link) => {
      link.classList.toggle('is-active', link.dataset.viewLink === next);
    });
    if (push && location.hash !== `#/${next}`) history.pushState(null, '', `#/${next}`);
    if (next === 'feed') renderFeed();
    if (next === 'calendar') renderCalendar();
    if (next === 'saved') renderSaved();
    updateSearchChrome();
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toast(message, type = 'info') {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.className = `toast is-visible${type === 'error' ? ' is-error' : ''}`;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      el.toast.className = 'toast';
    }, 3200);
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }

  function updateFilters(patch) {
    Object.assign(state, patch);
    state.pageSize = PAGE_SIZE;
    if (el.searchInput && 'q' in patch) el.searchInput.value = state.q;
    renderSidebar();
    renderFilterLabels();
    renderFeed();
    renderSaved();
  }

  function resetFilters() {
    state.scope = 'all';
    state.category = 'all';
    state.timeFilter = 'all';
    state.deadlineFilter = 'all';
    state.q = '';
    state.sort = 'latest';
    state.pageSize = PAGE_SIZE;
    if (el.searchInput) el.searchInput.value = '';
    renderSidebar();
    renderFilterLabels();
    renderFeed();
    renderSaved();
    closeAllMenus();
  }

  function closeAllMenus() {
    document.querySelectorAll('.filter-menu[open]').forEach((menu) => {
      menu.removeAttribute('open');
    });
  }

  function switchToFeedIfNeeded() {
    if (state.view !== 'feed') go('feed', { scroll: false });
  }

  /* ---------- events ---------- */

  function bindEvents() {
    el.searchInput = document.getElementById('search-input');
    el.refreshBtn = document.getElementById('refresh-btn');
    el.scopeFilters = document.getElementById('scope-filters');
    el.categoryFilters = document.getElementById('category-filters');
    el.timeMenu = document.getElementById('time-menu');
    el.deadlineMenu = document.getElementById('deadline-menu');
    el.categoryMenu = document.getElementById('category-menu');
    el.categoryMenuOptions = document.getElementById('category-menu-options');
    el.activeFilterBar = document.getElementById('active-filter-bar');
    el.feedList = document.getElementById('feed-list');
    el.emptyState = document.getElementById('empty-state');
    el.loadMoreWrap = document.getElementById('load-more-wrap');
    el.loadMoreCount = document.getElementById('load-more-count');
    el.resultMeta = document.getElementById('result-meta');
    el.resultMetaBottom = document.getElementById('result-meta-bottom');
    el.savedTotal = document.getElementById('saved-total');
    el.savedList = document.getElementById('saved-list');
    el.savedEmpty = document.getElementById('saved-empty');
    el.clearSaved = document.getElementById('clear-saved');
    el.exportSavedIcs = document.getElementById('export-saved-ics');
    el.exportIcs = document.getElementById('export-ics');
    el.navSavedCount = document.getElementById('nav-saved-count');
    el.drawer = document.getElementById('detail-drawer');
    el.drawerScrim = document.getElementById('drawer-scrim');
    el.drawerClose = document.getElementById('drawer-close');
    el.drawerSource = document.getElementById('drawer-source');
    el.drawerBadges = document.getElementById('drawer-badges');
    el.drawerTitle = document.getElementById('drawer-title');
    el.drawerMeta = document.getElementById('drawer-meta');
    el.drawerDeadline = document.getElementById('drawer-deadline');
    el.drawerSummary = document.getElementById('drawer-summary');
    el.drawerContent = document.getElementById('drawer-content');
    el.drawerTags = document.getElementById('drawer-tags');
    el.drawerSave = document.getElementById('drawer-save');
    el.drawerLink = document.getElementById('drawer-link');
    el.calendarGrid = document.getElementById('calendar-grid');
    el.calendarDayList = document.getElementById('calendar-day-list');
    el.calendarPrev = document.getElementById('calendar-prev');
    el.calendarNext = document.getElementById('calendar-next');
    el.calendarToday = document.getElementById('calendar-today');
    el.toast = document.getElementById('toast');

    document.addEventListener('click', (event) => {
      const link = event.target.closest('[data-view-link]');
      if (link) {
        event.preventDefault();
        go(link.dataset.viewLink);
      }
    });

    window.addEventListener('hashchange', () => {
      const view = location.hash.replace(/^#\/?/, '') || 'feed';
      if (view !== state.view) go(view, { push: false, scroll: false });
    });

    el.searchInput.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        updateFilters({ q: el.searchInput.value.trim() });
      }, 120);
    });

    el.refreshBtn.addEventListener('click', triggerRefresh);
    document.getElementById('reset-filters').addEventListener('click', resetFilters);
    document.getElementById('empty-reset').addEventListener('click', resetFilters);

    el.scopeFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-scope]');
      if (!button) return;
      switchToFeedIfNeeded();
      updateFilters({ scope: button.dataset.scope });
    });

    el.categoryFilters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      switchToFeedIfNeeded();
      updateFilters({ category: button.dataset.category });
    });

    document.getElementById('filter-bar').addEventListener('click', (event) => {
      const time = event.target.closest('[data-time]');
      if (time) {
        updateFilters({ timeFilter: time.dataset.time });
        closeAllMenus();
        return;
      }
      const deadline = event.target.closest('[data-deadline]');
      if (deadline) {
        updateFilters({ deadlineFilter: deadline.dataset.deadline });
        closeAllMenus();
        return;
      }
      const category = event.target.closest('[data-category-filter]');
      if (category) {
        updateFilters({ category: category.dataset.categoryFilter });
        closeAllMenus();
        return;
      }
      const sort = event.target.closest('[data-sort]');
      if (sort) {
        state.sort = sort.dataset.sort;
        state.pageSize = PAGE_SIZE;
        renderFilterLabels();
        renderFeed();
        closeAllMenus();
      }
    });

    document.querySelectorAll('.filter-menu').forEach((menu) => {
      menu.addEventListener('toggle', () => {
        if (!menu.open) return;
        document.querySelectorAll('.filter-menu[open]').forEach((other) => {
          if (other !== menu) other.removeAttribute('open');
        });
      });
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.filter-menu')) closeAllMenus();
    });

    el.activeFilterBar.addEventListener('click', (event) => {
      const button = event.target.closest('[data-clear]');
      if (!button) return;
      const type = button.dataset.clear;
      if (type === 'all') resetFilters();
      else if (type === 'scope') updateFilters({ scope: 'all' });
      else if (type === 'category') updateFilters({ category: 'all' });
      else if (type === 'time') updateFilters({ timeFilter: 'all' });
      else if (type === 'deadline') updateFilters({ deadlineFilter: 'all' });
      else if (type === 'q') {
        if (el.searchInput) el.searchInput.value = '';
        updateFilters({ q: '' });
      }
    });

    el.feedList.addEventListener('click', handleCardAreaClick);
    el.feedList.addEventListener('keydown', handleCardAreaKeydown);
    el.savedList.addEventListener('click', handleCardAreaClick);
    el.savedList.addEventListener('keydown', handleCardAreaKeydown);
    el.calendarDayList.addEventListener('click', handleCardAreaClick);
    el.calendarDayList.addEventListener('keydown', handleCardAreaKeydown);

    el.calendarGrid.addEventListener('click', (event) => {
      const cell = event.target.closest('[data-date]');
      if (!cell) return;
      state.calendarTouched = true;
      state.selectedDay = cell.dataset.date;
      renderCalendar();
    });

    el.calendarPrev.addEventListener('click', () => {
      state.calendarTouched = true;
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
      state.selectedDay = null;
      renderCalendar();
    });
    el.calendarNext.addEventListener('click', () => {
      state.calendarTouched = true;
      state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
      state.selectedDay = null;
      renderCalendar();
    });
    el.calendarToday.addEventListener('click', () => {
      state.calendarTouched = true;
      const today = new Date();
      state.calendarDate = new Date(today.getFullYear(), today.getMonth(), 1);
      state.selectedDay = isoDate(today);
      renderCalendar();
    });

    el.drawerClose.addEventListener('click', closeDrawer);
    el.drawerScrim.addEventListener('click', closeDrawer);
    el.drawerSave.addEventListener('click', () => {
      if (state.drawerItemId) toggleSave(state.drawerItemId);
    });

    document.getElementById('load-more').addEventListener('click', () => {
      state.pageSize += PAGE_SIZE;
      renderFeed();
    });

    document.getElementById('clear-saved').addEventListener('click', () => {
      if (!state.saved.size) return;
      if (!window.confirm('清空全部收藏？此操作不会影响其他数据。')) return;
      state.saved.clear();
      saveSet(SAVED_KEY, state.saved);
      renderNavCount();
      renderSaved();
      closeDrawer();
      toast('收藏已清空');
    });

    el.exportIcs.addEventListener('click', () => {
      downloadICS(collectCalendarItems(120), '伟长汇-近期截止与活动.ics');
    });
    el.exportSavedIcs.addEventListener('click', () => {
      downloadICS(collectCalendarItems(180, true), '伟长汇-我的收藏日程.ics');
    });

    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
      }
      if (event.key === 'Tab' && el.drawer.classList.contains('is-open')) {
        trapDrawerFocus(event);
      }
      if (event.key === 'Escape') {
        if (el.drawer.classList.contains('is-open')) {
          closeDrawer();
        } else if (document.querySelector('.filter-menu[open]')) {
          closeAllMenus();
        } else if (document.activeElement === el.searchInput) {
          if (el.searchInput.value) {
            el.searchInput.value = '';
            updateFilters({ q: '' });
          } else {
            el.searchInput.blur();
          }
        }
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkStatus();
    });
  }

  function handleCardAreaClick(event) {
    const saveButton = event.target.closest('[data-save]');
    if (saveButton) {
      event.preventDefault();
      event.stopPropagation();
      toggleSave(saveButton.dataset.save);
      return;
    }
    const retry = event.target.closest('[data-retry]');
    if (retry) {
      loadFeed();
      return;
    }
    const open = event.target.closest('[data-open]');
    if (open) openDrawer(open.dataset.open);
  }

  function handleCardAreaKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('[data-save]')) return;
    const open = event.target.closest('[data-open]');
    if (open) {
      event.preventDefault();
      openDrawer(open.dataset.open);
    }
  }

  /* ---------- startup ---------- */

  async function init() {
    bindEvents();
    const initialView = location.hash.replace(/^#\/?/, '') || 'feed';
    go(initialView, { push: false, scroll: false });
    renderStatus();
    renderSidebar();
    renderFilterLabels();
    renderFeed();
    renderSaved();
    renderCalendar();

    await loadFeed();
    await checkStatus({ initial: true });
    renderStatus();

    setInterval(() => {
      if (!document.hidden) checkStatus();
    }, 45000);
    setInterval(renderStatus, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
