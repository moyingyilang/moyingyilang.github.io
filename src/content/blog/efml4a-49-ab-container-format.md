---
title: "49. .ab 容器格式（1.6.4 实测）"
description: "EFML4A 研究文档 · 49-ab-container-format（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 49.1 ★ 核心发现：每个 .ab 是独立的混淆容器

```
.blc 条目: {fileName, offset, len, useEncrypt, ivSeed, chunkMD5}
  ⇒ .ab 内容 = .chk[offset, offset+len)

★ 每个 .ab 有自己的【混淆头】（与 .chk 无关）:
  @0  u32 a    （大端）
  @4  u32 b    （大端）= 校验值
  @8  ...      （字段，见下）

校验公式（变体1: ArknightsEndfield）:
  c1 = 4*(a ^ 0x4A92F0CD) & 0xFFFF0000
  c2 = ror32(a ^ 0x4A92F0CD, 14)
  c3 = c1 ^ c2 ^ 0xD8B1E637
  if (b == c3) ⇒ 校验通过
```

### 实测验证（三重）

| 切片 | 来源 | 校验结果 |
|---|---|---|
| `t.chk @0` | 第一个 .ab（offset 0） | ★ 通过 |
| `ab7bbf.bin` | 2A38CD1F @8,973,668 | ★ 通过 |
| `ab_f718b.bin` | 0BE16226 @69,694,803 | ★ 通过 |
| `ab_f718.bin` | 0BE16226 @69,610,740（**错误** offset） | ✗ 失败 |

⇒ ★★★ 校验通过/失败直接验证了 offset 的正确性！

## 49.2 头部字段（@8 起，大端）

```
@8   u16 compBI2
@10  u32 flags2
@14  u32 encFlags
@18  u32 size2
@22  u32 flags1
@26  u16 uncompBI1
@28  u32 unknown
@32  u16 uncompBI2
@34  u32 size1
@38  u16 compBI1
@40  u8  unknown
@41  u8[7] 填充（全 0）
@48  ??? （块表位置待定）
```

### 解扰公式（实测正确）

```c
compBI   = ror32(((compBI1 ^ compBI2 ^ 0xA121) << 16) | compBI2, 18) ^ 0xF74324EE;
uncompBI = ror32(((uncompBI1 ^ uncompBI2 ^ 0xA121) << 16) | uncompBI2, 18) ^ 0xF74324EE;
size     = rol64(((size1 ^ size2 ^ 0xDAD76848) << 32) | size2, 14) ^ 0xA4F1A11747816520ULL;
flags    = flags1 ^ flags2 ^ 0xA7F49310;
encFlags ^= flags2;
```

### ★ 验证：size == 文件大小（精确）

```
t.chk      第一个 .ab:  compBI=75   uncompBI=75   size=2180      (文件 2180? 需核对)
f718d7fb.ab           : compBI=113  uncompBI=125  size=315509    == 文件 315509 ✓
⇒ ★★★ size 字段精确等于 .ab 文件大小 ⇒ 头部解析完全正确！
```

## 49.3 待解决：块表位置

```
t.chk（第一个 .ab）@48: 4d f5 3c b2 ⇒ 解出 blocksCount=1（可能巧合）
f718d7fb.ab        @48: 58 03 f0 24 ⇒ 扫描 @8..300 无合理 blocksCount

⇒ 结论: @48 不是通用的块表位置，或块表结构/位置依赖其他字段
⇒ 需要: fluffy-dumper 或 AnimeStudio 的 bundle 内部解析实现
```

## 49.4 ★ 重要：我的 vfslist offset 字段修复（本轮突破）

```
问题: vfslist 解析 .blc 时【漏读 offset 字段】（位于 fe+40）
      改用 len 累加 ⇒ 所有偏移都有误差

修复: 补读 fe+40 的 i64 offset

三重验证:
  ① offset 完美连续:  off[i+1] == off[i] + len[i]  ✓
  ② max(off+len) == .chk 文件大小:
       2a38cd1f: 38,180,109  == 38,180,109   ✓
       798c1f6a: 279,106,208 == 279,106,208  ✓
       0be16226: 202,863,477 == 202,863,477  ✓
  ③ 正确 offset 的切片头校验通过，错误 offset 的失败  ✓
```

## 49.5 .blc file 条目结构（权威，来自 AnimeStudio VfsParser.cs）

```
fileNameLen(u16, LE) + fileName(str)
fileNameHash(i64)
fileChunkMd5(u128 = 16B)
fileDataMd5(u128 = 16B)
★ offset(i64)          ← 我之前漏读的
len(i64)
fileBlockType(u8)
useEncrypt(u8)
[ivSeed(i64)]          ← 仅当 useEncrypt != 0
[fileTag(i32)]         ← 仅当 codeVersion > 3
```

## 49.6 工具状态

```
✅ tools/vfs/vfslist.c    —— 已修复（补读 offset，fe+40）
✅ tools/vfs/abtool.c     —— .ab 头解析 + 块表/节点表尝试 + LZ4
✅ tools/vfs/vfsaes.c     —— 自定义 VFS AES（完整 SBox）
✅ tools/vfs/lz4blk.c     —— 原始 LZ4 块解压
✅ tools/vfs/blcfix.c     —— 更新 contentMD5 + CRC32
✅ tools/vfs/blcverify.c  —— .blc ↔ .chk 校验
✅ docs/48-vfs-crypto-reference.md
✅ docs/49-ab-container-format.md（本文）
```

## 49.7 下一步

```
[A] 抓 AnimeStudio 的 bundle 内部解析（UnityFS / SerializedFile）
[B] 抓 fluffy-dumper 的 Rust 实现（原始、最权威）
[C] 先走 Temp 路径确保可见成果，再回来做持久化
```

---

# 49.8 ★★★★★ 权威答案（来自 AnimeStudio/VFSFile.cs）

## 完整流程

```csharp
VFSFile(reader, path, game):
  ① reader.Endian = BigEndian
  ② VFSUtils.IsValidHeader()                  ← a/b 校验（我已实现 ✓）
  ③ reader.ReadBytes(8)                       ← 跳过 8 字节
  ④ m_Header = VFSUtils.ReadHeader()          ← 我已实现 ✓

  ⑤ ★★★ 块信息偏移（关键！）
       if (flags & BlocksInfoAtTheEnd) != 0:
           blockInfosOffset = size - compressedBlocksInfoSize
       else:
           if (encFlags >= 7) blockInfosOffset = 48
           else               blockInfosOffset = 40      ← ★ 40，不是 48！

  ⑥ 读 compressedBlocksInfoSize 字节

  ⑦ ★★★ 若 (flags & 0x3F) != 0（块信息被压缩+加密）:
       VFSUtils.DecryptBlock(blocksInfoBytes)      ← 稀疏解密
       LZ4.Instance.Decompress(...)                ← ★ 普通 LZ4
     否则: 直接用

  ⑧ 解析 blocks infos + directory infos（我已实现 ✓）

  ⑨ ★★★ 数据偏移
       dataOffset = (encFlags >= 7) ? 48 : 40
       if (flags & BlocksInfoAtTheEnd) == 0:
           temp = compressedBlocksInfoSize
           if (flags & BlockInfoNeedPaddingAtStart) != 0:
               temp = (temp + 15) & 0xFFFFFFF0
           dataOffset += temp

  ⑩ ReadBlocks: 对每个块
       压缩类型 = (int)blockInfo.flags        ← ★ 完整值，不掩码！
       case 0: 无压缩，直接读 uncompressedSize 字节
       case 5: 压缩:
           read compressedSize 字节
           VFSUtils.DecryptBlock(...)          ← 稀疏解密
           LZ4Inv.Instance.Decompress(...)     ← ★★★ LZ4Inv（不是普通 LZ4！）
```

## ★★★★★ 三处关键修正（我之前的错误）

| # | 我之前的做法 | ★ 正确做法 |
|---|---|---|
| ❶ | 块信息固定从 @48 读 | 看 `encFlags`：<7 用 **40**，>=7 用 48；也可能在文件末尾 |
| ❷ | 块信息未解压 | 若 `(flags & 0x3F) != 0`，需 **DecryptBlock + LZ4** |
| ❸ | 数据块用普通 LZ4 | ★ 用 **LZ4Inv**（Unity 的 LZ4 变体） |

## 数据块的 LZ4Inv

```
AnimeStudio/LZ4/ 目录下有 LZ4 和 LZ4Inv 两个实现
⇒ LZ4Inv 是 Unity 用的"另一种"LZ4（块格式相同，但对 64KB 窗口/字面量
   编码的处理不同，或用于小数据块）
⇒ 需要从 AnimeStudio/LZ4/LZ4Inv.cs 获取其实现
```

## 当前状态

```
✅ 头校验（a/b）       —— 已实现并三重验证
✅ 头部字段解扰        —— 已实现（size 精确匹配）
⚠️ 块信息偏移          —— 应改为 40（encFlags<7）
⚠️ 块信息解压          —— 需 DecryptBlock + LZ4
❌ 数据块解压          —— 需 LZ4Inv 实现
```

## 下一步

```
[A] 抓 AnimeStudio/LZ4/LZ4Inv.cs（LZ4Inv 的实现）
[B] 修正 abtool：块信息偏移 40、加 DecryptBlock+LZ4
[C] 抓 BundleFile.cs（看 IsValidHeader 后 ReadBytes(8) 的语义）
