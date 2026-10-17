---
title: "20 · 运行时密钥材料提取，与「绕过密钥直接捞明文」"
description: "EFML4A 研究文档 · 20-runtime-key-and-memory-extraction（Arknights: Endfield Mod Loader for Android）"
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


本轮把 VFS 密钥问题彻底推进了一步：**密钥材料已从运行时内存完整取出**，
并发现**根本不需要密钥**——游戏运行时已把 `.blc` 解密在内存里。

## 20.1 前置突破：拿到本机 v1.5.3 符号表

用户提供的 `zygisk_il2cppdumper`（此前被禁用）启用并重启后，成功产出
`/data/data/com.hypergryph.endfield/files/dump.cs`（**75,217,340 字节**）。
与用户 v1.4 那份（81,901,728 字节）**大小不同** ⇒ 是本机版本。

由此得到本机 v1.5.3 的真实 RVA（与 v1.4 完全不同）：

| 方法 | v1.4 RVA | **v1.5.3 RVA** |
| --- | --- | --- |
| `VirtualFileSystem.GetCommonChachaKeyBs` | `0xcb97990` | **`0xb37dcd0`** |
| `.ctor` | `0xcb980e8` | `0xb37e31c` |
| `get_instance` | `0xcb98a6c` | `0xb37e980` |

> 用户 v1.4 文档把 `GetCommonChachaKeyBs` 的 RVA 记成 `0xcb980e8`，
> **那实际是 `.ctor` 的 RVA**——该文档围绕它做的全部分析都打在了错函数上。

## 20.2 负载注入链路的确认（zygisk-loader）

用最小 payload（构造函数里只写一个文件）验证出：

| 结论 | 证据 |
| --- | --- |
| `zygisk-loader` **确实注入** | 游戏进程出现 `/memfd:zygisk-payload (deleted)`，且有 **`r-xp` 可执行映射** |
| payload **构造函数确实执行** | 硬编码路径下写出了 `[ctor] pid=... uid=10443` |

**此前所有 payload「无声失败」的真正原因是日志路径**：

| 路径 | untrusted_app 可写？ |
| --- | --- |
| `/data/local/tmp/` | **✗ SELinux 拒绝** |
| `/data/data/<pkg>/files/` | ✓ |
| `/data/user/0/<pkg>/files/` | ✓ |
| `/sdcard/Android/data/<pkg>/files/` | ✓ |

且早期阶段 `/proc/self/cmdline` 仍是 `zygote`，**不能用它推路径**——必须硬编码。

### 20.2.1 一次真实崩溃及其教训（重要）

直接调用 `GetCommonChachaKeyBs` 曾使游戏崩溃，tombstone：

```
#00 pc 0x9a3fdd8  libil2cpp.so
#01 pc 0xb37de44  libil2cpp.so        ← GetCommonChachaKeyBs 内部
#02 pc 0x00004ebc /memfd:zygisk-payload
#03 __pthread_start
```

`b37de44` 是函数开头的「**类未初始化 → 调运行时初始化**」分支：负载一发现
`libil2cpp.so` 被映射就立刻调用，此时 il2cpp 运行时尚未就绪，故崩。

⇒ **教训：从非 il2cpp 线程调用托管代码必须等类初始化完成**
（`b37dcec: ldr w9,[x8,#0xe0]; cbz w9, ...` 中的标志位）。

## 20.3 纯读取方案：安全取出全部密钥材料

改用**纯内存解引用**（不执行任何托管代码），并加 `sigsetjmp`/`SIGSEGV`
保护，成功读出：

```
CHACHA_KEY  = "="                              ← 只有 1 个字符
CHACHA_KEYS = 8 个：Ks6k3zhrV5g / uOVtMpqHxFv / gi4BZzU9xUY / CnBfZVqAgL
                    SjpNhdKK89V / qzl3BC/08Da / oXafvEwR54 / 4ZzYokf5I7Z
派生第三参数 = "Assets/Beyond/DynamicAssets/"   ← ★ 真正的 master key（28 字符）
s_commomChachaKeyBs = NULL（600 秒内游戏从未调用）
```

指针链（由本机反汇编得出，`statics+0x30/0x38/0x40` 与 `dump.cs` 字段偏移一致）：

```
class   = *(void**)(base + 0x1a47e000 + 0xfb0)
statics = *(void**)(class + 0xb8)
CHACHA_KEY(0x30) / CHACHA_KEYS(0x38) / s_commomChachaKeyBs(0x40)
```

### 20.3.1 关键结论：**s_commomChachaKeyBs 始终为 NULL**

⇒ **游戏在 v1.5.3 里根本没走 `GetCommonChachaKeyBs` 这条路径**
（至少在观测窗口内）。这解释了为何用派生密钥解 `.blc` 一直失败：
**我们解的可能是错的/陈旧的容器文件**。APK 内 `assets/VFS/7064D8E2/7064D8E2.blc`
（29,456,167 字节）用该密钥同样解不开。

## 20.4 真正有效的方法：绕过密钥，直接从内存捞明文

**采纳用户建议的「冻结进程做全量 dump」**，但**用 `SIGSTOP` 而不是 ptrace**：

```bash
kill -STOP <pid>    # 冻结；普通信号，不触发 ACE 的 ptrace 检测
# 随便读 /proc/pid/mem，时间不限（解决「早期窗口只有 1~3 秒」的问题）
kill -CONT <pid>    # 解冻
```

> 用户提出的 r2 `dc` 方案在技术上也成立（ACE 检测到 ptrace 后是**暂停**主进程
> 而非杀进程，内存仍可读），但 **ptrace 是 ACE 明确监控的行为，反复触发有被
> 上报/标记账号的风险**；而 `SIGSTOP` + `/proc/pid/mem` **完全不碰 ptrace**，
> 且本项目中已被反复验证不会触发任何检测。故采后者。

工具 `tools/memscan/vfsgrab.c`：`SIGSTOP` 冻结 → **32 线程并行扫全部可读区**
→ 抽取路径类字符串 + 定位 `InitBundle`/`Data/Bundles` 命中点 → `SIGCONT`。

**实测结果**：

```
可读区 4253 个，共 6.22 GB；32 线程
扫描完成 8.81 秒；InitBundle=2  Data/Bundles=505011
→ 50,458 条唯一 VFS 路径
```

**6.22 GB / 8.81 秒**，且**完全不需要密钥**——游戏已把 `.blc` 解密在内存中。

抽取到的路径形如：

```
Data/Bundles/Android/initial/b710cc1ae92494697da4d796.ab
Data/Audio/PCK/Android/Japanese/default_japanese_stream.pck
/storage/emulated/0/Android/obb/com.hypergryph.endfield/main.50.com.hypergryph.endfield.obb
```

## 20.5 当前状态与下一步

**已解决**：密钥材料（全部）、符号表（本机 v1.5.3）、注入链路、明文路径表（50,458 条）。

**下一步**：内存中 `Data/Bundles` 命中点附近应当还有 `FVFBlockFileInfo`
（offset/length）表——**把解密后的索引整体从内存捞出来并解析结构**，
即可在**不需要密钥**的前提下完成资源定位与提取。

## 20.6 工具与参考

| 文件 | 说明 |
| --- | --- |
| `tools/memscan/vfsgrab.c` | SIGSTOP 冻结 + 32 线程并行扫内存 + 路径抽取 |
| `tools/memscan/vfs_paths.txt` | 从内存捞出的 **50,458 条** VFS 路径 |
| `tools/zygisk/payload-readonly.c` | 纯读取 payload（成功取出全部密钥材料） |
| `tools/zygisk/payload-minimal.c` | 最小验证 payload（证明注入与构造执行） |
| `tools/zygisk/payload-callkey-crashy.c` | 直接调用托管函数而崩溃的版本（留作反面教材） |
| `docs/19-zygisk-crash-incident.md` | ZygiskNext 全局停机事故 |

相关：[18](/blog/efml4a-18-vfs-and-ace/) · [17](/blog/efml4a-17-zygisk-loader-route/)

---

## 20.7 追加：VFS 索引结构的定位尝试（本轮继续的工作）

### 20.7.1 从内存定位 `FVFBlockFileInfo` 的三次尝试

| 工具 | 思路 | 结果 |
| --- | --- | --- |
| `findffi.c` | 直接按 `FVFBlockFileInfo` 记录模式扫（stride 0x20 + 宽松校验） | **2487 个候选，全为误报**（校验太松，随机数据易通过） |
| `findna.c` | 扫 `NativeArray<T>` 描述符 `{ptr,len,allocator}`：指针须落在可读映射区且 `ptr+len*0x20` 亦可读 | **217 个强校验命中**；顶部均为 `len≈4073`，描述符密集聚集 |
| `findval.c` | 按记录模式扫（stride 0x1C/0x20）+ 严格校验（chunkIdx 非递减、同 chunk 内 offset 非递减） | **1153 个候选，仍误报** —— 单调递增的 int32 序列会同时骗过两个条件 |

### 20.7.2 已确证的布局事实

**`NativeArray` 描述符是紧凑的 16 字节 `{ptr, len}` 对**（实测）：

```
0x6fd150c9b0: ptr=0x0000006dcb51c388  len=0x0fe9=4073
0x6fd150c9c0: ptr=0x0000006dcb51c634  len=0x0d8b=3467     ← 恰好在 0x10 之后
```

**对应 `VirtualFileSystem` 中的字段**（`dump.cs` v1.5.3）：

```csharp
private NativeParallelHashMap`2 m_fileName2FileInfo;      // 0x20  ★ 文件名哈希 → FVFBlockFileInfo
private RefMultiHashTable`2    m_lowMemoryFileName2FileInfo; // 0x30
```

而命中缓冲区的内容是**递增的 int32 序列**（574, 391, 393, 394, 395, …），
**不是 `FVFBlockFileInfo` 记录** ⇒ 这些是哈希表的**内部索引/桶**数组。

### 20.7.3 `FVFBlockFileInfo` 的 v1.5.3 布局（已确认）

```csharp
[Serializable] public struct FVFBlockFileInfo {
    public  Int64  fileNameHash;          // 名字的哈希（**名字本身不存索引里**）
    public  Int32  fileChunkMD5NameIndex; // → s_indexToFileChunkMD5NameMap → .chk 文件名
    public  Int32  ivSeed;                // ★ 逐文件解密 IV 种子（XXE1）
    public  UInt32 offset;
    public  UInt32 len;
    private UInt32 m_packedFlags;         // FLAG_USE_ENCRYPT / BLOCK_TYPE / LOADER_POS_TYPE / FILE_TAG
    public static Dictionary`2 s_indexToFileChunkMD5NameMap;     // 静态 @0x8
    public static Dictionary`2 s_fileChunkMD5NameToIndexMap;     // 静态 @0x10
    public static FVFBlockFileInfo s_empty;                      // 静态 @0x18
}
```

（`dump.cs` 报的字段偏移带 0x10 头偏移，非托管布局需整体减 0x10。）

### 20.7.4 `FileNameHash` 的入口已定位

`FileNameHash(String)` 的 RVA 为 **`0xb379bdc`**，其主体是**尾调用**：

```asm
b379c18: mov  x1, xzr
b379c20: b    0xadde0b4      ← 真正的哈希实现（RVA 0xadde0b4）
```

`0xadde0b4` 前半段是 il2cpp 运行时样板（`String` 取值、类初始化检查），
**哈希主循环尚未完全还原**——这是下一步的入口。

### 20.7.5 为什么还原 `FileNameHash` 是关键

我们已从内存捞出 **50,458 条真实资源路径**。一旦还原 `FileNameHash`：

1. 对每条路径算出 `fileNameHash`
2. **直接在内存里搜这些 64 位哈希值** → 立刻定位哈希表的键数组与对应的
   `FVFBlockFileInfo` 值数组（键值在 `NativeParallelHashMap` 中成对存在）
3. 由此得到 `{chunkIndex, offset, len, ivSeed, bUseEncrypt}` 的完整映射
4. 按映射读 `.chk` 即可提取资源——**全程不需要 VFS 密钥**

### 20.7.6 另一条并行中的线

游戏内只读 payload 正在**长轮询 `s_commomChachaKeyBs`（2 小时）**。
此前 600 秒内它始终为 NULL，原因是**游戏停在登录界面、尚未读取 VFS**。
只要正常登录进游戏，最终密钥会被自动抓下并写入
`/data/data/com.hypergryph.endfield/files/efml4a-vfsmaterial.txt`。

两条线互为交叉验证：拿到密钥即可离线验证映射；拿到映射即可离线验证密钥。
