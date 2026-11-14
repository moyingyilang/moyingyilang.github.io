---
title: 在 arm64 Android 上把 Linux 容器做成构建环境
description: 用 Termux 里的 Debian chroot 做 Android 与桌面端的构建机，踩到的六类坑：aapt2 架构、容器 /dev、编码、绑定挂载、443 端口推送、以及删工具链导致的行为改变。每条都给出可照抄的修法。
date: 2026-11-14
category: android
tags:
  - Termux
  - aarch64
  - chroot
  - Gradle
  - Android
  - 构建工程
---

手机当构建机不是新鲜事，但把它做到"每天真的在用"会撞上一批别处搜不到的问题。这篇记六类，症状都写成你会搜的那句话。

完整清单在 [termux-env-archive/TROUBLESHOOTING.md](https://github.com/moyingyilang/termux-env-archive/blob/main/TROUBLESHOOTING.md)，这里挑的是最有代表性的。

## 一、aapt2 是 x86-64 的

```
aapt2: Exec format error
```

AGP 会从 Maven 拉 `linux-x86_64` 的 aapt2。在 ARM 设备上它连启动都做不到，报错形式取决于调用方式，有时是 shell 语法错误，很容易被误判成脚本写错。

修法是指向本地 build-tools 里的 ARM 版本：

```properties
android.aapt2FromMavenOverride=/path/to/android-sdk/build-tools/35.0.1/aapt2
```

配套还有一条：**aarch64 + arm64 aapt2 下，AGP 的资源优化会产出空资源表**——APK 能编出来，但里面没有 `AndroidManifest.xml` 与 `resources.arsc`，装不上。

```properties
android.enableResourceOptimizations=false
```

代价是 APK 不再裁剪无用资源，体积略大。这个交换是值得的：装不上的包体积再小也没意义。

## 二、容器里的 `/dev/null` 不可写

这是最阴的一条。表现是：

```
/bin/bash: line 2: /dev/null: Permission denied
```

它看起来像"目录不存在"，于是第一反应是"绑定挂载掉了""项目被删了"。实际挂载是好的，坏的是 `/dev`。

原因是 rootfs 放在 `/data` 上，**SELinux 不允许使用那里 `mknod` 出来的设备节点**，root 也写不进去。修法是给 `/dev` 挂 tmpfs 再重建四个基本设备：

```bash
S=~/.local/share/tmoe-linux/containers/chroot/debian-sid_arm64
mount -t tmpfs tmpfs "$S/dev"
mknod -m 666 "$S/dev/null"    c 1 3
mknod -m 666 "$S/dev/zero"    c 1 5
mknod -m 666 "$S/dev/random"  c 1 8
mknod -m 666 "$S/dev/urandom" c 1 9
```

这件事只能靠"先探测再修"固化下来，否则下次重启又会踩。我把它写进了进容器脚本：先 `echo probe > /dev/null`，失败才重建。

顺带两条容器常识，但很容易忘：

- `chroot` **不继承环境**，`PATH` 与 `HOME` 都要显式给，否则连 `ls` 都找不到
- JDK 装在 `/opt` 时要 `LD_LIBRARY_PATH=$JAVA_HOME/lib`，否则 `java` 直接报 `libjli.so: cannot open`

## 三、中文测试名 + 非 UTF-8 locale

```
InvalidPathException: Malformed input or input contains unmappable characters
```

测试方法名用中文，Kotlin 生成的 class 文件名跟着带中文；如果 JVM 的 `sun.jnu.encoding` 不是 UTF-8，路径就无法解析。

这条不是这台设备独有——任何 CI 用非 UTF-8 locale 跑中文测试名都一样。修法：

```properties
systemProp.sun.jnu.encoding=UTF-8
systemProp.file.encoding=UTF-8
systemProp.user.language=en
systemProp.user.country=US
```

## 四、绑定挂载会掉

昨天还能构建，今天容器里项目目录不存在。Termux 被杀后台、重启之后，bind mount 就没了。

别只看"目录在不在"，而是**逐项检查并补挂**：

```bash
mountpoint -q "$S$HOME/jmc" || mount -o bind "$HOME/jmc" "$S$HOME/jmc"
```

更稳妥的做法是在进容器脚本里做一次自检：容器内 `ls` 项目目录，失败就明确报"绑定挂载缺失"，而不是让后面的构建报一堆莫名其妙的错。

## 五、`git push` 在这台机器上认证失败

```
Permission denied (publickey)
```

key 没坏。是 `github.com:22` 被网络挡了。统一走 443 的 SSH 端点：

```bash
GIT_SSH_COMMAND="ssh -o HostName=20.205.243.160 -p 443 -o StrictHostKeyChecking=no" \
  git push ssh://git@ssh.github.com:443/<user>/<repo>.git main
```

顺带一个变体：如果 remote 是形如 `https://gh-proxy.com/https://github.com/...` 的代理地址，推送会报 `could not read Username`——代理不接受交互输入。把 remote 换成上面的 SSH 形式即可。

## 六、删工具链会悄悄改变行为

这条是方法论，不是命令。

很多构建脚本这样选 NDK：

```bash
NDK=$(ls -d "$SDK"/ndk/* | sort -V | tail -1)
```

看起来"永远选最新的"很安全。但如果你为了省空间删掉旧版本，任何依赖"回落"的逻辑就失效了——我确实干过：先删了 28.2，然后另一个项目给的方案是"删 29 会自动回落到 28.2"，两边一撞，回落路径消失。

同类还有 `build-tools`：某个旧版本里的 `aapt`（v1，不是 aapt2）仍是 x86-64，平时不报错，一旦有脚本调 `aapt package` 就崩。

所以**清理工具链之前，先 grep 所有选择逻辑**；要么显式钉版本，要么保留最小可用集合。判断"有没有被引用"不够，还要看"被引用时是怎么挑的"。

## 最后：这类经验该写在哪

设备特异的问题向上游提交，大多会被回一句"无法复现"——维护者手上没有这台机器，收了也是负担。但它在下游的价值很高：同样在 Android 上跑 Linux 容器的人不少，他们不会去翻邮件列表，只会搜报错原文。

所以我的做法是**不向上游提交，但向下游公开**：把"症状 → 原因 → 修法"写进仓库，症状那一行必须是别人会搜的原话。这比写进提交历史有用——提交历史搜不到。

清单会持续更新：[termux-env-archive](https://github.com/moyingyilang/termux-env-archive)。
