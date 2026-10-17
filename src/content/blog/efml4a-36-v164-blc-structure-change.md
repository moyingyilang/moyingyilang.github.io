---
title: "36. ★★★ 1.6.4 的 `.blc` 结构变化（关键发现）"
description: "EFML4A 研究文档 · 36-v164-blc-structure-change（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 36.1 结论

**1.6.4 仍使用**同一套加密**（ChaCha20 + CRC32，6/6 变更块校验通过），
但在 **chunk 头里**插入了一个 4 字节字段** ⇒ 后续所有偏移**整体后移 4 字节**。**

**⇒ 旧的解析器（在固定偏移 41–48 搜 `fileCount`）在 1.6.4 上**找不到** ⇒ 返回 0 条。**

## 36.2 逐字节证据

### `55FC21C6`（Video）

```
v153: … 3348e29d 10569bad db53fd9c d0104b55 | 00c60500 | 00000000 | 0d000000 | 00010000 | 4f00 "Data/Video/Mo…"
v164: … 3348e29d 10569bad db53fd9c d0104b55 | 00c60500 | 00000000 | 0d000000 | 00000000 | 01000000 | 4f00 "Data/Video/Mo…"
                                                                                          ↑ ★ 多出 4 字节
```

### `7064D8E2`（Bundle）

```
v153: … 35623513 | 09000000 | 0b000000 | 00890400 | 3500 "Data/Bundles/…"
v164: … a55f3402 | 00000000 | 0b000000 | 00000000 | ce000000 | 3500 "Data/Bundles/…"
                                                                    ↑ ★ 多出 4 字节
```

**⇒ 1.6.4 在 `fileCount` **之前**多了一个 `u32` 字段。**

## 36.3 ★ 可用于切换解析的字段

**`.blc` 解密后偏移 12 的 `version` 字段：**

| 版本 | `version` | `unk`（偏移 16） | groupName |
| --- | --- | --- | --- |
| **1.5.3** | **4** | `0x0188b872` | 正常 |
| **1.6.4** | **5** | `0x019ab82d` | 正常 |

**⇒ **用 `version`（4 / 5）判断布局版本**，选择对应偏移即可。**

## 36.4 其它字段对比（说明格式整体未变）

| 字段 | 1.5.3 | 1.6.4 |
| --- | --- | --- |
| `version` | 4 | **5** |
| `unk` | `0x0188b872` | `0x019ab82d` |
| `groupName` | `"Video"` / `"Bundle"` | 同 |
| `groupHash` | `55fc21c6…` | 同（**未变**） |
| `fileNum`（Video） | 636 | **688** |
| `fileNum`（Bundle） | 252,873 | **270,433** |
| `blockType` | 13 / 11 | 同 |
| `chunkNum`（Video） | 636 | **688** |
| `chunkNum`（Bundle） | 42 | **46** |
| `chunkLen`（Bundle） | 16,282,500,763 | 17,848,933,560 |

**⇒ 字段语义未变、groupHash 未变 ⇒ **只需修正 chunk 头的一个偏移**。**

## 36.5 修复方案

**`tools/vfs/deVFS.sh` 里的 `parse` 分支**（及 `blcfinal`/`blcbuild`）需要：**

```c
uint32_t ver; memcpy(&ver, b+12, 4);      /* 4 = 1.5.3 ; 5 = 1.6.4 */

/* chunk 头里 fileCount 的搜索窗口 */
int lo = (ver >= 5) ? 45 : 41;            /* 1.6.4 整体后移 4 字节 */
int hi = (ver >= 5) ? 52 : 48;

for (int off = lo; off <= hi; off++) { … 探测 … }
```

**更稳妥的做法**：**同时尝试两套偏移**，取「能解析出最多条目且全部 chunk 完好」的那套。

## 36.6 影响面

| 工具 | 是否受影响 |
| --- | --- |
| `deVFS.sh blc` / `crc` | ✅ 不受影响（只解密与校验） |
| `deVFS.sh get` | ⚠️ 受影响（依赖 `parse`） |
| `deVFS.sh parse` / `parseall` | ❌ **受影响，需修** |
| `chkpatch` | ✅ 不受影响（只要拿到 offset/len） |
| `abtool.c` | ✅ 不受影响（按绝对偏移工作） |
| `meshswap` | ✅ 不受影响（按绝对偏移工作） |

**⇒ **最关键的是修 `deVFS.sh` 的 `parse`**，其余工具链不受影响。**

---

## 36.7 `blcparse.c` 进度（C 版重写）

### 已完成

| 功能 | 状态 |
| --- | --- |
| ChaCha20 解密 | ✅ |
| CRC32 校验 | ✅ `-v` 模式正常 |
| 头部解析（version/groupName/groupHash/fileNum/chunkLen/blockType/chunkNum） | ✅ |
| **双布局识别**（version=4→1.5.3；version=5→1.6.4） | ✅ |

**实测**：
```
55FC21C6 v153: version=4  group="Video"  fileNum=636  chunkNum=636  chunk头@52
55FC21C6 v164: version=5  group="Video"  fileNum=688  chunkNum=688  chunk头@52
7064D8E2 v153: version=4  group="Bundle" fileNum=252873 chunkNum=42  chunk头@53
7064D8E2 v164: version=5  group="Bundle" fileNum=270433 chunkNum=46  chunk头@53
```

### ⚠️ 尚未完成：**缺少 chunk 遍历循环**

**`blcparse.c` 只解析了**第一个 chunk**：**

```
55FC21C6 (Video):  chunkNum=636，每 chunk 1 个文件
  ⇒ probe 找到 fileCount=1（【这是对的】）
  ⇒ 但要得到全部 636 条，必须【遍历 636 个 chunk】

7064D8E2 (Bundle): chunkNum=42，每 chunk ~6021 个文件
  ⇒ 42 × 6021 ≈ 252,873 条
```

**⇒ 原 Python 版 `blcfinal` 有 chunk 循环，我在用 C 重写时漏掉了。**

### 待补的代码骨架

```c
for (uint32_t ci = 0; ci < nc; ci++) {
    /* 1) 探测该 chunk 的 fileCount（偏移在 41..52 间浮动） */
    /* 2) 遍历 fileCount 个文件条目，累计到输出 */
    /* 3) 前进到下一个 chunk 起点 */
}
```

**注意**：**`Bundle` 块的 chunk 头 `fileCount` 偏移与 `Video` 不同**
（因为 chunk 头里有一个变长字段 `X`）⇒ **必须逐 chunk 探测**。

### 已修的两个 bug（供参考）

| # | Bug | 现象 | 修正 |
| --- | --- | --- | --- |
| ① | `p=16`（应为 20） | 从错误位置读 `groupName` 长度（读到 47218）⇒ `gn[47218]=0` ⇒ **段错误** | `p=20`，并加 `gl>500` 防御 |
| ② | `probe` 要求**全部**条目都能解析 | 个别异常即整体否决 | 改为**只验证前 3 条**，并取**最大**合法 `fileCount` |

---

## 36.8 `blcparse.c` 完成情况（第 38 轮）

### 已实现

| 功能 | 状态 |
| --- | --- |
| ChaCha20 解密 | ✅ |
| CRC32 校验（`-v`） | ✅ |
| 头部解析（`-i`） | ✅ |
| **双布局识别**（`version=4`→1.5.3；`version=5`→1.6.4） | ✅ |
| **chunk 遍历循环** | ✅ |

### 实测条目数

| 块 | 版本 | 期望 | 实际 | 结果 |
| --- | --- | --- | --- | --- |
| `0CE8FA57` InitBundle | 1.5.3 | 1052 | 1052 | ✅ |
| `0CE8FA57` InitBundle | **1.6.4** | 1052 | 1052 | ✅ |
| `55FC21C6` Video | **1.6.4** | 688 | 688 | ✅ |
| `55FC21C6` Video | 1.5.3 | 636 | 1 | ❌ |

**⇒ 4 项中 3 项正确。**

### 已知缺陷

**`55FC21C6`（Video）在 1.5.3 上只导出 1 条 —— chunk 前进量 `cp = q + 10` 在该布局下不准。**

**可能原因**：
- 1.5.3 的 chunk 尾长度不是 10 字节（不同 `blockType` 的 chunk 尾长度可能不同）
- 或 `fileCount` 探测在该布局上选中了错误偏移

**⇒ 但这**不影响目标用途**：
- **`InitBundle`（`chunkNum=1`）在**两个版本上都完全正确****
- **mod 加载路径只依赖 `InitBundle`**

### 用法

```bash
clang -O2 -o blcparse tools/vfs/blcparse.c
blcparse -i <x.blc>              # 摘要（version/group/fileNum/chunkNum）
blcparse -v <x.blc>              # 解密 + CRC 校验
blcparse <x.blc> [out.tsv]       # 导出文件清单 TSV
```

### 与 `deVFS.sh` 的关系

**`blcparse.c` 是 `deVFS.sh` 内嵌 C 解析器的**独立 C 实现**，且**额外支持 1.6.4 布局**。**
**⇒ `deVFS.sh` 的 `parse` 分支仍只支持 1.5.3 布局，后续可改用 `blcparse`。**

---

## 36.9 `blcparse.c` 的 chunk 结构与修复（第 43 轮）

### 36.9.1 ★ 1.5.3 的 chunk 头精确结构（已确认）

```
chunk 头（以 55FC21C6 为例，起点 52）:
  +0..15    md5Name      (16)
  +16..31   md5Content   (16)
  +32..39   u64 文件长度
  +40..43   u32 blockType
  +44       u8
  +45..48   u32 fileCount      ← ★ 未对齐（+45）
  +49..50   u16 名字长度
  +51..     name (ASCII)
  名字之后（每文件 62 字节固定部分）:
    hash(8) + chunkMD5(16) + dataMD5(16) + offset(8) + len(8)
    + blockType(1) + useEncrypt(1) + ivSeed(4)   = 62 字节
```

### 36.9.2 ★ 关键 bug：chunk 前进量

**实测（`55FC21C6` 1.5.3）：**
```
chunk1 : [52, 244)  = 192 字节
chunk2 : 244        ← ★ 紧接在 end 处，无尾随字节
```

**⇒ 原代码 `cp = q + 10` 是错的（多走 10 字节）。**
**⇒ 已改为 `cp = q`，并进一步改为**自适应搜索**（扫描 `q..q+64` 找下一个
能通过 `probe` 的位置），以兼容未知的尾部差异。**

### 36.9.3 修复后的实测结果

| 块 | 版本 | 期望 | 实际 | 结果 |
| --- | --- | --- | --- | --- |
| `0CE8FA57` InitBundle | 1.5.3 | 1052 | 1052 | ✅ |
| `0CE8FA57` InitBundle | **1.6.4** | 1052 | 1052 | ✅ |
| `55FC21C6` Video | 1.5.3 | 636 | 636 | ✅ |
| `7064D8E2` Bundle | 1.5.3 | 252873 | 252873 | ✅ |
| `24ED34CF` Audio | 1.5.3 | 6 | 6 | ✅ |
| `42A8FCA6` Table | 1.5.3 | 1 | 1 | ✅ |
| `55FC21C6` Video | 1.6.4 | 688 | 1 | ❌ |
| `7064D8E2` Bundle | 1.6.4 | 270433 | 1 | ❌ |

**⇒ **1.5.3 全部正确（6/6）**；1.6.4 只有 `InitBundle` 正确。**

### 36.9.4 1.6.4 多 chunk 的差异（未解）

**1.6.4 的 chunk 头多 4 字节（§36.2），但**不止这一处**：**
```
1.6.4 chunk1 @57 的解析在 name 处报 UnicodeDecodeError
⇒ 说明 1.6.4 的 fileCount / nameLen 字段位置与 1.5.3 不同
   （不只是整体 +4）
```

**⇒ 需要单独逆向 1.6.4 的 chunk 头布局。**

### 36.9.5 ★ 但对目标用途**已足够**

**mod 加载只依赖 `InitBundle`（`chunkNum=1`），而它在**两个版本上都正确**。**
**⇒ 工具可以支撑 mod 路径；多 chunk 的 1.6.4 布局留待后续。**

---

## 36.10 ★★★ 1.6.4 chunk 头字段精确定位（第 44 轮）

### 36.10.1 逐字节对比结论

**1.6.4 在 chunk 头的 `+45` 处**多了一个 4 字节字段（全零）**：**

```
相对偏移  1.5.3 (55FC21C6)           1.6.4 (55FC21C6)
  +40     0d 00 00 00  (blockType=13)  0d 00 00 00  (blockType=13)   相同
  +44     00                           00                              相同
  +45     01 00 00 00  (fileCount=1)   00 00 00 00  ← ★ 多出的 4 字节（0）
  +49     4f 00        (nameLen=79)    01 00 00 00  (fileCount=1)    ← 后移 4
  +51     44 61 74 61  ("Data")        4f 00        (nameLen=79)     ← 后移 4
  +53     …                            44 61 74 61  ("Data")
```

### 36.10.2 字段位置对照表

| 字段 | 1.5.3 | **1.6.4** |
| --- | --- | --- |
| `md5Name` (16) | +0 | +0 |
| `md5Content` (16) | +16 | +16 |
| `u64 文件长度` | +32 | +32 |
| `u32 blockType` | +40 | +40 |
| `u8` | +44 | +44 |
| **★ 新增 4 字节（全零）** | — | **+45** |
| `u32 fileCount` | **+45** | **+49** |
| `u16 名字长度` | **+49** | **+53** |
| `name` | **+51** | **+55** |

### 36.10.3 修复方案

**`blcparse.c` 的 `probe` 与文件条目循环需要按 `version` 分派：**

```c
/* chunk 头里 fileCount 的偏移 */
int fcOff = (ver >= 5) ? 49 : 45;
/* 名字长度与名字 */
int nlOff = fcOff + 4;          /* 53 / 49 */
int nmOff = nlOff + 2;          /* 55 / 51 */

/* 文件条目循环里 q 起点 */
long long q = cp + nmOff;
```

**并要求 `probe` 的搜索窗口覆盖到 49（当前 41..56 已覆盖，所以 chunk 1 能找到）。**

### 36.10.4 ★ 仍然失败的原因（推测）

**chunk 1 能解析（probe 找到 +49 的 fileCount=1），但 chunk 2 起点计算不准：**

- **1.6.4 的文件条目**尾部可能也多 4 字节**（与头部对应）
- **或 chunk 之间有额外的对齐/尾随字节**

**⇒ 需要**实测 1.6.4 的 chunk1 → chunk2 间距**才能确定。**

**（1.5.3 实测是 `chunk2 = end + 0`，1.6.4 尚未实测成功。）**

### 36.10.5 对目标用途的影响

**⇒ **无影响**：mod 加载只用 `InitBundle`（`chunkNum=1`），
它在 1.6.4 上已正确解析出 1052 条。**
