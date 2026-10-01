---
title: 《明日方舟：终末地》逆向工程实战记录
description: 没有 x86 电脑、只有两台安卓手机怎么做 il2cpp 逆向：ZeroTermux 工作站搭建、VFS 资源格式、radare2 手机端调用链追踪、用 mono 编译 Il2CppDumper，以及一份完整的失败档案。
date: 2026-08-14
category: reverse
tags:
  - 逆向工程
  - il2cpp
  - Android
  - radare2
  - ZeroTermux
  - Unity
---

献给下一位接过此任务的勇士。

这不是一篇「成果汇报」，而是一份**踩坑日志 + 操作手册 + 失败档案**。我们走过的每一步、遇到的每一个报错、每一次以为要成了又崩了，都记在这里。希望它能让你少走几个月弯路。

## 0. 写在最前面

我们都想要模型 MOD，我们都想要自由的游戏。

这份文档记录的是**正式版 1.4 CN Android** 的完整分析过程。设备只有两台手机，没有任何 x86 电脑，所有工具都在 ZeroTermux 里跑。

我们不是天才，只是比你们早踩了几个月坑。

## 1. 环境搭建：在手机上造一个逆向工作站

### 1.1 设备与系统

| 设备 | 状态 | 用途 |
| --- | --- | --- |
| Honor Play 4T | 未 root | 对照观察，测试未 root 环境下游戏行为、文件权限 |
| Redmi K80 Pro | 已 root（Magisk） | 主力分析机，所有 dump、hook、反汇编都在这里 |

为什么不用 Honor 做主力？未 root 连 `/data/data` 都进不去，只能看 `/sdcard/Android/data` 下的外部存储。但外部存储的 VFS 目录已经够我们做初步分析了。root 之后才能读 `/proc/pid/mem`、才能跑 Frida-server、才能改 SO。

### 1.2 ZeroTermux 安装与配置

从 F-Droid 或 GitHub 下载 ZeroTermux（不是 Termux 原版，ZeroTermux 对国内网络和 root 支持更好）。

安装后第一件事：

```bash
pkg update && pkg upgrade -y
pkg install root-repo x11-repo -y
pkg install python python-pip git make clang binutils radare2 hexdump xxd file -y
pip install pycryptodome capstone angr
```

**踩坑 1**：`angr` 在手机端安装极慢，而且依赖 `z3-solver`，编译可能失败。我们最后是用了 `pip install angr --no-deps` 然后手动补依赖，折腾了一晚上。如果你只是要解密 VFS，不需要 angr，可以跳过。

**踩坑 2**：`radare2` 在 ZeroTermux 里默认版本较老，建议从源码编译：

```bash
git clone https://github.com/radareorg/radare2
cd radare2
sys/install.sh
```

但编译要半小时，手机发烫。我们用的是 `pkg install radare2` 的版本，够用。

### 1.3 root 权限配置

Redmi K80 Pro 用 Magisk root 后，ZeroTermux 需要请求 root：

```bash
su
# 授予 ZeroTermux root 权限
```

之后所有需要读 `/proc/pid/mem`、`/data/data` 的操作都要在 `su` 下执行。

**踩坑 3**：ZeroTermux 默认的 `$PREFIX` 在 `/data/data/com.termux/files/usr`，root 后环境变量会变。建议在 `su` 下重新 `export PATH=$PATH:/data/data/com.termux/files/usr/bin`，否则 `python`、`r2` 都找不到。

## 2. 资源定位：VFS 目录长什么样

### 2.1 外部存储路径

游戏安装后，资源在：

```text
/storage/emulated/0/Android/data/com.hypergryph.endfield/files/
```

进去看：

```bash
cd /storage/emulated/0/Android/data/com.hypergryph.endfield/files/
ls -la
```

你会看到：

```text
VFS/
index_initial.json
index_main.json
```

`index_initial.json` 和 `index_main.json` 是**明文 JSON**，直接 `cat` 就能看。它们记录了 VFS 目录的映射关系，但不包含实际资源数据。

### 2.2 VFS 子目录结构

```bash
cd VFS
ls -la
```

输出类似：

```text
07A1BB91/
55FC21C6/
5A2B...
...
共 21 个目录
```

每个目录里：

```bash
ls -la 07A1BB91/
```

```text
07A1BB91.blc
24F006196A004C8E3A259EADA8F45818.chk
```

- `.blc` 文件较小（几 KB 到几百 KB）
- `.chk` 文件较大（几 MB 到几百 MB）

**观察**：`.blc` 开头 4 字节永远是 `03 00 00 00`。`.chk` 开头各不相同，有的直接是 `UnityFS`，有的是 `:)xD`，有的是乱码。

### 2.3 初步判断

- `.blc` 是索引文件，加密了
- `.chk` 是数据文件，有的加密有的没加密
- 21 组对应 21 个资源包

先用 hexdump 看 `.blc`：

```bash
hexdump -C 07A1BB91.blc | head -20
```

```text
00000000  03 00 00 00 9a 3f 2c 8e  ...  （后面全是高熵数据）
```

熵很高，说明加密了。

## 3. ACE 带来的约束

《终末地》接入了 **ACE（Anti-Cheat Expert）**。这件事在动手之前就必须纳入考虑，因为它直接决定了**哪些路根本走不通**。

我们先后试过三条路：

1. **radare2 附加**——能附加、能看到内存映射，但一让它继续执行，进程立刻消失
2. **Frida 动态 Hook**——attach 之后一执行到插桩逻辑，游戏就卡死闪退
3. **放弃动态调试**——既然动态调试在本作上走不通，就把全部精力转向**静态分析 + 内存读取**

关于 ACE 自身的机制，本文不做展开，也不打算给出任何绕过手段——那不是本文的目的。本文要记录的是：**在这条约束之下，一个只有手机的逆向工作流该怎么搭、能走到哪一步、以及哪些路我们试过并且失败了。**

> 顺带一提：ACE 会对部分平台上的 `global-metadata.dat` 文件头做保护处理（头部不是标准的 `AF 1B B1 FA`）。Android 版在我们分析的版本上是正常的，因此静态分析可行。这一点在公开文章 [《终末地》CBT3 逆向工程 1：VFS 资源存储解密](https://blog.harryh.cn/Reverse-Engineering/Endfield-CBT3-Reverse-Engineering-1-VFS-Storage-Decryption/) 中已有说明，本文是它的后续。

### 3.1 内存读取：不依赖调试器的取数方式

动态调试走不通，但我们仍然需要 `libil2cpp.so` 和 `global-metadata.dat`。可行的做法是**直接读进程内存**，完全不使用调试器：

1. 正常启动游戏，让它跑起来
2. 找到游戏进程 PID：

```bash
ps -A | grep endfield
```

```text
u0_a123  12345  ...  com.hypergryph.endfield
```

3. 读取内存映射：

```bash
su
cat /proc/12345/maps | head -50
```

你会看到一堆 `r-xp`、`rw-p` 段，其中就有 `libil2cpp.so`、`libunity.so`、`global-metadata.dat` 等。

4. 按映射段 dump：

```bash
dd if=/proc/12345/mem of=/sdcard/dump.bin bs=1M skip=... count=...
```

**踩坑 4**：`/proc/pid/mem` 不能直接 `cat`，必须用 `dd` 指定 `skip` 和 `count`。而且每次读到的内存可能不连续，需要根据 `maps` 里的地址范围分段读。我们写了一个 Python 脚本自动解析 maps 并分段 dump：

```python
import re, os

pid = 12345
maps = open(f'/proc/{pid}/maps').read().splitlines()

for line in maps:
    m = re.match(r'([0-9a-f]+)-([0-9a-f]+) (....) .* (.*)', line)
    if not m:
        continue
    start, end, perms, path = m.groups()
    if 'libil2cpp.so' in path or 'global-metadata' in path:
        start = int(start, 16)
        end = int(end, 16)
        size = end - start
        print(f'dumping {path} {hex(start)}-{hex(end)} size={size}')
        with open(f'/sdcard/dump_{os.path.basename(path)}', 'wb') as f:
            with open(f'/proc/{pid}/mem', 'rb') as mem:
                mem.seek(start)
                f.write(mem.read(size))
```

需要 root，而且游戏必须正在运行。

### 3.2 内存里找 global-metadata.dat

dump 出内存后，在里面搜 `AF 1B B1 FA`：

```bash
grep -abo $'\xAF\x1B\xB1\xFA' /sdcard/dump_* | head
```

找到偏移后切出来：

```bash
dd if=/sdcard/dump_libil2cpp.so of=/sdcard/global-metadata.dat bs=1 skip=... count=...
hexdump -C /sdcard/global-metadata.dat | head -2
```

```text
00000000  af 1b b1 fa  ...  （正确！）
```

**踩坑 5**：内存里可能有多处 `AF 1B B1 FA`，需要根据后续字段判断哪个是真的。真正的 `global-metadata.dat` 后面会跟版本号、字符串偏移等，可以对照 il2cpp 文档确认。

### 3.3 试过但没走通的路

参考 Windows 版的思路：创建一个空白 Unity 项目，生成干净的 `EndFieldTBeta2.exe` 替换原启动程序。**在 Android 上不可行**——Android 没有 exe，启动流程是 `zygote` → `app_process` → `com.hypergryph.endfield`。我们尝试过用 `pm` 替换 APK 里的 `classes.dex`，签名校验过不去。

## 4. 解密 .blc：ChaCha20 脚本与踩坑

### 4.1 参数来源

ChaCha20 密钥来自公开文章与我们自己的内存校验：

```text
E9 5B 31 7A C4 F8 28 56 9D 23 A8 6B F2 71 DC B5
3E 84 6F A7 5C 92 4D 67 1D BA 8E 38 F4 CA 52 E1
```

Nonce 是 `.blc` 文件偏移 4 开始的 12 字节，counter 从 1 开始。

### 4.2 解密脚本

```python
from Crypto.Cipher import ChaCha20
import sys

KEY = bytes.fromhex(
    'E95B317AC4F828569D23A86BF271DCB5'
    '3E846FA75C924D671DBA8E38F4CA52E1'
)

def decrypt_blc(path, out_path):
    data = open(path, 'rb').read()
    # 开头 4 字节是 03 00 00 00，不是 nonce
    # 实际 nonce 是接下来的 12 字节 —— 我们试了很久
    nonce = data[4:16]
    ciphertext = data[16:]
    cipher = ChaCha20.new(key=KEY, nonce=nonce)
    cipher.seek(64)  # counter 从 1 开始，即跳过第一个 64 字节块
    plaintext = cipher.decrypt(ciphertext)
    out = data[:4] + plaintext
    open(out_path, 'wb').write(out)
    print(f'decrypted {path} -> {out_path}')

if __name__ == '__main__':
    decrypt_blc(sys.argv[1], sys.argv[2])
```

**踩坑 6**：nonce 的位置我们试了三种：

- 文件开头 12 字节（错误，因为开头是 `03 00 00 00`）
- **文件偏移 4 开始的 12 字节（正确）**
- 文件末尾 12 字节（错误）

counter 初始值也试了 0 和 1，最终确定是 1（即 `cipher.seek(64)`）。

### 4.3 批量解密

```bash
for d in VFS/*/; do
    blc="$d/$(basename $d).blc"
    if [ -f "$blc" ]; then
        python decrypt_blc.py "$blc" "${blc}.dec"
    fi
done
```

得到 21 个 `.dec` 文件。

### 4.4 提取资源路径

解密后的 `.dec` 文件里能看到明文路径。用 `strings` 提取：

```bash
strings 07A1BB91.blc.dec | grep -E '\.(ab|pck|usm|hgmmap)$' > paths.txt
```

总共 **3688 个路径**。类型统计：

```bash
cat paths.txt | sed 's/.*\.//' | sort | uniq -c
```

```text
 2100 ab
  800 pck
  500 usm
  288 hgmmap
```

## 5. 定位调用链：在 r2 里手动追踪

### 5.1 从 VFS 入口开始

在 `libil2cpp.so` 里搜字符串 `VFS`，找到相关函数。由于没有 x86，只能用 r2 的文本界面：

```bash
r2 -A libil2cpp.so
```

```text
[0x00000000]> / VFS
```

找到地址 `0x7fb390c` 附近有 VFS 相关逻辑。

### 5.2 反汇编追踪

```text
[0x00000000]> s 0x7fb390c
[0x07fb390c]> pdf
```

看到它调用 `0xa95ac7c`，再调用 `0x847b04c`，再调用 `0x1d0a808`，最后跳转到 `0x12285xxx` 分支。把这些地址记下来，手动标注：

```text
VFS入口 (0x7fb390c)
  ├─> 获取参数: 0x1094fff0
  └─> 调用 0xa95ac7c
      └─> 调用 0x847b04c
          └─> 调用 0x1d0a808
              └─> 跳转至 0x12285xxx
```

### 5.3 PCK 入口

同样搜 `PCK` 字符串，找到 `0x7fb3b24`，调用 `0xa95af08`，后面汇入同一个调度。

**踩坑 7**：r2 在手机端反汇编大文件很卡，`pdf` 一个函数要等十几秒。建议先 `r2 -A` 加载，然后只对关键地址 `s` 过去再 `pdf`，**不要全局分析**。

### 5.4 关键地址速查表（正式版 1.4）

| 地址 | 作用 |
| --- | --- |
| `0x7fb390c` | VFS 入口 |
| `0x7fb3b24` | PCK 入口 |
| `0xa95ac7c` | VFS 第一层封装 |
| `0xa95af08` | PCK 第一层封装 |
| `0x847b04c` | 核心调度 |
| `0x1d0a808` | 跳板 |
| `0x12285000+0x470` ~ `+0x670` | 实际算法分支（30+ 个） |
| `0x1094fff0` | 获取索引/校验值，内含 mul 循环 |
| `0x1ccb3fc` / `0x1ccb3a0` | 初始化/对象转换 |
| `0x9da31f8` | 对象解引用 |
| `0x1cfc76c` | 备用解密分支 |
| `0x1d0a784` | 错误处理 |

> ⚠️ 这些地址**只对正式版 1.4 有效**。游戏一更新就会全部失效——本文档的价值在方法，不在这些数字。

## 6. 符号恢复：没有 x86 怎么跑 Il2CppDumper

### 6.1 问题

Il2CppDumper 官方版是 .NET 程序，需要 Windows 或 Mono。我们没有 x86 设备，也没有 Windows。

### 6.2 解决方案：在 Termux 里用 mono 编译

1. 在 ZeroTermux 里安装 mono：

```bash
pkg install mono -y
```

2. 下载 Il2CppDumper 源码：

```bash
git clone https://github.com/Perfare/Il2CppDumper
cd Il2CppDumper
```

3. 用 mono 编译：

```bash
msbuild Il2CppDumper.sln /p:Configuration=Release
```

**踩坑 8**：`msbuild` 在 Termux 里可能不存在，需要 `pkg install mono-devel`。而且编译会报一堆缺少 `System.Windows.Forms` 的错，因为 Il2CppDumper 带 GUI。我们最后只编译了命令行版本，用 `mono Il2CppDumper.exe` 运行。

4. 运行：

```bash
mono Il2CppDumper.exe global-metadata.dat libil2cpp.so output_dir
```

输出 `dump.cs`、`script.py`、`stringliteral.json` 等。

**踩坑 9**：`libil2cpp.so` 要从 APK 里提取，或者从内存 dump。我们用的是 **APK 里的原始 SO**，因为内存里的 SO 可能已被修改过。

### 6.3 符号化到 r2

Il2CppDumper 生成的 `script.py` 是给 IDA 用的。我们没有 IDA，只能手动把关键函数名和地址对应起来。

把 `dump.cs` 里的函数名和 RVA 复制到一个文本文件，然后在 r2 里用 `afn` 命令重命名：

```text
[0x00000000]> afn XXE1__ctor 0xc64e194
```

这样后续分析可读性会好很多。

## 7. Frida Hook：试过，但没走通

```javascript
Java.perform(function() {
    var XXE1 = Java.use('XXE1');
    XXE1.$init.overload('[B', '[B').implementation = function(key, nonce) {
        console.log('XXE1 key: ' + bytesToHex(key));
        console.log('XXE1 nonce: ' + bytesToHex(nonce));
        return this.$init(key, nonce);
    };
});
```

```javascript
var VFBlockMainInfo = Java.use('VFBlockMainInfo');
VFBlockMainInfo.ReadFromByteBuf.implementation = function(buf) {
    console.log('ReadFromByteBuf called, buf=' + buf);
    var ret = this.ReadFromByteBuf(buf);
    console.log('ReadFromByteBuf returned');
    return ret;
};
```

**踩坑 10**：`XXE1` 的构造函数签名不是 `[B, [B`，可能是 `(byte[], byte[])` 或其他。我们用 `Java.use('XXE1').$init.overloads` 打印了所有重载，才找到正确的。

**结论**：Frida 在这套环境上极不稳定，每次都要重启手机重来，我们只成功打印过一次 key，还没来得及保存就崩了。最后**彻底放弃动态 Hook，转向纯静态分析 + 内存读取**。

## 8. 失败档案：我们试过但没走通的路

这一节是全文最想留给你的部分。**失败的记录比成功的记录更省时间。**

### 8.1 Beyond.VFS 移植失败

Beyond.VFS 是 Windows 工具，尝试用 Wine 在 Android 上跑：

```bash
pkg install wine -y
wine BeyondVFS.exe
```

结果：Wine 在 ARM64 上跑 x86 exe 需要 box86/box64，配置极其复杂，**最终失败**。后来尝试用 Python 重写 Beyond.VFS 的逻辑，卡在结构体解析上。

### 8.2 angr 符号执行太慢

尝试用 angr 还原 `0x12285xxx` 分支的控制流平坦化：

```python
import angr
proj = angr.Project('libil2cpp.so', auto_load_libs=False)
state = proj.factory.entry_state(addr=0x12285470)
simgr = proj.factory.simulation_manager(state)
simgr.explore(find=0x12285670)
```

结果：**跑了 6 小时没出结果**，手机烫得能煎鸡蛋。

结论：手机端跑 angr 不现实，除非只分析极小的代码片段。

### 8.3 字符串搜索无果

试过搜 AES S 盒、Base64 表、JSON 关键词，**全部无结果**。说明关键字符串被加密或混淆了。

### 8.4 结构体恢复失败

`VFBlockMainInfo` 和 `FVFBlockChunkInfo` 在 `dump.cs` 里只有字段名没有偏移，因为它们是手动序列化的。尝试用 Frida hook `ReadFromByteBuf` dump 原始内存，但没能稳定跑完。

## 9. 未解决的问题

1. `VFBlockMainInfo` 和 `FVFBlockChunkInfo` 的精确布局
2. `GetCommonChachaKeyBs` 返回的硬编码密钥和 Nonce（我们用的是公开密钥，不是从内存抓的）
3. 每个文件条目的 offset 和 len 精确解析
4. 字符串混淆的还原
5. 网络请求加密/签名（本次未涉及）

## 10. 后续方向

- **方案 A：手动解析 `.chk`**——用 hexdump 看最小的 `.chk`，根据 `FVFBlockFileInfo` 固定大小 `0x28` 暴力搜索，反推头部结构
- **方案 B：社区工具 Android 化**——继续尝试把 Beyond.VFS 移植到 Python，或者用 box64 + wine 跑 Windows 版

## 11. 重要提醒

1. 所有操作仅供学习研究
2. **版本更新会改变地址和格式**，本文的地址只对正式版 1.4 有效
3. 动手前备份原始文件
4. 手机端符号执行很慢，耐心
5. 动态插桩在这套环境上不稳定，我们把重心放在了静态分析上

## 12. 特别鸣谢

- **ZeroTermux 开发组**：让手机变成逆向工作站
- **radare2 社区**：ARM64 反汇编和内存操作的核心工具
- **Frida 团队**：动态插桩框架
- **Il2CppDumper 原作者及维护者**：il2cpp 逆向的基石
- 所有在论坛分享终末地逆向经验的无名勇士
- **Redmi K80 Pro 的 12GB 内存**：让手机端跑大量内存搜索成为可能

## 13. 文档署名

**路遥起森 & NT_**

—— 于 2026 年 8 月 14 日，基于正式版 1.4 CN Android，完成阶段性总结。

望后继者续写辉煌。

> 版本：2.0（实战记录版）｜日期：2026-08-14｜状态：阶段性终结，核心突破已取得，移交后续开发者
