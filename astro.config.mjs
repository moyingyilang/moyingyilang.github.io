// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// 改成你自己的域名。部署到 GitHub Pages 项目页时形如
	// https://<用户名>.github.io/<仓库名>/ ，并把下面的 base 设为 '/<仓库名>'
	site: 'https://example.com/',
	base: '',
	output: 'static',
	integrations: [mdx(), sitemap()],

	/*
	 * 空白处理：Astro 7 把默认值从 true 改成了 'jsx'（按 JSX 规则剥离空白）。
	 * 本项目的模板里有依赖「源码换行缩进」产生行内空格的写法
	 * （例如页脚 `代码以 <a>AGPL v3.0</a> 授权`），在 'jsx' 下这些空格会消失，
	 * 出现「代码以AGPL v3.0授权」这类粘连。
	 *
	 * 官方升级指南把 true 作为依赖 HTML 空白规则站点的迁移路径，
	 * 这里显式保留，以维持与 Astro 6 时期完全一致的渲染结果。
	 * 若将来要改用 'jsx' 默认值，需先把模板里的行内空格改成显式写法（{' '}）。
	 */
	compressHTML: true,

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
	 * 构建产物里不含任何 woff 文件（已核实），
	 * src/assets/fonts/ 下的两个文件保留下来只是为了下面这条恢复路径可用。
	 *
	 * 若要恢复 Atkinson：
	 *   1. 在此加回 fonts 数组与 fontProviders.local() 配置
	 *      （对照 git 历史即可）；
	 *   2. 在 BaseHead.astro 中 import { Font } from 'astro:assets'
	 *      并渲染 <Font cssVariable="--font-atkinson" preload />；
	 *   3. 把 global.css 里 --font-sans 的首选字体改为 var(--font-atkinson)。
	 */
});
