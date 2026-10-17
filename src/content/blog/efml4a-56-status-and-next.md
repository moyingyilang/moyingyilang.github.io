---
title: "56. 当前状态与技术结论（Round 170-171）"
description: "EFML4A 研究文档 · 56-status-and-next（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 56.1 ★ 已 100% 确证的部分

### 容器链路（字节级验证）

```
全流对比（UI_VFXbase 补丁）:
  原始流 = 1,054,620 字节
  补丁流 = 1,054,620 字节             ✓ 长度一致
  首个差异 @6045（= 目标区起点 6044）  ✓ 完全吻合
  ⇒ 除目标纹理区外【字节级完全一致】

⇒ ★ 容器重建、压缩、加密、混淆全部正确，无任何污染
```

### 写入链路（游戏接受）

```
① .chk 原地等长替换（同偏移同长度）
② blcfix 更新 chunk contentMD5 + CRC32
③ blcsetdata 更新 file dataMd5
④ 游戏启动 → 无「数据加载失败」、无崩溃、无 tombstone
```

### 关键格式常量（全部实测）

```
.blc 组名 = "Bundle"（main）/ "InitBundle"（启动初始化）
  · 启动时游戏【只加载 InitBundle】(0CE8FA57 组)
  · InitBundle: 1075 个文件 @ Data/Bundles/Android/initial/*.ab

.blc 文件条目布局:
  nameLen(u16)+name | nameHash(8) | chunkName(16) | dataMd5(16)
  | offset(i64) | len(i64) | blockType(u8) | encrypt(u8) [| ivSeed(i64)]

.blc chunk 条目: md5Name(16) + contentMD5(16) + off(8) + len(8) + bt(1) + enc(1)
  · md5Name == chunk 文件名（如 2A38CD1F...chk）

dataMd5 == 该 .ab 文件的完整 md5 ✓（已验证）
contentMD5 == 该 .chk 文件的完整 md5 ✓
```

## 56.2 ⚠️ 未解决的问题

```
现象: 替换 UI_VFXbase(1024×1024) 后，启动画面出现【花屏/噪点/错位】
      （用户确认：不是纯色，是渲染错位）

已排除: 容器重建流程（字节级验证正确）
未排除:
  ① UI_VFXbase 可能是【VFX 图集/序列帧】的一部分
     整张替换破坏内部布局 ⇒ 采样错位 ⇒ 花屏
  ② astcenc 的 ASTC 块 profile 与游戏期望不符（sRGB vs linear）
  ③ 该纹理带 alpha，纯色 alpha=255 导致混合异常
```

## 56.3 我的 LZ4Inv 压缩器的局限

```
实测对比（真实纹理数据）:
  游戏原始压缩: 122,604 字节
  我的 lz4invcomp3: 186,506 字节  ⇒ 差 52%

⇒ 我的压缩器对【真实纹理】明显弱于游戏
⇒ 「最小改动模式」只对【高度可压的数据（如纯色）】有效
⇒ 真实 mod 需要：更好的压缩器，或接受 .ab 变长 + 更新 .blc 的 offset/len
```

## 56.4 下一步（明确的验证路径）

```
[A] ★★★★ 选【明确的独立纹理】而非图集：
    · login_endfield_logo (512×448)  — 已试，未见品红（可能未使用/有缓存）
    · 试 logo 类: Logo_18_big (1012×364)
    · 试背景类: loging_popup_bg_deco01 (800×452)
[B] ★★★ 用不同 astcenc 质量重试（-medium / -thorough）
    排除 -fastest 的端点模式问题
[C] ★★★ 用【原始纹理原样重压】做对照
    但需要更强的压缩器（我的差 52%）
[D] ★★ 实现更强的 LZ4Inv 压缩器
    · 更大哈希表（HBITS=20+）+ 更长链（CHAIN=64）
    · 或加 lazy matching
```

## 56.5 工具清单（累计）

```
C（tools/vfs/）:
  格式/加密:  vfsfull vfsaes
  压缩:       lz4inv lz4blk lz4comp lz4invcomp{,2,3} lz4invtest
  容器:       abtool abpack abverify
  .blc:       blcfix blcsetdata blcfiledump blcdump blcfileinfo
               findchunk chunknames blcextract
  实用:       fextract（多线程提取）memsearch/ms（多线程内存搜索）
               mktga pxsample mkppm
C#（ref/）:   abdump abdumptex abtex abscan abresS aboffs abfinal
               texinfo filesz
C++:          astcenc v5.7.0（ARM 源码编译）
Python:       0
```

## 56.6 合规

```
仅研究 · 等长替换 · 不改游戏数值/存档
不用于竞技作弊 · 不散布游戏资源 · 不实现 ACE 绕过
语言: C / C++ / C#(.NET)，0 个 Python
```
