import { HIDE_EMPTY_CATEGORIES, MENU_DATA, flattenMenu, pruneEmpty } from '../config/menu.js';
import { categoryOf, usedCategories } from './posts';

/**
 * 当前应该对外展示的导航树。
 *
 * 侧边栏、首页分类卡片、分类页的子分类列表、搜索索引都必须用它，
 * 而不是直接用 MENU_DATA —— 否则会链到没有生成页面的空分类上。
 */
export async function visibleMenu() {
	if (!HIDE_EMPTY_CATEGORIES) return MENU_DATA;
	return pruneEmpty(MENU_DATA, await usedCategories());
}

/** 拍平后的可见导航节点（附带 href 与层级） */
export async function visibleMenuNodes() {
	return flattenMenu(await visibleMenu());
}

/**
 * 按分类把文章分组，分组顺序与侧边栏导航一致；
 * 导航里没有的分类、以及没填 category 的文章，排在最后。
 *
 * 组内保持传入顺序（即日期倒序）。文章列表用它归集，
 * 这样多篇文章挂在同一天时，展示顺序由分类决定而不是靠文件名首字母。
 */
export async function groupByCategory(posts) {
	const nodes = (await visibleMenuNodes()).filter((node) => !node.dedicated);
	const orderOf = new Map(nodes.map((node, index) => [node.label, index]));

	const groups = new Map();
	for (const post of posts) {
		const category = categoryOf(post);
		const key = category?.label ?? '未分类';
		if (!groups.has(key)) {
			groups.set(key, {
				label: key,
				href: category?.href ?? null,
				order: orderOf.get(key) ?? Number.MAX_SAFE_INTEGER,
				posts: [],
			});
		}
		groups.get(key).posts.push(post);
	}

	return [...groups.values()].sort(
		(a, b) => a.order - b.order || a.label.localeCompare(b.label),
	);
}
