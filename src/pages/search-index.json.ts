import type { APIRoute } from 'astro';
import { categoryOf, getSortedPosts } from '../utils/posts';
import { visibleMenuNodes } from '../utils/nav';

/**
 * 搜索索引：只在用户第一次打开命令面板时被懒加载，
 * 因此不需要内联进每个页面。
 *
 * 用可见菜单（已裁掉空分类），否则搜索结果会链到不存在的页面。
 */
export const GET: APIRoute = async () => {
	const posts = await getSortedPosts();

	const items = [
		...(await visibleMenuNodes()).map((node) => ({
			title: node.label,
			url: node.href,
			kind: node.depth === 0 ? '板块' : '分类',
			description: '',
		})),
		...posts.map((post) => {
			const category = categoryOf(post);
			return {
				title: post.data.title,
				url: `/blog/${post.id}/`,
				kind: category?.label ?? '文章',
				description: post.data.description ?? '',
			};
		}),
	];

	return new Response(JSON.stringify(items), {
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
	});
};
