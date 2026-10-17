---
title: "21 · 未加密的视频资源：636 个 CriWare USM 容器"
description: "EFML4A 研究文档 · 21-video-assets-unencrypted（Arknights: Endfield Mod Loader for Android）"
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


## 21.1 发现

对设备 VFS 目录下 **1,094 个 `.chk`** 做头部魔数统计，结果：

| 头部 | 数量 | 含义 |
| --- | --- | --- |
| **`43524944000007f8` = `CRID`** | **636** | **CriWare USM（Sofdec2 视频）容器** |
| `0300000300000000` | 52 | 其它 |
| `UnityFS` | **0** | 本版本已无明文 AssetBundle |

**这 636 个 `.chk` 完全没有加密** —— 直接是标准 CriWare 容器，
头部即 `CRID` + 版本 + `@UTF`（Atom 表）+ `@SFV`（Sofdec Video）子块。

## 21.2 内部目录表泄漏了原始工程路径

`@UTF` 表的列定义中包含：

```
CRIUSF_DIR_STREAM, fmtver, filename, filesize, datasize,
stmid, chno, minchk, minbuf, avbps
```

其字符串区保存着**构建时的原始 Windows 路径**。抽取后得到
**1,266 条唯一原始路径**，按目录分布：

| 数量 | 原始目录 |
| --- | --- |
| 562 | `c:\Beyond_Video\MultiPlatform\Mobile\Guide` |
| 232 | `c:\Beyond_Video\MultiPlatform\Mobile\cbt3` |
| 186 | `c:\Beyond_Video\MultiPlatform\Mobile\Narrative` |
| 170 | `C:\Beyond_Video\MultiPlatform\Mobile\cbt3` |
| 60 | `C:\Beyond_Video\MultiPlatform\Windows\cbt2` |
| 32 | `c:\Beyond_Video\MultiPlatform\Mobile\UI` |
| 8 | `C:\Beyond_Video\MultiPlatform\Android\RemoteComm` |
| 6 | `C:\Beyond_Video\MultiPlatform\Mobile\RemoteComm` |
| 6 | `c:\Beyond_Video\MultiPlatform\PC\cbt3` |
| 2 | `c:\Beyond_Video\MultiPlatform\PC\Guide` |
| 2 | `C:\Beyond_Video\MultiPlatform\Mobile\Narrative` |

**文件类型**：`.ivf`（原始 IVF 视频）+ `.usm`（CriWare USM 容器）配对出现。

**旁证**：`Beyond_Video` 印证了游戏的内部工程代号 **Beyond**
（与 `Beyond.VFS`、`Beyond.Security`、`Beyond.Video` 一致）。

## 21.3 意义

1. **这是目标 (4) 中「未加密资源可直接提取」的实例** —— 636 个视频容器
   不需要任何密钥、不需要 VFS 索引映射即可解析。
2. `.chk` 是这个游戏中**混合格式**：大部分需按 `FVFBlockFileInfo` 的
   `{offset, len, ivSeed}` 解密，但视频/音频类走**独立的、未加密的 CriWare 容器**。
3. 原始路径泄漏属于**构建期信息**，对理解资源组织方式有价值。

## 21.4 合规说明

按项目红线「**不散布游戏资源**」：

- 原始路径清单**不入库**，仅保留在本地研究目录；
- 仓库只收录**抽取工具**（`tools/video/`）与**方法 + 聚合统计**（本文）；
- 视频容器本体**不外传、不再分发**。

## 21.5 工具

| 工具 | 说明 |
| --- | --- |
| `tools/video/grab-cri-headers.sh` | 从设备 VFS 抽出全部 CRID 文件的头部到 blob（需 root） |
| `tools/video/parse-cri-utf.py` | 从 blob 抽取内嵌原始路径与按目录聚合统计 |

相关：[18](/blog/efml4a-18-vfs-and-ace/) · [20](/blog/efml4a-20-runtime-key-and-memory-extraction/)
