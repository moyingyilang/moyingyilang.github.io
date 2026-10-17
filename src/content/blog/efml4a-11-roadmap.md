---
title: "11 · 路线图 M0–M4"
description: "EFML4A 研究文档 · 11-roadmap（Arknights: Endfield Mod Loader for Android）"
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

> ✅ **本路线已有真机实测结果**：准入条件、环境变量失效、SELinux 标签坑与成功加载证据见 [14-ondevice-layer-proof.md](/blog/efml4a-14-ondevice-layer-proof/)。两者冲突时**以 14 为准**。


## 11.0 阶段设计原则

1. **每个阶段都有可证伪的退出条件**。写不出「怎么算失败」的阶段不是阶段，是愿望。
2. **先验证格式，再验证注入**。M1 刻意选反馈循环最短的路线（IL2CPP hook），目的是尽快暴露
   IR 设计缺陷，而不是尽快造出一个能用的加载器。
3. **每个阶段都产出可交付物**，而不是只产出结论。
4. **红线不可跨越**：任何阶段都不实现修改数值、竞技作弊、资源再分发。见
   [08-threat-model.md](/blog/efml4a-08-threat-model/)。

## 11.1 阶段总览

| 阶段 | 主题 | 主路径 | 退出条件（摘要） |
| --- | --- | --- | --- |
| **M0** | 可行性论证与骨架 | 文档 + frida/il2cpp dump 摸底 | 四路线结论成型；骨架可编译；CI 绿；私有仓库策略落地 |
| **M1** | 打通「格式 → 加载 → 生效」 | IL2CPP hook | 在真机上用一份 **EFML4A 格式的 mod** 成功替换一个模型 |
| **M2** | 图形边界复现（主攻） | Vulkan 隐式层 | 在真机上通过隐式层替换顶点/索引缓冲并正确呈现 |
| **M3** | 双后端收敛 + 资产层 | Vulkan 层 + IL2CPP + AssetBundle | 同一份 mod 可在两条后端执行；贴图可由资产层替换 |
| **M4** | 稳定化与发布准备 | 三后端 + 工具链 | 通过发布审查清单；再评估是否解除私有 |

---

## M0 · 可行性论证与骨架（当前阶段）

### 目标
把「Android 上怎么做」这个问题从模糊变成有依据的选择题，并把工程骨架立起来。

### 交付物
- [x] 研究文档集 `docs/01`–`docs/12`
- [x] `efml-core`：manifest / IR / identify / package / checksum / version / routes
- [x] `efml-cli`：`validate` / `info` / `list` / `checksum` / `routes` / `tui`
- [x] `efml-gui`：混合架构 GUI（Rust 核心 + 本地 Web UI）
- [x] `vulkan-layer/`：可编译的隐式层骨架（入口协商 + dispatch + 拦截转发 + 统计）
- [x] `android/`：管理器 App 与 LSPosed 模块骨架
- [x] `mods/example-mod`：格式规范的参考实现
- [x] CI（Rust / Vulkan 层 / Android 三条独立作业）
- [x] 「开发期强制私有」策略写入 [08-threat-model.md](/blog/efml4a-08-threat-model/)

### 需要真机实验回答的问题（M0 的主要不确定性）
| # | 问题 | 手段 | 影响 |
| --- | --- | --- | --- |
| Q1 | 目标游戏 Android 端是否走 Vulkan，有无 GLES 回退 | 抓 `libunity.so` 加载的图形库、看进程映射 | 决定路线 A 是否成立 |
| Q2 | 顶点/索引缓冲实际落在哪类内存 | RenderDoc / AGI 抓帧 | 决定替换实现复杂度 |
| Q3 | 是否有 `global-metadata.dat` / 代码段完整性校验 | 篡改一个字节观察行为 | 决定路线 B 的代价 |
| Q4 | 隐式层准入在 Android 17 `user` 构建上的准确边界 | 装一个最小层，看是否被加载 | 决定路线 A 的前置条件 |
| Q5 | shader/pipeline 指纹的稳定性 | 跨两次启动比对指纹 | 决定识别策略是否可用 |

### 退出条件
1. `cargo test` / `cargo clippy -D warnings` / Vulkan 层 CTest / Android `assembleDebug` 全绿。
2. Q1–Q5 中至少 Q1、Q4 有明确结论（其余可留到 M1）。
3. 四路线结论与 `efml-core::routes` 一致，无自相矛盾。

### 失败判据
若 Q1 结论是「目标游戏只走 GLES」，则路线 A 的可行性降级为「低」，
必须回到 [07-route-matrix.md](/blog/efml4a-07-route-matrix/) 重新选型——
这种情况下的替代方案是 GLES 层的 `eglGetProcAddress` 拦截，工作量与风险都更高。

---

## M1 · 打通「格式 → 加载 → 生效」

### 目标
用**最短的反馈循环**证明整条链路成立：一份 EFML4A 格式的 mod，被加载器读到，
编译成动作，在真机上让模型真的变了。

### 为什么用 IL2CPP hook
不是因为它最好，而是因为它**最容易做对**。M1 要验证的是格式与链路，
不是图形注入。IL2CPP 路线能直接操作 `Mesh` 对象，避免在 M1 阶段就陷进
GPU 内存语义与同步问题里。

### 交付物
- `android/lsposed-module`：hook `SkinnedMeshRenderer.set_sharedMesh` 或等价入口
- IR → IL2CPP 动作的**第一个后端实现**（哪怕是硬编码的）
- 至少 1 个可替换模型的 mod 包，走完整 `efml validate` 校验
- 记录「一次替换的最短可行步骤」，作为 M2 的对照基线

### 退出条件
在目标设备上，装载一个 EFML4A 格式的 mod 后，游戏内出现替换后的模型，
且**不需要修改任何代码**（只靠 mod 包的数据）。

### 失败判据
若必须为每个模型手写 native 代码才能生效，说明 IR 表达力不足——
回到 [10-mod-format.md](/blog/efml4a-10-mod-format/) 修格式，而不是在 loader 里加特例。

---

## M2 · 图形边界复现（主攻方向）

### 目标
在 Vulkan 隐式层上复现 M1 的效果，并验证路线 A 的核心假设：
**对游戏版本变化更鲁棒**。

### 交付物
- 完整的层实现：入口协商、dispatch 表、所需 `vk*` 拦截与转发
- 顶点/索引缓冲替换（staging + `vkCmdCopyBuffer` + 正确 barrier）
- draw call 识别：pipeline 指纹 + 顶点签名
- 骨骼与形态键注入（对应 EFMI 的 MergedSkeleton / ShapeKeys）
- **性能测量**：逐 draw 识别的帧时间与功耗开销（对照 M1 的 IL2CPP 方案）

### 退出条件
1. 同一份 M1 的 mod 包，**不修改 mod** 即可在 Vulkan 层后端生效。
2. 识别在连续两次冷启动后仍然命中（指纹稳定）。
3. 开销在可接受范围（需先定义阈值；作为 M2 的首要任务之一）。
4. 游戏小版本更新后，替换仍然生效（这是路线 A 相对路线 B 的**核心论点**，必须实测）。

### 失败判据
若第 4 条不成立，则路线 A 相对路线 B 的最大优势不存在，
应重新评估是否值得承担 Vulkan 层的工程量。

---

## M3 · 双后端收敛 + 资产层

### 目标
证明「IR 与后端无关」这个核心设计假设真的成立，而不是纸面承诺。

### 交付物
- IR → 三个后端的编译器/解释器
- 贴图与材质替换经 AssetBundle 后端落地
- 后端选择与冲突仲裁规则（见 [09-architecture.md](/blog/efml4a-09-architecture/) §9.8）
- 跨后端一致性测试：同一 mod 在两后端下产生等价结果

### 退出条件
同一份 mod 包，不做任何修改，能分别被 `vulkan-layer` 与 `il2cpp-hook` 后端执行，
且视觉结果一致。

### 失败判据
若某个 IR 字段只能被一条后端理解（且不是本质限制），说明 IR 设计泄漏了后端细节，
应重构 IR。

---

## M4 · 稳定化与发布准备

### 目标
从「研究原型」变成「可被他人使用的工具」，并决定仓库可见性。

### 交付物
- 管理器 App 可用：浏览、校验、安装层/模块、开关
- 完整文档（mod 作者指南、排障指南）
- 发布检查清单全部通过（[08-threat-model.md](/blog/efml4a-08-threat-model/) §6，P-01 起）
- 多设备验证：至少 Adreno + Mali 各一台（当前只有 Adreno 设备）

### 退出条件
满足 [08-threat-model.md](/blog/efml4a-08-threat-model/) 「可见性策略」一节的 E-01–E-06
全部 Exit Criteria，**才**评估解除私有。

> 注意：解除私有是一个**独立决策**，不是 M4 的自动结果。即便技术成熟，
> 也应先完成滥用风险与合规审查。

---

## 11.2 横切事项（贯穿所有阶段）

| 事项 | 要求 |
| --- | --- |
| 工具语言 | Rust 或 Kotlin。需要脚本时做成 TUI，不做裸 shell |
| 测试 | 每个 crate 有单测；CI 跑 `fmt` / `clippy -D warnings` / `test` |
| 许可证 | AGPL-3.0-or-later；引入第三方代码前先做兼容性分析 |
| 可见性 | 进入维护阶段前**强制私有** |
| 数据卫生 | 禁止把游戏资源、密钥、设备个人数据提交进仓库 |
| 文档同步 | 结论变更时同步 `efml-core::routes` 与 `docs/07`，避免漂移 |

## 11.3 已知的依赖与阻塞

| 阻塞项 | 影响 | 缓解 |
| --- | --- | --- |
| 无 Android NDK（本机） | 无法在设备上本地编译 native 部分 | 由 CI 编译；或在设备上安装 NDK |
| 只有 Adreno 设备 | Mali / PowerVR 差异未验证 | M4 前补充设备 |
| 无第二台真机做对照 | 跨设备版本鲁棒性结论偏弱 | 用模拟器/云真机补充（注意模拟器 GPU 行为不代表真机） |
| 目标游戏版本会更新 | 识别指纹可能失效 | 这正是路线 A 要证明的鲁棒性优势 |
