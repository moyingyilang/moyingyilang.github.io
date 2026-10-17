---
title: "38. 1.6.4 完整更新后的 mod 部署（正确文件）"
description: "EFML4A 研究文档 · 38-v164-final-mod-deploy（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 38.1 关键教训：**`.blc` 变了，目标文件也变了！**

### 更新过程中的三个状态

| 阶段 | `.chk` 数 | InitBundle 的 `.blc` | InitBundle 的 `.chk` |
| --- | --- | --- | --- |
| 1.5.3 | 1093 | `f02f2e20…` | `EAAFEC0435EC71FFC65D8CF3E4595852.chk`（175,600,672 B） |
| 1.6.4 中间态 | 1061 | `f02f2e20…`（未变） | 同上 |
| **1.6.4 完整更新后** | **1164** | **`2d54990d…`（变了！）** | **`A47587BA5EEF7FD05F1FEC103DEA85BD.chk`（217,713,773 B）** |

**⇒ 完整更新后，`.blc` 从 `version=4` 变成 `version=5`，
且 `chunkMD5` 变为 `A47587BA5EEF7FD05F1FEC103DEA85BD` ⇒ **游戏改为读新文件**。**

**⇒ 我在中间态时改的 `EAAFEC0435EC71FFC65D8CF3E4595852.chk` 已**不再被引用**，
所以那次 mod **不生效**。**

## 38.2 ★ 如何确定"游戏真正读的是哪个 `.chk`"

**规律：`.blc` 解密后的 chunk 头前 16 字节 = `chunkMD5`，
**转大写后就是 `.chk` 的文件名**。**

```
新 .blc (version=5) 解密后 chunk头 32B:
  a47587ba5eef7fd05f1fec103dea85bd 91e6e5e0201b29ba81689cdf134a50c5
  └────────── chunkMD5 ──────────┘ └────────── 内容 MD5 ──────────┘

⇒ .chk 文件名 = A47587BA5EEF7FD05F1FEC103DEA85BD.chk
```

**验证：设备上确实存在 `A47587BA5EEF7FD05F1FEC103DEA85BD.chk`（217,713,773 B），
且其 md5 = `91e6e5e0201b29ba81689cdf134a50c5` ⇒ **与 chunk 头里的第二个 MD5 吻合**。**
**⇒ 这给出了一个**通用判据**：`.chk` 文件的 md5 应等于 `.blc` chunk 头里的第 2 个 MD5。**

## 38.3 条目在新文件里的位置

**新文件里搜不到 `Data/Bundles/Android/initial/e2cd202a3481b563467135e6.ab`
（全路径），只能搜到 `initial/e2cd202a3481b563467135e6`。**

**用**结构特征**定位（更可靠）：**
```
1.5.3 时该条目：骨骼表 "Root/" 在条目内 +288,693
1.6.4 新文件：  "Root/" 在 .chk 内 @52,521,961
⇒ 条目起点 = 52,521,961 − 288,693 = 52,233,268
```

**验证（三项全部吻合）：**
| 检查项 | 1.5.3 | 1.6.4 新文件 @52,233,268 |
| --- | --- | --- |
| 头部 32 B | `68 b2 16 23 cb 8a 6e b4 …` | **完全相同** |
| `m_Center` | `(-0.1942, +0.0033, -0.0368)` | **完全相同** |
| `m_Extent` | `(+0.0455, +0.1829, +0.0445)` | **完全相同** |
| 骨骼表 @+288,693 | `"Root/\x00\x05a_M/Spine1\x00…"` | **完全相同** |

**⇒ 该条目的**内容在 1.5.3 与 1.6.4 之间完全没变**，
只是它在 `.chk` 里的**位置**变了（51,364,253 → 52,233,268）。**

## 38.4 部署

```
目标文件 : A47587BA5EEF7FD05F1FEC103DEA85BD.chk  (217,713,773 B)
条目起点 : 52,233,268
写入区   : 52,246,068  (= 条目 + 12,800)
写入内容 : EFMI edmin_maid 的 Component0_VB0
           7,911 顶点 × 16 B = 126,576 字节
方式     : 等长替换（.blc 完全未动）

结果:
  部署后 md5 = f93846d47543c7a8057c26fa87530640   ✓
  文件大小   = 217,713,773                        ✓ 等长
  0CE8FA57.blc = 2d54990d0db687b489515d81268acd52 ✓ 未动
  游戏       : 已启动
```

**回滚**：`su -c sh ~/.efml4a/scratch/mod164_final/ROLLBACK.sh`

## 38.5 ★ 更新后的通用操作流程（经验固化）

```bash
# 1) 查版本
su -c 'dumpsys package com.hypergryph.endfield | grep versionName'

# 2) 采集 .blc 基线
su -c 'cd $VFS && find . -name "*.blc" -exec md5sum {} \;'

# 3) 解密 InitBundle 的 .blc，读 version 与 chunkMD5
cp $VFS/0CE8FA57/0CE8FA57.blc /tmp/
blcparse -i /tmp/0CE8FA57.blc          # 看 version 与 chunkLen
#   然后从解密后的 chunk 头取前 16 字节 → 大写 → 就是 .chk 文件名

# 4) 用 chunk 头的第 2 个 MD5 校验 .chk 是否正确
md5sum $VFS/0CE8FA57/<chunkMD5大写>.chk   # 应等于 chunk 头的第 2 个 MD5

# 5) 用结构特征定位条目（骨骼表 "Root/" 在条目内 +288,693）
#    grep -abo 'Root/' <chk>  → 减去 288,693 得条目起点

# 6) 等长替换
abtool swap <chk> $((条目起点+12800)) <EFMI的VB0.buf> <out.chk>

# 7) 备份 + 部署 + 回滚脚本
```

## 38.6 ⚠️ 重要教训

| 教训 | 说明 |
| --- | --- |
| **`.blc` 变化 ⇒ 目标 `.chk` 可能换名** | 完整更新后 `.blc` 从 v4 升到 v5，`.chk` 名变了 |
| **不能只按"文件存在"判断** | 旧 `.chk` 仍在磁盘上（175 MB），但已不被引用 |
| **必须用 chunk 头的 chunkMD5 确认** | 转大写 = `.chk` 文件名 |
| **条目位置会变** | 用结构特征（骨骼表偏移）定位，比搜全路径可靠 |
| **`.chk` 的 md5 应等于 chunk 头第 2 个 MD5** | 可用于校验 |

---

## 38.7 最终状态与清理（第 44 轮）

### 38.7.1 ★ mod 已在游戏中

```
目标文件 : A47587BA5EEF7FD05F1FEC103DEA85BD.chk (217,713,773 B)
当前 md5 : f93846d47543c7a8057c26fa87530640   ← mod 已部署
原版 md5 : 91e6e5e0201b29ba81689cdf134a50c5
旧文件   : EAAFEC0435EC71FFC65D8CF3E4595852.chk 已恢复原版 (f68ea909…)
游戏     : 运行中（编译着色器 = 已读取并加载）
```

**⇒ 游戏进入"编译着色器"阶段即证明 InitBundle 已被读取。**

### 38.7.2 清理结果

```
清理前: 5,945 MB
清理后: 3,145 MB  （省 2.8 GB）
```

**删除内容：**
- **所有中间产物 `*.chk`（mod.chk / ms.chk / c_swap.chk 等，约 1.5 GB）**
- **重复的 `orig.chk` 备份（只留当前目标的那一份）**
- **`libil2cpp.so`（428 MB，已分析完）**
- **`initbundle.chk` 分析样本（167 MB，可重新提取）**
- **内存 dump 残留（region_*.bin，167 MB）**
- **旧反编译产物（dump.cs，149 MB）**

**保留：**
```
v153_baseline/  v164_baseline/          基线（.blc + 校验表）
mod164_final/orig.chk                   ★ 当前目标的回滚源
newmods/em/                             EFMI mod 资产
vfs/                                    C 工具源码 + 产物
vfs/apk/base.apk                        1.6.4 APK
```

### 38.7.3 工具完成度

| 工具 | 语言 | 状态 |
| --- | --- | --- |
| `tools/vfs/abtool.c` | **C** | ✅ 全功能（entropy/strings/nodes/floats/u16/f32/find/**swap**） |
| `tools/vfs/blcparse.c` | **C** | ✅ 1.5.3 完整(6/6) + 1.6.4 InitBundle |
| `tools/vfs/chkpatch.c` | **C** | ✅ 等长替换 |
| `tools/vfs/deVFS.sh` | **Shell** | ✅ 解密/解析/提取 |
| `scripts/monitor-update.sh` | **Shell** | ✅ 更新监控 |
| `scripts/keepalive.sh` | **Shell** | ✅ 灭屏保活 |
| `scripts/post-update-diff.sh` | **Shell** | ✅ 更新对比 |

**⇒ 全部 C / Shell，无 Python 依赖。**
