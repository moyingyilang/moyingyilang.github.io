---
title: "52. ★ VFS 全链路打通（1.6.4，全部自有实现）"
description: "EFML4A 研究文档 · 52-vfs-full-chain（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 52.1 完整能力矩阵（全部实测验证）

| 环节 | 工具 | 状态 |
|---|---|---|
| ① .blc 解密 | ChaCha20(nonce=前12B, counter=1) | ✅ vfsfull.c |
| ② VFS 结构解析 | 270,435 条（8 字节 tag 修正） | ✅ vfsfull.c |
| ③ .ab 定位/提取 | 按 offset/len | ✅ |
| ④ .ab 容器解析 | 48B 头 + 块表 + 节点表 | ✅ abtool.c |
| ⑤ 块解压 | DecryptBlock + LZ4Inv | ✅ |
| ⑥ UnityFS 解包 | SerializedFile + .resS 导出 | ✅ abresS (C#) |
| ⑦ Texture2D 定位 | 名/尺寸/格式/m_StreamData | ✅ abtex (C#) |
| ⑧ 数据偏移定位 | m_StreamData.offset/size | ✅ |
| ⑨ 原始 ASTC 提取 | 65,536 字节 | ✅ |
| ⑩ ASTC 编码 | astcenc v5.7.0 | ✅ 自有编译 |

## 52.2 ★★★ 关键 BUG 修正（公开工具都不对）

```
EndfieldStudio/AnimeStudio 的 VfsParser:
  if (codeVersion > 3) {
      int tagRaw = ReadI32Le(span, ref cursor);   // ★ 只读 4 字节
  }

但 1.6.4 实测需要 【8 字节】（2 × i32）
⇒ 公开工具对 1.6.4 全部失效（抛索引越界）
⇒ 我的 vfsfull.c 是唯一正确的实现
```

## 52.3 ★★★★ 重大简化：VFSAES 加密 = 解密

```
VFSAES 解密:  pt = ct ^ AES_encrypt(prev)
VFSAES 加密:  ct = pt ^ AES_encrypt(prev)     ← 完全相同！

因为 prev（下一轮 IV）的派生只依赖 block = AES_encrypt(prev)，
与 ct/pt 无关 ⇒ 加密与解密是【同一个 XOR keystream 操作】
⇒ 加密 = 对明文再调用一次 vfs_decrypt_block()
```

## 52.4 目标资源（已完全定位）

```
纹理:      prts_sm2l3m5_eyemask
尺寸/格式: 256×256 ASTC_4x4
数据量:    65,536 字节

所在 .ab:  b9f6b1e125af334294db948d.ab (2,438,868 字节)
bundle 内: CAB-8dc35f4f8133495f0e872beba69ea890      (199,336, SerializedFile)
           CAB-8dc35f4f8133495f0e872beba69ea890.resS (5,505,024, 资源流)
数据位置:  .resS + 3,670,016，长度 65,536
```

## 52.5 纹理命名与格式规律（扫描 12,779 个 .ab 得出）

```
T_<类别>_<角色>_face_<编号>_<类型>
  _D (Diffuse)   576x576  ASTC_6x6
  _N (Normal)    512x512  ASTC_4x4
  _P (Param)     560x560  ASTC_5x5
  _E (Emission)  288x288  ASTC_6x6

PRTS 终端资源:  prts_*  256x256 ASTC_4x4
```

## 52.6 ★ 剩余工作：自研打包器

```
AnimeStudio 是【只读】工具（LZ4 系列只有 Decompress，无 Save 方法）
⇒ 重打包必须自研

需要:
① LZ4Inv 压缩器
   · 解压器已有（token 隔位 + offset 大端）
   · 最简方案: 「全字面量」模式（litLen=15 扩展，无匹配）⇒ 保证合法
   · 膨胀后用零填充对齐到原 compressedSize
② VFSAES 加密
   · ★ 等价于解密（见 52.3）⇒ 直接复用 vfs_decrypt_block()
③ .ab 保持等长
   · 若总长不变 ⇒ .chk 长度不变 ⇒ .blc 只需更新 md5
```

## 52.7 工具清单（全部自有）

```
C:    vfsfull.c / vfsaes.c / lz4inv.c / lz4blk.c / abtool.c / blcfix.c
C++:  astcenc v5.7.0（ARM 源码编译）
C#:   abdump / abdump2 / abtex / abscan / abresS（UnityFS 解析，仅用于分析）
```

## 52.8 合规红线（始终遵守）

```
✅ 只读观察优先 · 等长原地替换 · 不修改游戏数值/存档
✅ 不用于竞技作弊 · 不散布游戏资源 · 不实现 ACE 绕过
```

---

## 52.9 ★ 写入路径的完整技术细节（Round 113-116 成果）

### .ab 块结构（实测）

```
dataStart = 文件末尾 - sum(comp) = 384
  ⇒ = 48(头) + align16(326 compBI) = 48 + 336 = 384
  ⇒ ★ 末尾校验完美吻合（2,438,868 == 2,438,868）

每块解压 131,072 字节（128KB）
块 i 的文件偏移 = dataStart + sum(comp[0..i-1])
```

### 目标纹理的精确位置

```
纹理: prts_sm2l3m5_eyemask (256x256 ASTC_4x4, 65,536 字节)
所在 .ab: b9f6b1e125af334294db948d.ab (2,438,868 字节)
  · 全局偏移 402,297,291（跨 chunk）
  · 所在 chunk: chunk3 (798C1F6A.chk, 279,106,208 字节)
  · 本地偏移: 402,297,291 - 195,487,130 = 206,810,161

.ab 内完整流 = SerializedFile(199,336) + .resS(5,505,024) = 5,704,360
纹理在完整流中的偏移 = 199,336 + 3,670,016 = 3,869,352
  ⇒ 落在块 29（块内偏移 68,000），跨到块 30 的前 2,464 字节
```

### 原地替换的实测结果

```
块29: 131,072 → 37,500 (原 63,477)  节省 25,977  [简单测试图案]
块30: 131,072 → 59,453 (原 58,523)  超出    930  [v3 压缩器]

⇒ ★ 净变化 -25,047 字节（可缩短 .ab）
⇒ 但块 30【单独】超出 930 字节 ⇒ 需空间再平衡（更新块表）
```

### 加密的对称性（关键简化）

```
VFSAES 解密:  pt = ct ^ AES_encrypt(prev)
VFSAES 加密:  ct = pt ^ AES_encrypt(prev)     ← 完全相同！
⇒ 加密 = 再调一次 VFSUtils.DecryptBlock()
⇒ 已在 C# 中验证可用
```

### 压缩器

```
lz4invcomp.c   (v1, 简单 hash):        45.60%
lz4invcomp2.c  (v2, CHAIN=8):          45.55%/44.51%
lz4invcomp3.c  (v3, CHAIN=16, HBITS=17): 45.36%
原始（游戏压缩器）:                      44.65%
⇒ 差距约 1.6%，需块表重建或继续优化
```

### ★ 剩余的最后一步

```
方案A: 空间再平衡（更新块表）
  · 块29 用新尺寸（37,500），块30 用新尺寸（59,453）
  · 后续块前移；更新块表的 2 个 comp 值
  · 重新压缩+加密 blocks-info（原 326 字节）
  · .ab 缩短 25,047 字节

方案B: 追加 + 更新 .blc
  · 重建整个 .ab（44 块重新压缩）
  · 追加到 798C1F6A.chk 末尾
  · 更新 .blc 中该条目的 offset/len + contentMD5 + CRC32
  · 其他条目不受影响

方案C: 继续优化压缩器至 ≤44.65%
  · 需 lazy matching 或更优的匹配策略
```

### 工具清单（写入相关）

```
C:    lz4invcomp.c / lz4invcomp2.c / lz4invcomp3.c（压缩器）
      vfsaes.c（加密=解密）
      blcfix.c（更新 .blc md5 + CRC32）
C#:   abpatch / abwrite / aboffs（块定位与替换）
```

---

## 52.10 ★ 块信息的完整混淆公式（Round 123-125）

### 来源

`VFSUtils.ReadBlocksInfos`（EndfieldStudio 本地克隆）

### 读取（解扰）

```csharp
// ① blocksCount —— ★ 小端读，然后恢复大端
reader.Endian = LittleEndian;
encCount = ReverseEndianness(reader.ReadUInt32() ^ 0x8A7BF723);
reader.Endian = originalEndian;
low = encCount & 0xFFFF; high = encCount >> 16;
blocksCount = RoR32(((low^high)<<16)|low, 18) ^ 0x91CE0A4F;

// ② 每块（10 字节，★ 大端读）
a=ReadU16(); b=ReadU16(); c=ReadU16();
encFlags = ReadU16() ^ 0x9CD6;
d=ReadU16();
a0 = encFlags & 0xFF; a1 = encFlags >> 8;

flags            = c ^ RotL16(((a0^a1)<<8)|a0, 14) ^ 0x523F;
uncompressedSize = RoR32(((a^c^0xA121)<<16)|c, 18) ^ 0xF74324EE;
compressedSize   = RoR32(((b^d^0xA121)<<16)|d, 18) ^ 0xF74324EE;
```

**⇒ 与我的 `abtool.c` 完全一致（含 16 位轮转修正）✓**

### 写入（再混淆）—— 逆公式

```csharp
// ① blocksCount（小端）
x = Rol32(blocksCount ^ 0x91CE0A4F, 18);
lo = x & 0xFFFF; hi = (x>>16) & 0xFFFF;
encCount = ((lo^hi)<<16) | lo;
写小端: encCount ^ 0x8A7BF723

// ② 每块（大端）—— ★ 注意 c 的耦合
xu = Rol32(uncompressedSize ^ 0xF74324EE, 18);
c  = xu & 0xFFFF;
a  = ((xu>>16)&0xFFFF) ^ c ^ 0xA121;

xc = Rol32(compressedSize ^ 0xF74324EE, 18);
d  = xc & 0xFFFF;
b  = ((xc>>16)&0xFFFF) ^ d ^ 0xA121;

xf = Rol16(flags ^ c ^ 0x523F, 14);
a0 = xf & 0xFF; a1 = (xf>>8)&0xFF;
encFlags = ((a1<<8)|a0) ^ 0x9CD6;
```

### ★ 关键发现

```
1. DecryptBlock 是【对合】的（加密 = 解密）—— 已验证
2. blocksCount 用【小端】读，每块字段用【大端】读（混合字节序）
3. 块信息的内容【整体是混淆的】，必须逐字段解扰/再混淆
4. 节点表的混淆方式【尚未查明】（当前阻塞点）
```

### 当前阻塞点

```
重建后的 .ab 自验失败: "blocksCount too large"
⇒ 可能原因:
   ① 节点表的混淆方式未知（我按明文写入）
   ② blocksCount 的字节序写入有误
   ③ 或 compBI 字段与块信息实际长度的对应关系

⇒ 已实现 abfinal（C#），逆公式齐备，仅差节点表部分
```
