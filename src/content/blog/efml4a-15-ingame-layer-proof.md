---
title: "15 · 层已进入真实游戏进程（路线 A 的终极验证）"
description: "EFML4A 研究文档 · 15-ingame-layer-proof（Arknights: Endfield Mod Loader for Android）"
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


[14-ondevice-layer-proof.md](/blog/efml4a-14-ondevice-layer-proof/) 证明了层能在**自建探针**里加载并拦截。
本文记录下一步：**把层加载进《明日方舟：终末地》的真实进程**，并在其中稳定运行。

## 15.1 结论

| # | 结论 |
| --- | --- |
| G-1 | EFML4A 的 Vulkan 隐式层**能被加载进目标游戏进程**并长期驻留 |
| G-2 | 游戏**带着本层正常渲染**（CPU 61–123%、内存约 1.0 GB、无崩溃、无重启、无报错） |
| G-3 | **层放在 `/data/local/debug/vulkan/` 对游戏无效**；必须放在**游戏自己的 native lib 目录** |
| G-4 | 目标游戏确实使用 **Vulkan**（`/system/lib64/libvulkan.so` 与 `/vendor/lib64/hw/vulkan.adreno.so` 均已映射） |
| G-5 | 该游戏的 ACE 反作弊确实在进程内活跃（`libtersafe2.so`、`libtprt.so` 已映射） |

## 15.2 关键发现：层的发现路径取决于应用自身的 namespace

### 失败的做法

把层装在 `/data/local/debug/vulkan/`（[14](/blog/efml4a-14-ondevice-layer-proof/) 中探针成功的路径），
再设 `debug.vulkan.layers`，然后启动游戏：

| 观察 | 结果 |
| --- | --- |
| 游戏进程内的 `libVkLayer_EFML4A` 映射数 | **0**（层没进去） |
| 游戏表现 | Unity 图形初始化失败（`unable to initialize unity gfx`），进程随后退出 |
| dmesg 中与本层相关的 `avc: denied` | **无** |
| logcat 中的 linker 报错 | **无** |

失败机理：`debug.vulkan.layers` 只给出**层名**，loader 仍需在搜索路径里找到 `.so`。
游戏（`targetSdk 34`，SELinux 域 `untrusted_app_34`）与 Termux
（`targetSdk 27`，域 `untrusted_app_27`）**拿到了不同的 linker namespace**，
`/data/local/debug/vulkan` 这条路径对游戏不可用；loader 找不到层 →
`vkCreateInstance` 返回 `VK_ERROR_LAYER_NOT_PRESENT` → Unity 图形初始化失败。

> ⚠️ 未核实：`isDebuggable()` 与搜索路径选择在 API 37 上的逐行行为。
> 已排除的候选原因：`PR_SET_DUMPABLE=0`（游戏 `/proc/<pid>` 归自身 uid，说明 dumpable=1）、
> `TracerPid`（为 0）、SELinux 文件标签（无相关 avc 拒绝）。

### 成功的做法

把层 `.so` 放进**游戏自己的 native lib 目录**：

```
/data/app/~~…==/com.hypergryph.endfield-…==/lib/arm64/libVkLayer_EFML4A.so
```

再设 `debug.vulkan.layers`，启动游戏，6 秒内即观察到：

```
[6s] pid=14795 层模块=4 CPU=145
★★ 层已进入游戏进程！

7314052000-7314076000 r--p …  /data/app/…/lib/arm64/libVkLayer_EFML4A.so
7314079000-73140af000 r-xp …  /data/app/…/lib/arm64/libVkLayer_EFML4A.so
73140b2000-73140b8000 r--p …  /data/app/…/lib/arm64/libVkLayer_EFML4A.so
```

连续 32 秒观察：

| 时刻 | pid | 层映射段数 | CPU | 内存 |
| --- | --- | --- | --- | --- |
| 8s | 14795 | 4 | 61.5% | 956 MB |
| 16s | 14795 | 4 | 123% | 988 MB |
| 24s | 14795 | 4 | 110% | 968 MB |
| 32s | 14795 | 4 | 96.8% | 1.0 GB |

**同一个 pid 持续存活、层常驻、CPU 与内存在正常渲染区间、logcat 无 FATAL/ANR/SIGSEGV。**

这条路径与 AOSP 源码核对一致：`setupGpuLayers()` 会**无条件**把应用自己的 lib 目录
加入层的搜索路径（源码注释 "Include the app's lib directory in all cases"），
因此随 APK 的 `jniLib` 分发的层，**即使应用不可调试也能被 `debug.vulkan.layers` 加载**。

## 15.3 风险与现实约束

| 项 | 说明 |
| --- | --- |
| 需要 root | 写游戏 lib 目录、`setprop debug.vulkan.layers` 都需要 root |
| 修改了游戏安装目录 | 只新增一个文件，不加不改任何原有文件；删除该文件即完全还原 |
| 反作弊暴露 | ACE（`libtersafe2.so` / `libtprt.so`）在进程内，层被映射是否会被检出**未验证** |
| 属性非持久 | `debug.vulkan.layers` 重启即失效；但 lib 目录里的 `.so` 会**每次启动都被加载**，直到删除 |
| 卸载 | `su -c 'rm /data/app/…/lib/arm64/libVkLayer_EFML4A.so'` 且 `su -c 'setprop debug.vulkan.layers ""'` |

> **运营建议**：只在主动测试期间保留该文件，测试结束即删除，避免长期暴露。

## 15.4 与用户既有研究的关系

本项目作者此前对同一游戏做过独立的资源层逆向（见其《终末地逆向工程实战记录》，v1.4 CN）。
两条结论在此互为印证与补充：

| 该作者的结论 | 本项目的对应结论 |
| --- | --- |
| **读 `/proc/pid/mem` 不触发 ACE**，但 ptrace / Frida attach 会被检测并闪退 | 本路线**不使用 ptrace，也不注入调试器**，而是走 Vulkan loader 的官方层机制 |
| ACE 对动态 hook 极其敏感（Frida 需要每次重启 + spawn） | 层机制是**系统支持**的加载路径，不是非法的调试注入——但 §15.3 的暴露风险仍需实测 |
| 游戏资源在 `/storage/emulated/0/Android/data/<pkg>/files/VFS/`（`.blc` 加密索引 + `.chk` 数据） | 本路线**完全不碰资源包**，仅做渲染层替换，因而与资源加密无关 |
| 环境是 Magisk；本机现为 KernelSU | 两条路线都不依赖具体 root 方案，只需能 `setprop` 与写 lib 目录 |

## 15.5 尚未完成

| # | 项 | 说明 |
| --- | --- | --- |
| I-1 | 在游戏内取得**拦截计数** | 层默认不输出日志（日志开关走环境变量，而环境变量不会传到应用进程），需改为系统属性驱动或落盘 |
| I-2 | 在游戏内取得**逐 draw 侦察数据** | 识别角色部件需要 (pipeline, index_count, first_index, vertex_buffer) 等字段 |
| I-3 | 从「拦截」到「改写」 | 用自建 buffer 替换目标 draw 的顶点/索引缓冲（换模型本体） |
| I-4 | 与游戏自带层的共存 | 本机未观察到 `libVkLayer_mfrc.so`（联发科专属），但真实共存顺序未验证 |
| I-5 | 反作弊可观测性 | 层被 ACE 检出的可能性**完全未测**，这是本项目最大的未知风险 |

## 15.6 参考

- [14-ondevice-layer-proof.md](/blog/efml4a-14-ondevice-layer-proof/) —— 层在自建探针中的加载与拦截验证
- [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) —— 路线 A 的技术分析
- [08-threat-model.md](/blog/efml4a-08-threat-model/) —— 威胁模型与红线
- [13-real-mod-analysis.md](/blog/efml4a-13-real-mod-analysis/) —— 真实 EFMI mod 的一手剖析

---

## 15.7 后续实测：隐式层路线在本设备上被证伪（重要更正）

§15.1 的 G-1/G-2 只证明了「层 `.so` 被映射进游戏进程」，**不等于「层被挂进 Vulkan 调用链」**。
随后的落盘日志探针（构造函数 + 自省入口 + GIPA 三重埋点）给出了确定结论：

| 探针 | 结果 |
| --- | --- |
| 构造函数（`.so` 被 dlopen 时触发） | **触发 3 次** —— 库确实被加载 |
| `vkEnumerateInstanceLayerProperties`（loader 自省入口） | **一次都没有** |
| `EFML4A_GetInstanceProcAddr` | **一次都没有** |
| `efml4a::hooks::CmdDrawIndexed` | **一次都没有** |

### 分离实验：是谁 dlopen 了它？

把**所有**层启用配置清空（`debug.vulkan.layers` 置空 + 删除
`enable_gpu_debug_layers` / `gpu_debug_app` / `gpu_debug_layers` / `gpu_debug_layer_app`），
只把 `.so` 留在游戏自己的 `lib/arm64/` 目录里，再启动游戏：

**构造函数依然触发。**

⇒ **dlopen 不是 Vulkan loader 发起的，而是游戏自身（极可能是 ACE）在扫描自己的 lib 目录。**

### 结论

| # | 结论 |
| --- | --- |
| X-1 | **Vulkan 隐式层路线在本设备上不可用**：loader 从未把本层当作候选层 |
| X-2 | 把 `.so` 放进游戏 `lib/` 目录**不会**让它成为 Vulkan 层，只会让游戏/ACE 主动 dlopen 它 |
| X-3 | 因此 §15.1 的「层已进入真实游戏进程」应理解为**文件被映射**，而非**功能被挂载** |
| X-4 | ⚠️ **安全**：ACE 会主动 dlopen 游戏 lib 目录中的外来 `.so` —— 这是**可被检测的暴露面**，不应再使用该投放方式 |
| X-5 | 早前「`/data/local/debug/vulkan` 路径导致游戏图形初始化失败」的现象仍然成立（loader 报 `VK_ERROR_LAYER_NOT_PRESENT`），说明**属性路径确实被读取**，只是库无法被该进程加载 |

### 路线调整

既然 loader 准入在 `user` 构建 + 非 debuggable 应用上走不通，
**注入载体改为 Zygisk，拦截目标仍为 Vulkan**：

- Zygisk（本机 KernelSU 3.2.5 + ZygiskNext 已在运行）能在游戏进程内、Unity 初始化之前取得执行权；
- 我们在进程内 `dlopen("libvulkan.so")` 并接管 `vkGetInstanceProcAddr` / `vkGetDeviceProcAddr`；
- 这**完全绕开 loader 的层准入机制**，也不需要向游戏安装目录写入任何文件（消除 X-4 的暴露面）；
- 拦截目标不变，仍是 `vkCmdBindVertexBuffers` / `vkCmdBindIndexBuffer` / `vkCmdDrawIndexed`
  这些「换模型」真正依赖的调用。

> ⚠️ 未核实：这一改动的真机效果尚未验证。Zygisk 模块是否真能装载、
> inline hook 是否稳定、应用进程内读 `debug.*` 系统属性是否被 SELinux 允许，均待实测。

### 实测环境的两个附带发现

1. **本机 logcat 完全不可用**：`logcat -g` 显示所有 ring buffer 为 `0 B readable`。
   任何依赖 logcat 的观测方案在这台设备上都会失败，必须落盘。
2. **KernelSU 在 `execve` 时存在内核缺陷**：dmesg 中可见
   `seccomp_filter_release` ← `ksu_handle_execve_sucompat` ← `ksu_hook_execve`
   ← `ksu_syscall_dispatcher` 的 oops 调用栈，每次调用 `su` 都可能触发。
   与本项目无关，但会影响任何依赖频繁提权的脚本。

---

## 15.8 隐式层五条路径全部穷尽（定论）

§15.7 之后又系统性地试完了所有剩余组合。结论是**隐式层路线在本设备上彻底不可用**，
且失败原因有**两种不同机理**。

### 全部组合与结果

| # | 启用通道 | 层库位置 | 结果 |
| --- | --- | --- | --- |
| 1 | `debug.vulkan.layers` 属性 | `/data/local/debug/vulkan` | loader **尝试启用** → 库加载失败 → `VK_ERROR_LAYER_NOT_PRESENT` |
| 2 | `debug.vulkan.layers` 属性 | 游戏自身 `lib/arm64/` | loader **不予理会**；游戏/ACE 主动 dlopen（构造函数触发） |
| 3 | Settings 四件套 + **donor APK** | donor 的 APK 内 `lib/arm64-v8a/` | loader **完全无动作**（层映射数 0，无任何报错） |
| 4 | Settings 四件套（`gpu_debug_layer_app` 指向游戏自身） | 游戏自身 `lib/arm64/` | loader **不予理会**；游戏/ACE dlopen（构造函数触发 1 次） |
| 5 | 环境变量 `VK_LAYER_PATH` / `VK_INSTANCE_LAYERS` / `VK_LOADER_DEBUG` | 任意 | **被完全忽略**，连调试输出都没有 |

判别手段：层的构造函数（`.so` 被 dlopen 即触发）、`vkEnumerateInstanceLayerProperties`
（loader 自省入口）、`EFML4A_GetInstanceProcAddr` 三重埋点，全部写入游戏私有目录的落盘日志
（本机 logcat 不可用，见 §15.7）。

### 两种失败机理（关键）

**机理 A：属性通道 + 严格 linker namespace**

`debug.vulkan.layers` 通道**没有** debuggable 检查——所以组合 1 中 loader 确实尝试启用了本层
（否则不会返回 `LAYER_NOT_PRESENT`）。它败在**加载库**这一步：

- 游戏 `targetSdk 34` → 域 `untrusted_app_34` → **严格 linker namespace**，
  `/data/local/debug/vulkan` 不在其中，`dlopen` 失败；
- Termux `targetSdk 27` → 域 `untrusted_app_27` → **宽松（legacy）namespace**，
  所以自建探针能成功加载同一个 `.so`。

这解释了「同一个层、同一台设备，探针能加载而游戏不能」。

**机理 B：Settings 通道 + debuggable 准入**

Settings 通道走框架的 `GraphicsEnvironment.debugLayerEnabled()`。
组合 3/4 表现为**完全无动作、无报错**，说明框架**根本没把本层告诉 loader**，
而不是告诉了但加载失败。

准入条件是 `isDebuggable() || canInjectLayers(ai)`：
- `canInjectLayers(ai)` 要求**目标应用自己在 manifest 里声明**
  `com.android.graphics.injectLayers.enable`——游戏没有；
- `isDebuggable()` 在本机 `user` 构建上为假。

> ⚠️ 未核实：子代理从 AOSP `a16` 分支读到的是 `prctl(PR_GET_DUMPABLE) > 0 || ANDROID_DEBUGGABLE`，
> 而普通应用进程的 `PR_GET_DUMPABLE` 默认为 1——按该公式本应通过，但**实测为假**。
> 可能原因：该实现随 AOSP 版本/构建类型变化，或判定发生在 `PR_SET_DUMPABLE` 被改动之后。
> 无论原因如何，**本机上的实测结论是确定的**：这条路对本游戏不通。

### 定论

| # | 结论 |
| --- | --- |
| **X-6** | **隐式层路线（`vulkan-layer/` 的隐式层形态）在本设备 + 本游戏上不可行**，五条通道全部穷尽 |
| X-7 | 根因两条：属性通道败于严格 linker namespace，Settings 通道败于 debuggable 准入 |
| X-8 | Android **不读层 JSON manifest**，靠扫描 `libVkLayer*.so` + 自省导出发现层（§14.5） |
| X-9 | 把 `.so` 放进游戏 lib 目录**只会**被游戏/ACE dlopen，**不会**成为 Vulkan 层，且是可检测的暴露面 |
| X-10 | ⇒ **注入载体必须改为 Zygisk**（本机 KernelSU 3.2.5 + ZygiskNext 1.5.0 已运行） |

`vulkan-layer/` 的代码并未浪费：它已证明「拦截 + 转发」正确
（§14.10 的 `vkCmdBindVertexBuffers=1` / `vkCmdBindIndexBuffer=1`），
这些 hook 实现将在 Zygisk 方案里以「上游指针由真实 `vkGetDeviceProcAddr` 提供」的形式复用。

### 附：组合 3 所用的 donor APK（已清理）

为验证 Settings + donor 通道，在设备上**从零构造并签名了一个 donor APK**：

- 复用 `com.example.endfieldkey` 的 manifest（AXML 为 UTF-16LE，包名出现 2 次）
- **等长替换**包名 → `com.example.efml4adonor`（同为 22 字符，AXML 结构不变）
- 加入 `lib/arm64-v8a/libVkLayer_EFML4A.so`（STORED 不压缩）
- 用 `keytool` 生成密钥、`apksigner` 重签（v1+v2）
- 该 APK 已成功安装并生效于 Settings，但 loader 无动作 → 测试后**已卸载，设备无残留**
