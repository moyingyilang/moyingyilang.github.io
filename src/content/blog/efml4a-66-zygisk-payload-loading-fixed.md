---
title: "66. 🎯 zygisk payload 加载机制打通（关键基础设施）"
description: "EFML4A 研究文档 · 66-zygisk-payload-loading-FIXED（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


## 66.1 问题

**之前多次尝试加载 zygisk payload 失败，`/proc/<pid>/maps` 里看不到 `libefml4a_*`。**

**日志文件从未生成。**

## 66.2 根因：`target.json` 格式错误

**我之前写的：**

```json
["com.hypergryph.endfield"]
```

**正确格式（从 `target.json.bak-1791732179` 备份中发现）：**

```json
[
  {
    "app": "com.hypergryph.endfield",
    "lib": "/data/adb/modules/zygisk-loader/config/libefml4a_vktex.so"
  }
]
```

**⇒ 是对象数组，含 `app` 和 `lib` 两个键，`lib` 必须是绝对路径。**

## 66.3 验证：payload 成功加载

**用正确格式后，日志立即生成：**

```
=== efml4a vktex pid=328 replace=0 ===
[vktex] waiter pid=328
[vktex] vkMapMemory insn[2]=CBZ 不安全(节流)
[vktex] vkBindBufferMemory HOOKED @0x7bfd60a1f0
[vktex] vkCmdCopyBufferToImage HOOKED @0x7bfd60d770
[vktex] BindBufferMemory #1 buf=0xb400007d2fb440c0 mem=... off=0
[vktex] Copy #1 ext=4x4 bo=0 host=0x7a248e1080 data=7fff7f7f 7fff7f7f
[vktex] Copy #9 ext=16x16 bo=0 host=0x7a1ec9d200 data=00000000 00000000
[vktex] ★ 重装窗口已关闭（不再触碰代码，消除竞态）
```

**⇒ Hook 成功！能看到每次纹理上传的尺寸和内容。**

## 66.4 payload 的 ABI

**导出符号（zygisk-loader 自定义 ABI，不是标准 Zygisk API）：**

```
T init        ← 入口
T impl0/impl1/impl2  ← hook 实现
T stub0       ← 跳板
T __clear_cache
```

**⇒ 这些 payload 是为 HanSoBored/zygisk-loader 专门编译的。**

## 66.5 部署流程

```bash
CFG=/data/adb/modules/zygisk-loader/config

# 1. 部署 payload
cp libefml4a_vktex.so $CFG/ && chmod 755 $CFG/libefml4a_vktex.so

# 2. 写正确格式的 target.json
cat > /sdcard/tj.json <<'JEOF'
[
  {
    "app": "com.hypergryph.endfield",
    "lib": "/data/adb/modules/zygisk-loader/config/libefml4a_vktex.so"
  }
]
JEOF
su -c "cp /sdcard/tj.json $CFG/target.json && chmod 644 $CFG/target.json"

# 3. 启动游戏
am start -n com.hypergryph.endfield/com.u8.sdk.U8UnityContext

# 4. 看日志
cat /sdcard/Android/data/com.hypergryph.endfield/files/efml4a_vktex.log

# 5. ⚠️ 用完立即清空
echo '[]' > /sdcard/tj_off.json
su -c "cp /sdcard/tj_off.json $CFG/target.json"
```

## 66.6 首次观测结果

```
Copy 次数: 11（全是 Unity 内部默认纹理）
  16x16 ×1
  4x4   ×6
  1x1   ×4

⇒ 游戏在加载真实资源【之前】就退出了
⇒ 说明启动阶段可能有其他前置检查（网络/版本/完整性）
```

## 66.7 下一步

```
有了这个基础设施，可以:
  ① 用 vktex 找出游戏真正上传的大纹理（需要游戏活到渲染阶段）
  ② 用 vkinject 在 vkCmdCopyBufferToImage 时替换数据
  ③ 用 vkBindBufferMemory 反查 buffer→memory 映射

⚠️ 但前提是游戏能活到渲染阶段
```

## 66.8 合规

```
仅研究用途 · 不改游戏数值/存档 · 不用于竞技作弊
不散布游戏资源 · 用户授权：目的合规前提下可使用任何技术手段
```
