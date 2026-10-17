---
title: "62. 真实图案 mod 验证成功（非纯色）"
description: "EFML4A 研究文档 · 62-pattern-mod-verified（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 62.1 成果

**用「棋盘 + 对角渐变 + 中心十字」图案替换 `ui_main_menu_logo_icon`，成功渲染上屏。**

```
截图 P04（启动后约 6 秒）:
  纯红像素: 6,763
  空间范围: x[172..568]  y[195..437]
  尺寸: 397×243

对应纹理: ui_main_menu_logo_icon (304×68 ASTC_6x6)
  ⇒ 有 UI 拉伸（397/304 = 1.31x, 243/68 = 3.57x）
```

**⇒ 这证明：不只是纯色，【任意图案】都能正确渲染**

## 62.2 与之前纯色测试的对比

| 测试 | 替换内容 | 检测结果 |
|---|---|---|
| docs/59 | 纯黄 FFFF00 | 44,313 黄像素 |
| **docs/62** | **棋盘红/蓝 + 渐变 + 十字** | **6,763 红像素（397×243）** |

**⇒ 纯色和复杂图案都成功，说明纹理替换链路完全可靠**

## 62.3 完整流程

```
① mkpattern 生成 304×68 TGA（棋盘 + 渐变 + 十字）
② astcenc -cl ... 6x6 -thorough（与原纹理格式一致）
③ 剥离 16 字节头 → 9,792 字节 raw ASTC
④ abpack pad 模式
   · 目标区匹配 TRUE
   · 总长 9,806 不变
⑤ 写入 A47587BA.chk @4,429,838
⑥ blcfix（contentMD5 + CRC32）+ blcsetdata（dataMd5）
⑦ 启动游戏 → 高频截图（1.5s）
⑧ redbox 检测 → 6,763 纯红像素，397×243
```

## 62.4 新增工具

```
tools/vfs/mkpattern.c   生成测试图案（棋盘 + 渐变 + 十字）
tools/vfs/checkrb.c     检测纯红/纯蓝像素
tools/vfs/redbox.c      输出指定颜色的空间范围
```

## 62.5 证据

```
docs/evidence/pattern-visible-P04.png
```

## 62.6 合规

```
仅研究用途 · 等长替换（总长不变、布局不变）
不改游戏数值/存档 · 不用于竞技作弊
不散布游戏资源 · 不实现 ACE 绕过
```
