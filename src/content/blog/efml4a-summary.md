---
title: "EFML4A 全量总结（索引）"
description: "EFML4A 研究索引 —— 已确证事实、mod 路径、工具清单、文档导航、剩余工作"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

# EFML4A 全量总结（索引）

> **Arknights: Endfield Mod Loader for Android**
> 本文是**索引**。详细内容见 `docs/01` ~ `docs/39`，此处只给结论与入口。

## 一句话

把 EFMI(DirectX) mod 资产重打包进 Unity `.ab`，走**等长替换**路径部署。
**已验证成功**（1.5.3 与 1.6.4 各一次），仅差顶点格式对齐。

## 一、已确证的事实

### 1.1 `.blc` 解密（VFS 索引层）

```
密钥     : （已隐去）
算法     : ChaCha20（nonce = blc[0:12]，counter = 1，范围 [12,len)）
CRC32    : 在密文体内（解密后读尾部校验）
⇒ 1.5.3 与 1.6.4 均 100% 适用（6/6 变更块 CRC 匹配）
```

### 1.2 `.chk` 分流

| blockType | 加密 |
| --- | --- |
| `CRID` | 明文视频 |
| `:)xD` | HGCipher（`k=81861667`，`0x9C5A0B29`，seed=u32@off4） |
| `ENC=0` | 明文 Unity 资产 |
| `ENC=1` | XXE1（**未解**） |

### 1.3 `.blc` 结构

```
proto(4)@0 + u64(8)@4 明文
解密后: version(4) unk(4) gname i64 hash u32 fileNum i64 chunkLen
        u8 blockType u32 chunkNum
chunk 头（1.5.3）:
  +0 md5Name(16) +16 md5Content(16) +32 u64 len +40 u32 blockType +44 u8
  +45 u32 fileCount +49 u16 nameLen +51 name
chunk 头（1.6.4）: ★ +45 处多 4 字节 ⇒ fileCount@+49 nameLen@+53 name@+55
chunk 前进量: 紧邻（无尾随字节）
★ .chk 文件名 = chunk 头前 16 字节的 chunkMD5（转大写）
★ 校验: .chk 的 md5 应等于 chunk 头的第 2 个 MD5
```

### 1.4 `.ab` 容器

```
全程明文（熵 3.5–7.6），内层为 Unity SerializedFile + TypeTree（"2021.3.3"）
外层: [前段] [锚点 e5 00 00 01 49 16 00 0b 0a] [固定24B]
      ["2021.3.3"] [构建ID u32] [u16 version=13] [正文]
```

### 1.5 EFMI `.buf` 格式（已完全解出）

```
IB  = uint16[] 三角形列表
VB0 = 16 B/顶点 = 3×float32 位置 + 4 B 打包法线（10:10:10:2 量级）
VB1 = 12 B（部分 8 B）= (u, v, 0) UV
VB2 = 16 B（部分 8 B）= 4×u16 权重 + 4×u16 骨骼索引
不变量: 流大小 / stride == max(IB) + 1   （11/11 组件成立）
```

### 1.6 原生角色模型

```
条目: Data/Bundles/Android/initial/e2cd202a3481b563467135e6.ab (2,399,399 B)
路径: Assets/beyond/intro/model/sk_actor_endminf_…  (sk_ = skinned mesh)
m_Center=(-0.1942,+0.0033,-0.0368)  m_Extent=(+0.0455,+0.1829,+0.0445)
m_BindPose 矩阵区: +8,264..+11,700
顶点区（我们写入处）: +12,800
骨骼名表（61 个）: +288,693
★ 该条目在 1.5.3 与 1.6.4 中【逐字节完全相同】
```

### 1.7 ★ 游戏顶点是**压缩**的（关键）

```
TypeTree 含: m_Compression / m_PackedBitVector / MinMax / m_StreamData
⇒ 顶点不是原始 float32（+12,800 处合理率仅 17.5%，所有 stride <7%）
⇒ 这解释了「模型变了但扭曲」：我们写了 EFMI 的未压缩顶点，
  游戏按压缩格式解读 ⇒ 坐标错乱
```

### 1.8 1.6 补丁机制

```
首批预下载: AES-256-CBC + PKCS7 + HDiffPatch
  IV 表: encryption_index.json（明文，447 个）
  应用器: libhpatchz.so（APK 内，sisong/HDiffPatch 的 JNI）
  ★ 仅缺 AES-256 密钥（候选: libHGP.so 的 GetConst / ReverseStr）
二次更新: 明文 CDN（beyond.hycdn.cn），无需密钥
```

## 二、mod 路径（已验证）

```
原理: 不解析结构，直接在已知数据区做等长覆盖。
      等长 ⇒ .blc 的 {offset,len} 与 CRC32 天然有效 ⇒ 游戏直接采用。
```

| 版本 | 目标 `.chk` | 条目起点 | 写入区 | 结果 |
| --- | --- | --- | --- | --- |
| 1.5.3 | `EAAFEC04…` (175,600,672 B) | 51,364,253 | 51,377,053 | ✅ 模型可见变化 |
| 1.6.4 | `A47587BA…` (217,713,773 B) | 52,233,268 | 52,246,068 | ✅ 已部署 |

**部署流程**：见 `33-tools.md` §33.7 与 `scripts/deploy-mod.sh`

## 三、工具（全部 C / Shell）

| 工具 | 语言 | 功能 |
| --- | --- | --- |
| `tools/vfs/abtool.c` | C | `entropy` `strings` `nodes` `floats` `u16` `f32` `find` **`swap`** |
| `tools/vfs/blcparse.c` | C | 解密 · CRC · 头部 · 双布局 |
| `tools/vfs/bufinfo.c` | C | EFMI `.buf` 分析 |
| `tools/vfs/chkpatch.c` | C | 等长替换 |
| `tools/vfs/deVFS.sh` | Shell | 解密 / 解析 / 提取 |
| `scripts/deploy-mod.sh` | Shell | **一键部署 / 回滚** |
| `scripts/monitor-update.sh` | Shell | 更新监控 |
| `scripts/keepalive.sh` | Shell | 灭屏保活 |
| `scripts/post-update-diff.sh` | Shell | 更新对比 |

## 四、文档导航

| 主题 | 文档 |
| --- | --- |
| 项目定位 | `01-overview.md` |
| EFMI 剖析 / 注入面 | `02` `03` |
| 四条技术路线 | `04` `05` `06` `07` |
| 威胁模型 / 架构 / mod 格式 | `08` `09` `10` |
| 路线图 / 参考 | `11` `12` |
| 真实 mod 分析 | `13` `16` |
| 设备层 / 游戏内验证 | `14` `15` |
| Zygisk 路线 / 崩溃事件 | `17` `19` |
| VFS 与 ACE | `18` |
| 运行时密钥 / 内存提取 | `20` |
| 视频资产 / 索引遍历 | `21` `22` |
| XXE1 / 可读结构 | `23` `24` |
| 全量提取闭环 | `25` |
| mod 可行性 / 路线裁决 | `26` `27` |
| **EFMI `.buf` 格式（最详细）** | **`28`** |
| 1.5.3 基线 / 1.6 准备 | `29` |
| 灭屏保活 | `30` |
| 第 2 阶段交接 / 成功记录 | `31` `32` |
| 工具集 | `33` `35` |
| 1.6.4 更新报告 / 结构变化 | `34` `36` |
| **补丁加密查明** | **`37`** |
| 1.6.4 部署 / 最终验证 | `38` `39` |

## 五、剩余工作

| 优先级 | 任务 |
| --- | --- |
| **高** | **解析游戏的顶点压缩格式** ⇒ 见 §六 |
| **高** | 索引缓冲替换 |
| 中 | 纹理转换（`.dds` BC5/BC7 → Unity `Texture2D`） |
| 中 | 修 `blcparse` 的 1.6.4 多 chunk |
| 低 | 找 AES-256 密钥（`libHGP.so`） |

## 六、★ 下一步（方法论转向）

**静态分析已到极限。建议改用：**

| 方法 | 可行性 |
| --- | --- |
| **① 用现成 Unity 工具**（`AssetStudio` / `UnityPy` / `AssetsTools.NET`）—— 原生支持 `Mesh` 压缩 | **★★★ 最高** |
| ② 运行时 hook `Mesh::GetVertices` dump 解压后顶点 | ★★ 高 |
| ③ 反汇编 `libunity.so` 的 MeshCompression | ★ 低 |

**⇒ 与其自己逆向压缩格式，不如读这些开源工具的 Mesh 解压源码，移植成 C。**

## 七、环境铁坑

| # | 坑 | 对策 |
| --- | --- | --- |
| ① | `python3` 不在 `su -c` 的 root shell 中 | 在 Termux 内做完再 `cp` |
| ② | `su -c cp` 拷成 `root:root 644` | `chmod 666` + `chown u0_a446` |
| ③ | 目标 `.chk` 属 `u0_a443:ext_data_rw 660` | `su -c cp` 出来后 `chmod 666` |
| ④ | `grep` 过滤掉工具报错 ⇒ 假象 | 别过滤 stderr |
| ⑤ | `find -newermt` 在部分 busybox 失效 | 用 `ls -lt` |
| ⑥ | 误判「加密」 | 先跑 `abtool entropy` |
| ⑦ | Unity 版本串可能被截断 | 搜 `2021.3` 短前缀 |
| ⑧ | **`.blc` 变化 ⇒ 目标 `.chk` 换名** | 用 chunkMD5 确认 |
| ⑨ | `/tmp` 不可写 | 用 `$HOME/.efml4a/scratch/` |

## 八、合规

**仅技术研究**：只读分析 + 等长替换；**未改数值/存档**；**未用于竞技作弊**；
**未散布任何游戏资源**（仓库只含工具与方法）；**E（改 APK 重打包）未测试**。

---

**完整细节见 `docs/01` ~ `docs/39`。本文只作索引，避免与各篇重复。**
