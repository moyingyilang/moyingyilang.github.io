---
title: "57. 项目进展复盘（截至 Round 171 / 2026-10-17）"
description: "EFML4A 研究文档 · 57-progress-review（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 本文是一次**横切复盘**，不是某一轮的技术记录。目的：把 01–56 的分散结论收敛成
> 「现在到底做到哪了 / 卡在哪 / 哪些说法已经过时」。
>
> **快照基准**：分析时 `HEAD = 7713b99`（2026-10-17 09:40，`abpack pad 模式`）。
> 入库时 `HEAD = 26e8165`，期间另有一次**并行提交**（`69bc32b` 修复 C 工具链可复现性、
> `26e8165` 修复文档偏差 + 重建本索引），§57.5 已逐条标注修复状态。

---

## 57.1 一句话结论

**逆向与离线写入链路已经打通到「游戏接受修改」这一层，但「看得见的 mod」这最后一步仍未闭环。**

项目实际主线已从 [README](/EFML4A) 早期描述的「Rust 工具链 + Vulkan 层骨架」（M0 形态）
转向**《终末地》1.6.4 的 VFS 离线等长替换**（纯 C 工具链）。

---

## 57.2 现状与早期文档的偏差（★ 先读这一节）

### 57.2.1 文档滞后

| 维度 | 早期文档的说法 | 仓库实际状态（Round 171） |
| --- | --- | --- |
| 主战场 | `efml-core/cli/gui` + `vulkan-layer/` | `tools/`（C）+ `docs/`；`native/` 自 10-10 初始化后**再无提交** |
| 技术路线 | 「统一 IR + 多后端」，M1 IL2CPP → M2 Vulkan | 实际走**路线 C（AssetBundle/.ab 离线替换）**，而 [07](/blog/efml4a-07-route-matrix/) 将其评为「可行性中、风险高」 |
| 语言政策 | Rust 或 Kotlin（[11](/blog/efml4a-11-roadmap/)） | [LANGUAGE.md](https://github.com/moyingyilang/EFML4A-docs/blob/main/LANGUAGE.md) 与 [51](/blog/efml4a-51-language-mandate/) 要求**禁用 Python、C 系为准** |
| 许可证 | AGPL-3.0-or-later（根 README / CONTRIBUTING / [11](/blog/efml4a-11-roadmap/)） | [LICENSE](../LICENSE) 已是 **GPL-3.0**（`a104586`）；根 README 与 [08](/blog/efml4a-08-threat-model/) 已在 `26e8165` 修正，其余见 §57.5.3 |

### 57.2.2 各子系统最后活动时间

| 子系统 | 最后提交 | 状态 |
| --- | --- | --- |
| `tools/`（C 工具 + zygisk payload） | 2026-10-17 | **活跃主战场** |
| `docs/` | 2026-10-17 | 活跃 |
| `android/` | 2026-10-17 | 零星 |
| `native/`（Rust） | 2026-10-10 | 冻结 |
| `vulkan-layer/` | 2026-10-10 | 冻结（隐式层路线已证伪） |

### 57.2.3 投入强度

提交按日分布：`10-10: 11` → `10-11: 6` → `10-12: 8` → `10-13: 39` → `10-14: 15`
→ `10-15: 60` → `10-16: 52` → `10-17: 26`，累计 **217 次提交 / 58 篇文档 / 91 个 `.c` 文件**。
（`7713b99` 时为 215 次；本文入库前后新增 `69bc32b`、`26e8165`。）

---

## 57.3 已确证的成果（按证据强度）

### 57.3.1 格式逆向（项目最硬的资产）

| 成果 | 证据 | 文档 |
| --- | --- | --- |
| `.blc` 全字段解析 | 270,435 条与 CLI 一致；ChaCha20(nonce=前 12B, counter=1) + CRC32 通过 | [50](/blog/efml4a-50-vfs-structure-cracked/) |
| **公开工具全部失效的 BUG** | `codeVersion > 3` 实为 **8 字节** tag（AnimeStudio 只读 4 字节）⇒ 自有 `vfsfull.c` 是 1.6.4 唯一正确实现 | [52](/blog/efml4a-52-vfs-full-chain/) |
| `.ab` 混淆容器 | 48B 头 + 块表（10B/块，混合字节序）+ 节点表；读/逆公式多值域往返通过 | [53](/blog/efml4a-53-write-path-status/) |
| **VFSAES 对合性** | 加密 = 解密（同一 XOR keystream）⇒ 大幅简化写入 | [52](/blog/efml4a-52-vfs-full-chain/) |
| 纹理命名/格式规律 | 12,779 个 `.ab` 普查：`T_<类别>_<角色>_face_<编号>_<类型>`，ASTC 4x4/5x5/6x6 | [52](/blog/efml4a-52-vfs-full-chain/) |
| Unity 网格压缩 | 已确认游戏顶点**不是原始 float32** ⇒ 「模型变了但扭曲」的根因 | [40](/blog/efml4a-40-unity-compressed-mesh/) |

### 57.3.2 运行时图形层：曾经端到端成功，被反篡改阻断

- [44](/blog/efml4a-44-phase4-final/) §44.13：`vkCmdCopyBufferToImage` hook **已成功把 mod 的
  262,144 字节 BC7 写入游戏的 512×512 纹理**（命中 4 次，未映射 0 次）。
- 关键技巧：`vkMapMemory` 序言含 `CBZ` 无法 inline hook ⇒ 改为 hook `vkBindBufferMemory`
  记录 `buffer→memory`，再**主动调用** `vkMapMemory` 取 host 指针。
- **致命障碍**：[44](/blog/efml4a-44-phase4-final/) §44.1 证实游戏有**反篡改看门狗，会周期性还原代码补丁**。
- 代价：**9 次崩溃**，归因见 [45](/blog/efml4a-45-postmortem/)；随后 [46](/blog/efml4a-46-divergent-paths/) 发散出 10 条路径，
  战略上从「hook 最末端（GPU）」转向「离线改数据」。

### 57.3.3 离线写入链路（当前主线）

```
① .chk 原地等长替换（同偏移同长度）
② blcfix 更新 chunk contentMD5 + CRC32
③ blcsetdata 更新 file dataMd5
④ 游戏启动 → 无「数据加载失败」、无崩溃、无 tombstone
```

（[54](/blog/efml4a-54-writeback-success/)）

最新提交 `7713b99` 进一步做到 **abpack `pad` 模式：`.ab` 布局 100% 不变**
（实测 `compBI1 edf2==edf2`，总长 `122812==122812`，目标区匹配 TRUE）。
做法：给**未压缩**块信息追加填充 → 迭代搜索使压缩后长度恰好等于原 `compBI`
→ `uncompBI` 写填充后大小，绕开「LZ4 无结束标记」的填充难题。

**定位修正**（[55](/blog/efml4a-55-visible-mod-attempt/)）：游戏启动时**只加载 `InitBundle` 组**
（`0CE8FA57/A47587BA….chk`，1075 个 `.ab`）；此前死磕的 `7064D8E2` main bundles **启动时完全不加载**。

### 57.3.4 Rust 工程骨架（静止但健康）

`cargo test --all-features` 于 Round 171 复跑：**49 个测试全绿**
（`efml-core` 38 / `efml-cli` 4 / `efml-gui` 6 / doc-test 1）。
问题：与当前研究主线已无耦合。

---

## 57.4 ★ 当前卡点（按严重度）

| # | 卡点 | 具体表现 |
| --- | --- | --- |
| 1 | ~~视觉确认未闭环~~ | ✅ **已闭环**：`colordetect` 在 F16/F17 帧命中 **44,313 纯黄像素**；`redbox` 在 P04 帧命中 **6,763 纯红像素**（397×243 棋盘图案）。见 [59](/blog/efml4a-59-mod-visible-success/)、[62](/blog/efml4a-62-pattern-mod-verified/) |
| 2 | ~~LZ4Inv 压缩器弱于游戏~~ | ✅ **已攻克**：v4（HBITS=20, CHAIN=1024, lazy matching）从 **+52.1% 收敛到 +1.2%**（124,038 vs 122,604）；往返 0 差异。见 [60](/blog/efml4a-60-lz4inv-v4/) |
| 3 | **Unity 网格压缩未解** | 模型级成功（[32](/blog/efml4a-32-success-record/)，"模型确实变了/差一步美满"）被顶点压缩卡住；索引对齐、BC7→Unity 格式转换同样待办 |

下一步候选已由 [56](/blog/efml4a-56-status-and-next/) §56.4 给出：选非图集独立纹理 / 换 astcenc 质量 /
原纹理原样重压对照 / 实现更强压缩器。

---

## 57.5 复盘发现的工程性问题（含修复状态）

### 57.5.1 C 工具链无法从仓库复现 —— ✅ 已修复（`69bc32b`）

```
复盘时（7713b99）:
  89 个 .c 文件，无 Makefile / 无统一构建入口。
  abpack.c 声明依赖 deps.c + vfsaes.c，但 deps.c 【不在仓库里】
  （仅存在于 ~/.efml4a/scratch/deps.c）

  实测: abpack / abverify / abtool 单独编译 → undefined symbol
        vfsfull 单独编译 → undefined symbol: crc32（需 -lz）
  而 [35](/blog/efml4a-35-tools-c/) §35.1 写的是:
        clang -O2 -o abtool tools/vfs/abtool.c -lm   ← 与事实不符

修复（69bc32b）:
  + tools/vfs/deps.c      LZ4 / LZ4Inv 双向实现入库
  + tools/vfs/Makefile    统一构建入口（COMMON = deps.c vfsaes.c）
  + tools/vfs/ms.c        多线程内存搜索
  ~ tools/vfs/README.md   重写

复核（Round 171）:
  $ make -C tools/vfs -B      → exit 0（仅 -Wformat / -Wunused 警告）
  $ make -C tools/vfs list    → 14 个产物齐全
  ⇒ 主战场恢复可复现 ✓
```

### 57.5.2 CI 不覆盖 `tools/` —— ✅ 已修复（`1b79b99`）
新增 `tools` job：`make -B` 构建 14 个工具、校验产物齐全、`lz4invtest` 自测（可压缩 + 随机两组夹具）。
