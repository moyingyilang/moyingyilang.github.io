---
title: "25 · ★★★ VFS 提取闭环达成（全量 356,356 条映射 + 端到端验证）"
description: "EFML4A 研究文档 · 25-full-vfs-extraction-closed-loop（Arknights: Endfield Mod Loader for Android）"
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


## 25.1 结论摘要

**从「文件名」到「文件字节」的全链路已打通，且经三重独立互证：**

| 验证 | 结果 |
| --- | --- |
| 全量映射记录数 | **356,356 条** |
| 路径合法性 | **356,356 条以 `Data/` 开头（100.0%）** |
| 长度合法性 | **356,356 条 `len > 0`（100.0%）** |
| 映射 vs 磁盘字节数 | Video 块 **3,457,127,488 B（映射） vs 3,457,360,913 B（磁盘）**，差 **0.0067%** |
| 实际提取产物 | `sketch_guide_video_..._ct.usm` → **`CRID` 头 + 合法 USM 结构** |
| 索引一致性 | `.blc` 中 `InitBundle` 的 `groupFileInfoNum = 1052`，与**内存导出条目数完全一致** |

## 25.2 两个解密算法（均纯离线可复现）

### A. `.blc` 块配置：ChaCha20 变体

```
key     = GetCommonChachaKeyBs(zeros(KEY_LEN))   // 由 CHACHA_KEYS + master 派生
nonce   = blc[0 .. 12]                           // 文件开头 12 字节
counter = 1
范围    = [12, len)
```
**已导出密钥**：`（已隐去）`
（由 `CHACHA_KEYS[0]+[3]+[5]+[2]+"="` → base64 解码 → 逐字节减 master
`"Assets/Beyond/DynamicAssets/"` 得到。）

**⇒ 21/21 个 `.blc` 全部解密成功。**

### B. `.chk` 中的 `:)xD` 容器：HGCipher

```c
// HGCipherHelper::DecipherInplace(pData, seed, sizeData, offsetToFileStart)
// 调用：DecipherInplace(buf + 12, headerSize, headerSize - 4, 0)
uint32_t gen_key(uint32_t x){
    uint32_t k = 81861667u;                 // 0x4E11C23
    uint32_t a = ((x & 0xFF) ^ 0x9C5A0B29) * k;   // ★ NEON 版带掩码
    a = (a ^ ((x >>  8) & 0xFF)) * k;
    a = (a ^ ((x >> 16) & 0xFF)) * k;
    a = (a ^ ( x >> 24        )) * k;
    return a;
}
// 起始索引 = seed + (offsetToFileStart >> 2)，每 4 字节索引 +1
// 密钥逐字节 XOR 进数据
```
**`: )xD` = 加密后的 Wwise `AKPK`（AudioKinetic PCK）**；解密后解出结构化头
（`u32 × 4` 等合理字段）。

## 25.3 `.blc` 结构（逐字节对齐结果）

```c
struct VFBlockMainInfo {
    u32    protoVersion;      // = 3
    u64    unknown;
    u32    version;           // = 4
    u32    unknown2;          // = 0x0188B872（全块相同）
    UTF16* groupCfgName;      // u16 长度 + UTF-8 内容
    i64    groupCfgHashName;
    u32    groupFileInfoNum;
    i64    groupChunksLength;
    u8     blockType;         // EVFSBlockType
    u32    chunkCount;
    Chunk  chunks[chunkCount];
};

struct Chunk {
    u128  md5Name;
    u128  contentMD5;
    i64   length;
    u8    blockType;
    u32   X;                  // 额外字段
    u32   fileCount;
    File  files[fileCount];
};

struct File {
    UTF8* fileName;           // u16 长度 + 内容
    i64   fileNameHash;
    u128  fileChunkMD5Name;
    u128  fileDataMD5;
    i64   offset;
    i64   len;
    u8    blockType;
    u8    useEncrypt;
    u32   ivSeed;             // ★ 恒存在（4 字节）
};
```

**⚠️ 关键陷阱（本项目的踩坑记录）**：
1. `ivSeed` 是 **u32 且恒存在**，不是「仅当 `useEncrypt` 时读取」
2. 额外字段 `X` 位于 `fileCount` **之前**，且会让 chunk 头长度在 49/50 间变化
   ⇒ 必须**自动探测** `fileCount` 位置
3. 每个块尾部固定剩 **10 字节**

## 25.4 全量映射结果（21 个块）

| 块 | blockType | 文件数 | chunk |
| --- | --- | --- | --- |
| **Bundle** | 11 | **252,873** | 42 |
| JsonData | 19 | 95,645（部分块待修） | 131 |
| Streaming | 15 | 53,036 | 82 |
| Terrain | 22 | 46,164 | 25 |
| DynamicStreaming | 16 | 2,345 | 46 |
| InitBundle | 2 | 1,052 | 1 |
| Video | 13 | 636 | 636 |
| IV | 14 | 206 | 66 |
| HotfixAudio | 21 | 15 | 15 |
| Audio / AudioChinese / AudioEnglish / AudioJapanese / AudioKorean | 12/101/102/103/104 | 6 / 3×4 | — |
| InitAudio / InitialExtendData / ExtendData / BundleManifest / IFixPatchOut | 1/3/20/4/5 | 2/1/3/1/2 | — |
| Lua / Table | 17/18 | 1,339 / 724（待修） | — |

**完美解析 17/21 块，导出 356,356 条 100% 合法的映射。**

## 25.5 提取路径（按 blockType 分派）

| blockType | 容器 | 处理方式 |
| --- | --- | --- |
| `Video`(13) | `CRID` | **未加密，直接按 `{offset,len}` 切片** ✓ 已验证 |
| `InitialAudio`/`Audio*`(1/12/101-104) | `:)xD` | **HGCipher 解密后得 Wwise PCK** |
| `InitialBundle`(2) | 无魔数 | `ENC=0`，明文 Unity 序列化数据（含 TypeTree） |
| `BundleManifest`(4) / `IFixPatch`(5) | — | `ENC=1`，需 XXE1 解密 |
| 其它 | 多种 | 见 [24](/blog/efml4a-24-readable-chk-structures/) |

## 25.6 工具清单（全部 C + 多线程，可复现）

| 工具 | 用途 |
| --- | --- |
| `sigscan.c` | 32 线程签名扫描 + 映射交叉验证（1052/1052 零漏报） |
| `sigcount.c` | 单文件签名/常量频次统计 |
| `blcparse.c` → `blcfinal.c` | **`.blc` 解密 + 自适应结构解析**（最终版） |
| `dumpblc.c` | `.blc` 解密后十六进制 dump |
| `hg2.c` / `hgcipher.c` | **HGCipher 实现与参数验证** |
| `lz4try2.c` / `unityhdr2.c` / `findlen.c` | 格式判定（均已排除） |

相关：[23](/blog/efml4a-23-xxe1-and-data-path/) · [24](/blog/efml4a-24-readable-chk-structures/) · [20](/blog/efml4a-20-runtime-key-and-memory-extraction/)

---

## 25.7 ★ 写路径打通：`.blc` 校验和 = 标准 CRC32

**实测反推（4/4 完全吻合）**：

| `.blc` | 尾部 4 字节 | `crc32(body[12, size-4))` |
| --- | --- | --- |
| `1CDDBF1F` | `0x48e52d5a` | **`0x48e52d5a`** ✓ |
| `07A1BB91` | `0x0cf68448` | **`0x0cf68448`** ✓ |
| `3C9D9D2D` | `0x67084945` | **`0x67084945`** ✓ |
| `0CE8FA57` | `0x692cf720` | **`0x692cf720`** ✓ |

**⇒ 校验和 = 标准 CRC32（多项式 `0xEDB88320`），覆盖范围 `[12, size-4)`。**

**至此写路径完整**：
```
1. 构造 .blc 主体（头 + chunks + files）
2. 计算 CRC32 over [12, size-4)，追加为最后 4 字节
3. ChaCha20 加密（nonce = 前 12 字节，counter = 1，范围 [12, size)）
4. 写入游戏挂载目录
```

## 25.8 mod 加载路径调研

### 完整性检查：**基本不存在**

```csharp
public class BlockValidator {
    public BlockValidator(IList<EVFSBlockType> blockTypes, VirtualFileSystem vfs);
    public bool TryGetResult(EVFSBlockType bt, out FLoadBlockInfo info, out List<chunk> missedChunks);
    public void CollectAllMissedChunks(List<chunk> missedChunks);   // ★ 只收集「缺失的块」
    public void ThreadSafeDoCheck(Action<float> onProgressChanged);
}
```

**⇒ 只检查「哪些 chunk 未下载」，不校验内容 MD5**
（`ValidChunkMD5` 仅用于下载校验，不在每次加载路径上）。

### 游戏自带挂载机制（mod 的天然载体）

```csharp
VirtualFileSystem.InitMountFromLocalFile(BlockValidator optionalValidator);
VirtualFileSystem.AppendMountFromLocalFile(Dictionary<preferredResType>, BlockValidator);
private void _MountLocalVFSType(EVFSBlockType, BlockValidator, out EVFSLoaderPosType, out int version);
```
外加 `HotFixPatchManager` / `HotFixPatchModules` / `HotFixPatchManagerProxy`
—— 官方热更路径即 mod 加载路径。

### 三条可行路线

| 路线 | 做法 | 风险 |
| --- | --- | --- |
| **A. 官方挂载** | 造合法 `.blc`+`.chk` 放入本地挂载目录 | 低（不碰代码） |
| **B. Hook 读取流** | Zygisk payload 挂 `GetAssetStream`(`0xb385ae0`) 重定向 | 中 |
| **C. Hook 校验** | 拦 `BlockValidator.TryGetResult` | 中 |

**基础设施**：Zygisk 注入**已实测跑通**（minimal payload 成功写日志）；
`SIGSTOP` + `/proc/pid/mem` 通道**未被 ACE 检测**。

### 风险提示

1. **ACE**：ptrace/Frida 会被**暂停进程**（非杀进程）；`/proc/pid/mem` 未被检测
2. **`.chk` 双源**：`LOADER_POS_TYPE` 决定改 sdcard 还是 APK
3. **首个实验建议选**：`Video`(CRID) / `JsonData` / `Table` —— 明文、易验证、不改数值
