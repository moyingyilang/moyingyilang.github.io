#!/usr/bin/env node
/**
 * 生成游戏壁纸图集清单（public/wallpaper-manifest.json）
 *
 * 为什么要这么绕：
 * 这些游戏资源仓库体积远超 jsDelivr 的 50MB 限制，jsDelivr 的**目录列表 API 会返回 403**，
 * 只有单个文件直链可取。所以必须先把真实文件名枚举出来并固化，
 * 运行时才能从清单里随机取图。
 *
 * 为什么不用 GitHub REST API 列目录：
 * 匿名配额只有 60 次/小时，很容易被用尽（实测踩过）。
 * 这里改用 `git clone --filter=blob:none --no-checkout --depth 1`：
 * 只下载 commit/tree 对象、不下载任何文件内容（整个仓库通常 1MB 以内），
 * 然后用 `git ls-tree` 列出文件名，完全不受 API 配额限制。
 *
 * 用法：node scripts/gen-wallpaper-manifest.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 每个图集最多收录多少张，控制清单体积 */
const PER_GALLERY = 100;

/**
 * Wallhaven：通用动漫壁纸，**不对应任何特定游戏或厂商**。
 *
 * 为什么走构建期而不是运行期直连：
 * 它的 API（wallhaven.cc/api）**没有 CORS 头**，浏览器里 fetch 会被拦；
 * 但图片 CDN（w.wallhaven.cc）是 `access-control-allow-origin: *`，
 * 所以做法是构建期把直链枚举进清单、由本站同源托管，运行期照常随机取图。
 *
 * 筛选条件：purity=100 只取 SFW、categories=010 只取动漫，
 * 并按屏幕方向分开成两个图集（ratios + atleast），
 * 这样客户端能按当前方向只用对应的那一组。
 */
const WALLHAVEN = [
	{
		id: 'wallhaven-portrait',
		label: '通用动漫 · 竖屏',
		ratios: 'portrait',
		atleast: '1080x1920',
		resolution: '1080x1920 起',
		note: 'Wallhaven 动漫分区，SFW，按竖屏筛选',
	},
	{
		id: 'wallhaven-landscape',
		label: '通用动漫 · 横屏',
		ratios: 'landscape',
		atleast: '1920x1080',
		resolution: '1920x1080 起',
		note: 'Wallhaven 动漫分区，SFW，按横屏筛选',
	},
];

/** 翻几页；Wallhaven 匿名接口约 45 次/分钟，页数不宜多 */
const WALLHAVEN_PAGES = 6;
/** 单张体积上限，原图动辄 5MB+，做背景太重 */
const WALLHAVEN_MAX_BYTES = 2_500_000;

/** 拉取一个 Wallhaven 图集，返回图片直链 */
async function fetchWallhaven(spec) {
	const urls = [];
	for (let page = 1; page <= WALLHAVEN_PAGES; page += 1) {
		const query = new URLSearchParams({
			purity: '100',
			categories: '010',
			sorting: 'toplist',
			order: 'desc',
			ratios: spec.ratios,
			atleast: spec.atleast,
			page: String(page),
		});
		const response = await fetch(`https://wallhaven.cc/api/v1/search?${query}`, {
			headers: { 'User-Agent': 'moyingyilang.github.io wallpaper manifest generator' },
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = await response.json();

		for (const item of body.data ?? []) {
			// 只留体积可控的 JPEG／PNG，跳过 5MB 以上的原图
			if (!item?.path) continue;
			if (Number(item.file_size) > WALLHAVEN_MAX_BYTES) continue;
			if (!/^image\/(jpeg|png)$/.test(item.file_type || '')) continue;
			urls.push(item.path);
		}
		await new Promise((r) => setTimeout(r, 1200));
	}
	// 去重后按固定数量截断
	return [...new Set(urls)].slice(0, PER_GALLERY);
}

/**
 * 要收录的图集。
 * 注意：刻意排除 AzurAPI/azurapi-js-setup 的 images/skins（5788 个），
 * 该目录为皮肤立绘、擦边风险高，只用 gallery 与 backgrounds。
 */
const GALLERIES = [
	{
		id: 'bluearchive-bg',
		label: '蔚蓝档案 · 剧情背景',
		repo: 'respectZ/blue-archive-viewer',
		ref: 'main',
		dir: 'public/data/jp/MediaResources/GameData/UIs/03_Scenario/01_Background',
		resolution: '1600x1124',
		note: '分辨率最高的一批，作为首选',
	},
	{
		id: 'arknights-cg',
		label: '明日方舟 · 剧情 CG',
		repo: 'Aceship/Arknight-Images',
		ref: 'master',
		dir: 'avg/images',
		resolution: '1280x720 ~ 1600x900',
		note: '剧情 CG，画幅偏宽，适合做壁纸',
	},
	{
		id: 'arknights-bg',
		label: '明日方舟 · 场景背景',
		repo: 'Aceship/Arknight-Images',
		ref: 'master',
		dir: 'avg/backgrounds',
		resolution: '1024x576',
		note: '分辨率偏低，但在毛玻璃与压暗层后面观感尚可',
	},
	{
		id: 'azurlane-gallery',
		label: '碧蓝航线 · 画廊',
		repo: 'AzurAPI/azurapi-js-setup',
		ref: 'master',
		dir: 'images/gallery',
		resolution: '1024x576 ~ 4091x2316',
		note: '已剔除 images/skins 皮肤立绘目录',
	},
	{
		id: 'azurlane-bg',
		label: '碧蓝航线 · 背景',
		repo: 'AzurAPI/azurapi-js-setup',
		ref: 'master',
		dir: 'images/backgrounds',
		resolution: '1024x576 ~ 1920x1080',
		note: '数量较少',
	},
];

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** 均匀抽样，保证覆盖整个目录而不是只取开头 */
function evenSample(list, count) {
	if (list.length <= count) return list;
	const step = list.length / count;
	const out = [];
	for (let i = 0; i < count; i++) out.push(list[Math.floor(i * step)]);
	return out;
}

/** jsDelivr 直链；路径逐段编码，文件名里的空格与特殊字符必须转义 */
function jsdelivr(repo, ref, path) {
	const encoded = path.split('/').map(encodeURIComponent).join('/');
	return `https://cdn.jsdelivr.net/gh/${repo}@${ref}/${encoded}`;
}

function listFiles(probeDir, dir) {
	const out = execFileSync('git', ['-C', probeDir, 'ls-tree', '-r', '--name-only', 'HEAD', dir], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	return out.split('\n').filter(Boolean);
}

const galleries = {};
const workRoot = mkdtempSync(join(tmpdir(), 'wp-manifest-'));
const target = new URL('../public/wallpaper-manifest.json', import.meta.url);

/**
 * 读上一版清单。
 * 某个图集这次抓取失败时（仓库拉不动、图源改版等）用它兜底，
 * 否则那一次刷新会把已有图集整个抹掉，来源直接失效。
 */
let previous = { galleries: {} };
try {
	previous = JSON.parse(readFileSync(target, 'utf8'));
} catch {
	/* 首次生成，没有上一版 */
}

function keepPrevious(id, reason) {
	const old = previous.galleries?.[id];
	if (!old?.urls?.length) {
		console.warn(`  !! ${id} 失败（${reason}），且没有可保留的旧数据`);
		return;
	}
	galleries[id] = old;
	console.warn(`  !! ${id} 失败（${reason}），已保留上一版的 ${old.urls.length} 张`);
}
const cloned = new Map();

try {
	for (const gallery of GALLERIES) {
		try {
			if (!cloned.has(gallery.repo)) {
				const dest = join(workRoot, gallery.repo.replace('/', '__'));
				process.stdout.write(`克隆 ${gallery.repo} （仅 tree 对象）… `);
				execFileSync(
					'git',
					[
						'clone',
						'--filter=blob:none',
						'--no-checkout',
						'--depth',
						'1',
						'--quiet',
						`https://github.com/${gallery.repo}.git`,
						dest,
					],
					{ stdio: 'inherit' },
				);
				cloned.set(gallery.repo, dest);
				console.log('完成');
			}

			const probe = cloned.get(gallery.repo);
			const all = listFiles(probe, gallery.dir).filter((f) => IMAGE_EXT.test(f));
			if (!all.length) {
				console.warn(`  !! ${gallery.id}: 目录下没有图片，跳过`);
				continue;
			}

			const picked = evenSample(all, PER_GALLERY);
			galleries[gallery.id] = {
				label: gallery.label,
				repo: gallery.repo,
				dir: gallery.dir,
				resolution: gallery.resolution,
				note: gallery.note,
				totalInRepo: all.length,
				count: picked.length,
				urls: picked.map((path) => jsdelivr(gallery.repo, gallery.ref, path)),
			};
			console.log(`  ${gallery.id}: 仓库内 ${all.length} 张，收录 ${picked.length} 张`);
		} catch (error) {
			keepPrevious(gallery.id, error.message);
		}
	}
} finally {
	rmSync(workRoot, { recursive: true, force: true });
}

/* ---------------------------------------------------------------- Wallhaven */
console.log('\nWallhaven（通用动漫，与厂商无关）');
for (const spec of WALLHAVEN) {
	try {
		const urls = await fetchWallhaven(spec);
		if (!urls.length) {
			keepPrevious(spec.id, '没有取到图片');
			continue;
		}
		galleries[spec.id] = {
			label: spec.label,
			repo: 'wallhaven.cc',
			dir: `search?ratios=${spec.ratios}&atleast=${spec.atleast}`,
			resolution: spec.resolution,
			note: spec.note,
			count: urls.length,
			urls,
		};
		console.log(`  ${spec.id}: 收录 ${urls.length} 张`);
	} catch (error) {
		keepPrevious(spec.id, error.message);
	}
}

const manifest = {
	generatedAt: new Date().toISOString(),
	generator: 'scripts/gen-wallpaper-manifest.mjs',
	/** 清单是构建时固化的一次性快照；链接失效时重新运行生成脚本即可 */
	usage:
		'运行时按需加载，仅在壁纸来源包含游戏图集时才会请求。图片经 jsDelivr CDN 分发，逐张直链，不做缓存击穿（随机取不同文件即可保证每次不同）。',
	warning: '碧蓝航线皮肤立绘目录（images/skins）擦边内容风险较高，已刻意排除。',
	galleries,
};

writeFileSync(target, JSON.stringify(manifest, null, '\t') + '\n');

const total = Object.values(galleries).reduce((sum, g) => sum + g.count, 0);
console.log(`\n已写入 public/wallpaper-manifest.json`);
console.log(`  图集 ${Object.keys(galleries).length} 个，共 ${total} 条图片直链`);
