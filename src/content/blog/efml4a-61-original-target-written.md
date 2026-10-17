---
title: "61. 原目标写入成功：prts_sm2l3m5_eyemask（普瑞赛斯眼罩）"
description: "EFML4A 研究文档 · 61-original-target-written（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 61.1 成果

**用第一阶段验证的完整链路（pad 模式 + v4 压缩器）成功写入原目标纹理。**

```
目标:   prts_sm2l3m5_eyemask  256×256 ASTC_4x4（65,536 字节）
位置:   Data/Bundles/Android/main/b9f6b1e125af334294db948d.ab
        @798C1F6A08C7CEBD826F1F86809A30E7.chk（本地偏移 206,810,161）
流偏移: 3,869,352（块 29，块内 68,264）
```

## 61.2 关键技术发现：`align16` 让 compBI 变化「无害」

```
原始 compBI = 326  → align16(326) = 336 → dataStart = 48+336 = 384
补丁 compBI = 329  → align16(329) = 336 → dataStart = 48+336 = 384

⇒ ★ 虽然 compBI 变了（326→329），但 dataStart【完全不变】
⇒ 这是 pad 模式之外的另一条安全路径：
   只要 compBI 变化不跨越 16 字节边界，布局就不受影响
```

**实测验证：**

```
abverify 读回:
  原始: dataStart=384
  补丁: dataStart=384   ✓

全流对比:
  流长度: 5,704,360 == 5,704,360  ✓
  首个差异: char 3,869,363 = 目标区起点 + 11  ✓
  总差异: 44,852 字节（在目标区 65,536 内）  ✓
```

## 61.3 完整流程（含踩坑）

```
① abpack pad 模式（或只要 align16 不变即可用 min 语义）
   · 目标区匹配 = TRUE
   · 总长不变（2,438,868）
② 写入 .chk（等长，偏移 206,810,161）
③ blcfix  → 更新 chunk contentMD5 + CRC32
④ blcsetdata → 更新 file dataMd5
⑤ 写回游戏
⑥ 启动 → 无崩溃、无新 tombstone ✓
```

## 61.4 ★ 重要踩坑：备份文件权限

```
现象: blcfix 报 "FORTIFY: fseeko: null FILE*" 并静默失败
原因: 备份文件是 root 所有（rw-r-----），Termux 无权读取
      ⇒ fopen 返回 NULL ⇒ 后续操作崩溃

修复:
  su -c "cp <backup> <workdir>/orig.blc && chmod 666 <workdir>/orig.blc"

⇒ 任何从 su 环境复制的文件都必须 chmod，否则工具会静默失败
```

## 61.5 当前状态

```
✅ 写入成功，游戏接受（无崩溃）
⏳ 视觉验证未完成
   · 原因: 7064D8E2 组（main bundles）在【启动时不加载】
   · 只有 InitBundle（0CE8FA57）在启动时加载
   · 普瑞赛斯眼罩需要游戏进入实际场景才会加载
```

## 61.6 下一步

```
[A] 用真实 mod 图片重做（当前用的 test_eye_raw.astc 是测试图案）
    · 需要 BC7 → RGBA 解码器（或直接用 PNG/TGA）
    · astcenc 支持 TGA/PNG/DDS/EXR
[B] 或先在 InitBundle 里验证视觉（已证明可行，见 docs/59）
[C] 或攻 Unity 网格压缩（docs/57 卡点 3）
```

## 61.7 合规

```
仅研究用途 · 等长替换（总长不变、dataStart 不变）
不改游戏数值/存档 · 不用于竞技作弊
不散布游戏资源 · 不实现 ACE 绕过
语言: C / C++ / C#(.NET)，0 个 Python
```
