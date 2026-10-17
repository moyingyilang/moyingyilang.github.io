---
title: "41. 运行时 hook 实施方案（只读 dump 顶点）"
description: "EFML4A 研究文档 · 41-hook-plan（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> **目标**：不改任何数据，只把游戏**解压后**的顶点与顶点布局 dump 出来。
> **风险**：极低（纯只读）。⚠️ 但历史上我们有两次 zygisk 崩溃事故（见 §41.6）。

## 41.1 当前设备状态（已核实，安全）

```
游戏      : 未运行
版本      : 1.6.4 (versionCode 61)
mod .chk  : f93846d47543c7a8057c26fa87530640  ← mod 已应用
.blc      : 2d54990d0db687b489515d81268acd52  ← 未动
Zygisk    : 24 个模块，【无我们自制的】
target.json : []          ← ★ 无目标，不会注入
payload 源码: tools/zygisk/payload-*.c（6 个）
```

## 41.2 hook 目标（按优先级）

| 优先 | 函数 | RVA (1.6.4) | 得到 |
| --- | --- | --- | --- |
| **1** | `HGMeshRendererData.GetMeshes()` | `0x1a51114c` | `Mesh[]` 实例（只在渲染时触发，噪声小） |
| **2** | `Mesh.get_vertexCount()` | 查 dump.cs | `Int32` 顶点数 |
| **3** | `Mesh.get_vertices()` | 查 dump.cs | `Vector3[]` **解压后的顶点** |
| **4** | `Mesh.GetVertexAttribute(Int32)` | `0x1a4aa498` | `VertexAttributeDescriptor` **通道布局** |
| **5** | `Mesh.get_bindposes()` | `0x1a4ab220` | `Matrix4x4[]` 绑定姿态 |
| **6** | `Mesh.HGGetPtrUnchecked()` | `0x1a4aa2ec` | 内部指针（可用于直接读缓冲） |

**⚠️ RVA 需校验**：`docs/34` §34.4 记录了 1.6.4 的 18 个 RVA 变化
⇒ **先校验再 hook**。

## 41.3 实施步骤（分阶段，每阶段可独立验证）

### 阶段 0：校验 RVA（不注入，纯静态）

```bash
# 从 libil2cpp.so 反查函数地址
# il2cpp 的方法是 native 函数，RVA 来自 dump.cs
# 用 llvm-objdump 在 libil2cpp.so 里查该偏移处是否有合理函数序言
llvm-objdump -d --start-address=0x1a51114c --stop-address=0x1a511180 libil2cpp.so
```

**判据**：偏移处应是合法的 ARM64 函数入口（`stp x29,x30,[sp,#-N]!` 之类）。

### 阶段 1：最小只读 hook（只 hook 1 个函数）

```
hook HGMeshRendererData.GetMeshes()
  ⇒ 只记录「被调用了」+ 返回的 Mesh[] 长度
  ⇒ 写日志到 /sdcard/efml4a_hook.log
  ⇒ 【不碰返回值，不改内存】
```

**验收**：日志出现，游戏正常启动。

### 阶段 2：dump 顶点

```
在 hook 里：
  ① 拿到 Mesh[] 
  ② 对每个 Mesh 调 get_vertexCount() / get_vertices()
  ③ 把 Vector3[] 写文件
  ④ 调 GetVertexAttribute(0..13) 记录布局
```

### 阶段 3：与 EFMI 对比

```
把 dump 出来的顶点与 EFMI ComponentN_VB0 对比：
  · 顶点数是否一致
  · 包围盒是否吻合（用 m_Center/m_Extent）
  · 若吻合 ⇒ 【知道该替换哪个 Mesh、用哪个 Component】
  ⇒ 然后才写 C 回写工具
```

## 41.4 工具链（已有，全部 C）

```
tools/vfs/abtool.c      等长替换（swap）
tools/vfs/chkpatch.c    等长替换
tools/vfs/blcparse.c    .blc 解密+解析
tools/vfs/bufinfo.c     EFMI .buf 分析
tools/vfs/meshdec.c     CompressedMesh 解码器
tools/vfs/floatscan.c   密集 float 段扫描
tools/vfs/aabbs.c       AABB 匹配
scripts/deploy-mod.sh   一键部署/回滚
```

## 41.5 备用方案（若 hook 不可行）

| 方案 | 说明 |
| --- | --- |
| **反汇编 `libil2cpp.so`** | 看 `HGMeshRendererData.GetMeshes` 的实现，找内部数据结构 |
| **直接 hook `libunity.so`** | `Mesh::GetVertexDataPtr` / `GetVertexDataSize`（符号已确认存在） |
| **继续静态逆向** | 用 `m_Channels`/`m_Streams` 的精确格式重新定位 |

## 41.6 ⚠️ 历史事故（必须避免重演）

| 事故 | 原因 | 修复 |
| --- | --- | --- |
| **自制 `efml4a_zygisk` 模块让 ZygiskNext 全局崩溃** | 模块本身有 bug | `ksud module uninstall efml4a_zygisk` + **真重启** |
| **`zygisk_il2cppdumper` 每次启动崩溃游戏** | `persist.il2cppdumper.package` 配错 | 清除属性 + 注释 `service.sh` + 加 `disable` 文件 |
| **直接调用 `GetCommonChachaKeyBs` 崩溃 3 次** | 非法调用 il2cpp 方法 | 放弃该路 |

**⇒ 铁律：**
```
① 先做阶段 0/1，验证通过再往下
② 每次改动前备份 + 准备回滚
③ 崩了就【真重启】（soft-reboot 会杀 ZygiskNext 且 boot_completed=0）
④ `target.json` 保持可一键清空（= []）
```

## 41.7 合规

**只读 dump，不修改任何游戏数据/数值/存档。仅技术研究。**

---

## 41.8 ★ 阶段 0 完成：RVA 校验通过（第 68 轮）

### 41.8.1 方法

```
1) 从 APK 提取 libil2cpp.so（549,013,048 字节）
2) 读 ELF program headers ⇒ 确认 VA↔文件偏移映射
3) 在 6 个 RVA 处读原始 ARM64 指令，判断是否为合法函数
```

### 41.8.2 ★ ELF 结构（意外发现：恒等映射）

```
Elf file type : DYN (Shared object file)
Entry point   : 0x9534000
program headers: 14 个，其中 8 个 PT_LOAD

LOAD 段:
  vaddr=0x0           offset=0x0           filesz=0x9532584   R
  vaddr=0x9534000     offset=0x9534000     filesz=0x15a21900  R E   ← 我们的 RVA 都在这里
  vaddr=0x1ef58000    offset=0x1ef58000    filesz=0xd19d60    RW
  vaddr=0x1fc74000    offset=0x1fc74000    filesz=0xefd300    RW
  …

★ 所有 LOAD 段的 vaddr == offset（恒等映射）
⇒ 【RVA 可直接当文件偏移用】
```

### 41.8.3 ★ 6 个 RVA 的校验结果

| RVA | 符号 | 首 6 条指令 | 判定 |
| --- | --- | --- | --- |
| `0x1a51114c` | `HGMeshRendererData.GetMeshes` | `add imm` / `stp` / `mov` / `mov` / **`bl`** / `ldr` | ✅ |
| `0x1a4aa498` | `Mesh.GetVertexAttribute` | `str` / `ldr` / **`ret`** | ✅ |
| `0x1a4ab220` | `Mesh.get_bindposes` | `mov`/`mov`/`cbnz`/`adrp`/`add`/`mov` | ✅ **标准序言** |
| `0x1a4aa2ec` | `Mesh.HGGetPtrUnchecked` | `mov`/`sub`/`cbnz`/`cmp`/`add`/`b` | ✅ **标准序言** |
| `0x1a5110c8` | `HGMeshRendererData.GetMaterials` | `ldr` / **`ret`** | ✅ 小函数 |
| `0x1a510ef0` | `HGMeshRenderer.get_data` | `add`/`mov`×3/`str`/`bl` | ✅ **标准序言** |

**⇒ 全部落在合法 ARM64 代码上
⇒ **`dump.cs` 的 RVA 与 `libil2cpp.so` **完全对应****
⇒ **阶段 0 零风险通过，可进入阶段 1。****

### 41.8.4 ⏭️ 阶段 1：最小只读 hook

```
hook HGMeshRendererData.GetMeshes()  (0x1a51114c)
  ⇒ 只记录「被调用」+ 调用者返回地址
  ⇒ 写 /sdcard/efml4a_hook.log
  ⇒ 【不碰返回值，不改内存】
验收：日志出现 + 游戏正常启动
```

---

## 41.9 ★★★★★ hook 基础设施打通（第 31 轮）

### 41.9.1 三个致命 bug（全部修复）

| # | 问题 | 症状 | 修复 |
| --- | --- | --- | --- |
| **1** | **RUNPATH 指向 Termux 私有路径** | `maps` 里 0 次 ⇒ dlopen 失败 | `patchelf --remove-rpath` |
| **2** | **`DT_NEEDED = 0`** | 无依赖声明 | `-target aarch64-linux-android24 -llog -ldl -lm` |
| **3** | **constructor 早于 libil2cpp.so 加载** | `libil2cpp.so base NOT FOUND` | 起线程轮询 `/proc/self/maps` |

### 41.9.2 ★★ 成功日志

```
=== efml4a meshdump pid=12621 tid=12621 ===
[mesh] waiter started pid=12621 tid=12635
[mesh] libil2cpp.so @0x75fbca6000 (iter=9)      ← 延迟等待成功
[mesh] hook installed target=0x76161b714c        ← ★★ hook 装上！
```

**地址验证**：`0x75fbca6000 + 0x1a51114c = 0x76161b714c` ✓

### 41.9.3 ★★ 重要修正：`target.json` 是**热更新**

```
✗ 我此前的结论「必须真重启」
✓ 实际：zygisk-loader 在【每次 app 启动】时读取 target.json
  ⇒ 改配置后【重启游戏】即生效，无需重启设备
验证：改 payload 后 am force-stop + 重启游戏 ⇒ hook 立即装上
```

### 41.9.4 ⚠️ 但 `GetMeshes` 120 秒内 0 次调用

```
⇒ 不是 hook 失败，是【目标函数选错】
⇒ HGMeshRendererData.GetMeshes 不在渲染热路径上
⇒ 需换成确定会被调用的函数
```

### 41.9.5 ★ 候选目标（按"热度"排序）

| 优先 | 函数 | 理由 |
| --- | --- | --- |
| **1** | **`Mesh.GetArrayFromChannelImpl(VertexAttribute, VertexAttributeFormat, Int32, Array)`** | **★ 直接拿顶点数据！** |
| **2** | `Mesh.get_vertexCount()` | 最热 |
| **3** | `Mesh.GetVertexAttribute(Int32)` | 拿通道布局 |
| **4** | `Mesh.get_bindposes()` | 绑定姿态 |
| 5 | `Mesh.HGGetPtrUnchecked()` | 内部指针 |

---

## 41.10 ★★★★★ hook 实战记录（第 31–39 轮）

### 41.10.1 ★★★ 三个致命 bug（找到并修复）

| # | 症状 | 根因 | 修复 |
| --- | --- | --- | --- |
| **1** | `maps` 里 0 次 ⇒ 完全没加载 | **RUNPATH 指向 Termux 私有路径** `/data/data/com.termux/files/usr/...`<br>而 zygisk-loader 把 payload 复制到 app cache 再 dlopen ⇒ app 无权访问 | `patchelf --remove-rpath` |
| **2** | 同上 | **`DT_NEEDED = 0`**（`-nostdlib` 导致） | `-target aarch64-linux-android24 -llog -ldl -lm` |
| **3** | `libil2cpp.so base NOT FOUND` | constructor 在 **zygote fork 早期**运行，那时 libil2cpp.so 还没加载 | 起线程轮询 `/proc/self/maps` |
| **4** | `saved=00000000`（hook 装在空区域） | **`/proc/self/maps` 第一行不一定是 `offset=0` 的基址行** | `find_base()` 强制要求 `offset == 0` |

### 41.10.2 ★★ 验证成功的日志

```
=== efml4a meshdump pid=27318 tid=27318 ===
[mesh] il2cpp @0x75fca21000 (iter=7)
[mesh] get_vertices @0x7616ecce64 bytes 08d946f9 nz=14      → HOOKED ✓
[mesh] GetAllocArrayFromChannelImpl @0x7616ecb9a4 bytes 48200091 nz=14 → HOOKED ✓
[mesh] GetVertexAttribute @0x7616ecb498 bytes 081c00f9 nz=15 → HOOKED ✓
```

**文件字节与运行时字节完全吻合 ⇒ 定位 100% 正确。**

### 41.10.3 ★★★ 三重安全机制（避免崩溃）

```c
① find_base()      : 只认 offset==0 的映射
② range_ok()       : RVA 必须落在代码段 0x9534000..0x1ef58000
③ 非零自检          : 目标 16 字节里非零 < 8 ⇒ 拒绝安装
④ 分支自检          : 前 4 条含 B/BL/B.cond/CBZ/TBZ ⇒ 拒绝安装（trampoline 无法重定位分支）
⑤ 每目标独立 stub   : hook_entry0/1/2，各自绑定 trampoline（曾因共享 g_tramp_ptr 差点崩溃）
```

### 41.10.4 ★ ARM64 分支检测的正确编码（我踩过坑）

```c
static const char* br_kind(uint32_t w){
    uint32_t o26 = w>>26, o24 = w>>24;
    if(o26==0x05) return "B";
    if(o26==0x25) return "BL";
    if(o24==0x54) return "B.cond";        // ★ 看高 8 位，不是 w>>26！
    if(o24==0x34||o24==0x35||o24==0xb4||o24==0xb5) return "CBZ/CBNZ";
    if(o24==0x36||o24==0x37||o24==0xb6||o24==0xb7) return "TBZ/TBNZ";
    return 0;
}
```
**⚠️ 我最初写成 `(w>>26)==0x35` 判 B.cond ⇒ **全错**，导致误判「安全」。**

### 41.10.5 ★★★ 最终结论：**游戏不走 UnityEngine.Mesh 托管 API**

**用正确的分支检测筛出 36 个「安全」目标，逐个测试：**

| 目标 | RVA | 结果 |
| --- | --- | --- |
| `HGMeshRendererData.GetMeshes` | `0x1a51114c` | 0 次 |
| `get_vertices` | `0x1a4abe64` | 0 次 |
| `GetAllocArrayFromChannelImpl` | `0x1a4aa9a4` | 0 次 |
| `GetVertexAttribute` | `0x1a4aa498` | 0 次 |
| **`get_bounds`（视锥剔除热路径！）** | **`0x1a4ab408`** | **0 次** |
| `get_subMeshCount` | `0x1a4ab378` | 0 次 |
| `SetUVs` | `0x1a4ad29c` | 0 次 |

**⇒ 连 `get_bounds`（剔除每帧每物体调用）都 0 次
⇒ **确证：游戏完全不用托管 Mesh API**（与鹰角魔改 `HGMeshRenderer`/`HGGraphicsModule` 一致）**

### 41.10.6 native 路线受阻

```
libunity.so (30,305,720 字节, 已 strip, 仅 347 个动态符号)
  'UnityEngine.Mesh/MeshData::GetVertexDataPtr'  VA=0xe8d89
  'UnityEngine.Mesh/MeshData::GetVertexDataSize' VA=0x19070b
  ⇒ 指向字符串的 8 字节指针: 0 个
  ⇒ adrp+add 引用:        0 处
  ⇒ 字符串在【错误消息表】里，无可用 xref
```

### 41.10.7 ⏭️ 剩余可行路线

| 优先 | 路线 | 说明 |
| --- | --- | --- |
| **1** | **确认用户是否已进入渲染场景** | 若未进入 ⇒ 上面所有 0 次都是正常的，重测即可 |
| **2** | 用 **Frida / zygiskfrida** 动态枚举 | 直接 `Module.enumerateExports` + `Interceptor` 找 native Mesh 函数<br>（设备上已有 `zygiskfrida` 模块） |
| 3 | 回到**静态分析**（用修正后的判据） | §40.11 的扫描用了错误前提（`numItems` 在文件里），可重做 |
| 4 | hook `HGGraphicsModule` 的 native 函数 | 需先在 libunity.so 里定位（当前受阻） |

### 41.10.8 ⚠️ 待用户确认的关键问题

**「是否已进入游戏、能看到角色模型？」**
```
① 未进入  ⇒ 0 次调用是正常的（get_bounds 在场景加载后才调用）⇒ 重测
② 已进入  ⇒ 确证走 native ⇒ 转向路线 2（Frida 枚举）或路线 3（静态重做）
```

---

## 41.11 ★★★★★ 重大发现：`libil2cpp.so` 是**加壳**的（第 46–47 轮）

### 41.11.1 证据链

**① VFS 探针的运行时结果 —— 全部 EMPTY**

```
[mesh] il2cpp @0x79b17ef000 (iter=10)
[mesh] ValidChunkLength          @0x79be3862c8 bytes 00000000 nz=0   ← 全 0
[mesh] ValidChunkLength: EMPTY, skip
[mesh] VFSFileReadStream.Read    @0x79be395060 bytes 00000000 nz=0   ← 全 0
[mesh] VFSFileReadStream.Read: EMPTY, skip
[mesh] get_Position              @0x79be395d40 bytes 00000000 nz=0
[mesh] get_Length                @0x79be395c84 bytes 00000000 nz=0
```

**（我加的「非零自检」正确拦住了 4 个错误目标，没有装到空区域上）**

**② 对照：Mesh 目标全部正常**

```
[mesh] get_bounds        @0x76184f4408 bytes 080c00f9 nz=14  → HOOKED ✓
[mesh] get_subMeshCount                 bytes fe0741f8 nz=16  → HOOKED ✓
[mesh] get_vertices                     bytes 08d946f9 nz=14  → HOOKED ✓
[mesh] SetUVs                           bytes 60001fd6 nz=14  → HOOKED ✓
```

**③ `libil2cpp.so` 里**没有任何 VFS 字符串****

```
"InitBundle"          → 0 次
"ValidChunkMD5"       → 0 次
"ValidChunkLength"    → 0 次
"VFSFileReadStream"   → 0 次
"VirtualFileSystem"   → 0 次
"chunkMD5"            → 0 次
"BlockValidator"      → 0 次
```

**④ 文件里 0xcb97484 处**有数据**（32/32 非零，看似 ARM64），但**运行时是 0****

### 41.11.2 ★★★★ 结论

```
libil2cpp.so 被【加固壳】保护:
  · 文件里 Common.Beyond（VFS）那部分代码是【加密的】（高熵字节）
  · 运行时由壳解密到内存（或替换映射）
  · 所以：
      - 文件里搜不到 VFS 字符串（被加密）
      - dump.cs 的 VFS RVA 在运行时对不上
  · 而 UnityEngine 的 icall 段（0x1a4xxxxx）【未被加密】
    ⇒ 所以 Mesh 的 hook 全部成功
```

### 41.11.3 ⚠️ 这**推翻了**我之前的一个「已证明」结论

```
我之前说「证明校验不是元凶」，依据是:
  · 反汇编 0xcb97484 得到垃圾指令 —— 当时以为「dump.cs 记录有误」
  · 现在明白: 【那个 RVA 在运行时是壳的零填充区】
⇒ 【我从来没真正测试过校验逻辑】
⇒ 「校验不是元凶」的结论【不成立】，必须重新验证
```

### 41.11.4 ✅ 路线 C：绕过加壳，hook **libc**

**新增 `tools/zygisk/payload-libcprobe.c`（141 行）：**

```
hook libc 的 pread64（系统库，无壳）
  在 hook 里: 若 offset ∈ [50,000,000, 56,000,000)
              ⇒ 记录 (fd, offset, count, 通过 /proc/self/fd 反查的路径)
该区间覆盖我们改的 .ab 条目（.chk 内偏移 52,233,268）
```

**判据：**
```
· 日志出现该区间的读取 ⇒ 游戏【确实读了】我们的数据
· 完全没有            ⇒ InitBundle 根本没被加载（或走了 mmap/别的路径）
```

**验收：编译成功 68,321 字节，RUNPATH 0，NEEDED 4，导出 init ✓**

### 41.11.5 ⏭️ 其它路线

| 路线 | 说明 |
| --- | --- |
| **A** | 从**运行中的进程** dump 解密后的 `libil2cpp.so` ⇒ 再做 il2cpp dump ⇒ 准确 RVA |
| **B** | 运行时**扫描内存**找目标函数（特征字节/调用图） |
| **C** | **hook libc 的文件读取（★ 已实现，绕过加壳）** |
| D | hook `libunity.so` 的 native Mesh 函数（同样可能加壳，需验证） |

---

## 41.12 ★★★★★ `find_base` 的致命 bug + 撤回「加壳」误判（第 48–49 轮）

### 41.12.1 ★ 运行时映射的真相

```
746d784000-748e319000 r--p 00000000     ← 第一个 r--p（549 MB，整个文件）
75fccd5000-7606208000 r--p 00000000     ← 第二个 r--p（156 MB = 第一 LOAD 段）
7606209000-761bc2b000 r-xp 09534000     ← ★ 代码段（362 MB，offset=0x9534000）
761bc2d000-761c947000 rw-p 1ef58000
```

**⇒ 有【两个】`offset=0` 的 r--p 映射！**

### 41.12.2 ★★★ 正确的基址推导

```
基址 = 可执行段起始 - 可执行段 offset
     = 0x7606209000 - 0x9534000
     = 0x75fccd5000          ← 与第二个 r--p 一致 ✓
```

**而 `find_base()` 原来取【第一行 offset==0】⇒ 拿到 `0x746d784000` ⇒ 错！**

### 41.12.3 ★★ 为什么 Mesh hook 却成功了？

```
0x1a4ab408 落在【第一个 LOAD 段】（VA 0 .. 0x9532584）
  ⇒ 该段运行时映射从 0x746d784000 起（offset 0）
  ⇒ 用错基址时：0x746d784000 + 0x1a4ab408 = 0x748D0F408
     —— 恰好仍在第一段的映射范围内（0x746d784000 .. 0x748e319000）
  ⇒ 【碰巧对了】✓

0xcb97484 落在【第二个 LOAD 段】（VA 0x9534000 ..）
  ⇒ 用错基址：0x746d784000 + 0xcb97484 = 0x75392B484
     —— 不在任何映射内 ⇒ 读到 0 ⇒ EMPTY
  ⇒ 【错了】✗
```

### 41.12.4 ★★ 修复后的验证（决定性）

```
修复前: ValidChunkLength bytes 00000000 nz=0  → EMPTY, skip
修复后: ValidChunkLength @0x760a2b82c8 bytes da7c2c86 nz=16 → HOOKED ✓
        VFSFileReadStream.Read @0x760a2c7060 bytes 2f8723be nz=16 → HOOKED ✓
        get_Position @0x760a2c7d40 bytes 483ad4b8 nz=16 → HOOKED ✓
        get_Length   @0x760a2c7c84 bytes 0177d6b8 nz=16 → HOOKED ✓

★★ 运行时字节与【文件里完全一致】:
   运行时 ValidChunkLength       bytes da 7c 2c 86
   文件   0xcb972c8              da 7c 2c 86   ✓
   运行时 VFSFileReadStream.Read bytes 2f 87 23 be
   文件   0xcba6060              2f 87 23 be   ✓
```

### 41.12.5 ⚠️ 撤回「libil2cpp.so 加壳」的结论

```
❌ 我上一轮的结论：「libil2cpp.so 是加壳的」
✅ 真相：libil2cpp.so 【没有加壳】，代码就是明文

真正原因：find_base() 取错基址
  ⇒ base+RVA 落在未映射区 ⇒ 读到 0 ⇒ 我误判为「壳的零填充」

（文件里搜不到 VFS 字符串 ⇒ 那是【字符串存储位置】的问题，与加壳无关）
```

### 41.12.6 ★ 方法论教训（第二次同类错误）

```
第 1 次（第 26 轮）: 只验证「文件被改了/没被恢复」，
                     没验证「游戏是否接受」⇒ 30+ 轮跑偏
第 2 次（第 46 轮）: 看到「运行时读到 0」，
                     没验证「基址是否算对」⇒ 误判「加壳」

⇒ 共同点：【把「观察到异常」直接当成「结论」，跳过了「验证中间假设」】
⇒ 教训：异常现象出现时，先验证【最底层的假设】（地址算法、路径、权限），
   再往上层推断。
```

### 41.12.7 ★ 合并探针（第 49 轮）

**`payload-vfsprobe.c` 现在同时包含：**

| 层 | 目标 | 作用 |
| --- | --- | --- |
| **VFS** | `ValidChunkLength` (0xcb972c8) | 校验是否被调用 |
| **VFS** | `VFSFileReadStream.Read` (0xcba6060) | 读取路径 |
| **VFS** | `get_Position` (0xcba6d40) / `get_Length` (0xcba6c84) | 偏移信息 |
| **libc** | `pread64`（dlsym 获取） | **记录 offset ∈ [50M,56M) 的真实读取 ⇒ 绕过一切中间层** |

**编译产物：68,401 字节；导出 `hook_entry0/1/2` + `hook_entry_libc` + `hook_pread64` + `init`**
