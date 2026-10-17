---
title: "14 · 真机突破：arm64 Vulkan 隐式层已在设备上加载并拦截成功"
description: "EFML4A 研究文档 · 14-ondevice-layer-proof（Arknights: Endfield Mod Loader for Android）"
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


**这是本项目的第一个端到端技术验证。** 它把 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)
中大量「应该可以」的推断，变成了**在目标设备上实测到的「确实可以」**，并且推翻了
[11-roadmap.md](/blog/efml4a-11-roadmap/) 中关于准入门槛的一个悲观假设。

## 14.1 结论摘要

| # | 结论 | 性质 |
| --- | --- | --- |
| P-1 | EFML4A 自研的 Vulkan 隐式层**能在设备上直接编译出 arm64 产物**，无需 x86-64 容器 | 工具链突破 |
| P-2 | 该层**能被 Android 17 的 Vulkan loader 加载进应用进程**，并真实拦截到 `vkCreateInstance` | 注入突破 |
| P-3 | Android 的 loader **完全忽略 `VK_LAYER_PATH` / `VK_INSTANCE_LAYERS` / `VK_LOADER_DEBUG` 等环境变量**，只能走系统属性 | 负面结论（重要） |
| P-4 | `debug.vulkan.layers` 属性路径**在 `user` 构建 + 非 debuggable 应用上依然生效** | 推翻原假设 |
| P-5 | 真正的拦路虎不是可调试位，而是 **SELinux 标签**：`/data/local/debug/vulkan` 默认 `system_data_file`，应用域读不到 | 新的关键知识 |
| P-6 | **Android 的 loader 完全不读层 JSON manifest**；层靠扫描 `libVkLayer*.so` + `.so` 自省导出发现 | 更正了 P-5 的因果解释 |
| P-7 | 层的准入门槛实际是 `prctl(PR_GET_DUMPABLE) > 0`，而**普通应用进程默认为可 dump** | 解释了 P-4 为何成立 |

## 14.2 P-1：在设备上编译 arm64 原生代码

### 问题

NDK 的预编译工具链位于 `toolchains/llvm/prebuilt/linux-x86_64/`，**全是 x86-64 二进制**，
在 arm64 的 Termux 上直接执行会得到：

```
cannot execute binary file: Exec format error
```

因此「装个 NDK 就能在设备上编译」是错的，NDK 自带的 CMake 工具链在设备上必然失败
（表现为找不到 `toolchains/llvm/prebuilt/bin/clang++`，因为 host tag 推导为空）。

### 解法

**NDK 的 `sysroot` 只是数据**（bionic 头文件 + 静态库），不需要执行；而
**Termux 自带的 clang 本身就是 Android 目标编译器**：

```
$ clang --version
clang version 21.1.8
Target: aarch64-unknown-linux-android24
```

所以组合是：**Termux 原生 clang + NDK sysroot**。

```bash
clang++ --target=aarch64-linux-android29 \
        --sysroot=$NDK/toolchains/llvm/prebuilt/linux-x86_64/sysroot \
        -fPIC -O2 -std=c++17 -fvisibility=hidden ...
```

### 两个必然踩到的链接坑

1. **静态库必须在目标文件之后。**
   把 `libc++_static.a` 写在 `.o` 前面，会得到一长串
   `undefined symbol: operator new(unsigned long)` / `operator delete`。
2. **`libc++abi.a` 内部会用 `-l:libunwind.a` 请求 unwind 库。**
   它不在 sysroot 里，而在 clang 的 resource 目录：
   `lib/clang/<ver>/lib/linux/aarch64/`。必须用 `-L` 把这个目录加进搜索路径，
   否则报 `unable to find library -l:libunwind.a`。

### 产物（实测）

| 属性 | 值 |
| --- | --- |
| 架构 | `AArch64`（ELF64，`e_machine=0xb7`） |
| 大小 | 2 851 672 字节 |
| `NEEDED` | `liblog.so` / `libdl.so` / `libm.so` / `libc.so` |
| **不含** | **`libc++_shared.so`** —— 静态链接了 libc++，因此可干净加载进任意应用进程 |
| 导出 | `vkNegotiateLoaderLayerInterfaceVersion`、`EFML4A_GetInstanceProcAddr`、`EFML4A_GetDeviceProcAddr`、`EFML4A_GetPhysicalDeviceProcAddr`、`EFML4A_GetStatsJson` |

可复现脚本：`vulkan-layer/scripts/build-android-termux.sh`（私有主仓）。

## 14.3 P-3：环境变量路径被彻底关闭

在没有设置任何属性的情况下，依次尝试下列环境变量，探针输出的层数量**始终为 0**，
`vkCreateInstance` 也从未加载本层：

| 环境变量 | 结果 |
| --- | --- |
| `VK_LAYER_PATH=<层目录>` | 被忽略 |
| `VK_INSTANCE_LAYERS=VK_LAYER_EFML4A_model_replacer` | 被忽略 |
| `VK_LOADER_DEBUG=error,warn,layer` | **完全没有输出** |

结论：**AOSP 的 Vulkan loader 关闭了所有基于环境变量的选层路径**。
这一点必须写进路线 A 的实现前提：桌面上的调试手法（`VK_INSTANCE_LAYERS` 等）
在 Android 上一条都不可用，只能走系统属性 / 全局设置。

## 14.4 P-4 / P-5：准入门槛的真实边界

### 实测过程

1. 用 root 把层复制到 `/data/local/debug/vulkan/`（该目录原本不存在，需要创建）。
2. `setprop debug.vulkan.layers VK_LAYER_EFML4A_model_replacer`。
3. 运行 arm64 Vulkan 探针。

**第一次结果（失败，但信息量极大）：**

```
[probe] 枚举实例层 -> VkResult=0, 共 0 个
[probe] vkCreateInstance -> VkResult=-6      ← VK_ERROR_LAYER_NOT_PRESENT
```

`-6` 而非「静默忽略」说明：**loader 确实读取了属性、并尝试启用本层**，
只是**发现不了层的 manifest**。也就是说，属性路径**没有被 debuggable 检查拦下**。

**根因**：`/data/local/debug/vulkan` 被我创建后默认标签是 `u:object_r:system_data_file:s0`，
而应用进程的 SELinux 域是 `untrusted_app`，**无权读取该类型**，
于是 loader 连目录里的 **`.so`** 都打不开，自然无法自省出层名。

> ⚠️ **这里我最初的解释是错的**：我一度以为是「loader 读不到 JSON manifest」。
> §14.5 的对照实验证明 **Android 根本不读 manifest**，真正被 SELinux 挡住的是 `.so` 本身。

**修复**：把目录与文件改标为全局可读的 `apk_data_file`。

```bash
su -c 'chcon -R u:object_r:apk_data_file:s0 /data/local/debug/vulkan'
```

**第二次结果（成功）：**

```
[probe] 枚举实例层 -> VkResult=0, 共 1 个
[probe] vkCreateInstance -> VkResult=0, instance=0xb400006e8ef7f910
[probe] 层是否已映射进本进程: 是
[probe] 层统计: {"layer":"VK_LAYER_EFML4A_model_replacer",
                "counters":{"vkCreateInstance":1, "vkCreateShaderModule":0, ...}}
```

最后一行是**最硬的证据**：`vkCreateInstance` 计数为 **1**，说明
**层代码在真实 Adreno 驱动环境下被调用并完成了拦截转发的往返**。

### 设备状态（用于判断准入门槛）

| 属性 | 值 |
| --- | --- |
| `ro.debuggable` | **0** |
| `ro.build.type` | **user** |
| `getenforce` | Enforcing |
| 探针所属应用 `com.termux` 的 flags | **`flags=0x0`（无 `DEBUGGABLE`）** |

**在一个非 debuggable 的应用进程、`user` 构建的设备上，层成功加载了。**

### 与公开研究的差异（诚实标注）

[08-threat-model.md](/blog/efml4a-08-threat-model/) 与 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)
依据 Promon 的 GPU debugger 报告，把准入门槛描述为
「app 可调试 **或** userdebug+root **或** Android 11+ 应用自愿 opt-in」。
本次实测显示，**`debug.vulkan.layers` 这条路径在本机并不要求应用可调试**。

> ⚠️ 未核实/需谨慎：这不等于 Promon 的结论错了。Promon 描述的是
> **框架层的全局设置路径**（`enable_gpu_debug_layers` + `gpu_debug_app` + `gpu_debug_layers`），
> 那条路径由 `GraphicsEnv` 实现，**确实会检查应用的 `FLAG_DEBUGGABLE`**。
> 本次走的是**更低层的系统属性** `debug.vulkan.layers`，二者是不同的代码路径。
> 我们的结论只对后者、且只对本机 Android 17 (API 37) 成立，不能外推到其他版本。

### 对路线 A 的意义

准入门槛从「root **+** 让目标应用看起来可调试」降为「**仅 root**」——
而目标游戏 `com.hypergryph.endfield` 恰恰是**非 debuggable** 的（targetSdk 34），
因此这个差异**直接决定路线 A 是否可行**。结论是：**可行**。

## 14.5 对照实验：Android 的层发现机制（更正 §14.4 的解释）

为区分「loader 读 manifest」与「loader 扫 `.so`」，做了三步对照实验。
每次都重新 `setprop debug.vulkan.layers` 并在**新进程**中运行探针：

| 实验 | `/data/local/debug/vulkan/` 内容 | 枚举到的层数 | `vkCreateInstance` |
| --- | --- | --- | --- |
| **A** | 只有 `libVkLayer_EFML4A.so`（**删掉 JSON**） | **1** | **`VK_SUCCESS`（0）** |
| **B** | 只有 `VkLayer_EFML4A.json`（**删掉 .so**） | 0 | `-6`（`VK_ERROR_LAYER_NOT_PRESENT`） |
| **C** | 恢复两者 | 1 | `VK_SUCCESS`（0） |

**结论：JSON manifest 在 Android 上是装饰性的，参与发现的是 `.so` 本身。**
实验 A 在完全没有 manifest 的情况下依然成功加载并拦截，这一条即可定论。

`readelf --dyn-syms` 确认本层导出了自省所需的全部符号：

| 符号 | 作用 | 是否存在 |
| --- | --- | --- |
| `vkEnumerateInstanceLayerProperties` | 自省：报告层名与版本 | ✓ |
| `vkEnumerateInstanceExtensionProperties` | 自省：报告层扩展 | ✓ |
| `vkEnumerateDeviceLayerProperties` | **`is_global` 判定必需**，缺了设备级调用链里就没有本层 | ✓ |
| `vkGetInstanceProcAddr` / `vkGetDeviceProcAddr` | Android 用 dlsym 取入口（**不调用** `vkNegotiateLoaderLayerInterfaceVersion`） | ✓ |

> 上述机制来自对 AOSP 源码的核对（见 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) 与
> `vulkan-layer/README.md`），**本节的 A/B/C 实验是在目标设备上对该机制的独立验证**。
>
> ⚠️ 未核实：AOSP 源码核对基于 `a16`（Android 16）分支，而目标机是 Android 17（API 37）。
> 另外，`GraphicsEnv::isDebuggable()` 被描述为
> `prctl(PR_GET_DUMPABLE) > 0 || ANDROID_DEBUGGABLE`；普通应用进程的 `PR_GET_DUMPABLE` 默认为 1，
> 这解释了为什么 §14.4 中**非 debuggable 的进程也能被准入**。
> 该公式在 API 37 上未逐行复核。

**对实现的直接影响**：EFML4A 的层**必须**继续导出上表五个符号，
并且**不能**依赖 manifest 做任何配置传递——所有配置必须走 `.so` 内部或系统属性。

## 14.5 对路线图的更新

[11-roadmap.md](/blog/efml4a-11-roadmap/) §M0 的 Q4（「隐式层准入在 Android 17 `user` 构建上的准确边界」）
**已回答**：属性路径可用，真正的前提是 root + 正确的 SELinux 标签 + 属性设置。

M2 的验证重点应相应调整为：

1. 在**真实游戏进程**中确认层被加载（游戏有反作弊，风险另计，见下）。
2. 验证**渲染层拦截**（`vkCreateGraphicsPipelines` / `vkCmdBindVertexBuffers` / `vkCmdDrawIndexed`），
   本阶段只验证到了 instance 级。
3. 处理**与游戏自带层的共存**（见 §14.6）。

## 14.7 本次新暴露的问题

| # | 问题 | 说明 |
| --- | --- | --- |
| V-1 | 与游戏自带的 `libVkLayer_mfrc.so` 共存 | APK 内含联发科帧生成层与 `libMFRCLayer_eco.so`，层链顺序与冲突需验证 |
| V-2 | 属性只对「进程启动时」生效 | loader 在 `vkCreateInstance` 时读属性，游戏已在运行时改属性无效，需要冷启动或重启应用 |
| V-3 | SELinux 标签方案的可移植性 | `apk_data_file` 是权宜之计；`/data/local/debug/vulkan` 在部分设备上可能已有正确标签，需要做成自适应 |
| V-4 | 反作弊可见性 | 游戏带 `libtersafe2.so` / `libtprt.so`（腾讯 TP）与 `libthemis.so`，层被枚举/映射是否会被检出，**未验证** |
| V-5 | `ro.debuggable=0` 下 `GraphicsEnv` 路径是否也被放开 | 未测试全局设置路径，需在 M2 补齐对照 |

## 14.8 可复现步骤

```bash
# 1) 编译层（在 Termux 内，使用设备自带 clang + NDK sysroot）
vulkan-layer/scripts/build-android-termux.sh

#    （脚本会顺带写入一个 VkLayer_EFML4A.json：Android 用不到它，
#      保留只是为了同一份产物在桌面端也能用；参见 §14.5）

# 2) 安装为隐式层（需要 root，会打印每一步）
vulkan-layer/scripts/install-implicit-layer.sh --enable

# 3) 验证（用自建 arm64 探针，见 §14.3 的输出来判断）
#    注意：必须新起一个进程，属性在进程启动时才被读取
su -c 'setprop debug.vulkan.layers VK_LAYER_EFML4A_model_replacer'

# 4) 关闭（重启也会自动失效）
su -c 'setprop debug.vulkan.layers ""'
```

> 探针源码与脚本均基于本轮实测，非事后补写。

## 14.9 环境

| 项目 | 值 |
| --- | --- |
| 设备 | Xiaomi 24122RKC7C，SM8750（Snapdragon 8 Elite），Adreno |
| 系统 | Android 17（API 37），`user` 构建，Enforcing SELinux |
| Root | KernelSU（`context=u:r:ksu:s0`） |
| 编译器 | Termux clang 21.1.8（`aarch64-unknown-linux-android24`） |
| NDK | 29.0.14206865（**仅使用其 sysroot 数据**） |
| Vulkan 驱动 | `/vendor/lib64/hw/vulkan.adreno.so` |

## 14.10 设备级与绑定级拦截实测（第二个里程碑）

§14.4/14.5 只验证到了 **instance 级**。为了证明「换模型」真正依赖的那条链路，
用分级探针（`vulkan-layer/tests/probe_android.cpp`（私有主仓））
逐级加压，每级结束都把层统计落盘。

### stage 1：设备级

| 调用 | 结果 |
| --- | --- |
| `vkCreateInstance` | `VK_SUCCESS` |
| `vkCreateDevice` | `VK_SUCCESS` |
| `vkCreateBuffer` / `vkAllocateMemory` / `vkBindBufferMemory` / `vkCreateCommandPool` | 全部 `VK_SUCCESS` |

层统计：`"vkCreateInstance":1, "vkCreateDevice":1`

**意义**：`vkCreateDevice` 被拦截并计数，证明本层被 loader 当作 **global layer** 纳入了设备调用链
（这与 §14.5 表格中「必须导出 `vkEnumerateDeviceLayerProperties`」互为印证）。

### stage 2：顶点/索引缓冲绑定 —— **换模型的核心机制**

| 调用 | 结果 |
| --- | --- |
| `vkCmdBindVertexBuffers(cb, 0, 1, &buf, &offset)` | 已调用，无返回码 |
| `vkCmdBindIndexBuffer(cb, buf, 0, VK_INDEX_TYPE_UINT16)` | 已调用，无返回码 |
| `vkEndCommandBuffer` / `vkCreateFence` / `vkQueueSubmit` / `vkWaitForFences` | 全部 `VK_SUCCESS` |

层统计：

```json
{"vkCreateInstance":1, "vkCreateDevice":1,
 "vkCmdBindVertexBuffers":1, "vkCmdBindIndexBuffer":1, "vkQueueSubmit":1}
```

**这是本项目最关键的一条实测证据**，理由有三：

1. `vkCmdBindVertexBuffers` 与 `vkCmdBindIndexBuffer` **正是替换模型顶点/索引缓冲的插入点**，
   也就是 [13-real-mod-analysis.md](/blog/efml4a-13-real-mod-analysis/) 中真实 EFMI mod 里
   `ib = ref Resource_Component0_IB` / `vb0 = ref Resource_Component0_VB0` 在 Android 上的对应物。
2. 所有被拦截的调用**依然返回 `VK_SUCCESS`**，说明层的转发是**正确**的，不只是能数数。
3. `vkQueueSubmit` 也被拦到，说明命令缓冲提交路径可用。

至此，「PC 上用 3DMigoto 替换 vb/ib」这一核心机制，在 Android 的 Vulkan 隐式层上
**已经具备全部前置条件**；剩余工作是把「拦截」变成「改写参数」
（识别目标 draw + 换成自建 buffer），属于 M2。

### stage 3：draw 级 —— 已知限制

`vkCmdDrawIndexed` 在**没有绑定 pipeline / render pass** 的情况下调用，
会把 Adreno 驱动直接搞崩（段错误）。

> 这不是本层的缺陷：**不带层同样崩**（已做对照），说明是「无 pipeline 直接 draw」
> 这一非法用法触发了驱动的不健壮路径。
> 要在真机上验证 draw 级拦截，必须先构造合法的 graphics pipeline（需要 SPIR-V），
> 归入 M2。**本项目不再刻意复现该崩溃**——目标是日常用机，不值得为已知结论冒 GPU hang 的风险。

### 复现

```bash
vulkan-layer/scripts/run-ondevice-probe.sh 2
```

---

## 14.11 参考

- [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) —— 路线 A 的技术分析（本文补充了实测准入条件）
- [11-roadmap.md](/blog/efml4a-11-roadmap/) —— M0/M2 阶段与退出条件（Q4 已回答）
- [13-real-mod-analysis.md](/blog/efml4a-13-real-mod-analysis/) —— 真实 EFMI mod 的一手剖析
- [Promon · App Threat Report Q3 2026](https://promon.io/security-news/app-threat-report-q3-2026-gpu-debugger-abuse-in-android-apps) —— 公开的 GPU debugger 滥用研究
