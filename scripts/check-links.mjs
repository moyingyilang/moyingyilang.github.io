#!/usr/bin/env node
/**
 * 产物校验：检查 dist/ 的内部链接与关键文件是否齐全
 *
 * 用法：
 *   pnpm run build && pnpm run check:links
 *   pnpm run verify          # 上面两步一起跑
 *   node scripts/check-links.mjs --base /my-repo   # 站点不在域名根路径时
 *
 * 退出码非 0 表示有失效链接或缺少产物，可直接用于 CI 门禁。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const DIST = resolve(import.meta.dirname, '..', 'dist');

/**
 * astro.config.mjs 里的 base 前缀。
 * 配置了 base 时，页面里的绝对链接会带上它，但 dist/ 里不带，
 * 所以解析前要先剥掉，否则会误报。
 */
const baseIndex = process.argv.indexOf('--base');
const BASE = baseIndex === -1 ? '' : (process.argv[baseIndex + 1] ?? '').replace(/\/+$/, '');

/**
 * 必须存在的固定产物：缺任何一个都说明构建链路出了问题
 *
 * 分类页与文章页**不写死**，而是从 src/config/menu.js 与
 * src/content/blog/ 推导出来 —— 这样换一套栏目结构或换内容后，
 * 校验依然有效，不必改这个脚本。
 */
const REQUIRED_STATIC = [
	'index.html',
	'404.html',
	'rss.xml',
	'sitemap-index.xml',
	'search-index.json',
	'wallpaper-manifest.json',
	'blog/index.html',
];

/**
 * 读取内容目录：文章文件名，以及它们用到的 category。
 *
 * 分类页现在只为「已经有文章」的分类生成，所以校验也必须据此推导，
 * 否则会误报缺页。
 */
function readContent() {
	const dir = resolve(import.meta.dirname, '..', 'src', 'content', 'blog');
	let files = [];
	try {
		files = readdirSync(dir).filter((f) => /\.mdx?$/.test(f));
	} catch {
		return { files: [], used: new Set() };
	}

	const used = new Set();
	for (const file of files) {
		const src = readFileSync(join(dir, file), 'utf8');
		const frontmatter = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		if (!frontmatter) continue;
		const category = frontmatter[1].match(/^category:\s*['"]?([\w-]+)['"]?\s*$/m);
		if (category) used.add(category[1]);
	}
	return { files, used };
}

/** 从 menu.js 推导「应该存在」的分类页路由（与构建时的裁剪规则一致） */
async function requiredFromMenu(used) {
	try {
		const mod = await import('../src/config/menu.js');
		const pruned = mod.pruneEmpty(mod.MENU_DATA, used);
		return mod
			.flattenMenu(pruned)
			.filter((node) => !node.dedicated)
			.map((node) => `${node.href.replace(/^\//, '')}/index.html`);
	} catch (error) {
		console.warn(`  注意：无法从 menu.js 推导路由（${error.message}），跳过该项`);
		return [];
	}
}

/** 独立页面（与 menu 里的 dedicated 节点对应） */
const REQUIRED_PAGES = ['about/index.html', 'activity/index.html', 'faq/index.html', 'tools/index.html'];

const { files: contentFiles, used: usedCategories } = readContent();

const REQUIRED = [
	...REQUIRED_STATIC,
	...REQUIRED_PAGES,
	...(await requiredFromMenu(usedCategories)),
	...contentFiles.map((f) => `blog/${f.replace(/\.mdx?$/, '')}/index.html`),
];

if (!existsSync(DIST)) {
	console.error('✗ 未找到 dist/，请先运行 pnpm run build');
	process.exit(1);
}

/** 递归收集全部 HTML 页面 */
function collectPages(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) collectPages(full, out);
		else if (entry.name.endsWith('.html')) out.push(full);
	}
	return out;
}

/** 判断一个 href 能否在 dist 里解析到真实文件 */
function resolves(href) {
	if (/^(https?:|mailto:|tel:|#|data:|javascript:)/i.test(href)) return true;

	let pathname = href.split(/[?#]/)[0];
	if (!pathname) return true;

	// 剥掉 base 前缀
	if (BASE && (pathname === BASE || pathname.startsWith(`${BASE}/`))) {
		pathname = pathname.slice(BASE.length) || '/';
	}

	const base = join(DIST, decodeURIComponent(pathname).replace(/^\/+/, ''));
	return [base, join(base, 'index.html'), `${base}.html`].some(
		(candidate) => existsSync(candidate) && statSync(candidate).isFile(),
	);
}

let failures = 0;

/* ---------------------------------------------------------- 1. 关键产物 */
const missing = REQUIRED.filter((file) => !existsSync(join(DIST, file)));
if (missing.length) {
	console.error(`✗ 缺少关键产物 ${missing.length} 项:`);
	for (const file of missing) console.error(`    - ${file}`);
	failures += missing.length;
} else {
	console.log(`✓ 关键产物齐全（${REQUIRED.length} 项）`);
}

/* ---------------------------------------------------------- 2. 内部链接 */
const pages = collectPages(DIST);
const broken = new Map();

for (const page of pages) {
	const html = readFileSync(page, 'utf8');
	for (const match of html.matchAll(/href="([^"]+)"/g)) {
		const href = match[1];
		if (resolves(href)) continue;
		if (!broken.has(href)) broken.set(href, new Set());
		broken.get(href).add(relative(DIST, page));
	}
}

if (broken.size) {
	console.error(`✗ 失效内部链接 ${broken.size} 条:`);
	for (const [href, sources] of [...broken].sort()) {
		console.error(`    - ${href}  ← ${[...sources].slice(0, 3).join(', ')}`);
	}
	failures += broken.size;
} else {
	console.log(`✓ 内部链接全部可解析（扫描 ${pages.length} 个页面）`);
}

/* ------------------------------------------------------ 3. 站内搜索索引 */
try {
	const index = JSON.parse(readFileSync(join(DIST, 'search-index.json'), 'utf8'));
	if (!Array.isArray(index) || index.length === 0) {
		console.error('✗ search-index.json 为空');
		failures += 1;
	} else {
		// 索引里的 URL 也必须能解析 —— 否则搜索结果会点出 404，
		// 而这类死链藏在 JSON 里，HTML 扫描是发现不了的
		const dead = index.filter((item) => item?.url && !resolves(item.url));
		if (dead.length) {
			console.error(`✗ 搜索索引里有 ${dead.length} 条失效 URL:`);
			for (const item of dead.slice(0, 8)) {
				console.error(`    - ${item.url}  (${item.title})`);
			}
			failures += dead.length;
		} else {
			console.log(`✓ 搜索索引 ${index.length} 条，URL 全部可解析`);
		}
	}
} catch (error) {
	console.error(`✗ search-index.json 无法解析: ${error.message}`);
	failures += 1;
}

/* ------------------------------------------------------ 4. 壁纸图集清单 */
try {
	const manifest = JSON.parse(readFileSync(join(DIST, 'wallpaper-manifest.json'), 'utf8'));
	const galleries = Object.values(manifest.galleries ?? {});
	const urls = galleries.reduce((sum, gallery) => sum + (gallery.urls?.length ?? 0), 0);
	if (!galleries.length || !urls) {
		console.error('✗ wallpaper-manifest.json 里没有图集');
		failures += 1;
	} else {
		console.log(`✓ 壁纸图集 ${galleries.length} 个，共 ${urls} 条直链`);
	}
} catch (error) {
	console.error(`✗ wallpaper-manifest.json 无法解析: ${error.message}`);
	failures += 1;
}

/* ---------------------------------------------------------------- 结果 */
if (failures) {
	console.error(`\n✗ 校验未通过，共 ${failures} 个问题`);
	process.exit(1);
}
console.log('\n✓ 全部校验通过');
