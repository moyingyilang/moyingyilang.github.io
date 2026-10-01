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

export type SourceKind = 'image' | 'json' | 'pool';

export interface WallpaperSource {
	id: string;
	label: string;
	kind: SourceKind;
	/** image 类会 302 到真实图片；json 类返回 JSON；pool 类不看这个字段 */
	url: string;
	/** json 类：从响应中取出图片地址的点路径 */
	pick?: string;
	/** pool 类：指向 wallpaper-manifest.json 里 galleries 的键 */
	galleryId?: string;
	/**
	 * 只在某一屏幕方向下使用；不填表示两个方向都用。
	 * 用于那些本身就分横竖两套图的来源，避免竖屏拿到横图被裁掉大半。
	 */
	orientation?: 'portrait' | 'landscape';
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
   index=random 每次返回不同图。

   注意 API 自身的 resolution 参数**只认横屏**：
     resolution=1920 -> 1920x1080    resolution=1366 -> 1366x768
     resolution=1080 -> HTTP 502     resolution=768  -> HTTP 502
   后两个竖屏档位是坏的。但返回的图片落在 Bing 自己的 CDN 上，而 CDN 是
   **按文件名里的尺寸出图**的，所以竖图靠改写 URL 里的尺寸段来拿，不走 API 参数。

   BING_SIZES 是逐个实测的结果，只有这四档可用；
   2560x1440 / 3840x2160 / 1080x2400 / 1440x2560 / 1200x1920 等一律 404。
   -------------------------------------------------------------------------- */
export const BING_SIZES = {
	landscape: { large: '1920x1080', small: '1366x768' },
	portrait: { large: '1080x1920', small: '768x1366' },
} as const;

/**
 * 按屏幕方向与实际像素需求挑一档。
 *
 * 竖屏下横图会被 cover 裁掉大半、白白浪费像素，所以方向是首要判据；
 * 再按设备像素宽度决定用大档还是小档，小屏不必下 337KB。
 */
export function pickBingSize(viewportWidth: number, viewportHeight: number, dpr = 1) {
	const portrait = viewportHeight > viewportWidth;
	const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
	const need = Math.round(viewportWidth * ratio);
	const table = portrait ? BING_SIZES.portrait : BING_SIZES.landscape;
	const threshold = portrait ? 800 : 1400;
	return need <= threshold ? table.small : table.large;
}

/** 把 Bing 图片地址里的尺寸段换成目标尺寸；地址里没有尺寸段时原样返回 */
export function withBingSize(url: string, size: string) {
	return url.replace(/_\d+x\d+(\.(?:jpe?g|png|webp))(\?|$)/i, `_${size}$1$2`);
}

export const BING_SOURCES: WallpaperSource[] = [
	{
		id: 'bing-biturl',
		label: 'Bing 每日壁纸',
		kind: 'json',
		url: 'https://bing.biturl.top/?resolution=1920&format=json&index=random&mkt=zh-CN',
		pick: 'url',
		verified: '200 JSON，CORS *，index=random 每次不同图；出图尺寸由 CDN 文件名决定',
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
	/*
	 * 通用动漫图集（Wallhaven）
	 *
	 * 与上面三个的区别：它不是"每次请求返回一张随机图"，而是构建期把直链
	 * 枚举进清单、运行期从池里随机取。这么做是因为它的 API 没有 CORS 头，
	 * 浏览器直接 fetch 会被拦；而图片 CDN（w.wallhaven.cc）反而是
	 * access-control-allow-origin: *，所以清单化之后既能用也能下载。
	 *
	 * 它是通用动漫壁纸站，**不针对任何特定游戏或厂商**；
	 * 采集时限定 purity=100（仅 SFW）与 categories=010（仅动漫），
	 * 并按屏幕方向拆成竖屏／横屏两个图集。
	 */
	{
		id: 'wallhaven-portrait',
		label: '通用动漫 · 竖屏',
		kind: 'pool',
		url: '',
		galleryId: 'wallhaven-portrait',
		orientation: 'portrait',
		verified: 'API 无 CORS，改为构建期固化直链；图片 CDN 带 CORS，可下载',
	},
	{
		id: 'wallhaven-landscape',
		label: '通用动漫 · 横屏',
		kind: 'pool',
		url: '',
		galleryId: 'wallhaven-landscape',
		orientation: 'landscape',
		verified: 'API 无 CORS，改为构建期固化直链；图片 CDN 带 CORS，可下载',
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
	/** 仅在该屏幕方向下参与抽取；不填表示两个方向都参与 */
	orientation?: 'portrait' | 'landscape';
}

function toCandidate(source: WallpaperSource): PoolCandidate {
	return {
		id: source.id,
		label: source.label,
		kind: source.kind,
		url: source.url,
		pick: source.pick,
		galleryId: source.galleryId,
		orientation: source.orientation,
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
