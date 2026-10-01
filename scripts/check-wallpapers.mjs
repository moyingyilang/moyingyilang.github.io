#!/usr/bin/env node
/**
 * 检测壁纸图集的图片直链是否失效
 *
 * 游戏图集来自第三方 CDN，链接会随时间腐坏（仓库改名、文件删除、CDN 抽风）。
 * 建议定期跑一次，例如每月一次或接到定时 CI 里。
 *
 * 用法：
 *   pnpm run check:wallpapers                     # 全量检查
 *   pnpm run check:wallpapers -- --sample 30      # 每个图集抽 30 条
 *   pnpm run check:wallpapers -- --concurrency 12 # 调并发（默认 8）
 *   pnpm run check:wallpapers -- --timeout 30000  # 超时毫秒（默认 20000）
 *
 * 退出码非 0 表示有失效链接；此时重新运行 `pnpm run refresh:wallpapers`
 * 会从仓库重新枚举文件名并覆盖清单。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 读取 `--flag value` 形式的参数 */
function arg(name, fallback) {
	const i = process.argv.indexOf(`--${name}`);
	const value = i === -1 ? undefined : process.argv[i + 1];
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const sample = arg('sample', 0);
const concurrency = arg('concurrency', 8);
const timeout = arg('timeout', 20000);

const manifestPath = resolve(import.meta.dirname, '..', 'public', 'wallpaper-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/** 只取前 1KB：既能确认可访问，又不必下载整张图 */
async function probe(url) {
	try {
		const response = await fetch(url, {
			headers: { Range: 'bytes=0-1023' },
			signal: AbortSignal.timeout(timeout),
		});
		const type = response.headers.get('content-type') ?? '';
		const ok = (response.status === 200 || response.status === 206) && type.startsWith('image/');
		return { url, ok, status: response.status, type: type || '(无)' };
	} catch (error) {
		const reason = error?.name === 'TimeoutError' ? `超时 >${timeout}ms` : error?.message ?? '未知错误';
		return { url, ok: false, status: 0, type: reason };
	}
}

/** 均匀抽样，保证覆盖整个列表而不是只取开头 */
function take(urls) {
	if (!sample || urls.length <= sample) return urls;
	const step = urls.length / sample;
	return Array.from({ length: sample }, (_, i) => urls[Math.floor(i * step)]);
}

const summary = [];

console.log(`检查清单: ${manifestPath}`);
console.log(`生成时间: ${manifest.generatedAt ?? '未知'}`);

for (const [key, gallery] of Object.entries(manifest.galleries ?? {})) {
	const urls = take(gallery.urls ?? []);
	console.log(`\n${gallery.label}  (${key})`);
	console.log(`  共 ${gallery.urls?.length ?? 0} 条，本次检查 ${urls.length} 条，分辨率 ${gallery.resolution}`);

	const bad = [];
	for (let i = 0; i < urls.length; i += concurrency) {
		const batch = await Promise.all(urls.slice(i, i + concurrency).map(probe));
		for (const result of batch) if (!result.ok) bad.push(result);
	}

	if (bad.length) {
		console.log(`  ✗ 失效 ${bad.length} 条`);
		for (const result of bad.slice(0, 8)) {
			console.log(`      ${result.status} ${result.type}  …${decodeURIComponent(result.url).split('/').pop()}`);
		}
		if (bad.length > 8) console.log(`      …其余 ${bad.length - 8} 条省略`);
	} else {
		console.log('  ✓ 全部可访问');
	}

	summary.push({ key, checked: urls.length, bad: bad.length });
}

const checked = summary.reduce((sum, item) => sum + item.checked, 0);
const failed = summary.reduce((sum, item) => sum + item.bad, 0);

console.log(`\n合计：检查 ${checked} 条，失效 ${failed} 条`);
if (failed) {
	console.log('建议：重新运行 pnpm run refresh:wallpapers 重新枚举文件名。');
	process.exit(1);
}
