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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 每个图集最多收录多少张，控制清单体积 */
const PER_GALLERY = 100;

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
			console.error(`  !! ${gallery.id} 失败: ${error.message}`);
		}
	}
} finally {
	rmSync(workRoot, { recursive: true, force: true });
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

const target = new URL('../public/wallpaper-manifest.json', import.meta.url);
writeFileSync(target, JSON.stringify(manifest, null, '\t') + '\n');

const total = Object.values(galleries).reduce((sum, g) => sum + g.count, 0);
console.log(`\n已写入 public/wallpaper-manifest.json`);
console.log(`  图集 ${Object.keys(galleries).length} 个，共 ${total} 条图片直链`);
