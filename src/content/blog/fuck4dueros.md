---
title: Fuck4DuerOS 项目总结
description: 一台百度 DuerOS 定制学生手机的完整取证与净化记录：预置 PCDN 组件与 Xray 采集 SDK、通讯劫持组件、services.jar 框架层注入与 HOME 拦截，以及用 Magisk 模块与 hosts 完成清理；2026-10-02 补充框架层 107 个注入类与 IDuerService 提权接口，以及 libcyber-pcdn.so 的 APK 内嵌载体与模块覆盖盲区；附音频调度、内存诊断与 U-Boot 分析。
date: 2026-10-01
updatedDate: 2026-10-02
category: android
tags:
  - Android
  - Magisk
  - 隐私
  - PCDN
  - 刷机
  - DuerOS
---

> **范围与依据**：本文基于对**自购**的一台小度学生手机（XD-SEE00-2301）的实际取证与修改，所有结论只对该型号与该固件版本负责。项目已以 AGPL-3.0 开源：[moyingyilang/Fuck4DuerOS](https://github.com/moyingyilang/Fuck4DuerOS)。

百度 DuerOS 定制 Android 设备（小度学生手机 XD-SEE00-2301）的逆向取证、净化与优化全过程记录。

## 📱 设备信息

| 项目 | 值 |
| --- | --- |
| 品牌 | 小度（Xiaodu） |
| 型号 | XD-SEE00-2301 |
| 平台 | 紫光展锐 UMS9230（T616） |
| CPU | 2×Cortex-A75 + 6×Cortex-A55 |
| GPU | Mali-G57 MP1（最高 750 MHz） |
| 内存 | 5.6 GB 物理 + 11 GB Swap |
| 存储 | UFS（健康度 `0x01`，已用 0–10%） |
| 系统 | DuerShow_T616_v1.65.0（Android 12 / SDK 31） |
| 内核 | Linux 5.4.161（GKI 1.0） |
| 分区 | A/B 双分区 + `vendor_boot` + `vendor_dlkm` |

## 🔍 一、取证与发现

### 1.1 PCDN 组件

发现路径：

```text
/system/app/PCDN/PCDN.apk
/system/app/PCDN/lib/arm/libpcdn.so
/system/app/PCDN/lib/arm/libpcdnsdk.so
/system/app/DuerShowSwan/lib/arm64/libcyber-pcdn.so
/system/app/DuerShowMedia/lib/arm64/libcyber-pcdn.so
/system/app/DuerShowLauncher/lib/arm64/libcyber-pcdn.so
```

行为特征：

- 以 `system`（uid 1000）权限常驻
- 由 `com.baidu.duer.ota` 通过 `LOCKED_BOOT_COMPLETED` 拉起
- 具备双向 P2P 传输能力（`P2pDownloader`）
- 配套 **Xray SDK**（全链路数据采集：HTTP／WebView／SQLite／OkHttp／电量／崩溃）
- 类名混淆 `com.a.a.a.a.a.a` 规避识别
- **禁用后自动恢复**

### 1.2 通讯劫持组件

百度桌面（`com.baidu.launcher`）注册了以下组件拦截通讯：

```text
ContactsControlService
CallPhoneActivity
TelecomCallVoltePhoneActivity
SelectDefaultPhoneActivity
SmsLoginActivity
PrismStatusReiver
```

### 1.3 系统框架层注入

把 `framework.jar` 与 `services.jar` 的 `classes*.dex` 用 `dexdump` 过一遍，
筛选类名里含 `baidu` 的类，实际数量比最初记录的 8 个多得多：

| 组件 | 非 AOSP 类 | 方法 |
| --- | --- | --- |
| `/system/framework/framework.jar` | 62 | 722 |
| `/system/framework/services.jar` | 45 | 386 |
| **合计** | **107** | **1108** |

`services.jar` 是 `system_server` 的实现，AOSP 里不该出现任何 `com.baidu.*`。
完整类表与方法签名见项目内
[docs/framework-hooks.md](https://github.com/moyingyilang/Fuck4DuerOS/blob/main/docs/framework-hooks.md)。
重点几类：

| 类 | 关键方法 | 含义 |
| --- | --- | --- |
| `com.baidu.am.ActivityStackMonitor` | `checkStartActivity`、`filterBlockedResolveInfo` | 哪个包、哪个 Activity 能启动，由百度名单决定 |
| `com.baidu.am.ActivityRedirection` | `isSettingsAction`、`redirectToDefaultSettingAction`、`replacePendingIntent` | 重定向「设置」类 Intent；替换通知里的 PendingIntent |
| `com.baidu.am.BroadcastBlocker` / `SyncManagerBlocker` | `shouldBlock` | 拦广播 / 拦同步 |
| `com.baidu.am.ClearTaskController` | `isDoNotKillPackage` | 决定「一键清理」杀谁不杀谁 |
| `com.baidu.pm.PermissionController` | `shouldNotShowConfirmationDialog`、`shouldGrantSignaturePermission`、`revokePkgFlagsIfNeeded` | 白名单内的包可以不弹确认框直接授权 |
| `com.baidu.monitors.CameraUseStatusMonitor` / `MicUseStatusMonitor` | `getCameraUseApps` / `getMicUseApps` | 跨进程查询摄像头 / 麦克风使用者 |
| `com.baidu.input.InputMethodMonitor` | `getCurrentInputMethod`、`onInputSettingsChanged` | 监听输入法切换 |
| `com.baidu.notification.NotificationController` | `isAllowedToPostNotification` | 决定谁能发通知 |

`framework.jar` 那边还有几个值得单独点出来：

| 类 | 关键方法 | 含义 |
| --- | --- | --- |
| `android.os.baidu.IDuerService` | 63 个方法，含 `wipe`、`takeScreenshot`、`readWifiPassWd`、`sendUibcInputEvent`、`setRuntimePermissions` | 私有提权接口 |
| `android.app.baidu.SharedPreferenceHack` | `onGetBoolean`、`onPutString` | 框架层拦截 SharedPreferences 读写 |
| `android.app.baidu.DuerShowInputEventReceiver` | `pilferPointers`、`monitorGestureInput` | 夺取触摸手势 |
| `com.baidu.framework.statistics.*` | `StatisticController`、`BroadcastReporter`、`DuerCpuTracker`、`ThirdAppDownloadEvent` | 框架内部埋点，广播 action `com.baidu.framework.STATISTICS_ACTION` / `CES_STATISTICS_ACTION` |

这些类在 dex 里都标记为 `hiddenapi : 0x0002 (BLOCKED)`：普通应用引用不到，
系统内的应用可以。

### 1.4 HOME 拦截机制

`ActivityStackMonitor.filterBlockedResolveInfo()` 中的白名单：

```java
VALID_LAUNCHER_APPS = [
    "com.sprd.powersavemodelauncher",
    "com.android.managedprovisioning",
    "com.android.provision",
    "com.baidu.duershowprovison",
    "com.baidu.launcher",
    "com.android.settings"
]
```

非白名单的 HOME 候选会被移除。

### 1.5 U-Boot 按键失效根因

`FUN_00005858` 汇编逻辑：

```asm
cmp w4, #1
b.le LAB_00005908        ; w4 <= 1 → 返回 -1（跳过按键检测）
tbz w1, #0, LAB_00005880
cmp w4, #2
b.eq LAB_0000590c        ; w4 == 2 → 返回（跳过）
```

`w4` 来自 `param_11 - 1`，`param_11` 是上层传入的「启动模式」值。

### 1.6 PCDN 库的真实载体

最初只按「文件系统里有没有这个 `.so`」来找。2026-10-02 复检时发现
`libcyber-pcdn.so` **同时打包在 APK 内部**，不只是解压出来的 `lib/` 目录：

| 载体 APK | 条目 | 大小 | sha256 |
| --- | --- | --- | --- |
| `DuerShowSwan.apk`（`com.baidu.atomkit`） | `lib/arm64-v8a/libcyber-pcdn.so` | 2794344 | `191116ace444b5745a39b4773d7f19b6425c2096349dd1887c239775eab3b329` |
| `DuerShowMedia.apk`（`com.baidu.duershow.media`） | 同上 | 2794344 | `5848922be3fb24237b28eeba0b0390b8467b2ddf72180cbe518e35a7653acb7c` |
| `DuerShowLauncher.apk`（`com.baidu.launcher`） | 同上 | 2794344 | `5848922be3fb24237b28eeba0b0390b8467b2ddf72180cbe518e35a7653acb7c` |

另外 `com.baidu.duer.superapp` 是**用户空间应用**，也带一个 PCDN 库：

```text
/data/app/~~WPlaZtJzxb8uk5Q8xrryNg==/com.baidu.duer.superapp-oJ8M9sGUJlzrsznKCFApMQ==/lib/arm/libpcdn-jni.so
```

对库本身 `strings`，可以直接看到百度金矿（BJSDK）的痕迹：

```text
NDK_PCDN / PCDNVOD
/sdcard/Android/data/com.baidu.haokan/PCDNSDK
[BJSDK]BJSdkManager::Close return. Report pcdn download info. |...|
[BJSDK]Report_RealtimeTraffic. |Read(...)|DH_Down_P2PTasks(...)|
        P2P_Percentage_current/total(...)|DP_Up(...)|DP_Down(...)|
        Reused_Tasks(...)|Reuse_Ratio(...)|
```

`DP_Up`（上行）、`P2P_Percentage`、`Reuse_Ratio`、`FreeCDN_Percentage`
说明它统计的正是上行分发量与复用比例。

## 🛠️ 二、净化成果

### 2.1 Magisk 模块 duer_cleanup

目录结构：

```text
/data/adb/modules/duer_cleanup/
├── module.prop
├── service.sh
└── system/
    ├── app/
    │   ├── PCDN/.replace
    │   ├── Duerguard/.replace
    │   ├── GoodFather_DuerPhone/.replace
    │   ├── BaiduVoiceInput/.replace
    │   ├── SearchQuestion/.replace
    │   ├── DuerShowSwan/lib/arm64/libcyber-pcdn.so  (0 字节)
    │   ├── DuerShowMedia/lib/arm64/libcyber-pcdn.so (0 字节)
    │   └── DuerShowLauncher/lib/arm64/libcyber-pcdn.so (0 字节)
    ├── priv-app/
    │   ├── DuerShowStatistic/.replace
    │   └── DuerShowOTA/.replace
    └── etc/hosts
```

> ⚠️ **覆盖盲区（2026-10-02 复检发现）**：上面三个 0 字节覆盖只对**被解压到
> `/system/app/*/lib/` 的那一份**生效。`com.baidu.launcher` 是
> `UPDATED_SYSTEM_APP`，OTA 之后代码实际在 `/data/app`：
> `codePath=/data/app/~~-rk9btGny9Lu9xW9pJu_dQ==/com.baidu.launcher-3M3jr0A73iFIVZYxqjmb0A==`，
> 且它的 `legacyNativeLibraryDir`（`/data/app/.../lib`）是**空的**——native 库
> 不落地，动态链接器直接从 APK 内加载：
> `/data/app/.../base.apk!lib/arm64-v8a/libcyber-pcdn.so`（2794344 字节，
> sha256 `5848922b…cb7c`，与 `/system` 里那份完全相同）。
> 也就是说被盖住的是没有人读的那一份。
> `DuerShowMedia` 与 `com.baidu.atomkit` 因为库确实解压到了 `lib/` 目录，覆盖有效。

已禁用组件：

```text
com.baidu.pcdn
com.baidu.duerguard
com.baidu.duer.ota
com.baidu.duershow.statistic
com.goodfather.textbook.pad
com.baidu.duer.appstore
com.baidu.baidutranslate
com.baidu.input
com.baidu.atomkit
com.baidu.duer.aieye.searchquestion
com.baidu.duer.aieye.image.preprocessing
com.baidu.duer.aieye.correction
com.baidu.duer.superapp
```

已禁用通讯组件：

```text
com.baidu.launcher/com.baidu.duer.child.service.ContactsControlService
com.baidu.launcher/com.xiaoyu.communication.activity.CallPhoneActivity
com.baidu.launcher/com.xiaoyu.communication.telecom.TelecomCallVoltePhoneActivity
com.baidu.launcher/com.xiaoyu.communication.activity.global.SelectDefaultPhoneActivity
com.baidu.launcher/com.baidu.duer.account.sms.SmsLoginActivity
com.baidu.launcher/com.baidu.duer.prism.PrismStatusReiver
```

### 2.2 hosts 屏蔽

```text
127.0.0.1 pcdn.baidu.com
127.0.0.1 xray.baidu.com
127.0.0.1 duer.baidu.com
127.0.0.1 dueros.baidu.com
127.0.0.1 ota.baidu.com
127.0.0.1 statistic.baidu.com
127.0.0.1 ag.baidu.com
127.0.0.1 mobads.baidu.com
127.0.0.1 pos.baidu.com
127.0.0.1 cpro.baidu.com
127.0.0.1 union.baidu.com
127.0.0.1 dup.baidustatic.com
127.0.0.1 dudulu.duer.baidu.com
127.0.0.1 duer-static.baidu.com
127.0.0.1 duer.baidu.com.cn
127.0.0.1 dueros-h2.baidu.com
127.0.0.1 duer-ota.baidu.com
```

### 2.3 开机脚本

`/data/adb/service.d/fuck4duerOS.sh`：等待 `sys.boot_completed` 后延迟 15 秒执行全部禁用操作，日志输出到 `/data/local/tmp/fuck4duerOS.log`。

### 2.4 已解决的问题

| 问题 | 状态 |
| --- | --- |
| 通讯限制 | ✅ 已解除 |
| PCDN 进程 | ✅ 已停止 |
| PCDN 库文件 | ⚠️ 部分覆盖：桌面（`com.baidu.launcher`）那份仍从 APK 内加载，见 2.1 / 2.5 |
| Duerguard | ✅ 已禁用 |
| GoodFather 家长控制 | ✅ 已禁用 |
| 百度桌面通讯劫持 | ✅ 已禁用 6 个组件 |
| 拨号／短信 | ✅ 恢复系统原生 |
| hosts 屏蔽 | ✅ 已生效 |

### 2.5 未解决的问题

| 问题 | 原因 |
| --- | --- |
| 多任务（QuickStep） | Lawnchair 15/16 在 Android 12 上崩溃 |
| U-Boot 按键修复 | 未完成（已分析清楚，待 patch） |
| `services.jar` 修改 | 一次改 9 个方法导致 bootloop，已回退 |
| 内核编译 | Termux 环境工具链不兼容 |
| 蓝牙发射功率 | 未实施 |
| 桌面 PCDN 库覆盖 | `com.baidu.launcher` 是 `UPDATED_SYSTEM_APP`，代码在 `/data/app`，库从 APK 内直接加载，0 字节挂载覆盖不到 |

## 📂 三、开源项目

- 仓库：<https://github.com/moyingyilang/Fuck4DuerOS>
- 协议：AGPL-3.0

```text
Fuck4DuerOS/
├── README.md
├── LICENSE (AGPL-3.0)
├── CONTRIBUTING.md
├── DISCLAIMER.md
├── .gitignore
├── docs/
│   ├── technical-report.md      (422 行)
│   ├── legal-basis.md           (145 行)
│   └── plain-language.md        (212 行)
├── scripts/
│   ├── check.sh                 (89 行)
│   ├── fuck4duerOS.sh           (90 行)
│   ├── install.sh               (155 行)
│   └── rollback.sh              (36 行)
├── modules/duer_cleanup/        (完整模块)
├── evidence/
│   ├── device-xd-see00-2301/
│   │   ├── process/processes.txt
│   │   ├── packages/enabled.txt
│   │   ├── packages/disabled.txt
│   │   ├── services/services.txt
│   │   └── apps/system_apps.txt
│   ├── reports/*.docx
│   ├── pcdn_backup_README.md
│   └── README.md
└── .github/ISSUE_TEMPLATE/
    ├── bug_report.md
    └── device_report.md
```

## ⚖️ 四、法律依据

| 法律 | 条款 | 对应事实 |
| --- | --- | --- |
| 《消费者权益保护法》 | 第 8 条 | PCDN 未经告知预置 |
| 《消费者权益保护法》 | 第 10 条 | 占用用户上行带宽 |
| 《个人信息保护法》 | 第 13 条 | Xray 采集数据未获同意 |
| 《个人信息保护法》 | 第 17 条 | 无显著告知 |
| 《网络安全法》 | 第 22 条第 3 款 | 信息收集未明示 |
| 《网络安全法》 | 第 41 条 | 超出必要原则 |
| 《电信条例》 | 第 7 条、第 8 条 | 未许可从事电信业务 |
| 《未成年人保护法》 | 第 72 条 | 未成年人设备未征得监护人同意 |
| 《民法典》 | 第 1165 条、第 1167 条 | 构成侵权 |

> 以上为作者基于公开法条的理解与梳理，**不构成法律意见**。

## 🎵 五、音频调度优化

### 问题

切屏时后台音乐卡顿、出错。

### 根因

Termux PulseAudio 的音频线程（`AudioTrack`）是 **TS（普通调度）**，而 `zsh` 和 pulseaudio 主线程是 **RT（实时调度）**，RT 线程一跑就抢占 TS 音频线程。

### 解决方案

**1. 优化 PulseAudio 配置**

`~/.config/pulse/daemon.conf`：

```ini
high-priority = yes
realtime-scheduling = yes
realtime-priority = 9
default-fragments = 3
default-fragment-size-msec = 15
flat-volumes = no
exit-idle-time = 180
```

**2. 手动提升线程优先级**

```bash
su
PA_PID=$(pgrep -f pulseaudio | head -1)

# 主线程 RT 20
chrt -f -p "$PA_PID" 20

# 音频数据线程 RT 10
for tid in $(ls /proc/$PA_PID/task/); do
    comm=$(cat /proc/$PA_PID/task/$tid/comm 2>/dev/null)
    case "$comm" in
        AudioTrack|sles-sink|AudioOut|FastMixer)
            chrt -f -p "$tid" 10
            ;;
    esac
done
```

**3. 关键发现**：Toybox 的 `chrt` 语法与 util-linux **相反**：

```bash
# Toybox:      chrt -f -p PID PRIORITY
# util-linux:  chrt -f -p PRIORITY PID
```

**4. 结果**：`AudioTrack` 和 `sles-sink` 均提升至 RT 10，pulseaudio 主线程 RT 20。卡顿问题解决。

## 💾 六、内存诊断

### 诊断结果

```text
物理内存:  5.6G  已用 5.5G  空闲 137M
Swap:      11G   已用 4.5G  空闲 6.3G
```

### 重启根因

```text
sys.boot.reason = kernel_panic,native_hung_minitor_trioomr
```

`native_hung_monitor` 触发 kernel panic，根因是内存极度紧张导致：

- GPU 分配失败 → `EGL_BAD_ALLOC`（tombstone_00）
- 蓝牙初始化超时 → `startup_timer_expired`（tombstone_14）

### UFS 健康

```text
eol_info = 0x01                    （正常）
life_time_estimation_a = 0x01      （已用 0-10%）
life_time_estimation_b = 0x00      （未记录）
```

**结论：UFS 健康，不是硬件问题。**

### 内存黑洞

| 进程 | 内存 |
| --- | --- |
| `tv.danmaku.bili`（全家桶） | ~1.5 GB |
| `com.tencent.mobileqq` + mm | ~1.2 GB |
| `com.netease.cloudmusic` | 325 MB |
| `com.deepseek.chat` | 357 MB |
| `com.twitter.android` | 310 MB |
| 各种 WebView 沙箱 | 460 MB |
| 各种 push service | 700 MB+ |

### 缓解方案

**1. 开启缓存应用冻结**

```bash
su -c 'settings put global cached_apps_freezer enabled'
su -c 'settings get global cached_apps_freezer'
```

**2. 限制后台进程**

```bash
su
device_config put activity_manager max_cached_processes 8
device_config put activity_manager max_phantom_processes 4
settings put global app_standby_enabled 1
```

**3. 加大 ZRAM**

```bash
su
echo lz4 > /sys/block/zram0/comp_algorithm
echo 5368709120 > /sys/block/zram0/disksize
mkswap /dev/block/zram0
swapon /dev/block/zram0
```

**4. 调整 vm 参数**

```bash
echo 30 > /proc/sys/vm/swappiness
echo 100 > /proc/sys/vm/vfs_cache_pressure
```

## 🔧 七、U-Boot 修改分析（未完成）

### 原始逻辑

```asm
0000585c  cmp w4, #1
00005870  b.le LAB_00005908        ; w4 <= 1 → 返回 -1
00005874  tbz w1, #0, LAB_00005880  ; w1 bit0 == 0 → 按键检测
00005878  cmp w4, #2
0000587c  b.eq LAB_0000590c        ; w4 == 2 → 返回
00005880  ...                       ; 按键检测
000058e8  cmp w4, #2
000058ec  b.eq LAB_0000590c
000058f0  ...                       ; 后续检测
00005904  b LAB_0000590c
00005908  mov w20, #0xffffffff
0000590c  mov w0, w20
00005910  ret
```

### 修改方案（待实施）

将 `00005870` 的 `b.le` 和 `00005874` 的 `tbz` 改为 `nop`，让按键检测无条件执行。

### 风险

- DHTB 签名会失效
- 需绕过 U-Boot 自校验（解锁状态下 SKIP VERIFY 可能有效）
- 刷坏需用 `spd_dump` 强刷恢复

## 📊 八、工具链与命令

### 常用命令速查

```bash
# 侦察
su -c 'sh /sdcard/duer_killer/check.sh'

# 禁用组件
pm disable <package>
pm disable-user --user 0 <package>

# 恢复组件
pm enable <package>

# 杀进程
am force-stop <package>
am kill-all

# 查看 RT 线程
chrt -p <tid>

# 设置 RT 优先级（Toybox）
chrt -f -p <tid> <prio>

# 设回 TS
chrt -o -p <tid> 0

# ZRAM 状态
cat /sys/block/zram0/disksize
cat /sys/block/zram0/mm_stat

# UFS 健康
cat /sys/devices/platform/soc/soc:ap-apb/20200000.ufs/health_descriptor/eol_info
cat /sys/devices/platform/soc/soc:ap-apb/20200000.ufs/health_descriptor/life_time_estimation_a

# 内存状态
free -h
dumpsys meminfo | head -40

# 启动原因
getprop sys.boot.reason

# tombstone
ls /data/tombstones/
cat /data/tombstones/tombstone_XX | head -50
```

### 编译环境（Termux）

```bash
pkg install flex bison bc libssl-dev libelf-dev busybox
```

### Toybox chrt 语法陷阱

```bash
# ❌ 错误（util-linux 语法）
chrt -f -p 10 7866

# ✅ 正确（Toybox 语法）
chrt -f -p 7866 10
```

## 📝 九、经验总结

### 9.1 技术要点

1. **GKI 1.0 架构**：内核核心在 `boot.img`，vendor 驱动在 `vendor_dlkm`，通过 KMI 符号连接
2. **DHTB 签名**：展锐 U-Boot 的独立签名机制，与 AVB 无关
3. **RT 调度优先级**：Toybox `chrt` 语法与 util-linux 相反
4. **Termux 编译内核**：ARM64 环境无法交叉编译 ARM64 5.4 内核，需 x86_64 宿主
5. **UFS 健康度**：通过 `health_descriptor` 目录读取，非 `mmcblk0`

### 9.2 踩坑记录

| 坑 | 教训 |
| --- | --- |
| `services.jar` 一次改 9 个方法 | 导致 bootloop，应逐个改逐步验证 |
| Termux 编译 5.4 内核 | Clang 21 太新，需 Clang 12.0.5 |
| `chrt` 语法 | Toybox 与 util-linux 相反 |
| `swapon --show` | Toybox 不支持，用 `cat /proc/swaps` |
| `unzip config.gz` | 应用 `gunzip -c`，gzip 不是 zip |
| `make o=out` | 应大写 `O=out` |

### 9.3 关键文件路径

```text
/data/adb/modules/duer_cleanup/          Magisk 模块
/data/adb/service.d/fuck4duerOS.sh       开机脚本
/data/local/tmp/fuck4duerOS.log          执行日志
/sdcard/duer_uboot_backup/               U-Boot 备份
/sdcard/duer_hosts/hosts                 hosts 备份
/sdcard/duer_cleanup/                    侦察数据备份
/data/tombstones/                        native 崩溃日志
/sys/fs/pstore/                          PStore 日志（本设备无）
/proc/last_kmsg                          Last kmsg（本设备无）
/data/app/~~.../com.baidu.launcher-.../base.apk   桌面实际运行的 APK（PCDN 库内嵌于此）
```

## 🎯 十、后续待办

| 项目 | 优先级 | 说明 |
| --- | --- | --- |
| U-Boot 按键修复 | 中 | 已分析清楚，待 patch |
| 音频调度持久化 | 高 | 写入 `service.sh` |
| 内存优化脚本 | 高 | 写入 `service.sh` |
| 内核编译 | 低 | 需要 x86_64 环境 |
| 蓝牙功率调整 | 低 | 需 NV 配置或 AT 命令 |
| `services.jar` 多任务修复 | 低 | 用 LSPosed Hook 更安全 |
| 桌面 PCDN 库覆盖 | 高 | 需跟随 `pm path` 解析出的活动 codePath；`UPDATED_SYSTEM_APP` 场景要替换 APK 或在链接器层拦截 |

---

> 文档版本：1.1 ｜ 最后更新：2026-10-02 ｜ 项目地址：<https://github.com/moyingyilang/Fuck4DuerOS>
