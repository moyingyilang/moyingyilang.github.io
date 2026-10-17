---
title: "C1 · 离线写入链路"
description: "7 步把一张 ASTC 图写进游戏（含字节级验证）"
date: 2026-10-17
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

# C1 · 离线写入链路

**这篇讲什么**
把 C1 之前准备好的一张 ASTC 图，完整地写进游戏文件里。

**为什么重要**
这是「动手」的那一篇。7 个步骤，命令可以照着敲。

**⚠️ 前置条件：** 先读 [A5](A5-textures.md)，你要知道改哪个纹理、它的流偏移是多少。

---

## 整体流程

```
①  定位纹理      知道改哪个 .ab，它的 offset / len 是多少
②  算流偏移      流式 bundle 用 SerializedFile 大小，内嵌用 0
③  生成替换      图片 → ASTC → 剥头
④  重建 .ab      abpack 的 pad 模式
⑤  写进 .chk     原地等长替换
⑥  更新 .blc     改 contentMD5 和 dataMd5
⑦  写回游戏      删清单 + 启动
```

---

## 第 ① 步：知道改哪个

```bash
BIN=~/EFML4A/tools/.efml4a-bin
REF=~/EFML4A/ref

# 从 .blc 里查这个 bundle 在哪
$BIN/vfsfull /path/to/0CE8FA57.blc | grep 540d0269

# 输出:
#   file683: "Data/Bundles/Android/initial/540d0269....ab" \
#            off=4429838 len=9806 bt=2 enc=0 iv=0
#                ↑        ↑
#             在 .chk 里的偏移   长度
```

**记住这两个数字：`4429838` 和 `9806`。**

---

## 第 ② 步：算流偏移

```bash
$REF/filesz/bin/Release/net8.0/filesz <bundle.ab>
```

**有 `.resS` 的（流式）：**
```
CAB-ea25e5a9...      14768  累计前=0
CAB-ea25e5a9....resS  9792  累计前=14768
                                  ↑
                          streamOffset = 14768
```

**没有 `.resS` 的（内嵌）⇒ `streamOffset = 0`**

**⚠️ 这一步错了后面全错。** 详细说明见 [A5 第 3 节](A5-textures.md)。

---

## 第 ③ 步：生成 ASTC

```bash
ASTCENC=$REF/astc-encoder/build/Source/astcenc-native

# 生成测试图（或用自己的 TGA）
$BIN/mkpattern /tmp/x.tga 304 68

# 编码（格式必须跟原纹理一致）
$ASTCENC -cl /tmp/x.tga /tmp/x.astc 6x6 -thorough

# 剥掉 16 字节文件头
dd if=/tmp/x.astc of=/tmp/x.raw bs=1 skip=16

# 检查大小: ceil(304/6) × ceil(68/6) × 16 = 51 × 12 × 16 = 9792
ls -l /tmp/x.raw
```

---

## 第 ④ 步：重建 `.ab`

```bash
$BIN/abpack <原bundle.ab> /tmp/out.ab 14768 /tmp/x.raw pad
```

**`pad` 模式在做什么：**

```
1. 只重新压缩受影响的数据块，其他块原样复制
   （原块已经是加密状态 ⇒ 跳过重新加密，省钱又省事）

2. 给压缩后的块信息追加填充，试图让它恰好等于原来的 compBI

3. 如果做不到（新压缩结果更大）⇒ 退回 min 模式 + 零填充

4. 输出长度与原始完全一致
```

**成功的输出长这样：**
```
重压后总 comp=8223 (原 9646)  [最小改动]
新块信息混淆明文=137 (原 137)
块信息压缩=102 (原 101)        ← ⚠️ 这里变了，后面会出问题
零填充 1423 字节 → 总长 9806（与原长一致）
✓ 写出 out.ab: 9806 字节 (原 9806)  ★ 总长不变
```

**验证：**
```bash
$BIN/abverify /tmp/out.ab /dev/null 14768 /tmp/x.raw
# 应该看到: ★ 目标区(14768,9792) 匹配=TRUE
```

---

## 第 ⑤ 步：写进 `.chk`

```bash
# 复制一份原始 .chk（安全第一）
cp /path/to/orig.chk /tmp/work.chk

# 原地替换（等长，不改变文件长度）
dd if=/tmp/out.ab of=/tmp/work.chk bs=1 seek=4429838 conv=notrunc

# 验证写对了
dd if=/tmp/work.chk bs=1 skip=4429838 count=9806 2>/dev/null | md5sum
# 应该等于 /tmp/out.ab 的 md5
```

**⚠️ 别用 `dd bs=1` 处理大文件** —— 它单字节拷贝，慢得离谱。
大文件用 `tail -c +N | head -c M`。

---

## 第 ⑥ 步：更新 `.blc`

```bash
NM=$(md5sum /tmp/work.chk | awk '{print $1}')          # 新 .chk 的 md5
NEWAB=$(md5sum /tmp/out.ab | awk '{print $1}')          # 新 .ab 的 md5

# ① 更新 chunk 的 contentMD5 + CRC32
$BIN/blcfix /path/to/orig.blc /tmp/s1.blc "$NM" "a47587ba5eef7fd05f1fec103dea85bd"
echo "blcfix 退出码: $?"

# ② 更新 file 的 dataMd5 + CRC32
$BIN/blcsetdata /tmp/s1.blc /tmp/s2.blc \
  "Data/Bundles/Android/initial/540d02690a7c7b8fd4fe6e66.ab" "$NEWAB"
echo "blcsetdata 退出码: $?"

# ③ 验证 .blc 还能解析
$BIN/vfsfull /tmp/s2.blc | wc -l
# 应该 > 1000 行
```

**⚠️ 一定检查退出码！** 我的 `blcsetdata` 曾经因为 `fopen` 失败没检查 NULL，
静默生成了一个无效的 `.blc` —— 然后我拿着它去写游戏，当然不行。
现在所有 `fopen` 都检查，所有 `fwrite` 都验证返回值。

---

## 第 ⑦ 步：写回游戏

```bash
VD=/data/media/0/Android/data/com.hypergryph.endfield/files/VFS
FD=/data/media/0/Android/data/com.hypergryph.endfield/files

# 停游戏
su -c "am force-stop com.hypergryph.endfield"
sleep 2

# 写文件
su -c "cp /tmp/s2.blc '$VD/0CE8FA57/0CE8FA57.blc'"
su -c "cp /tmp/work.chk '$VD/0CE8FA57/A47587BA5EEF7FD05F1FEC103DEA85BD.chk'"

# 删清单（让游戏重建）
for f in index_initial.json pref_initial.json index_main.json pref_main.json; do
  su -c "rm -f '$FD/$f'"
done

# 启动
su -c "am start -n com.hypergryph.endfield/com.u8.sdk.U8UnityContext"
```

**如果一切正常：** 游戏能启动、不崩溃、不报错。

**⚠️ 但纹理可能还是不显示** —— 原因见 [C2](C2-blockers.md)。

---

## 验证结果（我的实测）

```
流长度:       1,054,620 == 1,054,620     ✓
首个差异位置: @6045 == 目标区起点 6044    ✓
总差异字节:   全部在目标区内              ✓
dataStart:    160 == 160                 ✓
游戏启动:     无报错、无崩溃              ✓
纹理显示:     ❌ 没有
```

**前四行说明我的写入是完美的。最后一行说明游戏不认。**

---

## 恢复原始（后悔药）

```bash
VD=/data/media/0/Android/data/com.hypergryph.endfield/files/VFS
FD=/data/media/0/Android/data/com.hypergryph.endfield/files

su -c "am force-stop com.hypergryph.endfield"
su -c "cp ~/.efml4a/BACKUP/chk_0CE8FA57_orig.bin '$VD/0CE8FA57/A47587BA5EEF7FD05F1FEC103DEA85BD.chk'"
su -c "cp ~/.efml4a/BACKUP/blc_0CE8FA57_orig.bin '$VD/0CE8FA57/0CE8FA57.blc'"
for f in index_initial.json pref_initial.json index_main.json pref_main.json; do
  su -c "rm -f '$FD/$f'"
done
su -c "am start -n com.hypergryph.endfield/com.u8.sdk.U8UnityContext"
```

**验证：**
```bash
su -c "md5sum '$VD/0CE8FA57/A47587BA5EEF7FD05F1FEC103DEA85BD.chk'"
# 应该是 f93846d47543c7a8057c26fa87530640
```

---

## 下一步

读 **[C2 · 阻塞与失败记录](C2-blockers.md)** —— 知道为什么最后一步会失败。
