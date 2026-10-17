---
title: "22 · 打通 VFS 索引：从运行时内存导出 FVFBlockFileInfo 映射 ★"
description: "EFML4A 研究文档 · 22-index-walk-success（Arknights: Endfield Mod Loader for Android）"
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


**这是目标 (1)(2) 的达成记录** —— 完整映射已从游戏运行时内存导出，
**全程未使用 VFS 密钥**。

## 22.1 完整指针链（全部经设备实测确认）

```
class      = *(void**)(base + 0x1a47e000 + 0xfb0)
statics    = *(void**)(class + 0xb8)
s_instance = *(void**)(statics + 0x58)              ← VFS 单例
m_allVFBlock = *(void**)(inst + 0x10)               ← 托管 Dictionary
```

托管 `Dictionary` 布局：

```
+0x10 buckets(int[])   +0x18 entries(Entry[])   +0x20 count
Entry = { int hashCode; int next; TKey key; <pad>; TValue value; }   （24 字节）
```

`VFBlockMainInfo`：

```
+0x18 groupCfgName(String*)    +0x28 groupFileInfoNum(int)
+0x40 allChunks(FVFBlockChunkInfo[])
```

`FVFBlockChunkInfo`（**重要：含 `UInt128`，16 字节对齐 ⇒ 实际步长 0x40 而非 0x38**）：

```
+0x00 md5Name(UInt128)   +0x20 length(Int64)   +0x28 files(NativeArray)
```

`FVFBlockFileInfo`（非托管）：

```
+0x00 fileNameHash(Int64)  +0x08 chunkIdx(Int32)  +0x0C ivSeed(Int32)
+0x10 offset(UInt32)       +0x14 len(UInt32)      +0x18 flags(UInt32)
```

## 22.2 实测结果

```
=== walk2 完成：block=5 chunk=7 record=1058 ===

VFBlockMainInfo name="BundleManifest"    groupFileInfoNum=1     allChunks n=1
  chunk[0] md5=8540209f5552bc7db31061c77599a723 len=49562407 files n=1
VFBlockMainInfo name="IFixPatchOut"      groupFileInfoNum=2     allChunks n=2
  chunk[0] md5=a2e8c675f5d3abe6d60ba5cb96bcaa5b len=10545  files n=1
  chunk[1] md5=bf876a4e3fb0400c7a0deacbe81d2b7c len=958    files n=1
VFBlockMainInfo name="InitAudio"         groupFileInfoNum=2     allChunks n=2
  chunk[0] md5=a1e0c0c44814b777b62e56784c5c03ce len=96228    files n=1
  chunk[1] md5=c5e55f6aef00a8b8e6ded82b12d94d8a len=7704472  files n=1
VFBlockMainInfo name="InitBundle"        groupFileInfoNum=1052  allChunks n=1
  chunk[0] md5=eaafec0435ec71ffc65d8cf3e4595852 len=175600672 files n=1052
VFBlockMainInfo name="InitialExtendData" groupFileInfoNum=1     allChunks n=1
  chunk[0] md5=dee052a7e78a0672fe5d700d0e0b3451 len=457018   files n=1
```

导出的 TSV 格式：

```
blc              fileNameHash           idx  ivSeed  offset  len     flags
BundleManifest   1395091176462502336    0    1039818536  0   49562407  263185
InitBundle       -7930673544659520263   0    0           0   2458      1032
InitBundle       5493375854000900305    1    0           2458 3182     1032
InitBundle       4796063130630181504    2    0           5640 3183     1032
```

**`InitBundle` 的 offset 完全连续**（0 → 2458 → 5640 → 8823 → 12012 …）
⇒ 结构解析正确。

## 22.3 关键技术点（两次踩坑与修正）

| 坑 | 现象 | 修正 |
| --- | --- | --- |
| **`FVFBlockChunkInfo` 步长** | 用 0x38 时 `chunk[0]` 正确但 `chunk[1]` 是乱码（`md5=0500000000000000...`、`len=8.3e18`） | 结构含 `UInt128`（16 字节对齐）⇒ **实际步长 0x40** |
| **索引装载时序** | payload 在 `m_allVFBlock` 存在但 `count=0` 时就退出，导出只有表头 | **循环等待 `count>0`**（最多 12 分钟） |

## 22.4 当前覆盖范围与后续

**已覆盖**：游戏登录界面阶段装载的 **5 个 block / 7 个 chunk / 1058 条记录**
（`BundleManifest`、`IFixPatchOut`、`InitAudio`、`InitBundle`、`InitialExtendData`）。

**未覆盖**：完整的 `Data/Bundles/Android/**` 全集（50,458 条路径所属的 block）
—— 需要**游戏真正进入世界**（加载完整索引）后重跑同一个 payload。

**下一步**：登录进游戏后重跑 `payload-walk-index`，即可导出全量映射
（`fileNameHash → chunk, offset, len, ivSeed`），随后按映射读 `.chk`
即可完成资源提取 —— **仍然全程不需要 VFS 密钥**。

## 22.5 工具

| 工具 | 说明 |
| --- | --- |
| `tools/zygisk/payload-walk-hashmap.c` | 遍历 `s_instance → m_fileName2FileInfo`，读取哈希表键/值数组 |
| `tools/zygisk/payload-walk-index.c` | ★ **完整遍历 `m_allVFBlock → VFBlockMainInfo → allChunks → files`** 并导出 TSV |
| `tools/memscan/map_format_sample.tsv` | 导出格式样例（仅表头与 3 行，按红线不散布明细） |

相关：[20](/blog/efml4a-20-runtime-key-and-memory-extraction/) · [21](/blog/efml4a-21-video-assets-unencrypted/)

## 22.6 提取链路验证（目标 (4) 进展）

### 22.6.1 映射长度与 `.chk` 实际大小**逐字节一致**

| 映射中的 chunk md5 | 映射 len | 设备上 `.chk` 实际大小 | 一致 |
| --- | --- | --- | --- |
| `eaafec0435ec71ffc65d8cf3e4595852` | 175,600,672 | 175,600,672 | ✅ |
| `8540209f5552bc7db31061c77599a723` | 49,562,407 | 49,562,407 | ✅ |
| `a2e8c675f5d3abe6d60ba5cb96bcaa5b` | 10,545 | 10,545 | ✅ |
| `bf876a4e3fb0400c7a0deacbe81d2b7c` | 958 | 958 | ✅ |

⇒ **映射绝对正确**，按 `{offset, len}` 切分即可覆盖整个 `.chk`。

### 22.6.2 但 `.chk` 内容仍是加密的

对 `InitBundle` 的 1052 条记录按映射切分（总 167.5 MB），
**全部 1052 条的类型判定为 `other`（无已知魔数）**。

进一步分析首条记录（2458 字节）：

- **熵 = 6.550 bits/byte**（8.0 才是完全随机）⇒ **不是随机数据**
- 头部存在**周期 4 的重复**：`dd 0c 7e e9 | 5c 8a 7e e9 | 5c 82 …`
  —— `7e e9` 每隔 4 字节出现 ⇒ **32 位分组特征**

### 22.6.3 已尝试且失败的解密路径

| 尝试 | 参数 | 结果 |
| --- | --- | --- |
| ChaCha20 (IETF) | 派生密钥 × {全零 nonce, ivSeed 填充, 明文头, 文件头} × counter {0,1} | ✗ |
| ChaCha20 (DJB 8 字节 nonce) | 同上 | ✗ |
| **XXTEA**（周期 4 的强线索） | 派生密钥前/后 16 字节，LE/BE，多种切分偏移 | ✗ |
| zlib / gzip / raw-deflate | — | ✗ |

**`ivSeed` 对全部 `InitBundle` 记录均为 0**，而数据仍是密文
⇒ **密钥是全局的，IV 由 `ivSeed` 派生**（正是 `s_commomChachaKeyBs` + XXE1 的组合）。

### 22.6.4 结论

**索引侧已完全打通（不需要密钥）**；
**数据侧仍需要真实密钥** —— 即 `s_commomChachaKeyBs`，
而它只有在游戏真正读取 VFS（登录进世界）后才会被计算出来。
设备上已有只读 payload 在等待捕获它。

## 22.7 工具

| 工具 | 说明 |
| --- | --- |
| `tools/extract/extract-by-map.py` | 按映射 TSV 从 `.chk` 切出资源并做类型判定 |

---

## 22.8 ⚠️ 失败档案：直接调用 `GetCommonChachaKeyBs` 三次崩溃（已放弃）

### 22.8.1 动机

既然索引侧已通，只差数据侧的全局密钥 `s_commomChachaKeyBs`
（游戏只有在**真正读取 VFS** 后才会计算它）。
一个显然的捷径是**由 payload 直接调用 `GetCommonChachaKeyBs`** 把它算出来。

### 22.8.2 三次尝试与三次崩溃

| 尝试 | 做法 | 结果 |
| --- | --- | --- |
| v1 (`callkey2`) | 一发现 `libil2cpp.so` 被映射就立即调用 | **崩溃** |
| v2 (`callkey2` 重试版) | 加线程重试、硬编码日志路径 | **崩溃** |
| v3 (`callkey3`) | **先检查类初始化标志 `*(u32*)(class+0xe0)`，非零才调用** | **仍崩溃** |

三次 tombstone **完全一致**：

```
#00 pc 0x9a3fdd8   libil2cpp.so
#01 pc 0xb37de44   libil2cpp.so     ← GetCommonChachaKeyBs 内部的「类未初始化 → 调运行时初始化」分支
#02 pc 0x00004ebc  /memfd:zygisk-payload
#03 __pthread_start
```

对应反汇编：

```asm
b37dcec: ldr  w9, [x8, #0xe0]     ; 类初始化标志
b37dcf0: cbz  w9, 0xb37de40       ; 为 0 则走运行时初始化
b37de40: mov  x0, x8
b37de44: bl   0x9a3fca0           ; ★ 崩在这里
```

### 22.8.3 为什么「先验标志」没有防住

`callkey3` 检查的是 `*(u32*)(class + 0xe0)`（class 取自 `base+0x1a47e000+0xfb0`），
但我们**能成功读出 `CHACHA_KEYS`** 这个事实，并不等价于
**该函数自己检查的那个标志位**已经置位 —— 二者可能不是同一个标志，
或者该分支还会因其它条件（如线程未 attach 到 il2cpp 运行时）而进入。

**根因判断**：**从非 il2cpp 线程调用托管代码本身就是不安全的**，
无论怎样预先检查标志位。

### 22.8.4 决策：**放弃这条路**

**三次崩溃、且每次都会连带影响用户的游戏进程**，代价不可接受。
该路线**正式放弃**，不再尝试。

**保留的安全替代**（零崩溃，已多次验证）：

1. **只读 payload**（`payload-readonly.c`）—— 纯内存解引用 + `SIGSEGV` 保护，
   已成功取出 `CHACHA_KEY` / `CHACHA_KEYS` / master；
   只需把它改为长轮询 `s_commomChachaKeyBs`，**用户登录进游戏后即可自动捕获**。
2. **索引侧已完全打通，不需要密钥**。

### 22.8.5 处置（已完成）

设备已恢复干净状态：

- `zygisk-loader/config/target.json` → `[]`（**停止一切注入**）
- 从 config 移除本项目投放的全部 `.so`（保留用户原有的 `libgetkey.so`）
- 清理 `/data/local/tmp` 与游戏目录下本项目产生的全部文件
- **验证**：游戏正常启动，`/proc/<pid>/maps` 中 `memfd:zygisk-payload` 映射数 = **0**

### 22.8.6 教训

| 教训 | 说明 |
| --- | --- |
| **注入载荷里绝不调用托管代码** | 从非 il2cpp 线程调用 C# 方法不安全；预先检查标志位**不能**保证安全 |
| **崩溃会反复伤害用户的游戏进程** | 每崩一次就打断用户一次；同类尝试不应超过一次 |
| **有安全等价路径时不要走危险的捷径** | 只读轮询同样能拿到密钥，且零崩溃 |
