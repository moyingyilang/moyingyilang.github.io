---
title: "01 · 项目定位与研究问题"
description: "EFML4A 研究文档 · 01-overview（Arknights: Endfield Mod Loader for Android）"
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


## 1.1 一句话定位

EFML4A 研究**如何在 Android 设备上实现 PC 端 EFMI 那样的换模型 mod 加载器**。
它是一个**研究性**项目，不是产品；当前阶段（进入维护阶段之前）**始终为私有仓库**。

## 1.2 为什么这是一个真问题

PC 上的换模型 mod 生态已经成熟了十几年：3DMigoto 用一个代理 DLL 劫持 Direct3D，
在图形 API 边界上把游戏要画的顶点/索引缓冲换掉，游戏逻辑完全不知情。EFMI 是这条
技术脉络上针对《明日方舟：终末地》的最新实现，见 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/)。

Android 上这套东西**无法直接搬运**，原因是根本性的：

| PC（EFMI） | Android |
| --- | --- |
| 代理 `dxgi.dll` / `d3d11.dll` 即可注入 | 没有 DXGI；Android 图形栈是 Vulkan / GLES |
| 任意进程可注入 DLL | 进程隔离 + SELinux + linker namespace；注入需要 root 或可调试 |
| 游戏是"厂商已停止维护的旧引擎"居多 | 目标游戏是活跃运营的 Unity 游戏，有完整性校验与版本更新 |
| 玩家可自由替换游戏目录文件 | 资源在 APK/OBB 或首次下载的私有目录中，受 scoped storage 约束 |

因此在 Android 上，「换模型」这件事需要**重新选型**——这正是本项目要回答的问题。

## 1.3 研究问题

1. **注入点**：Android 上有哪些可行的注入面？各自能触达图形 API、Unity 运行时、资源层
   中的哪一层？（→ [03-android-injection-surface.md](/blog/efml4a-03-android-injection-surface/)）
2. **图形层可行性**：Vulkan 隐式层能否实现 3DMigoto 式的顶点/索引缓冲替换？代价是什么？
   （→ [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)）
3. **运行时层可行性**：hook Unity IL2CPP 直接替换 `Mesh` 数据，相比图形层是更优解吗？
   （→ [05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/)）
4. **资源层可行性**：直接替换 AssetBundle 是不是性价比更高的路径？它缺失了什么能力？
   （→ [06-route-assetbundle.md](/blog/efml4a-06-route-assetbundle/)）
5. **格式问题**：EFMI 的 mod 表达方式是「ini + HLSL + 数据文件」，与 3DMigoto 解释器强绑定。
   如果要支持多个后端，mod 格式应该长什么样？（→ [10-mod-format.md](/blog/efml4a-10-mod-format/)）
6. **代价问题**：EFMI 的 README 明确指出老 GIMI 式方案会带来高达 50% 的 FPS 损失，
   并用「不做每帧 50000 次无意义哈希」作为自己的卖点。在移动设备上，
   功耗与帧率的预算更紧，这条约束会更硬。（→ [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/) §优化）
7. **风险问题**：这样做会被反作弊发现吗？法律与许可证上有什么约束？
   （→ [08-threat-model.md](/blog/efml4a-08-threat-model/)）

## 1.4 目标设备（本阶段基准）

所有路线评级都以这台实测设备为基准。设备信息通过只读的 `getprop` 获得：

| 项目 | 值 |
| --- | --- |
| 机型 | Xiaomi 24122RKC7C |
| SoC | SM8750（Snapdragon 8 Elite，平台代号 `sun`） |
| GPU | Qualcomm **Adreno**（`ro.hardware.egl=adreno`，`ro.hardware.vulkan=adreno`，`/vendor/lib64/hw/vulkan.adreno.so` 存在） |
| ABI | `arm64-v8a`（单一 ABI） |
| 系统 | Android **17**（API **37**） |
| 构建类型 | `ro.build.type=user`，`ro.build.tags=release-keys`（**非 userdebug**） |
| 权限 | 已 root（具备提权能力） |

两个结论直接来自这张表：

1. **Adreno 是有利条件**。Adreno 是移动端逆向与图形调试生态最成熟的 GPU，
   Vulkan 层与 GPU 捕获工具的可观测性最好。
2. **`user` 构建是限制条件**。Vulkan 隐式层的准入条件之一是「系统为 userdebug 且授予 root」，
   这条不成立。因此只能走「让目标 app 看起来可调试」或「让 app 自愿 opt-in」这两条路，
   详见 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) §准入。

## 1.5 范围与非目标

**在范围内：**
- 模型（网格）替换、骨骼合并、形态键（表情）注入、材质与贴图覆盖
- 各注入路线的可行性验证与原型
- mod 包格式设计、校验与工具链（Rust / Kotlin，TUI 或混合架构 GUI）

**明确不在范围内（红线）：**
- 修改游戏数值、经济、掉落、战斗结果
- 任何联网对局中的作弊行为（透视、自动瞄准、自动战斗）
- 分发游戏原始资源、密钥或绕过 DRM 的实现
- 提供破解版游戏或规避正版校验的工具

红线清单的完整论证与执行细节见 [08-threat-model.md](/blog/efml4a-08-threat-model/)。

## 1.6 与 EFMI 的关系

EFMI 是本项目的**对标基线与概念来源**，不是代码来源：

- **借鉴的概念**：在图形 API 边界替换数据、用签名识别目标 draw call、骨骼合并、
  形态键的量化与上传、mod 以数据文件而非代码分发。
- **不复用的部分**：EFMI 的 `d3dx.ini` / HLSL 实现与 3DMigoto 运行时强绑定，
  在 Android 上无处运行。EFML4A 定义自己的 IR（[10-mod-format.md](/blog/efml4a-10-mod-format/)），
  并设计一条 EFMI mod → EFML4A mod 的**映射表**，而非直接兼容。
- **许可证**：EFMI 系（EFMI-Package / EFMI-Tools）为 **GPL-3.0**。EFML4A 采用
  **AGPL-3.0**。若日后需要参考其代码或资源，须先做许可证兼容性分析，
  见 [08-threat-model.md](/blog/efml4a-08-threat-model/)。

## 1.7 交付物

| 交付物 | 位置 | 说明 |
| --- | --- | --- |
| 研究文档集 | `docs/` | 本目录 |
| 核心领域模型 | `native/crates/efml-core` | mod 清单、IR、识别策略、包校验 |
| TUI / CLI 工具 | `native/crates/efml-cli` | `efml validate/info/list/checksum/routes/tui` |
| 混合架构 GUI | `native/crates/efml-gui` | Rust 核心 + 本地 Web UI |
| Vulkan 隐式层骨架 | `vulkan-layer/` | 可编译、可装载、可拦截转发的层骨架 |
| Android 侧 | `android/` | 管理器 App 与 LSPosed/Zygisk 模块骨架 |
| 示例 mod 包 | `mods/example-mod/` | 格式规范的参考实现 |

## 1.8 分阶段推进

见 [11-roadmap.md](/blog/efml4a-11-roadmap/)。当前处于 **M0（可行性论证与骨架）**。
