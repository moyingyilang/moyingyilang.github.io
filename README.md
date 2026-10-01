# 路遥起森的博客

基于 Astro 6 的静态文档站，视觉基调是 **Fluent（Windows 11 Acrylic / Mica）× MIUI（miuix）毛玻璃**：
Fluent 提供层级、强调条与 Acrylic 颗粒质感，MIUI 提供圆角尺度、留白与橙→蓝渐变玻璃。

## 特性

- 🪟 Acrylic / Mica 毛玻璃表面，深浅色双主题，首次访问跟随系统且切换后记忆
- 🧭 左侧导航树 + 右侧本页目录 + 阅读进度条 + 回到顶部
- 🔍 命令面板搜索（`Ctrl` / `⌘` + `K`，或按 `/`）
- 🖼️ 图片点击放大灯箱、代码块一键复制、表格自适应滚动
- 📄 文章集合自动汇总到分类页、RSS 与搜索索引
- ♿ 禁用 JS 时内容依然完整可见（入场动画有兜底降级）

## 目录结构

```text
src/
├── components/
│   ├── BaseHead.astro        元信息、防闪烁主题脚本、全局样式入口
│   ├── Header.astro          Acrylic 顶栏（品牌 / 面包屑 / 搜索 / 主题切换）
│   ├── SideNav.astro         玻璃侧边导航容器
│   ├── NavTree.astro         递归导航树（Astro.self），构建期算好展开与高亮
│   ├── Toc.astro             本页目录
│   ├── SearchPalette.astro   搜索面板
│   ├── ThemeToggle.astro     深浅色切换
│   ├── SiteScripts.astro     全部客户端交互（集中挂载，避免重复绑定）
│   └── Footer.astro          页脚与社交链接
├── config/menu.js            导航结构唯一数据源
├── content/blog/*.mdx        文章 / 文档正文
├── content.config.ts         文章集合 schema
├── layouts/BaseLayout.astro  app-shell 栅格（顶栏 / 导航 / 正文 / 目录 / 页脚）
├── pages/                    路由
├── styles/global.css         设计令牌与全部共享样式
└── utils/posts.ts            取文章、排序、日期、阅读时长、分类解析
```

## 写一篇文章

在 `src/content/blog/` 下新建 `.md` 或 `.mdx`：

```yaml
---
title: 标题                       # 必填
description: 摘要                 # 会显示在卡片、RSS 与搜索索引
date: 2026-04-12
category: physics-e              # 填导航叶子节点的 path，见下
tags: ['标签一', '标签二']
draft: false                     # true 则不参与构建产物
---
```

`category` 决定文章归属哪个分类页：填 `src/config/menu.js` 里叶子节点的 `path` 片段
（如 `physics-e`、`container`、`game-guides`），填错时文章仍会出现在文章列表里。

上一篇 / 下一篇默认按日期自动推导，需要手动指定时写上 `prev` / `next`。

## 改导航

只改 `src/config/menu.js` 一处。侧边栏、顶栏面包屑、分类页路由、搜索索引都由它派生。

```js
{ label: '科创', path: 'tech', icon: '<path .../>', children: [ ... ] }
```

- 带 `children` 的节点渲染为可展开分组
- 带 `dedicated: true` 的节点表示它自己有独立页面（如 `tools` / `faq` / `about`），
  不会再由 `[...category]` 兜底路由生成，避免同一 URL 冲突

## 调样式

设计令牌集中在 `src/styles/global.css` 顶部的 `:root`、
`html[data-theme="light"]` 与 `html[data-theme="dark"]`：

| 令牌 | 作用 |
| --- | --- |
| `--r-lg` / `--r-md` / `--r-sm` | 卡片、面板、控件圆角 |
| `--surface-1/2/3` | 由远及近的玻璃表面不透明度 |
| `--blur` / `--sat` | 毛玻璃的模糊半径与饱和度 |
| `--accent*` | 强调色与悬停 / 按下态 |
| `--appbar-tint` | 顶栏的 MIUI 橙→蓝渐变薄层 |
| `--wallpaper` | 页面壁纸（纯 CSS 渐变，无图片依赖） |

字体使用平台原生栈（`Segoe UI Variable` / `MiSans`），未额外下载字体。

## 壁纸系统

顶栏齿轮按钮打开「壁纸设置」（右侧 Acrylic 抽屉），支持五种来源模式：

| 模式 | 说明 |
| --- | --- |
| 全随机 | Bing、二次元与所选游戏混合随机 |
| Bing 专属 | 只使用 Bing 每日壁纸 |
| 二次元专属 | 只使用二次元图源 |
| 游戏专属 | 只使用所选游戏，**与 Bing 互锁**；勾选 1 个即「某游戏专属」，勾选多个即「多游戏专属」 |
| 纯渐变 | 不加载图片，只保留内置渐变壁纸 |

另有：模糊与压暗滑杆、64 秒缓慢缩放动效、每 5/15/30/60 分钟自动更换。
全部设置存在 `localStorage` 的 `moying-wallpaper` 键下。

### 图源如何接入

图源集中定义在 `src/config/wallpapers.ts`。因为站点是纯静态托管、没有后端，
所有图源都必须由浏览器直接访问，因此分三类，**判定标准不同**：

- `kind: 'image'` 接口直接返回图片字节。作为 CSS `background-image` 使用**不需要 CORS**。
- `kind: 'json'` 接口返回 JSON，需要 `fetch` 读出图片地址，**必须**有 CORS。
- `kind: 'pool'` 游戏图集，图片直链放在 `public/wallpaper-manifest.json`，用到时才加载。

`buildPool()` 按当前模式挑出候选池；换壁纸时逐个尝试候选源，
某个源超时或 404 会自动换下一个，避免个别源抽风导致空白。

### 游戏图集清单

游戏素材仓库体积远超 jsDelivr 的 50MB 限制，**目录列表 API 会返回 403**，只有单文件直链可用，
所以文件名必须先枚举并固化。清单由脚本生成：

```sh
node scripts/gen-wallpaper-manifest.mjs
```

脚本用 `git clone --filter=blob:none --no-checkout --depth 1` 只下载 tree 对象
（整个仓库通常 1MB 以内，不下载任何图片），再用 `git ls-tree` 列出文件名 ——
这样**不受 GitHub API 匿名配额（60 次/小时）限制**，实测配额被用尽后这条路仍然可用。

已接入的图集（每个最多收录 100 张，共 474 条直链）：

| 图集 | 仓库内总数 | 分辨率（抽样） |
| --- | --- | --- |
| 蔚蓝档案 · 剧情背景 | 1670 | 1600x1124（最高，首选） |
| 明日方舟 · 剧情 CG | 829 | 1280x720 ~ 1600x900 |
| 明日方舟 · 场景背景 | 518 | 1024x576 |
| 碧蓝航线 · 画廊 | 480 | 1024x576 ~ 4091x2316 |
| 碧蓝航线 · 背景 | 74 | 1024x576 ~ 1920x1080 |

清单是构建时的一次性快照，55KB，仅在壁纸来源包含游戏图集时按需请求，
**不会内联进页面**（内联的只有约 2KB 的元数据）。链接失效时重新运行脚本即可。

### 已实测可用 / 不可用

| 图源 | 实测结论 |
| --- | --- |
| `bing.biturl.top` | ✅ 200 JSON，CORS 为 `*`，`index=random` 每次不同图 |
| `t.alcy.cc` / `t.mwm.moe` | ✅ 200 图片，每次不同图，接受随机参数（可缓存击穿） |
| `cdn.jsdelivr.net/gh/…` 游戏图集 | ✅ 206/200，content-type 正确（`Aceship/Arknight-Images`、`respectZ/blue-archive-viewer`、`AzurAPI/azurapi-js-setup`） |
| `loliapi.com/acg` | ⚠️ 稳定性一般，仅作备选 |
| `bing.com/HPImageArchive` | ❌ 无 CORS，浏览器 fetch 会被拦截 |
| `api.lolicon.app` | ❌ 带 `Origin` 请求返回 403 |
| `api.dujin.org` / `api.btstu.cn` | ❌ 521 / 连接失败，返回反爬混淆脚本 |
| `api.ennead.cc`（BlueArchiveAPI） | ❌ 无 CORS，且响应里没有图片字段 |
| `ArkAlliance/ArkAPI` | ❌ 只有后端源码，README 给的域名是无关项目或 TLS 失败 |
| `TomyJan/Kuro-API-Collection` | ❌ 需 POST + token + 伪造 APP 请求头，纯静态站无法调用 |
| `lsy-404/EndfieldGameData` | ❌ 只有 `TableCfg` JSON，没有图片文件 |
| `MaaStellaSora` / `NTE-Auto-Sign` | ❌ 自动签到脚本，只有 logo 与演示截图 |
| `arknights-wallpaper-generator` | ❌ Streamlit 应用，壁纸是服务端实时合成，无稳定直链 |

新增图源前请先按上面的判定标准实测，并把结论写进 `verified` 字段。

> ⚠️ 碧蓝航线皮肤立绘目录（`images/skins`，5788 个文件）擦边内容风险较高，**已刻意排除**，
> 只收录 `gallery` 与 `backgrounds`。其余图集为游戏场景与剧情素材。
> 这些图源均为第三方，可用性与内容不由本站保证。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm dev` | 开发服务器，默认 <http://localhost:4321> |
| `pnpm build` | 构建静态产物到 `dist/` |
| `pnpm preview` | 本地预览构建结果 |

## 部署

`output: 'static'`，产物为纯静态文件，可直接部署到 GitHub Pages。
`site` 与 `base` 在 `astro.config.mjs` 中配置（当前为 `https://moyingyilang.github.io/`，`base: ''`）。

## 说明

- 正文用系统字体渲染，原 Bear Blog 的 Atkinson 字体已从 `astro.config.mjs` 移除，
  字体文件仍保留在 `src/assets/fonts/`；恢复方法写在配置文件注释里。
- `prefetch` 已开启，站内链接进入视口即预取。
- 代码高亮为 Shiki 双主题，随 `<html data-theme>` 自动切换。
