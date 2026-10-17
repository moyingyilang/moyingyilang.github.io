---
title: "A4 · 压缩体系"
description: "LZ4 与 LZ4Inv 双变体，以及「不能零填充」的坑"
date: 2026-10-17
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

# A4 · 压缩体系

> **结论先行**
>
> 两种 LZ4 变体：**标准 LZ4**（块信息，offset 小端）和 **LZ4Inv**（数据块，offset 大端）。
> **关键坑：LZ4 没有结束标记，不能用零填充。**

---

## A4.1 两种变体的区别

| 变体 | 用途 | token 拆分 | offset 字节序 |
|---|---|---|---|
| **LZ4** | 块信息（blocks-info） | `lit = token >> 4`<br>`match = token & 0x0F` | **小端** |
| **LZ4Inv** | 数据块 | `lit = val & 0b00110011`<br>`enc = (val & 0b11001100) >> 2` | **大端** |

## A4.2 LZ4Inv 的 token 位布局

```
token = (litC & 3)
      | ((mlC  & 3) << 2)
      | (((litC >> 2) & 3) << 4)
      | (((mlC  >> 2) & 3) << 6)
```

**扩展字节：** 当 `litC == 15` 或 `mlC == 15` 时，追加 `255` 扩展字节（循环），最后写余数。

## A4.3 ★ 关键坑：LZ4 没有结束标记

```
❌ 对压缩流零填充
   → 0x00 是非法 token（offset = 0）
   → 解压器返回 -1

❌ 对未压缩数据填充
   → 解压后大小变化 → 超出 uncompBI

✅ 正确做法（abpack 的 pad 模式）
   迭代搜索填充量，使【压缩后长度恰好等于原 compBI】
```

## A4.4 pad 模式的算法

```
目标: 让新块信息的压缩后长度 == 原 compBI

步骤:
  1. 计算新块信息的压缩后长度 cLen
  2. 若 cLen > 目标 ⇒ 无法填充，退回 min 模式
  3. 若 cLen < 目标 ⇒ 给【未压缩】块信息追加 padLen 字节
     重新压缩，检查是否恰好等于目标
  4. 迭代搜索 padLen（二分或线性）
  5. 成功 ⇒ 写 uncompBI = 原 uncompBI + padLen
```

## A4.5 压缩器实现质量

**本项目自研 LZ4Inv 压缩器演进：**

| 版本 | 配置 | 输出 | 相对游戏 | 耗时 |
|---|---|---|---|---|
| 游戏原始 | — | 122,604 (11.69%) | — | — |
| v3 | HBITS=17, CHAIN=16 | 186,506 (17.78%) | **+52.1%** | ~10ms |
| v4 | HBITS=20, CHAIN=64 | 152,915 (14.58%) | +24.7% | ~200ms |
| v4 | CHAIN=128 | 142,763 (13.61%) | +16.4% | ~300ms |
| v4 | CHAIN=256 | 134,244 (12.80%) | +9.5% | ~500ms |
| v4 | CHAIN=512 | 127,087 (12.12%) | +3.7% | ~940ms |
| **v4** | **CHAIN=1024** | **124,038 (11.83%)** | **+1.2%** | ~1850ms |

**测试数据：** 真实 ASTC 纹理 1,048,576 字节

**v4 的改进：**
```
· HBITS 17 → 20（1M 哈希桶）
· CHAIN 16 → 1024（匹配候选 ×64）
· 匹配搜索改为【最近优先】
· 快速排除：先比 src[ref+bestLen]
· lazy matching：若 ip+1 有更长匹配则跳过当前位置
```

## A4.6 ⚠️ v4 也有不够好的时候

**在 `ui_main_menu_logo_icon`（9,792 字节）上：**

```
游戏原始: comp = 9,646
我的 v4:  comp = 10,109  ← 比游戏大 4.8%
```

**⇒ 这就是 `compBI` 从 101 变 102 的直接原因。**

**⇒ 解决方向：**
- 提高压缩器质量（CHAIN=2048 / optimal parsing）
- 或者给压缩流追加纯字面量 token 精确对齐（见 [C2](C2-blockers.md)）

## A4.7 复现

```bash
# 往返测试
tools/.efml4a-bin/lz4invtest <file>

# 独立压缩
tools/.efml4a-bin/lz4invcomp4 <in> <out>

# 压缩率对比
tools/.efml4a-bin/lz4invcomp4 /path/to/tex.bin /tmp/out
```

## A4.8 证据

```
往返验证（rt4）:
  解压: 1048576 (期望 1048576) ✓
  差异: 0 字节，首个 @-1  ★★★ 完全一致
```

---

**上一篇**：[A3 · 加密体系](A3-crypto.md) ·
**下一篇**：[A5 · 纹理与流偏移](A5-textures.md)
