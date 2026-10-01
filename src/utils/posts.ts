import { getCollection } from 'astro:content';
import { findNodeByLeaf, parentLabelOfLeaf } from '../config/menu.js';

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
		if (db !== da) return db - da;
		// 同一天发布的多篇文章按 id 兜底排序。
		// 不写这一行也能「碰巧」稳定（数组排序是稳定的，保留集合返回顺序），
		// 但那是实现细节：集合顺序一变，列表顺序就会跟着变，且无从解释。
		return a.id.localeCompare(b.id);
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

/**
 * 中文按字数、西文按词数估算阅读时长。
 *
 * 会先剔除围栏代码块与行内代码：本站是技术站，代码常占正文一半，
 * 而代码是「扫」不是「读」，计入会让时长严重虚高
 * （实测 Fuck4DuerOS 一篇的散文只需 5 分钟，连同代码算出来是 10 分钟）。
 */
export function readingTime(body = '') {
	const prose = String(body)
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`[^`]*`/g, ' ');
	const cjk = (prose.match(/[\u4e00-\u9fa5]/g) || []).length;
	const words = (prose.match(/[A-Za-z0-9]+/g) || []).length;
	const minutes = Math.max(1, Math.round(cjk / 350 + words / 200));
	return `${minutes} 分钟`;
}

/**
 * 找相关文章，按关联强度打分：
 *
 * - 同分类：10 分（权重远大于其它项，保证同分类的排最前）
 * - 同属上一级大类（如「电路原理」与「电源设计」同属「电气工程」）：3 分
 * - 每个共同标签：1 分
 *
 * 分数为 0 的不返回；同分时保持传入顺序（日期倒序），因此输出稳定。
 */
export function relatedPosts(current, posts, limit = 3) {
	const category = current.data?.category;
	const parent = parentLabelOfLeaf(category);
	const tags = new Set(current.data?.tags ?? []);

	return posts
		.filter((post) => post.id !== current.id)
		.map((post) => {
			const sameCategory = category && post.data?.category === category ? 10 : 0;
			const sameParent = parent && parentLabelOfLeaf(post.data?.category) === parent ? 3 : 0;
			const sharedTags = (post.data?.tags ?? []).filter((tag) => tags.has(tag)).length;
			return { post, score: sameCategory + sameParent + sharedTags };
		})
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((entry) => entry.post);
}
