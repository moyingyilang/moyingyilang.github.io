---
title: "48. Endfield VFS 加解密参考（来自公开项目 AnimeStudio）"
description: "EFML4A 研究文档 · 48-vfs-crypto-reference（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 48.1 来源

- **AnimeStudio** — https://github.com/Variante/AnimeStudio
  · `AnimeStudio/Crypto/VFSUtils.cs` — VFS 结构解扰 + 数据解密
  · `AnimeStudio/Crypto/CryptoHelper.cs` — 密钥常量
- **FkArkEnd** — https://github.com/shiikwi/FkArkEnd
  · Beyond.VFS: 解密 .blc → .json，解包 .chk
  · ResConv: 解包 .pck / TableCfg.bytes → json / 解密 .lua / manifest.hgmmap
- **EndfieldStudio** — https://github.com/EIHRTeam/EndfieldStudio
  · VFS 解密 + UnityFS 去混淆 + 资源解码
- **3dmigoto-arknights-endfield** — https://github.com/wakka810/3dmigoto-arknights-endfield

## 48.2 ★ 关键结论：.chk 是【加密】的

```
之前我的错误：直接把 mod 数据（明文）写进 .chk
⇒ 破坏了【加密流】⇒ 游戏解密失败 ⇒ raise() 崩溃（tombstone_10）
⇒ 这解释了所有「数据加载失败」和运行期崩溃！

正确做法：
  ① 解密 .chk（自定义 AES）
  ② 解包内部 UnityFS
  ③ 替换纹理
  ④ 重新加密 ⇒ 写回
```

## 48.3 VFS 加密常量（Arknights: Endfield）

```c
/* AES 密钥（16 字节） */
static const uint8_t VFSAESKey[16] = {
    0x3A,0xF1,0x8C,0x47,0xB2,0x09,0x6D,0xEE,
    0x51,0x24,0x90,0x7C,0x18,0xD3,0xA4,0x62
};

/* AES IV（16 字节） */
static const uint8_t VFSAESIV[16] = {
    0xC7,0x12,0x5E,0xA9,0x04,0xDB,0x33,0x88,
    0xF2,0x0E,0x77,0x49,0x65,0xBA,0x1C,0x93
};

/* 自定义 SBox（256 字节）—— 见 48.5 */
static const uint8_t VFSAESSBox[256] = { ... };

/* IV 派生的 XOR 密钥 */
#define VFS_XOR_KEY 0xF19AB7752CDD0196ULL
```

## 48.4 头部解扰算法（ArknightsEndfield）

```c
/* 从 .chk 读出的原始字段（BE） */
compressedBlocksInfoSize2, flags2, encFlags, size2,
flags1, uncompressedBlocksInfoSize1, _, uncompressedBlocksInfoSize2,
size1, compressedBlocksInfoSize1, _

/* 解扰 */
compressedBlocksInfoSize = BitConcat((u16)(c1 ^ c2 ^ 0xA121), c2);
compressedBlocksInfoSize = RotateRight(compressedBlocksInfoSize, 18) ^ 0xF74324EE;

uncompressedBlocksInfoSize = BitConcat((u16)(u1 ^ u2 ^ 0xA121), u2);
uncompressedBlocksInfoSize = RotateRight(uncompressedBlocksInfoSize, 18) ^ 0xF74324EE;

size = BitConcat(size1 ^ size2 ^ 0xDAD76848, size2);
size = RotateRight(size, 18) ^ 0xA4F1A11747816520ULL;

encFlags ^= flags2;
flags = flags1 ^ flags2 ^ 0xA7F49310;
```

## 48.5 数据解密（DecryptBlock）★ 核心

```
若 buffer.Length <= 256:
    buffer = VFSAES.Decrypt(buffer)
否则:
    numBlocksFloor = length / 16
    step = 256 / numBlocksFloor   （若 numBlocksFloor > 256 则 step = 1）
    ① 从 buffer 里【按 16 字节步长抽取】前 256 字节到 decBuffer
    ② decBuffer = VFSAES.Decrypt(decBuffer)
    ③ 把 decBuffer 的对应部分写回 buffer 的 i*16 位置
```

### VFSAES.Decrypt（自定义 AES 的 CBC-like 模式）

```
previous = IV
for each 16-byte ciphertext block ct:
    block = EncryptBlock(previous)        /* ★ 注意：是【加密】previous！ */
    pt[i] = ct[i] ^ block[i]              /* keystream = AES_encrypt(previous) */
    /* 派生下一个 IV */
    count = 0
    for i in 0..15:
        shiftSrc = XORKey >> (count & 0x38)
        temp = block[i] ^ (31 * i) ^ (byte)shiftSrc
        count += 8
        temp = ((temp >> 5) | (8 * temp)) & 0xFF     /* 循环移位 */
        nextIv[i] = SBox[temp]
    previous = nextIv
```

### EncryptBlock（标准 AES-128 结构，但用自定义 SBox）

```
keyMats = ExpandKey()   /* 标准 AES 密钥扩展，用自定义 SBox */
state = BytesToMatrix(plaintext)
AddRoundKey(state, keyMats[0])
for r in 1..9:
    SubBytes(state); ShiftRows(state); MixColumns(state); AddRoundKey(state, keyMats[r])
SubBytes(state); ShiftRows(state); AddRoundKey(state, keyMats[10])
return MatrixToBytes(state)
```

**注意 ShiftRows 的实际实现（与标准 AES 的行移位不同）：**
```c
// 第 1 列：row0←row1, row1←row2, row2←row3, row3←row0
(s[0][1], s[1][1], s[2][1], s[3][1]) = (s[1][1], s[2][1], s[3][1], s[0][1]);
// 第 2 列：row0←row2, row1←row3, row2←row0, row3←row1
(s[0][2], s[1][2], s[2][2], s[3][2]) = (s[2][2], s[3][2], s[0][2], s[1][2]);
// 第 3 列：row0←row3, row1←row0, row2←row1, row3←row2
(s[0][3], s[1][3], s[2][3], s[3][3]) = (s[3][3], s[0][3], s[1][3], s[2][3]);
```

## 48.6 块信息解扰（ReadBlocksInfos）

```c
encCount = ReverseEndianness(ReadU32() ^ 0x8A7BF723);   /* 小端读 */
low = (u16)encCount; high = (u16)(encCount>>16);
blocksCount = BitConcat(low ^ high, low);
blocksCount = RotateRight(blocksCount, 18) ^ 0x91CE0A4F;

/* 每块 5 个 u16: a, b, c, encFlags(^0x9CD6), d */
a0 = encFlags & 0xFF; a1 = encFlags >> 8;
flags = BitConcat(a0 ^ a1, a0);
flags = c ^ RotateLeft(flags, 14) ^ 0x523F;

uncompressedSize = BitConcat(a ^ c ^ 0xA121, c);
uncompressedSize = RotateRight(uncompressedSize, 18) ^ 0xF74324EE;

compressedSize = BitConcat(b ^ d ^ 0xA121, d);
compressedSize = RotateRight(compressedSize, 18) ^ 0xF74324EE;
```

## 48.7 目录/节点解扰（ReadDirectoryInfos）

```c
encCount = ReverseEndianness(ReadU32() ^ 0x5DE50A6B);
low/high ⇒ nodesCount = RotateRight(BitConcat(low^high, low), 18) ^ 0xE4C1D9F2;

/* 每个节点 */
a = ReadU32() ^ 0x8E06A9F8;
b = ReadU32(); c = ReadU32(); d = ReadU32();
name = ReadBytes 直到 0（最多 64）
for j: bytes[j] ^= (byte)((j ^ 0x97) & 0xFF)      /* ★ 文件名解扰 */
e = ReadU32();

a0 = (u16)a; a1 = (u16)(a>>16);
flags = BitConcat(a1 ^ a0, a0);
flags = RotateRight(flags, 18) ^ 0xF13927C4 ^ b;

offset = BitConcat(d ^ c ^ 0xDAD76848, c);
offset = RotateLeft(offset, 14) ^ 0xA4F1A11747816520ULL;

size = BitConcat(b ^ e ^ 0xDAD76848, e);
size = RotateLeft(size, 14) ^ 0xA4F1A11747816520ULL;
```

## 48.8 头部有效性校验（IsValidHeader）

```c
a = ReadU32 (BE); b = ReadU32 (BE);
c1 = 4 * (a ^ 0x4A92F0CD) & 0xFFFF0000;
c2 = RotateRight(a ^ 0x4A92F0CD, 14);
c3 = c1 ^ c2 ^ 0xD8B1E637;
return b == c3;
```

## 48.9 行动方案（修正后）

```
① 用 VFS 密钥解密 .chk 的相关块
② 得到 UnityFS / SerializedFile 结构
③ 定位 Texture2D 对象（m_Width/m_Height/m_TextureFormat/m_ImageData）
④ 把 mod 的 BC7 转成【目标格式】（BC7 或 ASTC，需确认）
⑤ 替换 + 重新加密 + 写回
⇒ 这样才不破坏加密流
```

## 48.10 关键教训（写入准则）

```
★ .chk 是【加密】的，不是明文！
  我之前的「直接替换明文」必然破坏加密流 ⇒ 游戏解密失败 ⇒ 崩溃/校验失败

★ 以后遇到二进制格式，先搜【已有开源实现】
  · 老黄/社区已有完整工具链（AnimeStudio / FkArkEnd / EndfieldStudio）
  · 自己硬啃成本高且易错
```
