/**
 * 站点导航结构（单一数据源）
 *
 * 导航树同时驱动：侧边栏、顶栏面包屑、分类页路由、搜索索引。
 *
 * 字段说明：
 * - label      显示名称
 * - path       当前层级的路径片段
 * - icon       可选的 SVG 内联内容（24×24，stroke 取 currentColor）
 * - dedicated  该节点已有独立页面，不再由 [...category] 兜底路由生成，
 *              否则两者会产出同一个 URL 并在构建时冲突
 */

const ICONS = {
	tech:
		'<path d="M9.5 3h5"/><path d="M10.5 3v6.1L5.9 17.4A2.6 2.6 0 0 0 8.2 21.4h7.6a2.6 2.6 0 0 0 2.3-4L13.5 9.1V3"/><path d="M7.4 15h9.2"/>',
	code: '<path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/>',
	notes:
		'<rect x="4.5" y="3" width="15" height="18" rx="2.5"/><path d="M8.5 8h7"/><path d="M8.5 12h7"/><path d="M8.5 16h4"/>',
	tools:
		'<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="17" r="2"/>',
	faq: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.5"/><path d="M12 17.2h.01"/>',
	about:
		'<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5"/><path d="M12 7.9h.01"/>',
};

/*
 * 示例导航结构（改成你自己的）
 *
 * 只需改这一处：侧边栏、顶栏面包屑、分类页路由、搜索索引都由它派生。
 * 字段说明见文件顶部注释。
 */
export const MENU_DATA = [
	{
		// 有 children 的节点渲染为可展开分组，本身也会有兜底的分类页
		label: '入门',
		path: 'start',
		icon: ICONS.tech,
		children: [
			{ label: '安装', path: 'install' },
			{ label: '配置', path: 'config' },
		],
	},
	{
		label: '指南',
		path: 'guide',
		icon: ICONS.code,
		children: [
			{ label: '写作', path: 'writing' },
			{ label: '样式参考', path: 'style' },
		],
	},
	{
		label: '随笔',
		path: 'notes',
		icon: ICONS.notes,
		children: [{ label: '随手记', path: 'misc' }],
	},
	// dedicated: true 表示该节点已有独立页面，不再由 [...category] 兜底路由生成
	{ label: '工具', path: 'tools', icon: ICONS.tools, dedicated: true },
	{ label: '常见问题', path: 'faq', icon: ICONS.faq, dedicated: true },
	{ label: '关于', path: 'about', icon: ICONS.about, dedicated: true },
];

/** 规整 URL：去掉末尾斜杠（根路径除外） */
export function normalizePath(pathname = '/') {
	if (!pathname) return '/';
	const clean = pathname.split(/[?#]/)[0];
	return clean.length > 1 ? clean.replace(/\/+$/, '') : '/';
}

/**
 * 把导航树拍平成数组，附带完整 href 与层级。
 * 用于搜索索引、站点地图辅助等。
 */
export function flattenMenu(items = MENU_DATA, base = '', depth = 0) {
	const out = [];
	for (const item of items) {
		const href = `${base}/${item.path}`;
		out.push({ ...item, href, depth });
		if (item.children?.length) {
			out.push(...flattenMenu(item.children, href, depth + 1));
		}
	}
	return out;
}

/**
 * 根据当前路径求导航轨迹，用于面包屑与「展开/高亮」判定。
 * 例：/tech/physics-e -> [{label:'科创',href:'/tech'}, {label:'物理-电',href:'/tech/physics-e'}]
 */
export function findMenuTrail(pathname = '/') {
	const segments = normalizePath(pathname).split('/').filter(Boolean);
	const trail = [];
	let list = MENU_DATA;
	let acc = '';

	for (const seg of segments) {
		const item = list.find((entry) => entry.path === seg);
		if (!item) break;
		acc += `/${item.path}`;
		trail.push({ label: item.label, href: acc });
		list = item.children || [];
	}

	return trail;
}

/**
 * 按叶子节点的 path 片段查找导航节点（含完整 href 与中文名）。
 * 文章 frontmatter 里的 category 存的是叶子片段，如 'physics-e'。
 */
export function findNodeByLeaf(segment, items = MENU_DATA) {
	if (!segment) return null;
	return flattenMenu(items).find((node) => node.path === segment) || null;
}

/**
 * 需要由 [...category] 兜底路由生成的分类路径。
 * 已有独立页面的节点（dedicated）被排除，避免路由冲突。
 */
export function categoryPaths(items = MENU_DATA, base = '') {
	const out = [];
	for (const item of items) {
		const href = `${base}/${item.path}`;
		if (!item.dedicated) out.push(href.slice(1));
		if (item.children?.length) {
			out.push(...categoryPaths(item.children, href));
		}
	}
	return out;
}
