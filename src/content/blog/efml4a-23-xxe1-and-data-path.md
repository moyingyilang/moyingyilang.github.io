---
title: "23 · 数据侧密码：XXE1 = ChaCha20，与密钥使用点"
description: "EFML4A 研究文档 · 23-xxe1-and-data-path（Arknights: Endfield Mod Loader for Android）"
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


## 23.1 `XXE1` 就是标准 ChaCha20（结构级确证）

```csharp
public sealed class XXE1 : IDisposable {
    public const Int32 allowedKeyLength;     // 32
    public const Int32 allowedNonceLength;   // 12
    public const Int32 processBytesAtTime;   // 64
    private const Int32 stateLength;         // 16
    private readonly UInt32[] state;   // 0x10
    private Boolean isDisposed;        // 0x18
    private UInt32[] x;                // 0x20
    private Byte[] tmp;                // 0x28
    private Byte processedIdx;         // 0x30
    private static readonly Byte[] sigma;    // "expand 32-byte k"
    private static readonly Byte[] tau;      // "expand 16-byte k"
    .ctor(ReadOnlySpan`1 key, ReadOnlySpan`1 nonce, UInt32 counter)
    KeySetup(ReadOnlySpan`1 key)
    IvSetup(ReadOnlySpan`1 nonce, UInt32 counter)
    TransformBytes / DecryptBytes / EncryptBytes ...
}
```

`sigma` / `tau` 是 ChaCha 的常量字符串，`state[16]`、`processBytesAtTime = 64`
——**与 FkArkEnd 的 `CSChaCha20` 完全一致** ⇒ **`XXE1` 是标准 IETF ChaCha20**。

## 23.2 密钥被使用与他被计算的确切位置

`VFSFileReadStream`（`.chk` 数据的读取流）持有 `private XXE1 m_encryptor; // 0x50`。
其构造函数 `VFSFileReadStream..ctor(FVFBlockFileInfo, Stream)` @ **RVA `0xb385d38`** 中：

```asm
b385fc4: bl 0xb37dcd0 <il2cpp+0x186fad0>   ; ★ GetCommonChachaKeyBs —— 计算并缓存密钥
b386014: bl 0xade156c <il2cpp+0x12d336c>   ; ★ XXE1..ctor —— 用该密钥建立 ChaCha20
```

**⇒ 每当游戏创建 `VFSFileReadStream` 去读一个 `.chk`，就会调用
`GetCommonChachaKeyBs` 填充 `s_commomChachaKeyBs`。**
这正是长期等待的「密钥被真正计算出来」的时刻。

## 23.3 加密标志位已定位

```asm
b385e0c: ldrb w8, [x22, #0x18]      ; x22 = FVFBlockFileInfo
b385e10: tbz  w8, #0x0, 0xb386064   ; ★ 测试 +0x18 的低字节 bit0
```

`FVFBlockFileInfo` 的非托管布局中 `+0x18` = `m_packedFlags`
⇒ **`FLAG_USE_ENCRYPT` 就是 `m_packedFlags` 的 bit 0**。

本次导出的 `InitBundle` 全部 1052 条记录 `flags = 0x408`（bit0 = 0）
⇒ **按该判断，这些条目的数据不应被 XXE1 加密**。

## 23.4 尚未解开的最后一层矛盾

| 事实 | 矛盾点 |
| --- | --- |
| `flags = 0x408` ⇒ bit0 = 0 ⇒ 不该加密 | 但按映射切出的数据**无任何已知魔数**（1052/1052） |
| 首条记录 `offset=0, len=2458`，应从文件第 0 字节开始 | 文件首字节是 `00`，不是 `UnityFS` |

**熵 = 6.550 bits/byte（非随机）且头部有周期 4 重复**
⇒ 数据**不是随机噪声**，但也不是直接的 AssetBundle。

**待查方向**（下一轮）：

1. `offset` 是否需要叠加某个**块起始基准**（例如 `.chk` 内的数据区偏移）
2. `.chk` 文件本身是否有一层**外层容器头**（类似 `@UTF`）
3. `Read()` 中 `m_baseStream.Seek()` 的实际计算方式（RVA `0xb38d6d4`）
4. `m_packedFlags` 中其它位（`BLOCK_TYPE` / `LOADER_POS_TYPE` / `FILE_TAG`）的含义
5. 是否还有**第二层解压**（LZ4 / Unity 的块压缩）

## 23.5 相关 RVA 速查（本机 v1.5.3）

| 符号 | RVA |
| --- | --- |
| `VirtualFileSystem.GetCommonChachaKeyBs` | `0xb37dcd0` |
| `VFSFileReadStream..ctor` | `0xb385d38` |
| `VFSFileReadStream.Read(Byte[],Int32,Int32)` | `0xb38d6d4` |
| `XXE1..ctor` | `0xade156c` |
| `XXE1.KeySetup` | `0xade16cc` |
| `XXE1.IvSetup` | `0xade1c40` |
| `XXE1.DecryptBytes(Byte[],Byte[])` | `0xade2a6c` |
| `FVFBlockFileInfo.ReadFromByteBuf` | `0xb377180` |
| `VFBlockMainInfo.ReadFromByteBuf` | `0xb376528` |

相关：[22](/blog/efml4a-22-index-walk-success/) · [20](/blog/efml4a-20-runtime-key-and-memory-extraction/)

---

## 23.6 本轮新增：映射完整性**完美确证**，但数据格式仍待解

### 23.6.1 映射精确覆盖整个 `.chk`（差 0）

`InitBundle` 的 1052 条记录 offset **严格连续拼接**：

```
idx=0 offset=        0 len=2458  end=   2458
idx=1 offset=     2458 len=3182  end=   5640
idx=2 offset=     5640 len=3183  end=   8823
idx=3 offset=     8823 len=3189  end=  12012
...
最后一条结束于 175,600,672
文件实际大小      175,600,672     ← ★ 差 0
```

⇒ **`offset` 是相对文件起始的绝对偏移，映射无遗漏、无重叠、无间隙。**
索引侧的正确性**已无任何疑义**。

### 23.6.2 `VFSFileReadStream.Read` 的确切行为（RVA `0xb38d6d4`）

```asm
b38d74c: ldr  x23, [x21, #0x48]     ; m_baseStream
b38d778: mov  x1, x20               ; buffer
b38d77c: mov  w2, w19               ; offset
b38d788: mov  w3, w22               ; count
b38d78c: blr  x9                    ; ★ m_baseStream.Read(buffer,offset,count) —— 不 Seek
b38d7c8: ldrb w8, [x21, #0x40]      ; ★ m_blockFileInfo.m_packedFlags 低字节
b38d7cc: tbz  w8, #0x0, 0xb38d7f0   ; bit0=0 → 直接返回，**不解密**
b38d7ec: bl   0xade21d8             ; 否则 XXE1.TransformBytes(buf,off,buf,off,count) 原地解密
```

**构造函数 `ldp q0,q1,[x22]` 一次拷贝 32 字节** ⇒ **`sizeof(FVFBlockFileInfo) = 0x20`**
（与我扫描时采用的记录步长 0x20 一致，互相印证）。

`stream + 0x40` 减去 `m_blockFileInfo` 的起始 `0x28` 正好等于 `0x18`
⇒ **确认该标志就是 `m_packedFlags` 的 bit 0**。

### 23.6.3 但数据仍不可直接读

对 `InitBundle` 记录（`flags = 0x408`，bit0 = 0 ⇒ 按代码**不解密**）的实测：

| 检验 | 结果 |
| --- | --- |
| `.chk` 内 `UnityFS` 出现次数 | **0** |
| `.chk` 内 `UnityWebData` 出现次数 | 0 |
| `.chk` 内 `PK\x03\x04`（zip）出现次数 | 0 |
| `.chk` 内 `\x1f\x8b`（gzip） | 1,901 |
| `.chk` 内 `x\x9c`（zlib） | 988 |
| `.chk` 内 `x\x01`（zlib 低压缩） | **12,821** |
| 各记录**起始 256 字节内**是否存在 zlib 头 | **0 / 60** |
| 对前 40 条记录尝试 zlib/gzip/raw-deflate 解压 | **全部失败** |

**首条记录起点头 8 字节**：`00 79 79 f4 d7 fa cd 99`
**后续记录起点**：`c8 0b 02 aa`、`33 7e 31 2a`、`b3 38 17 ba`、`1e 73 3d 95`…
（**`idx=4` 与 `idx=5` 的起点 8 字节完全相同**：`1e733d95be57b5b0`
—— 这暗示相邻记录之间可能存在**共享/去重**关系）

### 23.6.4 结论与下一轮方向

**结论**：**索引侧 100% 正确**；`flags` 表明这些条目**不经 XXE1 解密**；
但记录的原始字节**既不是明文 AssetBundle，也不是直接可解的压缩流**。

**下一轮待查**（按优先级）：

1. **`CAB-` 出现 621 次** —— 在 Unity 中这是 AssetBundle 的内部命名前缀，
   需确认它们位于索引字符串区还是数据区
2. **`VirtualFileSystem.GetAssetStream(FVFBlockFileInfo)`** 的完整实现
   —— 它才是把 `.chk` 打开、Seek 到 `offset`、包成 `VFSFileReadStream` 的地方，
   可能还有一层变换
3. **`m_packedFlags` 其余位的含义**（`BLOCK_TYPE` / `LOADER_POS_TYPE` / `FILE_TAG`）
   —— `flags = 0x408` 中 bit3 与 bit10 置位，可能与「是否为直接文件名」
   「加载器位置类型」有关
4. **`s_commomChachaKeyBs` 实际取值**（只读轮询捕获）用于交叉验证
5. 是否存在**游戏自有的容器格式**（`Beyond` 自研），而非标准 Unity 格式

---

## 23.7 ★ 完整调用链还原：从「文件名哈希」到「`.chk` 文件流」

### 23.7.1 `GetAssetStream(ref FVFBlockFileInfo)` @ `0xb385bc0` 全文语义

```asm
b385c0c: bl  0xb37a7a0      ; GetRelativeChunkFilePath(info) → .chk 路径
b385c18: bl  0xb379458      ; get_loaderPosType()  → EFileLoaderPosType（★ 决定从哪种介质加载）
b385c24: ldr w3, [x19, #0x10]   ; ★ offset = info.offset（结构偏移 +0x10）
b385c3c: mov w4, #0x1000        ; bufferSize = 4096
b385c48: bl  0xb3702ac      ; ★ UnityFileLoaderHelper.ReadFileByStream(...)
b385c60: bl  0x9997860      ; il2cpp_object_new(VFSFileReadStream)
b385c7c: bl  0xb385d38      ; VFSFileReadStream..ctor(info, baseStream)
```

### 23.7.2 各方法的确切签名（由 `dump.cs` 反查）

| RVA | 签名 |
| --- | --- |
| `0xb37a7a0` | `String FVFBlockFileInfo.GetRelativeChunkFilePath()` |
| `0xb379458` | **`EFileLoaderPosType FVFBlockFileInfo.get_loaderPosType()`** |
| `0xb3702ac` | **`Stream UnityFileLoaderHelper.ReadFileByStream(String dir, String fileName, EFileLoaderPosType pos, Int32 offset, Int32 bufferSize, Boolean useAsync)`** |
| `0xb385d38` | `VFSFileReadStream..ctor(FVFBlockFileInfo fileInfo, Stream baseStream)` |

### 23.7.3 关键新发现：`EFileLoaderPosType` 决定「从哪种介质加载」

调用 `ReadFileByStream` 时，`pos` 参数取自 **`get_loaderPosType()`**，
而后者由 **`m_packedFlags` 的 `LOADER_POS_TYPE` 位段**导出（见 `FVFBlockFileInfo` 的常量：

```csharp
private const Int32 LOADER_POS_TYPE_SHIFT;
private const UInt32 LOADER_POS_TYPE_MASK;
private const Int32 BLOCK_TYPE_SHIFT;
private const UInt32 BLOCK_TYPE_MASK;
private const Int32 FILE_TAG_SHIFT;
private const UInt32 FILE_TAG_MASK;
private const UInt32 FLAG_USE_ENCRYPT;
private const UInt32 FLAG_IS_DIRECT_FILE_NAME;
```

⇒ **同一个 `FVFBlockFileInfo` 可能指向不同物理介质上的 `.chk`**
（StreamingAssets / persistentDataPath / OBB / 外部 VFS 目录 …），
**并且不同的 loader 位置类型可能对应不同的数据变换（含是否加密）。**

本次导出的 `InitBundle` 记录 `flags = 0x408`：

```
0x408 = 0000 0100 0000 1000b
  bit0  = 0    ⇒ FLAG_USE_ENCRYPT = false
  bit3  = 1    ⇒ 落在某个位段内
  bit10 = 1    ⇒ 落在某个位段内
```

具体的 `LOADER_POS_TYPE` / `BLOCK_TYPE` / `FILE_TAG` 取值需要
**反汇编 `get_loaderPosType`（`0xb379458`）拿到位段移位与掩码**。

### 23.7.4 下一轮（收口这一层）

1. **反汇编 `0xb379458`（`get_loaderPosType`）** 与 `0xb3790e4`（`get_blockType`）
   —— 拿到 `LOADER_POS_TYPE_SHIFT/MASK`、`BLOCK_TYPE_SHIFT/MASK` 的确切值
2. 由 `flags = 0x408` 解出 `loaderPosType` 与 `blockType` 的实际取值
3. **反汇编 `UnityFileLoaderHelper.ReadFileByStream`（`0xb3702ac`）**
   —— 看它如何依据 `pos` 选择基目录，以及**是否对数据施加额外变换**
4. 若 `pos` 指向的基目录不是 `/sdcard/.../files/VFS/`，
   则说明**我一直在读的是"补丁层"**，而 `assets/VFS/` 或 OBB 才是另一层

---

## 23.8 ★ `m_packedFlags` 位段定义完全破解

### 23.8.1 由三个访问器的反汇编直接读出

```asm
; get_loaderPosType @ 0xb379458
b3794b4: ldr  w8, [x0, #0x18]      ; w8 = m_packedFlags（FVFBlockFileInfo+0x18）
b3794b8: ubfx w0, w8, #10, #8      ; ★ LOADER_POS_TYPE = (flags >> 10) & 0xFF

; get_blockType @ 0xb3790e4
b379140: ldr  w8, [x0, #0x18]
b379144: ubfx w0, w8, #2, #8       ; ★ BLOCK_TYPE = (flags >> 2) & 0xFF

; get_fileTag @ 0xb3797cc
b379860: ldr  w8, [x19, #0x18]
b379864: ubfx w0, w8, #18, #8      ; ★ FILE_TAG = (flags >> 18) & 0xFF
```

**`m_packedFlags` 的完整布局**：

```
bit  0      : FLAG_USE_ENCRYPT          （已在 §23.3 由 tbz w8,#0 确认）
bit  1      : FLAG_IS_DIRECT_FILE_NAME
bits 2..9   : BLOCK_TYPE       = (flags >> 2)  & 0xFF
bits 10..17 : LOADER_POS_TYPE  = (flags >> 10) & 0xFF
bits 18..25 : FILE_TAG         = (flags >> 18) & 0xFF
```

### 23.8.2 对本次导出映射的解码结果

| blc | 记录数 | flags | ENC | DIRECT | BLOCK | LOADER | TAG |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **InitBundle** | **1052** | `0x408` | **0** | 0 | **2** | **1** | 0 |
| IFixPatchOut | 2 | `0x415` | **1** | 0 | 5 | 1 | 0 |
| InitAudio | 2 | `0x804` | 0 | 0 | 1 | **2** | 0 |
| BundleManifest | 1 | `0x40411` | **1** | 0 | 4 | 1 | 1 |
| InitialExtendData | 1 | `0x80c` | 0 | 0 | 3 | **2** | 0 |

按 `(LOADER_POS_TYPE, BLOCK_TYPE, ENC)` 聚合：

```
LOADER=1 BLOCK=2 ENC=0  → 1052 条   （InitBundle）
LOADER=1 BLOCK=4 ENC=1  →    1 条   （BundleManifest）
LOADER=1 BLOCK=5 ENC=1  →    2 条   （IFixPatchOut）
LOADER=2 BLOCK=1 ENC=0  →    2 条   （InitAudio）
LOADER=2 BLOCK=3 ENC=0  →    1 条   （InitialExtendData）
```

**⇒ `InitBundle` 的 1052 条确实 `ENC=0`（不加密）**，
但按 `{offset,len}` 切出的数据仍不可直接识别（见 §23.6.3）。

### 23.8.3 已排除的 nonce 猜测

考虑到 chunk 的 MD5（`eaafec0435ec71ffc65d8cf3e4595852`）正好是 16 字节，
可能是 IV/nonce 来源，遂测试：

| 组合 | 结果 |
| --- | --- |
| `ChaCha20(CBT3key, md5[0:12], ctr 0/1)` | ✗ |
| `ChaCha20(CBT3key, md5[4:16], ctr 0/1)` | ✗ |
| `ChaCha20(CBT3key, md5[0:8]+0000)` | ✗ |
| `ChaCha20(md5, 全零nonce)` | ✗ |
| `ChaCha20(CBT3key, md5 反转[0:12])` | ✗ |

### 23.8.4 下一轮唯一剩下的方向

**`UnityFileLoaderHelper.ReadFileByStream`（`0xb3702ac`）** 是关键：

```csharp
public static Stream ReadFileByStream(String dir, String fileName,
        EFileLoaderPosType pos, Int32 offset, Int32 bufferSize, Boolean useAsync)
```

它按 **`pos`（=`LOADER_POS_TYPE`）选择基目录与加载方式**。
`InitBundle` 的 `LOADER_POS_TYPE = 1`、`InitAudio` 的是 `2` ——
**不同取值很可能对应不同介质，且可能对数据施加不同变换。**

需反汇编它，确认：

1. `pos` 各取值分别对应哪个基目录（StreamingAssets / persistentDataPath / OBB / 外部 VFS）
2. 是否在读取时施加额外变换（解压 / 解密 / 头部跳过）
3. `dir` 参数（第一个参数，来自静态类）的确切来源

---

## 23.9 ★★ 决定性验证：`LOADER_POS_TYPE` 语义确立（`PersistAsset` vs `StreamAsset`）

### 23.9.1 枚举定义（来自 `dump.cs`）

```csharp
public enum EFileLoaderPosType {
    None         = 0,
    PersistAsset = 1,     // ← 持久化目录
    StreamAsset  = 2,     // ← StreamingAssets（APK 内）
    Build        = 3,
    DataAsset    = 4,
}

public enum EVFSBlockType {
    None = 0, InitialAudio = 1, InitialBundle = 2, InitialExtendData = 3,
    BundleManifest = 4, IFixPatch = 5,
    Bundle = 11, Audio = 12, Video = 13, IV = 14, Streaming = 15,
    DynamicStreaming = 16, Lua = 17, Table = 18, JsonData = 19,
    ExtendData = 20, HotfixAudio = 21, Terrain = 22,
    AudioChinese = 101, AudioEnglish = 102, AudioJapanese = 103, AudioKorean = 104,
}

public enum EVFSFileTag { None = 0, Audit = 1 }
```

### 23.9.2 位段解码与枚举**逐一吻合**（零偏差）

| blc | decoded BLOCK | 枚举名 | decoded LOADER | 枚举名 |
| --- | --- | --- | --- | --- |
| `InitBundle` | 2 | `InitialBundle` ✓ | 1 | `PersistAsset` |
| `InitAudio` | 1 | `InitialAudio` ✓ | 2 | **`StreamAsset`** |
| `InitialExtendData` | 3 | `InitialExtendData` ✓ | 2 | **`StreamAsset`** |
| `BundleManifest` | 4 | `BundleManifest` ✓ | 1 | `PersistAsset` |
| `IFixPatchOut` | 5 | `IFixPatch` ✓ | 1 | `PersistAsset` |

**⇒ 位段解码 100% 正确（§23.8 的破解得到独立佐证）。**

### 23.9.3 物理位置验证：`StreamAsset` 的文件**确实在 APK 里**

对 `/sdcard/.../files/VFS/` 中「找不到」的两个 chunk md5，改到 APK 的 `assets/VFS/` 下搜索：

```
A1E0C0C44814B777B62E56784C5C03CE  →  assets/VFS/07A1BB91/A1E0C0C4….chk   96,228 B
   ★ 映射中 InitAudio 的 chunk len = 96,228        完全一致 ✓

DEE052A7E78A0672FE5D700D0E0B3451  →  assets/VFS/3C9D9D2D/DEE052A7….chk  457,018 B
   ★ 映射中 InitialExtendData 的 chunk len = 457,018  完全一致 ✓
```

**⇒ `LOADER_POS_TYPE` 即「文件所在介质」的确切语义已被铁证确认：**

| `LOADER_POS_TYPE` | 含义 | 物理位置 |
| --- | --- | --- |
| **1 `PersistAsset`** | 持久化资源 | `/sdcard/Android/data/<pkg>/files/VFS/` |
| **2 `StreamAsset`** | 流式资源 | **APK 内 `assets/VFS/`** |

**规模**：APK 内 **50 个 `.chk` + 11 个 `.blc`**；sdcard 内 **1094 个 `.chk`**；
**同名交集 14 个，仅 APK 独有 36 个**。

### 23.9.4 ★ 发现 Beyond 自研容器魔数 `:)xD`

从 APK 抽出 `InitAudio` 的 `.chk`（`ENC=0`）后检验：

```
大小      : 96,228 字节（= 映射中该 chunk 的 len，即整个文件就是唯一一个条目）
头 32 字节: 3a 29 78 44 50 03 00 00 a4 b5 bc 87 …
ASCII     :  :  )  x  D  |  P \x03 …
熵        : 7.998 bits/byte  ← 几乎完全随机
```

**`3a 29 78 44` = ASCII `:)xD`** —— 这正是用户 v1.4 实战文档 §2.2 中记录的
「有的直接是 `UnityFS`，**有的是 `:)xD`**，有的是乱码」里的那个魔数。

配套观察：头部扫描统计中另有一种变体 **`3a29784444000000`（`:)xD` + `44 00 00 00`）出现 13 次**。

**⇒ 结论：`.chk` 内的资源数据是 `Beyond` 自研容器格式（魔数 `:)xD`），
而不是标准 Unity AssetBundle。**这解释了为何：

1. 整个 `.chk` 中 `UnityFS` 出现 **0 次**
2. 即使 `ENC=0`（不经 XXE1 解密），数据仍是**高熵不可直接读**
3. 头部魔数统计里有多种互不相同的形态（`:)xD`、`CRID`、`3a297844…`、其它）

### 23.10 目标进度与结论（第 10 轮）

| 项 | 状态 |
| --- | --- |
| (1) 解析 `FVFBlockFileInfo` 映射表 | ✅ **达成**（完整性已证） |
| (2) SIGSTOP+32 线程工具落盘映射 | ✅ **达成** |
| (3) `s_commomChachaKeyBs` 交叉验证 | ⏳（但已证明**多数块 ENC=0，不需要它**） |
| (4) `.chk` 按映射提取 | 🟡 **文件定位已完全解决**（按 `LOADER_POS_TYPE` 到 sdcard 或 APK）；<br>**内容格式为 Beyond 自研容器 `:)xD`，需进一步逆向** |
| (5) docs 与推送 | ✅ 已完成（25 份文档） |

**本轮的实质进展**：把「`.chk` 到底在哪、要不要密钥」这两个问题**彻底解决**——
答案是「**看 `LOADER_POS_TYPE` 决定介质，看 `FLAG_USE_ENCRYPT` 决定是否解密**」，
且**已用文件大小逐字节验证**。

**下一轮**：逆向 `:)xD` 容器格式（头部为 `magic(4) + u32`，其后为高熵载荷）。

---

## 23.11 `:)xD` 自研容器的调查结果（第 11 轮）

### 23.11.1 出现规模：**28 个 `.chk`**（而非常数）

头部前 4 字节统计（1094 个 `.chk` 的 top 频次）：

| 头部前 4 字节 | 数量 | 含义 |
| --- | --- | --- |
| `43524944` | 636 | `CRID`（CriWare USM 视频） |
| `03000003` | 55 | 其它 |
| **`3a297844`** | **28** | **`:)xD`（Beyond 自研容器）** |
| `18000000` | 25 | 其它 |
| `1c090000` | 19 | 其它 |
| … | | |

### 23.11.2 魔数后的 u32 **随文件变化**（非格式常量）

| 头部 8 字节 | 文件大小 | 魔数后 u32 |
| --- | --- | --- |
| `3a297844 44000000` | 236 | 68 (`0x44`) ×8 个 |
| `3a297844 48000000` | 207,722 | 72 (`0x48`) |
| `3a297844 58000000` | 769,782 | 88 (`0x58`) |
| `3a297844 780f0000` | 9,840,216 | 3960 (`0xf78`) ×3 |
| `3a297844 ec620000` | 1,815,195 | 25324 (`0x62ec`) |
| `3a297844 84e20000` | 274,933,507 | 57988 (`0xe284`) |
| `3a297844 cccd0400` | 1,609,858,907 | 314828 (`0x4cdcc`) |
| `3a297844 94d70500` | 23,157,653 | 382868 (`0x5d794`) |
| `3a297844 64ea0900` | 1,611,257,466 | 649828 (`0x9ea64`) |
| `3a297844 38610b00` | 1,515,974,482 | 745784 (`0xb6138`) |
| `3a297844 5c630b00` | 1,298,307,860 | 746332 (`0xb635c`) |

**⇒ 该 u32 显然不是固定的格式版本号，而更像长度/种子类字段**
（注意 `0x44`、`0x48`、`0x58` 三档出现在小文件上，且与「头部长度」假说尚不吻合——
`0x44`=68 时文件仅 236 字节，若为头长则载荷仅 168 字节）。

### 23.11.3 魔数不在托管代码里

在 `libil2cpp.so`（449 MB）中检索 **`:)xD` 出现 0 次**，
其小端 u32 形式 `0x4478293a` 同样 **0 次**。

⇒ **处理该容器的代码位于原生库**（`libunity.so` / `libmain.so` 等），
而非 IL2CPP 生成的 C# 代码。若要继续逆向，需转向原生库。

### 23.11.4 熵特征

`InitAudio` 的 `.chk`（96,228 B，`CRID` 之外的另一类）分块熵：

```
+0x0000  熵=7.22      +0x0100  熵=7.25
+0x0200  熵=7.16      +0x0300  熵=7.21
+0x0400  熵=7.28
```

**除开头 8 字节（`:)xD` + u32）外整体均匀高熵** ⇒ 载荷是压缩或加密的，
且**不存在明文的容器头结构**。

### 23.11.5 小结与下一轮

| 已知 | 未知 |
| --- | --- |
| 魔数 `:)xD`（4 字节）+ 一个变化的 u32（4 字节） | u32 的确切语义 |
| 其后为均匀高熵载荷 | 载荷是压缩（LZ4/LZMA？）还是加密（XXE1？） |
| 出现于 28 个 `.chk` | 条目如何切分 |
| 处理代码在**原生库**而非 `libil2cpp.so` | 需要逆向 `libunity.so` / `libmain.so` |

**下一轮建议**：在 `libunity.so` / `libmain.so` 中检索 `:)xD`
（或其特征字节 `3a 29 78 44`），定位读取该容器的原生函数。

### 23.11.6 原生库检索：**全部为负**

对游戏 `lib/arm64/` 下的原生库逐一检索字面量 `:)xD`：

| 库 | `:)xD` 偏移 |
| --- | --- |
| `libunity.so` | **-1（未找到）** |
| `libmain.so` | **-1** |
| `libtersafe2.so` | **-1** |
| `libtprt.so` | **-1** |
| `libthemis.so` | **-1** |

连同 `libil2cpp.so`（亦为 0 次）⇒ **`:)xD` 在游戏全部主要二进制中都不以字面量形式出现。**

**可能的解释**：

1. **以寄存器立即数比较**（`movz`/`movk` 组合成 `0x4478293a`），
   此时字节不会以连续数据形式出现，需检索**指令编码**而非数据
2. 该魔数是**对某个已知魔数施加变换**后的结果（例如位移/异或）
3. 由**外部工具链**（打包/加密工具）生成，运行时**不做魔数校验**，
   只按固定偏移解析

### 23.11.7 另一组观察：u32 与文件大小不成比例

| 头部 | 文件大小 | u32 |
| --- | --- | --- |
| `3a297844 44000000` | 236（×8 个，头部完全相同） | 68 |
| `3a297844 44000000` | 407,427 | 68 |
| `3a297844 44000000` | 1,158,912 | 68 |
| `3a297844 48000000` | 207,722 | 72 |
| `3a297844 58000000` | 769,782 | 88 |
| `3a297844 780f0000` | 9,840,216（×3） | 3960 |
| `3a297844 ec620000` | 1,815,195（×2） | 25324 |

**同一个 u32 值（68）可对应 236 B 到 1.16 MB 的不同文件**，
且 4 个 236 B 文件的整个 8 字节头完全相同 ⇒
**该字段既不是文件长度，也不是内容哈希**，更像**压缩/加密参数或版本档位**。

**下一轮建议**：在 `libil2cpp.so` / `libunity.so` 中检索
`movz`/`movk` 指令编码（`0x4478` 与 `0x293a` 作为 imm16），
以定位「以立即数比较该魔数」的代码路径。

### 23.11.8 指令级检索（`movz`/`movk` 立即数）：**仍为负**

既然魔数不以字面量出现在任何二进制中，转而检索**以寄存器立即数比较**的可能。
按 ARM64 编码规则扫描全部 4 字节对齐指令：

```
MOVZ 32-bit: (w & 0x7F800000) == 0x52800000
MOVK 32-bit: (w & 0x7F800000) == 0x72800000
MOVZ 64-bit: (w & 0xFF800000) == 0xD2800000
MOVK 64-bit: (w & 0xFF800000) == 0xF2800000
```

检索 `imm16 ∈ {0x293a, 0x4478}`（即 `0x4478293a` 的两半）：

| 二进制 | 命中 |
| --- | --- |
| `libil2cpp.so`（429 MB） | 12 处 |
| `libunity.so`（28 MB） | 1 处 |
| `libmain.so` | 0 处 |

**逐一反汇编核对，12 处全部是 il2cpp 元数据样板，与魔数无关**：

```asm
; 形态一：与字段数量比较
c916418: ldr  w9,  [x8, #0x18]
c91641c: mov  w10, #0x293a          ; 10554
c916420: cmp  w9,  w10
c916424: b.ls 0xc916480

; 形态二：按静态字段偏移取值（0x4478 + movk #1<<16 = 0x14478）
c90d174: mov  w8, #0x4478
c90d178: movk w8, #0x1, lsl #16
c90d17c: ldr  x8, [x9, x8]

; 形态三：同样是字段数量比较
d4b4540: mov  w10, #0x4478
d4b4544: cmp  w9,  w10
```

### 23.11.9 `:)xD` 调查的最终结论

| 检索方式 | 结果 |
| --- | --- |
| 字面量 `:)xD`（字符串/字节序列） | `libil2cpp` / `libunity` / `libmain` / `libtersafe2` / `libtprt` / `libthemis` **全部 0 次** |
| 小端 u32 `0x4478293a` 作为数据 | **0 次** |
| `movz`/`movk` 立即数（`0x293a` / `0x4478`） | 命中 13 处，**逐一核对后全部与魔数无关** |

**⇒ 游戏二进制中完全不存在对该魔数的比较逻辑。**

**最合理的解释**：

> **`:)xD` 是外部打包工具写入的容器标识，运行时并不校验它** ——
> 游戏只按**固定偏移**解析容器内容。

**这带来两个推论**：

1. 逆向 `:)xD` 容器**不能靠「找魔数比较点」这条路**，
   必须**从解析逻辑反推**（即：找到读取该 `.chk` 之后、把数据交给
   `VFSFileReadStream` / `XXE1` 之前的处理链）；
2. 结合 §23.7 已还原的调用链，**该处理链的入口就是
   `UnityFileLoaderHelper.ReadFileByStream`（`0xb3702ac`）** ——
   它按 `EFileLoaderPosType` 选介质，很可能**也按介质类型决定是否套用容器解析**。
