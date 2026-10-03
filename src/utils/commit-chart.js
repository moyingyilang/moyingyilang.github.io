/**
 * 提交折线图的「窗口切分 / 数据整形 / 渲染」模块
 *
 * 为什么渲染函数返回 HTML 字符串而不是 Astro 组件：
 * 页面上的图既要**构建期就画好**（禁用 JS 时也看得到完整曲线），
 * 又要在访客点选项目、切换窗口或抓取新数据后**原地重画**。
 * 把同一份渲染逻辑同时给 Astro 的 set:html 和浏览器脚本用，
 * 两条路径就不可能画出不一样的东西。
 *
 * 两套粒度（数据源不同，别混着理解）：
 *   - 长期（13 / 26 / 52 周）：用 GitHub participation 接口给的 52 个**周桶**；
 *   - 近期（12 小时 ~ 7 天）：周桶太粗，改用采集到的**提交级时间戳**现场切桶，
 *     这样才有小时级分辨率。
 *
 * 时间轴统一按**北京时间（UTC+8）**切桶与标注：+8 没有夏令时，
 * 于是构建期（在站主手机上）与访客浏览器算出来的桶完全一致，
 * 不会出现「首屏是构建期画的、脚本一跑整条曲线平移几格」的跳变。
 *
 * 因此这里只用纯 JS：不 import node 内置模块，也不依赖任何图表库。
 */

/** 时间轴基准偏移：北京时间 = UTC+8 */
const AXIS_OFFSET_MS = 8 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * 可选的窗口。
 *
 * bucketHours 决定「一个点代表多长时间」：窗口越短，桶越细，
 * 但点数始终控制在 12~28 个之间，免得折线糊成一片。
 */
export const RANGE_GROUPS = [
	{
		label: '近期',
		ranges: [
			{ id: '12h', label: '12 小时', hours: 12, bucketHours: 1 },
			{ id: '1d', label: '1 天', hours: 24, bucketHours: 1 },
			{ id: '3d', label: '3 天', hours: 72, bucketHours: 3 },
			{ id: '7d', label: '7 天', hours: 168, bucketHours: 6 },
		],
	},
	{
		label: '长期',
		ranges: [
			{ id: '13w', label: '13 周', weeks: 13 },
			{ id: '26w', label: '26 周', weeks: 26 },
			{ id: '52w', label: '52 周', weeks: 52 },
		],
	},
];

/** 拍平后的窗口列表，按顺序即 UI 里的顺序 */
export const RANGES = RANGE_GROUPS.flatMap((group) => group.ranges);

export const DEFAULT_RANGE_ID = '26w';

/** 统计口径：逐桶计数 / 窗口内累计 */
export const MODES = [{ id: 'count' }, { id: 'cumulative' }];

export const DEFAULT_MODE_ID = 'count';

export function findRange(id) {
	return RANGES.find((range) => range.id === id) ?? RANGES.find((range) => range.id === DEFAULT_RANGE_ID);
}

export function findMode(id) {
	return MODES.find((mode) => mode.id === id) ?? MODES.find((mode) => mode.id === DEFAULT_MODE_ID);
}

/** 口径按钮上的文字：近期的桶不是「周」，标签得跟着窗口走 */
export function modeLabel(window, modeId) {
	if (modeId === 'cumulative') return '累计曲线';
	return `${window.bucketLabel}提交`;
}

/* ------------------------------------------------------------ 窗口切分 */

function pad(value) {
	return String(value).padStart(2, '0');
}

/** 把绝对时间换算成北京时间的各个字段 */
function axisParts(ms) {
	const date = new Date(ms + AXIS_OFFSET_MS);
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		hour: date.getUTCHours(),
		minute: date.getUTCMinutes(),
	};
}

const stamp = (parts) => `${pad(parts.month)}-${pad(parts.day)}`;
const stampTime = (parts) => `${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;

/** 周桶（长期窗口）：数据直接来自 participation 的 52 个桶 */
function weeksWindow(stats, range) {
	const total = stats.weeks.length;
	const startIndex = Math.max(0, total - range.weeks);
	const weeks = stats.weeks.slice(startIndex);

	const buckets = weeks.map((week, index) => {
		const startMs = Date.parse(`${week}T00:00:00Z`);
		const endMs = startMs + 7 * DAY_MS;
		return {
			startMs,
			endMs,
			// 周窗口的刻度只要「月-日」；跨年时窗口本身会在说明里写清楚
			tick: week.slice(5),
			span: `${week} ~ ${new Date(endMs - DAY_MS).toISOString().slice(5, 10)}`,
			index,
		};
	});

	return {
		kind: 'weeks',
		startIndex,
		count: weeks.length,
		buckets,
		bucketLabel: '每周',
		activeLabel: '周数',
		peakLabel: '单周峰值',
		label: weeks.length ? `${weeks[0]} ~ ${weeks[weeks.length - 1]}` : '—',
	};
}

/** 小时桶（近期窗口）：按北京时间对齐到桶边界，用提交时间戳现算 */
function hoursWindow(stats, range) {
	const stepMs = range.bucketHours * HOUR_MS;
	const count = Math.max(1, Math.round(range.hours / range.bucketHours));

	// 以**快照时间**为锚点，而不是「现在」：这样同一条曲线在构建期和浏览器里一致，
	// 而且窗口永远落在采集到的提交明细覆盖范围之内
	const anchor = Date.parse(stats.generatedAt);
	const safeAnchor = Number.isNaN(anchor) ? Date.now() : anchor;

	// 对齐到北京时间的整点/整 3 小时/整 6 小时
	const currentBucket = Math.floor((safeAnchor + AXIS_OFFSET_MS) / stepMs) * stepMs - AXIS_OFFSET_MS;

	const buckets = [];
	for (let index = count - 1; index >= 0; index -= 1) {
		const startMs = currentBucket - index * stepMs;
		const endMs = startMs + stepMs;
		const start = axisParts(startMs);
		const end = axisParts(endMs);

		buckets.push({
			startMs,
			endMs,
			// 跨过零点的那个桶顺手标出日期，其余只写时刻
			tick: start.hour === 0 && start.minute === 0 ? stamp(start) : `${pad(start.hour)}:${pad(start.minute)}`,
			span: `${stampTime(start)} ~ ${pad(end.hour)}:${pad(end.minute)}`,
			index: count - 1 - index,
		});
	}

	const first = buckets[0];
	const last = buckets[buckets.length - 1];
	const bucketLabel = range.bucketHours === 1 ? '每小时' : `每 ${range.bucketHours} 小时`;

	return {
		kind: 'hours',
		startIndex: 0,
		count,
		buckets,
		bucketLabel,
		activeLabel: range.bucketHours === 1 ? '小时数' : '时段数',
		peakLabel: range.bucketHours === 1 ? '单小时峰值' : '单时段峰值',
		label: `${stampTime(axisParts(first.startMs))} ~ ${stampTime(axisParts(last.endMs))}`,
	};
}

/** 取窗口。range 既接受 id 字符串，也接受 RANGES 里的对象 */
export function windowFor(stats, range = DEFAULT_RANGE_ID) {
	const resolved = typeof range === 'string' ? findRange(range) : range;
	return resolved.weeks ? weeksWindow(stats, resolved) : hoursWindow(stats, resolved);
}

/* -------------------------------------------------------------- 曲线取值 */

/** 把提交时间戳按等宽桶计数 */
function countBuckets(timestamps, window) {
	const counts = new Array(window.count).fill(0);
	const first = window.buckets[0];
	if (!first) return counts;

	const stepMs = window.buckets[1] ? window.buckets[1].startMs - first.startMs : first.endMs - first.startMs;

	for (const iso of timestamps) {
		const ms = Date.parse(iso);
		if (Number.isNaN(ms)) continue;
		const index = Math.floor((ms - first.startMs) / stepMs);
		if (index >= 0 && index < window.count && ms < window.buckets[window.count - 1].endMs) counts[index] += 1;
	}

	return counts;
}

/**
 * 取某个项目在当前窗口内的曲线。
 * mode 为 cumulative 时逐周/逐桶累加 —— 只累加窗口内的提交，
 * 所以它描述的是「这段时间里的势头」，而不是项目历史总量。
 */
export function windowValues(repo, window, mode = DEFAULT_MODE_ID) {
	const raw =
		window.kind === 'weeks'
			? repo.weekly.slice(window.startIndex, window.startIndex + window.count)
			: countBuckets(Array.isArray(repo.recent) ? repo.recent : [], window);

	if (mode !== 'cumulative') return raw;

	let sum = 0;
	return raw.map((value) => {
		sum += value;
		return sum;
	});
}

/** 窗口内的提交总数（不累计） */
export function windowTotal(repo, window) {
	if (window.kind === 'weeks') {
		return repo.weekly.slice(window.startIndex, window.startIndex + window.count).reduce((sum, value) => sum + value, 0);
	}
	return countBuckets(Array.isArray(repo.recent) ? repo.recent : [], window).reduce((sum, value) => sum + value, 0);
}

/**
 * 默认勾选哪些项目。
 *
 * 规则：当前窗口内有提交的项目按「最近推送」排序，最多取 limit 个。
 * 全是 0 的仓库（fork 里的上游提交不计入 owner 序列，老站点也没再动过）
 * 默认不画 —— 否则图底会压着一堆互相比平的零线。
 */
export function defaultActiveNames(stats, { range = DEFAULT_RANGE_ID, limit = 8 } = {}) {
	const window = windowFor(stats, range);
	return stats.repos
		.filter((repo) => windowTotal(repo, window) > 0)
		.slice(0, limit)
		.map((repo) => repo.name);
}

/** 汇总当前选择下的一组数字，供指标条与说明行使用 */
export function summarize(stats, { names = [], range = DEFAULT_RANGE_ID } = {}) {
	const window = windowFor(stats, range);
	const picked = stats.repos.filter((repo) => names.includes(repo.name));

	let commits = 0;
	let activeRepos = 0;
	let peakValue = 0;
	let peakIndex = 0;
	const perBucket = new Array(window.count).fill(0);

	for (const repo of picked) {
		const values = windowValues(repo, window);
		let touched = 0;
		values.forEach((value, index) => {
			perBucket[index] += value;
			if (value > 0) touched += 1;
		});
		commits += values.reduce((sum, value) => sum + value, 0);
		if (touched > 0) activeRepos += 1;
	}

	perBucket.forEach((value, index) => {
		if (value > peakValue) {
			peakValue = value;
			peakIndex = index;
		}
	});

	return {
		commits,
		activeRepos,
		repos: picked.length,
		bucketLabel: window.bucketLabel,
		activeLabel: window.activeLabel,
		peakLabel: window.peakLabel,
		count: window.count,
		peak: peakValue ? { span: window.buckets[peakIndex]?.span ?? '', tick: window.buckets[peakIndex]?.tick ?? '', value: peakValue } : null,
		windowLabel: window.label,
	};
}

/* -------------------------------------------------------------- 小工具 */

const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 所有来自 GitHub 的文本（仓库名、描述、语言）都必须先过这一层 */
export function escapeHtml(value) {
	return String(value ?? '').replace(/[&<>"']/g, (char) => escapeMap[char]);
}

/**
 * 曲线配色：够用 10 个项目，且在深浅两种主题下都有足够对比度。
 * 按项目在快照里的下标取色，所以勾选/取消勾选不会让别的线换颜色。
 */
const COLORS = [
	'#3b82f6',
	'#f97316',
	'#10b981',
	'#a855f7',
	'#ef4444',
	'#eab308',
	'#06b6d4',
	'#ec4899',
	'#84cc16',
	'#8b5cf6',
];

export function chartColor(index) {
	return COLORS[((index % COLORS.length) + COLORS.length) % COLORS.length];
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / YYYY-MM-DD */
export function formatRelative(iso, now = new Date()) {
	if (!iso) return '未知';
	const then = new Date(iso);
	if (Number.isNaN(then.getTime())) return '未知';

	const diff = now.getTime() - then.getTime();
	if (diff < 60_000) return '刚刚';
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
	if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
	return then.toISOString().slice(0, 10);
}

/** 快照时间：2026-10-03 13:56（UTC） */
export function formatSnapshotTime(iso) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '未知时间';
	return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}（UTC）`;
}

/* ------------------------------------------------------------------ 图表 */

/** 画布默认尺寸（CSS 像素）；viewBox 与实际宽度一致，文字才不会被缩放糊掉 */
const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 400;

/** 把最大刻度凑成 1 / 2 / 5 × 10ⁿ，避免出现 37 这种刻度 */
function niceStep(raw) {
	if (!(raw > 0)) return 1;
	const power = 10 ** Math.floor(Math.log10(raw));
	const normalized = raw / power;
	const factor = normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10;
	return factor * power;
}

/**
 * 绘图区几何。
 *
 * 抽出来是为了让页面脚本的悬停反查（鼠标 x → 第几个桶）与画图用**同一套**坐标，
 * 否则两边各写一份 pad，一改窄屏布局就会错位。
 */
export function chartLayout(width, height) {
	// 窄屏把留给 y 轴刻度的宽度收一点，否则绘图区会被挤掉一大块
	const pad = {
		top: 18,
		right: width < 620 ? 10 : 18,
		bottom: 34,
		left: width < 620 ? 34 : 46,
	};

	return { width, height, pad, plotW: width - pad.left - pad.right, plotH: height - pad.top - pad.bottom };
}

/** 纵轴刻度：把最大值凑成 1 / 2 / 5 × 10ⁿ 的整数刻度 */
export function niceScale(rawMax) {
	const step = niceStep(rawMax / 4);
	const maxY = Math.max(step, Math.ceil(rawMax / step) * step);
	return { step, maxY, ticks: Math.round(maxY / step) };
}

/** 由横坐标反推最近的桶下标（悬停用） */
export function indexAtX(frame, count, x) {
	if (count <= 1) return 0;
	const ratio = (x - frame.pad.left) / frame.plotW;
	return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
}

/**
 * 画出折线图。
 *
 * @param {object} stats 快照（含 weeks / repos）
 * @param {{ names?: string[], range?: string, mode?: string, width?: number, height?: number }} options
 */
export function renderChart(stats, options = {}) {
	const { names = [], range = DEFAULT_RANGE_ID, mode = DEFAULT_MODE_ID } = options;
	const width = Math.max(320, Math.round(options.width ?? DEFAULT_WIDTH));
	const height = Math.max(240, Math.round(options.height ?? DEFAULT_HEIGHT));

	const frame = chartLayout(width, height);
	const { pad, plotW, plotH } = frame;

	const window = windowFor(stats, range);
	const { count, buckets } = window;

	const series = names
		.map((name) => {
			const index = stats.repos.findIndex((repo) => repo.name === name);
			if (index < 0) return null;
			return {
				name,
				color: chartColor(index),
				values: windowValues(stats.repos[index], window, mode),
			};
		})
		.filter(Boolean);

	const rawMax = series.reduce((max, item) => Math.max(max, ...item.values), 0);
	const { step, maxY, ticks } = niceScale(rawMax);

	const xAt = (index) => (count <= 1 ? pad.left + plotW / 2 : pad.left + (plotW * index) / (count - 1));
	const yAt = (value) => pad.top + plotH * (1 - value / maxY);

	const parts = [];
	const labelStyle = 'fill:var(--text-tertiary);font-size:11px;font-variant-numeric:tabular-nums';

	parts.push(
		`<svg class="cc-svg" viewBox="0 0 ${width} ${height}" role="img" style="width:100%;height:auto;display:block" aria-label="${escapeHtml(
			`项目提交折线图，${names.length} 个项目，窗口 ${window.label}`,
		)}">`,
	);

	/* 横向网格与 y 轴刻度 */
	parts.push('<g class="cc-grid">');
	for (let tick = 0; tick <= ticks; tick += 1) {
		const value = tick * step;
		const y = yAt(value);
		parts.push(
			`<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${(width - pad.right).toFixed(1)}" y2="${y.toFixed(1)}" style="stroke:var(--stroke);stroke-width:1" />`,
		);
		parts.push(
			`<text x="${pad.left - 8}" y="${y.toFixed(1)}" text-anchor="end" dy="0.32em" style="${labelStyle}">${value}</text>`,
		);
	}
	parts.push('</g>');

	/* 透明命中区：保证整个绘图区都能触发悬停（曲线之外也是） */
	parts.push(
		`<rect class="cc-surface" x="${pad.left}" y="${pad.top}" width="${plotW.toFixed(1)}" height="${plotH.toFixed(1)}" fill="transparent" />`,
	);

	/* x 轴：约 7 个刻度，从最近一格往回取，末尾那个一定会有标签 */
	parts.push('<g class="cc-xaxis">');
	const every = Math.max(1, Math.ceil(count / 7));
	const labelIndexes = [];
	for (let index = count - 1; index >= 0; index -= every) labelIndexes.push(index);
	for (const index of labelIndexes) {
		const anchor = index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle';
		parts.push(
			`<text x="${xAt(index).toFixed(1)}" y="${height - 12}" text-anchor="${anchor}" style="${labelStyle}">${escapeHtml(
				buckets[index]?.tick ?? '',
			)}</text>`,
		);
	}
	parts.push('</g>');

	/* 每个项目一条折线；零值点不画圆点，免得满屏都是标记 */
	parts.push('<g class="cc-series">');
	for (const item of series) {
		const points = item.values.map((value, index) => `${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`);
		const dots = item.values
			.map((value, index) =>
				value > 0
					? `<circle cx="${xAt(index).toFixed(1)}" cy="${yAt(value).toFixed(1)}" r="1.7" fill="${item.color}" />`
					: '',
			)
			.join('');

		parts.push(
			`<g data-cc-series="${escapeHtml(item.name)}">` +
				`<path d="M${points.join(' L')}" fill="none" stroke="${item.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />` +
				`${dots}` +
				`</g>`,
		);
	}
	parts.push('</g>');

	/* 悬停指示线：由页面脚本改 x 与透明度，初始隐藏 */
	parts.push(
		`<line class="cc-crosshair" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${(pad.top + plotH).toFixed(1)}" style="stroke:var(--text-tertiary);stroke-width:1;stroke-dasharray:4 4;opacity:0" />`,
	);

	/* 悬停时高亮当桶的点，位置同样由脚本填 */
	parts.push('<g class="cc-hover" style="pointer-events:none"></g>');

	parts.push('</svg>');

	return parts.join('');
}

/* ------------------------------------------------------------------ 图例 */

/**
 * 图例即开关：点一下显示/隐藏对应曲线。
 * 用 <button aria-pressed> 而不是自己搓 checkbox，键盘与读屏都能直接操作。
 */
export function renderLegend(stats, { names = [], range = DEFAULT_RANGE_ID } = {}) {
	const window = windowFor(stats, range);

	return stats.repos
		.slice()
		.sort((a, b) => String(b.pushedAt ?? '').localeCompare(String(a.pushedAt ?? '')))
		.map((repo) => {
			const index = stats.repos.findIndex((item) => item.name === repo.name);
			const on = names.includes(repo.name);
			const total = windowTotal(repo, window);

			return (
				`<button type="button" class="cc-legend__item${on ? ' is-on' : ''}" data-cc-repo="${escapeHtml(repo.name)}" aria-pressed="${on ? 'true' : 'false'}" title="${escapeHtml(
					repo.description || repo.fullName,
				)}">` +
				`<span class="cc-legend__dot" style="--cc-color:${chartColor(index)}"></span>` +
				`<span class="cc-legend__name">${escapeHtml(repo.name)}</span>` +
				`<span class="cc-legend__count">${total}</span>` +
				`</button>`
			);
		})
		.join('');
}

/* ---------------------------------------------------------------- 明细表 */

/** 图表下方的项目清单：数字版的同一份数据，也是无 JS 时的兜底 */
export function renderRepoRows(stats, { names = [], range = DEFAULT_RANGE_ID } = {}) {
	const window = windowFor(stats, range);

	return stats.repos
		.slice()
		.sort((a, b) => String(b.pushedAt ?? '').localeCompare(String(a.pushedAt ?? '')))
		.map((repo) => {
			const values = windowValues(repo, window);
			const total = values.reduce((sum, value) => sum + value, 0);
			const activeBuckets = values.filter((value) => value > 0).length;
			const on = names.includes(repo.name);

			const badges = [
				repo.fork ? '<span class="cc-badge">fork</span>' : '',
				repo.archived ? '<span class="cc-badge">已归档</span>' : '',
				repo.noStats ? '<span class="cc-badge">暂无统计</span>' : '',
			].join('');

			return (
				`<tr class="${on ? 'is-active' : ''}" data-cc-repo="${escapeHtml(repo.name)}">` +
				`<td class="cc-table__name">` +
				`<a href="${escapeHtml(repo.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(repo.name)}</a>` +
				`${badges}` +
				(repo.description ? `<span class="cc-table__desc">${escapeHtml(repo.description)}</span>` : '') +
				`</td>` +
				`<td>${repo.language ? escapeHtml(repo.language) : '<span class="cc-dim">—</span>'}</td>` +
				`<td class="cc-num">${total}</td>` +
				`<td class="cc-num">${activeBuckets}</td>` +
				`<td>${escapeHtml(repo.pushedAt ? repo.pushedAt.slice(0, 10) : '—')}</td>` +
				`<td class="cc-num">${repo.stars}</td>` +
				`</tr>`
			);
		})
		.join('');
}
