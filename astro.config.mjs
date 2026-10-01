// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://moyingyilang.github.io/',
	base: '',
	output: 'static',
	integrations: [mdx(), sitemap()],

	// 站点内所有链接在视口内即预取，跳转更接近原生应用的即时感
	prefetch: {
		prefetchAll: true,
		defaultStrategy: 'viewport',
	},

	// 代码块使用 Shiki 双主题：随 <html data-theme> 在深浅色间切换
	markdown: {
		shikiConfig: {
			themes: {
				light: 'github-light',
				dark: 'github-dark',
			},
			defaultColor: false,
			wrap: false,
		},
	},

	/*
	 * 字体：Atkinson（原 Bear Blog 模板字体）已从配置中移除。
	 *
	 * 当前视觉基调是 Fluent (Segoe UI Variable) × MIUI (MiSans)，
	 * 正文使用平台原生字体栈（见 global.css 的 --font-sans），
	 * 这样中文排版更贴近系统观感，也不额外下载字体。
	 * 字体文件仍保留在 src/assets/fonts/ 下。
	 *
	 * 若要恢复 Atkinson：
	 *   1. 在此加回 fonts 数组与 fontProviders.local() 配置
	 *      （对照 git 历史即可）；
	 *   2. 在 BaseHead.astro 中 import { Font } from 'astro:assets'
	 *      并渲染 <Font cssVariable="--font-atkinson" preload />；
	 *   3. 把 global.css 里 --font-sans 的首选字体改为 var(--font-atkinson)。
	 */
});
