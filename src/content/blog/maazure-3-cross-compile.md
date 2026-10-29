---
title: 在 arm64 安卓手机上交叉编译 Windows 程序
description: 没有 x86 电脑，只有一台 arm64 手机：用 chroot + rustup + mingw 出 Windows exe，用 qemu 跑 x86_64 产物做冒烟，还顺手绕开了「MaaFramework 只提供 MSVC 导入库」这个死结。
date: 2026-10-29
category: env
tags:
  - 交叉编译
  - Rust
  - Termux
  - MaaFramework
  - Windows
---

## 0. 目标

要交付的是 Windows 上的 `maazure-daemon.exe`，它链接 [MaaFramework](https://github.com/MaaXYZ/MaaFramework)
（C++ 内核）。而我的全部设备是：一台 arm64 安卓手机，跑 Termux。

三个约束：

1. Termux 是 bionic，**跑不了 glibc 二进制**，也编不出 glibc 目标；
2. MaaFramework 只发布预编译 `.so/.dll`，不源码分发；
3. Windows 版**只带 MSVC 导入库 `.lib`**，mingw 的 `ld` 读不了。

第三条看起来是死路。绕开它的关键是读一遍 Rust 绑定 crate 的 `build.rs`。

## 1. 关键发现：`dynamic` feature 不产生任何链接指令

`maa-framework-sys` 的 `build.rs` 里有这么一段：

```rust
// build.rs:306
if !is_dynamic {
    println!("cargo:rustc-link-lib=MaaFramework");
    println!("cargo:rustc-link-lib=MaaAgentClient");
    println!("cargo:rustc-link-lib=MaaAgentServer");
    println!("cargo:rustc-link-lib=MaaToolkit");
}
```

也就是说开 `dynamic` feature 时，构建期**完全不链接**，只加 `link-search` 和 rpath；
库在运行期由 `libloading` 加载。

第二个好消息：这个 crate 自带**预生成绑定**（`src/bindings/{static,dynamic}_bindings.rs`），
所以连 `libclang` / bindgen 都不需要。

两条加起来：**arm64 Linux 上可以编出 Windows exe**，MSVC 导入库根本用不上。

一个 feature 就解决了：

```toml
[features]
maa = ["dep:maa-framework"]                       # 同平台静态链接
maa-dynamic = ["dep:maa-framework", "maa-framework/dynamic"]  # 跨平台，运行期加载
```

## 2. 环境：chroot 里装齐交叉工具链

Termux 本体不行，就用 chroot。我用的是 tmoe-linux 拉的一个 Debian 12 arm64 容器。

```bash
# 容器内
apt-get install -y build-essential clang libclang-dev \
    gcc-x86-64-linux-gnu g++-x86-64-linux-gnu \
    mingw-w64 zip
curl --proto '=https' -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
rustup target add x86_64-unknown-linux-gnu x86_64-pc-windows-gnu
```

**踩到的第一个坑**：chroot 里没挂 `/proc`，rustup 直接报

```
error: Unable to proceed. Could not locate working directory.:
no /proc/self/exe available. Is /proc mounted?
```

补挂就好：

```bash
su -c "mount -t proc proc $CHROOT/proc"
```

链接器写进仓库根的 `.cargo/config.toml`，两边都能用：

```toml
[target.x86_64-unknown-linux-gnu]
linker = "x86_64-linux-gnu-gcc"

[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"
```

## 3. 三个目标，全部在本机出包

```bash
# 本机开发（aarch64，静态链接 MAA-linux-aarch64）
cargo build --target aarch64-unknown-linux-gnu -p maazure-daemon --features maa

# Linux x64
MAA_SDK_PATH=$PWD/MAA-linux-x86_64 \
cargo build --release --target x86_64-unknown-linux-gnu -p maazure-daemon --features maa

# Windows x64
MAA_SDK_PATH=$PWD/MAA-win-x86_64 \
cargo build --release --target x86_64-pc-windows-gnu -p maazure-daemon --features maa-dynamic
```

产物：

```
x86_64-unknown-linux-gnu/release/maazure-daemon        645 KB
x86_64-pc-windows-gnu/release/maazure-daemon.exe       467 KB
```

Windows 产物只有 467 KB，因为它不把 C++ 内核打进去。

## 4. 验证：用 objdump 和 qemu 自己证明

交叉编译最容易「看着成功其实没出包」。两道检查：

**导入表**——确认 `MaaFramework.dll` 是运行期加载，不是链接进来：

```bash
x86_64-w64-mingw32-objdump -p maazure-daemon.exe | grep "DLL Name"
#   api-ms-win-core-synch-l1-2-0.dll
#   KERNEL32.dll
#   msvcrt.dll
#   ntdll.dll
#   USERENV.dll
#   WS2_32.dll
```

没有 `MaaFramework.dll`，符合预期。

**qemu 真跑**——x86_64 产物不用等 Windows，手机上就能跑：

```bash
apt-get install -y libatomic1:amd64 libstdc++6:amd64 libgcc-s1:amd64   # 先加 amd64 架构
qemu-x86_64-static -L / maazure-daemon --version
#   MaaAzure 0.0.1
```

更进一步，跑真实代码路径：

```bash
qemu-x86_64-static -L / maazure-daemon --run CommissionStart --address 127.0.0.1:16384
# ── MaaAzure run ──
# [ERR][AdbControlUnitMgr.cpp][L46] failed to connect [adb_path_=adb]
# 连接失败: 连不上设备 127.0.0.1:16384
```

这段日志是**最强的证据**：MaaFramework 自己的 C++ 日志（`AdbControlUnitMgr`）出现了，
说明 Toolkit 初始化、`Controller::new_adb`、连接尝试都进了真实内核代码；
失败原因只是容器里没有 `adb` 可执行文件，不是崩溃、不是 UB。

## 5. 打包：只有一步需要 root

发布包要把 exe + 19 个 DLL + 142MB 资源 + 5.9MB 数据 + LICENSE 装到一起。
踩过的坑：第一版整棵树在 chroot 里以 root 拷，结果发布目录全变 root 所有，
用户连删都删不掉。

现在的分工：

```
root  只有一件事：从 chroot 的 /root 里把编译产物取出来
宿主  其余全部：拷库、拷资源、zip（借容器里的 zip）
```

结果：解压 235MB、zip 113MB，属主正常。

## 6. 小结

| 问题 | 解法 |
|---|---|
| Termux 没有 glibc | chroot（记得挂 `/proc`） |
| 只有 MSVC 导入库 | `dynamic` feature，构建期不链接 |
| 需要 libclang | crate 自带预生成绑定，根本不需要 |
| 交叉产物「看着成功」 | objdump 查导入表 + qemu 真跑 |

**不要相信 CI 是唯一构建事实。** 这台手机现在能独立产出三个平台的包，
构建链在自己手里，比依赖任何云端 runner 都踏实。

---

系列文章：

1. [架构：把 28 万行 Python 换成 MaaFramework + Rust](/blog/maazure-1-architecture)
2. [资源迁移：把「数据即代码」拆开](/blog/maazure-2-migration)
3. **在 arm64 安卓手机上交叉编译 Windows 程序**（本篇）
4. 没有模拟器，怎么验证一个自动化脚本
