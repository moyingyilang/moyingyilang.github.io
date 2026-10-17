---
title: "18 · VFS 存储格式与 ACE 防护的实测记录（v1.5.3）"
description: "EFML4A 研究文档 · 18-vfs-and-ace（Arknights: Endfield Mod Loader for Android）"
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


本文记录本项目**在设备上逐条验证**《终末地》VFS 资源存储与 ACE 防护的结果，
以及**被证伪的做法**。目标版本的差异是重点：两份公开资料分别针对 **CBT3 / v1.1**
（[Harry Huang 的逆向系列](https://blog.harryh.cn/Reverse-Engineering/Endfield-CBT3-Reverse-Engineering-1-VFS-Storage-Decryption/)）
与 **v1.4**（用户自撰的实战文档，见 `/sdcard/articles/endfield.md`），而本机是 **v1.5.3**。

## 18.1 环境事实（实测）

| 项 | 值 |
| --- | --- |
| 设备 | Xiaomi 24122RKC7C（即 Redmi K80 Pro），Snapdragon 8 Elite |
| Root | KernelSU 3.2.5 + ZygiskNext 1.5.0 |
| 游戏 | `com.hypergryph.endfield` **v1.5.3**（versionCode 50，targetSdk 34） |
| `libil2cpp.so` | 449,365,456 字节 |
| `global-metadata.dat` | 57,210,712 字节 |

## 18.2 VFS 目录结构（与公开资料一致）

```
/sdcard/Android/data/com.hypergryph.endfield/files/
├── index_initial.json     (2,940 字节)
├── index_main.json        (271,124 字节)
└── VFS/                    ← 21 个目录
    └── 07A1BB91/
        ├── 07A1BB91.blc    (387 字节)
        └── <MD5>.chk       (0 ~ 636 个)
```

实测统计（与 CBT3 资料一致）：**21 个目录**，每目录 1 个 `.blc` + N 个 `.chk`，
N 从 0（`07A1BB91`）到 636（`55FC21C6`）。

**⚠️ 与 CBT3 资料的差异**：资料称 `index_initial.json` / `index_main.json`
是**明文 JSON，cat 即可读**；**本机实测两者都是纯 base64 的高熵密文**
（base64 解码后仍为随机数据）。⇒ **索引文件在当前版本已被加密**。

`.blc` 前 4 字节实测恒为 `03 00 00 00` ✓ 与资料一致。

## 18.3 解密算法（源码级确认，非猜测）

关键突破来自开源项目 [`shiikwi/FkArkEnd`](https://github.com/shiikwi/FkArkEnd)
（面向 v1.1 的 C# 实现）。其源码给出了**全部常量与调用方式**：

### 常量（`VFSDefine.cs`）

```csharp
public static int VFS_PROTO_VERSION = 0x00000003;
public static int VFS_VFB_HEAD_LEN  = 0x10;   // 16
public static int BLOCK_HEAD_LEN    = 0xC;    // 12  ← nonce 长度
public static int KEY_LEN           = 0X20;   // 32
```

### 解密调用（`VFSUtils.cs`）

```csharp
var iv = new byte[12];
Array.Copy(data, 0, iv, 0, iv.Length);            // nonce = data[0:12]（含版本号！）
var cipherBytes = data[12..];                      // 密文自偏移 12
using (var chacha = new ChaCha20(key, iv, 1))      // 标准 IETF ChaCha20，初始 counter = 1
    chacha.DecryptBytes(plainBytes, cipherBytes);
```

`CSChaCha20.cs` 确认：`allowedKeyLength = 32`、`allowedNonceLength = 12`、
`processBytesAtTime = 64`，且 `IvSetup` 把 counter 放 `state[12]`、12 字节 nonce 放
`state[13..15]` ⇒ **标准 RFC 8439 IETF ChaCha20**。

> **这纠正了 v1.4 实战文档里的两处关键错误**：
> 1. nonce 取 `data[4:16]` ❌ → 正确是 **`data[0:12]`（从偏移 0 开始，包含版本号）**
> 2. 密文自偏移 16 开始 ❌ → 正确是 **偏移 12**
>
> 由于 nonce 错误，该文档记录的**所有密钥暴力搜索尝试都是无效的**——
> 即使密钥就在手边也永远匹配不上。

### 密钥派生（`VirtualFileSystem.cs` + `IOOO000iiI.cs`）

```csharp
// 8 个密钥片段（v1.1 的值）
v13="Ks6k3zhrV5g" v14="uOVtMpqHxFv" v15="gi4BZzU9xUY" v16="CnBfZVqAgL"
v17="SjpNhdKK89V" v18="qzl3BC/08Da" v19="oXafvEwR54" v20="4ZzYokf5I7Z"

sb = CHACHA_KEYS[0] + [3] + [5] + [2] + "="        // = "Ks6k3zhrV5gCnBfZVqAgLqzl3BC/08Dagi4BZzU9xUY="
b64 = Convert.FromBase64String(sb)                  // 32 字节
for i: key[i] = (b64[i] - masterBytes[i % len(master)]) % 256
master = "Assets/Beyond/DynamicAssets/"
```

**本项目按此复算，得到 `（已隐去）`
—— 正是 v1.4 文档里记录的「CBT3 密钥」**。这证明 FkArkEnd 的推导与公开密钥同源。

## 18.4 实测：该密钥在 v1.5.3 上**解不开**

用上面的密钥 + 正确的 nonce/counter 解密 `07A1BB91.blc`，可打印字符比例仅 **0.39**
（随机水平），且 `version` 字段为巨大负数 ⇒ 解密失败。

进一步实测两条线索：

| 检验 | 结果 | 含义 |
| --- | --- | --- |
| 8 个密钥片段字符串是否还在 metadata 里 | **7/8 命中**（`4ZzYokf5I7Z` 未用故未命中） | 字面量还在 |
| 这些字符串是否存在于**运行时内存**（托管堆 1787 MB 全扫） | **0 命中** | ⇒ **它们是死字面量，当前版本已改用另一套密钥材料** |

⇒ **密钥材料在 v1.5.3 中已更换**，与 v1.4 文档「CBT3 密钥在正式版失效」的结论一致。

## 18.5 被证伪的做法：按字节位置暴力扫描内存

思路：`commonChachaKeyBs` 是运行时 `Byte[]`，只要在内存里把每个 32 字节窗口
当密钥试 ChaCha20，用结构 oracle 判定即可。

**实测证明此路在物理上不可行**（本项目已实现并在设备上跑过，含 48 线程版本）：

| 测量 | 值 |
| --- | --- |
| 游戏进程匿名/堆内存（**t=0.2s 就有**） | **3398 MB** |
| 稳定后匿名/堆 | 2542 MB |
| 单趟扫描耗时（48 线程，含文件映射） | **48 秒** |
| 单趟扫描耗时（仅 2.5 GB 匿名，48 线程，估算） | 5~10 秒 |
| 密钥可能存在的明文窗口 | **1~3 秒** |

⇒ 一趟远长于窗口，**永远抓不到**。此外 oracle 需要每位置算一个完整 ChaCha20 块
（约 2000 条指令），3.4 GB × 每 4 字节一次 ≈ 8.5 亿次块运算/趟，已是该设备的吞吐上限。

**另一个被证伪的做法：用明文正文当签名去内存里找 metadata。**
磁盘上 `global-metadata.dat` 只有头部被 ACE 打乱、正文是明文（可 `strings` 出全部类型名），
故取其正文三段 64 字节签名扫描内存。**扫 6.45 GB，0 命中**
⇒ 内存中**不存在**完整的明文 metadata 副本（il2cpp 解析后未保留连续缓冲）。

## 18.6 ACE 防护的实测确认

| 防护 | 实测 |
| --- | --- |
| `global-metadata.dat` 头部 | 本机开头 4 字节为 **`94 43 72 12`**（正确应为 `AF 1B B1 FA`）✓ 与 CBT3 资料完全一致；**仅头部被打乱，正文完好** |
| `ptrace` | 用户的实战文档记录：调试器 `dc` 后立即闪退；Frida attach 必被检测（spawn 仅"一定概率"） |
| `/proc/pid/mem` | **读取不触发检测**（需 root，不走 ptrace）✓ 本项目全程使用，游戏稳定运行 |
| 游戏自身目录 `files/il2cpp/Metadata/global-metadata.dat` | 与 APK 内那份**逐字节相同**（同 57,210,712 字节、同加密头）⇒ 只是解压出的加密副本，**不是明文** |

## 18.7 已确认可行的载体：`zygisk-loader`

见 [17-zygisk-loader-route.md](/blog/efml4a-17-zygisk-loader-route/)。要点：
它由 `config/target.json` 指定「目标包名 → payload .so」，在 `postAppSpecialize`
阶段把 payload 读入、memfd 映射、`android_dlopen_ext` 加载 ⇒ **payload 的构造函数
在游戏进程内执行**，且**全程不碰 ptrace**。

设备上已存在用户为此写好的 payload `config/libgetkey.so`（其字符串自述：
`GetKey` / `VFS instance` / `s_instance address` / `key_field address` /
`byte[] pointer` / `Code base` / `/data/local/tmp/endfield_key.txt`），
说明**该注入链路曾成功运行过**。

## 18.8 下一步（唯一剩余的路径）

1. **真重启**（`post-fs-data` 才能装载 `zygisk-loader` —— 证据见
   [15](/blog/efml4a-15-ingame-layer-proof/) §15.8 与本轮实测：`ksud soft-reboot`
   不触发 `post-fs-data`，`modules_update` 不会合并）。
2. 重启后 `libgetkey.so` 与我们的 `libefml4a_payload.so` 会一同注入游戏进程。
3. 检查 `/data/local/tmp/endfield_key.txt`；若旧 payload 的硬编码偏移在 v1.5.3
   上已失效，则以 [17](/blog/efml4a-17-zygisk-loader-route/) 的 payload 框架改写：
   在进程内直接调用 `GetCommonChachaKeyBs`（v1.4 的 RVA 为 `0xc9b7484`，
   需按 v1.5.3 重新定位）。

## 18.9 参考

- [Harry Huang · CBT3 逆向：VFS 存储解密](https://blog.harryh.cn/Reverse-Engineering/Endfield-CBT3-Reverse-Engineering-1-VFS-Storage-Decryption/)
- [`shiikwi/FkArkEnd`](https://github.com/shiikwi/FkArkEnd)（源码副本见 `tools/vfs/reference-*.cs`）
- 用户自撰实战文档 `/sdcard/articles/endfield.md`（v1.4，含 ACE 对抗记录）
- 本项目 `tools/vfs/chacha20.py`（纯 Python 实现，支持 IETF/DJB 两种变体）
- [17-zygisk-loader-route.md](/blog/efml4a-17-zygisk-loader-route/) · [06-route-assetbundle.md](/blog/efml4a-06-route-assetbundle/)
