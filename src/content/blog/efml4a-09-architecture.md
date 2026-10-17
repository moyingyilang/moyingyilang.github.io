---
title: "09 · EFML4A 目标架构"
description: "EFML4A 研究文档 · 09-architecture（Arknights: Endfield Mod Loader for Android）"
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


## 9.1 设计原则

1. **mod 描述与执行后端解耦**。这是本项目区别于 EFMI 的核心设计。EFMI 的 mod 只有
   3DMigoto 能解释；EFML4A 用 IR 描述「要做什么」，由各后端编译成「怎么做」。
   动机与格式详见 [10-mod-format.md](/blog/efml4a-10-mod-format/)。
2. **声明式优于过程式**。mod 包是**数据**，不是代码。这样可以静态校验、可以算校验和、
   可以沙箱化解析，也让社区工具（打包器、校验器、GUI）成为可能。
3. **可静态校验的能力边界**。所有被引用的文件路径必须是相对包根且不含 `..`，
   由 `efml-core` 在加载时强制（见 `manifest::validate_relative_path`）。
4. **安全默认**。GUI 只监听回环、无鉴权但也不暴露；CI 使用最小权限。
5. **工具用 Rust / Kotlin**。若某处确实只能写成 shell，则必须做成 TUI 而非裸脚本。

## 9.2 分层视图

```
┌──────────────────────────────────────────────────────────────────────┐
│  交互层                                                              │
│  efml-cli (TUI)          efml-gui (Rust 核心 + 本地 Web UI)          │
│  android/manager-app (Kotlin + Compose，后续复用同一套 JSON API)      │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ 同源的 JSON 视图
┌───────────────────────────▼──────────────────────────────────────────┐
│  领域层  efml-core (Rust)                                            │
│  manifest · ir · identify · package · checksum · version · routes    │
│  产出：已校验的 ModIr + 目标后端列表                                  │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ 后端 ABI（见 §9.4）
        ┌───────────────────┼───────────────────┬────────────────────┐
        ▼                   ▼                   ▼                    ▼
┌───────────────┐  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐
│ vulkan-layer  │  │ il2cpp-hook    │  │ asset-bundle   │  │ 未来后端          │
│ (C++ / NDK)   │  │ (Kotlin + C++) │  │ (Kotlin/Rust)  │  │                  │
│ 隐式层拦截     │  │ LSPosed/Zygisk │  │ 资源重定向      │  │                  │
└───────────────┘  └────────────────┘  └────────────────┘  └──────────────────┘
        │                   │                   │
        └───────────────────┴───────────────────┘
                            ▼
                  目标游戏进程 (Unity / Vulkan)
```

## 9.3 仓库模块地图

| 路径 | 语言 | 职责 | 状态 |
| --- | --- | --- | --- |
| `native/crates/efml-core` | Rust | 领域模型：manifest / IR / identify / package / checksum / version / routes | 可用，有单测 |
| `native/crates/efml-cli` | Rust | `efml` 命令：validate / info / list / checksum / routes / tui | 可用，有单测 |
| `native/crates/efml-gui` | Rust + Web | 混合架构 GUI：axum 本地服务 + 静态 Web UI | 可用，有单测 |
| `vulkan-layer/` | C++17 | Vulkan 隐式层骨架：入口协商、dispatch table、拦截转发、统计导出 | 骨架 |
| `android/manager-app` | Kotlin | 管理器 App：浏览 mod、校验、安装层/模块 | 骨架 |
| `android/lsposed-module` | Kotlin + C++ | IL2CPP hook 模块 | 骨架 |
| `mods/example-mod` | — | 格式规范的参考 mod 包 | 示例 |

## 9.4 后端 ABI（待定，M2 前冻结）

IR 与后端之间的契约。**当前尚未冻结**，此处记录设计意图：

| 概念 | Vulkan 层后端 | IL2CPP 后端 | AssetBundle 后端 |
| --- | --- | --- | --- |
| `Identify::PipelineHash` | 流水线指纹匹配 | — | — |
| `Identify::VertexSignature` | 顶点布局匹配 | 辅助确认 | — |
| `Identify::UnityPath` | — | 对象路径匹配 | — |
| `Identify::AssetPath` | — | — | 资源路径匹配 |
| `MeshReplace` | 拦截 `vkCmdBindVertexBuffers`/`vkCmdBindIndexBuffer`，替换为自建 buffer | hook `Mesh.set_vertices` 等，构造新 Mesh | 替换整包资源 |
| `SkeletonMapping` | 改写 uniform / storage buffer 中的骨骼矩阵 | 写 `Mesh.bindposes` / `SkinnedMeshRenderer.bones` | 不可行 |
| `BlendShape` | 改写形态键 buffer 与权重 | 写 `Mesh.set_blendShapeWeights` | 有限支持 |
| `MaterialOverride` | 改 descriptor set 中的贴图绑定 | 改 `Material` / `Renderer.materials` | 替换材质资源 |
| `hot_reload` | 下一次 draw 生效 | 需重新调用替换 | 需重新加载资源 |

> ⚠️ 未核实：EFMI 中 `vb0`/`ib` 的**确切**语义与 3DMigoto 内部触发器实现细节，
> 见 [02-efmi-anatomy.md](/blog/efml4a-02-efmi-anatomy/) 的标注。上表是基于「图形边界替换数据」
> 这一概念的**类比**，不是逐字段的等价映射。

## 9.5 关键数据流

### 9.5.1 校验流（已实现）

```
Mods/<包名>/mod.toml
   │ efml_core::manifest::ModManifest::load
   ▼
ModManifest ──validate()──► 字段合法性 + IR 语义 + 路径安全性
   │
   │ efml_core::package::ModPackage::open
   ▼
ModPackage ──validate()──► ValidationReport { warnings, checked_files }
           ──verify_checksums()──► sha256 逐文件比对
```

### 9.5.2 执行流（设计意图，M2 前不实现）

```
ModManifest.ir ──► 按后端选择器分组
                      │
                      ├─ vulkan-layer : 编译成 pipeline 指纹表 + buffer 替换表
                      ├─ il2cpp-hook  : 编译成 (类, 方法, 替换数据) 表
                      └─ asset-bundle : 编译成 (资源路径, 替换文件) 表
                                        │
                                        ▼
                              后端在目标进程中按表执行
```

## 9.6 安全边界

| 边界 | 措施 |
| --- | --- |
| mod 包 → 文件系统 | 路径必须相对且不含 `..`，拒绝绝对路径（`validate_relative_path`） |
| mod 包 → 校验和 | `checksums.txt` 可选签名；`..` 与绝对路径同样被拒绝（`parse_checksums`） |
| 前端 → 不可信字符串 | Web UI 一律用 `textContent` 渲染，绝不 `innerHTML`（恶意 mod 名不得执行脚本） |
| GUI 网络面 | 默认仅绑定 `127.0.0.1`，无鉴权但也刻意不对外 |
| CI | `permissions: contents: read`，不使用 `pull_request_target`，不上传构建产物 |
| 仓库可见性 | 进入维护阶段前**强制私有**，见 [08-threat-model.md](/blog/efml4a-08-threat-model/) |

## 9.7 版本与兼容

- **包格式版本**由 `manifest.format_version` 携带，当前 `1`；不匹配直接拒绝。
- **loader 版本**由 `min_loader_version` 的宽松写法表达（裸版本号等价于 `>=`），
  语义与实现见 `efml_core::version`。
- **未知字段一律忽略**（不启用 `deny_unknown_fields`），保证旧 loader 能读新 mod。
  代价是拼写错误的字段会被静默忽略——因此 `efml validate` 的告警是关键防线。

## 9.8 尚未确定的架构问题

1. **后端选择权归谁**：mod 声明 `backends` 是「能力声明」，实际用哪个应由加载器按
   可用性择优。当多个后端都可用且行为不同时的优先级规则尚未定义。
2. **IR 是否需要编译产物缓存**：把 IR 编译成后端动作表有成本，是否需要缓存与失效策略。
3. **管理器 App 与加载器的通信**：当前设想是共享配置文件 + 广播，但跨 root/非 root
   边界的可靠性与安全性（防止任意 app 伪造配置）尚未设计。
4. **多后端并存时的冲突**：同一 mod 被两条后端同时应用会导致重复替换，需要仲裁规则。
