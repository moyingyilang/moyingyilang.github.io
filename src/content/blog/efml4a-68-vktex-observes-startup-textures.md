---
title: "68. ★★★ vktex 实测：启动画面真正上传的纹理清单"
description: "EFML4A 研究文档 · 68-vktex-observes-startup-textures（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 68.1 方法

**用 Round 15 修复的 zygisk-loader 配置，挂载 `libefml4a_vktex.so`：**

```json
[
  {
    "app": "com.hypergryph.endfield",
    "lib": "/data/adb/modules/zygisk-loader/config/libefml4a_vktex.so"
  }
]
```

**启动游戏 20 秒，抓取 vktex 日志（58 次纹理上传）。**

## 68.2 ★ 完整纹理上传清单

| Copy# | 尺寸 | 首 8 字节 | 判读 |
|---|---|---|---|
| #1 | 4x4 | `7fff7f7f` | Unity 默认（灰） |
| #2 | 4x4 | `ffffffff` | Unity 默认（白） |
| #5-#8 | 1x1 | `00000000` | Unity 默认（黑） |
| #9 | 16x16 | `00000000` | Unity 默认 |
| #13 | 4x4 | `00000000 ffffffff` | Unity 默认 |
| #14 | **256x2** | `70dc0008 0000ab1f` | **有真实数据** |
| #15 | 64x64 | `00000000` | — |
| #16 | **1024x1** | `f9e5ffff ee87f414` | **有真实数据**（渐变 LUT） |
| #18 | 16x16 | `80808080` | 灰 |
| #23 | 4x4 | `f030c000 70b04080` | — |
| #25 | 4x64 | `00000000` | — |
| #26 | 256x64 | `00000000` | — |
| #27 | 58x58 | `00ffffff` | 白 |
| #28 | 128x128 | `00000000` | — |
| **#29-#37** | **1920x1080 × 9** | `fffffdfc ffffffff` | ★★★ **启动背景（9 帧）** |
| **#57** | **304x68** | `fffffdfc ffffffff` | ★★★ **ui_main_menu_logo_icon！** |
| #58 | 256x256 | `00000000` | — |

## 68.3 ★★★ 关键结论

### 1. `ui_main_menu_logo_icon`（304×68）确实在启动时上传

```
Copy #57 ext=304x68 data=fffffdfc ffffffff
```

**⇒ 我选择的 mod 目标是【正确的】**
**⇒ 这个纹理确定被上传到 GPU**

### 2. 上传的数据是原版

```
data=fffffdfc
小端读取 = fcfdffff
⇒ 这正是原纹理的 ASTC 块（纯色）
⇒ 因为 Round 16 已恢复原始文件
⇒ 这次观测的是【原始状态】
```

### 3. 1920×1080 × 9 帧是启动背景

```
Copy #29-#37  ext=1920x1080  data=fffffdfc ffffffff

⇒ 9 帧 = 可能是启动 Logo 动画序列
⇒ 这也解释了为什么「花屏」—— 如果这些帧被破坏
```

## 68.4 对 mod 策略的意义

```
✅ 目标纹理正确（304x68 确实上传）
✅ 上传时机明确（Copy #57，启动后 20 秒内）
✅ 观测手段可用（vktex payload）

⇒ 下一步：应用 mod → 再次 vktex 观测 → 看 Copy #57 的数据是否变成我的图案

若变成图案但仍不显示 ⇒ 问题在渲染层（UV/材质）
若仍是原版 ⇒ 游戏没读我的修改
```

## 68.5 工具用法

```bash
# 1. 挂 payload
cat > /sdcard/tj.json <<'JEOF'
[
  {
    "app": "com.hypergryph.endfield",
    "lib": "/data/adb/modules/zygisk-loader/config/libefml4a_vktex.so"
  }
]
JEOF
su -c "cp /sdcard/tj.json /data/adb/modules/zygisk-loader/config/target.json"

# 2. 启动 + 等
am start -n com.hypergryph.endfield/com.u8.sdk.U8UnityContext
sleep 20

# 3. 看日志
cat /sdcard/Android/data/com.hypergryph.endfield/files/efml4a_vktex.log

# 4. ⚠️ 立即卸下
echo '[]' > /sdcard/tj_off.json
su -c "cp /sdcard/tj_off.json /data/adb/modules/zygisk-loader/config/target.json"
```

## 68.6 合规

```
仅研究用途 · 不改游戏数值/存档 · 不用于竞技作弊
不散布游戏资源 · 用户授权：目的合规即可用任何技术手段
```
