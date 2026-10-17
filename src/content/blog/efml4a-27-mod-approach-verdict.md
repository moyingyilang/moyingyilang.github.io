---
title: "27. mod 加载方案 A→F —— 最终裁定"
description: "EFML4A 研究文档 · 27-mod-approach-verdict（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 本文是 EFML4A 研究项目的**方案层总结**。
> 前置：`docs/25-full-vfs-extraction-closed-loop.md`（VFS 全量解析闭环）、
> `docs/26-mod-loading-feasibility.md`（逐轮实测记录，§26–§29）。

## 27.1 结论速览

| 方案 | 名称 | 裁定 | 依据 |
| --- | --- | --- | --- |
| **A** | 纯文件替换（`.blc`+`.chk`） | ✅ **数据层成立**（铁证） | §28：改 `.chk` 后 `Temp/` 解包 md5 与期望**完全一致** |
| **B** | Hook 读取流 `GetAssetStream` | 🟡 **payload 就绪，未上机** | §26.12：`libefml4a_hookb.so` 6,848 B 编译通过；需重启设备才能注入 |
| **C** | Hook 校验器 `BlockValidator` | ⬜ **静态分析完成：不必要** | §26：`BlockValidator` 只收集**缺失块**（`CollectAllMissedChunks`），**不校验内容 MD5** |
| **D** | HotFix 本地挂载 | 🟡 **机制摸清，未走通** | §26.13：`ClientData/Local` 非挂载点；发现 `files/Temp/` 为**明文解包暂存区** |
| **E** | 改 APK 重打包 | ⛔ **按要求不测** | — |
| **F** | `SIGSTOP`+`/proc/pid/mem` 内存写 | 🟡 **技术成立，有限制** | §26.11：能改 UI 文本；**扩写会溢出崩溃，只能等长** |

## 27.2 方案 A：纯文件替换 —— **成立**

### 决定性证据（§28.1）

```
目标 : D6E622F7/ExtendData → Data/ExtendData/Main/StringPathHash.bin
       offset=18,783,262  len=158,639,432
改动 : 该文件末尾 32 字节翻转 0xFF —— 【长度完全不变】，.blc【完全不动】
观测 : files/Temp/ 中游戏启动时解包出的明文文件 md5

期望 md5 = 7aa8df5eedaf46a1a77b3f64242adb84
实测 md5 = 7aa8df5eedaf46a1a77b3f64242adb84        ⇒ ★ 完全一致 ★
```

**⇒ 游戏确实读取并采用了我们修改的 `.chk`。**

### 唯一可靠的操作路径（本项目最重要的实践结论）

```
✅ 成功：等长改内容 + .blc 完全不动
❌ 失败：改长度   + 重写 .blc（CRC32 / 重加密 / fileDataMD5）
```

**原因**：`.blc` 记录每个文件的 `{offset, len}`。**等长替换时索引天然有效**；
一旦改长度就必须重写索引，引入的变量过多（重加密、CRC32、`fileDataMD5`、
chunk 边界），任一环节出错都会让游戏拒绝。

**工具**：`tools/vfs/chkpatch.c`
```
chkpatch flip    <chk> <off> <len> [step] [xor]    等长破坏（验证读取）
chkpatch splice  <dst> <dOff> <src> <sOff> <len>   等长互换（做 mod）
chkpatch hex     <chk> <off> <hexbytes>            等长写字节
chkpatch restore <chk>                             从 .orig 一键还原
```

### 已上机的 6 处验证（§29）

5 个 `UI/Snapshot` 角色动画 + 1 个「瘴气」指南视频，全部**等长**替换，
`55FC21C6.blc` **全程未改动**。

## 27.3 方案 B：Hook 读取流 —— payload 就绪，未上机

**目标**：`VirtualFileSystem.GetAssetStream(ref FVFBlockFileInfo)` @ RVA `0xb385bc0`

**实现**：ARM64 16 字节绝对跳转内联 hook
```asm
; target 前 16 字节:
ldr x16, #8
br  x16
.quad hook_entry
; hook_entry: 保存 x0/x1 → bl hook_impl → 执行被覆盖的 4 条原指令 → 跳回 target+16
```
**产物**：`tools/zygisk/payload-hookb.c` → `libefml4a_hookb.so`（6,848 B，
`hook_entry` T 0x4884 / `hook_impl` T 0x48a0）

**编译三坑**：
1. 必须 **`-nostdlib`** —— NDK 的 aarch64 sysroot **没有 `libunwind.a`**
2. `-nostdlib` 后未定义符号由**宿主 libc** 解析（注入场景正常）
3. `hook_impl` 不能 `static`，否则成未定义符号导致加载失败

**未上机的原因**：`zygisk-loader` 走 Zygisk 回调（`preAppSpecialize`），
但其 companion 在 **zygote 启动时**加载 ⇒ 改 `target.json` 后**必须重启设备**；
而 `ksud soft-reboot` 会**杀掉 ZygiskNext**（本项目文档 §18 有记录）⇒ 不可用。

**当前已回滚**：`target.json = []`，payload 已从设备移除。

## 27.4 方案 C：Hook 校验器 —— **静态分析表明不必要**

`BlockValidator.TryGetResult` @ `0xb38128c` 的职责是
**收集并报告缺失的块**（`CollectAllMissedChunks` @ `0xb38afd8`），
**对已存在块的内容不做 MD5 校验**。

**⇒ 既然加载路径上没有内容校验，方案 C 没有实施价值。**
（这也解释了为什么方案 A 的等长替换能被直接采用。）

## 27.5 方案 D：HotFix 本地挂载 —— 机制摸清，未走通

**已排除**：
- `files/ClientData/Local/` —— 普通配置目录（`Default.json`），**非 VFS 挂载点**
- `index_*.json` / `pref_*.json` —— **均加密**，无路径关键字
- `/proc/<pid>/maps` 中**无** `.chk`/`.blc` 文件映射 ⇒ **不走 mmap**，用普通文件 IO

**意外收获（`files/Temp/`）**：
```
UUID 命名的暂存文件，大小与 VFS 映射的 len 精确吻合：
  457,018     → Data/ExtendData/Initial/InitStringPathHash.bin
  158,639,432 → Data/ExtendData/Main/StringPathHash.bin
  17,909,576  → Data/ExtendData/Main/FacBone/FacBoneTRS.bin
样本熵 = 3.896 bits/byte  ⇒ 【明文】
```
**⇒ 游戏启动时把 `.chk` 内容**解密/解包成明文单文件**放在 `Temp/`。
生命周期：每次启动**重新解包**（UUID 会变，内容 md5 不变）。**

**⇒ 这给了方案 A 一个免注入、免重置的**观测手段**（本轮就是靠它拿到铁证的）。**

## 27.6 方案 F：内存写 —— 技术成立，但只能等长

**已验证的能力**：
- `/proc/pid/mem` **写权限实测通过**（`pwrite` 成功，游戏无感）
- **能原地改写 il2cpp `System.String`**：把内存中「伊冯」改成「Yvone」，
  UTF-16 命中 4 处全部改写成功

**限制（根因：缓冲区溢出）**：
```
il2cpp System.String 布局:
  +0x10  int32 length      ← 字符数
  +0x14  char[] chars      ← 恰好 length*2 字节，【无余量】

「伊冯」= 2 字符 = 4 字节缓冲区；「Yvone」= 10 字节
⇒ 多写 6 字节越界 ⇒ 后续 GC/访问时崩溃
（即使同步把 length 改成 5，物理缓冲区仍是 4 字节，内存照样被破坏）
```

**⇒ 与方案 A 的结论一致：**等长才行**。**
（若要真正扩写，需 `il2cpp_string_new_utf16()` 分配新串并重指向所有引用，风险高。）

## 27.7 关键转折：用户的 mod 其实是 **EFMI** 格式（§27 详述）

**原判断「mod 属 3DMigoto、非终末地」部分错误**：

| Mod | 归属 |
| --- | --- |
| `edmin_maid.zip` | ✅ 终末地 **EFMI** mod（`; EFMI ALPHA-13 INI`） |
| `prts_pupil.rar` | ✅ 终末地 **EFMI** mod |
| `nom_liino_*` | ❌ 非 EFMI |

**EFMI 需要的是渲染层 draw call 拦截（Vulkan），不是文件替换。**

```
EFMI mod（.ini + .buf + .dds）
      ↓ 由
移动版 3DMigoto（StarBobis/NBPM-Package / "Better Endfield"）
      ↓ 挂钩 Vulkan
vkCmdDrawIndexed
      ↓ 以 $object_guid / $mesh_vertex_count 识别
替换 VB/IB + 纹理
```

**⚠️ `SpectrumQT/EFMI-Package` 的 release 包是 **PC 版**：**
`d3dx.ini` 里 `target = Endfield.exe` / `module = d3d11.dll` /
`launch = C:\Program Files\GRYPHLINK\games\EndField Game\Endfield.exe`。

## 27.8 最终判断

| 想做的事 | 该走哪条路 |
| --- | --- |
| **替换视频 / 音频 / 文本 / 贴图等「文件形态」资源** | ✅ **方案 A + `chkpatch` 等长替换**（已验证） |
| **替换 3D 模型 / 角色外观（EFMI mod）** | ⚠️ **渲染层路径**（Vulkan 层 / 移动版 3DMigoto）—— 本项目**未实现** |
| 绕过内容校验 | ❌ 不需要（加载路径上**没有**内容校验） |
| 注入 hook | 🟡 可行但需重启设备；`soft-reboot` 会杀 ZygiskNext |

## 27.9 遗留与建议

1. **方案 A 的可见效果**：需要用户在游戏内确认（角色界面动画是否花屏）
2. **若要做 EFMI 类 mod**：应在 `vulkan-layer/` 中实现
   `vkCmdDrawIndexed` 拦截 + `object_guid` 匹配 —— 这是**独立的一大课题**
3. **1.6 补丁**：`HGGameUpdate/gameupdate/preload/1.6/` 已预下载 4.64 GB，
   但载荷（`patch.json` / `.chk_patch` / `non_patch_resources/*`）**另有加密层**，
   密钥未破；从目录命名看**格式与 1.5.3 一致**，只是多了一层补丁加密

## 27.10 合规声明

全程遵守项目红线：
- **只读取/分析**，未修改游戏数值与存档
- 未用于竞技作弊
- **未散布任何游戏资源**（仓库只含工具与方法，原始路径清单与资源全部留在本地）
- 仅用于技术研究
