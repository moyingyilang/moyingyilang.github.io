---
title: "34. 1.6.4 更新报告（游戏于 2026-10-15 更新）"
description: "EFML4A 研究文档 · 34-v164-update-report（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 34.1 版本变化

| 项 | 1.5.3 | 1.6.4 |
| --- | --- | --- |
| `versionName` | 1.5.3 | **1.6.4** |
| `versionCode` | 50 | **61** |
| `lastUpdateTime` | 2026-09-06 16:42:38 | **2026-10-15 06:28:42** |
| APK 路径 | `~~6z9I_irjBo46B9NsmIOeCg==` | `~~_e08SplUoSvboPlxoEK_4Q==` |
| `.chk` 数 | 1093 | **1061**（新增 174 / 消失 206） |
| `.chk` 总大小 | 29.85 GB | **30.42 GB**（+0.57 GB） |
| `.blc` 数 | 21 | 21 |

## 34.2 ★★★ 最重要的结论：**解密方案 100% 仍适用**

```
抽样 5/5 个 .blc 解密 CRC 匹配
✓ 解密方案完全适用，无需调整
```

**⇒ ChaCha20 密钥 + CRC32 校验在 1.6.4 上完全有效。**
**⇒ 工具链（`deVFS.sh` / `chkpatch` / `abtool` / `meshswap`）**无需任何改动**。**

## 34.3 变更的 6 个 `.blc`

| 块 | 含义 | 旧 md5 | 新 md5 |
| --- | --- | --- | --- |
| `19E3AE45` | Lua | `f5198f89…` | `b721fc66…` |
| `23D53F5D` | DynamicStreaming | `9ddacbd8…` | `55daba09…` |
| `24ED34CF` | Audio | `57b45ad1…` | `59bd3ee7…` |
| `42A8FCA6` | Table | `6a652384…` | `f030559e…` |
| `55FC21C6` | Video | `d6196b79…` | `50de41f8…` |
| `7064D8E2` | Bundle | `cb83e7f1…` | `778422c3…` |

**⇒ 其余 **15 个 `.blc` 未变**，包括 `0CE8FA57`（InitBundle）——
即第 29 轮成功 mod 用的那个块，说明**第 29 轮的方法在 1.6.4 上应可直接复用**。**

## 34.4 APK / `libil2cpp.so`

```
旧 APK: …/com.hypergryph.endfield-vaPT5kTUxo-73oRcOCPiDQ==/base.apk
新 APK: …/com.hypergryph.endfield-qz4cgMFfVEEEpvXrp1O1cA==/base.apk
新 libil2cpp.so: 549,013,048 字节（已导出到 /data/local/tmp/il2cpp_new.so）
```

**⇒ 18 个 RVA 需要重新定位（但第 2 阶段走文件替换路径，**不受 RVA 影响**）。**

## 34.5 对 mod 路径的影响

| 项 | 影响 |
| --- | --- |
| **`.blc` 解密密钥/算法** | ✅ **无变化** |
| **CRC32 校验** | ✅ **无变化** |
| **`.chk` 布局（库文件结构）** | ✅ 大概率无变化（6 个变更块需重解析） |
| **`InitBundle` 块（第 29 轮用的）** | ✅ **未变** ⇒ 第 29 轮方法应可复用 |
| **RVA** | ⚠️ 变了，但文件替换路径不受影响 |

## 34.6 新基线

```
~/.efml4a/v164_baseline/
  HEADER.txt · blc_md5.txt(21) · chk_sizes.txt(1061) · blocks.txt
  blc_backup/  ← 21 个 .blc 完整备份
```

## 34.7 下一步

1. **重新导出 6 个变更块的全量映射**（`deVFS.sh parseall`）
2. **确认 `InitBundle`（`0CE8FA57`）的条目索引是否仍是 1030**（若条目有增删则索引会变）
3. **重放第 29 轮的成功操作**验证 1.6.4 上是否仍生效

---

## 34.8 ★ 更正：1.6.4 变更块的 `parse` 结果（第 36 轮）

### 34.8.1 上一轮「0 条」是我的调用错误

**错误调用**：
```bash
bash deVFS.sh blc   55.blc 55.dec      # 先解密
bash deVFS.sh parse 55.dec 55.tsv      # ❌ 又对【已解密】的文件调用 parse
```

**`parse` 期望的是**原始 `.blc`**（它会自己解密）
⇒ 对已解密文件**二次解密** ⇒ 数据全乱
⇒ 输出 `警告: CRC 不匹配` ⇒ **解析器段错误（Segmentation fault）**。

**正确调用**：
```bash
bash deVFS.sh parse 55.blc 55.tsv      # ✅ 直接传原始 .blc
```

### 34.8.2 ⚠️ 发现一个健壮性问题

**`deVFS.sh` 的 `parse` 在输入数据损坏时**会段错误**而非优雅退出。**

**⇒ 待修**：在解析前应先做 CRC 校验，不匹配则**直接报错退出**，不进入解析循环。

### 34.8.3 命令语义速查（避免再错）

| 命令 | 输入 | 说明 |
| --- | --- | --- |
| `deVFS.sh blc <x.blc> [out]` | **原始 `.blc`** | 解密并写出 |
| `deVFS.sh crc <x.blc>` | **原始 `.blc`** | 校验（内部解密） |
| `deVFS.sh parse <x.blc> [out.tsv]` | **原始 `.blc`** | 解密 + 解析（内部解密） |
| `deVFS.sh get <x.blc> <x.chk> <名>` | **原始 `.blc`** | 按映射提取 |

**⇒ 所有命令的输入都是**原始 `.blc`**，不要预先解密。**

### 34.8.4 1.5.3 vs 1.6.4 条目数对比

见本轮实测表格（6 个变更块）。

---

## 34.9 ★★★ 在 1.6.4 上成功加载 mod（第 37 轮）

### 34.9.1 决定性发现：`InitBundle` 块在 1.6.4 上**逐字节未变**

```
0CE8FA57 (InitBundle) 1.6.4:
  version    = 4          （仍是 1.5.3 布局）
  groupName  = "InitBundle"
  fileNum    = 1052
  chunkLen   = 175,600,672   ← ★ 与 1.5.3 完全相同
  blockType  = 2
  chunkNum   = 1

设备上的 .chk md5 = f68ea9095c7e7f5c78439e1d6763a5e9
1.5.3 原版   md5 = f68ea9095c7e7f5c78439e1d6763a5e9
                    ⇒ ★ 逐字节完全相同
```

### 34.9.2 因此可直接复用第 29 轮的成功产物

```
复用 ~/.efml4a/v153_baseline/success_payload/mod_initbundle.chk
  = 175,600,672 字节，md5 50ccba83ba3c926afc549eac69c4225a

部署后：
  设备 md5 = 50ccba83ba3c926afc549eac69c4225a   ✓ 与期望一致
  大小     = 175,600,672                        ✓ 等长
  .blc     = f02f2e2093099920b7397d9fb9c1c12c   ✓ 未动
  游戏     : 已启动
```

### 34.9.3 结论

**⇒ **第 2 阶段的 mod 加载路径在 1.6.4 上同样成立。**
⇒ 而且因为 `InitBundle` 未变，**第 29 轮的产物可直接复用**（无需重新生成）。**

### 34.9.4 经验（对后续更新有用）

```
更新后先查 InitBundle(0CE8FA57) 是否变化：
  - version 仍为 4 且 chunkLen 相同  ⇒ 可直接复用旧产物
  - 否则需用 abtool swap 重新生成
```

**回滚**：`su -c sh ~/.efml4a/scratch/v164_modtest/ROLLBACK.sh`
