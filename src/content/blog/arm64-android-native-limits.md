---
title: arm64 Android 上的硬限制：五件你以为能做、其实做不了的事
description: 在手机上做原生开发、逆向与自动化时撞到的机制级限制：box64 上无法 hook、Termux 里无法 dlopen 框架库、设备上无法 externalNativeBuild、偏移不能整体平移、/dev/urandom 读不了、虚拟屏有两套 id。每条给出判别方法，而不是"多试试"。
date: 2026-11-14
category: android
tags:
  - aarch64
  - Android
  - 逆向
  - Termux
  - 原生开发
---

有些问题不是"配置不对"，是**机制上不成立**。分不清这两者，就会在错误的方向上花掉一整天——最典型的是看到 `Syntax error: "(" unexpected` 就去找语法错误，其实是内核 ENOEXEC，shell 在拿二进制当脚本解析。

这篇记五条硬限制，每条都给"怎么快速判定"，因为判定比修复值钱。

## 一、box64 上做 inline hook，注定无效

在 Termux + box64 里跑 x86_64 程序，用 funchook / Detours 打 hook：日志正常，函数行为不变；硬写代码页则 SIGSEGV。

原因不是权限，是**代码根本不在你以为的地方**：

- 实测一个 169MB 的 ELF，只映射了 53.5MB 的只读段（`r--p`）；
- 真正执行的是另一块匿名 `r-xp` 映射——box64 把 guest 代码 JIT 进去了。

于是双向失效：改镜像里的字节不影响已 JIT 的代码；改执行区又不在镜像里，页保护也不对。qemu-user 更直接，被 Android seccomp 干掉（`SIGSYS`）。

**判定**：`grep` 一下 `/proc/<pid>/maps`，看目标函数地址落在哪个映射；如果落在匿名 `r-xp` 且不在任何文件上，就是在 JIT 里。

**结论**：要改行为就用原生 arm64 二进制（有源码或官方 arm64 版）。否则只能"跑"，不能"改"。

## 二、Termux 里 dlopen Android 框架库，会段错误

`dlopen("libMaaFramework.so")` 在 Termux 里崩，同一份库在 APK 里正常。

原因不是页大小对齐（那个坑真实存在，但 `getconf PAGE_SIZE` 为 4096 就能排除），而是这类库依赖 JNI/ART 与 **linker namespace**——普通 native 进程没有这套运行时。

**判定**：先 `getconf PAGE_SIZE` 排除对齐问题；再写一个最小 `dlopen` 程序复现。若最小程序也崩，就不是你代码的问题。

**结论**：这类库只能在 App 进程里跑（APK + agent，或系统特权进程）。Termux 侧只适合做 `screencap` / `input` 这类系统命令的调用者。

## 三、设备上跑 externalNativeBuild，这条路不存在

`cmake: 1: Syntax error ")" unexpected`。

SDK 自带的 cmake 是 **linux-x86_64** 的 ELF，在 arm64 上执行不到，shell 兜底去解析二进制，于是报出"语法错误"。同理，`aidl: 1: Syntax error: "(" unexpected` 也是 x86_64 二进制被当脚本读。

**判定**：`od -An -tx1 -j18 -N2 <文件>` 看 e_machine——`b700` 是 aarch64，`3e00` 是 x86_64。凡是"语法错误"发生在二进制上，先查架构。

**结论**：官方 NDK 只发 x86_64 宿主工具，本机不可能用它做 CMake 原生构建。改用 Termux 的 clang 预编译 `.so` 放进 `jniLibs`，删掉 `externalNativeBuild{cmake}`。

顺带一条反直觉的：**在 AGP 里开 SDK Manager 更新，会把手工换进去的 ARM 二进制覆盖回 x86_64**。所以换过一次就要留个校验脚本。

## 四、跨版本搬函数偏移，不能"整体加常数"

想把旧版本二进制里 70 多个硬编码函数偏移搬到新版本，试"加一个 delta"：个别能用，多数崩。

实测同一批符号跨版本位移完全离散：**−47MB 到 +8MB 都有**，没有聚集；单个函数能移动 4.4MB。

更麻烦的是"能跑"这件事有欺骗性：很多硬编码偏移其实落在函数**中段**。调用中段之所以不崩，是因为 `bl` 把返回地址写进 `x30`，只要那段代码不破坏 `x30/x29`，跑到后面某个 `ret` 就干净返回了——垃圾输入、垃圾输出，但你不觉得有问题。换版本后同一地址落到完全不同的代码，立刻炸。

**判定**：定位前先找函数序言——向前扫 300~2000 字节找 `stp x29,x30,[sp,#-N]!` 或 `sub sp,sp,#imm`。如果目标地址之前没有序言，你找到的是中段。

**办法**：用内容签名匹配（取 16 字节非 PC 相对窗口 → 哈希索引扫全库 → capstone 逐条比对），且候选必须逐条验证。实测出现过"紧邻三个正确邻居"的候选，逐条比对却 0/12 相同。

## 五、容器里读不到随机数源

`std::random_device` 在 chroot 里启动即 abort：`failed to open /dev/urandom`。

两层原因：`/dev` 挂载会丢；即使 `mknod /dev/urandom c 1 9` 建出节点，**Android SELinux 也禁止从 app 域读设备节点**，root 同样被拒。

本机实测：`/dev/null` 能写，`/dev/urandom` 读是 `Permission denied`。所以"给 `/dev` 挂 tmpfs 再 mknod"只能救 null，救不了随机数。

**办法**：`LD_PRELOAD` 一个 shim，拦截 `open/openat`，把这两个路径换成 `memfd_create` + `getrandom()` 预填的 fd。约 40 行 C。

## 附：一个反复出现的坑——两套 display id

`input -d` 要的是**逻辑 display id**，`screencap -d` 要的是 **SurfaceFlinger id**，两者不是同一个数（一个是 19 位十进制，一个是 0/17/25 这种小整数）。

从 SF id 反查逻辑 id 得看 `dumpsys display` 的 `uniqueId`。拿不到就失败退出，**绝不回落 0**——回落会把点击打到用户主屏幕。

而 `am start --display` 把 App 拉到别的屏需要系统级权限，root/shell/system 都不够；真要做虚拟屏，只能由 App 自己建 `VirtualDisplay` 或改系统。

## 小结

这五条的共同点：**先判定"是不是机制上不可能"，再决定要不要修**。

判定手段都很便宜——`/proc/<pid>/maps`、`od -An -tx1`、`getconf PAGE_SIZE`、一个最小复现程序。比在 StackOverflow 上找"清缓存试试"省时间得多。

完整清单（八类、三十余条）在 [termux-env-archive/TROUBLESHOOTING.md](https://github.com/moyingyilang/termux-env-archive/blob/main/TROUBLESHOOTING.md)。
