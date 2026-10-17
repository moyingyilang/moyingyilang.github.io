---
title: "55. 可见 mod 尝试（标题页 UI 纹理）"
description: "EFML4A 研究文档 · 55-visible-mod-attempt（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 55.1 关键发现：游戏实际加载的 VFS 组

```
游戏启动时唯一打开的 .chk:
  VFS/0CE8FA57/A47587BA5EEF7FD05F1FEC103DEA85BD.chk
  group = "InitBundle"   ← ★ 启动初始化包
  chunk0: len=217,713,773  bt=2  files=1075
  fileInfoNum=1075（全部是 Data/Bundles/Android/initial/*.ab）
```

**之前修改的 `7064D8E2` 组（main bundles）在启动时【完全不加载】。**

## 55.2 InitBundle 中的可见纹理（107 个命中）

| 纹理 | 尺寸 | 格式 | bundle |
|---|---|---|---|
| `UI_VFXbase` | 1024×1024 | ASTC_4x4 | 7f36fc9b…ab |
| `Logo_18_big` | 1012×364 | ASTC_4x4 | 791bff55…ab |
| `login_logo_kr` | 1040×236 | ASTC_4x4 | — |
| `loging_popup_bg_deco02` | 828×468 | ASTC_4x4 | — |
| `loging_popup_bg_deco01` | 800×452 | ASTC_4x4 | — |
| `login_popup_bg_deco04` | 900×324 | ASTC_4x4 | — |
| `ui_main_menu_logo_icon` | 304×68 | ASTC_6x6 | 540d0269…ab |
| `DefaultFont_*_Static Atlas` | 2048×4096 | R8 | 6b29fe3f…ab |

## 55.3 已完成的端到端流程（UI_VFXbase 为例）

```
① astcenc 生成 1024×1024 纯品红 ASTC_4x4（1,048,576 字节）
② abpack 最小改动模式打入（流偏移 6044）
   目标区匹配 = TRUE ✓  总长 1,788,126 不变 ✓
③ 写入 A47587BA.chk @15,100,483（等长）md5 校验 ✓
④ blcfix 更新 chunk0 contentMD5 → 新 CRC 0x04853325 ✓
⑤ blcsetdata 更新 7f36fc9b 的 dataMd5 ✓
⑥ 写回 .blc（md5 匹配）✓
⑦ 启动游戏 → 加载正常、无崩溃 ✓
⑧ 截图采样 → 未见品红 ⚠️
```

## 55.4 结论与下一步

```
✅ 完整写入链路 100% 打通（dataMd5 + contentMD5 + CRC32 全部更新）
✅ 游戏接受修改后的 VFS（无「数据加载失败」、无 tombstone）
⚠️ UI_VFXbase 可能不是登录页【直接显示】的纹理（是 UI VFX 基础贴图）

下一步候选（更可能直接可见）:
  · Logo_18_big (1012×364)      —— 大 logo
  · login_logo_kr (1040×236)    —— 登录 logo
  · loging_popup_bg_deco01/02   —— 登录弹窗背景
  · ui_main_menu_logo_icon      —— 主菜单 logo
  · 或先用 memsearch 在游戏运行时搜索品红模式确认加载
```

## 55.5 新增工具（本轮，全部 C，多线程）

```
tools/vfs/fextract.c     多线程 .blc 文件提取（3.5s / 1075 文件 / 418MB）
tools/vfs/blcsetdata.c   .blc file 条目 dataMd5 更新
tools/vfs/blcfileinfo.c  .blc 文件条目详情 dump
tools/vfs/findchunk.c    全局偏移 → chunk 定位
tools/vfs/chunknames.c   chunk 名提取
tools/vfs/mktga.c        纯色 TGA 生成
tools/vfs/pxsample.c     PNG 像素采样（无需 Python）
```

## 55.6 效率改进

```
并行化:
  · 8 个 abscan 实例并行 → 7.2s 扫描 1075 个 bundle（原单线程 ~60s+）
  · fextract 16 线程 pread → 3.5s 提取 418 MB
  · ms（多线程内存搜索）→ 6.7 GB 秒级

语言: 全部 C / C# / shell，0 个 Python
```
