---
title: "54. ★★★ 写回成功：游戏接受修改后的 VFS（Round 155-158）"
description: "EFML4A 研究文档 · 54-writeback-success（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 54.1 里程碑

**首次实现：修改 `.chk` 后游戏【不报错、不崩溃、稳定运行】。**

对比此前：任何对 `.chk` 的修改都会导致
「数据加载失败，请返回到登录页面」+ `raise()` 崩溃。

## 54.2 成功的完整链路（9 个关键点）

| # | 内容 | 说明 |
|---|---|---|
| ① | VFSAES `ShiftRows` 转置 bug | `s[r*4+c] = t[src*4+c]`，修正后 `E(IV)` 与参考完全一致 |
| ② | `blocksCount` 的 `encCount` | `e = (h<<16)\|l`（不是 `((l^h)<<16)\|l`） |
| ③ | ★ **数据块必须加密** | `vfs_decrypt_block` 是对合，数据块同样要加密 |
| ④ | ★ **最小改动模式** | 只重压与目标区重叠的块，其余 42 块原样复制 |
| ⑤ | ★ **原样复制的块已是加密态** | 不能再加密一次（否则双重加密） |
| ⑥ | ★ **总长保持 2,438,868** | 零填充对齐 ⇒ `.blc` 的 `off`/`len` 无需改动 |
| ⑦ | 原地写入 `.chk` | 偏移 206,810,161（同偏移同长度） |
| ⑧ | `blcfix` 更新 `contentMD5` + CRC32 | 注意组名是 `"Bundle"`（不是 `"InitBundle"`） |
| ⑨ | 游戏启动 | 无错误、无崩溃、稳定运行 1 分 11 秒 |

## 54.3 `.blc` 解密体布局（实测）

```
@0-3:   version = 5
@4-7:   unk
@8-9:   strLen = 6
@10-15: "Bundle"                     ← ★ 组名
@16-23: groupHash (i64)
@24-27: fileInfoNum = 270,435
@28-35: chunksLen (i64) = 17,850,126,880
@36:    blockType = 11
@37-40: chunkCount = 46
@41-56: md5Name (16)                 ← chunk 头 @0x29
@57-72: contentMD5 (16)              ← @0x39
...
尾部最后 4 字节: CRC32（小端）= crc32(body[0..len-4))
```

## 54.4 `.ab` 最小改动重建的实测数据

```
原 .ab:            2,438,868 字节
最小改动后:        2,438,868 字节  ★ 完全一致
  重压后总 comp:   2,412,932（原 2,438,484）
  零填充:          25,552 字节
  块信息压缩:      328（原 326）
  块 29 comp:      63,477 → 37,019
  块 30:           原样/重压（跨块）
完整流:            5,704,360（一致）
目标区(3,869,352, 65,536) 匹配 = TRUE
```

## 54.5 工具

```
tools/vfs/abpack.c      纯 C 自包含 .ab 重建器（含最小改动模式）
tools/vfs/abverify.c    读回验证器
tools/vfs/blcfix.c      .blc contentMD5 + CRC32 更新
tools/vfs/blcdump.c     .blc 解密体结构 dump
tools/vfs/memsearch.c   多线程内存模式搜索（验证游戏是否加载了 mod）
```

## 54.6 游戏验证结果

```
✅ 无「数据加载失败」
✅ 无 md5/checksum 不匹配
✅ 无 VFS 错误
✅ 稳定运行 1 分 11 秒
✅ 无新 tombstone（最近的 08:53 是本项目 abverify 工具的崩溃）
✅ 游戏持有大量 .chk 的 fd（正常读取 VFS）

⏳ 待办: 进入【普瑞赛斯】场景做视觉确认
   （prts_sm2l3m5_eyemask 是眼罩纹理，需游戏内正常游玩到该场景）
```

## 54.7 合规

```
仅研究用途 · 等长替换（总长不变）
不改游戏数值/存档 · 不用于竞技作弊
不散布游戏资源 · 不实现 ACE 绕过
语言: C/C++/C#(.NET)，0 个 Python
```
