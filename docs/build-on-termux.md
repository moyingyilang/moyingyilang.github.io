# 在 Termux（android-arm64）上本地构建这个站点

CI 在 x86 上跑，正常不需要这份说明。它存在的理由只有一个：**sharp 没有 android-arm64 的预编译二进制**，
在这台机器上 `pnpm install` 之后 `astro build` 会报 `Could not load the "sharp" module`。

## 一次性准备

```bash
pkg install libvips pkg-config clang
```

## 安装依赖

`pnpm` 在这台机器上装不了（rustls 的平台验证器在 Android 上初始化失败），用 npm：

```bash
npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
```

## 编译 sharp

sharp 的安装脚本会检查 `node-addon-api` 与 `node-gyp` **是否在项目依赖里**，
所以这两个要临时装进项目（**不要提交到 package.json**）：

```bash
npm i --no-save node-addon-api node-gyp
cd node_modules/sharp
SHARP_FORCE_GLOBAL_LIBVIPS=1 npm_config_build_from_source=true node install/build.js
cd ../..
```

产物是 `node_modules/sharp/src/build/Release/sharp-android-arm64-<版本>.node`。

## 构建

```bash
npx astro build
```

会看到一条 `VIPS-WARNING ... libOpenEXR-3_4.so not found`——那是 ImageMagick 模块还链着旧 soname，
不影响构建。若构建真报缺 `libOpenEXR-3_5.so`，`pkg install openexr` 即可。

## 注意

- `node_modules` 里的 sharp 是本机编译的产物，**不要删**：删了就得重来一遍。
- `package.json` 不要带上 `node-addon-api` / `node-gyp`，CI 不需要它们。
- 站点内容用 `src/content/blog/*.md`，frontmatter 的 `category` 必须是 `src/config/menu.js` 里的叶子 path。
