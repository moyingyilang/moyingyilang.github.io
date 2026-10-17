---
title: "A1 · VFS 存储格式"
description: "终末地 .chk/.blc 文件格式详解（含 codeVersion>3 的 8 字节 tag 关键修正）"
date: 2026-10-17
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

# A1 · VFS 存储格式

**这篇讲什么**
游戏把资源存在两个文件里：`.chk`（数据）和 `.blc`（目录）。
这篇拆开 `​.blc`，讲清楚它每一段是什么。

**为什么重要**
`.blc` 就是「字典」。你想改任何资源，都得先能读懂这本字典 ——
不然你不知道数据在哪个偏移、有多长。

---

## 先说结论

```
.blc 的结构:
  ┌────────────────────────────────┐
  │ 12 字节 nonce                  │  ← 随机数，解密要用
  ├────────────────────────────────┤
  │ ChaCha20 加密的 body           │  ← 真正的目录
  ├────────────────────────────────┤
  │ 4 字节 CRC32                   │  ← 防损坏
  └────────────────────────────────┘

★ 一个关键发现:
  codeVersion > 3 时，每条记录前面要读 8 字节，不是 4 字节。
  所有公开工具都只读 4 字节 —— 所以它们在 1.6.4 上全部失效。
```

---

## 1. 文件放哪

```
/data/media/0/Android/data/com.hypergryph.endfield/files/VFS/
  0CE8FA57/                    ← 一个「组」，名字是 8 位十六进制
    A47587BA...chk             ← 数据块（217 MB）
    0CE8FA57.blc               ← 目录（133 KB）
```

**组是什么？** 游戏把资源分成若干组，每组一个 `.blc` + 若干 `.chk`。

实测有 25 个组，重要的几个：

| 组名 | 它叫什么 | 多大 | 什么时候加载 |
|---|---|---|---|
| `0CE8FA57` | **InitBundle** | 208 MB | **启动就加载** |
| `7064D8E2` | Bundle | 16 GB | 进游戏场景才加载 |
| `24ED34CF` | Audio | 3.6 GB | 启动就加载（音频） |
| `E1E7D7CE` | AudioChinese | 1.3 GB | 启动就加载（中文语音） |
| `F151B649` | HotfixAudio | 6.8 MB | 启动就加载（热更音频） |

**⚠️ 一个踩过的坑：** 我一开始只看启动后 9 秒的文件句柄，看到只有 1 个 `.chk`，
就以为「启动只加载 InitBundle」。后来跑满 60 秒再看，是 11 个。
**采样太早会得出错误结论。**

---

## 2. `.blc` 长什么样

### 2.1 三层结构

```
偏移 0 ──────────────
      │ nonce (12 B)  │   ← 这 12 字节不解密，直接拿来当 ChaCha20 的 nonce
偏移 12 ─────────────
      │               │
      │ ChaCha20 密文 │   ← 目录内容，用固定密钥 + 上面的 nonce 解密
      │               │
偏移 len-4 ──────────
      │ CRC32 (4 B)   │   ← 解密后 body 的 CRC32，用来验完整性
偏移 len ────────────
```

### 2.2 解密密钥

```c
// 硬编码在游戏里，不是秘密
const uint8_t KEY[32] = {
    0xe9, 0x5b, 0x31, 0x7a, 0xc4, 0xf8, 0x28, 0x56,
    0x9d, 0x23, 0xa8, 0x6b, 0xf2, 0x71, 0xdc, 0xb5,
    0x3e, 0x84, 0x6f, 0xa7, 0x5c, 0x92, 0x4d, 0x67,
    0x1d, 0xba, 0x8e, 0x38, 0xf4, 0xca, 0x52, 0xe1,
};
```

**⚠️ 关键细节：counter 从 1 开始，不是 0。**
我一开始用 0，解出来全是乱码，查了很久才发现。

```c
// 正确
chacha20_xor(body, len, KEY, nonce, /* counter = */ 1);
```

### 2.3 解密后的 body 布局

```
u32   version              ← 通常是 5
u32   unk
u16   strLen
char  groupStr[strLen]     ← 组名："Bundle" / "InitBundle" / "Audio" ...
u64   groupHash
u32   fileInfoNum          ← 有多少个文件条目
u64   chunksLen
u8    blockType
u32   chunkCount           ← 有多少个 chunk
[chunk entries × chunkCount]
[file entries × fileInfoNum]
u32   CRC32
```

### 2.4 ★★ 这里有个大坑：8 字节还是 4 字节

**每条记录前面有个 tag。读错长度，后面全错位。**

```
公开工具（EndfieldStudio / AnimeStudio / fluffy-dumper）:
  tag 读 4 字节

1.6.4 的实际情况:
  codeVersion > 3  ⇒  tag 读 8 字节（2 × i32）
```

**这一处差异，导致了所有公开工具在 1.6.4 上失效。**

我是怎么发现的？读一个已知文件（`InitBundle` 下的某个 `.ab`），
用 4 字节读出来的偏移跟实际文件大小对不上。试了 8 字节就对上了，
然后拿 270,435 条记录全部验证了一遍 —— 全对。

### 2.5 chunk entry（50 字节）

```
md5Name(16)      ← 这个 chunk 的 .chk 文件名（16 字节二进制）
contentMD5(16)   ← 整个 .chk 的 md5
off(8)           ← 在 .chk 里的偏移
len(8)           ← 长度
blockType(1)
encrypt(1)
```

### 2.6 file entry（变长）

```
nameLen(u16) + name    ← "Data/Bundles/Android/initial/xxx.ab"
nameHash(8)
chunkName(16)          ← 它在哪个 .chk 里
dataMd5(16)            ← 整个 .ab 的 md5
offset(i64)            ← 在 .chk 里的偏移
len(i64)               ← 长度
blockType(u8)
encrypt(u8)
[ivSeed(i64)]          ← 仅当 encrypt = 1
```

**这就是你要改资源时最关心的两个字段：`offset` 和 `len`。**

---

## 3. 一个真实的例子

`ui_main_menu_logo_icon` 这个纹理，在 `.blc` 里是这样的：

```
file683:
  name      = "Data/Bundles/Android/initial/540d02690a7c7b8fd4fe6e66.ab"
  chunkName = A47587BA5EEF7FD05F1FEC103DEA85BD（即 InitBundle 的 .chk）
  offset    = 4,429,838
  len       = 9,806
```

**翻译成人话：** 这个纹理的数据，在 `A47587BA...chk` 文件的第 4,429,838 字节处，
占 9,806 字节。

你想改它，就改这 9,806 字节 —— 长度不能变，偏移不能变。

---

## 4. 自己动手试

```bash
# 进 tools/vfs 编译
cd tools/vfs && make

# 解析一个 .blc
../.efml4a-bin/vfsfull /path/to/0CE8FA57.blc

# 输出大概长这样:
#   .blc: 133424 字节
#   解密后前 16 字节: 05 00 00 00 ...
#   CRC32: 存储=0x5f83c3d2 实算=0x5f83c3d2 ✓
#   version=5 codeVersion=5
#   group="InitBundle" hash=0x... fileInfoNum=1075 chunksLen=... 
#   chunk0: len=217713773 bt=... files=1075
#     file0: "Data/Bundles/..." off=... len=... bt=... enc=0 iv=0
```

**如果 CRC 校验过了、条目数对得上，说明你读对了。**

---

## 5. 我踩过的坑（省你时间）

| 坑 | 症状 | 解法 |
|---|---|---|
| counter 用 0 | 解出乱码 | 用 1 |
| tag 读 4 字节 | 偏移全错 | 1.6.4 读 8 字节 |
| 采样太早判断加载 | 以为只加载 1 个组 | 等 60 秒再看 |
| 用 `md5sum` 验证写入 | 偶尔慢得离谱 | 用 `dd` + `md5sum` 分块 |

---

## 6. 下一步

读完这篇你应该能：
- ✅ 知道 `.blc` 里有什么
- ✅ 能读懂 `vfsfull` 的输出
- ✅ 知道去哪里找某个资源的偏移和长度

接着读 **[A2 · `.ab` 容器格式](A2-ab-container.md)** ——
你会看到那 9,806 字节里面又套了一层混淆。
