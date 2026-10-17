---
title: "35. 工具集（**C / Shell 版**）"
description: "EFML4A 研究文档 · 35-tools-c（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 项目约定：**工具一律用 C 或 Shell 编写**（不用 Python / JS）。
> Python 版仅作历史参考，**新工具以 C 版为准**。

## 35.1 `tools/vfs/abtool.c` —— `.ab` 分析与替换（纯 C）

```bash
clang -O2 -o abtool tools/vfs/abtool.c -lm
```

| 命令 | 说明 |
| --- | --- |
| `entropy <chk> <off> <len> [win]` | **滑动窗口熵图**（判明文/压缩/加密） |
| `strings <chk> <off> <len> [min]` | 提取可读 ASCII 串（含前 3 字节上下文） |
| `nodes   <chk> <off> <len>` | **顺序解析 z-terminated 节点**（结构钥匙） |
| `floats  <chk> <off> <len> [win]` | **float 合理性密度图**（定位数据区） |
| `u16     <chk> <off> <len>` | 按 u16 转储（找索引缓冲） |
| `f32     <chk> <off> <len>` | 按 f32 转储 |
| `find    <chk> <off> <len> <hex...>` | 搜十六进制模式 |
| **`swap    <chk> <off> <src> <out>`** | **等长替换（部署主力）** |

**⚠️ 注意偏移语义**：`<off>` 是**文件绝对偏移**。
若要按「条目内偏移」操作，需自行加上条目的块内偏移：
```
绝对偏移 = 条目块内偏移 + 条目内偏移
```

**例（第 29 轮成功的操作，`e2cd202a…ab` 在 `initbundle.chk` 内偏移 51,364,253）**：
```bash
abtool swap initbundle.chk $((51364253+12800)) \
  em/Meshes/Component0_VB0.buf mod.chk
# ⇒ md5 = 50ccba83ba3c926afc549eac69c4225a
#   与 Python 版结果完全一致 ✓
```

## 35.2 `tools/vfs/chkpatch.c` —— 等长内容替换（另一实现）

```bash
chkpatch flip | splice | hex | restore
```
**与 `abtool swap` 功能重叠；`chkpatch` 更侧重「破坏性验证」，`abtool swap` 更侧重「数据替换」。**

## 35.3 `tools/vfs/deVFS.sh` —— 解密/解析/提取（Shell + 内嵌 C）

```bash
deVFS.sh info | blc | crc | list | parse | parseall | hg | get
```

## 35.4 已弃用的 Python 工具（仅历史参考）

| 文件 | 替代 |
| --- | --- |
| `abtool.py` | → **`abtool.c`** |
| `meshswap.py` | → `abtool swap` + `chkpatch` |
| `parse_nodes.py` | → `abtool nodes` |
| `zstrings.py` | → `abtool nodes` / `strings` |
| `abstrings.py` | → `abtool strings` |

## 35.5 环境铁坑

| # | 坑 | 对策 |
| --- | --- | --- |
| ① | `su -c cp` 把文件拷成 `root:root 644` | 拷完 `chmod 666` + `chown u0_a446` |
| ② | `grep` 过滤掉工具报错 ⇒ 假象 | 诊断时**不要过滤** stderr |
| ③ | `find -newermt` 在部分 busybox 上失效 | 用 `ls -lt` |
| ④ | 误判「加密」 | **先跑 `abtool entropy`** |
| ⑤ | Unity 版本串可能被截断（`2021.3.`） | 搜 `2021.3` 短前缀 |
| ⑥ | **偏移语义**：C 工具用文件绝对偏移 | 条目内偏移需加块内偏移 |
