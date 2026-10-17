---
title: "19 · 事故记录：自建 Zygisk 模块导致 ZygiskNext 全局停机"
description: "EFML4A 研究文档 · 19-zygisk-crash-incident（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

> 本文档是 EFML4A 研究文档集的一部分，索引见 [docs/README.md](/cs/reverse/)。


## 19.1 现象

设备重启后 **LSPosed 无法启动**（管理器显示未安装/未激活），ZygiskNext 的
`module.prop` 描述变为：

```
[❌ Stop zygisk due to crash, ⚠️1 module(s) with issue: efml4a_zygisk,
 Root: ✅KernelSU (32525), UM, ZL, 3 service(s) injected]
```

`/data/adb/zygisksu/basic.txt`（bugreport 内）关键字段：

```
zygote_states:1
zygote_state_0:3,0,0,zygote,3
inject_state:3
modules64:6,zygisk_lsposed,playintegrityfix,zygisk-loader,zygisk_il2cppdumper,hma_oss_zygisk,efml4a_zygisk
modules_with_issue:1,efml4a_zygisk=3@6d61696e
```

`3@6d61696e` 中的 `6d61696e` 是 ASCII `"main"` 的十六进制 ⇒ **错误码 3 @ main**。

## 19.2 根因

**本项目自建的 `efml4a_zygisk` 模块（`android/zygisk-module/`）在 ZygiskNext
装载时崩溃**，ZygiskNext 出于保护机制**主动停掉整个 Zygisk**。
由于 LSPosed 依赖 Zygisk，于是 LSPosed 一并失效。

⇒ **这不是 LSPosed 的问题，也不是 ZygiskNext 的问题，是自建模块的问题。**

## 19.3 与文档 §17 的矛盾及解释

[17](/blog/efml4a-17-zygisk-loader-route/) 曾观察到「`modules_info` 收录了 `efml4a_zygisk`，
却没有任何回调和日志」。当时推测是 `ZYGISK_API_VERSION` 兼容性问题。

**本次事故给出了更好的解释**：该模块**一被装载就崩溃**，
所以既不会产生回调，也不会留下日志；而 ZygiskNext 随后停机，
连带使**同一次实验中的其它注入路线（zygisk-loader、LSPosed）全部失效**——
这解释了此前「四条路线同时零效果」的现象。

## 19.4 处置

1. `ksud module uninstall efml4a_zygisk` + 删除模块目录（**已彻底清除**）
2. 同时把此前被我启用的 `zygisk-loader`、`zygisk_il2cppdumper` **还原为禁用**
   （它们原本由用户禁用，原因未知，先恢复原状以隔离变量）
3. 重启后 Zygisk / LSPosed 应自动恢复（`/data/adb/zygisksu/` 下**没有**
   持久化的停机标志文件，`modules_info` 是开机快照、下次开机会重生成）

## 19.5 教训（写进项目规范）

| 教训 | 具体规则 |
| --- | --- |
| **Zygisk 模块崩溃会全局停机** | 模块的 `.so` 只要在装载阶段崩溃，**整个 Zygisk 连同所有模块一起失效**——排查时必须先怀疑「是不是自己的模块把 Zygisk 干崩了」，而不是怀疑框架 |
| **一次只改一个变量** | 此前同时启用多个模块/payload，导致四条路线一起失效后**无法归因**。今后每次只启用一个新模块并验证 |
| **`modules_info` 收录 ≠ 装载成功** | 该文件只是 `zygiskd` 对文件系统的快照（记录 dev/ino/size），与模块能否被成功装载无关 |
| **自建 Zygisk 模块的风险最高** | 应优先使用**已在本机验证过的**载体（用户的 `zygisk-loader`）；自建模块必须先在**隔离环境**验证，不能在主力机上直接试 |
| **先备份可用状态** | 改动前记录模块启用清单，便于一键还原 |

## 19.6 自建 Zygisk 模块究竟为何崩溃（待查）

`android/zygisk-module/` 的 `.so` 特征：2.7 MB、静态链接 libc++、
`-Wl,--exclude-libs,ALL`、只导出 `zygisk_module_entry`。
作为对照，设备上能正常工作的 `hma_oss_zygisk` 只导出 `zygisk_module_entry`
+ `_ZdlPv`/`_Znwm`，`zygisk-loader` 导出 `zygisk_module_entry` +
`zygisk_companion_entry`。

**未核实**：崩溃是否与静态 libc++ 的初始化顺序、`--exclude-libs,ALL`
抑制了必需符号、或 `ZYGISK_API_VERSION` 取值有关。该模块**已被移除**，
如需继续研究应在隔离设备上进行。

## 19.7 两个补充事实（事后核实）

1. **`zygisk-loader` 与 `zygisk_il2cppdumper` 并非有问题**。
   用户说明：它们是在**工程尾期主动关闭**的（"不想弄了才关掉的"），
   与本次事故无关。已按其说明重新启用。§19.4 第 2 条的做法是**过度推断**，
   在此更正。

2. **LSPosed 当时正处于"更新已暂存、待开机合并"的中间状态**，
   这是它不可用的**直接原因**，与 Zygisk 停机是两个独立问题：

   | 路径 | 内容 |
   | --- | --- |
   | `/data/adb/modules/zygisk_lsposed/` | 只剩 `module.prop` + 空的 `update` 标记 |
   | `/data/adb/modules_update/zygisk_lsposed/` | **完整模块文件**（daemon.apk / framework.dex / …） |

   KernelSU 的更新流程是「新文件放 `modules_update/`，旧目录写 `update` 标记」，
   **只有开机 `post-fs-data` 才合并**。所以 LSPosed 在下次重启前必然不可用。

⇒ **正确的归因**：Zygisk 停机 = `efml4a_zygisk` 模块崩溃（已移除）；
LSPosed 不可用 = 更新待合并（重启即恢复）。**两者都要靠一次真重启解决。**
