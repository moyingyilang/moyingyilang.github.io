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

顶栏齿轮按钮打开「壁纸设置」（右侧 Acrylic 抽屉）。**默认是 Bing 专属**，
来源模式按从最宽到最窄排列：

| 模式 | 说明 |
| --- | --- |
| 全部随机 | Bing、二次元与游戏混合随机（唯一会把 Bing 与二次元混用的模式） |
| **Bing 专属**（默认） | 只使用 Bing 每日壁纸 |
| 二次元全部随机 | 全部二次元图源 + 全部游戏图集，**不含 Bing** |
| 二次元自选 | 只使用自己勾选的图源，**不含 Bing**；选中后展开二级菜单 |
| 纯渐变 | 不加载图片，只保留内置渐变壁纸 |

「二次元」这里按 **ACG 统称**理解，包含二次元图源与游戏图集。
「二次元自选」的**二级菜单**里分两组勾选：

- **二次元图源**：Alcy / Mwm / Loliapi
- **游戏图集**：蔚蓝档案、明日方舟、碧蓝航线（其余四款标注了无法接入的原因，不可勾选）

另有：模糊与压暗滑杆、64 秒缓慢缩放动效、每 5/15/30/60 分钟自动更换。
全部设置存在 `localStorage` 的 `moying-wallpaper` 键下。

> Bing 与游戏图集互锁：只有「全部随机」会同时使用两者，
> 其余模式要么只走 Bing，要么只走二次元/游戏。

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
| `pnpm verify` | **推送前自检**：构建 + 产物校验（等价于下面两条一起跑） |
| `pnpm check:links` | 校验产物：关键文件、内部链接、搜索索引、图集清单 |
| `pnpm check:wallpapers` | 检测壁纸图集直链是否失效（支持 `-- --sample 30`） |
| `pnpm refresh:wallpapers` | 重新枚举游戏仓库文件名并覆盖图集清单 |

### 维护脚本

`scripts/check-links.mjs` 在构建之后校验 `dist/`：
关键产物是否齐全（13 项）、所有内部 `href` 能否解析到真实文件、
`search-index.json` 与 `wallpaper-manifest.json` 是否可解析且非空。
有问题时退出码为 1，可直接用作 CI 门禁。

`scripts/check-wallpapers.mjs` 逐个探测 474 条图集直链（只取前 1KB），
用来发现第三方图源腐坏。图集链接失效时重新跑 `refresh:wallpapers` 即可。

## 部署

`output: 'static'`，产物为纯静态文件，部署到 GitHub Pages，
工作流在 `.github/workflows/deploy.yml`（push 到 `main` 或手动触发）。

CI 用 `withastro/action@v3`，它内部的 `pnpm/action-setup` 会在
`version` 为空时回退读取 `package.json` 的 `packageManager` 字段，
所以 **pnpm 版本由 `package.json` 决定**，不要在 workflow 里重复指定，
否则两者不一致会报 `ERR_PNPM_BAD_PM_VERSION`。

### 关于 pnpm 12 与 lockfile

项目 pin 了 `pnpm@12.4.0`。pnpm 12 会为它自管理的包管理器版本
在 `pnpm-lock.yaml` 顶部写入**第二个 YAML 文档**（`packageManagerDependencies`），
所以该文件由两段 `---` 分隔的文档组成，这是 pnpm 12 的行为，不是文件损坏。
已实测：pnpm 11 与 pnpm 12 都能正常读取它，`--frozen-lockfile` 均通过。

构建脚本白名单（esbuild / sharp）在 **`pnpm-workspace.yaml`** 里，
因为 pnpm 12 已不再读取 `package.json` 的 `pnpm` 字段。

## 说明

- 正文用系统字体渲染，原 Bear Blog 的 Atkinson 字体已从 `astro.config.mjs` 移除，
  构建产物不含 woff 文件；`src/assets/fonts/` 下的文件仅为保留恢复路径，恢复方法写在配置注释里。
- `prefetch` 已开启，站内链接进入视口即预取。
- 代码高亮为 Shiki 双主题，随 `<html data-theme>` 自动切换。
- 内容集合只保留一份 `src/content.config.ts`；旧版 `src/content/config.ts`
  与失效的 `BlogPost.astro` / `HeaderLink.astro` / `FormattedDate.astro` 均已删除。

### Astro 7 升级注意事项

项目已升级到 **Astro 7.3.5 + @astrojs/mdx 8.0.2**（Astro 7 内部换成 Rust 的 rolldown 打包器）。
两处需要留意的破坏性变更：

1. **`compressHTML: true` 是刻意保留的。**
   Astro 7 把默认值从 `true` 改成 `'jsx'`（按 JSX 规则剥离空白）。本项目的模板里有依赖
   「源码换行缩进」产生行内空格的写法，在 `'jsx'` 下会粘连成 `代码以AGPL v3.0授权`。
   已实测：保留 `true` 时，8 个页面的渲染文本与 Astro 6 时期逐字一致。
   若将来要改用 `'jsx'` 默认值，需先把模板里的行内空格改成显式写法（`{' '}`）。

2. **`sharp` 必须作为直接依赖保留。**
   它声明了 `peerDependenciesMeta` 却没有对应的 `peerDependencies`，pnpm 在解析时会生成
   带 peer 后缀的目录（`sharp@0.35.5_@types+node@24.19.0`）。若 lockfile 与 `node_modules`
   不一致，根目录会出现指向 `sharp@0.35.5`（无后缀）的**断链**，
   于是 Astro 打包进 `dist/.prerender/` 的图片服务找不到 sharp，构建报
   `Could not find Sharp`。**CI 是干净安装，遇到这个问题会直接部署失败。**

   判断方法：`node -e "import('sharp')"` 应当在项目根可加载。
   若出现断链，删除 `node_modules` 与 `pnpm-lock.yaml` 后重新 `pnpm install` 重建 lockfile 即可。

3. **Markdown 表格现在能正常渲染了。**
   Astro 6 时期（Sätteri 之前的管线）Markdown 表格被渲染成一整段字面竖线文本，
   线上页面实测 `<table>` 数量为 0；升级后渲染为真正的 `<table>`（4 行 12 单元格）。

## 许可

本站代码以 **GNU Affero General Public License v3.0**（`AGPL-3.0-only`）授权，
完整条款见 [LICENSE](./LICENSE)（与 gnu.org 官方原文逐字节一致）。

选择 `AGPL-3.0-only` 而非 `-or-later` 是刻意的：前者不允许被许可方自行套用未来的新版条款，
是常见开源许可里约束最强的一种。要点：

- 衍生作品必须以同样的 AGPL 条款开放
- **第 13 条（Remote Network Interaction）**：若你把修改后的版本作为网络服务提供，
  必须向使用者提供对应源码
- 必须保留版权声明与许可声明，且不得附加额外限制

`package.json` 的 `license` 字段同步为 `AGPL-3.0-only`；
页脚与「关于」页都标注了许可，页脚不再写「保留所有权利」（那与许可证相矛盾）。

### 第三方内容不在许可范围内

许可证覆盖的是**本站代码与站主原创内容**。以下内容版权属于各自权利人，本站不再分发它们：

| 内容 | 来源 | 说明 |
| --- | --- | --- |
| 壁纸图片 | Bing 每日壁纸、`t.alcy.cc` / `t.mwm.moe` 等二次元图源 | 由浏览器**外链**拉取，仓库内只有 URL 清单 |
| 游戏图集 | 蔚蓝档案、明日方舟、碧蓝航线的素材仓库（经 jsDelivr 分发） | 同上，`wallpaper-manifest.json` 只存 URL |
| 游戏素材版权 | 各游戏开发商 / 发行商 | 仅作个人站点的壁纸展示，不得商用 |
| 图标 | GitHub、哔哩哔哩、酷安 的官方图标 | 仅用于链接到对应平台 |

若你要把本站用于商业用途，请先自行确认这些第三方素材的授权状况。

## AI 参与声明

本站的**视觉系统、壁纸系统与工程维护**部分由 AI 编程助手协作完成：

- Fluent (Windows 11 Acrylic / Mica) × MIUI 毛玻璃设计系统：设计令牌、玻璃组件、深浅色双主题
- 顶栏、侧边导航树、页脚与正文排版的重构
- 可调壁纸系统：五种来源模式、设置面板、游戏图集清单生成脚本
- 内容集合与路由修复、命令面板搜索、图片灯箱、回到顶部等交互
- 维护脚本（产物校验、图源失效检测）与依赖、CI 配置排查

参与形式：**DeepSeek Harness**（模型 `deepseek-flash`），担任 AI 编程助手。
选题、内容与最终取舍由站主决定并负责；AI 生成或修改的代码已尽力测试，但不提供任何担保。

声明数据集中在 [`src/consts.ts`](./src/consts.ts) 的 `AI_CONTRIBUTION`，
改这一处即可同时更新「关于」页与页脚，不必去翻各个组件。

### 让 git 历史也记录这一参与

GitHub **协作者**无法由 AI 自行添加（AI 没有 GitHub 账号，也无法接受邀请）。
若希望提交记录里也能体现，可以在 commit message 末尾加 trailer：

```text
feat: 壁纸系统支持五种来源模式

Co-Authored-By: DeepSeek Harness <noreply@deepseek.com>
```

GitHub 会把带 `Co-Authored-By` 的提交在提交页显示为双作者。
也可以建一个 `CONTRIBUTORS.md`，或在某个提交上打 `Assisted-by:` trailer（非标准但可读）。
