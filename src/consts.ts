// 站点级别的全局数据，可在任意位置 import 使用。
//
// ── 基于本模板建站时，这个文件是**第一个要改的地方** ──
// 下面的值都换成了占位符，改成你自己的即可，其余代码无需改动。

export const SITE_TITLE = '站点标题';
export const SITE_DESCRIPTION = '一句话介绍你的站点——会用于首页、SEO 描述与 RSS。';
export const SITE_AUTHOR = '你的名字';
/** 版权年份的起始年，用于页脚显示 “2026–至今” 这类区间 */
export const SITE_COPYRIGHT_YEAR = 2026;

/**
 * 页脚图标按钮。
 *
 * `icon` 是**显式**的图标 id（对应 Footer.astro 里 ICONS 的键），
 * 不用 label 去匹配 —— 否则改个显示名就会静默掉图标。
 * icon 为 null 或找不到对应图标时，回退渲染成文字链接。
 */
export const SOCIAL_LINKS = [
	{ label: 'GitHub', href: 'https://github.com/your-name', icon: 'github' },
	{ label: '哔哩哔哩', href: 'https://space.bilibili.com/your-uid', icon: 'bilibili' },
	{ label: '酷安', href: 'https://www.coolapk.com/u/your-uid', icon: 'coolapk' },
];

/** 源码仓库地址，用于「关于」页与页脚的 ISSUE / LICENSE 链接 */
export const REPO_URL = 'https://github.com/your-name/your-repo';

/**
 * 许可证
 *
 * 选用 `AGPL-3.0-only` 而不是 `-or-later`：前者不允许被许可方
 * 自行套用未来的新版条款，是常见开源许可里约束最强的一种。
 * 其第 13 条（Remote Network Interaction）要求：若把修改后的版本
 * 作为网络服务提供，必须向使用者提供对应源码。
 *
 * 若你不打算沿用 AGPL，记得同时替换仓库根目录的 LICENSE 文件。
 */
export const LICENSE = {
	id: 'AGPL-3.0-only',
	name: 'GNU Affero General Public License v3.0',
	shortName: 'AGPL v3.0',
	url: 'https://www.gnu.org/licenses/agpl-3.0.html',
	file: 'LICENSE',
} as const;

/**
 * AI 参与声明
 *
 * 这段文字会同时出现在「关于」页与页脚提示里，改这一处即可。
 * 本模板自身的设计与实现由 AI 编程助手协作完成，故保留此声明；
 * 若你的站点并不需要，可以把 items 清空并改写 summary，
 * 或把「关于」页里对应的 <section> 删掉。
 */
export const AI_CONTRIBUTION = {
	role: 'AI 编程助手',
	assistant: 'DeepSeek Harness',
	model: 'deepseek-flash',
	summary:
		'本站基于一份由 AI 编程助手协作完成的 Astro 模板搭建；选题、内容与最终取舍由站主决定并负责。',
	items: [
		'Fluent (Windows 11 Acrylic / Mica) × MIUI 毛玻璃设计系统：设计令牌、玻璃组件、深浅色双主题',
		'顶栏、侧边导航树、页脚与正文排版',
		'可调壁纸系统：五种来源模式、设置面板、图集清单生成脚本',
		'内容集合、命令面板搜索、图片灯箱、回到顶部等交互',
		'维护脚本（产物校验、图源失效检测）与 CI 配置',
	],
	disclaimer: 'AI 生成或修改的代码已尽力测试，但不提供任何担保，详见许可证。',
} as const;
