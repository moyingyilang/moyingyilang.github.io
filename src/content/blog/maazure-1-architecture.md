---
title: MaaAzure 架构：把 28 万行 Python 换成 MaaFramework + Rust
description: 碧蓝航线自动化脚本从「自研设备层 + 自研 OCR + 手写状态循环」迁到 MaaFramework 内核 + 声明式 Pipeline + Rust 领域模块。这篇讲清楚三件事：为什么切、怎么切、边界划在哪——每条决策都附代价。
date: 2026-10-29
category: projects
tags:
  - Rust
  - MaaFramework
  - 架构设计
  - 自动化
  - 碧蓝航线
---

## 0. 结论先说

| 项 | 迁移前（AzurPilot） | 迁移后（MaaAzure） |
|---|---|---|
| 运行时代码 | 288,076 行 Python / 2,037 文件 | ~4 万行 Rust + ~1 万行 Pipeline JSON |
| 视觉/设备 | 自研 12,831 行设备层 + 2,258 行 OCR | MaaFramework（C++，LGPL-3.0） |
| 流程编排 | 手写 `while` 状态循环 | 声明式 `next` 图 |
| 游戏逻辑测试 | 0 | 合成帧 fixture + 录像回放 |
| 许可证 | GPL-3.0 | AGPL-3.0 |

做完之后我最大的感受是：**这不是一次性能优化，是一次维护面积的收缩**。

## 1. 先纠正一个幻想：MAA 线并不更快

旧项目每帧 ~350ms，其中 99% 在等模拟器截图；图像处理 2.5ms，OCR 100–180ms。
把这个栈换成 C++ 内核，**快的部分本来就不是瓶颈**。

> 真正值钱的是四件事：声明式 Pipeline 替代手写流程、生态工具链（调试器/日志分析）、
> Win32 控制器做后台静默、跨平台控制器。

如果有人告诉你「换 MAA 会快十倍」，那大概率是没量过帧预算。我把四项耗时在文档里单列，
就是为了防止团队自己骗自己。

## 2. 边界：什么东西必须写成什么

重写最容易翻车的不是技术，是**把该声明的写成代码、把该写代码的塞进 JSON**。
我给自己定的判定树只有三条：

```
一段逻辑
│
├─ 只依赖当前这一帧？ ── 否 ─┐
│                            │
└─ 是 ─┬─ 有跨帧记忆？ ── 是 ─┤
       │                      │
       └─ 否 ─▶ Pipeline JSON │
                              ▼
                     Rust 领域代码（纯逻辑 / 状态机）
```

落到具体模块：

| 归属 | 判据 | 例子 |
|---|---|---|
| Pipeline JSON | 帧内闭合、无跨帧记忆、动作是原子 UI 操作 | 主界面 → 委托 → 领取 → 返回 |
| Rust 纯逻辑 | 需要比较/排序/建模，无副作用 | 委托选最短、A\* 寻路、网格预测 |
| Rust 状态机 | 跨帧记忆，每帧产出一个命令 | 战役一局、大世界一条线 |
| Rust 运行时 | 和设备/内核打交道 | Controller、Tasker、调度器 |

**反模式**（出现即打回）：CustomAction 里 `for` 循环点 8 次；用 `max_hit` 当业务计数器；
在识别回调里自己截图。

## 3. crate 树：四层，依赖单向

```
crates/
├── foundation/       1 地基 —— 不含碧蓝航线知识
│   ├── core            错误树 / 几何 / 任务结果
│   └── vision          数字纠错 / 时长解析
├── domain/           2 领域 —— 只有碧蓝航线知识，纯逻辑
│   ├── battle          战役 / 地图 / 战斗
│   ├── config          由 interface.json 生成的强类型配置
│   └── daily           日常任务的最小决策
├── runtime/          3 运行时 —— 唯一接触 MaaFramework
│   └── runner          Engine trait / Tasker / 调度器 / 语料回放
└── apps/             4 应用 —— 只有入口
    ├── daemon          守护进程
    └── xtask           资源转换 / 校验
```

依赖严格单向：`apps → runtime → domain → foundation`。硬规矩是
**`maa-framework` 只允许出现在 `runtime/runner` 一个 crate 里**。

这么做换来一个很实际的好处：`foundation` 与 `domain` 都是零依赖、不碰 FFI 的纯逻辑，
所以 `cargo test` 在一台没有 MaaFramework SDK 的安卓手机上就能跑全绿——
后面「没有模拟器怎么验证」那一篇全靠这条。

## 4. 错误处理：从字符串常量到错误树

旧版错误是一堆字符串常量散在 `module/exception.py`，改一处要 grep 全仓。新版是四个分支：

```
AzureError
├─ Ending      正常终止：CampaignEnd / OilExhausted / OilMaxed
├─ Recoverable 可恢复：MapDetection / EnemyMoved
├─ Restart     需重启游戏：GameStuck / GameTooManyClick
└─ Fatal       不可恢复：HumanTakeover / Controller
```

调度器只看分支，不匹配每个叶子：

```rust
pub const fn counts_as_failure(&self) -> bool {
    matches!(self.branch(), ErrorBranch::Restart | ErrorBranch::Fatal)
}
```

「战役打完」和「油满了」不再被算成失败——这种语义以前靠每个调用点自觉，现在靠类型。

## 5. 十二个决策，每条都写了代价

文档里 `docs/1-foundation/1.1-decisions.md` 记了 12 条决策，每条强制写「代价」。
挑三条最关键的说：

**DEC-001 用 MaaFramework 做内核** — 代价：受上游 API 演进约束、LGPL 合规要求动态链接；
收益：删掉 12,831 行设备层 + 2,258 行 OCR。

**DEC-003 流程用 Pipeline JSON** — 代价：没有编译期检查，只能靠 `xtask check` 兜底；
收益：删掉 2,220 行 A\* 寻路，且「忘记 `continue` 导致重复点击」这类 bug 从根上消失。

**DEC-010 许可证 AGPL-3.0** — 代价：比 GPL 更严，网络服务也须开源；
收益：与 MaaEnd 等生态项目同协议，法律上可组合（但仍不复制它们的代码——不同游戏，
引入只增加维护面积）。

## 6. 现在到哪一步了

- ✅ 迁移工具链：图片/节点/战役数据/配置四条转换全部跑出真实数据
- ✅ FFI：`Engine` trait + MaaEngine，交叉编译出 aarch64/x86_64/Windows 三个产物
- ✅ 设备无关的验证：合成帧 fixture + 语料回放闭环
- ⬜ 真机端到端：等一台跑着游戏的模拟器

---

系列文章：

1. **架构：把 28 万行 Python 换成 MaaFramework + Rust**（本篇）
2. 资源迁移：把「数据即代码」拆开
3. 在 arm64 手机上交叉编译 Windows 包
4. 没有模拟器，怎么验证一个自动化脚本

代码在 [MaaAzure](https://github.com/moyingyilang/MaaAzure)（AGPL-3.0）。
