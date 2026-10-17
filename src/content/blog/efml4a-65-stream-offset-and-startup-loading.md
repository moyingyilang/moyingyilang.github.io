---
title: "65. ★ 流光偏移规则与启动加载行为（关键突破）"
description: "EFML4A 研究文档 · 65-stream-offset-and-startup-loading（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 65.1 ★★★ 纹理流偏移的正确算法

**这是导致之前所有失败的核心错误。**

### 两种 bundle 类型

```
类型 A：流式（有 .resS）
  布局: SerializedFile(N 字节) + .resS(M 字节)
  纹理在 .resS 中
  ★ 正确的 abpack streamOffset = N（SerializedFile 的大小）

类型 B：内嵌（无 .resS）
  布局: SerializedFile（全部内容）
  纹理内嵌在 SerializedFile 中
  ★ 正确的 abpack streamOffset = 0
```

### 实测数据

| bundle | 纹理 | 尺寸 | `.resS` | 正确 offset |
|---|---|---|---|---|
| `e8d56088509776abbd5349ad` | login_logo_en | 1040×236 | 有 | **18,160** |
| `72a08148e811c799573edd4a` | login_logo01 | 888×236 | 有 | **18,256** |
| `540d02690a7c7b8fd4fe6e66` | ui_main_menu_logo_icon | 304×68 | 有 | **14,768** |
| `8d3bdd347d1cb80b434281e7` | loging_popup_bg_deco01 | 800×452 | 有 | **22,312** |
| `68cd4add9b25cfce8eeaff4b` | — | — | **无** | **0** |
| `e9dd0a379806dc341a764f33` | — | — | **无** | **0** |
| `d01bd3c7664fbcd2aae7fc54` | — | — | **无** | **0** |

### 如何计算

```bash
# 方法 1: filesz 工具（最可靠）
~/EFML4A/ref/filesz/bin/Release/net10.0/filesz <bundle.ab>
# 输出形如：
#   CAB-xxx           13060  累计前=           0     ← SerializedFile
#   CAB-xxx.resS     368368  累计前=       13060     ← .resS
# ⇒ streamOffset = 13060

# 方法 2: 若没有 .resS 行 ⇒ 内嵌 ⇒ streamOffset = 0
```

### 错误后果

```
用 streamOffset=0 去打一个流式 bundle:
  ⇒ ASTC 数据覆盖了 SerializedFile 的头部
  ⇒ 游戏读到损坏的 Unity 序列化文件
  ⇒ 表现为「启动即退出」或「花屏」
```

## 65.2 ★ 游戏启动时只加载 InitBundle

**用 `/proc/<pid>/fd` 实测：**

```
[3s]  PID=26701 fd=201  打开的 .chk = 0
[6s]  PID=26701 fd=220  打开的 .chk = 0
[9s]  PID=26701 fd=265  打开的 .chk = 1
[12s] PID=26701 fd=268  打开的 .chk = 1
[18s] PID=26701 fd=321  打开的 .chk = 1

最终: A47587BA5EEF7FD05F1FEC103DEA85BD.chk  (InitBundle, 217 MB)

⇒ 启动阶段【只读这一个 .chk】
⇒ 7064D8E2 组（main bundles）启动时完全不加载
```

## 65.3 ★ 游戏会自己重建 .blc 和清单

**时间戳证据：**

```
我写 .chk:  10:44:49
游戏写 .blc: 10:45:15  （26 秒后）

游戏写入的 contentMD5 = 91e6e5e0201b29ba81689cdf134a50c5
实际 .chk 的 md5     = e83d71f2eba31d9f90e369612b4de9a4
⇒ 游戏用的不是简单文件 md5（算法未解）
```

**清单是确定性的：**

```
删除 index_main.json → 启动 → 游戏重建 → md5 完全相同 (4296336e...)
⇒ 基于文件内容生成，不是签名
```

## 65.4 ⚠️ 仍未解决的问题

```
替换 4 个 InitBundle 内的纹理（正确 offset + pad 模式 + .blc 更新 + 删清单）:
  · 容器验证: 目标区匹配 TRUE ✓
  · .blc 更新: 全部 rc=0 ✓
  · 游戏启动: 不崩溃 ✓
  · 纹理渲染: ❌ 4 种颜色（品红/绿/黄/青）全部未检测到

⇒ 纹理被替换了，但游戏没有显示它们
```

**可能原因：**

```
① 这 4 个纹理在启动画面确实不使用
② 游戏对 .blc 的 dataMd5 有额外校验，不匹配就跳过
③ 纹理需要在特定 UI 状态才渲染
```

## 65.5 工具进展

```
新增: tools/vfs/mempatch.c  运行时内存注入（/proc/<pid>/mem 搜索替换）
     · MAXMAPS=65536（覆盖 4950 个映射区）
     · 32 线程并行
     · 实测: 启动画面期间该纹理不在 CPU 内存（0 命中）

工具链: 23 个
```

## 65.6 性能笔记

```
dd bs=1 提取 27MB: 极慢
tail -c +N | head -c L: 106ms  ← 用这个
fextract（32 线程 pread）: 批量提取用这个
```

## 65.7 合规

```
仅研究用途 · 等长替换 · 不改游戏数值/存档
不用于竞技作弊 · 不散布游戏资源
用户授权：目的合规前提下可使用任何技术手段
```
