---
title: "D1 · 完整性机制"
description: "index/pref 清单、Temp 缓存、启动加载行为"
date: 2026-10-17
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

# D1 · 完整性机制

> **结论先行**
>
> 游戏用 `index_*.json` / `pref_*.json` 做完整性清单，**清单是确定性生成的**（删了会重建，md5 相同）。
> **删除清单可以绕过校验** —— 但 `.blc` 也会被重建，重定向因此失效。
> Temp 缓存与 mod 无关（已排除）。

---

## D1.1 清单文件

| 文件 | 原文大小 | Base64 解码后 | 熵 |
|---|---|---|---|
| `index_initial.json` | 3,172 | 2,379 | 6.800 |
| `pref_initial.json` | 2,716 | 2,035 | 6.800 |
| `index_main.json` | 286,020 | 214,515 | 6.868 |
| `pref_main.json` | 273,556 | 205,167 | 6.868 |

**共同 magic（13 字节）：**
```
bc95dcd8bde198b6cedadb909ea3b6ee   (initial)
bc95dcd8bde198b6cedadb909e95a5e5   (main)
└────── 前 13 字节相同 ──────┘
```

**熵 6.8 ⇒ 不是强加密**（AES/ChaCha20 应为 7.99+），但也非简单 XOR。

## D1.2 ★ 清单是确定性生成的

**实验：**

```
① 记录 index_main.json 的 md5 = 4296336e47c8a9b6...
② 删除所有清单
③ 启动游戏
④ 游戏重建 index_main.json
⑤ md5 = 4296336e47c8a9b6...  ★ 完全相同
```

**⇒ 基于文件内容生成，不是签名，不是服务端下发。**

## D1.3 删清单法（曾以为有效）

```bash
# 改完 .chk + .blc 后
rm $FILES/index_initial.json $FILES/pref_initial.json
rm $FILES/index_main.json    $FILES/pref_main.json
# 启动 ⇒ 游戏跳过校验分支 ⇒ 加载修改后的文件
```

**⚠️ 后续证明：这方法【不能解决】`compBI` 问题**
（游戏仍会跳过 `compBI` 不匹配的 `.ab`）

## D1.4 ⚠️ `.blc` 会被重建（重定向失效的原因）

**实测时间戳：**

```
我写 .chk:   10:44:49
游戏写 .blc: 10:45:15  （26 秒后）

游戏写入的 contentMD5 = 91e6e5e0201b29ba81689cdf134a50c5
实际 .chk 的 md5     = e83d71f2eba31d9f90e369612b4de9a4
⇒ 不匹配！游戏用的不是简单文件 md5
```

**重定向实验：**

```
我写入: off=720694（重定向到另一个纹理）
重建后: off=312244（改回原始）
⇒ 游戏重新解析 .chk 并重建 .blc ⇒ 重定向被覆盖
```

## D1.5 启动加载行为

**`/proc/<pid>/fd` 实测（跑满 60 秒）：**

| 组 | 组名 | .chk 数 | 大小 | 启动加载 |
|---|---|---|---|---|
| `0CE8FA57` | **InitBundle** | 1 | 208 MB | ✅ **唯一非音频** |
| `24ED34CF` | Audio | 4 | 3.6 GB | ✅ |
| `E1E7D7CE` | AudioChinese | 2 | 1.3 GB | ✅ |
| `F151B649` | HotfixAudio | 4 | 6.8 MB | ✅ |
| `7064D8E2` | Bundle | 28 | **16 GB** | ❌ 需进场景 |

**⇒ 非音频资源【只来自 InitBundle】**
**⚠️ 采样太早会误判**（9 秒时只看到 1 个 .chk）

## D1.6 Temp 缓存（已排除）

**每次启动生成 4 个临时文件（共 ~328 MB）：**

| 文件 | 大小 | magic |
|---|---|---|
| `57948e64-...` | 472,714 | `e8 06 01 00` |
| `a8115b10-...` | 156,991,277 | **`11 ff 11 ff`** + UTF-16 UUID |
| `c11595c0-...` | 3,749,452 | `31 10 27 00` |
| `f8fa5579-...` | 170,988,312 | `68 9d 3d 01` |

**`11ff11ff` 格式：**
```
@0  u32 magic = 0x11ff11ff
@4  u32 = 36（UTF-16 字符数）
@8  UTF-16LE 字符串 "2954fa80-23c1-1579-2b22-4ecf..."
```

**★ 用 `binsearch` 搜索排除：**

| 搜索目标 | 157MB | 171MB | 473KB |
|---|---|---|---|
| 原纹理 ASTC `fcfdffff...` | 0 | 0 | 0 |
| `.ab` 头 `d7a1fddf983792` | 0 | 0 | — |
| `UnityFS` / `CAB-` | 0 | 0 | — |

**⇒ 不含纹理数据 ⇒ 不是 mod 加载的拦截者**

## D1.7 游戏会清理废弃资源

**用户观察到的「资源初始化更新」= 每次启动解压/下载 Temp 缓存 + 检查清单。**
**与我们的 VFS 修改无关。**

---

**上一篇**：[C2 · 阻塞与失败记录](C2-blockers.md) ·
**下一篇**：[E1 · zygisk payload 与 vktex](E1-runtime.md)
