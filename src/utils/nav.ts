import { HIDE_EMPTY_CATEGORIES, MENU_DATA, flattenMenu, pruneEmpty } from '../config/menu.js';
import { usedCategories } from './posts';

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
