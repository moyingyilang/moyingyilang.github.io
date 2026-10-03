/**
 * GitHub 提交统计采集（本站唯一的数据入口）
 *
 * 同一份实现被三处调用，所以这里**只用 fetch 与纯 JS**，不 import 任何 node 内置模块：
 *   1. scripts/gen-commit-stats.mjs —— 生成随仓库提交的静态快照 src/data/commit-stats.json
 *   2. .github/workflows/refresh-commits.yml —— 定时在 Actions 里重跑上面这个脚本
 *   3. src/pages/activity.astro 里内联的脚本 —— 访客点「抓取最新」时在自己的浏览器里拉一次
 *
 * 数据源有两个：
 *   - `/repos/{owner}/{repo}/stats/participation`：52 个周桶，`owner` 序列只统计拥有者本人的提交（长期窗口用）
 *   - `/repos/{owner}/{repo}/commits?author=…`：逐条提交时间戳（近期窗口切小时桶用）
 *
 * ── 关于配额（匿名 60 次/小时/IP）────────────────────────────────────
 * 做了四件事把请求数压到最低：
 *   1. 条件请求：缓存每个 URL 的 ETag，下次带 `If-None-Match`。
 *      GitHub 对 304 的响应**不计入速率限制**，数据没变时一次刷新几乎不花配额。
 *   2. 复用上一份快照：命中 304 时直接用旧快照里对应的那段数据，不必再存一份响应体。
 *   3. 按推送时间跳过：没在统计窗口内推送过的仓库不可能有窗口内的提交，直接不问。
 *   4. 翻页上限：提交明细分页最多 2 页（200 条），两周内正常不会超过。
 * 想彻底绕开访客配额，就跑定时刷新（见 refresh-commits.yml，那里用的是 1000 次/小时的 GITHUB_TOKEN）。
 */

/** 被统计的 GitHub 用户 */
export const STATS_USER = 'moyingyilang';

/**
 * 统计窗口长度（周）。
 * GitHub 的 participation 接口固定给 52 周，调大也拿不到更多，这里只作为默认值。
 */
export const WINDOW_WEEKS = 52;

/**
 * 采集多少天的「逐条提交明细」。
 *
 * 周桶画不出「近 12 小时」这种窗口，所以另外把提交时间戳抓下来。
 * 14 天足够覆盖最长的近期窗口（7 天）并留出一倍余量 ——
 * 页面上的窗口是以快照时间为锚点的，快照放几天也还在覆盖范围内。
 */
export const RECENT_DAYS = 14;

const API_ROOT = 'https://api.github.com';

/**
 * GitHub 要求带 User-Agent，否则直接 403。
 * 用站点域名而不是 node/浏览器默认值，万一要排查请求也认得出是谁发的。
 */
const USER_AGENT = 'moyingyilang.github.io-commit-chart';

/** 收到 202 时的轮询次数与间隔（GitHub 现算统计通常几秒内完成） */
const PENDING_RETRIES = 6;
const PENDING_DELAY_MS = 1500;

/** 提交明细分页上限：2 页 = 200 条，14 天窗口正常够用 */
const RECENT_MAX_PAGES = 2;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * 304 的哨兵值。
 *
 * 用符号而不是 null：null 在这里表示「接口确实没有数据」（空仓库、统计未就绪），
 * 两者语义完全不同 —— 一个要复用旧数据，一个要按 0 处理。
 */
export const NOT_MODIFIED = Symbol('not-modified');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**

 * 请求头。
 *
 * token **必须由调用方显式传入**，这里刻意不去读 globalThis / process.env：
 * 页面上的「抓取最新」是跑在访客浏览器里的，一旦模块自己会去翻环境变量，
 * 将来某次打包把令牌内联进前端就成了静默事故。改为显式传参后，
 * 前端那条路径**结构上就不可能**带上凭据（它压根不传这个参数）。
 *
 * 令牌只用于本机脚本与 GitHub Actions：
 *   - 本机：`GITHUB_TOKEN=xxx pnpm refresh:commits`（或写进 .env，已在 .gitignore 里）
 *   - Actions：`secrets.GITHUB_TOKEN`（1000 次/时/仓库）或自定义 secret（5000 次/时）
 */
function authHeaders(token) {
	const headers = {
		Accept: 'application/vnd.github+json',
		'User-Agent': USER_AGENT,
	};

	if (token) headers.Authorization = `Bearer ${token}`;

	return headers;
}

/**
 * ETag 缓存。
 *
 * 只存「URL → ETag」这么一张小表（几十条、几 KB），**不存响应体** ——
 * 命中 304 时由调用方从上一份快照里取对应数据。
 * 浏览器里落 localStorage，node 里（没有 localStorage）退化成内存表。
 */
export function createEtagCache(storage = globalThis.localStorage) {
	const KEY = 'moying-commit-etags';
	const MAX_ENTRIES = 80;

	let entries = new Map();
	try {
		const raw = storage?.getItem(KEY);
		if (raw) entries = new Map(Object.entries(JSON.parse(raw)));
	} catch {
		entries = new Map();
	}

	return {
		get(url) {
			return entries.get(url) ?? null;
		},
		set(url, etag) {
			if (!etag) return;
			entries.delete(url); // 重新插入以保证 Map 的顺序即「最近使用时间」
			entries.set(url, etag);
		},
		flush() {
			if (!storage) return;
			try {
				const trimmed = [...entries].slice(-MAX_ENTRIES);
				storage.setItem(KEY, JSON.stringify(Object.fromEntries(trimmed)));
			} catch {
				/* 隐私模式或写满时忽略：缓存丢了只是下次多花一次配额 */
			}
		},
	};
}

/** 从响应头里读配额信息，供调用方提示「本次花了多少」 */
function readQuota(response) {
	const remaining = Number(response.headers.get('x-ratelimit-remaining'));
	if (!Number.isFinite(remaining)) return null;

	return {
		limit: Number(response.headers.get('x-ratelimit-limit')) || null,
		remaining,
		reset: Number(response.headers.get('x-ratelimit-reset')) * 1000 || null,
	};
}

/** 把失败响应翻译成能直接显示给访客的一句话 */
async function describeFailure(response) {
	let detail = '';
	try {
		const body = await response.json();
		if (body && typeof body.message === 'string') detail = body.message;
	} catch {
		/* 响应体不是 JSON（例如网关错误页），忽略 */
	}

	const remaining = response.headers.get('x-ratelimit-remaining');
	if ((response.status === 403 || response.status === 429) && remaining === '0') {
		const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
		const minutes = Number.isFinite(reset) ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : 0;
		return `GitHub 接口配额已用尽${minutes ? `，约 ${minutes} 分钟后重置` : ''}`;
	}

	return `GitHub 返回 ${response.status}${detail ? `：${detail}` : ''}`;
}

/**
 * 取一份 JSON。
 *
 * - 命中 ETag（304）时返回 NOT_MODIFIED，由调用方复用旧数据；304 不扣配额
 * - 202（统计未就绪）会按 PENDING_DELAY_MS 轮询，直到成功或超出重试次数
 * - 204（空仓库）与最终仍是 202 的情况返回 null，交由调用方按「没有数据」处理
 */
async function requestJson(url, { fetchImpl = fetch, retryPending = false, cache, onQuota, token } = {}) {
	for (let attempt = 0; ; attempt += 1) {
		const headers = authHeaders(token);
		const etag = cache?.get(url);
		if (etag) headers['If-None-Match'] = etag;

		const response = await fetchImpl(url, { headers });
		onQuota?.(readQuota(response));

		if (response.status === 304) return NOT_MODIFIED;

		if (response.status === 202 && retryPending && attempt < PENDING_RETRIES) {
			await sleep(PENDING_DELAY_MS);
			continue;
		}

		if (response.status === 202 || response.status === 204) return null;
		if (!response.ok) throw new Error(await describeFailure(response));

		const data = await response.json();
		cache?.set(url, response.headers.get('etag'));
		return data;
	}
}

/**
 * 列出该用户的公开仓库。
 * 按 pushed 倒序，所以「最近更新」的项目天然排在前面；100 条足够覆盖个人账号。
 */
export async function fetchUserRepos(user = STATS_USER, options = {}) {
	const url = `${API_ROOT}/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed&direction=desc`;
	const repos = await requestJson(url, options);

	if (repos === NOT_MODIFIED) return NOT_MODIFIED;
	if (!Array.isArray(repos)) throw new Error('GitHub 返回的仓库列表不是数组');

	return repos.filter((repo) => repo && typeof repo.name === 'string' && !repo.disabled);
}

/** 某个仓库的 52 周参与度统计；空仓库或统计不可用时返回 null */
export async function fetchParticipation(fullName, options = {}) {
	const url = `${API_ROOT}/repos/${fullName}/stats/participation`;
	return requestJson(url, { ...options, retryPending: true });
}

/**
 * 取近期的逐条提交时间戳。
 *
 * 为什么不能只靠 participation：那里只有 52 个周桶，小时级窗口无从切起。
 * 这里按 author 过滤，与 owner 序列同一口径（只算仓库拥有者本人的提交）。
 * 一页最多 100 条，活跃期需要翻页；上限 RECENT_MAX_PAGES 页，避免个别仓库把配额吃光。
 */
export async function fetchRecentCommits(
	fullName,
	user,
	{ since, fetchImpl = fetch, cache, onQuota, token, maxPages = RECENT_MAX_PAGES } = {},
) {
	const stamps = [];
	let firstPage = true;

	for (let page = 1; page <= maxPages; page += 1) {
		const url =
			`${API_ROOT}/repos/${fullName}/commits?author=${encodeURIComponent(user)}` +
			`&since=${encodeURIComponent(since)}&per_page=100&page=${page}`;

		const commits = await requestJson(url, { fetchImpl, cache, onQuota, token });

		// 第一页就 304，说明这个仓库近期没有新提交，直接用上一份快照里的明细
		if (commits === NOT_MODIFIED && firstPage) return NOT_MODIFIED;
		if (!Array.isArray(commits) || !commits.length) break;

		for (const item of commits) {
			// committer 日期 = 真正落到分支上的时间；rebase / cherry-pick 后才符合直觉
			const stamp = item?.commit?.committer?.date ?? item?.commit?.author?.date;
			if (typeof stamp === 'string') stamps.push(stamp);
		}

		firstPage = false;
		if (commits.length < 100) break;
	}

	// GitHub 按时间倒序返回，落盘时按正序排一遍，JSON 读起来才顺
	return stamps.sort();
}

/** 某个时刻所在周的周日 00:00（UTC）—— 与 GitHub 的周桶边界一致 */
function startOfWeekUTC(date) {
	const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	day.setUTCDate(day.getUTCDate() - day.getUTCDay());
	return day;
}

/**
 * 生成窗口内每一周的起点（周日，YYYY-MM-DD），最早的在前。
 *
 * 之所以把周起点固化进快照，而不是只存一串数字：
 * 快照可能是几个月前生成的，有了真实日期，旧快照的图表**标注依然是准确的**，
 * 不会把「52 周前」错标成今天。
 */
export function weekStarts(count = WINDOW_WEEKS, now = new Date()) {
	const current = startOfWeekUTC(now);
	const out = [];
	for (let i = count - 1; i >= 0; i -= 1) {
		out.push(new Date(current.getTime() - i * 7 * DAY_MS).toISOString().slice(0, 10));
	}
	return out;
}

/**
 * 把接口返回的序列对齐到 weeks 上。
 *
 * 正常情况下长度就是 52，直接对应；万一 GitHub 改了窗口长度，
 * 这里按**右对齐**（最近的一周永远在最后）补零，避免整条曲线错位。
 */
function alignWeeks(owner, weeks) {
	const values = Array.isArray(owner) ? owner : [];
	return weeks.map((_, index) => {
		const source = values.length - weeks.length + index;
		const value = source >= 0 ? values[source] : 0;
		return Number.isFinite(value) && value > 0 ? value : 0;
	});
}

/** 把快照里的仓库还原成 GitHub 返回的字段形状，供 304 时复用 */
function restoreRepoShape(repo) {
	return {
		name: repo.name,
		full_name: repo.fullName,
		html_url: repo.url,
		homepage: repo.homepage,
		description: repo.description,
		language: repo.language,
		stargazers_count: repo.stars,
		forks_count: repo.forks,
		fork: repo.fork,
		archived: repo.archived,
		created_at: repo.createdAt,
		pushed_at: repo.pushedAt,
	};
}

function normalizeRepo(repo, participation, weeks, { recent, recentFailed, statsOmitted }) {
	return {
		name: repo.name,
		fullName: repo.full_name,
		url: repo.html_url,
		homepage: repo.homepage || null,
		description: repo.description || '',
		language: repo.language || null,
		stars: repo.stargazers_count ?? 0,
		forks: repo.forks_count ?? 0,
		fork: Boolean(repo.fork),
		archived: Boolean(repo.archived),
		createdAt: repo.created_at,
		pushedAt: repo.pushed_at,
		/**
		 * 统计接口没给出数据时为 true，图表按 0 处理。
		 * statsOmitted 是另一回事：仓库久未推送，压根没问（它的窗口内提交必然是 0，不是缺数据）。
		 */
		noStats: !participation && !statsOmitted,
		/** 近期明细没取到（而不是「确实没有提交」）时为 true，明细表会标注出来 */
		noRecent: Boolean(recentFailed),
		weekly: alignWeeks(participation?.owner, weeks),
		/** 近 RECENT_DAYS 天的提交时间戳，供小时级窗口切桶 */
		recent: recent ?? [],
	};
}

/**
 * 采集完整快照。
 *
 * 单个仓库的统计取不到（超时、空仓库、限额）不会中断整轮采集 ——
 * 宁可少一条曲线，也不要让访客点一次刷新就整页失败。
 *
 * @param {string} user GitHub 用户名
 * @param {{
 *   token?: string,
 *   onProgress?: (message: string) => void,
 *   onQuota?: (quota: { limit: number|null, remaining: number, reset: number|null } | null) => void,
 *   fetchImpl?: typeof fetch,
 *   cache?: ReturnType<typeof createEtagCache>,
 *   previous?: object,
 *   metrics?: { requests?: number, notModified?: number },
 * }} [options]
 *   previous 传上一份快照：命中 304 时从中取对应数据，省掉一次请求也省掉一份缓存。
 *   metrics 会被就地填上本次的网络开销（请求数、304 数），供调用方展示。
 *   token 只应由本机脚本 / Actions 传入；浏览器端不要传（见 authHeaders 的说明）。
 */
export async function collectCommitStats(user = STATS_USER, options = {}) {
	const { onProgress, onQuota, fetchImpl = fetch, cache, previous, metrics, token } = options;

	const run = { requests: 0, notModified: 0 };
	if (metrics) Object.assign(metrics, run);

	const countingFetch = (...args) => {
		run.requests += 1;
		if (metrics) metrics.requests = run.requests;
		return fetchImpl(...args);
	};

	const handleQuota = (quota) => {
		if (quota) onQuota?.(quota);
	};

	const repos = await fetchUserRepos(user, { fetchImpl: countingFetch, cache, onQuota: handleQuota, token });

	let repoList = repos;
	if (repos === NOT_MODIFIED) {
		run.notModified += 1;
		if (metrics) metrics.notModified = run.notModified;
		if (!previous?.repos?.length) throw new Error('仓库列表没有变化，但本地没有可复用的快照');
		repoList = previous.repos.map(restoreRepoShape);
	}
	if (!Array.isArray(repoList) || !repoList.length) throw new Error('没有取到任何仓库');

	// 当前这一周的周桶网格；只有当旧快照用的是同一套网格时，才能复用它的 weekly 数组
	const weeks = weekStarts(WINDOW_WEEKS);
	const currentWeek = weeks[weeks.length - 1];
	const sameGrid = previous?.weeks?.length === WINDOW_WEEKS && previous.weeks[previous.weeks.length - 1] === currentWeek;

	const recentSince = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString();
	const staleCutoff = Date.now() - WINDOW_WEEKS * 7 * DAY_MS;

	onProgress?.(`共 ${repoList.length} 个仓库，正在读取提交统计……`);

	const collected = [];
	for (let index = 0; index < repoList.length; index += 1) {
		const repo = repoList[index];
		const previousRepo = previous?.repos?.find((item) => item.fullName === repo.full_name);
		onProgress?.(`读取 ${repo.name}（${index + 1}/${repoList.length}）`);

		/*
		 * 52 周内没推送过的仓库，窗口内提交必然是 0：
		 * 提交的 committer 时间不会晚于推送时间。个人账号里这类仓库占一半，别浪费配额。
		 */
		const statsOmitted = !repo.pushed_at || Date.parse(repo.pushed_at) < staleCutoff;

		let participation = null;
		if (!statsOmitted) {
			let result = await fetchParticipation(repo.full_name, {
				fetchImpl: countingFetch,
				cache,
				onQuota: handleQuota,
				token,
			});

			if (result === NOT_MODIFIED) {
				run.notModified += 1;
				if (metrics) metrics.notModified = run.notModified;

				if (previousRepo && sameGrid) {
					// 网格一致，直接沿用旧快照的周数据（它已经是 owner 序列对齐后的结果）
					participation = { owner: previousRepo.weekly };
				} else {
					// 跨了周（周桶网格已经平移）或本地没有旧数据：这次 304 用不上，去掉 ETag 强制取一次
					result = await fetchParticipation(repo.full_name, {
						fetchImpl: countingFetch,
						cache: null,
						onQuota: handleQuota,
						token,
					});
				}
			}

			if (participation === null && result !== NOT_MODIFIED) participation = result;
		}

		/*
		 * 近期明细同理：推送时间早于窗口起点的仓库不可能有窗口内的提交。
		 * 明细与周桶网格无关（纯时间戳），304 时可以无条件复用。
		 */
		let recent = [];
		let recentFailed = false;
		const needsRecent = repo.pushed_at && Date.parse(repo.pushed_at) >= Date.parse(recentSince);

		if (needsRecent) {
			try {
				const result = await fetchRecentCommits(repo.full_name, user, {
					since: recentSince,
					fetchImpl: countingFetch,
					cache,
					onQuota: handleQuota,
					token,
				});

				if (result === NOT_MODIFIED) {
					run.notModified += 1;
					if (metrics) metrics.notModified = run.notModified;
					recent = previousRepo?.recent ?? [];
				} else if (Array.isArray(result)) {
					recent = result;
				}
			} catch {
				recent = [];
				recentFailed = true;
			}
		}

		collected.push(normalizeRepo(repo, participation, weeks, { recent, recentFailed, statsOmitted }));
	}

	cache?.flush();

	/*
	 * 一次请求都没拿到新数据（全 304）时保留旧时间戳。
	 * 页面的近期窗口以快照时间为锚点，锚点无意义地往后跳会让曲线看起来「凭空左移」。
	 */
	const gotFreshData = run.notModified < run.requests;
	const generatedAt =
		gotFreshData || !previous?.generatedAt ? new Date().toISOString() : previous.generatedAt;

	return {
		user,
		generatedAt,
		weeks,
		recentSince: gotFreshData ? recentSince : (previous?.recentSince ?? recentSince),
		repos: collected,
	};
}
