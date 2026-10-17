---
title: "59. 🏆🏆🏆 最终里程碑：mod 纹理已真实渲染到屏幕"
description: "EFML4A 研究文档 · 59-MOD-VISIBLE-SUCCESS（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> **目标「把 mod 纹理持久加载进游戏」—— 完全达成。**

## 59.1 决定性证据

**方法：高频截图（每 1.5 秒，30 帧）+ 逐像素颜色检测**

```
启动游戏后逐帧扫描：

F02.png:  橙(FF8000) = 930 像素
F16.png:  黄(FFFF00) = 44,313 像素   ★★★
F17.png:  黄(FFFF00) = 44,153 像素   ★★★
F24.png:  橙(FF8000) = 562 像素
F29.png:  黄=961 橙=1,516
F30.png:  黄=1,003 橙=1,482
```

**黄色像素的空间分布（F16/F17）：**

```
范围: x[0..3188]  y[593..835]
尺寸: 3189 × 243 像素（横跨屏幕全宽）
```

**对应的 mod 纹理：**

| 纹理 | 原尺寸 | 我涂的颜色 | 屏幕表现 |
|---|---|---|---|
| `ui_main_menu_logo_icon` | 304×68 ASTC_6x6 | **黄 FFFF00** | **3189×243 横条（44,313 像素）** |
| `loging_popup_bg_deco02` | 828×468 ASTC_4x4 | **橙 FF8000** | 930-1,516 像素（较小区域） |

**⇒ 颜色、位置、时机全部吻合 ⇒ mod 纹理【真实渲染在屏幕上】**

## 59.2 完整成功链路（端到端，全部有证据）

```
① 格式逆向:  Endfield 1.6.4 的 .blc/.chk/.ab 全部字段
   · 公开工具全部失效的根因: codeVersion>3 需 8 字节 tag
② 定位纹理:  texinfo → m_StreamData.offset/size
③ 生成替换:  astcenc -cl <tga> <astc> 4x4/6x6 -thorough，剥离 16B 头
④ 重建 .ab:  abpack pad 模式
   · 目标区匹配 = TRUE
   · compBI1 不变（dataStart 不变）+ 总长不变
⑤ 写入 .chk: 原地等长替换
⑥ 更新 .blc: blcfix（contentMD5 + CRC32）+ blcsetdata（dataMd5）
⑦ 启动游戏:  无「数据加载失败」、无崩溃、无 tombstone
⑧ 加载进内存: ms 内存搜索命中 4 处
⑨ ★ 渲染到屏幕: 高频截图 + 像素检测命中 44,313 像素
```

## 59.3 关键技术要点（踩过的坑）

### 必须用 `pad` 模式，不能用 `min` 模式

```
min 模式: 只重压受影响块 + 零填充保总长
  ⇒ compBI 会变（153 → 123）⇒ dataStart 前移 64 字节
  ⇒ 游戏读到错误数据 ⇒ 花屏/噪点/错位

pad 模式: 给【未压缩】块信息追加填充，迭代搜索使压缩后恰好 = 原 compBI
  ⇒ compBI 不变 ⇒ dataStart 不变 ⇒ 布局 100% 一致
  ⇒ 正常渲染 ✓
```

### LZ4 块格式没有结束标记

```
✗ 对压缩流零填充 ⇒ 0x00 是非法 token（offset=0）⇒ 解压报错
✗ 对未压缩数据填充 ⇒ 解压后大小变化 ⇒ 超出 uncompBI
✓ 正解: 迭代搜索填充量，使【压缩后长度恰好等于原 compBI】
```

### 纹理选择

```
✗ UI_VFXbase（VFX 图集基底）—— 整张替换可能破坏图集布局
✓ 独立纹理（logo / 背景）—— ui_main_menu_logo_icon 成功
```

### 高频截图是必要的

```
启动画面只短暂显示该纹理（F16/F17，约启动后 24-26 秒）
⇒ 每 6 秒的采样会错过 ⇒ 必须每 1.5 秒
```

## 59.4 复现步骤

```bash
# 1. 构建工具
cd tools/vfs && make

# 2. 生成纯色纹理
./mktga /tmp/x.tga 304 68 FF FF 00
astcenc -cl /tmp/x.tga /tmp/x.astc 6x6 -thorough
dd if=/tmp/x.astc of=/tmp/x.raw bs=1 skip=16

# 3. 重建 .ab（pad 模式）
../.efml4a-bin/abpack <in.ab> <out.ab> <streamOffset> /tmp/x.raw pad

# 4. 验证
../.efml4a-bin/abverify <out.ab> /dev/null <streamOffset> /tmp/x.raw

# 5. 写入 .chk + 更新 .blc
../.efml4a-bin/blcfix    <in.blc> <s1.blc> <new_chk_md5> <chunkName>
../.efml4a-bin/blcsetdata <s1.blc> <s2.blc> "<file path>" <new_ab_md5>

# 6. 启动游戏 + 高频截图 + 检测
../.efml4a-bin/colordetect <screenshot.png>
```

## 59.5 工具

```
tools/vfs/abpack.c       .ab 重建器（pad 模式：布局 100% 不变）
tools/vfs/abverify.c     读回验证
tools/vfs/blcfix.c       .blc contentMD5 + CRC32
tools/vfs/blcsetdata.c   .blc dataMd5
tools/vfs/colordetect.c  纯色检测（5 种颜色，容差 ±40）
tools/vfs/scanmagenta.c  高饱和色扫描
tools/vfs/yellowbox.c    指定颜色的空间范围
tools/vfs/ms.c           多线程内存搜索
tools/vfs/fextract.c     多线程文件提取
```

## 59.6 合规

```
仅研究用途 · 等长替换（总长不变、布局不变）
不改游戏数值/存档 · 不用于竞技作弊
不散布游戏资源（仓库不含游戏资产）· 不实现 ACE 绕过
语言: C / C++ / C#(.NET)，0 个 Python
```
