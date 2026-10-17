---
title: "51. ★ 项目语言红线"
description: "EFML4A 研究文档 · 51-language-mandate（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 51.1 强制规定

```
本项目【禁止 Python】，任何形式：
  ❌ 不允许 .py 文件进入仓库
  ❌ 不允许文档中推荐 Python 方案
  ❌ 不允许脚本里调用 python / python3
  ❌ 不允许依赖 Python 生态（UnityPy / PIL / 等）

允许的语言（按优先级）：
  ✅ C / C++    —— 所有自研工具（tools/ 下全部为 C）
  ✅ Shell      —— 构建与部署脚本（scripts/）
  ✅ Rust/Kotlin —— 仅当更适合时（当前未使用）
```

## 51.2 强制措施

```
.gitignore:
  *.py
  *.pyc
  __pycache__/

仓库状态:
  .py 文件数 = 0（已验证）
```

## 51.3 理由

```
① 效率: C 工具在 Termux 上零解释器开销，启动即用
② 一致性: 与"用效率最高的语言重写工具"的方针一致
③ 可移植: 无解释器/包依赖，交叉编译简单
④ 用户明确要求："把 Python 给我从这个项目抹去"
```

## 51.4 现有工具（全部 C）

```
tools/vfs/vfsfull.c   —— .blc 解析（含 codeVersion>3 的 8 字节修正）
tools/vfs/vfsaes.c    —— VFS AES
tools/vfs/lz4inv.c    —— LZ4Inv
tools/vfs/lz4blk.c    —— 标准 LZ4
tools/vfs/blcfix.c    —— 更新 contentMD5 + CRC32
tools/vfs/vfslist.c   —— 条目表
（共 20+ 个 C 工具）
```
