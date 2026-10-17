---
title: "B1 · 工具链总览"
description: "25 个纯 C 工具的使用说明与完整流程"
date: 2026-10-17
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

# B1 · 工具链总览

**这篇讲什么**
25 个 C 工具，每个干什么用的、怎么编译、怎么跑。

**为什么重要**
如果你只想动手，不用读格式文档 —— 这篇+[C1](C1-write-chain.md) 就够你干活了。

**读完你会**
- ✅ 编译出全部工具
- ✅ 知道遇到什么问题该用哪个工具
- ✅ 能跑通一个完整的「看图 → 改图 → 写回」流程

---

## 先说结论

```
25 个工具，纯 C，零 Python。
一条命令编译:   cd tools/vfs && make
编译产物在:     tools/.efml4a-bin/

分五类:
  格式解析  → 读懂文件
  压缩      → 解压/重压
  容器重建  → 改 .ab
  .blc 写入 → 改索引
  运行时    → 内存 / 检测
```

---

## 1. 编译

```bash
cd tools/vfs
make            # 编译全部
make list       # 看编译出了什么
make clean      # 清理
```

**依赖：**
- `clang` 或 `gcc`
- `zlib`（`vfsfull` 和 `pxsample` 用）
- `pthread`（`ms` 和 `fextract` 用）

**如果你在 Termux 上：**
```bash
pkg install clang zlib
```

**CI：** 仓库里有 `.github/workflows/ci.yml`，会自动 `make -B` 并跑 `selftest`。

---

## 2. 格式解析类（读懂文件）

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| **`vfsfull`** | 解析 `.blc`，列出所有文件条目 | **想知道某个资源在哪、多大** |
| `vfsaes` | VFSAES 实现（库，不单独跑） | 别的工具链接它 |
| `blcdump` | `.blc` 结构 dump | 想确认版本/CRC/组名 |
| `findchunk` | 全局偏移 → 定位是哪个 chunk | 手上有个偏移不知道属于谁 |
| `chunknames` | 列出所有 chunk 文件名 | 想批量处理 |
| `abtool` | 解析 `.ab` 的头/块表/节点表 | 想深入看容器内部 |

**最常用的一个：**

```bash
../.efml4a-bin/vfsfull /path/to/0CE8FA57.blc

# 输出:
#   .blc: 133424 字节
#   group="InitBundle" hash=0x... fileInfoNum=1075 chunkCount=1
#   chunk0: len=217713773 bt=... files=1075
#     file0: "Data/Bundles/..." off=... len=... bt=... enc=0 iv=0
```

**怎么用这个输出？**
`off=` 和 `len=` 就是你要的位置和长度。改资源就靠这两个数。

---

## 3. 压缩类

| 工具 | 干什么 |
|---|---|
| `deps.c` | LZ4/LZ4Inv 双向实现（库） |
| `lz4invcomp4` | 独立压缩器（v4 版） |
| `lz4invtest` | 压缩器自测（压缩→解压→比对） |

**什么时候直接跑压缩器？**

```bash
# 想知道某个数据压缩后多大
../.efml4a-bin/lz4invcomp4 /path/to/data.bin /tmp/out.bin

# 输出: v4: 1048576 → 124038 (11.83%)
```

**但要真正改 `.ab` 里的数据，用 `abpack`，它会自动调压缩器。**

---

## 4. 容器重建类（改 `.ab`）

| 工具 | 干什么 |
|---|---|
| **`abpack`** | **重建 `.ab`**，支持两种模式 |
| `abverify` | 读回验证，确认改对了 |

**`abpack` 的两种模式：**

```
min  最小改动
     只重压受影响的数据块，其他块原样复制，用零填充保持总长

pad  布局不变（推荐）
     除了上面做的，还迭代填充【未压缩】的块信息，
     让压缩后长度恰好等于原 compBI ⇒ dataStart 不变
```

**用法：**

```bash
# 重建
../.efml4a-bin/abpack <in.ab> <out.ab> <streamOffset> <newdata.bin> [min|pad]

# 例子
../.efml4a-bin/abpack bundle.ab /tmp/out.ab 14768 /tmp/x.raw pad
#                                          ↑
#                                   这个数最容易错！见 A5
```

**验证：**

```bash
../.efml4a-bin/abverify /tmp/out.ab /dev/null 14768 /tmp/x.raw

# 输出:
#   ★ 目标区(14768,9792) 匹配=TRUE   ← 这个 TRUE 才说明改对了
```

---

## 5. `.blc` 写入类

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| `blcfix` | 改 chunk 的 `contentMD5` + CRC32 | **改了 `.chk` 之后必做** |
| `blcsetdata` | 改 file 的 `dataMd5` + CRC32 | **改了某个 `.ab` 之后必做** |
| `blcredirect` | 改 file 条目的 chunkName/offset/len | 想把一个资源指向另一个资源 |

**用法：**

```bash
# 你改了 .chk，它的 md5 变了 ⇒ 更新 chunk 的 contentMD5
../.efml4a-bin/blcfix orig.blc s1.blc <新chk的md5> <chunkName的hex>

# 你改了某个 .ab，它的 md5 变了 ⇒ 更新 file 的 dataMd5
../.efml4a-bin/blcsetdata s1.blc s2.blc "<文件路径>" <新ab的md5>
```

**⚠️ 一定要看退出码！**

```bash
../.efml4a-bin/blcsetdata ... ; echo "退出码: $?"
```

**为什么？** 我的 `blcsetdata` 曾经因为 `fopen` 失败没检查 NULL，
**静默生成了一个无效的 `.blc`** —— 然后我拿着它去写游戏，当然不行。
现在所有 `fopen` 都检查了，但你还是应该验证一下。

---

## 6. 运行时与内存类

| 工具 | 干什么 | 性能 |
|---|---|---|
| **`mempatch`** | 在游戏进程内存里搜索替换 | 65,536 个映射区，8 线程 |
| `ms` | 多线程内存搜索（只搜不写） | 6.7 GB 秒级 |
| **`fextract`** | 多线程提取文件 | **3.5s / 1075 文件 / 418MB** |

**什么时候用？**

```bash
# 想验证某个东西在不在内存里
su -c "../.efml4a-bin/mempatch <pid> <hex模式>"

# 想快速从大 .chk 里提取很多文件
../.efml4a-bin/fextract <src.chk> <list.txt> <outdir> 32
```

**`mempatch` 的 pattern 是 hex 字符串：**

```bash
# 比如搜 ASTC 特征
PAT=$(xxd -p -l 32 /path/to/tex.raw | tr -d '\n')
su -c "../.efml4a-bin/mempatch $PID $PAT 4 8"
#                                               ↑ ↑
#                                          最大命中  线程数
```

---

## 7. 检测与辅助类

| 工具 | 干什么 |
|---|---|
| `colordetect` | 检测 5 种纯色（品红/绿/黄/青/橙，容差 ±40） |
| `checkrb` | 检测纯红/纯蓝（棋盘图案用） |
| `redbox` / `yellowbox` | 找出指定颜色的空间范围（返回 bbox） |
| `scanmagenta` | 全图扫描高饱和色（不限于特定颜色） |
| `binsearch` | 在大文件里搜二进制模式（流式，不占内存） |
| `ent` | 熵分析（判断是加密还是压缩） |
| `crackx` | XOR 暴力破解 + 已知明文攻击 |
| `mkpattern` | 生成测试图案（棋盘+渐变+十字） |
| `mktga` | 生成纯色 TGA（给 astcenc 用） |
| `pxsample` | PNG 像素采样 |
| `selftest` | 工具链回归测试 |

**几个实用的：**

```bash
# 大文件里找某个字节序列（不会把整个文件读进内存）
../.efml4a-bin/binsearch <大文件> fcfdffffffffffffffff 8

# 判断一个文件是加密的还是压缩的
../.efml4a-bin/ent <文件>
#   熵 7.99+  ⇒ 强加密（AES/ChaCha20）
#   熵 7.5-7.9 ⇒ 压缩
#   熵 6-7     ⇒ 轻量混淆
#   熵 4-5     ⇒ 明文

# 生成测试图案
../.efml4a-bin/mkpattern /tmp/x.tga 304 68
```

---

## 8. 外部参考工具（`ref/`，C#）

**这些不是 C 工具，是参考实现，用来交叉验证。**

| 工具 | 干什么 | 为什么需要 |
|---|---|---|
| **`texinfo`** | 查纹理元数据（名称/尺寸/格式/`m_StreamData`） | **定位纹理必用** |
| **`filesz`** | 看 bundle 内部布局 | **算流偏移必用** |
| `abscan` | 批量扫描 `.ab` 里的资源 | 找特定资源 |
| `astcenc` | ASTC 编码器（ARM 官方，源码编译） | 生成 ASTC |

**用法：**

```bash
REF=~/EFML4A/ref

# 查纹理信息（最重要）
$REF/texinfo/bin/Release/net8.0/texinfo <bundle.ab> <纹理名>

# 看 bundle 布局（算流偏移）
$REF/filesz/bin/Release/net8.0/filesz <bundle.ab>

# ASTC 编码
$REF/astc-encoder/build/Source/astcenc-native -cl in.tga out.astc 6x6 -thorough
```

---

## 9. 完整流程示例

**目标：把一张图换进游戏。**

```bash
BIN=~/EFML4A/tools/.efml4a-bin
REF=~/EFML4A/ref

# ─── 1. 找到纹理 ───
$REF/texinfo/bin/Release/net8.0/texinfo bundle.ab ui_main_menu_logo_icon
#   记住: 尺寸 304x68, 格式 ASTC_6x6, size 9792

# ─── 2. 算流偏移 ───
$REF/filesz/bin/Release/net8.0/filesz bundle.ab
#   记住: streamOffset = 14768

# ─── 3. 找它在 .chk 里的位置 ───
$BIN/vfsfull group.blc | grep 540d0269
#   记住: off=4429838, len=9806

# ─── 4. 生成新图 ───
$BIN/mkpattern /tmp/x.tga 304 68
$REF/astc-encoder/build/Source/astcenc-native -cl /tmp/x.tga /tmp/x.astc 6x6 -thorough
dd if=/tmp/x.astc of=/tmp/x.raw bs=1 skip=16
ls -l /tmp/x.raw    # 应该是 9792

# ─── 5. 重建 .ab ───
$BIN/abpack bundle.ab /tmp/out.ab 14768 /tmp/x.raw pad
$BIN/abverify /tmp/out.ab /dev/null 14768 /tmp/x.raw
#   应该看到 目标区 匹配=TRUE

# ─── 6. 写进 .chk ───
dd if=/tmp/out.ab of=/tmp/work.chk bs=1 seek=4429838 conv=notrunc

# ─── 7. 更新 .blc ───
NM=$(md5sum /tmp/work.chk | awk '{print $1}')
NEWAB=$(md5sum /tmp/out.ab | awk '{print $1}')
$BIN/blcfix orig.blc /tmp/s1.blc "$NM" "a47587ba5eef7fd05f1fec103dea85bd"
$BIN/blcsetdata /tmp/s1.blc /tmp/s2.blc \
  "Data/Bundles/Android/initial/540d0269....ab" "$NEWAB"

# ─── 8. 写回游戏 ───
# 见 C1 第 7 步
```

---

## 10. 踩坑速查

| 问题 | 该用哪个工具 |
|---|---|
| 不知道资源在哪 | `vfsfull` |
| 不知道 bundle 布局 | `filesz` |
| 不知道纹理尺寸/格式 | `texinfo` |
| 改了 `.ab` 但不确定对不对 | `abverify` |
| 不知道文件是加密还是压缩 | `ent` |
| 大文件里找特征 | `binsearch` |
| 想验证东西在不在内存 | `mempatch` |
| 想快速提一大批文件 | `fextract` |

---

## 11. 下一步

读完这篇你应该能：
- ✅ 编译全部工具
- ✅ 知道什么场景用什么工具
- ✅ 跑通完整流程

接着读 **[C1 · 离线写入链路](C1-write-chain.md)** —— 详细版的完整流程。
