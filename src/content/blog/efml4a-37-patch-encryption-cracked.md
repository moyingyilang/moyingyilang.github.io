---
title: "37. ★★★★★ 1.6 补丁加密方案查明（重大突破）"
description: "EFML4A 研究文档 · 37-patch-encryption-cracked（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 这是自第 2 阶段以来**最重要的发现之一**。
> 之前多轮尝试（HGCipher / ChaCha20 / zlib / LZ4）全部失败，
> 现在**算法、IV、格式全部查清**。

## 37.1 发现位置

```
/sdcard/Android/data/com.hypergryph.endfield/files/
  HGGameUpdate/gameupdate/preload/1.6/workspace/
    encryption_index.json   61,975 B   ← ★ 明文 JSON！
    patch.json             264,632 B
    patch.temp          34,877,068 B   ← 写到一半的临时文件
```

## 37.2 ★ 补丁解密算法 = **AES-256-CBC + PKCS7**

**`encryption_index.json` 是**明文 JSON**（熵 4.9，完全可读）：**

```json
{
  "algorithm": "AES-256-CBC",
  "padding": "PKCS7",
  "files": {
    "Patch/diff_10916909-2_10731330-8/19E3AE45_7C7AEAD2AF407961E1C85A9F2041F782.chk_patch": {
      "iv": "a46760a1ab757a4221c42cd15ca045c2"
    },
    "Patch/diff_10916909-2_10731330-8/23D53F5D_0B853234254ED500110D9B46B9DFF803.chk_patch": {
      "iv": "c495f49927548ccbe16e7d11eb3dfb63"
    },
    …
    "non_patch_resources/F151B649/F151B649.blc": {
      "iv": "e5b70cbea6cf97b40c7b85293f7026bc"
    },
    "patch.json": {
      "iv": "2eb21a48e4bd3cb51e6161397e243db8"
    }
  }
}
```

**⇒ 每个补丁文件都有独立的 **初始化向量 (IV)**，共 **446** 个条目（其中 248 个 `.chk_patch`）。**

**⇒ 我们之前失败的原因：只试了 ChaCha20 与 HGCipher，**从未试过 AES**。**

## 37.3 ★ 补丁格式 = **HDiffPatch**（`HDIFFSF20`）

**`patch.temp` 头部：**
```
48 44 49 46 46 53 46 32 30 = "HDIFFSF20"
```

**⇒ 这是 **HDiffPatch** 的格式魔数。**
**⇒ 与目录名 `diff_10916909-2_10731330-8` 完全对应：**
- `10916909-2` = 旧版本标识
- `10731330-8` = 新版本标识

**⇒ 补丁 = **HDiffPatch 的 old→new 二进制差分**，
应用需要官方 `hpatchz` 工具。**

## 37.4 完整补丁流程（推断）

```
① 下载 ZmsRIP_pre_patch.zip.001-005（4.64 GB）
② 解出 encryption_index.json（明文，含每个文件的 IV）
③ 用 AES-256-CBC + 对应 IV 解密每个文件：
     - *.chk_patch        → HDiffPatch 补丁数据
     - non_patch_resources/*  → 完整替换文件
     - patch.json         → 补丁清单
④ 用 hpatchz 把 *.chk_patch 应用到 1.5.3 的对应文件 ⇒ 得到 1.6 的文件
⑤ 写入 VFS
```

## 37.5 ⚠️ 仍缺的一环：**AES 密钥**

**`encryption_index.json` 里**只有 IV，没有密钥**：**
```
键统计: "algorithm"(1) · "padding"(1) · "files"(1) · "iv"(446)
搜 key/secret/salt/passphrase/password → 0 命中
```

**⇒ AES-256 密钥（32 字节）应在**别处**，候选：**
1. **`libil2cpp.so` 里的硬编码常量**（新版：549,013,048 字节，已导出到
   `/data/local/tmp/il2cpp_new.so`）
2. **`patch.json`** 里（但它本身也需要先解密 —— 鸡生蛋问题？
   除非 `patch.json` 用的是**同一个全局密钥**）
3. **外部注入**（登录时从服务器取）

**⇒ 下一步：在 `libil2cpp.so` 里搜 AES 相关的密钥常量
（`AES_256` / `aes` / `CBC` / 或 32 字节的高熵常量池）。**

## 37.6 附带：本次热更新被中断

```
游戏 pid   : 未运行（已退出）
前台       : com.zhuziplay.lvmengnew.op（用户切到了别的 app）
workspace/ : encryption_index.json · patch.json · patch.temp(34,877,068 B)
VFS .chk   : 1064 个（1.5.3=1093 / 中间态基线=1061）
```

**⇒ 热更新**被中断**，`patch.temp` 只写到 34 MB（总 4.64 GB）。**

**⇒ **重开游戏应会续传或重做**（`patch.temp` 是临时文件）。**

**⇒ 我的 mod 改动**已回滚**（`f68ea909…`），不会干扰。**

## 37.7 对项目的影响

| 项 | 影响 |
| --- | --- |
| **能否提前拿到 1.6 内容** | ✅ **只要找到 AES 密钥，就能解密全部 248 个 `.chk_patch` + 210 个整文件** |
| **能否离线应用补丁** | ✅ 有 `hpatchz` 即可（HDiffPatch 是开源工具） |
| **mod 路径** | ✅ 不变（仍是等长替换） |
| **`encryption_index.json` 的价值** | ✅ **447 个文件的 IV 全在手上** |

---

## 37.8 ★★★ 补丁机制完整查明（第 39 轮）

### 37.8.1 `libhpatchz.so` = **HDiffPatch 官方 Android JNI**

**APK 内 `lib/arm64-v8a/libhpatchz.so`（113,512 B）的导出符号：**
```
Java_com_github_sisong_HPatch_patch
Java_com_github_sisong_HPatch_patchAsset
Java_com_github_sisong_HPatch_patchDir
Java_com_github_sisong_HPatch_setAssetPreloadMaxSize
Java_com_github_sisong_HPatch_getAssetPreloadMaxSize
hpatchz_file
hpatchz_dir
hpatchz
```

**⇒ 这是 **`github.com/sisong/HDiffPatch`** 的官方 Android 封装**
**（Java 类 `com.github.sisong.HPatch`，方法 `patch` / `patchAsset` / `patchDir`）。**

**⇒ 完全证实：补丁 = HDiffPatch，**应用器就在 APK 里，可直接复用**。**

### 37.8.2 `libHGP.so` = HyperGryph Patch 辅助库

**APK 内 `lib/arm64-v8a/libHGP.so`（1,449,760 B）的可读符号：**
```
GetConst        ← ★ 可疑：取常量
TestFrom
NoteCache
ReverseStr      ← ★ 可疑：逆转字符串（常见密钥混淆手法）
```

**⇒ **`GetConst` + `ReverseStr` 是 AES 密钥最可能的藏身之处。****
**（对比：1.5.3 的 `.blc` 密钥就是从「加盐 + 逆序 + 逐字节减 master」派生出来的，
同一个团队很可能复用这套手法。）**

### 37.8.3 APK 里的 native 库清单（arm64，28 个）

```
libil2cpp.so        549,013,048 B   Unity 逻辑
libunity.so          30,305,720 B   Unity 引擎
lib_burst_generated.so 16,178,648 B
libHGP.so             1,449,760 B   ★ 补丁辅助（HyperGryph Patch）
libhpatchz.so           113,512 B   ★ HDiffPatch 应用器
libtersafe2.so        5,609,568 B   ACE 反作弊
libcri_ware_unity.so  2,206,520 B   CRIWARE（视频/音频）
libAkSoundEngine.so   4,537,216 B   Wwise 音频
libVkLayer_mfrc.so      218,888 B   Vulkan 层（MFRC）
libframeestimationVK.so 732,304 B   Vulkan 帧插值
… 共 28 个
```

### 37.8.4 ⚠️ 新版 `libil2cpp.so` 的字符串被混淆

```
新版 libil2cpp.so 里搜：
  "Assets/Beyond/DynamicAssets/"  → 未找到（1.5.3 是能找到的）
  "AES-256-CBC" / "PKCS7"         → 未找到
  "encryption_index"              → 未找到
  "CHACHA_KEYS" / "chacha"        → 未找到
```

**⇒ 1.6.4 对 `libil2cpp.so` 的字符串做了**混淆/加密**。**

**⇒ 但 `.blc` 解密仍 6/6 通过 ⇒ **运行时密钥派生仍有效**，
只是**静态字符串被隐藏**了。**

### 37.8.5 完整补丁流程（现已完全确定）

```
① 下载 ZmsRIP_pre_patch.zip.001-005（4.64 GB）
② 从 zip 解出（明文可读）：
     encryption_index.json  ← AES-256-CBC + PKCS7，含 447 个文件的 IV
     patch.json             ← 补丁清单（需 AES 解密）
     Patch/diff_*/*.chk_patch  （248 个，需 AES 解密）
     non_patch_resources/**    （210 个，需 AES 解密）
③ AES-256-CBC + 每个文件对应的 IV 解密
④ 用 HDiffPatch（libhpatchz / hpatchz）把 .chk_patch 应用到 1.5.3 的对应文件
⑤ 写入 VFS
```

### 37.8.6 ★ 唯一缺口：**AES-256 密钥（32 字节）**

**候选位置（按可能性排序）：**
1. **`libHGP.so` 的 `GetConst` / `ReverseStr`**（最可能 —— 与 `.blc` 密钥派生同源手法）
2. **`libil2cpp.so`（但字符串已混淆，需动态抓取）**
3. **登录时从服务器获取**

**下一步建议：**
```
· 反汇编 libHGP.so，定位 GetConst / ReverseStr，看它返回什么常量
· 或在运行时 hook 这两个函数，直接 dump 出密钥
```

### 37.8.7 现有资产清单（可直接复用）

| 资产 | 路径 | 用途 |
| --- | --- | --- |
| **`encryption_index.json`** | `~/.efml4a/scratch/enc/` | **447 个文件的 IV** |
| **`libhpatchz.so`** | `~/.efml4a/scratch/aeskey/` | **HDiffPatch 应用器** |
| **`libHGP.so`** | `~/.efml4a/scratch/aeskey/` | **补丁辅助（密钥候选）** |
| `il2cpp.so`（新版） | `~/.efml4a/scratch/aeskey/` | 549 MB，字符串已混淆 |
| `patch.temp` | `~/.efml4a/scratch/enc/` | HDiffPatch 流样本 |

---

## 37.9 二次更新（第 42 轮）：资源走**明文 CDN**

### 37.9.1 发现

**`HGDownload/update_11010254-4/` 目录：**
```
update_11010254-4.json             251,781 B   更新清单
update_11010254-4-decompress.json    8,259 B   {URL: 大小} 映射
download/      ← 资源包（uuid 名，*.downloading 为未完成）
patch/         ← 补丁
```

### 37.9.2 ★ `decompress.json` 暴露了 CDN 地址

```json
{
  "https://beyond.hycdn.cn/6LL0KJuqHBVz33WK/1.6/resource/Android/main/11010254-4_qJxJZI5fDAGxxzG1/files/VFS/24ED34CF/A3A55477B30BCE71F51209D3987EBA68.chk": 1609209181,
  "https://beyond.hycdn.cn/6LL0KJuqHBVz33WK/1.6/resource/Android/main/11010254-4_qJxJZI5fDAGxxzG1/files/VFS/7064D8E2/AFCDA0EB88B6FDD11B36DE768F19B342.chk": 1257441573,
  …
}
```

**路径格式：**
```
https://beyond.hycdn.cn/{token}/{version}/resource/Android/main/{build}_{hash}/files/VFS/{block}/{uuid}.chk
```

**⇒ **二次更新的资源是明文 CDN 下载，不需要 AES！****
**⇒ 只有**首批预下载**（`ZmsRIP_pre_patch.zip`）才用 AES-256-CBC + HDiffPatch。**

### 37.9.3 两批更新的区别

| 批次 | 位置 | 加密 | 说明 |
| --- | --- | --- | --- |
| **首批预下载** | `gameupdate/preload/1.6/zip/` | **AES-256-CBC + HDiffPatch** | 4.64 GB，需 AES 密钥 |
| **二次更新** | `HGDownload/update_11010254-4/` | **明文 CDN** | 直接下载 `.chk`，无需密钥 |

### 37.9.4 `update_11010254-4.json` 的字段

```
base · downloadData · downloadType · fileId · fileName · patchSize · patchUrl · path
```

### 37.9.5 ⚠️ 合规提醒

**资源 URL 是明文，但按项目红线：**
**⇒ **仅分析结构，不批量下载、不散布任何游戏资源。****

### 37.9.6 下载进度快照（23:02）

```
VFS : 33,051 MB, 1,142 .chk
HG  :    348 MB
  download/242f8bdf-…            164,532,785 B  ✓ 完成
  download/48109bfa-….downloading  44,048,384 B  进行中
  download/63ab9946-….downloading  50,904,845 B  进行中
  patch/  1 个文件
```

**监控脚本：`scripts/monitor-update.sh [间隔秒] [次数]`**
