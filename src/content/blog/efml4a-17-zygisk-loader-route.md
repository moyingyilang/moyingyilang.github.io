---
title: "17 · 经 `zygisk-loader` 的 payload 注入路线（本项目最终选定的载体）"
description: "EFML4A 研究文档 · 17-zygisk-loader-route（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

> 本文档是 EFML4A 研究文档集的一部分，索引见 [docs/README.md](/cs/reverse/)。


## 17.1 为什么放弃前两条路

| 路线 | 结论 | 证据 |
| --- | --- | --- |
| 隐式 Vulkan 层 | **不可行** | [15](/blog/efml4a-15-ingame-layer-proof/) §15.8：五条通道全部穷尽 |
| 自建 Zygisk 模块 | **受阻** | 文件被 zygiskd 收录，但 `registerModule` 后无任何回调；根因指向 `ZYGISK_API_VERSION` 兼容性 |
| LSPosed 新 API 模块 | **受阻** | 即使真重启，`dex2oat_service.db` 始终不收录我们的模块（可工作模块有记录） |

## 17.2 `zygisk-loader` 是什么

`Zygisk Loader v2.0.1`（HanSoBored），自述为 *a dynamic payload injection module*。
它自身是一个 Zygisk 模块，但**它解决的是"把任意 .so 送进目标进程"这件事**，
从而让使用者**不必再写 Zygisk 模块**。

从它的 `.so` 中提取到的关键字符串（即其工作流程）：

```
/data/adb/modules/zygisk-loader/config/target.json
Target Detected: %s (Base: %s)
Failed to read file (errno=%d)
Payload missing ELF magic / Payload arch mismatch: expected AARCH64
memfd_create unavailable (errno=%d), falling back to temp file injection
%s/zygisk-payload-XXXXXX
android_dlopen_ext
Module registration FAILED — check Zygisk API version compatibility
Zygisk-Loader Initialized
```

流程：读 `target.json` → 命中目标 app → 读指定 payload → **memfd 匿名映射**（回退临时文件）
→ `android_dlopen_ext` 加载 ⇒ **payload 的构造函数在目标进程内执行**。

> 值得注意：`Module registration FAILED — check Zygisk API version compatibility`
> 这句是 loader 自带的诊断串，**独立印证了本项目对 Zygisk API 版本兼容性的判断**
> （见 §17.5）。

## 17.3 配置文件格式

`/data/adb/modules/zygisk-loader/config/target.json`：

```json
[
  { "app": "com.hypergryph.endfield",
    "lib": "/data/adb/modules/zygisk-loader/config/libgetkey.so" }
]
```

同一个 app 可以有多个条目（本项目就在保留原有条目之外追加了自己的 payload）。

## 17.4 payload 的形态：**普通 .so**

以设备上已有的、已验证可用过的 payload `libgetkey.so` 为样本（19 字节 ELF 头 + AArch64）：

- **导出 `init()`**（`_Z4initv`），且 `.init_array` 里有指向它的重定位
  （文件内该节为 0，加载时由 `R_AARCH64_ABS64` 填上函数地址）；
- 字符串 `Constructor called, reading key immediately...` 说明**构造函数也被用作入口**；
- 依赖仅 `liblog / libdl / libc / libc++_shared / libm`。

⇒ **payload 可以是「带构造函数的任意 .so」**，无需任何 Zygisk/Xposed 头文件或约定。
本项目的 payload 因此可以直接复用 `vulkan-layer/` 里已写好的拦截与转发逻辑。

## 17.5 与本项目已有工作的关系

- **不碰 ptrace**：用户的实战文档（`/sdcard/articles/endfield.md`）记录 ACE 会检测
  ptrace 与 Frida attach（`dc` 后立即闪退）。`zygisk-loader` 的进程内 `dlopen`
  路线**完全不使用 ptrace**，这是它相对 Frida 的根本优势。
- **`/proc/pid/mem` 是安全侦察通道**：同一文档指出读 `/proc/pid/mem` 不触发 ACE
  （仅需 root）。这为「侦察 Android 端真实顶点布局」（关键路径 D-14）提供了
  一条**无需注入**的取证手段。
- **资源格式**：文档给出 VFS 布局（`.blc` = ChaCha20 加密索引，nonce 取偏移 4 起 12 字节，
  counter 从 1 开始即 `seek(64)`；`.chk` = 数据）与 3688 条路径（`.ab/.pck/.usm/.hgmmap`），
  直接充实 [06-route-assetbundle.md](/blog/efml4a-06-route-assetbundle/)。

## 17.6 迭代成本

`target.json` 与 payload 都是**文件**。若 loader 在每次 app specialization 时重新读取配置，
则迭代 = 「替换 payload 文件 + 强制停止游戏再启动」，**不需要重启设备、不需要重启框架**。
这一点待实测确认（见 §17.7）。

## 17.7 待验证

- [ ] loader 是否在**每次** app 启动时重读 `target.json`（决定迭代成本）
- [ ] 同一 app 的多个条目是否都会被注入
- [ ] payload 的入口究竟是构造函数还是 `init()`（或两者皆可）
- [ ] 注入后游戏是否仍能正常渲染（ACE 是否对新增匿名可执行映射有反应）

## 17.8 参考

- 设备上 `Zygisk Loader v2.0.1` by HanSoBored（`/data/adb/modules/zygisk-loader`）
- 用户的实战文档 `/sdcard/articles/endfield.md`（VFS 解密与 ACE 对抗，2026-08-14）
- [15-ingame-layer-proof.md](/blog/efml4a-15-ingame-layer-proof/) · [16-two-real-mods.md](/blog/efml4a-16-two-real-mods/)
