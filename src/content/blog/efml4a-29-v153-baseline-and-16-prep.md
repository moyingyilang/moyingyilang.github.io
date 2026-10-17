---
title: "29. 1.5.3 基线快照 与 1.6 更新准备"
description: "EFML4A 研究文档 · 29-v153-baseline-and-16-prep（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 第 2 阶段第 5 项。1.6 补丁已预下载（`files/HGGameUpdate/gameupdate/preload/1.6/`，
> 4.64 GB，`diff_10916909-2_10731330-8`），**应用时机 = 用户更新 App 时**。
> 本文记录为「更新后快速定位差异」所做的准备。

## 29.1 基线快照（`~/.efml4a/v153_baseline`，54 MB）

| 文件 | 内容 |
| --- | --- |
| `HEADER.txt` | 采集时间 / 游戏版本 / versionCode |
| `blocks.txt` | 21 个块目录名 |
| `blc_list.txt` | 21 个 `.blc` 的大小 + 路径 |
| **`blc_md5.txt`** | **21 个 `.blc` 的 md5**（最关键基线） |
| `chk_sizes.txt` | 1093 个 `.chk` 的大小 + 路径 |
| `pkg.txt` | 包信息（versionName / lastUpdateTime / codePath） |
| `apkpath.txt` | APK 路径（用于判断是否已更新） |
| **`rva_baseline.txt`** | **18 个关键 RVA**（见下） |
| **`blc_backup/`** | **21 个 `.blc` 的完整备份** |

### 采集到的 1.5.3 基线

```
versionName    = 1.5.3        versionCode = 50
lastUpdateTime = 2026-09-06 16:42:38
firstInstall   = 2026-07-26 22:47:50
APK            = /data/app/~~6z9I_irjBo46B9NsmIOeCg==/com.hypergryph.endfield-vaPT5kTUxo-73oRcOCPiDQ==/base.apk
块目录         = 21 个
.blc           = 21 个
.chk           = 1093 个，合计 29.85 GB
```

### 18 个关键 RVA（`rva_baseline.txt`）

| 符号 | RVA |
| --- | --- |
| `GetCommonChachaKeyBs` | `0xb37dcd0` |
| `VFSFileReadStream..ctor` | `0xb385d38` |
| `VFSFileReadStream.Read` | `0xb38d6d4` |
| `GetAssetStream(FVFBlockFileInfo)` | `0xb385ae0` |
| **`GetAssetStream(ref FVFBlockFileInfo)`** | **`0xb385bc0`** |
| **`GetAssetStream(StringPathHash,out)`** | **`0xb3857e0`** |
| `GetRelativeChunkFilePath` | `0xb37a7a0` |
| `get_loaderPosType` | `0xb379458` |
| `get_blockType` | `0xb3790e4` |
| `get_fileTag` | `0xb3797cc` |
| `ReadFileByStream` | `0xb3702ac` |
| `BlockValidator.TryGetResult` | `0xb38128c` |
| `CollectAllMissedChunks` | `0xb38afd8` |
| **`InitMountFromLocalFile`** | **`0xb37fb38`** |
| **`AppendMountFromLocalFile`** | **`0xb380880`** |
| **`_MountLocalVFSType`** | **`0xb380194`** |
| `GetVFSLoaderPosDir` | `0xb37b680` |

## 29.2 更新后对比脚本（`scripts/post-update-diff.sh`）

**用法**：`bash scripts/post-update-diff.sh [基线目录]`（默认 `~/.efml4a/v153_baseline`）

**六项检查**：

| # | 检查 | 输出 |
| --- | --- | --- |
| 0 | 当前版本 | `versionName` / `versionCode` / `lastUpdateTime` |
| 1 | **块目录对比** | 是否仍为 21 个、是否有增删 |
| 2 | **`.blc` md5 对比** | 新增 / 变更 / 消失（**决定密钥与结构是否仍适用**） |
| 3 | **`.chk` 数量与总大小** | 新增 / 消失条目（并列出样例） |
| 4 | **解密切片验证** | 抽样 5 个 `.blc` 用 `deVFS.sh crc` 验证 CRC 是否仍匹配 |
| 5 | **APK 路径对比** | 是否已更新；已更新则导出新的 `libil2cpp.so` |
| 6 | 结果保存 | 快照目录路径 |

**1.5.3 上实测（更新前）**：
```
✓ 块目录完全一致（21 个）
✓ 所有 .blc 未变（21 个密钥/结构应仍适用）
  基线: 1093 个, 29.85 GB    现在: 1093 个, 29.85 GB    新增 0 / 消失 0
⚠ APK 路径未变 —— 可能尚未更新
```

## 29.3 更新后的应对流程

```
① 更新 App 并让它应用 1.6 补丁
② 运行 scripts/post-update-diff.sh
③ 读结果：
   - 若 .blc md5 未变 → 【解密密钥、算法、结构全部可继续用】，无需重新逆向
   - 若 .blc 变了     → 用 deVFS.sh 重测密钥；大概率仍适用（密钥派生自动态资产）
   - APK 已更新       → 用 rva_baseline.txt 的 18 个 RVA 重新定位（libil2cpp.so 会变）
④ 若需要回滚 .blc：直接拷贝 v153_baseline/blc_backup/ 里的对应文件
```

## 29.4 结论（预判）

**1.6 是 `diff_10916909-2_10731330-8`（针对 1.5.3 的差分），且从目录命名看
格式与 1.5.3 一致。因此最可能的情形是：**

- **`.blc` 结构不变**（仍是 ChaCha20 + CRC32）⇒ 我们的工具链**无需改动**
- **`.chk` 内容变化**（资源更新）⇒ 用 `deVFS.sh` 重新导出映射即可
- **`libil2cpp.so` 的 RVA 会变** ⇒ 若要用 hook 方案，需重新定位
  （但第 2 阶段已放弃 hook 路线，走文件替换，**不受 RVA 变化影响**）
