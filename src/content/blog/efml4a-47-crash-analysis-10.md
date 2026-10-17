---
title: "47. tombstone_10 崩溃分析（第一次 .chk 持久替换）"
description: "EFML4A 研究文档 · 47-crash-analysis-10（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 47.1 背景

本轮首次尝试【.chk 持久替换 + .blc contentMD5 同步】：
- 对 7 个含 iris 纹理名的 .chk 做全量替换（所有 256KB 高熵块 → mod BC7 数据）
- 用 blcfix 更新每个 chunk 的 contentMD5 并重算 CRC32
- 总计替换 ~19,000 个块

## 47.2 崩溃事实

```
tombstone_10
  Build fingerprint: Redmi/miro/miro:17/CP2A.260605.016/OS4.0.0.10.XOMCNXM
  Timestamp: 2026-10-17 00:42:55
  Process uptime: 705s            ← 运行 11 分 45 秒后才崩
  signal 5 (SIGTRAP), code -6 (SI_TKILL)
  esr: 0x92000006 (Data Abort Exception 0x24)
  tid: 30611, name: Thread-1823   ← 工作线程，不是 UnityMain
  pc: libc.so raise+136
```

### 调用栈
```
#00 raise                     (libc)        ← 主动触发
#01 libunity.so +0x16a8204
#02 libunity.so +0x16a8d68
#03 libunity.so +0x07c33e4
#04 libunity.so +0x07c37dc
#05 libunity.so +0x0654500
#06 libunity.so +0x17574a4
#07 libunity.so +0x09abc60
#08 libunity.so +0x09ad560
#09 libunity.so +0x09ada04
#10 libunity.so +0x07af2a4
#11 libunity.so +0x0d528c8
#12 libunity.so +0x07b2368
#13 libunity.so +0x07b21c8
#14 libunity.so +0x07b20bc
#15 libunity.so +0x08b5ea4
#16 __pthread_start           (libc)
#17 __start_thread            (libc)
```

### 关键寄存器
```
x0  = 0x0                       第一个参数 = 0
x2  = 0x5
x4/x5/x6 = 0x40422e3964756867   as double = 36.36112647755436
```

## 47.3 ★ 决定性证据：崩溃时游戏持有我修改的 .chk

tombstone 的 fd 列表（24416 行）里：
```
fd 536: VFS/7064D8E2/AFCDA0EB88B6FDD11B36DE768F19B342.chk  ← 我改过
fd 573: VFS/7064D8E2/798C1F6A08C7CEBD826F1F86809A30E7.chk  ← 我改过
fd 587: VFS/7064D8E2/511AE6C31DB21742C9CD125CE309EC5F.chk  ← 我改过
```
⇒ **游戏确实加载并使用了被修改的文件。**

## 47.4 结论（证据驱动）

### ✅ 已证明
1. **.chk 修改【确实被游戏读取】**（fd 持有 + 崩溃）
2. **崩溃是【主动 abort】（SIGTRAP/raise），不是内存错误**
   ⇒ 游戏检测到了【内容不一致】并主动中止
3. **不是启动即崩，而是【运行 705 秒后】在工作线程崩溃**
   ⇒ 说明不是「加载时校验拒绝」，而是「使用时解码/解析失败」
4. **contentMD5 语义已实证** = .chk 文件的 md5
   （用备份验证：原始 .chk md5 = 4aad34ee… = .blc 里的 contentMD5）

### ❌ 出错的判断
1. **「contentMD5 是唯一校验」—— 错误**
   ⇒ 即使 contentMD5 同步正确，游戏仍然崩溃
   ⇒ 说明还有【其他校验或格式约束】

2. **「全量替换所有高熵块是安全的」—— 错误**
   ⇒ 我替换了 ~19,000 个块，其中必然包含【非纹理数据】
   ⇒ 破坏了 .ab 的内部结构（元数据/索引被覆盖）
   ⇒ 游戏解析时遇到非法数据 ⇒ abort

## 47.5 根因假设（按可能性排序）

```
假设 1 ★★★★ 破坏了 .ab 内部结构
  · 我把【所有】256KB 高熵块都替换了
  · 但 .ab 内不只有纹理，还有序列化元数据（可能是高熵的）
  · 覆盖后解析器读到非法值 ⇒ 断言失败 ⇒ raise()
  · 证据：x4/x5/x6 = 36.36（可能是被破坏的数值参数）

假设 2 ★★★ .ab 有内部长度/校验字段
  · .ab 内部可能有自己的块级 CRC 或长度表
  · 我改内容但没更新 ⇒ 校验失败

假设 3 ★★ 纹理格式不匹配
  · 某些块不是 BC7（可能是 ASTC/ETC2/RGBA）
  · 我塞入 BC7 数据 ⇒ 解码器失败
  · 证据：#07-#09 在 libunity.so 的 0x9a****（可能是纹理解码路径）

假设 4 ★ 时机问题
  · 705 秒后崩溃 ⇒ 可能是某个【延迟加载】的资源
  · 或某个【流式加载】的纹理
```

## 47.6 教训（写入工作准则）

```
① ★ 不要【全量】替换 —— 只替换【确认是目标】的块
   本轮违反：为省事把 7 个 .chk 的所有高熵块都改了
   代价：破坏了未知数量的 .ab 结构

② ★ 每次只改 1 个块，一次验证
   之前已确立「一次一个变量」，但为追求「全量替换」违反了

③ ★ 改 .chk 前先【解析 .ab 内部结构】
   至少要区分：哪些区域是纹理数据、哪些是元数据
   本轮跳过了这步

④ ★ SIGTRAP/raise 是【校验证据】不是【噪声】
   它证明游戏确实读取了修改 ⇒ 方向对，但内容破坏过度

⑤ ★ 备份策略有效：7 个 .chk 全部可还原（已实测 md5 一致）
```

## 47.7 下一步（修正方向）

```
[A] 精确定位单个纹理（不再全量）
    · 用 .ab 结构解析，找到【确切的纹理数据区间】
    · 只替换那一个区间（262,144 字节）
    · 一次验证

[B] 恢复后再分析 .ab 内部格式
    · 从 iris 元数据（@550,763,943 in AA9BB41C）出发
    · 解析该 .ab 的纹理偏移
    · 确认纹理数据的【精确边界】

[C] 用 Temp 路径验证（不碰 .chk）
    · 之前 Temp 路径已证明能生效（标题页变化）
    · 先确认【哪个块】是瞳孔，再用 .chk 落地
```

## 47.8 工具与备份状态

```
备份（全部验证 md5 一致，可还原）:
  ~/.efml4a/scratch/chk_backup_1792168788/0BE16226.chk.orig
  ~/.efml4a/scratch/chk_backup_1792168913/AA9BB41C.chk.orig
  ~/.efml4a/scratch/chk_backup_1792168953/*.chk.orig (5 个)
  ~/.efml4a/scratch/irisfind/b.blc.orig

新增工具:
  tools/vfs/bulkmod.c   全量替换（本轮新增，但用法需谨慎）
  tools/vfs/strtab.c    解析 [len][str] 字符串表
  tools/vfs/blkhash.c   块指纹（diff 用）
  tools/vfs/bc7mode     验证 BC7 mode 分布（scratch）

崩溃证据:
  /data/tombstones/tombstone_10 (24416 行，含完整 fd 列表)
```
