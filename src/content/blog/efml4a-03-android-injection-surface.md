---
title: "03 · Android 注入面全谱"
description: "EFML4A 研究文档 · 03-android-injection-surface（Arknights: Endfield Mod Loader for Android）"
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

**定位**：把 Android 上一切「把代码或数据送进目标进程/目标资源路径」的手段逐条拆解，给出能力边界与能力矩阵；为 [07-route-matrix.md](/blog/efml4a-07-route-matrix/) 的选型、[09-architecture.md](/blog/efml4a-09-architecture/) 的架构、[08-threat-model.md](/blog/efml4a-08-threat-model/) 的威胁模型提供事实基础。PC 侧对照物见 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/)，路线 A 深挖见 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)。

**结论先行**：EFMI 在 PC 上的三段式（代理 DLL → 注入 → DXGI/D3D11 拦截）在 Android 上**整体失效**——没有 DXGI，没有「把 DLL 丢在 exe 旁边」的加载搜索路径劫持，也没有「同 UID 就能 ptrace」的自由。Android 的等价链条是：

```
拿到 in-process 执行权(Zygisk/内核态/层) → 选择拦截层级(Vulkan 层 / IL2CPP hook / PLT hook) → 资源层用磁盘替换兜底
```

---
## 1. Android 进程与权限模型速览

| 机制 | 事实 | 对注入/替换的直接影响 |
| --- | --- | --- |
| 应用沙箱（UID 隔离） | 一个 APK 一个 UID；`/data/data/<pkg>/` 默认仅本 UID 可访问；跨应用只能走 Binder/ContentProvider | 无法直接改他人资源文件；必须借 root 或先拿到 in-process |
| SELinux（MAC） | `untrusted_app` 域受 `neverallow` 约束，禁止 ptrace 其他域、禁止写系统分区、禁止访问多数 `debug` 类标签 | 非 root 时「attach 到别人进程」在 LSM 层就被拒；root 后落到 `su`/`magisk` 域才放行 |
| bionic + linker namespace | Android 7+ 每进程使用隔离的 linker namespace；应用进程的 `dlopen` 不能穿透到系统内部命名空间；应用进程环境变量由 zygote 继承，`setprop` 无法改环境 | **`LD_PRELOAD` 对普通应用进程基本不可用**（详见 §1.3） |
| ptrace / `/proc/<pid>/mem` | attach 需同 UID **且** 目标 `android:debuggable`，并受 SELinux + procfs 挂载策略共同限制 | 非 root 无法读写其他应用内存；`process_vm_readv/writev` 走同一套 ptrace access check |
| scoped storage | Android 10 引入、11 强制；`/sdcard/Android/data/<pkg>` 与 `Android/obb/<pkg>` 由系统管理 | 纯磁盘替换的可行位置被压缩；详见 §1.5 |
| 构建类型 | `ro.debuggable=1` 仅 userdebug/eng 镜像成立，user 版为 0 且不可写 | 「userdebug + root」是很多 debug 通道的准入条件 |
### 1.1 沙箱与 UID

注入的本质是「跨界」：跨 UID 写内存、跨 UID 读资源、或以另一个 UID 的身份执行代码。Android 把这三件事都默认关掉。唯一的合法跨界口是 Binder（受权限与 SELinux 双重约束）与 root。
### 1.2 SELinux

- 应用进程运行在 `untrusted_app`（或按 targetSdk 派生的 `untrusted_app_27`/`_29`/`_30` 等）域；`ptrace` 被 `neverallow` 挡住，因此 **frida-server 必须先有 root**（su 域）才能 attach 到非 debuggable 应用。
- root 方案（Magisk/KernelSU/APatch）的差异在很大程度上就是「如何在不重编译 sepolicy 的前提下把 su 域塞进去」。
- `debug.vulkan.layers` 与 `/data/local/debug/vulkan` 的可达性由系统属性 + SELinux 标签共同决定（见 §2.6）。
### 1.3 linker namespace 与 `LD_PRELOAD`

- Android 从 7.0 起为应用建立隔离命名空间：应用只能看到 `public.libraries.txt` 与自身 `lib/` 下的库，无法 `dlopen` 系统私有库，因此「hook `libvulkan.so` 的某个符号」不一定能通过 `dlsym` 拿到句柄（但 `libvulkan.so` 属于公开库，可被 `dlopen`）。
- `LD_PRELOAD` 由 linker 在进程启动时读取环境变量生效；**应用进程的环境继承自 zygote，普通手段无法注入**。因此 PC 式「放一个同名 .so 抢占加载」在 Android 上不成立。
- 理论上的两个例外，都重新落回「需要 root 或重打包」：
  1. `wrap.<pkg>` 系统属性 + APK 内 `wrap.sh`（AOSP 的 wrap 机制，原生用于 ASan 等调试场景）让进程通过脚本启动，脚本内可设置 `LD_PRELOAD`。⚠️ 未核实：该属性名与具体行为随 Android 版本变化，需在目标版本上实测。
  2. 重打包时把自带 loader 塞进 `lib/`，或让 APK 的 `extractNativeLibs`/命名空间行为配合加载。
- 结论：**「DLL 代理」模式在 Android 没有对应物**；等价物是「在进程内做 PLT/GOT hook 或直接换掉 dispatch 表」，而这需要先有 §2 中的某个注入点。
### 1.4 `/proc/<pid>/mem` 与 ptrace（重点）

| 场景 | 能否 attach | 说明 |
| --- | --- | --- |
| 同 UID 且目标 `debuggable` | ✅ | 标准调试路径 |
| 同 UID 但目标非 debuggable | ❌ | 内核 ptrace access check 因 target 不可 dump 而拒绝 |
| 不同 UID（非 root） | ❌ | SELinux `untrusted_app` 域直接拒绝 |
| root（su 域） | ✅ | 需要关闭/规避部分机型的强化策略，且极易被检测 |
| 内核模块级 | ✅ | 绕过进程权限模型（KernelSU/APatch/自编译内核） |

- Android 10 起对 `/proc` 的可见性进一步收紧（非本进程的信息被遮蔽/受限，`hidepid` 类行为与 procfs 挂载选项相关）。⚠️ 未核实：各厂商 ROM 的具体掩码规则差异很大，需按机型实测。
- **实践含义**：在非 root 设备上，「读写目标进程内存」这条路完全关闭。所有 PC 风格的 cheat engine / trainer 思路在 Android 上必须先有 root。
### 1.5 scoped storage 对资源替换的影响

Unity Android 客户端的资源通常位于三处，处置难度递增：

| 位置 | 典型路径 | 替换难度 |
| --- | --- | --- |
| APK 内 `assets/`（含 `StreamingAssets`） | 只能通过 APK 读取（`jar:file://`） | 需重打包，或 root 覆盖挂载 |
| 拆分包/OBB（`split application binary`） | `/sdcard/Android/obb/<pkg>/` | 需 root 写，或应用自身写权限 |
| 运行时下载并缓存的 AssetBundle | `Application.persistentDataPath`（`/data/data/<pkg>/files/...`） | 需 in-process 路径重定向，或 root 直写 |
| 外部自有目录 | `/sdcard/Android/data/<pkg>/` | scoped storage 下非本应用不可写 |

- Android 11+ 强制 scoped storage 后，`/sdcard/Android/data/<pkg>` 不再是「用户可随手改」的目录；早期常见做法（让玩家把 mod 包放进 data 目录）已不可行。
- 因此资源替换路线（[06-route-assetbundle.md](/blog/efml4a-06-route-assetbundle/)）必然收敛到三种落地方式：**重打包 / root 挂载覆盖 / in-process 路径重定向**。

---
## 2. 注入点逐个解剖

每小节按 6 个维度描述：前置条件 / 注入时机 / 内存读写 / 图形 API 拦截 / 稳定性 / 检测可见度。
### 2.1 Magisk / Zygisk

| 维度 | 结论 |
| --- | --- |
| 前置条件 | 解锁 Bootloader + root（Magisk），Zygisk 开启；目标应用不在 DenyList/排除列表 |
| 注入时机 | Zygisk 在 zygote 特化出 app 进程之后、应用 Java 代码执行之前，把模块 `.so` 注入目标进程 |
| 内存读写 | ✅ 同进程，全量（可读可写堆、栈、模块映射） |
| 图形 API 拦截 | ✅ 可做 PLT/GOT hook，或自行 `dlopen`/替换 Vulkan dispatch；也可作为 Vulkan 隐式层的「准入改造器」 |
| Unity 层拦截 | ✅ 通过 `dlopen("libil2cpp.so")` + `dlsym` 拿到 il2cpp C API，再做 native 层 hook |
| 稳定性 | 高（生态成熟），但 loader 每次 `dlopen`/注入失败都会导致进程崩溃 |
| 检测可见度 | 中高：`/proc/self/maps` 中的匿名可执行映射、`memfd:`、mount 痕迹、Magisk 路径/属性、Play Integrity |

- Zygisk 的最大价值是**位置**：代码在应用自身进程、自身 SELinux 域中运行，早于反调试初始化，晚于 linker 完成库加载。
- Zygisk 模块 API 的入口符号（如 `zygisk_module_entry` 与 `zygisk::Api`/`ModuleBase`）随 Magisk 版本演进而非 ABI 稳定。⚠️ 未核实：具体符号名与结构体字段请以目标 Magisk 版本的 `module.hpp` 为准。
### 2.2 KernelSU / APatch（内核态）

| 维度 | 结论 |
| --- | --- |
| 前置条件 | 解锁 BL；KernelSU 需要可加载模块/kernel patch 能力；APatch 走 kernel patch（kprobe 等）路线 |
| 注入时机 | 内核态最早，可在 zygote 之前；亦可随时读写任意进程内存 |
| 内存读写 | ✅ 最强（不受进程权限模型约束） |
| 图形 API 拦截 | ❌/◐ 语义上不合适：内核态只能做内存改写与断点，无法方便地理解 Vulkan 调用语义 |
| Unity 层拦截 | ◐ 同上，通常只作为「打开权限」的前置手段 |
| 稳定性 | 高（对系统侵入小），但机型/内核适配成本高 |
| 检测可见度 | 低-中：内核行踪难以从用户态枚举；但 root 本身仍可被检出 |

- 本项目中它们的角色应是**权限提供者与反检测基座**，而非拦截层：适合用来「让目标 app 看起来 debuggable」、隐藏注入痕迹、提供 `su`。
- 两者都要求刷写 boot 镜像，对最终用户门槛高于 Zygisk（后者也是刷，但生态更成熟）。
### 2.3 LSPosed / Xposed（ART 层）

| 维度 | 结论 |
| --- | --- |
| 前置条件 | 需要 Zygisk（或旧 Riru）作为载体 + LSPosed 框架；需在管理器里勾选目标应用 |
| 注入时机 | ART 方法解析/调用期；Java 侧最早可用的 hook 面 |
| 内存读写 | ✅ 在进程内可通过 JNI/`Unsafe` 触达 native 内存 |
| 图形 API 拦截 | ❌ 不能直接拦 Vulkan（Java 层看不到 `vk*`） |
| Unity 层拦截 | ◐ 只能拦 Java 侧（Activity/UnityPlayer 的 Java 方法）；**il2cpp 的 C# 方法已编译为 native，不在 ART 层** |
| 稳定性 | 高（对 Java 方法签名变化敏感，但机制稳） |
| 检测可见度 | 中：经典 Xposed 痕迹（`XposedBridge`、异常栈、类加载器链）可被检出；LSPosed 隐藏较好 |

- 现代 ART hook 框架（LSPosed 使用的 LSPlant 系）比早期 Xposed 隐蔽；但它解决不了 il2cpp 逻辑层的问题，见 [05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/)。
### 2.4 Frida（含 frida-il2cpp-bridge）

| 维度 | 结论 |
| --- | --- |
| 前置条件 | `frida-server`（需 root）或 `frida-gadget`（需重打包/嵌入式加载） |
| 注入时机 | 运行中 attach（spawn/gadget 可更早） |
| 内存读写 | ✅ 全量（NativeFunction/Interceptor/Memory） |
| 图形 API 拦截 | ✅ 可 `Interceptor.attach` `vk*`（函数级） |
| Unity 层拦截 | ✅ `frida-il2cpp-bridge` 基于 il2cpp 导出的 C API 做 C# 层方法替换、字段读写、结构体遍历 |
| 稳定性 | 中：附加慢、GC/线程交互复杂；长期驻留易崩 |
| 检测可见度 | **很高**：`frida` 字符串、`gum-js-loop` 线程名、默认端口 27042、D-Bus over pipe、异常 `maps` 条目 |

- 结论：**Frida 只能作为研发与逆向工具**（快速验证 pipeline 指纹、骨骼偏移），不应进入最终交付形态。若必须使用，gadget 嵌入 + 改名仍属高检测风险。
### 2.5 `app_process` / Riru 式（zygote 阶段）

- 需要先澄清一个常见误解：`app_process` 本身**不是注入手段**。它只是在给定 classpath 下启动一个 Java 进程（`am`/`monkey` 的宿主也是它），运行在自己的进程里，看不到别人的内存。
- 真正的「zygote 阶段注入」是：
  - **Riru**：Magisk 模块，把模块代码注入 zygote，使所有子进程（含目标 app）继承该代码。Zygisk 是其继任者，机制更干净。
  - **替换系统 zygote 侧组件**（`libandroid_runtime.so`、`app_process` 二进制）——需要动系统分区，属 §2.9。
  - **`wrap.<pkg>` + `wrap.sh`**：让目标应用以脚本方式启动，从而控制其环境（可用于 `LD_PRELOAD`）。⚠️ 未核实：可用性与具体行为随版本变化。
- 价值：注入点最早、覆盖全部子进程；代价：与系统完整性校验、Zygisk 生态存在重叠与冲突。
### 2.6 Vulkan / GLES 隐式层（路线 A 入口）

| 维度 | 结论 |
| --- | --- |
| 前置条件 | 三者之一：应用 `debuggable`；userdebug 镜像 + root；Android 11+ 应用 manifest 自愿 opt-in。另有全局设置必须**点名目标应用** |
| 注入时机 | `vkCreateInstance` 之前由 loader 加载 layer `.so`，属进程内、应用代码早期 |
| 内存读写 | ✅ ✅ **关键点：layer 就是任意 native 代码，能力不限于图形** |
| 图形 API 拦截 | ✅ 最正统的拦截点（见 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)） |
| Unity 层拦截 | ❌ 直接不行；需在同一进程内另外做 il2cpp hook |
| 稳定性 | 高（官方接口，跨版本 ABI 相对稳定） |
| 检测可见度 | 中：layer 链可枚举、`debuggable`/`ro.debuggable` 可查、全局设置可读、donor 路径出现在 `maps` |

- Promon 2026Q3 报告的核心结论可作为本路线的权威背书与风险说明：Android 只在「应用可调试 / userdebug+root / Android 11+ manifest opt-in」三者之一成立时注入 layer，且全局设置必须点名应用；但**donor app 无任何这类要求，只需已安装并含正确 ABI 的 native 库**；作者用「让目标 app 看起来可调试」在 root 设备上完成了注入演示。该边界是**进程与构建属性，不是密码学证明**——没有任何签名或证明环节。
- 注意文档层面的矛盾：Khronos 上游 Loader 文档明确写「Android 上不支持 implicit layer」，而 Vulkan 指南的 Android 章节描述的是 `ro.debuggable` + `/data/local/debug/vulkan` 这一**平台自有机制**。二者并不冲突：Android 的 `libvulkan` 是平台分支实现，用的是「属性 + 全局设置 + donor app」而非桌面式 JSON 隐式层搜索路径。引用时务必区分「Khronos 参考 loader」与「AOSP 平台 loader」。
### 2.7 磁盘资源替换

| 维度 | 结论 |
| --- | --- |
| 前置条件 | 取决于目标路径：APK 内 → 重打包或 root 挂载覆盖；OBB/外部 → 写权限；私有目录 → in-process 重定向 |
| 注入时机 | 启动前（挂载）或加载期（重定向） |
| 内存读写 | ❌ 不需要（这正是优点） |
| 图形 API 拦截 | ❌ |
| Unity 层拦截 | ❌（但可通过改 AssetBundle/SerializedFile 达到「逻辑级」效果） |
| 稳定性 | 最高；零运行时开销 |
| 检测可见度 | 低-中：APK 签名校验、资源哈希/CRC、AssetBundle 清单、IL2CPP 元数据交叉校验 |

- 这是唯一**不需要 in-process 代码**的路线，因此检测面最小，适合纯外观/资产类 mod（见 [06-route-assetbundle.md](/blog/efml4a-06-route-assetbundle/)）。
- 局限：无法做逐 draw call 的运行时替换、无法注入骨骼、无法做依赖上下文的效果。
### 2.8 重打包 APK

| 维度 | 结论 |
| --- | --- |
| 前置条件 | 无 root；但需破解签名/完整性校验，处理 split APK、v1/v2/v3 签名 |
| 注入时机 | 构建期 |
| 内存读写 | ✅（因为可以嵌入任意 loader/gadget） |
| 图形 API 拦截 | ✅（嵌入 layer 或直接 PLT hook） |
| Unity 层拦截 | ✅（可嵌入 il2cpp hook 库） |
| 稳定性 | 高（可控），但分发与更新链断裂 |
| 检测可见度 | **很高**：签名变化是硬伤（除非持有原厂私钥）；Play Integrity、服务端校验、渠道校验 |

- 该路线的最大问题不是技术，而是**分发**：Google Play 更新会覆盖，用户需要覆盖安装并处理账号绑定校验。
### 2.9 自定义 ROM / 系统镜像

- 前置：解锁 BL + 编译/改造系统镜像（或使用 userdebug 版）。
- 能力：把 layer 设为系统内置、把 `debuggable` 默认打开、把 SELinux 调成 permissive、预置 hook 框架。
- 稳定性与可复现性最好（[09-architecture.md](/blog/efml4a-09-architecture/) 可用于建立参考测试环境）；但受众最窄、Play Integrity 全失。
- 本项目应把它定位为**研发基线与 CI 设备方案**，而非面向玩家的交付形态。

---
## 3. 能力矩阵（核心产出）

图例：✅ 原生支持 ／ ◐ 有条件或间接 ／ ❌ 不可行／不适用。

| 注入点 | 前置条件 | 注入时机 | 目标进程内存读写 | 图形 API 拦截 | Unity/IL2CPP 层拦截 | 资源替换 | 稳定性 | 检测可见度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Magisk / Zygisk | root + Zygisk | app 进程 fork 后、Java 之前 | ✅ | ✅（PLT/GOT 或自建 dispatch） | ✅（dlopen il2cpp） | ◐（需配合挂载） | 高 | 中高 |
| KernelSU / APatch | root + 内核改造 | 内核态，最早 | ✅（最强） | ❌/◐ | ◐ | ◐（可 bind mount） | 高 | 低-中 |
| LSPosed / Xposed | Zygisk 载体 + 勾选应用 | ART 方法调用期 | ✅（经 JNI） | ❌ | ◐（仅 Java 侧） | ◐ | 高 | 中 |
| Frida（server） | root | 运行中 attach | ✅ | ✅ | ✅（frida-il2cpp-bridge） | ◐ | 中 | 很高 |
| Frida（gadget 嵌入） | 重打包或自带加载器 | 加载期 | ✅ | ✅ | ✅ | ◐ | 中 | 高 |
| zygote/Riru 式注入 | root + 模块（Riru/Zygisk） | zygote 特化期 | ✅ | ✅ | ✅ | ◐ | 中高 | 中高 |
| Vulkan 隐式层 | 可调试 / userdebug+root / manifest opt-in；全局设置点名 | `vkCreateInstance` 前 | ✅（同进程-native） | ✅（最正统） | ❌ | ❌ | 高 | 中 |
| GLES 隐式层 | 同上（GLES 通道） | EGL/GLES 初始化前 | ✅ | ◐（GLES 无 Vulkan 语义） | ❌ | ❌ | 高 | 中 |
| 磁盘资源替换 | 写权限或 root 挂载 | 启动前/加载期 | ❌ | ❌ | ❌ | ✅（最强） | 最高 | 低-中 |
| 重打包 APK | 无 root，需过校验 | 构建期 | ✅ | ✅ | ✅ | ✅ | 高 | 很高（签名） |
| 自定义 ROM | 解锁 BL + 镜像 | 系统启动前 | ✅ | ✅ | ✅ | ✅ | 最高 | 高（Play Integrity） |

**读表要点**

1. 「内存读写」与「图形拦截」在多数注入点是同时出现的，因为 layer 与 Zygisk 模块本质都是进程内 native 代码——**拿到进程内执行权后，图形拦截只是其中一个用法**（Promon 报告的同一论点）。
2. 「资源替换」列与「内存/图形」列几乎互补：只有磁盘替换不需要 in-process 代码，也只有它无法做运行时语义拦截。
3. 检测可见度与侵入深度基本正相关，唯一例外是「自定义 ROM」：它最隐蔽于用户态检测，但最容易被平台级认证（Play Integrity）识别。

---
## 4. 针对 Arknights: Endfield 的推荐组合拳

前提（来自项目定位，具体引擎细节需实测确认）：Unity 引擎、Android 端走 Vulkan 后端，因此图形拦截面存在且为 Vulkan 而非 GLES。⚠️ 未核实：Endfield 是否使用 IL2CPP、是否启用 Addressables、AssetBundle 是否加密/签名、是否接入第三方反作弊——这些需在 [11-roadmap.md](/blog/efml4a-11-roadmap/) 的 M0 阶段实测定档。

**推荐分层（能力递增，风险递增，默认从下往上）**

| 层 | 路线 | 角色 | 理由 |
| --- | --- | --- | --- |
| L0 | AssetBundle 磁盘替换（[06](/blog/efml4a-06-route-assetbundle/)） | 纯资产 mod 兜底 | 零 in-process 代码，检测面最小；能覆盖贴图/模型/音效等大多数可见 mod |
| L1 | IL2CPP hook（[05](/blog/efml4a-05-route-il2cpp-hook/)） | 逻辑与数据来源层 | 解决「资源从哪来、用哪套材质参数、骨骼数据在哪」等 Vulkan 层看不到的问题 |
| L2 | Vulkan 隐式层（[04](/blog/efml4a-04-route-vulkan-layer/)） | 图形语义层（主路径） | 最接近 3DMigoto 的对应物：draw call 级替换、顶点/索引缓冲注入、骨骼常量注入 |
| 载体 | Zygisk 模块（+ 内核态辅助） | 注入与准入 | 层路线本身要求「可调试/userdebug+root/manifest opt-in」，即**已经需要 root**；既然如此，用 Zygisk 统一承担注入、准入改造与 fallback |

**为什么是「Zygisk 载体 + Vulkan 层主路径」而不是二选一**

- 只做 Zygisk + PLT hook：可行，但失去 layer 机制的 ABI 稳定性与 dispatch 语义，每次 loader 更新或驱动更新都可能翻车。
- 只做 Vulkan 层：准入步骤（让 app 显得可调试）本身就要 root，等于绕了一圈仍然需要 Zygisk/内核态；不如显式把二者设计成一对。
- 层的**独立价值**在于：(a) 官方 dispatch 链，拦截点语义清晰；(b) 与渲染 API 版本漂移解耦，比 il2cpp 符号漂移鲁棒得多；(c) 可复用到非 Unity 的 Vulkan 应用上。

**明确不作为主路径的**

- Frida：仅研发期使用（[11-roadmap.md](/blog/efml4a-11-roadmap/) 的探针工具链），不进交付物。
- 重打包 APK：签名与更新链问题无解，且与「不绕过完整性校验」的红线冲突。
- LSPosed/Xposed：对 native il2cpp 与 Vulkan 无直接帮助，收益不抵额外检测面。

---
## 5. 反检测与合规红线（本项目的自我约束）

本节只做技术性描述与项目边界声明，不提供任何绕过检测的实现方案。

**项目明确不做的事**

1. 不读写任何游戏数值、不改战斗/经济/进度状态、不修改发包内容。
2. 不参与联网对战作弊；不提供「透视/自瞄/自动战斗」类功能。运行时 draw call 能力仅用于**离线/单人可见性**与资产替换演示。
3. 不破解、不绕过、不削弱任何反作弊或完整性校验机制；不提供 root 隐藏、Play Integrity 绕过、检测器对抗模块。
4. 不重新分发游戏原始资产或反编译产物；mod 包只包含差分数据（见 [10-mod-format.md](/blog/efml4a-10-mod-format/)）。
5. 不把 Frida/内核隐藏等易被滥用的组件打包进用户交付物。

**合规与法律面（需在 README/文档中显式声明）**

- 用户协议（EULA）通常禁止修改客户端与逆向工程；使用 mod 可能导致封号，需在 [08-threat-model.md](/blog/efml4a-08-threat-model/) 中向用户明确告知。
- 资产提取与再分发涉及著作权；部分司法辖区对「规避技术保护措施」有专门条款。
- 目标项目定位为**安全研究/技术验证**：所有发布物应附带研究目的声明与免责声明。

**技术侧的诚实结论**

- 只要走 Vulkan 层或 Zygisk，root 就是硬前提，而 root 本身的高可见度会先于任何注入痕迹被发现。**「能否过检测」不应作为本项目的设计目标**；项目的技术价值在于把 PC 侧的 mod loader 语义（vb0/ib 替换、骨骼常量注入、draw call 指纹）在 Android 上重建并量化其可行性与开销。

---
> ⚠️ 未核实：本节中 `gpu_debug_app` / `gpu_debug_layers` / `gpu_debug_layer_app` 等 Settings.Global 键的精确拼写与生效版本区间，未能从 AOSP 源码页直接抓取（googlesource 在本环境不可达），仅由检索摘要与第三方文档间接佐证；落地前请在目标 Android 版本上以 `settings get global <key>` 实测。
> ⚠️ 未核实：Arm 在 Vulkanised 2025 的 libGPULayers 演讲 PDF（https://vulkan.org/user/pages/09.events/vulkanised-2025/T19-Pete-Harris-Arm-libGPULayers.pdf ）与 https://github.com/ARM-software/libGPULayers 在本环境均返回 403 / 连接失败，其移动端 Vulkan 层实践经验未能在本文档中引用，相关结论见 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) 的对应标注。

## 参考

- Promon, *App Threat Report Q3 2026: GPU debugger abuse in Android apps* — https://promon.io/security-news/app-threat-report-q3-2026-gpu-debugger-abuse-in-android-apps （隐式层准入条件、donor app 机制、三种绕过路径、攻击者收益与检测建议）
- Khronos, *Layer Interface to the Loader*（LunarG 镜像，含 Layer Discovery / Android Layer Discovery / Dispatch 初始化 / pre-instance 函数 / `VK_LOADER_LAYERS_ENABLE` / `VK_LOADER_LAYERS_DISABLE`） — https://vulkan.lunarg.com/doc/view/latest/linux/LoaderLayerInterface.html
- Khronos, *Application Interface to Loader*（implicit vs explicit、`VK_INSTANCE_LAYERS`、层顺序、device layer 弃用、"No Support For Implicit Layers on Android"） — https://vulkan.lunarg.com/doc/view/latest/linux/LoaderApplicationInterface.html
- Vulkan Documentation Project, *Layers*（Android 章节：Android P 起 `ro.debuggable` + `/data/local/debug/vulkan`，ADB 推送层） — https://vulkan.lunarg.com/doc/view/1.4.313.2/windows/antora/guide/latest/layers.html
- AOSP `frameworks/base/core/java/android/provider/Settings.java`：`ENABLE_GPU_DEBUG_LAYERS = "enable_gpu_debug_layers"`（搜索结果引用，未能直接抓取源码页） — https://android.googlesource.com/platform/frameworks/base/+/eb7f3a60801e31eef0719444c39574d89ac8ed39/core/java/android/provider/Settings.java
- AOSP CTS `CtsRootlessGpuDebugHostTest.java`（出现 `gpu_debug_app` 等键名；源码页抓取失败，仅由搜索结果确认存在） — https://android.googlesource.com/platform/cts.git/+/e3c35a208e306e8460e72960e7ce21841886de53/hostsidetests/gputools/src/android/gputools/cts/CtsRootlessGpuDebugHostTest.java
