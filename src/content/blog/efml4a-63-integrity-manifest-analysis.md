---
title: "63. 完整性校验清单分析（index_*.json / pref_*.json）"
description: "EFML4A 研究文档 · 63-integrity-manifest-analysis（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 63.1 发现

游戏数据目录下有四个清单文件（**Base64 编码**）：

| 文件 | 原文大小 | 解码后 | 熵 |
|---|---|---|---|
| `index_initial.json` | 3,172 | 2,379 | 6.800 |
| `pref_initial.json` | 2,716 | 2,035 | 6.800 |
| `index_main.json` | 286,020 | 214,515 | 6.868 |
| `pref_main.json` | 273,556 | 205,167 | 6.868 |

**解码后的 magic（前 16 字节）：**

```
index_initial / pref_initial: bc95dcd8bde198b6cedadb909ea3b6ee
index_main    / pref_main:    bc95dcd8bde198b6cedadb909e95a5e5
                              └────── 前 13 字节相同 ──────┘
```

**⇒ 固定 13 字节头 + 各自数据**

## 63.2 熵分析结论

```
6.800 / 6.868 bit/byte

对比:
  AES/ChaCha20 强加密  → 7.99+ bit/byte
  zlib/gzip 压缩       → 7.5-7.9
  ★ 6.8                → 轻量混淆 或 低压缩率压缩
  纯文本               → 4-5

⇒ 不是强加密
⇒ 但也不是简单 XOR
```

## 63.3 已排除的方案

| 方案 | 结果 |
|---|---|
| VFS 的 ChaCha20（前 12B 作 nonce） | ✗ 解出乱码 |
| VFS 的 ChaCha20（nonce=0） | ✗ 解出乱码 |
| 单字节 XOR（0x00-0xFF 全试） | ✗ 无可读明文 |
| 已知明文攻击（`{"` / `[{` / `{"version` 等 7 种假设） | ✗ 密钥不能解出可读文本 |
| ChaCha20 key 前缀作重复密钥（4/8/16/32 字节） | ✗ 可打印率仅 48-76/200 |
| zlib / gzip 头检查 | ✗ 不是（头是 BC 95 DC D8） |

## 63.4 剩余可能

```
① 压缩后在混淆（需先找到压缩流的起点）
② 自定义 SBox 字节置换（类 VFSAES 的做法）
③ ChaCha20 但 nonce/offset 与 VFS 不同
④ 头部 13 字节是 magic + 长度/校验，body 从更后面开始
```

## 63.5 对完整性校验的判断

**游戏运行时（PID 29929）有 53 个 socket，其中多个 HTTPS（443）：**

```
已建立连接（部分）:
  43.145.18.240:443    ← 可能是 Hypergryph 官方服务器
  110.75.170.153:443
  119.147.19.113:443
  ...（共 10+ 个）

⇒ 游戏在联网
⇒ 校验清单可能【部分来自服务端】
```

## 63.6 验证方法论（已知事实）

```
★ 原始文件 ⇒ 游戏正常运行（PID 29929，38 秒，RSS 2GB，无 tombstone）
★ 修改文件 ⇒ 报「检查资源完整性时发现异常，请重新下载缺失的文件」
★ 但【第一阶段曾成功】：修改后纹理上屏（44,313 像素），当时无报错

⇒ 校验不是每次启动都触发
⇒ 触发条件待查（可能是定期校验 / 特定操作触发）
```

## 63.7 工具

```
tools/vfs/ent.c      熵分析
tools/vfs/crackx.c   XOR 暴力破解 + 已知明文攻击
```

## 63.8 合规

```
仅研究用途 · 等长替换 · 不改游戏数值/存档
不用于竞技作弊 · 不散布游戏资源
用户已授权：目的合规前提下可使用任何技术手段
```
