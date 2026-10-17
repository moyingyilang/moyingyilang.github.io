---
title: "50. ★ VFS 结构彻底破解（自有 C 实现，1.6.4 实测）"
description: "EFML4A 研究文档 · 50-vfs-structure-cracked（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 50.1 决定性突破：`.blc` 全字段解析正确

```
$ vfsfull b.blc
  .blc: 32725140 字节
  解密后前 16 字节: 05 00 00 00 8d 73 9d 01 06 00 42 75 6e 64 6c 65
                    ↑version=5    ↑unk        ↑strLen=6 "Bundle"
  CRC32: 存储=0xd5622349 实算=0xd5622349 ✓
  version=27095949 codeVersion=5
  group="Bundle" hash=0xffffffffe2d86470 fileInfoNum=270435
  chunksLen=17850126880 blockType=11 chunkCount=46

  chunk0: len=38180109 bt=11 files=221
    file0: "Data/Bundles/Android/main/01cce96ce610fbfbaaf86091.ab" off=0    len=2180
    file1: "Data/Bundles/Android/main/ebf8ab4b28143cf9634ab003.ab" off=2180 len=2680
    file2: "Data/Bundles/Android/main/6eab2edab11a98a751b6288f.ab" off=4860 len=2692
  chunk1: len=2607251  files=25
  chunk2: len=154699770 files=1056
  chunk3: len=279106208 files=4656
  ⇒ 270,435 条，与 CLI 的 fileInfoNum 完全一致
```

## 50.2 ★★★ 关键 BUG：`codeVersion > 3` 是 **8 字节**，不是 4

```
参考 VfsParser.cs 写:
  if (codeVersion > 3) { mainTag = ReadI32Le(); }    // 看似 4 字节

实测（codeVersion=5）chunk 记录字节布局:
  @41..56  md5Name(16)
  @57..72  contentMd5(16)
  @73..80  chunkLength(8)
  @81      blockType(1) = 0x0b
  @82..85  0x00000000        ┐
  @86..89  0x00000000        ┘ ★ 8 字节，不是 4
  @90      fileCount(4) = 221
  @94      nameLen(2) = 53
  @96      "Data/Bundles/Android/main/..."   ← 第一个文件名

⇒ ★★★★★ 必须跳过 8 字节（2 × i32），否则 fileCount 读到 0 而错位
⇒ 修正后一切正确
```

## 50.3 ChaCha20 的两个要点（否则 CRC 必失败）

```
① nonce = .blc 的【前 12 字节】
② counter 从 【1】 开始（不是从数据里读！）

VfsLoader.cs:
  Span<byte> nonce = blockData[0..12];
  var cipher = new ChaCha20(_chachaKey, nonce, 1);   ← counter=1
```

## 50.4 完整 `.blc` 结构（权威，已验证）

```
[0..12)        nonce（不加密）
[12..len)      ChaCha20(key, nonce, counter=1) 密文
                  解密后:
  version(i32 LE)        若 <11 则这是 codeVersion，再读 version(i32)
                         ≥11 则 codeVersion=3, version=该值
  unk(i32)
  strLen(u16) + groupName(str)
  groupHash(i64)
  fileInfoNum(i32)
  chunksLen(i64)
  blockType(u8)
  chunkCount(i32)
  每个 chunk:
    md5Name(16) contentMd5(16) chunkLength(i64) blockType(u8)
    [8 字节 if codeVersion>3]
    fileCount(i32)
    每个 file:
      nameLen(u16) + name
      nameHash(i64)
      chunkMd5(16) dataMd5(16)
      offset(i64) len(i64) blockType(u8) encrypt(u8)
      [ivSeed(i64) if encrypt]
      [8 字节 if codeVersion>3]
[最后 4 字节]  CRC32(解密体[0..len-4))
```

## 50.5 工具

```
tools/vfs/vfsfull.c   —— ★ 严格实现 VfsParser（含 8 字节修正），已验证
tools/vfs/blcfix.c    —— 更新 contentMD5 + CRC32
tools/vfs/vfsaes.c    —— VFS AES（VFSAES 变形）
tools/vfs/lz4inv.c    —— LZ4Inv（token 隔位 + offset 大端）
```

## 50.6 下一步

```
[A] 用正确的 offset/len 切出 .ab
[B] 解析 .ab: 48 字节头 → 块表 → 节点表 → 数据块
[C] 数据块: flags=5 ⇒ DecryptBlock + LZ4Inv
[D] 解出后应得到 UnityFS/SerializedFile ⇒ 定位 Texture2D
```

---

## 50.7 ★★★ 为什么公开工具对 1.6.4 失效（重大发现）

```
EndfieldStudio/AnimeStudio.Endfield/VfsParser.cs:

  FileTag mainTag;
  if (codeVersion > 3) {
      int tagRaw = ReadI32Le(span, ref cursor);        // ★ 只读 4 字节
      mainTag = BlockTypes.FileTagFromByte((byte)tagRaw);
  }
  int fileCount = ReadI32Le(span, ref cursor);

  ... file 循环末尾同样:
  if (codeVersion > 3) {
      int tagRaw = ReadI32Le(span, ref cursor);        // ★ 只读 4 字节
  }

⇒ ★★★★★ 但 1.6.4 实测需要 【8 字节】（2 × i32）
⇒ 因此 CLI 解析 1.6.4 的 .blc 会错位:
     · fileCount 读到 0（实际 221）
     · 下一个 chunk 全部错位
     · 最终抛 "Specified argument was out of the range of valid values"
⇒ 这解释了 CLI 一直失败的原因

★ 结论: 公开工具针对的是更早版本（tag 只有 4 字节），
        1.6.4 把 tag 扩展到了 8 字节。
        ★ 我的 vfsfull.c 才是正确的实现。
```

## 50.8 实测对照

| 项目 | EndfieldStudio CLI | 我的 vfsfull.c |
|---|---|---|
| InitBundle fileInfoNum | files=0 ✗ | — |
| Bundle fileInfoNum | 抛异常 ✗ | 270435 ✓ |
| chunk0 files | — | 221 ✓ |
| chunk0 file0 | — | `01cce96ce610fbfbaaf86091.ab` off=0 len=2180 ✓ |
| CRC32 校验 | — | ✓ 通过 |
| 结论 | 版本不匹配 | ★ 正确 |
