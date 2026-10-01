import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * 文档 / 文章集合
 *
 * 文章统一放在 src/content/blog/ 下，由 src/pages/blog/[slug].astro 渲染。
 * 之前它们位于 src/pages/blog/*.mdx，会各自生成裸路由，既绕开布局又与
 * [slug].astro 冲突，现已迁移。
 *
 * category 对应 src/config/menu.js 中的叶子节点 path，
 * 分类页据此筛选文章（例：category: 'physics-e'）。
 */
const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string().optional(),
			date: z.coerce.date().optional(),
			pubDate: z.coerce.date().optional(),
			updatedDate: z.coerce.date().optional(),
			/** 对应菜单叶子节点的 path */
			category: z.string().optional(),
			tags: z.array(z.string()).optional(),
			draft: z.boolean().default(false),
			/** 手写上一篇 / 下一篇（留空则按日期自动推导） */
			prev: z.string().optional(),
			next: z.string().optional(),
			heroImage: z.optional(image()),
		}),
});

export const collections = { blog };
