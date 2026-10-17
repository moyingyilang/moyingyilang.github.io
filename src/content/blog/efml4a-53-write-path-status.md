---
title: "53. ★ 写入路径实现状态（Round 100-139）"
description: "EFML4A 研究文档 · 53-write-path-status（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 53.1 已达成的完整能力

### 读取链路（100% 验证）

| 环节 | 实现 | 验证方式 |
|---|---|---|
| .blc 解密 | ChaCha20(nonce=前12B, counter=1) | CRC32 ✓ |
| VFS 结构解析 | codeVersion>3 需 **8 字节** tag | 270,435 条与 CLI 一致 |
| .ab 定位/提取 | 按 offset/len | 141,142 个文件 |
| .ab 容器解析 | 48B 头 + 压缩块信息 + 数据块 | dataStart=384，末尾吻合 |
| UnityFS 解包 | SerializedFile + .resS | abresS (C#) |
| Texture2D 定位 | 名/尺寸/格式/m_StreamData | abtex (C#) |
| 全量扫描 | 12,779 个 .ab | abscan (C#) |

### 关键格式常量（全部实测）

```
.blc:  [0..12) nonce | [12..len) ChaCha20(key, nonce, counter=1)
       解密体末尾 4 字节 = CRC32

.ab:   @0..3   a（头校验输入）
       @4..7   b = 4*(a^0x4A92F0CD)&0xFFFF0000 ^ ror32(a^0x4A92F0CD,14) ^ 0xD8B1E637
       @8..39  字段（compBI2/flags2/encFlags/size2/flags1/uBI1/unk/uBI2/size1/cBI1）
       @40..47 填充
       @48     压缩块信息（DecryptBlock + 标准 LZ4）
       @48+align16(compBI)  数据块（DecryptBlock + LZ4Inv，每块 131,072 字节）

混淆公式（读）:
  compBI   = ror32(((cBI1^cBI2^0xA121)<<16)|cBI2, 18) ^ 0xF74324EE
  uncompBI = ror32(((uBI1^uBI2^0xA121)<<16)|uBI2, 18) ^ 0xF74324EE
  size     = rol64(((size1^size2^0xDAD76848)<<32)|size2, 14) ^ 0xA4F1A11747816520
  flags    = flags1 ^ flags2 ^ 0xA7F49310

块信息:
  blocksCount: 【小端读】+ bswap32(^0x8A7BF723) + ror18 ^ 0x91CE0A4F
  每块(10B, 大端): a,b,c,encFlags(^0x9CD6),d
    flags = c ^ rol16(((a0^a1)<<8)|a0, 14) ^ 0x523F
    uncomp = ror32(((a^c^0xA121)<<16)|c, 18) ^ 0xF74324EE
    comp   = ror32(((b^d^0xA121)<<16)|d, 18) ^ 0xF74324EE
  节点表: nodesCount(小端+bswap32) + 每节点(a^0x8E06A9F8,b,c,d,名字(每字节^=(j^0x97)),e)
    flags  = ror32(((a1^a0)<<16)|a0,18) ^ 0xF13927C4 ^ b
    offset = rol64(((d^c^0xDAD76848)<<32)|c,14) ^ 0xA4F1A11747816520
    size   = rol64(((b^e^0xDAD76848)<<32)|e,14) ^ 0xA4F1A11747816520
```

## 53.2 逆公式（写入用，已验证）

```
header（6/6 往返通过）:
  x = rol32(compBI ^ 0xF74324EE, 18); cBI2 = x&0xFFFF; cBI1 = ((x>>16)&0xFFFF)^cBI2^0xA121
  （uncompBI 同理；size 用 rol64）

每块（4/5 字段往返通过）:
  xu = rol32(uncomp ^ 0xF74324EE, 18); c = xu&0xFFFF; a = ((xu>>16)&0xFFFF)^c^0xA121
  xc = rol32(comp   ^ 0xF74324EE, 18); d = xc&0xFFFF; b = ((xc>>16)&0xFFFF)^d^0xA121
  xf = ror16(flags ^ c ^ 0x523F, 14);          ★ ROR16（不是 ROL）
       p0 = xf&0xFF; a1 = ((xf>>8)&0xFF)^p0;  ★ a1 = 高位 ^ a0
       encFlags = ((a1<<8)|p0) ^ 0x9CD6

blocksCount / nodesCount:
  x = rol32(count ^ 0x91CE0A4F, 18); lo = x&0xFFFF; hi = ((x>>16)&0xFFFF)^lo
  ec = ((lo^hi)<<16)|lo
  raw = bswap32(ec) ^ 0x8A7BF723              ★ 必须 bswap32
  写小端
```

## 53.3 加解密对称性（关键简化）

```
VFSAES:  pt = ct ^ AES_encrypt(prev)
         ct = pt ^ AES_encrypt(prev)     ← 完全相同
⇒ VFSUtils.DecryptBlock() 既是解密器也是加密器（已验证对合）
```

## 53.4 目标资源

```
纹理:      prts_sm2l3m5_eyemask（普瑞赛斯眼罩）
尺寸/格式:  256×256 ASTC_4x4（65,536 字节）
所在 .ab:  b9f6b1e125af334294db948d.ab（2,438,868 字节）
所在 .chk: 798C1F6A.chk @206,810,161（全局偏移 402,297,291）
.ab 内:    SerializedFile(199,336) + .resS(5,505,024) = 5,704,360
流偏移:    199,336 + 3,670,016 = 3,869,352（块 29，块内 68,264）
块结构:    44 块，每块 131,072（最后一块 68,264），全 flags=5
```

## 53.5 工具清单（全部自有）

```
C:    tools/vfs/vfsfull.c      .blc 全解析（1.6.4 唯一正确）
      tools/vfs/vfsaes.c       VFSAES（对合）
      tools/vfs/lz4inv.c       LZ4Inv 解压
      tools/vfs/lz4blk.c       标准 LZ4 解压
      tools/vfs/lz4invcomp{,2,3}.c  LZ4Inv 压缩（44.5%-45.6%）
      tools/vfs/lz4comp.c      标准 LZ4 压缩
      tools/vfs/abtool.c       .ab 头/块表/节点表
      tools/vfs/blcfix.c       .blc md5 + CRC32
      tools/vfs/astcenc_dl.c   dlopen 调 astcenc（备用）
C++:  ref/astc-encoder/build/Source/astcenc-native  v5.7.0
C#:   ref/{abdump,abdumptex,abtex,abscan,abresS,aboffs,abfinal}  UnityFS 解析/重建
```

## 53.6 ★ 剩余问题（Round 139）

```
.ab 重建的【内容对齐】:
  · 结构正确（blocksInfo 混淆明文 567 字节 = 原值）
  · 流长度正确（5,704,360）
  · 但重建后读回的流与修改后的流有【约 7 字节的错位】
    buf[9]=0x16 对应 b2[2]=0x16
  · 目标区 b2 全零（说明该区数据未正确落到流中）

⇒ 可能原因:
   ① blocksInfo 的 uncompressedSize 与实际不符
   ② 或最后一个块的边界
   ③ 或反混淆后的 blocksInfo 内容仍有一处不对（b 字段差异是预期的，
      因为我的重压缩长度与原不同）
```

## 53.7 后续步骤

```
① 修正 .ab 重建的内容对齐
② 写回 798C1F6A.chk（.ab 变长 ⇒ 追加到末尾 + 更新 .blc 的 offset/len）
③ blcfix 更新 .blc 的 fileDataMd5 + contentMD5 + CRC32
④ 游戏内验证（普瑞赛斯的眼睛/眼罩）
```

---

## 53.8 Round 140-145 的补充发现

### 已验证正确的组件（多值域往返）

```
header 混淆/逆混淆:     6/6 往返通过
blocks 混淆/逆混淆:     多值域往返全部通过
  · a/b/c/d 逆公式 ✓
  · encFlags: ror16 + (a1 = 高位 ^ a0) ✓
  · blocksCount/nodesCount: 必须 bswap32 ✓
LZ4Inv 压缩器 ↔ 游戏解压器: 0 字节差异 ✓
标准 LZ4 压缩器: 往返通过 ✓
VFSAES 对合（加密=解密）: 双次调用还原 ✓
astcenc v5.7.0: 实测转换正确 ✓
```

### .ab 重建的当前状态

```
✅ 块表元数据读回正确（comp 值与实际压缩长度一致）
✅ 结构正确（blocksInfo 混淆明文 567 字节 = 原值）
✅ 长度正确（流 5,704,360）
✗ 流组装有差异（首字节就开始不同）

⇒ 尝试过:
   · blocksInfo 填充到 16 字节对齐（dataStart=384）
   · blocksInfo 不填充（dataStart=379）
   两者都失败 ⇒ 不是填充问题

⇒ 剩余可能:
   · abfinal 里 blocksData 的收集顺序与实际写入顺序不一致
   · 或 buf 与 blocksData 的对应关系有偏差（如 blocksData[i] 用了错误的 buf 区间）
   · 或 VFSFile 读块时的某个前置状态影响
```

### 关键代码路径（abfinal）

```
1. VFSFile 解析 → blocks[] + nodes[] + fileList
2. full = concat(fileList) = 5,704,360
3. buf = full; buf[target..] = newData
4. for i in blocks: blk = buf[i*131072 .. ]; blocksData[i] = lz4invcomp3(blk)
5. blocksInfo = 混淆结构（含新的 comp/uncomp）
6. biComp = lz4comp(blocksInfo); biEnc = DecryptBlock(biComp)
7. out = header(48) + biFinal + blocksData[]
```

### 下一步

```
① 打印 abfinal 里每个 blocksData[i] 的长度，与块表读回值逐一对比
   ⇒ 若一致 ⇒ 问题在数据本身（buf 的切分）
   ⇒ 若不一致 ⇒ 问题在写入顺序
② 或改用「只重压受影响的块 + 其余原样复制」的最小改动方案
   （原样复制可排除重压引入的差异）
```

---

## 53.9 ★ 最小改动方案的突破（Round 146-149）

### 方法

```
不再重压全部 44 块，而是：
  ① 只重压【受纹理替换影响】的块（29、30）
  ② 其余 42 块【原样复制】原始压缩字节
  ③ blocksInfo 用新的 comp/uncomp 值重新混淆+压缩+加密
```

### 结果

```
★ 首个差异从【字节 2】推进到【3,801,090】（= 块 29 的起点 + 2）
⇒ 块 0~28 现在【字节级完全一致】！

⇒ 证明:
  ✅ .ab 头部布局正确
  ✅ blocksInfo 混淆/逆混淆公式正确
  ✅ blocksCount/nodesCount 的 bswap32 修正正确
  ✅ 原样复制的块布局正确
  ✗ 只有【重压的块 29】有偏差
```

### 结论：LZ4Inv 压缩器的边界 bug

```
用【原始】块 29 测试: 压缩 → 游戏解压 → 0 字节差异 ✅
用【修改后】块 29:    压缩 → 游戏解压 → 有差异 ✗

⇒ 压缩器在特定输入上产生不可正确解压的流
⇒ 典型 LZ4 压缩器边界问题:
   · litLen/matchLen 的 15 扩展字节处理
   · 或 offset 越界（> 65535）
   · 或最后一个 match 超出输入末尾
   · 或 token 位交错的某位组合
```

### 语言红线（按用户指示更新）

```
✅ 允许: C / C++ / Rust（研究阶段）
❌ 禁止: Python（全链路，已彻底清除）

当前 Python 状态:
  仓库 .py = 0，scratch .py = 0，脚本 python = 0
  .gitignore 已排除 *.py / *.pyc / __pycache__
```

### 下一步（最后一步）

```
① 修 LZ4Inv 压缩器的边界 bug
   · 用 C 写一个「压缩 → 解压 → 逐字节比对」的自测工具
   · 对修改后的块 29 定位第一个不同的输出字节
   · 反推是哪种 token/match 组合出错
② 修好后: 写回 798C1F6A.chk + 更新 .blc + 游戏验证
```
