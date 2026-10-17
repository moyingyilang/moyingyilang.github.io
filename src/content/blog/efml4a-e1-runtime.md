---
title: "E1 · zygisk payload 与 vktex"
description: "运行时观测：3-hook 映射链与实测纹理上传清单"
date: 2026-10-17
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---

# E1 · zygisk payload 与 vktex

**这篇讲什么**
怎么在游戏运行的时候，从内存/GPU 层面观察甚至修改它 —— 不碰磁盘文件。

**为什么重要**
这是**唯一能验证「游戏到底用了哪些资源」的手段**。
我做的所有离线修改能不能生效，靠的就是这个来确认。

**读完你会**
- ✅ 知道怎么让 zygisk payload 加载起来（关键是一个 JSON 格式）
- ✅ 能用 `vktex` 看到游戏每次纹理上传
- ✅ 知道为什么不能靠截图验证

---

## 先说结论

```
1. zygisk payload 能加载 —— 关键是 target.json 的格式（对象数组，不是字符串数组）

2. vktex 能看到游戏每一次纹理上传，包括尺寸和内容

3. ★ 但别用截图验证 —— 小窗/时序/合成层都会骗你
     用 vktex 日志 + 内存搜索

4. ★ payload init 后会自动 unmap
     /proc/<pid>/maps 里查不到 ≠ 没加载
```

---

## 1. 先搞清楚：为什么要走这条路

**离线改文件的问题是：** 你不知道游戏到底会不会用你改的那个资源。

**运行时观测的好处是：** 你能看到游戏**实际**在做什么 ——
它读了哪个文件、上传了哪个纹理、尺寸多大。

**我的整个排查过程，靠的就是这个。**

---

## 2. ★ 让 payload 加载（这个格式坑了我好几轮）

### 错误的写法

```json
["com.hypergryph.endfield"]
```

**看起来合理吧？其实完全不对。**

### 正确的写法

```json
[
  {
    "app": "com.hypergryph.endfield",
    "lib": "/data/adb/modules/zygisk-loader/config/libefml4a_vktex.so"
  }
]
```

**两个关键点：**
1. 是**对象数组**，不是字符串数组
2. `lib` 必须是**绝对路径**

**我是怎么发现的？** 翻 `/data/adb/modules/zygisk-loader/config/` 目录，
看到有个 `target.json.bak-1791732179` 备份文件，打开一看是这个格式。

---

## 3. 完整部署流程

```bash
CFG=/data/adb/modules/zygisk-loader/config
FD=/data/media/0/Android/data/com.hypergryph.endfield/files

# ─── ① 部署 payload ───
cp libefml4a_vktex.so $CFG/
chmod 755 $CFG/libefml4a_vktex.so

# ─── ② 写 target.json ───
cat > /sdcard/tj.json <<'JEOF'
[
  {
    "app": "com.hypergryph.endfield",
    "lib": "/data/adb/modules/zygisk-loader/config/libefml4a_vktex.so"
  }
]
JEOF
su -c "cp /sdcard/tj.json $CFG/target.json && chmod 644 $CFG/target.json"

# ─── ③ 清旧日志 ───
su -c "rm -f $FD/efml4a_*.log"

# ─── ④ 重启游戏 ───
su -c "am force-stop com.hypergryph.endfield"
sleep 2
su -c "am start -n com.hypergryph.endfield/com.u8.sdk.U8UnityContext"

# ─── ⑤ 等它跑一会（重要！不要太早看） ───
sleep 20

# ─── ⑥ 看日志 ───
su -c "cat $FD/efml4a_vktex.log"

# ─── ⑦ ⚠️ 用完立刻清空 ───
echo '[]' > /sdcard/tj_off.json
su -c "cp /sdcard/tj_off.json $CFG/target.json"
```

**为什么要清空？** payload 挂久了可能影响稳定性，而且没必要一直挂着。

---

## 4. ★ 怎么判断 payload 加载成功了

### ❌ 错误的方法

```bash
su -c "grep efml4a /proc/$PID/maps"
# 输出为空...
```

**你会以为它没加载。其实它加载了。**

### ✅ 正确的方法

```bash
su -c "ls -la $FD/efml4a_vktex.log"
# 如果文件存在且有内容 ⇒ 加载成功了
```

**为什么？** payload 在 `init` 里干完活之后会把自己 unmap 掉，
所以 `/proc/<pid>/maps` 里查不到，但日志证明它一直在工作。

**这个误判让我浪费了好几轮。**

---

## 5. vktex 输出长什么样

```
=== efml4a vktex pid=15157 replace=0 ===
[vktex] waiter pid=15157
[vktex] vkMapMemory insn[2]=CBZ 不安全(节流)
[vktex] vkBindBufferMemory HOOKED @0x7bfd60a1f0
[vktex] vkCmdCopyBufferToImage HOOKED @0x7bfd60d770
[vktex] BindBufferMemory #1 buf=0xb400007d2fb56270 mem=0xb400007c5fbf6730 off=0
[vktex] BindBufferMemory #2 buf=0xb400007d2fb568e0 mem=0xb400007c5fc0d4d0 off=0
[vktex] Copy #1  ext=4x4    bo=0 host=0x7a28cb5080 data=7fff7f7f 7fff7f7f
[vktex] Copy #9  ext=16x16  bo=0 host=0x7a2108c000 data=00000000 00000000
[vktex] Copy #29 ext=1920x1080 bo=0 host=0x7a28cd8a00 data=fffffdfc ffffffff
[vktex] Copy #57 ext=304x68 bo=0 host=0x7a07994740 data=fffffdfc ffffffff
[vktex] Copy #59 ext=2048x4096 bo=0 host=0x79bd63d000 data=00000000 00000000
[vktex] ★ 重装窗口已关闭（不再触碰代码，消除竞态）
```

**怎么读这个日志：**

| 字段 | 意思 |
|---|---|
| `Copy #N` | 第 N 次纹理上传 |
| `ext=WxH` | 纹理尺寸 |
| `bo` | bufferOffset |
| `host` | 主机内存地址 |
| `data=` | 前 8 字节的内容 |

---

## 6. ★ 启动时上传的纹理（实测清单）

| 上传序号 | 尺寸 | 这是什么 |
|---|---|---|
| #1-#13 | 4x4 / 1x1 / 16x16 | Unity 内部的默认纹理 |
| #14 | 256x2 | 真实数据 |
| #16 | 1024x1 | 渐变查找表 |
| #18 | 16x16 | 灰色 |
| #23-#28 | 4x4 / 64x64 / 58x58 / 128x128 | UI 小图 |
| **#29-#37** | **1920×1080 × 9** | **启动背景（9 帧动画序列）** |
| **#57** | **304×68** | **`ui_main_menu_logo_icon`** |
| #58 | 256x256 | |
| #59 | 2048x4096 | 大图集 |
| #60 | 1024x2048 | 大图集 |

**⚠️ 那 9 张 1920×1080 我在 InitBundle 前 60 大的 bundle 里没找到。**
可能在 `7064D8E2` main 组（进场景才加载），或者根本是引擎程序化画的。

---

## 7. ★ 为什么 payload 需要 3 个 hook

**这是最关键的技术细节。看懂了你就知道为什么我的 vk304 失败了。**

```
纹理数据在上传前，要经过这条链路:

  VkBuffer  ──(vkBindBufferMemory)──>  VkDeviceMemory  ──(vkMapMemory)──>  host 指针
      ↑                                      ↑                                  ↑
   buffer 句柄                        device memory 句柄                可以直接读写的内存

所以要拿到 host 指针，你得知道:
  buffer → 哪个 memory → memory 映射到哪
```

**三个 hook 各干什么：**

```
impl0 = vkMapMemory
        ⇒ 记录 memory → host 指针（但注意：这个函数序言有 CBZ，不能 inline hook，
          所以只能"记录"而不能"拦截"）

impl1 = vkBindBufferMemory
        ⇒ 记录 buffer → memory + offset

impl2 = vkCmdCopyBufferToImage
        ⇒ 用前面记录的映射表算出 host 指针，然后读写数据
```

**我的 `vk304.so` 只做了 `impl2` ⇒ 拿不到 host ⇒ 写不进去 ⇒ 失败。**

**`payload-vktex.c` 里有完整的 3-hook 结构，可以直接拿来改。**

---

## 8. ★ 为什么别用截图验证

**我在这件事上浪费了很多轮。**

```
问题:
  · 你在用小窗玩 ⇒ screencap 抓到的可能是错的画面
  · 纹理只显示很短时间 ⇒ 采样频率不够就错过
  · 合成层 / 硬件叠加 ⇒ 抓到的是合成后的结果
  · 截图的颜色空间可能被处理过

结论: 截图只能作为辅助证据，不能作为唯一判断
```

**正确的验证组合：**

```
✅ vktex 日志        —— 游戏有没有上传这个纹理
✅ 内存搜索          —— 数据在不在内存里
✅ 崩溃日志          —— 改坏了没有
✅ 截图              —— 最后确认视觉效果（但不能单独用）
```

**至少两种对上，才敢下结论。**

---

## 9. payload 的 ABI（如果你想自己写）

**导出符号：**

```
T init            ← 入口函数
T impl0           ← hook 实现 0
T impl1           ← hook 实现 1
T impl2           ← hook 实现 2
T stub0/1/2       ← 跳板（保存原始指令 + 跳回）
T __clear_cache   ← 刷新指令缓存
```

**⚠️ 这不是标准 Zygisk API**（标准叫 `zygisk_module_entry`）。
这是 HanSoBored 的 `zygisk-loader` 自定义 ABI。

**编译：**

```bash
clang -O2 -fPIC -shared -nostdlib -o libefml4a_xxx.so payload-xxx.c
```

**`-nostdlib` 的原因：** NDK 的 aarch64 sysroot 里没有 `libunwind.a`，
所以必须 `-nostdlib`，libc 符号由宿主进程运行时提供。

---

## 10. 现有的 payload 一览

| payload | 干什么 | 状态 |
|---|---|---|
| `libefml4a_vktex.so` | 观测纹理上传 | ✅ **可用** |
| `libefml4a_vksafe.so` | 安全只读探测 | ✅ |
| `libefml4a_vkinject.so` | 注入（1 hook，内嵌 BC7） | ⚠️ 缺映射链 |
| `libefml4a_vk304inj.so` | 本目标注入版（3 hook，内嵌 ASTC） | ⚠️ 日志未生成 |
| `libefml4a_libcprobe.so` | libc 探测 | ✅ |
| `libefml4a_vfsprobe.so` | VFS 探测 | ✅ |
| `libefml4a_meshdump.so` | Mesh 导出 | ✅ |
| `libefml4a_texhook.so` | 纹理 hook | ✅ |

---

## 11. 历史：运行时替换曾成功过

**在 v1.5.3 版本上，我用 `vkCmdCopyBufferToImage` hook 成功把 mod 的
262,144 字节 BC7 数据写进了游戏的 512×512 纹理（命中 4 次，未映射 0 次）。**

**但被反篡改看门狗拖死了** —— 它会周期性检查代码段，发现被改就还原。
代价是 9 次崩溃，最后放弃这条路线。

**教训：** 在「有反篡改的游戏」上做运行时 hook 是打地鼠。
能做，但成本极高。

---

## 12. 踩坑速查

| 症状 | 原因 | 解法 |
|---|---|---|
| payload 不加载 | `target.json` 格式错 | 用对象数组 + 绝对路径 |
| `maps` 里查不到 | init 后自动 unmap | **看日志文件** |
| 日志是空的 | 启动太早 / 路径错 | 等 20 秒；确认 `LOGF` 宏 |
| 截图看不到 | 小窗 / 时序 / 合成层 | 改用 vktex + 内存搜索 |
| `EXT` 尺寸不对 | 目标纹理判断错 | 用 texinfo 确认 |

---

## 13. 下一步

读完这篇你应该能：
- ✅ 让 zygisk payload 加载起来
- ✅ 用 vktex 看到游戏上传了什么
- ✅ 知道为什么不靠截图验证

如果你想知道游戏为什么跳过你改的文件，读
**[C2 · 阻塞与失败记录](C2-blockers.md)** —— 那篇就是用 vktex 发现的。
