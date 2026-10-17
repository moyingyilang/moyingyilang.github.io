---
title: "07 · 四条路线决策矩阵"
description: "EFML4A 研究文档 · 07-route-matrix（Arknights: Endfield Mod Loader for Android）"
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


> 本文的表格是 `efml-core` 中 `routes` 模块的**可读版本**；`efml routes --json` 与
> GUI 的 `GET /api/routes` 输出同一份数据。改结论请改代码里的 `ROUTES`，避免文档与工具漂移。

## 7.1 总览

| 路线 | PC 类比 | 前置条件 | 注入点 | 拦截粒度 | 可行性 | 工程量 | 稳定性 | 检测风险 | 版本鲁棒性 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Vulkan 隐式层** | 3DMigoto / EFMI | root + 目标 app 被判定可调试 | Vulkan loader 加载 layer | 逐 `vk*` 调用 / 逐 draw | 高 | 高 | 中 | 中低 | **高** |
| **IL2CPP hook** | 无（Unity 逻辑层） | root + LSPosed/Zygisk 或 frida | `libil2cpp.so` 方法入口 | Unity 对象 / Mesh | 高 | 中高 | 中 | 高 | 低 |
| **AssetBundle 替换** | 无（EFMI 刻意不做） | root，或重打包 APK | 磁盘资源 / `open` 重定向 | 整包资源 | 中 | 中 | **高** | 高 | 低 |
| **frida / ptrace 辅助** | 无 | root（可调试或 ptrace 授权） | 进程附加 | 内存 / 函数级 | 高 | **低** | 低 | 高 | 低 |

## 7.2 逐路线结论

### 路线 A：Vulkan 隐式层 —— 与 EFMI 类比最强

**结论**：这是唯一在**架构意义上**与 EFMI 等价的路线。两者都站在图形 API 边界，
在游戏逻辑完全不知情的情况下替换顶点/索引缓冲；EFMI 的 `vb0`/`ib` 概念可以一对一映射到
Vulkan 的顶点/索引缓冲替换，`MergedSkeleton` 可以映射到 uniform/storage buffer 改写。

**优势**
- 游戏逻辑与 Unity 层完全不可见，不存在「游戏读到自己被改过的 Mesh 数据」这类破绽。
- **对游戏版本变化最鲁棒**：只要渲染管线与着色器结构不变，小版本更新通常不影响。
  这是四条路线里唯一在这一维度拿到「高」的。

**代价**
- 工程量最大：需要拦截并正确转发大量 `vk*` 调用，维护 instance/device dispatch table，
  处理 `pNext` 链与 loader 接口协商。
- 不稳定的来源是**驱动与内存语义**：Android 上顶点缓冲常在 device-local 或 tiled 内存里，
  不能就地改指针，必须 staging buffer + `vkCmdCopyBuffer`，还要处理同步与 barrier。
- 各 GPU 厂商（Adreno / Mali / PowerVR / Xclipse）行为有差异，需要在多设备验证。

**关键风险**：准入。Android 只在「app 可调试 / userdebug 且 root / Android 11+ 应用自愿 opt-in」
时才注入隐式层。本机是 `user` 构建，因此必须走「让目标 app 看起来可调试」这条在 root 设备上
影响 framework 判定的路径。这条路径本身已被公开研究复现（见 [12-references.md](/blog/efml4a-12-references/)
中的 Promon 报告）。细节与准确边界见 [04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/)。

### 路线 B：IL2CPP hook —— 实现最直观，但版本最脆

**结论**：技术可行性高，是**研究阶段验证玩法的最优起点**，但作为长期加载器形态不理想。

**优势**
- 直接操作 `Mesh` / `SkinnedMeshRenderer` 这类高层对象，不需要和 GPU 内存语义搏斗。
- 能触达图形层触达不了的东西：材质与 shader 的选择、`Renderer` 属性、资源加载流程。
- 结合已有的 il2cpp dump 工具（作者本人的 [Zygisk-Il2CppDumper](https://github.com/moyingyilang/Zygisk-Il2CppDumper)）
  可以较快定位目标类与方法。

**代价**
- **每个游戏版本都要重新适配**：符号被剥离，方法偏移随版本变化，需 pattern scan 或
  依赖 `global-metadata.dat`，而后者本身可能是完整性校验的对象。
- 检测面最大：进程内多出模块、内存被改写、元数据被触碰，都是可检测信号。

### 路线 C：AssetBundle 替换 —— 最稳，但丢掉了 EFMI 的核心能力

**结论**：适合做贴图/整体资源替换，**无法替代**路线 A/B 在模型注入上的地位。

**优势**
- 不 hook 运行时，稳定性最高，不依赖图形驱动行为。
- 门槛最低：解包 → 改 → 重打包，或 hook `open` 做重定向。

**代价（关键）**
- EFMI 的核心能力是**运行时**替换：骨骼合并、形态键量化上传、跨部件骨骼统一，
  这些都需要在 GPU 侧数据参与下完成。资源替换是在**加载之前**定型的，
  做不到这些，也无法在游戏运行中动态切模型。
- 触及版权红线最直接：修改并重新分发游戏资源包风险最高。
- 资源包可能有自定义头/加密/签名校验，未必能改。

### 路线 D：frida / ptrace —— 研究探针，不是加载器

**结论**：在 M0/M1 阶段价值极高（dump、抓参数、验证假设），但**不应**作为最终形态：
稳定性差、检测风险最高、性能开销不可接受。

## 7.3 选型建议

不选一条，而是**分层组合**：

```
        ┌─────────────────────────────────────────────┐
        │  统一 mod 格式（IR）  docs/10-mod-format.md │
        └───────────────┬─────────────────────────────┘
                        │ 编译/解释成各后端动作
        ┌───────────────┼───────────────┬─────────────┐
        ▼               ▼               ▼             ▼
   vulkan-layer    il2cpp-hook    asset-bundle   (后续可扩展)
   【主攻方向】      【快速验证】     【贴图/整包】
```

| 阶段 | 主路径 | 辅助手段 | 目的 |
| --- | --- | --- | --- |
| M0（当前） | 文档 + 骨架 | frida / il2cpp dump | 论证可行性与摸清目标结构 |
| M1 | **IL2CPP hook** | — | 用最直观的路径**先跑通一次换模型**，证明整条链路（格式 → 加载 → 生效）成立 |
| M2 | **Vulkan 隐式层** | IL2CPP hook 作为对照组 | 攻主方向：在图形边界复现替换，验证版本鲁棒性优势 |
| M3 | 双后端收敛 | AssetBundle 用于贴图 | 让同一份 mod 在两条后端上都能执行，展示 IR 的价值 |
| M4 | 三后端 + 工具链 | — | 稳定化、性能优化、发布准备（见 [11-roadmap.md](/blog/efml4a-11-roadmap/)） |

**为什么 M1 用 IL2CPP 而不是直接上 Vulkan 层**：M1 的目标是**尽快验证「格式 → 加载 → 生效」
这条链路**，而不是验证图形注入。IL2CPP 路线的反馈循环短得多，能在最短时间内暴露
mod 格式设计上的问题（例如 IR 是否足够表达一次模型替换）。等格式稳定后，
再把同一个 IR 编译到 Vulkan 层，才能验证「IR 真的与后端无关」这个核心设计假设。

## 7.4 决策依据（评分口径）

| 维度 | 含义 |
| --- | --- |
| 可行性 | 在 [01-overview.md](/blog/efml4a-01-overview/) §1.4 的目标设备上能否做到 |
| 工程量 | 从零到「能替换一个模型」所需的工作量 |
| 稳定性 | 跨游戏小版本更新与跨设备的表现 |
| 检测风险 | 被游戏完整性校验发现的难度（低 = 更难被发现） |
| 版本鲁棒性 | 对游戏版本变化的容忍度 |

## 7.5 尚未解决的问题

以下问题在 M0 阶段**没有**结论，需要真机实验回答：

1. 目标游戏的 Android 端是否走 Vulkan，还是存在 GLES 回退路径？若是回退，隐式层路线失效。
2. 顶点/索引缓冲在目标游戏里实际落在哪类内存（device-local / host-visible / tiled）？
   这直接决定替换实现的复杂度。
3. 目标游戏是否对 `global-metadata.dat` 或代码段做完整性校验？若是，路线 B 的代价显著上升。
4. 隐式层准入的准确条件在 Android 17 上是否与公开资料一致（本机为 `user` 构建）？
5. 移动端功耗预算下，逐 draw 做识别的开销是否可接受（EFMI 在 PC 上已需专门优化）？

这些问题的验证计划见 [11-roadmap.md](/blog/efml4a-11-roadmap/)。
