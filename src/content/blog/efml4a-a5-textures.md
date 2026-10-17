---
title: "A5 · 纹理与流偏移"
description: "ASTC 纹理定位与流偏移规则（流式=SerializedFile大小，内嵌=0）"
date: 2026-10-17
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

# A5 · 纹理与流偏移

**这篇讲什么**
怎么在几百 MB 的数据里找到一张具体的图，怎么把它换掉。

**为什么重要**
这是整个项目**最实用**的一篇。如果你只想动手改一个东西，读这篇就够。
另外 —— **这篇里的那个「流偏移」错误，让我反复失败了好几轮。**

---

## 先说结论

```
1. 纹理格式是 ASTC_4x4 / 5x5 / 6x6，不是 BC7。
2. ★ 纹理的流偏移【几乎从来不是 0】。

   流式 bundle（内部有 .resS 段）:
       streamOffset = SerializedFile 段的大小

   内嵌 bundle（没有 .resS）:
       streamOffset = 0

3. 用错偏移的后果: 你会把 ASTC 数据写到 Unity 序列化文件的头上
   ⇒ 游戏读到损坏的文件 ⇒ 启动就退出，或者花屏。
```

---

## 1. 先认识 ASTC

ASTC 是一种**块压缩**格式。图片被切成小块，每块 16 字节。

```
size = ceil(W / blockW) × ceil(H / blockH) × 16
```

**换算表：**

| 尺寸 | 格式 | 数据量 | 算式 |
|---|---|---|---|
| 256×256 | 4x4 | 65,536 | `64 × 64 × 16` |
| 304×68 | 6x6 | 9,792 | `51 × 12 × 16` |
| 1012×364 | 4x4 | 368,368 | `253 × 91 × 16` |
| 1024×1024 | 4x4 | 1,048,576 | `256 × 256 × 16` |

**⚠️ 一定先算一遍。** 大小不对说明格式或尺寸判断错了。

---

## 2. 找到你要的纹理

```bash
REF=~/EFML4A/ref
$REF/texinfo/bin/Release/net8.0/texinfo <bundle.ab> <纹理名>
```

**输出：**
```
名称: ui_main_menu_logo_icon
尺寸: 304x68  格式: ASTC_6x6
m_StreamData.path   = "archive:/CAB-xxx/CAB-xxx.resS"
m_StreamData.offset = 0        ← ⚠️ 这个 0 会骗你
m_StreamData.size   = 9792
```

**⚠️ `m_StreamData.offset = 0` 不代表在流的开头。**
它是**相对 `.resS` 段**的偏移。真正的流内偏移还要加上 `SerializedFile` 的大小。

---

## 3. ★★★ 算流偏移（最容易错的一步）

### 3.1 用 filesz 看 bundle 内部布局

```bash
$REF/filesz/bin/Release/net8.0/filesz <bundle.ab>
```

**情况 A：有 `.resS`（流式）**

```
CAB-ea25e5a9403100dcf494ba3ca249faae          14768  累计前=           0
CAB-ea25e5a9403100dcf494ba3ca249faae.resS      9792  累计前=       14768
流总长 = 24560
                                                ↑
                                      这就是 streamOffset
```

**翻译：** 这个 bundle 里有两个段 —— 序列化文件（14,768 字节）和纹理数据（9,792 字节）。
纹理从流的第 14,768 字节开始。

**情况 B：没有 `.resS`（内嵌）**

```
CAB-8e64a7d61483ea16539b04f304be9ed7    34774464  累计前=           0
流总长 = 34774464
                                                ↑
                                    没有 .resS ⇒ streamOffset = 0
```

**翻译：** 整个 bundle 就是一个序列化文件，纹理数据嵌在里面。偏移从 0 算。

### 3.2 实测的正确偏移

| bundle | 纹理 | 尺寸 | 有 `.resS`? | **正确 streamOffset** |
|---|---|---|---|---|
| `e8d56088...` | login_logo_en | 1040×236 | 有 | **18,160** |
| `72a08148...` | login_logo01 | 888×236 | 有 | **18,256** |
| `540d0269...` | ui_main_menu_logo_icon | 304×68 | 有 | **14,768** |
| `8d3bdd34...` | loging_popup_bg_deco01 | 800×452 | 有 | **22,312** |
| `68cd4add...` | （27 MB 大包） | — | **无** | **0** |
| `e9dd0a37...` | （23 MB 大包） | — | **无** | **0** |

---

## 4. ⚠️ 用错偏移会怎样（我踩过）

```
用 streamOffset = 0 去打一个流式 bundle:

  ┌─ SerializedFile (14,768 字节) ─┬─ .resS (9,792 字节) ─┐
  │  Unity 文件头 ← 被我覆盖了！    │  纹理数据             │
  └────────────────────────────────┴───────────────────────┘

结果:
  · 游戏读到损坏的 Unity 序列化文件
  · 表现 1: 启动画面闪一下就退出
  · 表现 2: 花屏 / 噪点 / 条纹 / 错位
```

**这个错误让我以为「写入链路有问题」，排查了很久。**
实际上链路一直是对的，只是我打错了地方。

---

## 5. 换掉它

```bash
BIN=~/EFML4A/tools/.efml4a-bin
REF=~/EFML4A/ref
ASTCENC=$REF/astc-encoder/build/Source/astcenc-native

# ① 生成图（或者把你的 PNG 转成 TGA）
$BIN/mkpattern /tmp/x.tga 304 68
# 也可以用自己的图: 任何 304x68 的 TGA 都行

# ② 编码成 ASTC（格式必须跟原纹理一致！）
$ASTCENC -cl /tmp/x.tga /tmp/x.astc 6x6 -thorough

# ③ 剥掉 16 字节文件头（只要纯数据）
dd if=/tmp/x.astc of=/tmp/x.raw bs=1 skip=16

# ④ 验证大小
ls -l /tmp/x.raw        # 应该是 9792

# ⑤ 重建 .ab（★ 用正确的 streamOffset）
$BIN/abpack <原bundle.ab> /tmp/out.ab 14768 /tmp/x.raw pad

# ⑥ 验证
$BIN/abverify /tmp/out.ab /dev/null 14768 /tmp/x.raw
# 应该看到: ★ 目标区(14768,9792) 匹配=TRUE
```

**到这里，文件就改好了。接下来是写回游戏 —— 见 [C1](C1-write-chain.md)。**

---

## 6. 游戏启动时到底用了哪些图（实测）

**用 `vktex` payload 能看到游戏每一次纹理上传：**

| 上传序号 | 尺寸 | 这是什么 |
|---|---|---|
| #1-#13 | 4x4 / 1x1 / 16x16 | Unity 内部的默认纹理 |
| #14 | 256x2 | 真实数据 |
| #16 | 1024x1 | 渐变查找表 |
| **#29-#37** | **1920×1080 × 9** | **启动背景（9 帧动画）** |
| **#57** | **304×68** | **`ui_main_menu_logo_icon`** |
| #58 | 256x256 | |
| #59 | 2048x4096 | 大图集 |
| #60 | 1024x2048 | 大图集 |

**⚠️ 那 9 张 1920×1080 我在 InitBundle 前 60 大的 bundle 里没找到。**
可能在 `7064D8E2` main 组（需要进场景才加载），或者根本是引擎程序化画的。

---

## 7. 踩坑速查

| 症状 | 原因 | 解法 |
|---|---|---|
| 启动闪退 | 流偏移错，覆盖了文件头 | 用 filesz 算正确偏移 |
| 花屏/噪点 | 同上，或格式不匹配 | 确认 4x4/5x5/6x6 一致 |
| 大小对不上 | 公式算错或尺寸判断错 | `ceil(W/bw)*ceil(H/bh)*16` |
| 图变了但不显示 | 这个纹理不在当前界面用 | 换一个目标 |
| astcenc 报错 | 输入不是 TGA | 转成 TGA |

---

## 8. 下一步

读完这篇你应该能：
- ✅ 算出任意纹理的数据大小
- ✅ 用 filesz 算出正确的流偏移
- ✅ 把一张图编码成 ASTC 并打进 `.ab`

接着读 **[C1 · 离线写入链路](C1-write-chain.md)** —— 把它写进游戏。
