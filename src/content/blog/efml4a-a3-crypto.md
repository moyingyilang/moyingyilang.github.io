---
title: "A3 · 加密体系"
description: "ChaCha20 / VFSAES（对合）/ HGCipher 三层加密"
date: 2026-10-17
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

# A3 · 加密体系

> **结论先行**
>
> 三层加密：**ChaCha20**（`.blc` 整体）、**VFSAES**（`.ab` 头部与块）、**HGCipher**（PCK 补丁）。
> **VFSAES 是对合的** —— 加密 == 解密，这大幅简化了写入。

---

## A3.1 ChaCha20（`.blc` 整体）

```
密钥:  e9 5b 31 7a c4 f8 28 56 9d 23 a8 6b f2 71 dc b5
       3e 84 6f a7 5c 92 4d 67 1d ba 8e 38 f4 ca 52 e1
nonce: 文件前 12 字节
counter: 1  ← ★ 不是 0
```

**加密范围：** `[12, len-4)`，尾部 4 字节是 CRC32。

**★ 踩坑：counter 必须是 1。** 用 0 会得到完全不同（且错误）的结果。

## A3.2 VFSAES（`.ab` 内层）

```
Key    = 3AF18C47B2096DEE5124907C18D3A462
IV     = C7125EA904DB3388F20E774965BA1C93
XORKey = 0xF19AB7752CDD0196
SBox   = 自定义 256 字节置换表
```

### ★★★ 对合性（本项目独立发现）

```
E(E(x)) == x

⇒ 加密和解密是【同一个操作】
⇒ 写入时不需要单独的「加密」实现
```

**验证方法：** 对任意 256 字节块连续做两次 `vfs_decrypt_block`，应恢复原文。

### 稀疏路径（len > 256）

```
numBlocksFloor = len / 16
step = 256 / numBlocksFloor
if (numBlocksFloor > 256) step = 1

从每 16 字节块取 step 字节 → 汇入 256 字节缓冲
→ 全量解密 → 散回原位置
```

### ⚠️ 踩坑：ShiftRows 的行列方向

```c
// ❌ 错误（转置）
s[c*4 + r] = t[c*4 + src];

// ✅ 正确
s[r*4 + c] = t[src*4 + c];
// 其中 src = (r + c) % 4
```

**症状：** `E(IV)` 得到错误的输出。修正后与参考实现完全一致：

```
E(IV) = AC 00 BD CD 75 25 05 63 D0 4D 2E 08 07 91 3D 5E
```

## A3.3 HGCipher（PCK 补丁）

**依据 [Harry Huang《终末地 CBT3 逆向工程 2：PCK 文件解密》](https://blog.harryh.cn/Reverse-Engineering/)**

实现见 `tools/blc/hgcipher.c`。

```c
// HGCipherHelper::DecipherInplace 的等价实现
static uint32_t gen_key(uint32_t x) { /* ... */ }
```

## A3.4 密钥的定位（历史记录）

**本项目曾通过内存扫描定位到 ChaCha20 密钥：**

```
工具: tools/vfs/ms（多线程 /proc/<pid>/mem 扫描）
方法: 搜索已知明文-密文对，反推密钥位置
```

**⚠️ 合规说明：** 这些密钥是游戏二进制中的**硬编码常量**，
属于**格式规范**而非机密，已在 [CREDITS.md](../CREDITS.md) 注明出处。

## A3.5 复现

```bash
# VFSAES 对合性验证
tools/.efml4a-bin/lz4invtest   # 内含 VFSAES 相关路径

# 或直接看源码
tools/vfs/vfsaes.c
```

---

**上一篇**：[A2 · `.ab` 容器格式](A2-ab-container.md) ·
**下一篇**：[A4 · 压缩体系](A4-compression.md)
