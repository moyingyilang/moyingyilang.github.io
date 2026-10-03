#!/usr/bin/env node
/**
 * 生成 GitHub 提交统计快照（src/data/commit-stats.json）
 *
 * 为什么要落成文件而不是让页面运行期直接拉：
 * 站点是纯静态托管，构建时没有任何后端可依赖。快照随仓库提交后，
 * 访客打开 /activity 立刻就有图看，不消耗任何 GitHub 配额、也不暴露自己的 IP。
 *
 * ── 令牌（可选，但强烈建议给）──────────────────────────────────────
 * 匿名调用只有 60 次/小时/IP，带上令牌是 5000 次/小时。
 * 令牌**只从环境变量读**，不会写进任何生成物：
 *
 *     GITHUB_TOKEN=ghp_xxx pnpm refresh:commits     # 临时给
 *     printf 'GITHUB_TOKEN=ghp_xxx\n' > .env        # 或写进 .env（已在 .gitignore 里）
 *
 * ⚠️ 不要把令牌写进这个脚本、package.json 或任何会被提交的文件。
 *    公开仓库一旦推上去，GitHub 的密钥扫描会直接吊销它，而且历史里会留下痕迹。
 *
 * 采集逻辑与页面上「抓取最新」按钮共用 src/utils/github-stats.js，口径完全一致；
 * 区别只是这里能拿到令牌，以及这里会把结果写盘。
 *
 * 用法：
 *   node scripts/gen-commit-stats.mjs                 # 匿名（够一次采集，别连着跑）
 *   GITHUB_TOKEN=xxx node scripts/gen-commit-stats.mjs
 *   node scripts/gen-commit-stats.mjs --user someone --out /tmp/x.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RECENT_DAYS, STATS_USER, collectCommitStats } from '../src/utils/github-stats.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'src', 'data', 'commit-stats.json');

/** 极简 .env 读取：只为 GITHUB_TOKEN 一个变量，不引入 dotenv 依赖；已存在的环境变量优先 */
function loadDotEnv() {
	for (const file of ['.env.local', '.env']) {
		const path = resolve(ROOT, file);
		if (!existsSync(path)) continue;

		for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
			const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
			if (!match || line.trim().startsWith('#')) continue;
			const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
			if (!process.env[match[1]]) process.env[match[1]] = value;
		}
	}
}

function readArg(name, fallback) {
	const index = process.argv.indexOf(`--${name}`);
	return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

loadDotEnv();

const user = readArg('user', STATS_USER);
const out = resolve(readArg('out', OUT));
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

console.log(`› 采集 ${user} 的公开仓库提交统计……`);
console.log(
	token
		? '  已带 GITHUB_TOKEN（配额 5000 次/小时）'
		: '  未提供 GITHUB_TOKEN，按匿名配额请求（60 次/小时，够一轮采集）',
);

/** 读上一份快照：既用于「数据没变就别写盘」，也给采集器复用 304 的兜底 */
function readPrevious() {
	if (!existsSync(out)) return null;
	try {
		return JSON.parse(readFileSync(out, 'utf8'));
	} catch {
		return null;
	}
}

const previous = readPrevious();

/** 比较时忽略时间戳：它们每轮都会变，但不算「数据变了」 */
function comparable(snapshot) {
	return JSON.stringify({ ...snapshot, generatedAt: '', recentSince: '' });
}

const metrics = {};
const quota = { current: null };

const stats = await collectCommitStats(user, {
	token: token || undefined,
	previous,
	metrics,
	onQuota: (next) => {
		quota.current = next;
	},
	onProgress: (message) => console.log(`  ${message}`),
});

const withStats = stats.repos.filter((repo) => !repo.noStats);
const total = stats.repos.reduce(
	(sum, repo) => sum + repo.weekly.reduce((acc, value) => acc + value, 0),
	0,
);
const details = stats.repos.reduce((sum, repo) => sum + (repo.recent?.length ?? 0), 0);
const noDetail = stats.repos.filter((repo) => repo.noRecent);

// 一个仓库的数据都没拿到，多半是断网或配额用尽：保留旧快照，别把好数据覆盖成一张空图
if (!stats.repos.length || !withStats.length) {
	console.error('✗ 没有取到任何提交统计，保留原有快照不动');
	process.exit(1);
}

if (noDetail.length) {
	// 近期窗口靠这些明细，缺了就得重跑一次，所以单独提醒
	console.warn(`  ⚠ 这几个仓库没取到近期明细：${noDetail.map((repo) => repo.name).join(', ')}`);
}

const requests = metrics.requests ?? 0;
const notModified = metrics.notModified ?? 0;
console.log(`  请求 ${requests} 次${notModified ? `（其中 ${notModified} 次命中 304，不计配额）` : ''}`);
if (quota.current?.limit) {
	console.log(`  本轮结束时配额余 ${quota.current.remaining}/${quota.current.limit}`);
}

if (previous && comparable(stats) === comparable(previous)) {
	// 数据一个字都没变：保持原文件，免得定时任务天天产生只有时间戳的提交
	console.log('✓ 与上一份快照一致，保持原文件不写盘');
} else {
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(stats, null, '\t')}\n`);
	console.log(`✓ ${out}`);
}

console.log(
	`  ${stats.repos.length} 个仓库、近 ${stats.weeks.length} 周共 ${total} 次提交` +
		`，窗口 ${stats.weeks[0]} ~ ${stats.weeks.at(-1)}`,
);
console.log(`  近 ${RECENT_DAYS} 天提交明细 ${details} 条（供 12 小时 ~ 7 天窗口切桶）`);
