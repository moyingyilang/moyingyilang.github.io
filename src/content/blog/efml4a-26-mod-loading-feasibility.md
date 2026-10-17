---
title: "26 · Mod 加载方案实机可行性测试"
description: "EFML4A 研究文档 · 26-mod-loading-feasibility（Arknights: Endfield Mod Loader for Android）"
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


## 26.1 方案清单与结论

| # | 方案 | 注入点 | 状态 |
| --- | --- | --- | --- |
| **A** | **纯文件替换** | 无 hook，重写 `.blc`+`.chk` | ✅ **实机验证成功（容器层）** |
| **B** | Hook 读取流 | `VirtualFileSystem.GetAssetStream` `0xb385bc0` / `0xb3857e0` | 注入点已定位 |
| **C** | Hook 校验器 | `BlockValidator.TryGetResult` `0xb38128c` | 已确认只查缺块、不校验内容 |
| **D** | HotFix 挂载 | `InitMountFromLocalFile` `0xb37fb38` / `AppendMountFromLocalFile` `0xb380880` / `_MountLocalVFSType` `0xb380194` | 接口已定位 |
| **E** | 改 APK 重打包 | `assets/VFS/` | **按要求不测** |
| **F** | `SIGSTOP`+`/proc/pid/mem` 内存写 | — | ✅ **写权限实测通过** |

## 26.2 方案 A：离线构造验证

| 测试 | 对象 | 结果 |
| --- | --- | --- |
| `.blc` 解密 | 21 个块 | ✅ 21/21 |
| `.blc` 完整重建 | 解码→解析→**从零序列化**→CRC32→重加密 | ✅ **6/6 逐字节完全一致** |
| CRC32 校验和 | `crc32(body[12, size-4))` | ✅ **6/6 吻合** |
| 字段修改后重建 | 改 `len` 后回读 | ✅ **3/3** 结构合法、CRC 通过 |
| **`fileDataMD5` 语义** | — | ✅ **= 条目内容的纯 MD5**（实测吻合，可正确重算） |

## 26.3 方案 A：实机应用与验证 ★

**测试设计**：交换两段**不同内容**的指南视频（保持槽位长度不变，尾部补零）

```
槽位 : Data/Video/Mobile/Guide/Common/guide_video_008_miasma.usm      (765,280 B)
内容 : Data/Video/Mobile/Guide/Common/guide_video_aurora_chartrain01_02_01.usm (521,984 B)
chk  : cb6ef51ff35435bd8c0a3e8352b11073.chk
blc  : 55FC21C6.blc
```

**构造步骤**：抽取槽位 `.chk` → 覆写为源视频内容 + 尾部补零 → 更新 `.blc` 的
`fileDataMD5` → 重算 CRC32 → 重新 ChaCha20 加密 → 落盘（**先完整备份**）

**实机验证方法**：`SIGSTOP` 冻结游戏 + 24 线程扫描 `/proc/pid/mem`，
搜索「mod `.blc` 解密后的唯一 32 字节特征」

| 搜索目标 | 内存命中 | 判定 |
| --- | --- | --- |
| **mod `.blc` 解密后特征** | **6 处** | ★★★ **与解密后出现次数 1:1 吻合** |
| aurora 视频内容 | 0 | 视频按需加载，未播放故不在内存 |
| 原始 miasma 视频内容 | 0 | 同上 |

**⇒ 结论：游戏 ① 读取了重写的 `55FC21C6.blc` ② 成功解密 ③ 载入内存
④ 接受了新计算的 CRC32。**

**游戏全程（pid 1672）存活，扫描 6.16 GB，ACE 未干预。**

## 26.4 方案 F：内存写权限实测

```
/proc/<pid>/mem:
  O_RDONLY : fd=3 errno=0
  O_RDWR   : fd=4 errno=0            ★ 可写
  pwrite   : 返回 4096               ★★★ 写成功
  回读确认 : 数据未改变              ✓ 空操作安全
  测试后   : 游戏进程存活            ✓ 未被影响
```

**⇒ 方案 F 可行，且内存写掉电即失、完全可逆。**

## 26.5 可复现工具

| 工具 | 用途 |
| --- | --- |
| `blcbuild.c` | `.blc` 完整重建往返验证（逐字节比对） |
| `modtest.c` | 字段修改 → 重建 → 回读验证 |
| `buildmod.c` | 构造 mod `.blc`+`.chk`（含 MD5 重算） |
| `vidmod.c` | 视频替换类 mod 构造器 |
| `memfind.c` | SIGSTOP + 24 线程内存特征搜索（实机验证） |
| `memwrite.c` | `/proc/pid/mem` 写权限测试 |
| `blcfinal.c` | `.blc` 解密 + 自适应解析（全量映射） |

## 26.6 安全与回滚

- **完整备份**：`modtest_backup/{cb6ef51f….chk.orig, 55FC21C6.blc.orig}`
- **一键回滚**：`su -c sh modtest_backup/ROLLBACK.sh`
- 全程未修改游戏数值/存档；未散布资源；工具只记录方法与算法

## 26.7 待补

1. **游戏内肉眼确认**（需人工进入「瘴气」相关指南条目观看视频）
2. 若视频未变 ⇒ 排查缓存（`Temp/`）或引入方案 C
3. 若视频黑屏 ⇒ 改用**等长交换**（不加 padding）

---

## 26.8 ★ 方案 A 深入验证（第 3 轮）：块是**懒加载**的

### 26.8.1 两次内存搜索的对比（决定性）

用「`SIGSTOP` 冻结 + 24 线程扫 `/proc/pid/mem`」搜索 `.blc` **解密后**的唯一特征：

| 块 | 特征 | 内存命中 | 结论 |
| --- | --- | --- | --- |
| `55FC21C6`（Video） | 32 B @0x120 | **6 处**（与解密后出现次数 1:1 吻合） | ✅ **已被游戏加载** |
| `0CE8FA57`（InitBundle） | 32 B @0x120 | **0 处** | ❌ **当前界面未加载该块** |

**⇒ 两个块状态不同 ⇒ 游戏**按需/懒加载** `.blc`，并非开屏全量读入。**

### 26.8.2 `.blc`/`.chk` **不走 mmap**

```
grep -icE 'VFS|\.chk|\.blc' /proc/<pid>/maps   →   0
```
**⇒ 与 VFS 代码里的 `_MMAPTestOpen` / `MMAP` 路径常量不符实际表现**；
游戏用的是**普通文件 IO**（`ReadFileByStream`）而非 mmap。

### 26.8.3 对「视频没变」的解释

**方案 A 的第一次测试（换瘴气视频）之所以看不到变化，最可能的原因是：
那段视频**根本没被加载**（指南视频是按需播放的），而不是游戏拒绝了我们的 `.chk`。**

**⇒ 「游戏是否读取我们改的 `.chk`」这个问题**仍未得到结论**，
需要一个「目标块确定已加载」的实验设计。**

### 26.8.4 正确的实验设计（下一轮）

**必须满足三个条件：**
1. **目标块在测试时刻**确定在内存中**（先用 `memfind` 验证）
2. **改动立即可见**（不需要额外操作去触发）
3. **不改数值**（只动文本/贴图/视频）

**可行做法**：
```
① 游戏停在某个界面
② memfind 找出【当前已加载】的块
③ 在该块内选一个小资源，改动它
④ 不重启、让游戏重新读取该资源
⑤ 观察界面变化
```

**关键难点**：`.blc` 只在**块被首次加载时**读取，所以改动后可能需要
**切到别的界面再切回来**（触发重载），或**重启游戏**。

### 26.8.5 本轮安全记录

| 项 | 结果 |
| --- | --- |
| InitBundle 改动 | ✅ 已回滚，`.chk` md5 `f68ea909…` 与备份**一致** |
| InitBundle `.blc` | ✅ 已回滚，md5 `f02f2e20…` 与备份**一致** |
| 55FC21C6（视频块） | ✅ 早已回滚，`.blc` md5 `d6196b79…` 与备份**一致** |
| VFS 完整性 | ✅ 1093 `.chk` / 21 `.blc`，与原始一致 |
| 游戏版本 | ✅ 1.5.3，未被改动 |
| 回滚脚本 | `ibtest_backup/ROLLBACK.sh`、`modtest_backup/ROLLBACK.sh` |

---

## 26.9 ★ 块加载实测（第 5 轮）：工具提速 30× 后首次拿到有效结果

### 26.9.1 快速扫描器 `memfast.c`

**原版瓶颈**：对内存中**每一个字节位置**都比较 21 个 32 字节特征
⇒ 6 GB × 21 次比较 ≈ **1260 亿次**，耗时 ~200 s。

**三项优化**：

| # | 优化 | 效果 |
| --- | --- | --- |
| ① | **只扫 `rw` 匿名区**（`maps` 里 `rw` 且无文件名） | 扫描量 6 GB → **1.85 GB** |
| ② | **2 字节前缀位图** `PFX[65536]` | 99.9% 位置**一次查表即跳过** |
| ③ | 每线程**自取段队列**（`NEXTSEG++`） | 消除负载不均 |

**结果**：`1.85 GB / 6.36 s = 0.29 GB/s` —— **约 30× 提速**。

### 26.9.2 首次有效的块加载结果（游戏停在早期界面）

| 状态 | 块 |
| --- | --- |
| ✅ **已加载（11）** | `1CDDBF1F` BundleManifest · **`0CE8FA57` InitBundle** · `DAFE52C9` IFixPatchOut · `07A1BB91` InitAudio · `E1E7D7CE` AudioChinese · `C3442D43` Streaming · `D6E622F7` ExtendData · `23D53F5D` DynamicStreaming · `F151B649` HotfixAudio · `F668D4EE` AudioJapanese · `A31457D0` AudioEnglish |
| ❌ **未加载（10）** | `3C9D9D2D` · `24ED34CF` Audio · **`7064D8E2` Bundle** · `F84BF5E6` Terrain · `A63D7E6A` IV · **`55FC21C6` Video** · `775A31D1` JsonData · `42A8FCA6` Table · `19E3AE45` Lua · `E9D31017` AudioKorean |

**两条重要结论**：
1. **`55FC21C6`（Video）当前未加载** ⇒ 解释了第一次视频替换测试为何看不到效果
2. **`0CE8FA57`（InitBundle）确实已加载** ⇒ 第 3 轮那次「0 命中」是**工具 bug**
   （`find_pid` 误匹配到自己的命令行）导致的**假阴性**

### 26.9.3 三个工具 bug（本轮全部修正）

| # | Bug | 后果 | 修正 |
| --- | --- | --- | --- |
| ① | `find_pid` 用 `strstr` 匹配包名 | **匹配到自己的命令行**，扫了个空进程 | 改为 cmdline **精确同名**（`b[pl]=='\0'`，排除 `:sub`） |
| ② | TSV 解析把 `hex` 指针推到行尾再置零 | 读越界 ⇒ 所有特征变成同一串 ⇒ 匹配一切 | 改为只去掉 `\n` |
| ③ | 特征数组名 `SIG`/`NAME` 撞系统宏 | 编译失败 | 改名 `GSIG`/`GNAME` |

### 26.9.4 下一步

**在「已加载」的 11 个块中选一个可见/可听的小资源做替换**：

| 候选块 | 文件数 | 平均大小 | 可见性 |
| --- | --- | --- | --- |
| `F151B649` HotfixAudio | 15 | 244 KB | 🔊 可听 |
| `07A1BB91` InitAudio | 2 | 3.9 MB | 🔊 可听 |
| `E1E7D7CE` AudioChinese | 3 | 437 MB | 🔊 可听 |
| `D6E622F7` ExtendData | 3 | 59 MB | ❓ |
| `23D53F5D` DynamicStreaming | 2,345 | 24.6 KB | 🖼️ 可能有贴图 |
| `C3442D43` Streaming | 53,036 | 9.8 KB | 🖼️ 可能有贴图 |

**⇒ 建议**：改完资源后**切界面触发重载**（因为 `.blc` 只在块首次加载时读取）。

---

## 26.10 第 6 轮：二元判别实验（未成立）

### 26.10.1 实验设计

在**已确认加载**的 `0CE8FA57`（InitBundle）中，改 `.chk` 条目 0 的
`[1200, 1232)` 32 字节（翻转 `0xFF`，**长度不变**），`.blc` **保持字节不变**。
然后重启游戏并分别搜索**原始特征**与**修改特征**。

**期望**：
- 找到**修改特征** ⇒ 游戏读了我们的 `.chk` ⇒ 方案 A 数据层成立
- 找到**原始特征** ⇒ 游戏忽略我们的文件

### 26.10.2 结果：**不成立**

```
扫描 0.72 GB（仅 rw 匿名区）
  orig 特征 → 0 命中
  mod  特征 → 0 命中
```

**⇒ 两个都没有。** 原因：**游戏当时处于极早期界面**（`rw` 匿名内存仅 0.72 GB，
正常应在 1.8 GB 以上），目标数据**尚未进入内存**。

### 26.10.3 由此得到的认识

| 观察 | 含义 |
| --- | --- |
| 原始与修改特征**都不在**内存 | `.chk` 的字节流**不以原始形式驻留** —— Unity 会解析成结构体/贴图等 |
| `rw` 匿名内存量可作为「加载进度」指标 | 0.72 GB=早期；≥1.8 GB=已进主界面 |
| 之前那次 `55FC21C6` 命中 6 处 | 说明**部分块数据确实以原始形式驻留**（可能与资源类型有关） |

### 26.10.4 修正后的验证策略

**「改 `.chk` 再搜内存特征」这条路线不可靠**，因为：
1. 数据可能被解析而不保留原始字节
2. 块是否加载取决于当前界面

**⇒ 应改为「直接看游戏表现」**：
- 优先选**音频**（可听，无需界面依赖）
- 或选**当前界面正在用的 UI 资源**
- 改完后必须**触发重载**（切界面进出 / 重启）

### 26.10.5 本轮安全记录

| 项 | 结果 |
| --- | --- |
| InitBundle `.chk` | ✅ 已回滚，md5 `f68ea909…` 与备份一致 |
| InitBundle `.blc` | ✅ 未被改动，md5 `f02f2e20…` |
| Video 块 | ✅ 未受影响，`d6196b79…` / 瘴气 `727d1617…` |
| VFS 完整性 | ✅ 1093 `.chk` / 21 `.blc` |
| 游戏版本 | ✅ 1.5.3 |
| il2cppdumper 注入 | ✅ 仍为空（第 4 轮的修复保持有效） |

---

## 26.11 方案 F 实机测试：内存改写 UI 文本（第 7 轮）

### 26.11.1 技术成立 ✅

**目标**：把内存中所有「伊冯」改成「Yvone」

| 编码 | 旧 | 新 |
| --- | --- | --- |
| UTF-16LE | `0A 4F AF 51`（4 B） | `59 00 76 00 6F 00 6E 00 65 00`（10 B） |
| UTF-8 | `E4 BC 8A E5 86 AF`（6 B） | `59 76 6F 6E 65`（5 B） |

**实测结果**：
```
UTF-16 命中 4 处 → 改写成功，剩余「伊冯」= 0，已改「Yvone」= 3
UTF-8  命中 338 处（误命中率高，已关闭该分支）
```
**⇒ 内存里的 il2cpp `System.String` 确实可被 `/proc/pid/mem` 原地改写。**

### 26.11.2 但会崩溃 ❌ —— 根因是缓冲区溢出

```
il2cpp System.String 布局:
  +0x10  int32 length     ← 字符数
  +0x14  char[] chars     ← 恰好 length*2 字节，【无余量】
```
「伊冯」= 2 字符 = **4 字节**缓冲区；「Yvone」= **10 字节**
⇒ **多写 6 字节，越界覆盖相邻对象** ⇒ 后续 GC/访问时崩溃。

**即使把 `length` 字段同步改成 5，物理缓冲区仍是 4 字节 —— 只是让越界"合法"，
内存照样被破坏。**

### 26.11.3 安全可行的四条路

| # | 方案 | 风险 | 能否得到 "Yvone" |
| --- | --- | --- | --- |
| **①** | **同长度替换**（「伊冯」→「Yv」，2 字符/4 字节） | **零** | ❌ 只能得到 "Yv" |
| ② | 探测缓冲区余量后扩写 | 低 | ❌ il2cpp 不记录容量，基本探不到 |
| ③ | `il2cpp_string_new_utf16()` 分配新串 + 重指向所有引用 | **高** | ✅ |
| **④** | **改 Unity AssetBundle 里的文本（文件层）** | 中 | ✅ 且**持久、可复现、不碰内存** |

### 26.11.4 附：UI 文本不在 `.chk` 明文里

搜遍 `Table`(42A8FCA6) / `JsonData`(775A31D1) / `Lua`(19E3AE45) /
`BundleManifest`(1CDDBF1F) 的 `.chk`：**「伊冯」0 命中**。

**⇒ UI 文本位于 `Bundle` 块（btype=11）的 Unity AssetBundle 中**，
而这些 `.ab` 是 **LZ4 压缩的 Unity SerializedFile**
（单个 `.chk` 可达 **1.2 GB**，如 `9785732B….chk` = 1,213,222,901 B）。
**因此明文 grep 必然搜不到。**

**⇒ 方案 ④ 需要先实现 Unity `.ab` 的解析与重打包（LZ4 解压 → 改字符串 → 重压缩 → 回写）。**

### 26.11.5 安全记录

| 项 | 结果 |
| --- | --- |
| VFS | ✅ 1093 `.chk` / 21 `.blc` 与原始一致 |
| 游戏文件 | ✅ 全程未被改动 |
| 内存改动 | ✅ 随进程退出**自动消失**（零残留，无需回滚） |
| 游戏版本 | ✅ 1.5.3 |

---

## 26.12 方案 B：内联 hook `GetAssetStream`（第 7 轮，payload 已就绪）

### 26.12.1 设计

**目标**：`VirtualFileSystem.GetAssetStream(ref FVFBlockFileInfo)` @ **RVA `0xb385bc0`**

**ARM64 内联 hook（16 字节绝对跳转）**：
```asm
; 覆盖 target 前 16 字节:
ldr x16, #8        ; 0x58000050
br  x16            ; 0xd61f0200
.quad hook_entry   ; 8 字节目标地址

; hook_entry（汇编）:
stp x29, x30, [sp, #-0x10]!
stp x0,  x1,  [sp, #-0x10]!
bl  hook_impl
mov x16, x0
ldp x0,  x1,  [sp], #0x10
ldp x29, x30, [sp], #0x10
br  x16            ; 跳回 target+16（g_back）
```
**`trampoline`**：保存的 4 条原指令 + 跳回 `target+16`。

### 26.12.2 编译

```bash
NDK=$HOME/android-sdk/ndk/29.0.14206865
S=$NDK/toolchains/llvm/prebuilt/linux-x86_64/sysroot
clang --target=aarch64-linux-android29 --sysroot=$S \
      -O2 -fPIC -shared -nostdlib \
      -o libefml4a_hookb.so payload-hookb.c
```

**关键点**：
- **必须用 `-nostdlib`** —— NDK 的 aarch64 sysroot 里**没有 `libunwind.a`**，
  常规链接会 `unable to find library -l:libunwind.a`
- `-nostdlib` 后未定义符号（`open`/`write`/`mprotect`/`snprintf`…）
  **由宿主进程已有的 libc 解析**（注入场景下正常）
- `hook_impl` **不能是 `static`**，否则会成为未定义符号导致加载失败
  （用 `__attribute__((used,visibility("default")))`）

**产物**：`6,848 字节`，`hook_entry` T 0x4884 / `hook_impl` T 0x48a0 ✓

### 26.12.3 部署清单（待执行）

```
1) cp libefml4a_hookb.so /data/adb/modules/zygisk-loader/config/
2) target.json = [{"app":"com.hypergryph.endfield",
                   "lib":"/data/adb/modules/zygisk-loader/config/libefml4a_hookb.so"}]
3) 重启游戏（zygisk 需重建 → 可能需整体重启）
4) 日志: /sdcard/Android/data/com.hypergryph.endfield/files/efml4a_hookb.log
5) 回滚: target.json 写回 []
   ⚠️ 若崩溃 → 立即回滚 + 重启
```

### 26.12.4 风险提示（本项目历史教训）

- 早期自建 zygisk 模块**曾导致 ZygiskNext 全局停机**（`modules_with_issue:1`）
  ⇒ 恢复需 `ksud module uninstall` + 重启
- 直接**调用** il2cpp 托管函数**曾三次崩溃**游戏（tombstone `#01 0xb37de44`）
  ⇒ **内联 hook 与「直接调用」性质不同（hook 是接管既有调用，不新起调用）**，
  但仍需谨慎：**先只日志、不改行为**
- **`/data/local/tmp` 对 app 不可写**（SELinux）⇒ 日志必须写到
  `/sdcard/Android/data/<pkg>/files/` 或应用私有目录

---

## 26.13 方案 D 关键发现：`Temp/` 里是**完全明文的解出资源**（第 8 轮）

### 26.13.1 发现

游戏私有目录 `files/Temp/` 下存在 **UUID 命名的暂存文件**，
其**大小与 VFS 映射中的资源 `len` 精确吻合**：

| Temp 文件 | 大小 (B) | 映射中的资源 |
| --- | --- | --- |
| `b49159d9-a689-47d7-123e-b11d07af382b` | 457,018 | `Data/ExtendData/Initial/InitStringPathHash.bin` (btype 3) |
| `cd37c379-bf2b-43c7-6449-842fa7cc6b50` | 158,639,432 | `Data/ExtendData/Main/StringPathHash.bin` (btype 20) |
| `ddef02cc-c8ab-9def-06ec-5cf019de967b` | 17,909,576 | `Data/ExtendData/Main/FacBone/FacBoneTRS.bin` (btype 20) |
| `e3c0bf88-b569-ade1-d25c-8fe9a92fbd11` | 145,976,444 | （未匹配；头部含 UTF-16 路径串） |

### 26.13.2 内容是**明文**（决定性）

```
样本 457,018 B
  熵 = 3.896 bits/byte          ← 远低于加密(≈8.0)，属结构化明文
  前 48 字节:
    d8 fe 00 00 | 9e 0a 00 00 | 94 a1 00 00 | 01 00 00 00
    00 00 00 00 | 00 00 00 00 | f4 f2 00 00 | 01 00 00 00
    a4 5d 00 00 | 01 00 00 00 | 44 e8 00 00 | 01 00 00 00   ← 整齐的 u32 序列

样本 145,976,444 B
  头部: 11 ff 11 ff | 24 00 00 00 | 32 00 39 00 35 00 34 00 …
        UTF-16LE 可读: "29 5 4…" / "fa80-23c…"（含路径/ID 字符串）
```

**⇒ 游戏将 `.chk` 内的资源**解密/解包为单个明文文件**落在 `Temp/`。**

### 26.13.3 为什么这对 mod 极有价值

| 优点 | 说明 |
| --- | --- |
| **明文** | 无需任何解密，直接可读可改 |
| **无需注入** | 不碰 Zygisk/LSPosed，**不需要重启设备** |
| **无需重启设备** | 只重启游戏（甚至可能热加载） |
| **可逆** | 备份原文件即可一键回滚 |
| **有映射可依** | 每个文件都能用 `fullmap2.tsv` 的 `len` 反查其 VFS 名字 |

**⇒ 这是**方案 D 的一个更简形式**：不去猜「本地挂载目录约定」，
而是**直接在游戏自己解包出来的明文文件上做替换**。**

### 26.13.4 待验证（下一轮）

1. **`Temp/` 文件的生命周期** —— 是启动解包后保留，还是读完即删？
2. **游戏是否从 `Temp/` 读取而不是每次重新解包** —— 若是，改它即可生效
3. **改完之后需要什么触发**（重启游戏 / 切界面）
4. **`Temp/` 与 `VFS/` 的关系** —— 是否 `Temp/` → 移动/复制到别处

### 26.13.5 本轮其他结论

**`ClientData/Local` 不是 VFS 挂载点**（只是普通配置目录，内含 `Default.json`）；
`HGGameUpdate/gameupdate/preload/` 是 1.6 补丁暂存区；
`index_*.json` / `pref_*.json` 均**加密**（非明文 JSON，无路径关键字）。

**B 方案（zygisk inline hook）已回滚**：`target.json = []`，payload 已删。
原因：ZygiskNext 的 companion 在 **zygote 启动时**加载，改配置后**必须重启设备**
（`ksud soft-reboot` 会杀 ZygiskNext，不可用）⇒ 按你的选择转向 D。

---

# 27. ★★★ 重大更正：用户的 mod 是**终末地 EFMI mod**，加载路径在**渲染层**

## 27.1 更正说明

本项目早期（§26 之前）曾判断用户提供的 mod「属 3DMigoto 引擎、非终末地」。
**该结论部分错误**，现更正：

| Mod | 实际归属 |
| --- | --- |
| **`edmin_maid.zip`** | ✅ **终末地 EFMI mod**（`; EFMI ALPHA-13 INI`） |
| **`prts_pupil.rar`** | ✅ **终末地 EFMI mod**（文件名格式与上者完全同构） |
| `nom_liino_secret_service` | ❌ 不同格式（`nm_LiinoMD1`、`; Note space + rename All`），非 EFMI |

**教训**：不能仅凭 `.buf`/`.dds`/`.hlsl` 扩展名判定 mod 归属 ——
**EFMI 复用了 3DMigoto 的文件格式，但目标就是终末地。**

## 27.2 EFMI mod 的真实格式（实测 `edmin_maid/mod.ini`）

```ini
; EFMI ALPHA-13 INI
global $required_efmi_version = 1.46
global $object_guid        = 185751        ; ★ 目标对象指纹
global $mesh_vertex_count  = 56270
global $component_count    = 11
global $bones_count        = 395
global $max_instance_count = 8

; 命名空间注册
$\EFMIv1\required_version = $required_efmi_version
$\EFMIv1\object_guid      = $object_guid
Resource\EFMIv1\ModName   = ref ResourceModName
run = CommandList\EFMIv1\RegisterMod

; draw call 接管
[CommandList_Draw_Component0]
run        = CommandList\EFMIv1\OverrideTextures
ib         = ref Resource_Component0_IB
vb0        = ref Resource_Component0_VB0
drawindexed = 27615, 0, 0
```

**文件构成**：48 个 `Meshes/ComponentN_{IB,VB0,VB1,VB2}.buf`
+ `Textures/*.dds`（**DirectX BC5/BC7 压缩**）+ `mod.ini` + `preview.png`

## 27.3 完整技术栈（网络查证）

```
EFMI mod（.ini + .buf + .dds，3DMigoto 格式）
      ↓ 由
移动版 3DMigoto（StarBobis/NBPM-Package，或 "Better Endfield"）
      ↓ 挂钩
游戏图形 API —— 终末地在 Android 上走 Vulkan（有 98 MB vulkan_pso_cache.bin）
      ↓ 拦截
vkCmdDrawIndexed 等 draw call
      ↓ 以 $object_guid / $mesh_vertex_count 识别目标
替换顶点/索引缓冲 + 纹理
```

- `EFMI` = **`SpectrumQT/EFMI-Package`** —— "Endfield Model Importer"，属 **XXMI** 生态
- **XXMI 同时支持 PC 与 Android**
- Android 端实现参考：**`StarBobis/NBPM-Package`**（"3Dmigoto Preconfigured For
  Certain Action Game Mobile Version"）
- 参考链接：
  - <https://github.com/SpectrumQT/EFMI-Package>
  - <https://github.com/StarBobis/NBPM-Package>

## 27.4 对项目路线的根本影响

**§26 的 A→B→C→D→F 全部是「文件替换 / 数据读取」层面的方案 —— 对 EFMI 类
（模型/贴图替换）mod 并不适用。** EFMI 需要的是**渲染层 draw call 拦截**。

| | 3DMigoto（Windows） | EFMI（Android/终末地） |
| --- | --- | --- |
| 挂钩点 | `d3d11.dll` 代理 | **Vulkan 层 / Vulkan API hook** |
| 拦截 | `DrawIndexed` | `vkCmdDrawIndexed` |
| 目标识别 | 顶点数 / 着色器哈希 | `$object_guid` / `$mesh_vertex_count` |
| 载荷 | `.buf` + `.dds` | 同（格式通用） |

**⇒ 本项目已有的 `vulkan-layer/` 目录才是这条路的正确落点。**

## 27.5 待办（下一轮）

1. **获取 EFMI / NBPM-Package 的源码**，看 Android 端如何挂钩 Vulkan
2. **实测游戏启用了哪些 Vulkan 层**（`vkEnumerateInstanceLayerProperties`）
3. **在 `vulkan-layer/` 中实现 `vkCmdDrawIndexed` 拦截 + `object_guid` 匹配**
4. 复核 `EFMI` 字符串确实出现在游戏 `.chk` 中
   （实测出现于 `VFS/7064D8E2/` 下多个 `.chk`：`3F66171C…`、`CBC6AC00…`、`9785732B…`）
   但 **`dump.cs` 中无任何 EFMI 符号** ⇒ **EFMI 是外部框架，非游戏自带代码**

## 27.6 第 9 轮附：`Temp/` 是**明文的解包暂存区**

```
files/Temp/<uuid>   大小与 VFS 映射的 len 精确吻合
  457,018     → Data/ExtendData/Initial/InitStringPathHash.bin
  158,639,432 → Data/ExtendData/Main/StringPathHash.bin
  17,909,576  → Data/ExtendData/Main/FacBone/FacBoneTRS.bin
  145,976,444 → （未匹配）
  样本熵 = 3.896 bits/byte  ⇒ 明文（加密应 ≈8.0）
```

**生命周期实测**：游戏**每次启动重新解包**（UUID 文件名会变，但内容 md5 一致）
⇒ **改 `.chk` 后重启游戏，理论上 `Temp/` 会解出我们改的内容** —— 这是
**数据类 mod** 的一条零注入验证路径（下次可用来做决定性实验）。

---

# 28. ★★★ 方案 A 数据层**决定性验证成功**（第 12–14 轮）

## 28.1 实验设计（终于做对了）

**前几次失败的原因是我自己的 bug**：把修改脚本放在 `su -c` 里跑，
而 **`python3` 在 Android 的 root shell 中不存在**（只有 Termux 里有）——
导致「改过的」文件与原文件**逐字节相同**，实验自然无结论。

**正确做法：在 Termux 内改好，再 `cp` 到设备。**

### 实验

```
目标块 : D6E622F7 (ExtendData, btype=20)
目标文件: Data/ExtendData/Main/StringPathHash.bin
          offset = 18,783,262   len = 158,639,432
改动   : 该文件【末尾 32 字节翻转 0xFF】——【长度完全不变】
.blc   : 【完全不动】
```

**观测点**：`files/Temp/` —— 游戏启动时会把 `.chk` 里的资源**解包成明文单文件**放这里，
文件名是 UUID，但**内容 md5 可比对**。

### 结果

```
期望（我算出的改后 md5）: 7aa8df5eedaf46a1a77b3f64242adb84
Temp 中实测（游戏解出的）: 7aa8df5eedaf46a1a77b3f64242adb84
                                       ⇒ ★★★ 完全一致 ★★★
```

**⇒ 结论：游戏**确实读取并采用了我们修改的 `.chk`**。
方案 A（纯文件替换）在**数据层成立**。**

## 28.2 关键经验（两个变量，成败在此）

| 做法 | 结果 |
| --- | --- |
| **同长度**改内容 + **`.blc` 不动** | ✅ **成功**（本次实验） |
| **改长度** + 重写 `.blc`（含 CRC32/重加密/`fileDataMD5`） | ❌ **失败**（早期视频替换） |

**⇒ 早期视频替换失败很可能不是「游戏拒绝」，而是「改长度的路径引入了别的问题」。**
**可靠做法：优先做**等长**替换。**

## 28.3 附带确定的定位方法

**Video 块（`55FC21C6`）中，每个视频对应一个**同尺寸**的 `.chk` 文件**：

```bash
# 已知视频长度 len，直接找对应 .chk：
find <VFS>/55FC21C6 -name '*.chk' -size ${len}c
```

**实测**：
```
299,392 → F5E6966633BF47227386C9EA660BC44E.chk   (ui_snapshot_anim_lino_m_1)
498,688 → 9EF29155AFB7B2942726C8F6CAD418C4.chk   (ui_snapshot_anim_ardelia_s_1)
485,152 → 3C84876AFD636A777119EB706037CE09.chk   (ui_snapshot_anim_chen_s_1)
358,752 → 88B4B6550B833CAA0DC67700C07A7218.chk   (ui_snapshot_anim_laevat_s_1)
468,480 → 49942933E985D4DD4FEA258755902AF1.chk   (ui_snapshot_anim_lizhiyan_m_1)
```

## 28.4 脚本/工具环境的重要坑（已踩两次）

| # | 坑 | 后果 | 对策 |
| --- | --- | --- | --- |
| ① | **`python3` 在 `su -c` 的 root shell 中不存在** | 修改静默失败，文件与原版相同，实验假阴性 | **一切文本/二进制处理在 Termux 内做**，只把成品 `cp` 过去 |
| ② | `find /sdcard ... -newermt` 在某些 busybox 上不生效 | 找不到新文件 | 用 `ls -lt` 看时间 |
| ③ | LSPosed 的 `modules_config.db` 里会出现**已卸载**的模块名 | 误判为"已安装" | 用 `pm list packages` 交叉验证 |

## 28.5 用户的 mod 与加载器（第 10–13 轮确认）

- `edmin_maid.zip` / `prts_pupil.rar` → **终末地 EFMI mod**（见 §27）
- 用户下载的 **`EFMI-PACKAGE-v1.4.8.zip` 是 PC 版**：
  ```ini
  [Loader]
  target = Endfield.exe
  loader = XXMI Launcher.exe
  launch = C:\Program Files\GRYPHLINK\games\EndField Game\Endfield.exe
  module = d3d11.dll        ; ← DirectX 11 代理
  ```
  **README 的安装步骤是 Windows 的 `.msi`**，包内**零** Android/安卓 提及。
- **Android 端需要「移动版 3DMigoto」**：`StarBobis/NBPM-Package`
  或 B 站的 "Better Endfield"（明示支持「电脑，安卓，DX11，vulkan」）

## 28.6 待办

1. **产出一个「进入游戏可见」的结果** —— 用 §28.2 的**等长替换**做
   （候选：`UI/Snapshot` 的 5 个角色动画，开角色界面即见；或任一指南视频）
2. 把 §28.1 的实验脚本固化成 `tools/` 下的可复用工具
3. B/C/D/F 的收尾结论

---

## 28.7 工具化：`tools/vfs/chkpatch.c`

**把 §28.2 的成功路径固化成可复用工具。**

```
chkpatch flip    <x.chk> <offset> <len> [step] [xor]
     等长破坏区间内数据（每 step 字节异或 xor，默认 7 / 0xA5）
     用途：验证「游戏是否读取该 .chk」——画面/音频会明显花掉

chkpatch splice  <dst.chk> <dstOff> <src.chk> <srcOff> <len>
     把 src 的一段【等长】抄到 dst
     用途：A 视频换 B 视频（必须等长）

chkpatch hex     <x.chk> <offset> <hexbytes>
     等长写入指定十六进制字节

chkpatch restore <x.chk>
     从 <x.chk>.orig 一键恢复
```

**安全设计**：
- 每次写入前自动备份到 `<x.chk>.orig`（已存在则不覆盖，保留**最初**版本）
- **全部操作等长** ⇒ 文件长度不变 ⇒ **`.blc` 无需改动** ⇒ 索引/CRC32 天然有效
- `restore` 一键还原

**冒烟测试（副本上）**：
```
原  md5 = 727d161748228f1a57eb2f76ad711821  765280 B
flip → md5 = d8dd4f2337f351185eb2e70e4d2fd497  765280 B  ← 与手工改的结果完全一致
restore → md5 = 727d161748228f1a57eb2f76ad711821          ← 完全还原
```

**⚠️ 设备上使用注意**：Android 的 `su -c` root shell 里**没有 python3/perl**，
所以**建议在 Termux 内用本工具生成结果文件，再 `cp` 到设备**（见 §28.4 坑①）。

---

# 29. ★ 上机：6 处「等长替换」改动已部署（第 16–17 轮）

## 29.1 目标

用 §28.2 验证出的**唯一可靠路径**——
**等长改内容 + `.blc` 完全不动** —— 做**用户肉眼可见**的改动。

## 29.2 已部署的 6 处改动

### ① 角色界面动画（`UI/Snapshot`，5 个）

| 角色 | `.chk`（`VFS/55FC21C6/`） | 大小 (B) | 原 md5 → 改后 md5 |
| --- | --- | --- | --- |
| `lino_m` | `F5E6966633BF47227386C9EA660BC44E.chk` | 299,392 | `1c336158…` → `65096288…` |
| `ardelia_s` | `9EF29155AFB7B2942726C8F6CAD418C4.chk` | 498,688 | `7b9b1fc2…` → `8927f6cc…` |
| `chen_s` | `3C84876AFD636A777119EB706037CE09.chk` | 485,152 | `6097b04b…` → `2a8141ed…` |
| `laevat_s` | `88B4B6550B833CAA0DC67700C07A7218.chk` | 358,752 | `045ae948…` → `60cfe5df…` |
| `lizhiyan_m` | `49942933E985D4DD4FEA258755902AF1.chk` | 468,480 | `4279ab0b…` → `5de3a294…` |

**改动方式**：`chkpatch flip <chk> 2048 <len-2560> 5 0x5A`（跳过 0x800 头与 0x200 尾）

### ② 「瘴气」指南视频（1 个）

```
VFS/55FC21C6/cb6ef51ff35435bd8c0a3e8352b11073.chk   765,280 B
  原 md5 727d161748228f1a57eb2f76ad711821
  改 md5 d8dd4f2337f351185eb2e70e4d2fd497
```

## 29.3 全程不变量（关键）

```
55FC21C6.blc = d6196b797a10d910b0420d66c62f98ea   ← 从头到尾【未改动】
```

**⇒ 因为所有改动都是【等长】的，`.blc` 里记录的 `{offset,len}` 与
尾部 CRC32 天然继续有效，无需任何重写。这是本方案能成功的根本原因。**

## 29.4 踩到的第 4 个坑（务必记住）

**`su -c cp` 会把文件拷成 `root:root 644`**，
而 Termux 用户（`u0_a446`）随后**无法写入**该文件：

```
$ chkpatch flip <file> ...
r+b: Permission denied      ← 静默失败
```

**更糟的是我当时的 `grep` 把这条错误信息过滤掉了，导致「改前改后 md5 相同」的假象。**

**⇒ 操作规程（已固化）：**
```bash
su -c "cp '<设备文件>' '<Termux路径>'"
su -c "chmod 666 '<Termux路径>'; chown u0_a446:u0_a446 '<Termux路径>'"
# 之后才能在 Termux 内改动
```

## 29.5 回滚

```bash
# 5 个角色动画（含备份与脚本）
su -c sh ~/.efml4a/scratch/uisnap/ROLLBACK.sh

# 瘴气视频
su -c "cp ~/.efml4a/scratch/vid_backup/orig_video.chk \
       /sdcard/Android/data/com.hypergryph.endfield/files/VFS/55FC21C6/cb6ef51ff35435bd8c0a3e8352b11073.chk"
```

**备份位置**：
- `~/.efml4a/scratch/uisnap/*.chk.orig`（5 个角色动画）
- `~/.efml4a/scratch/vid_backup/orig_video.chk`（瘴气）
- `~/.efml4a/scratch/ext_backup/orig.chk`（第 12 轮 ExtendData）

## 29.6 判定标准

| 观察 | 结论 |
| --- | --- |
| 角色界面动画**花屏/色块错乱** | ✅ 等长替换在**渲染层**也生效 ⇒ 该路径完全可用 |
| 画面**仍正常** | ⚠️ 游戏对该资源有额外缓存/校验，需进一步分析 |

## 29.7 工具链小结（本项目最终产物）

| 工具 | 作用 |
| --- | --- |
| `tools/vfs/chkpatch.c` | **等长内容替换**（flip / splice / hex / restore）—— **做 mod 的主力** |
| `tools/vfs/deVFS.sh` | 自包含解密/解析/提取（`.blc` / `.chk`） |
| `tools/mem/memfast.c` | 内存多特征扫描（0.29 GB/s，30× 提速） |
| `tools/zygisk/payload-hookb.c` | 方案 B：`GetAssetStream` 内联 hook（待注入） |
