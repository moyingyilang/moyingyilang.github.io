/**
 * 壁纸图源注册表
 *
 * 站点是纯静态托管、没有后端，所有图源都必须由浏览器直接取。
 * 这里只收录**经实测可用**的源，每条都注明实测结论。
 *
 * 两类源的判定标准不同：
 * - kind: 'image'  接口直接返回图片字节。作为 CSS background-image 使用
 *                  **不需要 CORS**，只要 URL 能取到图即可。
 * - kind: 'json'   接口返回 JSON，需要 fetch 读出图片地址，
 *                  **必须**有 access-control-allow-origin 才可用。
 *
 * 游戏图集（kind: 'pool'）的图片直链体积较大，不内联进页面，
 * 而是放在 public/wallpaper-manifest.json，按需加载。
 * 该清单由 scripts/gen-wallpaper-manifest.mjs 生成，原因见那个脚本的注释。
 */

export type SourceKind = 'image' | 'json';

export interface WallpaperSource {
	id: string;
	label: string;
	kind: SourceKind;
	/** image 类会 302 到真实图片；json 类返回 JSON */
	url: string;
	/** json 类：从响应中取出图片地址的点路径 */
	pick?: string;
	/** 实测备注 */
	verified: string;
}

/** 游戏的图集，对应 wallpaper-manifest.json 中 galleries 的键 */
export interface Gallery {
	id: string;
	label: string;
	/** 抽样得到的分辨率区间 */
	resolution: string;
	verified: string;
}

export interface GameEntry {
	id: string;
	label: string;
	galleries: Gallery[];
	note?: string;
}

/* --------------------------------------------------------------------------
   Bing
   实测：bing.biturl.top 返回 200 JSON，CORS 为 *（带 Origin 与 OPTIONS 预检均通过），
   index=random 每次返回不同图；resolution=1920 约 337KB，3840 高达 3.7MB 故不使用。
   -------------------------------------------------------------------------- */
export const BING_SOURCES: WallpaperSource[] = [
	{
		id: 'bing-biturl',
		label: 'Bing 每日壁纸',
		kind: 'json',
		url: 'https://bing.biturl.top/?resolution=1920&format=json&index=random&mkt=zh-CN',
		pick: 'url',
		verified: '200 JSON，CORS *，index=random 每次不同图',
	},
];

/* --------------------------------------------------------------------------
   二次元
   实测：直接返回图片字节，每次请求均为不同图，且接受随机查询参数（可缓存击穿）。
   Loliapi 实测稳定性一般（曾出现 404 后重试成功），仅作备选。
   -------------------------------------------------------------------------- */
export const ANIME_SOURCES: WallpaperSource[] = [
	{
		id: 'alcy',
		label: 'Alcy 图源',
		kind: 'image',
		url: 'https://t.alcy.cc/ycy',
		verified: '200 image/webp，每次不同图，带随机参数仍 200',
	},
	{
		id: 'mwm',
		label: 'Mwm 图源',
		kind: 'image',
		url: 'https://t.mwm.moe/pc',
		verified: '200 image/webp，每次不同图，带随机参数仍 200',
	},
	{
		id: 'loliapi',
		label: 'Loliapi 图源',
		kind: 'image',
		url: 'https://www.loliapi.com/acg/',
		verified: '稳定性一般，仅作备选',
	},
];

/* --------------------------------------------------------------------------
   游戏

   仅收录实测能取到图片直链的图集。
   图片经 jsDelivr CDN 分发，单文件直链可用（实测 206/200 + 正确 image content-type）；
   注意 jsDelivr 的目录列表 API 对这些仓库返回 403（体积超 50MB），
   所以文件名必须先固化进清单，不能运行时枚举。
   -------------------------------------------------------------------------- */
export const GAMES: GameEntry[] = [
	{
		id: 'bluearchive',
		label: '蔚蓝档案',
		galleries: [
			{
				id: 'bluearchive-bg',
				label: '蔚蓝档案 · 剧情背景',
				resolution: '1600x1124',
				verified: 'jsDelivr 直链实测可用，分辨率最高，作为首选',
			},
		],
	},
	{
		id: 'arknights',
		label: '明日方舟',
		galleries: [
			{
				id: 'arknights-cg',
				label: '明日方舟 · 剧情 CG',
				resolution: '1280x720 ~ 1600x900',
				verified: 'jsDelivr 直链实测可用',
			},
			{
				id: 'arknights-bg',
				label: '明日方舟 · 场景背景',
				resolution: '1024x576',
				verified: 'jsDelivr 直链实测可用，分辨率偏低',
			},
		],
	},
	{
		id: 'azurlane',
		label: '碧蓝航线',
		galleries: [
			{
				id: 'azurlane-gallery',
				label: '碧蓝航线 · 画廊',
				resolution: '1024x576 ~ 4091x2316',
				verified: 'jsDelivr 直链实测可用；已刻意排除 images/skins 皮肤立绘目录',
			},
			{
				id: 'azurlane-bg',
				label: '碧蓝航线 · 背景',
				resolution: '1024x576 ~ 1920x1080',
				verified: 'jsDelivr 直链实测可用，数量较少',
			},
		],
	},
	{
		id: 'pgr',
		label: '战双帕弥什',
		galleries: [],
		note: '用户给出的 TomyJan/Kuro-API-Collection 是 API 文档集合，需 POST + token + 伪造 APP 请求头，返回玩家数据而非壁纸，纯静态站无法调用',
	},
	{
		id: 'endfield',
		label: '明日方舟：终末地',
		galleries: [],
		note: '该游戏没有专门壁纸 API。end.shallow.ink 的图片代理实测可用，但目前只验证到 396x396 图标尺寸，达不到壁纸要求',
	},
	{
		id: 'stellasora',
		label: '星塔旅人',
		galleries: [],
		note: 'MaaStellaSora 是 MaaFramework 自动签到脚本，仓库内只有 logo 等 UI 资源，无壁纸图源',
	},
	{
		id: 'nte',
		label: '异环',
		galleries: [],
		note: 'MF-Dust/NTE-Auto-Sign 是自动签到机器人，仓库内只有演示截图，非壁纸源',
	},
];

/* --------------------------------------------------------------------------
   模式
   -------------------------------------------------------------------------- */
export interface WallpaperMode {
	id: 'all' | 'bing' | 'acg' | 'acg-custom' | 'off';
	label: string;
	desc: string;
	/** 选中后在下方展开二级菜单（用于细选图源） */
	submenu?: boolean;
}

/**
 * 模式层级：从最宽到最窄
 *
 * 「二次元」这里按 ACG 统称理解，包含二次元图源与游戏图集。
 * Bing 与游戏互锁：只有「全部随机」会把两者混在一起，
 * 其余模式要么只走 Bing，要么只走二次元/游戏。
 */
export const MODES: WallpaperMode[] = [
	{ id: 'all', label: '全部随机', desc: 'Bing、二次元与游戏混合随机' },
	{ id: 'bing', label: 'Bing 专属', desc: '只使用 Bing 每日壁纸' },
	{ id: 'acg', label: '二次元全部随机', desc: '全部二次元图源与游戏图集' },
	{ id: 'acg-custom', label: '二次元自选', desc: '自己勾选要启用的图源', submenu: true },
	{ id: 'off', label: '纯渐变', desc: '不加载图片，只保留内置渐变壁纸' },
];

export const DEFAULT_SETTINGS = {
	/** 默认使用 Bing 每日壁纸 */
	mode: 'bing' as WallpaperMode['id'],
	/** 「二次元自选」模式下启用的游戏 id；默认全部勾选 */
	games: GAMES.filter((game) => game.galleries.length > 0).map((game) => game.id),
	/** 「二次元自选」模式下启用的二次元图源 id；默认全部勾选 */
	animes: ANIME_SOURCES.map((source) => source.id),
	/** 图片高斯模糊，px */
	blur: 0,
	/** 压暗遮罩不透明度 0–0.6 */
	dim: 0.12,
	/** 自动换壁纸间隔（分钟），0 表示关闭 */
	interval: 0,
	/** 缓慢缩放动效 */
	kenBurns: true,
	/** 上一次使用的图片地址，用于刷新时无闪烁地直接绘制 */
	lastUrl: '',
	/** 上一次的来源说明 */
	lastCredit: '',
};

export const SETTINGS_STORAGE_KEY = 'moying-wallpaper';
export const MANIFEST_URL = '/wallpaper-manifest.json';

/** 有可用图源的游戏 */
export function availableGames(): GameEntry[] {
	return GAMES.filter((game) => game.galleries.length > 0);
}

/** 运行时候选源的统一形状 */
export interface PoolCandidate {
	id: string;
	label: string;
	kind: 'image' | 'json' | 'pool';
	url?: string;
	pick?: string;
	/** kind 为 pool 时，指向清单里的图集键 */
	galleryId?: string;
}

function toCandidate(source: WallpaperSource): PoolCandidate {
	return {
		id: source.id,
		label: source.label,
		kind: source.kind,
		url: source.url,
		pick: source.pick,
	};
}

function galleriesToCandidates(game: GameEntry): PoolCandidate[] {
	return game.galleries.map((gallery) => ({
		id: gallery.id,
		label: gallery.label,
		kind: 'pool' as const,
		galleryId: gallery.id,
	}));
}

/** 交给客户端脚本的配置：只含元数据，游戏图集的实际 URL 走清单按需加载 */
export function clientConfig() {
	return {
		key: SETTINGS_STORAGE_KEY,
		manifestUrl: MANIFEST_URL,
		defaults: DEFAULT_SETTINGS,
		modes: MODES,
		sources: {
			bing: BING_SOURCES.map(toCandidate),
			anime: ANIME_SOURCES.map(toCandidate),
		},
		games: GAMES.map((game) => ({
			id: game.id,
			label: game.label,
			note: game.note ?? '',
			candidates: galleriesToCandidates(game),
		})),
	};
}
