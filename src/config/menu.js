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
	ee: '<path d="M13 2.5 5 13.2h5.6L10 21.5l8-10.9h-5.6z"/>',
	cs: '<path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/>',
	mech: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.5v5.1M12 15.4v5.1M3.5 12h5.1M15.4 12h5.1"/>',
	basics:
		'<path d="M9.5 3h5"/><path d="M10.5 3v6.1L5.9 17.4A2.6 2.6 0 0 0 8.2 21.4h7.6a2.6 2.6 0 0 0 2.3-4L13.5 9.1V3"/><path d="M7.4 15h9.2"/>',
	data: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M9.5 9.5v10"/>',
	notes:
		'<rect x="4.5" y="3" width="15" height="18" rx="2.5"/><path d="M8.5 8h7"/><path d="M8.5 12h7"/><path d="M8.5 16h4"/>',
	tools:
		'<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="17" r="2"/>',
	// 折线图：一条带拐点的上升曲线压在坐标轴上
	activity: '<path d="M4 19.5h16"/><path d="m6.5 15.2 3.6-4.4 3.2 2.5L19.5 6"/>',
	faq: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.5"/><path d="M12 17.2h.01"/>',
	about:
		'<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5"/><path d="M12 7.9h.01"/>',
};

/**
 * 是否在侧边栏隐藏「还没有文章」的分类。
 *
 * 分类可以先按完整体系定义好，等真正写了文章它才出现在导航里 ——
 * 访客看不到空栏目，你也不会因为「还有一堆栏目要填」而不敢动笔。
 * 改成 false 就恢复成「所有分类始终显示」。
 */
export const HIDE_EMPTY_CATEGORIES = true;

export const MENU_DATA = [
	{
		label: '电气工程',
		path: 'ee',
		icon: ICONS.ee,
		children: [
			{ label: '电路原理', path: 'circuits' },
			{ label: '电源设计', path: 'power' },
			{ label: 'PCB 设计', path: 'pcb' },
			{ label: '电机与拖动', path: 'motors' },
			{ label: '嵌入式与单片机', path: 'embedded' },
			{ label: '仪器与测量', path: 'measure' },
		],
	},
	{
		label: '计算机',
		path: 'cs',
		icon: ICONS.cs,
		children: [
			{ label: '开发语言', path: 'languages' },
			{ label: '开发环境', path: 'env' },
			{ label: '容器与运维', path: 'ops' },
			{ label: '网络与协议', path: 'network' },
			{ label: 'Android 与刷机', path: 'android' },
			{ label: '逆向与调试', path: 'reverse' },
		],
	},
	{
		label: '机械制造',
		path: 'mech',
		icon: ICONS.mech,
		children: [
			{ label: '机械设计', path: 'design' },
			{ label: '材料与工艺', path: 'materials' },
			{ label: '公差与测量', path: 'tolerance' },
			{ label: '数控与 3D 打印', path: 'cnc' },
		],
	},
	{
		label: '基础学科',
		path: 'basics',
		icon: ICONS.basics,
		children: [
			{ label: '物理', path: 'physics' },
			{ label: '化学', path: 'chemistry' },
			{ label: '数学', path: 'math' },
		],
	},
	{
		// 给「记得住数据、不想写散文」的内容准备的格式：以表格与参数为主
		label: '数据速查',
		path: 'data',
		icon: ICONS.data,
		children: [
			{ label: '元件参数', path: 'components' },
			{ label: '公式与常数', path: 'formulas' },
			{ label: '标准与规范', path: 'standards' },
		],
	},
	{
		label: '随笔',
		path: 'notes',
		icon: ICONS.notes,
		children: [
			{ label: '项目记录', path: 'projects' },
			{ label: '经验与教训', path: 'lessons' },
			{ label: '杂谈', path: 'misc' },
		],
	},
	{ label: '项目提交', path: 'activity', icon: ICONS.activity, dedicated: true },
	{ label: '工具', path: 'tools', icon: ICONS.tools, dedicated: true },
	{ label: '常见问题', path: 'faq', icon: ICONS.faq, dedicated: true },
	{ label: '关于', path: 'about', icon: ICONS.about, dedicated: true },
];

/**
 * 过滤掉还没有文章的分类。
 *
 * 规则：
 * - 独立页面（dedicated）始终保留
 * - 叶子节点：只有出现在 `used` 里才保留
 * - 分组节点：自身有文章，或过滤后还有子节点，才保留
 *
 * 这样分类体系可以一次定义完整，但只有真正写了文章的分类才会露出来。
 */
export function pruneEmpty(items, used) {
	const out = [];
	for (const item of items) {
		if (item.dedicated) {
			out.push(item);
			continue;
		}

		const keptChildren = item.children?.length ? pruneEmpty(item.children, used) : [];

		// 分组页本身也能挂文章（category 填分组自己的 path）
		if (keptChildren.length || used.has(item.path)) {
			out.push(keptChildren.length ? { ...item, children: keptChildren } : { ...item, children: undefined });
		}
	}
	return out;
}

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
 * 取某个分类所属的上一级分组名（例如 circuits → 电气工程）。
 * 顶层分类没有父分组，返回 null。
 *
 * 用于「相关文章」：同属一个大类的文章比毫无关系的更值得互相推荐。
 */
export function parentLabelOfLeaf(segment, items = MENU_DATA) {
	const nodes = flattenMenu(items);
	const node = nodes.find((n) => n.path === segment);
	if (!node) return null;

	const segments = node.href.split('/').filter(Boolean);
	if (segments.length < 2) return null;

	const parentHref = `/${segments.slice(0, -1).join('/')}`;
	return nodes.find((n) => n.href === parentHref)?.label ?? null;
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
