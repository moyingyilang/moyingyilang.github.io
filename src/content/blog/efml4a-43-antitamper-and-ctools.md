---
title: "43. 游戏反篡改机制 + C 工具集（第 53–54 轮）"
description: "EFML4A 研究文档 · 43-antitamper-and-ctools（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 43.1 ★★★★★ 重大发现：游戏会**还原被修改的代码**

### 43.1.1 铁证

**hook 安装后立即验证内存：**

```
[key] base=0x75fb9de000 target=0x760802c194
[key] bytes a86e1a39 nz=16
[key] ctor HOOKED
[key] ★ 检测到还原，已重装 #1 (tick=1)      ← ★★★ 游戏还原了我们的修改！
[key] ctor HOOKED

直接读 /proc/<pid>/mem 验证:
  第一次（无看门狗）: a8 6e 1a 39 55 e2 09 d0 80 02 40 f9 …
                     ⇒ 【原始代码】⇒ hook 被抹掉了
  加看门狗后:         50 00 00 58 00 02 1f d6 dc 5e aa d5 76 00 00 00
                     ⇒ ldr x16,#8 / br x16 ⇒ ★ hook 活着
```

### 43.1.2 ★★★★ 这解释了此前**所有**的「0 次调用」

```
❌ 不是「函数冷门」（我之前反复猜错的方向）
✅ 真相：游戏有【代码完整性校验】，会还原被修改的 .text
⇒ 我们的 Mesh hook（get_bounds / get_vertices / SetUVs）
   和 VFS hook（ValidChunkLength / Read / get_Position / get_Length）
   【全部被悄悄抹掉】⇒ 所以日志说 HOOKED 但永远 0 次调用
```

### 43.1.3 ★ 对策：看门狗周期性重装

```c
/* install() 里：只在第一次保存原始字节（重装时不能把我们的跳转当原始字节存） */
static int saved_once=0;
if(!saved_once){ memcpy(g_saved,g_target,PATCH_LEN); saved_once=1; ... }

/* waiter() 里：每 200ms 检查目标处是否还是我们的跳转，不是就重装 */
for(long long tick=0; tick<9000; tick++){
  if(tick==0) install(base);
  else {
    uint32_t cur0; memcpy(&cur0,g_target,4);
    if(cur0!=0x58000050u){ install(base); /* 重装 */ }
  }
  usleep(200000);
}
```

**跳转签名 `0x58000050` = `ldr x16,#8`（我们写的 16 字节绝对跳转的第 1 条）。**

## 43.2 ★★★★ `.blc` 的完整字段布局（1.6.4 / version=5）

### 43.2.1 头部

```
+0x00 u32  version        = 5
+0x04 u32  unk            = 0x019d738d
+0x08 u16  strLen
+0x0a char[strLen] group  ("InitBundle" / "Bundle" / "BundleManifest" / …)
+0x0a+strLen u64 块标识
+0x12+strLen u32 fileNum
+0x16+strLen u64 chunkLen
+0x1e+strLen u8  blockType
+0x1f+strLen u32 chunkNum
```

### 43.2.2 chunk 头

```
+0  16B chunkMD5      ← 转大写 = .chk 文件名
+16 16B contentMD5    ← 游戏校验的内容 MD5
```

### 43.2.3 文件条目（每个）

```
u16 nameLen + char[nameLen] name
然后 66 字节字段块:
  +0   8B   文件 hash
  +8   16B  chunkMD5（重复存储，用于定位 chunk）
  +24  8B   hash2
  +32  8B   hash3
  +40  8B   offset      ★ 显式存储
  +48  8B   len
  +56  1B   blockType
  +57  1B   ★ useEncrypt
  +58  4B   ★ ivSeed
  +62  2B   填充
```

### 43.2.4 ★★ 验证（决定性）

| 块 | blockType | useEncrypt | ivSeed | len 校验 |
| --- | --- | --- | --- | --- |
| **0CE8FA57** InitBundle | 2 | **0**（明文） | 0 | len 总和 = 217,713,773 = chunkLen ✓ |
| **7064D8E2** Bundle | 11 | **0**（明文） | 0 | — |
| **1CDDBF1F** BundleManifest | 4 | **1**（加密） | `0x3dfa5f28` | 53,702,509 ✓ |

**⇒ 清单内部名 = `Data/Bundles/Android/manifest.hgmmap`（`.hg` = 鹰角自定义）**

### 43.2.5 ★★★ 已验证我们的写入位置 100% 正确

```
InitBundle 1075 条的 len 总和 = 217,713,773 = chunkLen  ✓ 完全一致
e2cd202a 的累加 offset = 52,233,268 = 我们写入的偏移    ✓ 完全一致
e2cd202a len = 2,399,399
```

## 43.3 ★★★★ `XXE1` = **ChaCha20**

```csharp
public sealed class XXE1 : IDisposable {
    public const Int32 allowedKeyLength;    // 32
    public const Int32 allowedNonceLength;  // 12
    private readonly UInt32[] state;        // 16×u32
    private static readonly Byte[] sigma;   // "expand 32-byte k"
    private static readonly Byte[] tau;     // "expand 16-byte k"
    public Void .ctor(ReadOnlySpan key, ReadOnlySpan nonce, UInt32 counter);  // 0xc64e194 ★序言安全
    private Void KeySetup(ReadOnlySpan key);          // 0xc64e2f4 ✗BL
    private Void IvSetup(ReadOnlySpan nonce, UInt32 counter); // 0xc64e868 ✗BL
}
```

**⇒ 清单加密 = ChaCha20 ⇒ 只需 key/nonce（`XXE1..ctor` 一次给全）**

## 43.4 ★★★ 目标 asset 澄清

```
e2cd202a3481b563467135e6.ab 内容:
  asset 名 : SK_actor_endminf_introAvatar
  路径     : intro/model/sk_actor_endminf_
  骨骼     : eyeLfJoint(左眼), Neck_M/Head_M/hair_L_a_0, Shoulder …
  网格     : Mesh_all/lod, Mesh_all/lod1
  ⇒ 【终末地女管理员（Endministrator）】= 玩家角色
  ⇒ 【introAvatar】= 开场/介绍专用 Avatar
  ⇒ 不是普瑞赛斯

InitBundle 里只有 3 个角色模型（全部 endminf/endminm）:
  sk_actor_endminf_ / sk_actor_endminf_03_ / sk_actor_ui_endminm_01_
  ⇒ 【没有普瑞赛斯】⇒ 她的资源在 Bundle 块（需清单才能定位）
```

## 43.5 ★★★★★ 新增 C 工具（取代全部 Python）

| 工具 | 功能 | 性能 |
| --- | --- | --- |
| **`blctool.c`** | .blc 解密 / dump / find / xfind / head / strs / paths / crc | **32 MB → 0.34 s** |
| **`vfslist.c`** | 完整解析所有条目（name/offset/len/blockType/useEncrypt/ivSeed/chunkMD5） | **270,435 条 → 1.26 s** |
| **`xxe1.c`** | XXE1=ChaCha20 解/加密任意文件 | — |
| **`bsearch.c`** | 二进制模式搜索（分块、跨块匹配） | **217 MB → 2.3 s** |
| **`hashtest.c`** | 多哈希试匹配（fnv1a/fnv1/djb2/sdbm/adler32/crc32/murmur3） | — |
| **`prologue.c`** | 批量检查函数序言 + trampoline 安全性 | — |
| **`elfinfo.c`** | ELF 机器类型（替代脚本里的 python struct） | — |
| **`blcfix.c`** | 更新 .blc 的 contentMD5 + 重算 CRC32 | — |

**⚠️ 修过的 C 工具 bug（记录）：**
```
bsearch.c:  fseek(END) 后 start=0 时没 fseek 回开头 ⇒ fread 返回 0
            → 修复：无条件 fseek(f,start,SEEK_SET)
blcfix.c:   自动定位常数 0x23 应为 0x19 ⇒ 写错位置
            → 修复：base+0x19
```

## 43.6 ★★ Python 已从项目彻底清除

```
删除 8 个 .py（tools/vfs/*.py ×6, tools/video/*.py, tools/extract/*.py）
.gitignore 加入 *.py / *.pyc / __pycache__
scripts 里 4 处内联 python3 已替换:
  · build-local.sh        → elfinfo.c（C 工具）
  · injection-diag.sh     → 待替换（sqlite3 CLI 已装）
  · lsposed-diag.sh       → 待替换
  · android/…/build-local.sh → 待替换
scratch 里 17 个 .py 已删
```
