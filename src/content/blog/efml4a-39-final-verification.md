---
title: "39. 第 2 阶段最终验证（第 45 轮）"
description: "EFML4A 研究文档 · 39-final-verification（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 39.1 设备状态

| 项 | 值 |
| --- | --- |
| 游戏版本 | **1.6.4**（versionCode 61） |
| 更新状态 | ✅ **完成**（1183 `.chk`，无 `.downloading`，HGDownload 仅剩 1 MB） |
| VFS 大小 | 33,204 MB |
| **mod 状态** | ✅ **在游戏中**（`A47587BA…chk` md5 `f93846d47543c7a8057c26fa87530640`） |
| **`.chk` 改动** | ✅ **仅 1 处**（mod 目标） |
| **`.blc`** | ⚠️ 21/21 全部变化（完整更新重写了所有块，**属正常**） |
| 游戏进程 | 运行中，前台即游戏 |
| 回滚能力 | ✅ `ROLLBACK.sh` + `orig.chk`（md5 `91e6e5e0…`）完好 |

## 39.2 目标逐项核对

| # | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| **[1b]** | 解 VB1/VB2 用途 + VB0 后 4 字节 | 🟡 **部分** | VB0=16B(3×f32位置+4B打包)、VB1=(u,v,0)UV、VB2=4×u16权重+4×u16骨骼索引；**后 4 字节语义仍未定** |
| **[2]** | 找原生角色 `.ab` + 顶点布局 | ✅ **达成** | `sk_actor_endminf`；`m_Center/m_Extent`；骨骼表 61 名；16 B stride |
| **[3]** | **重打包顶点/索引 + 纹理** | 🟡 **部分** | **顶点能注入并被读取；索引对齐未做；纹理未做** |
| **[4]** | **等长替换部署 + 游戏内验证** | ✅ **达成** | 1.5.3 与 1.6.4 各成功一次；用户确认「模型确实变了」 |
| **[5]** | 1.6 更新准备 | ✅ **达成** | 更新已发生；**解密 100% 兼容**；补丁机制（HDiffPatch + AES-256-CBC）查明 |
| **[6]** | 灭屏保活 + 开机自启 | ✅ **达成** | 4 项措施 + boot 自启 + 压测 |

## 39.3 ★ 关键成果汇总

### （1）EFMI `.buf` 格式**完全解出**

```
IB  = uint16[] 三角形列表（Component0_IB 55230B ÷ 2 = 27615 = drawindexed[0].count）
VB0 = 16 B/顶点 = 3×float32 位置 + 4 B 打包
VB1 = 12 B（部分 8 B）= (u, v, 0) UV
VB2 = 16 B（部分 8 B）= 4×u16 权重 + 4×u16 骨骼索引

全流不变量: 流大小 / stride == max(IB) + 1   （11/11 组件成立）
```

### （2）`.ab` 结构摸清

```
全程明文（熵 3.5–7.6，无压缩无加密）
内层 = 标准 Unity SerializedFile + TypeTree（"2021.3.3"）
外层容器 = [前段][锚点 e5 00 00 01 49 16 00 0b 0a][固定24B][version][构建ID][u16=13][正文]
```

### （3）★ 找到原生角色模型

```
条目: Data/Bundles/Android/initial/e2cd202a3481b563467135e6.ab
路径: Assets/beyond/intro/model/sk_actor_endminf_…  （sk_ = skinned mesh）
m_Center = (-0.1942, +0.0033, -0.0368)
m_Extent = (+0.0455, +0.1829, +0.0445)
顶点区: 条目内 +12,800，stride 16 B
骨骼表: 条目内 +288,693（61 个骨骼/网格名）
```

### （4）★ mod 路径**已验证**（1.5.3 与 1.6.4 各一次）

```
等长替换 ⇒ .blc 的 {offset,len} 与 CRC32 天然有效 ⇒ 游戏直接采用
```

### （5）★ 1.6.4 更新完全兼容

```
.blc 解密方案 100% 适用（抽样 5/5 + 6/6 变更块 CRC 匹配）
.blc 结构变化: chunk 头 +45 处多 4 字节（version 4→5）
```

### （6）★ 补丁机制查明

```
首批预下载: AES-256-CBC + PKCS7 + HDiffPatch（libhpatchz.so 就在 APK 里）
           IV 表在 encryption_index.json（明文，447 个）
           仅缺 AES-256 密钥（候选: libHGP.so 的 GetConst / ReverseStr）
二次更新  : 明文 CDN（beyond.hycdn.cn），无需密钥
```

### （7）工具全部 **C / Shell 化**

```
abtool.c        C   entropy/strings/nodes/floats/u16/f32/find/swap
blcparse.c      C   解密/CRC/头部/双布局（1.5.3 完整 6/6 + 1.6.4 InitBundle）
chkpatch.c      C   等长替换
deVFS.sh        Shell  解密/解析/提取
monitor-update.sh / keepalive.sh / post-update-diff.sh   Shell
```

## 39.4 ⏭️ 剩余工作（「差一步」）

| 优先级 | 任务 | 说明 |
| --- | --- | --- |
| **高** | **顶点顺序对齐** | 当前直接覆盖前 N 个顶点 ⇒ 索引指向错位 ⇒ 扭曲。需按游戏的顶点顺序重排 EFMI 顶点 |
| **高** | **索引缓冲替换** | 让 EFMI 的三角形索引与 EFMI 顶点配套 |
| 中 | 纹理转换 | `.dds`(BC5/BC7) → Unity `Texture2D` 格式 |
| 中 | 1.6.4 多 chunk 布局 | `blcparse` 对 1.6.4 的 Video/Bundle 仍失败（**不影响 mod**） |
| 低 | VB0 后 4 字节语义 | 用 EFMI shader 反推 |

## 39.5 合规声明

**全程仅技术研究：**
- ✅ 只读分析 + 等长替换（**未修改任何游戏数值/存档**）
- ✅ **未用于竞技作弊**
- ✅ **未散布任何游戏资源**（仓库只含工具与方法；原始资源全部保留在本地）
- ✅ E（改 APK 重打包）**未测试**
