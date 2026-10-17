---
title: "✅ 成功的改动记录（第 29 轮）"
description: "EFML4A 研究文档 · 32-success-record（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 结论：模型确实变了（用户反馈「差一步美满」）

## 具体操作

| 项 | 值 |
| --- | --- |
| 目标文件 | `VFS/0CE8FA57/EAAFEC0435EC71FFC65D8CF3E4595852.chk` |
| 目标条目 | `e2cd202a3481b563467135e6.ab`（角色模型 sk_actor_endminf） |
| 条目块内偏移 | 51,364,253 |
| 写入位置 | 块内 **51,377,053**（条目起点 + 12,800） |
| 写入内容 | EFMI `edmin_maid/Meshes/Component0_VB0.buf` 前 126,576 字节 |
| 写入量 | **7,911 顶点 × 16 B = 126,576 字节** |
| 方式 | **等长替换**（`.blc` 完全不动） |
| 改后文件 md5 | `50ccba83ba3c926afc549eac69c4225a` |
| 原文件 md5 | `f68ea9095c7e7f5c78439e1d6763a5e9` |

## 为什么成功

```
EFMI VB0   = 16 B/顶点（3×f32 位置 + 4B 打包）
游戏顶点区 = 16 B/顶点（4×f32）
⇒ stride 一致 ⇒ 可直接按 16 B 对齐写入
⇒ 等长 ⇒ .blc 的 {offset,len} 与 CRC32 天然有效
```

## 待完善（「差一步」的那一步）

1. **顶点顺序 / 索引对齐** —— 当前是「直接覆盖前 7911 个顶点」，
   游戏原模型的顶点顺序与 EFMI 的不同 ⇒ 模型扭曲
2. **需要**：
   - 读出游戏模型各 `Mesh` 的 `m_VertexCount` / `m_IndexCount`
   - 按组件（Component0..10）分别写入对应区域
   - 可能需要重排索引

## 复用方式

```bash
# 直接把这个文件推到设备（等长，可逆）
su -c "cp ~/.efml4a/v153_baseline/success_payload/mod_initbundle.chk \
       /sdcard/Android/data/com.hypergryph.endfield/files/VFS/0CE8FA57/EAAFEC0435EC71FFC65D8CF3E4595852.chk"
```

---

## 附：第 29 轮「模型确实变了」的判定

**用户反馈：**「差一步美满」

**⇒ 含义：游戏内模型**确确实实发生了变化**，只是不完美（顶点顺序/索引未对齐）。**

**⇒ 这**第一次证明了**整条路径成立：**

```
EFMI(DirectX) mod 资产
   ↓ 读取 .buf（IB/VB0/VB1/VB2，已解出格式）
   ↓ 取 VB0 顶点数据（16 B/顶点）
   ↓ 等长写入游戏 .chk 的顶点区（+12,800）
   ↓ 游戏加载并渲染
   ↓ ★ 模型发生变化 ★
```

**⇒ 剩下的「一步」是**顶点顺序与索引对齐**的工程问题，
不再是「路径是否可行」的问题。**

## 更新前的状态（第 30 轮）

```
设备版本    : 1.5.3 (versionCode=50)，1.6 补丁已下载未应用
VFS         : 1093 .chk / 21 .blc  ← 与 1.5.3 基线完全一致
.blc md5    : 21 个全部与基线一致 ✓
我们的改动  : ✓ 全部回滚（InitBundle / ExtendData / Video / UI-Snapshot）
成功记录    : ~/.efml4a/v153_baseline/success_payload/
              （含 mod_initbundle.chk + README）
```

**⇒ 设备处于**干净的 1.5.3 状态**，可以安全接受 1.6 更新。**

## 更新后的第一件事

```bash
bash ~/.efml4a/scripts/post-update-diff.sh
```

**它会报告：**
- `.blc` md5 是否变化（决定解密密钥/结构是否仍适用）
- `.chk` 增删情况
- APK 是否更新（决定是否需要重新定位 RVA）
- 解密验证是否通过（抽样 5 个 `.blc` 做 CRC 校验）
