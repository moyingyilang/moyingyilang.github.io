---
title: "12 · 参考链接集"
description: "EFML4A 研究文档 · 12-references（Arknights: Endfield Mod Loader for Android）"
date: 2026-10-15
category: reverse
tags:
  - 逆向工程
  - Android
  - Unity
  - 终末地
  - EFML4A
---


> 本文档是 EFML4A 研究文档集的一部分，索引见 [docs/README.md](/cs/reverse/)。

**核实说明**：下表的链接在本次撰写时通过**搜索引擎索引结果**核实（本机环境的直接 HTTP 抓取不可用， `web_fetch` 亦失败）。因此状态列的含义是：

- ✅ **已索引**：该 URL 作为搜索结果**被原样返回**，说明它至少存在于索引中、且可被解析为具体页面。
- ⚠️ **未核实**：本次未取得该 URL 的存在性证据（可能是路径有误、已改名、已下架，或仅凭常识填写）。

**未核实的条目一律保留 ⚠️ 标记，禁止在未复核的情况下引用为事实。** 凡本表中标注 ⚠️ 的链接，在对外文档中引用前 MUST 重新人工确认。相关背景见 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/) 与 [08-threat-model.md](/blog/efml4a-08-threat-model/) §4.3。

---

## 1. EFMI 生态（对标对象）

| 名称 | 链接 | 一句话说明 | 相关性 |
| --- | --- | --- | --- |
| EFMI-Package | <https://github.com/SpectrumQT/EFMI-Package> | Endfield Model Importer 的发布包仓库（README 含 Endfield Model Importer 标题）✅ 已索引 | **最高**：本项目直接对标物 |
| EFMI-Tools | <https://github.com/SpectrumQT/EFMI-Tools> | "Mod making toolkit for Arknights: Endfield"，mod 制作工具链 ✅ 已索引 | 高：manifest 与 IR 设计的参照 |
| EFMI Releases | <https://github.com/SpectrumQT/EFMI-Package/releases> | EFMI-Package 的发布页，可观察其版本节奏与发布物构成 ✅ 已索引 | 中：发布规范参考 |
| XXMI-Launcher | <https://github.com/SpectrumQT/XXMI-Launcher> | 多游戏 mod 启动器（含 Arknights: Endfield）✅ 已索引 | 高：安装/切换体验的参照 |
| XXMI-Libs-Package | <https://github.com/SpectrumQT/XXMI-Libs-Package> | XXMI Launcher 使用的定制 3dmigoto 库打包 ✅ 已索引 | 高：运行时分发形态参考 |
| GameBanana · EFMI Tools | <https://gamebanana.com/tools/21847> | GameBanana 上的 "EFMI Tools Modding Tool for Arknights: Endfield" 页面 ✅ 已索引 | 中：社区分发渠道 |
| GameBanana · Endfield 新闻 | <https://gamebanana.com/news/21957> | "Endfield Mods Currently Broken, Informational Post" ✅ 已索引 | 中：说明 mod 生态随版本更新失效的现实风险 |
| GameBanana · Endfield mods 分区 | ⚠️ 未核实 | 未取得 Endfield mods 分区的规范 URL（本次只索引到 tools 页与 news 页） | 中 |

## 2. 3DMigoto 血统

| 名称 | 链接 | 一句话说明 | 相关性 |
| --- | --- | --- | --- |
| 3Dmigoto（bo3b） | <https://github.com/bo3b/3Dmigoto> | 原始 3DMigoto 项目，DX11 绘制调用拦截与着色器替换的鼻祖 ✅ 已索引 | 最高：整个生态的技术源头 |
| 3Dmigoto 着色器反射（DeepWiki） | <https://deepwiki.com/bo3b/3Dmigoto/3.3-shader-reflection> | 对 3Dmigoto "Texture Override System / shader reflection" 的第三方解读 ✅ 已索引 | 高：理解 hash 命中机制 |
| 3d-fixes（DarkStarSword） | <https://github.com/DarkStarSword/3d-fixes> | "Stereoscopic 3D fixes using Helix mod & 3DMigoto"，长期维护的 mod 集合 ✅ 已索引 | 中：mod 组织方式参考 |
| GI-Model-Importer（GIMI） | <https://github.com/SilentNightSound/GI-Model-Importer> | 原神换模型工具的原始仓库，EFMI 家族的直接祖先 ✅ 已索引 | 高：功能集合与用户预期参照 |
| SR-Model-Importer（SRMI） | <https://github.com/SilentNightSound/SR-Model-Importer> | 星穹铁道换模型工具，"anime game number 2" ✅ 已索引 | 高：同族工具的另一实现 |
| ZZ-Model-Importer / ZZMI | <https://github.com/leotorrez/ZZMI-Package> | ✅ **已核实（GitHub API）**：HLSL，53 star，活跃（描述为 "NOT INTENDED FOR WIDE USE"） | 中：同族工具的第三例 |
| DarkStarSword 的维护仓 | <https://github.com/DarkStarSword/3d-fixes> | ✅ **已核实（GitHub API）**：Python，144 star，活跃。附带更正：`DarkStarSword/3DMigoto` 经 API 查询**返回 404，不存在**；DarkStarSword 名下的实际产出是 `3d-fixes`（其 3DMigoto 改动长期以补丁形式分发） | 中：mod 组织方式参考 |

## 3. Vulkan 层（隐式层路线）

| 名称 | 链接 | 一句话说明 | 相关性 |
| --- | --- | --- | --- |
| Vulkan-Loader | <https://github.com/KhronosGroup/Vulkan-Loader> | Khronos 官方 loader，隐式层注册与层链管理的唯一权威 ✅ 已索引 | **最高**：[04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) 的基础 |
| LoaderLayerInterface.md | <https://github.com/KhronosGroup/Vulkan-Loader/blob/main/docs/LoaderLayerInterface.md> | 层接口规范文档（本次经 gitiles 镜像确认该路径存在）✅ 已索引（经镜像） | 最高：`vkEnumerateInstanceLayerProperties` 等行为定义 |
| Vulkan-Headers | <https://github.com/KhronosGroup/Vulkan-Headers> | 官方头文件与 vk.xml，生成绑定与校验用 ✅ 已索引 | 高：层实现依赖 |
| Android NDK · Vulkan 校验层 | <https://developer.android.com/ndk/guides/graphics/validation-layer> | Android 上启用 Vulkan 校验层的官方指南（本次经本地化镜像索引）✅ 已索引（经镜像） | 高：验证层加载方式与调试实践 |
| Android GPU Inspector (AGI) | <https://developer.android.com/agi> | Google 官方 Android GPU 调试/剖析工具（本次经本地化镜像索引）✅ 已索引（经镜像） | 高：抓帧与管线分析 |
| RenderDoc | <https://github.com/baldurk/renderdoc> | 跨平台图形调试器源码仓（README 与 v1.42 发布信息已索引）✅ 已索引 | 高：抓帧与管线分析 |
| RenderDoc 官网 | <https://renderdoc.org/> | ✅ **已核实（HTTP 200）** | 中 |
| libGPULayers（Arm） | <https://github.com/ARM-software/libGPULayers> | Arm 官方的 Android GPU 层集合 ✅ 已索引 | 高：Android 上层的工程范式 |
| libGPULayers · about_layers | <https://github.com/ARM-software/libGPULayers/blob/main/docs/about_layers.md> | 层工作原理与限制说明 ✅ 已索引 | 高 |
| Arm libGPULayers 演讲（Vulkanised 2025） | <https://vulkan.org/user/pages/09.events/vulkanised-2025/T19-Pete-Harris-Arm-libGPULayers.pdf> | Arm 在 Vulkanised 2025 关于 libGPULayers 的讲稿 PDF ✅ 已索引 | 中 |

## 4. Android 注入面

| 名称 | 链接 | 一句话说明 | 相关性 |
| --- | --- | --- | --- |
| Magisk | <https://github.com/topjohnwu/Magisk> | 主流 Android root 方案；**Zygisk 是其内置能力**（无独立仓库）✅ 已索引 | 最高：用户环境前提 |
| KernelSU | <https://github.com/tiann/KernelSU> | 内核态 root 方案 ✅ 已索引 | 高：环境分支 |
| APatch | <https://github.com/bmax121/APatch> | 内核 patch 式 root 方案 ✅ 已索引 | 中：环境分支 |
| LSPosed | <https://github.com/LSPosed/LSPosed> | ✅ **已核实（GitHub API）**：Java，24982 star，活跃，**未下架**。附带更正：早前「原始仓库疑已下架」的判断有误 | 高：模块化 hook 生态参考 |
| frida | <https://frida.re/> | 动态插桩工具官网（另有 docs 页 <https://frida.re/docs/home/>）✅ 已索引 | 高：**仅开发期诊断**（见 08 文档 §5.3） |
| frida-il2cpp-bridge | <https://github.com/bfloat16/frida-il2cpp-bridge> | Frida 模块，可在运行时 dump / trace / hijack IL2CPP 应用 ✅ 已索引 | 高：IL2CPP 侧研究工具 |
| Dobby | <https://github.com/jmpews/Dobby> | 轻量 inline hook 框架（多平台）✅ 已索引 | 高：[05-route-il2cpp-hook.md](/blog/efml4a-05-route-il2cpp-hook/) 候选 |
| ShadowHook (android-inline-hook) | <https://github.com/bytedance/android-inline-hook> | 字节跳动开源 Android inline hook 库 ✅ 已索引 | 高：候选 hook 库 |
| xHook | <https://github.com/iqiyi/xHook> | "A PLT hook library for Android native ELF" ✅ 已索引 | 中：PLT hook 路径 |
| Zygisk 模块工程模板 | <https://github.com/topjohnwu/zygisk-module-sample> | ✅ **已核实（GitHub API）**：C++，1052 star，**已归档（archived=true）**；仍是理解 Zygisk 模块结构的权威参考 | 高：`android/lsposed-module` 的工程结构参考 |

## 5. Unity / IL2CPP 逆向

| 名称 | 链接 | 一句话说明 | 相关性 |
| --- | --- | --- | --- |
| Il2CppDumper（Perfare） | <https://github.com/Perfare/Il2CppDumper> | 从 `libil2cpp.so` + `global-metadata.dat` 还原类型与符号 ✅ 已索引 | 最高：IR 识别与资源定位的前提 |
| Zygisk-Il2CppDumper（Perfare） | <https://github.com/Perfare/Zygisk-Il2CppDumper> | 在设备上以 Zygisk 模块方式运行时 dump IL2CPP 数据 ✅ 已索引 | 高：无需拉取文件的现场 dump |
| Zygisk-Il2CppDumper（moyingyilang，本项目作者的 fork） | <https://github.com/moyingyilang/Zygisk-Il2CppDumper> | ✅ **已核实（GitHub API）**：`Perfare/Zygisk-Il2CppDumper` 的 fork（`fork=true`、`parent=Perfare/Zygisk-Il2CppDumper`、默认分支 `master`、public）。因为是 0 star 的 fork，搜索引擎索引不到，早前因此被误判为「不存在」。**上文更正** | 高：本项目作者的实践基线 |
| Zygisk-Il2CppDumper（第三方 fork） | <https://github.com/codehasan/Zygisk-Il2CppDumper> | "Dump il2cpp game data at runtime with Zygisk" ✅ 已索引 | 中：替代入口 |
| UABEA | <https://github.com/nesrak1/UABEA> | "c# uabe for newer versions of unity"，AssetBundle 查看/编辑 ✅ 已索引 | 高：[06-route-assetbundle.md](/blog/efml4a-06-route-assetbundle/) 参考 |
| UABEANext | <https://github.com/nesrak1/UABEANext> | UABEA 的新一代实现（SerializedFile / AssetBundle）✅ 已索引 | 中 |
| AssetStudio（Perfare） | <https://github.com/Perfare/AssetStudio> | ✅ **已核实（GitHub API）**：C#，15587 star，**已归档（archived=true）**。归档意味着不再维护，新工作宜优先用 UABEA / UABEANext / UnityPy | 中：资源导出（历史工具） |
| UnityPy | <https://github.com/K0lb3/UnityPy> | Python 实现的 Unity 资源解析库 ✅ 已索引 | 高：离线资源处理与校验脚本 |

## 6. 安全与合规

| 名称 | 链接 | 一句话说明 | 相关性 |
| --- | --- | --- | --- |
| Promon · App Threat Report Q3 (GPU debugger abuse) | <https://promon.io/security-news/app-threat-report-q3-2026-gpu-debugger-abuse-in-android-apps> | 关于 Android 应用中滥用 GPU 调试器（图形层类注入）的威胁报告 ✅ 已索引 | **最高**：[08-threat-model.md](/blog/efml4a-08-threat-model/) §2.2、§5.1 的现实依据 |
| AGPL-3.0（OSI） | <https://opensource.org/license/AGPL-3.0> | AGPL-3.0 许可条目与要点 ✅ 已索引 | 最高：本项目采用许可 |
| AGPL-3.0-only（SPDX） | <https://spdx.org/licenses/AGPL-3.0-only> | SPDX 标识符定义（源文件头用 `AGPL-3.0-only`）✅ 已索引 | 高 |
| AGPL-3.0 全文（FSF） | <https://www.gnu.org/licenses/agpl-3.0.html> | ✅ **已核实（HTTP 200）**。纯文本版 <https://www.gnu.org/licenses/agpl-3.0.txt> 同为 200，仓库根 `LICENSE` 即由此取得（661 行） | 最高：本项目的许可正文来源 |
| GNU 许可兼容性说明 | <https://www.gnu.org/licenses/license-compatibility.html> | GPL/AGPL 之间的兼容方向与条件（GPL-3.0 → AGPL-3.0 可行）✅ 已索引 | 最高：§4.3 结论依据 |
| AGPLv3 设计理由（FSF） | <https://gplv3.fsf.org/agplv3-dd2-rationale.html> | AGPL 第 13 条（网络服务条款）的立法意图说明 ✅ 已索引 | 高：理解 §13 边界 |
| 美国法典第 17 编第 12 章（含 §1201） | <https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title17-chapter12&edition=prelim> | 版权保护与管理体系章，含反规避条款 §1201 ✅ 已索引 | 高：§4.4 反规避讨论依据 |
| GitHub Actions 计费文档 | <https://docs.github.com/en/billing/concepts/product-billing/github-actions> | 公开/私有仓库的 Actions 计费与配额规则（分钟数请以页面为准）✅ 已索引 | 高：§3 私有期工程约束 |
| gitleaks | <https://github.com/gitleaks/gitleaks> | ✅ **已核实（GitHub API）**：Go，29830 star，活跃 | 中：提交前密钥扫描 |
| git-secrets（AWS Labs） | <https://github.com/awslabs/git-secrets> | ✅ **已核实（GitHub API）**：Shell，13411 star，活跃 | 低：gitleaks 的替代方案 |

---

## 7. 待人工复核清单（⚠️ 汇总）

| # | 条目 | 问题 | 建议动作 |
| --- | --- | --- | --- |
| ~~R-1~~ | `moyingyilang/Zygisk-Il2CppDumper` | ✅ **已解决**：真实存在，是 `Perfare/Zygisk-Il2CppDumper` 的 fork，public，默认分支 `master`。上文表格已更正 |
| R-2 | GameBanana Endfield mods 分区 URL | ⚠️ **仍未核实**（非 GitHub 站点，API 无法验证） | 浏览器打开后取规范链接 |
| ~~R-3~~ | `leotorrez/ZZMI-Package`、`SpectrumQT/SRMI-Package` | ✅ **已解决**：两者均存在（ZZMI 53 star / HLSL；SRMI 17 star / HLSL，"XXMI Launcher package for Honkai: Star Rail"） |
| ~~R-4~~ | LSPosed 原始仓库 | ✅ **已解决**：`LSPosed/LSPosed` 存在且活跃（Java，24982 star），未下架 |
| ~~R-5~~ | `renderdoc.org`、`gnu.org/licenses/agpl-3.0.html` | ✅ **已解决**：两者均返回 HTTP 200 |
| ~~R-6~~ | `gitleaks`、`awslabs/git-secrets`、`Perfare/AssetStudio` | ✅ **已解决**：三者均存在（其中 AssetStudio 已归档） |
| ~~R-7~~ | EFMI 各文件的**实际许可** | ✅ **已解决**：GitHub API 显示 `EFMI-Package` 与 `EFMI-Tools` 均为 **GPL-3.0**；[02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/) 已基于原文撰写 |
| ~~R-8~~ | EFMI ini 的段落名与键名 | ✅ **已解决**：[02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/) 基于 `gh api` 读取的 ini / HLSL 原文，含真实片段与跨版本（GIMI 对照）结论 |
| R-9 | AOSP 中隐式层搜索路径与 `Settings.Global` 键名 | ⚠️ **仍未核实**：[04-route-vulkan-layer.md](/blog/efml4a-04-route-vulkan-layer/) 已标注，需在有网环境查 AOSP 源码复核 |
| R-10 | Arm libGPULayers（Vulkanised 2025 PDF） | ⚠️ **仍未核实**：抓取返回 403，移动端层实践细节未取得 |

---

## 8. 核实方法与免责

1. 本轮核实分三档，逐条标注：**✅ 已核实（GitHub API）** = `gh api repos/<owner>/<repo>` 取得仓库元数据（存在性、star 数、归档状态、语言、描述）；**✅ 已核实（HTTP）** = `curl` 取得 2xx 状态码；**⚠️ 未核实** = 仅见于搜索引擎索引，或完全未取得证据。
2. 早前一轮核实受限于网络（子代理会话内 `curl` 超时、`web_fetch` 失败），只能依赖搜索索引，因此产生了一批**「误判为不存在」**的条目。本轮已用 GitHub API 与 `curl` 复核更正，最主要的误判是 `moyingyilang/Zygisk-Il2CppDumper`——它真实存在，但因为是无 star 的 fork 而未被索引。
3. 任何人向仓库提交新的参考链接时，MUST 同时更新本表的核实状态；未标状态的链接默认视为 ⚠️ 未核实。
4. 本表**不包含**任何指向游戏原始资源、破解工具或 DRM 规避资料的链接（对应 [08-threat-model.md](/blog/efml4a-08-threat-model/) §1.2 的红线清单）。
