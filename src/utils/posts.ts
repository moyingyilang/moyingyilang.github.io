import { getCollection } from 'astro:content';
import { findNodeByLeaf } from '../config/menu.js';

/** 文章的发布日期：date 与 pubDate 都支持，缺省时排到最后 */
export function postDate(post) {
	return post.data.date || post.data.pubDate || null;
}

/**
 * 当前已有文章覆盖到的分类 path 集合。
 *
 * 侧边栏与分类页路由都用它跳过「还没有文章」的分类，
 * 避免访客点进一堆空页面、也避免空页面进站点地图。
 */
export async function usedCategories() {
	const posts = await getCollection('blog', ({ data }) => !data.draft);
	return new Set(posts.map((post) => post.data.category).filter(Boolean) as string[]);
}

/** 按日期倒序的全部文章（过滤草稿） */
export async function getSortedPosts() {
	const posts = await getCollection('blog', ({ data }) => !data.draft);
	return posts.sort((a, b) => {
		const da = postDate(a)?.getTime() ?? 0;
		const db = postDate(b)?.getTime() ?? 0;
		return db - da;
	});
}

export function formatDate(value) {
	if (!value) return '';
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString('zh-CN', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

export function postHref(post) {
	return `/blog/${post.id}/`;
}

/**
 * 把 frontmatter 里的 category（叶子 path 片段）解析成
 * { label, href }，无法匹配时退化为原值 + 根路径。
 */
export function categoryOf(post) {
	const segment = post.data?.category;
	if (!segment) return null;
	const node = findNodeByLeaf(segment);
	return { label: node?.label ?? segment, href: node?.href ?? `/${segment}` };
}

/** 中文按字数、西文按词数估算阅读时长 */
export function readingTime(body = '') {
	const text = String(body);
	const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
	const words = (text.match(/[A-Za-z0-9]+/g) || []).length;
	const minutes = Math.max(1, Math.round(cjk / 350 + words / 200));
	return `${minutes} 分钟`;
}

/** 取前 n 个标签/分类，用于卡片 */
export function flattenTags(posts) {
	const counter = new Map();
	for (const post of posts) {
		for (const tag of post.data.tags || []) {
			counter.set(tag, (counter.get(tag) || 0) + 1);
		}
	}
	return [...counter.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([tag, count]) => ({ tag, count }));
}
