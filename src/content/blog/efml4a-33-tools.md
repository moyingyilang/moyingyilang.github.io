---
title: "33. 工具集（EFML4A）"
description: "EFML4A 研究文档 · 33-tools（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 第 2 阶段「转向工具研发」的产物。所有工具均为**自包含**、**无外部依赖**
> （除 Python 3 / Termux clang）。

## 33.1 `tools/vfs/abtool.py` —— Unity `.ab` 分析器（整合版）

**把第 2 阶段开发的全部分析方法固化成一个工具。**

```bash
abtool.py <命令> [参数...]
```

| 命令 | 说明 |
| --- | --- |
| `map <map.tsv>` | 列出映射条目（按大小排序） |
| `info <chk> <map.tsv> <索引>` | 条目基本信息（含 Unity 版本串） |
| `strings <chk> <map.tsv> <索引> [起] [止]` | 提取有序可读串 |
| `nodes <chk> <map.tsv> <索引> <起> <止>` | **顺序解析 z-terminated 节点**（结构钥匙） |
| `entropy <chk> <map.tsv> <索引> [窗]` | **滑动窗口熵图**（判明文/压缩/加密） |
| `floats <chk> <map.tsv> <索引> [起] [止]` | **float 合理性密度图**（定位数据区） |
| `uv <chk> <map.tsv> <索引> [起]` | 找 UV 流（每 12 B 第 3 个 float 恒 0） |
| `bones <chk> <map.tsv> <索引> [起]` | 找骨骼流（每 16 B 后 8 B 是 <4096 的 u16） |
| `calls <chk> <map.tsv> <索引> [起] [止]` | 包围盒 + 数据段候选 |

**判读参考**：
```
熵   <5.0 明文 | 5.0-6.5 结构化明文 | 6.5-7.5 压缩 | >7.9 加密
uint16 索引: 从 0 严格递增
名字: 以 00 结尾的 ASCII（z-terminated）
```

## 33.2 `tools/vfs/chkpatch.c` —— 等长内容替换（部署主力）

```bash
chkpatch flip    <chk> <off> <len> [step] [xor]
chkpatch splice  <dst> <dOff> <src> <sOff> <len>
chkpatch hex     <chk> <off> <hexbytes>
chkpatch restore <chk>
```
**核心原则**：**全部等长 ⇒ `.blc` 无需改动 ⇒ 索引与 CRC32 天然有效**。

## 33.3 `tools/vfs/deVFS.sh` —— 自包含解密/解析/提取

```bash
deVFS.sh info                      # 密钥与算法
deVFS.sh blc   <x.blc> [out]       # 解密 .blc
deVFS.sh crc   <x.blc>             # 校验 CRC32
deVFS.sh list  <VFS目录>            # 批量解密
deVFS.sh parse <x.blc> [out.tsv]   # 导出文件清单
deVFS.sh parseall <VFS目录>         # 全量映射
deVFS.sh hg    <x.chk> [out]       # HGCipher 解 :)xD
deVFS.sh get   <x.blc> <x.chk> <名> [out]  # 按映射提取
```

## 33.4 其它工具

| 工具 | 用途 |
| --- | --- |
| `tools/vfs/parse_nodes.py` | 顺序节点解析（`abtool nodes` 的前身） |
| `tools/vfs/zstrings.py` | 扫 z-terminated 串 |
| `tools/vfs/abstrings.py` | 提取有序可读串 |
| `tools/mem/memfast.c` | 内存多特征扫描（0.29 GB/s） |
| `tools/mem/memfindall.c` | 内存多特征（早期版） |
| `tools/mem/sigall.c` | 生成 `.blc` 解密后特征 |
| `tools/zygisk/payload-hookb.c` | 方案 B：`GetAssetStream` 内联 hook |
| `scripts/keepalive.sh` | **灭屏保活** |
| `scripts/post-update-diff.sh` | **1.6 更新后对比** |

## 33.5 环境铁坑（工具使用须知）

| # | 坑 | 对策 |
| --- | --- | --- |
| ① | **`python3` 不在 `su -c` 的 root shell 中** | 一切处理在 Termux 内做完再 `cp` |
| ② | **`su -c cp` 把文件拷成 `root:root 644`** | 拷完 `chmod 666` + `chown u0_a446` |
| ③ | `grep` 过滤掉工具报错 ⇒ 假象 | 诊断时**不要过滤** stderr |
| ④ | `find -newermt` 在部分 busybox 上失效 | 用 `ls -lt` |
| ⑤ | 误判「加密」 | **先跑 `abtool entropy`** |
| ⑥ | **Unity 版本串可能被截断**（`2021.3.` 而非 `2021.3.3`） | 搜 `2021.3`（短前缀） |

---

## 33.6 `tools/vfs/meshswap.py` —— 「原地等长替换」部署工具

**把第 29 轮**已证明可用**的操作封装成一键工具。**

```bash
meshswap.py probe    <chk> <map.tsv> <索引> [数据区起点]
meshswap.py build    <chk> <map.tsv> <索引> <数据区起点> <源文件> <输出文件>
meshswap.py deploy   <chk> <输出文件>
meshswap.py rollback <chk>
```

### 原理

```
不解析 .ab 结构，直接在【已知数据区】做等长覆盖。
等长 ⇒ .blc 的 {offset,len} 与尾部 CRC32 天然有效 ⇒ 游戏直接采用。
```

### 已验证（复现第 29 轮的成功产物）

```bash
$ meshswap.py build initbundle.chk ib.tsv 1030 12800 \
    em/Meshes/Component0_VB0.buf ms.chk
  源文件    : Component0_VB0.buf  (126576 字节)
  目标区    : 块内 51377053  可用 2386599 字节
  将写入    : 126576 字节
  原 md5    : f68ea9095c7e7f5c78439e1d6763a5e9
  新 md5    : 50ccba83ba3c926afc549eac69c4225a

第 29 轮手工产物 md5: 50ccba83ba3c926afc549eac69c4225a
                                        ⇒ ★ 完全一致（工具正确）
```

### `deploy` 的安全性

- **自动 `force-stop` 游戏**
- **自动备份到 `~/.efml4a/scratch/meshswap_auto/orig.chk`**
- **自动生成 `ROLLBACK.sh`**
- **自动校验 md5 与大小**
- **自动重启游戏**

### `rollback`

```bash
meshswap.py rollback <chk>       # 或 su -c sh ~/.efml4a/scratch/meshswap_auto/ROLLBACK.sh
```

---

## 33.7 `scripts/deploy-mod.sh` —— 一键部署 / 回滚（纯 Shell）

**把整个 mod 部署流程自动化（第 46 轮）。**

```bash
scripts/deploy-mod.sh detect                    # 探测游戏状态
scripts/deploy-mod.sh status                    # 查看 mod 状态（含原版/已改标记）
scripts/deploy-mod.sh deploy <VB0文件> [块号]    # 部署（默认 InitBundle = 0CE8FA57）
scripts/deploy-mod.sh rollback                  # 回滚
```

### 自动化的步骤

```
① detect  ：版本 / VFS 概况 / InitBundle 目录
② 定位目标 ：解密 .blc → 读 version 与 chunkMD5 → 得出目标 .chk 文件名
③ 定位条目 ：搜 "Root/" 的所有位置 → 减去骨骼表偏移 288,693 → 得条目起点
            （并用 m_Center ≈ -0.19 验证候选）
④ 等长替换 ：abtool swap <chk> (条目起点+12800) <VB0> <out>
⑤ 备份     ：保存 orig + 记录 md5
⑥ 部署     ：force-stop → 拷贝 → chown/chmod（u0_a443:ext_data_rw 660）→ 启动
⑦ rollback ：从备份恢复
```

### 依赖

```
$HOME/.efml4a/scratch/vfs/blcparse   （C）
$HOME/.efml4a/scratch/vfs/abtool     （C）
$HOME/.efml4a/vfs/deVFS.sh           （Shell，用于解密取 chunkMD5）
```

### ⚠️ 注意

- **`deploy` 会 `force-stop` 游戏**（必须，避免文件占用）
- **目标 `.chk` 属 `u0_a443:ext_data_rw 660`**，部署后必须重新 `chown/chmod`
- **顶点区偏移 `+12800` 是经验值**；若游戏版本改了内部布局需重新定位
  （见 `docs/39` §4.1 的存疑记录）

---

## 33.8 `tools/vfs/bufinfo.c` —— EFMI `.buf` 分析器（纯 C）

```bash
bufinfo info  <目录>                      # 汇总一个 mod 的所有组件
bufinfo ib    <x_IB.buf>                  # 分析索引（索引数/三角形/min/max/退化/越界）
bufinfo vb    <x_VB0.buf> <stride>        # 分析顶点流（顶点数/包围盒/第4字段统计）
bufinfo dump  <x_VB0.buf> <stride> <N>    # 转储前 N 个顶点
bufinfo cmp   <a.buf> <b.buf>             # 比较两个文件（差异字节数/首个差异）
```

**验证结果（`edmin_maid` Component0）：**
```
IB  : 27,615 索引 = 9,205 三角形；min=0 max=7910；退化=0 越界=0
VB0 : stride=16；7,911 顶点；异常=0
      ★ 不变量 VB0_size/16 == max(IB)+1 完美成立
第4字段: 全非零，均值 2.5e9 ⇒ 打包数据（法线/切线），非 float
```
