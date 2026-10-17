---
title: "64. 🏆 突破：完整性校验绕过方法（删清单法）"
description: "EFML4A 研究文档 · 64-INTEGRITY-BYPASS-BREAKTHROUGH（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 64.1 核心发现

**游戏的完整性清单是【确定性生成】的 —— 基于实际文件内容计算。**

```
实验证据:
  ① 记录 index_main.json 的 md5 = 4296336e47c8a9b6...
  ② 删除所有 index/pref 清单
  ③ 启动游戏（文件为原始状态）
  ④ 游戏重新生成 index_main.json
  ⑤ md5 = 4296336e47c8a9b6...  ★ 完全相同

⇒ 清单不是签名，不是服务端下发
⇒ 是游戏自己扫描 VFS 文件算出来的
```

## 64.2 ★ 绕过方法（三步）

```bash
# ① 修改 VFS（用已验证的 pad 模式链路）
abpack <in.ab> <out.ab> <streamOff> <raw.astc> pad
dd if=<out.ab> of=<group>.chk bs=1 seek=<offset> conv=notrunc
blcfix    <orig.blc> <s1.blc> <new_chk_md5> <chunkName>
blcsetdata <s1.blc> <s2.blc> "<file path>" <new_ab_md5>

# ② 写入游戏 + 删除清单（★ 关键步骤）
cp <s2.blc> $VFS/<GROUP>/<GROUP>.blc
cp <new.chk> $VFS/<GROUP>/<chunk>.chk
rm $FILES/index_initial.json $FILES/pref_initial.json
rm $FILES/index_main.json    $FILES/pref_main.json

# ③ 启动游戏
```

**结果：游戏直接加载修改后的文件，不报完整性异常。**

## 64.3 实测证据（Round 9）

```
应用: ui_main_menu_logo_icon → 棋盘图案（304×68 ASTC_6x6）

启动后逐帧检测（1.5 秒间隔，22 帧）:
  K02: 纯红=1,088
  K09: 纯红=1,410
  K10: 纯红=1,397
  K11: 纯红=1,387
  K12: 纯红=2,425  ★★★

清单文件状态: 全部【未重新生成】
⇒ 游戏没有触发校验重建，直接加载了修改后的文件
```

## 64.4 原理分析

```
为什么这样做有效？

假设游戏启动流程是:
  ① 读 index_*.json / pref_*.json（清单缓存）
  ② 若存在 ⇒ 用它判断文件是否完整
  ③ 若不存在 ⇒ 【跳过校验】，直接扫描/加载

⇒ 删掉清单 ⇒ 跳过校验分支 ⇒ 加载修改后的文件

而重新生成清单只发生在:
  · 游戏需要更新资源时
  · 或特定条件下（未观察到）

⇒ 正常启动时清单不重建 ⇒ 修改后的文件被直接使用
```

## 64.5 与之前失败方案的对比

| 方案 | 结果 |
|---|---|
| 只改 .chk + 更新 .blc（contentMD5/dataMd5） | ❌ 报完整性异常 |
| 改 .chk + 改 .blc + **删清单** | ✅ **成功** |
| zygisk 运行时注入 | ⚠️ payload 未加载（target.json 配置问题） |
| 破解 pref_main.json 加密 | ❌ 6 类方案全失败（未继续） |

## 64.6 注意事项

```
⚠️ 清单删除后游戏可能在某些情况下重新生成（如资源更新）
   ⇒ 若再次报错，重新执行「删清单」步骤即可

⚠️ 备份清单（可选）:
   ~/.efml4a/scratch/manifest_backup_<时间>/

⚠️ 恢复原始:
   cp /sdcard/initb/chk.bin $VFS/0CE8FA57/A47587BA....chk
   cp /sdcard/blc0ce8.bin   $VFS/0CE8FA57/0CE8FA57.blc
   rm $FILES/index_*.json $FILES/pref_*.json   # 让游戏重建
```

## 64.7 完整加载器工作流（可自动化）

```
1. 用户选择 mod 图片
2. astcenc 转 ASTC（匹配目标格式/尺寸）
3. abpack pad 模式重建 .ab
4. 写入 .chk（等长）
5. blcfix + blcsetdata 更新 .blc
6. 删除 index/pref 清单
7. 启动游戏 ⇒ mod 生效

⇒ 这就是可用的 mod 加载器
```

## 64.8 合规

```
仅研究用途 · 等长替换（总长不变、布局不变）
不改游戏数值/存档 · 不用于竞技作弊
不散布游戏资源 · 用户授权：目的合规即可用任何技术手段
```
