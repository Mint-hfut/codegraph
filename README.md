<div align="center">

# CodeGraph

### Supercharge Claude Code, Cursor, Codex, OpenCode, Hermes Agent, Gemini, Antigravity, and Kiro with Semantic Code Intelligence

**~16% cheaper · ~58% fewer tool calls · 100% local**

### [Documentation & Website →](https://colbymchenry.github.io/codegraph/)

[![npm version](https://img.shields.io/npm/v/@colbymchenry/codegraph.svg)](https://www.npmjs.com/package/@colbymchenry/codegraph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Self-contained](https://img.shields.io/badge/Node.js-bundled%20%C2%B7%20none%20required-brightgreen.svg)](https://nodejs.org/)

[![Windows](https://img.shields.io/badge/Windows-supported-blue.svg)](#supported-platforms)
[![macOS](https://img.shields.io/badge/macOS-supported-blue.svg)](#supported-platforms)
[![Linux](https://img.shields.io/badge/Linux-supported-blue.svg)](#supported-platforms)

[![Claude Code](https://img.shields.io/badge/Claude_Code-supported-blueviolet.svg)](#supported-agents)
[![Cursor](https://img.shields.io/badge/Cursor-supported-blueviolet.svg)](#supported-agents)
[![Codex](https://img.shields.io/badge/Codex-supported-blueviolet.svg)](#supported-agents)
[![opencode](https://img.shields.io/badge/opencode-supported-blueviolet.svg)](#supported-agents)
[![Hermes Agent](https://img.shields.io/badge/Hermes_Agent-supported-blueviolet.svg)](#supported-agents)
[![Gemini](https://img.shields.io/badge/Gemini-supported-blueviolet.svg)](#supported-agents)
[![Antigravity](https://img.shields.io/badge/Antigravity-supported-blueviolet.svg)](#supported-agents)
[![Kiro](https://img.shields.io/badge/Kiro-supported-blueviolet.svg)](#supported-agents)

<br>

**The CodeGraph platform is coming** — for every PR, know exactly what to test, what could break, which flows are affected, and whether business logic is compromised.

<a href="https://getcodegraph.com"><img alt="Join the waitlist for early beta access" src="https://raw.githubusercontent.com/colbymchenry/codegraph/main/assets/waitlist.svg?v=2" height="52"></a>

<sub>Get <b>early beta access</b> to the hosted product · <a href="https://getcodegraph.com">getcodegraph.com</a></sub>

</div>

> [!NOTE]
> 本仓库是 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) 的**增强分支**：
> 在代码知识图谱之上，把 **README/文档、Agent 技能（SKILL.md）、Agent 记忆（CLAUDE.md/AGENTS.md）、
> Dockerfile/Compose、CI workflow、package.json** 也纳入同一张图谱，并与代码高置信互联。
> 详见 [与上游 CodeGraph 的区别](#与上游-codegraph-的区别) 和
> [制品知识图谱更新说明](docs/artifact-knowledge-graph.md)。
> 本分支未发布到 npm，请按下文**从源码安装**。

## 与上游 CodeGraph 的区别

| | 上游 CodeGraph | 本分支 |
|---|---|---|
| **图谱覆盖范围** | 仅代码（tree-sitter 解析的源码符号） | 代码 **+ 项目知识制品**：markdown 文档、Agent 技能/记忆、Dockerfile/Containerfile、docker-compose、GitHub Actions workflow、package.json，以及**只记名字的二进制资产**（图片/视频/PDF 等，内容零读取） |
| **节点类型** | 22 种代码 NodeKind | 新增 `document`（语义类型：readme / skill / command / memory / doc / dockerfile / compose / workflow / package-manifest / asset）与 `section`（标题层级 / 构建 stage / service / CI job / npm script） |
| **文档 ↔ 代码连边** | 无 | 高置信 `references` 边：文档中的显式文件路径、全图唯一的符号名才连边，**歧义一律不连**（错边比没边更糟），边带 `resolvedBy: 'doc-mention'` 可审计 |
| **项目外知识（skills/记忆）** | 无 | `.codegraph/config.json` 的 `extraRoots` 可挂载 `~/.claude/skills`、用户级 `CLAUDE.md` 等项目外目录/文件，以 `~extra/…` 虚拟路径入图，实时监听与同步同样生效 |
| **Skill 强关联** | 无 | `SKILL.md` 自动连边到同目录全部文件（脚本、参考文档）——问一个 skill，整个捆绑包一起出 |
| **Skill/命令结构化** | 无 | skill 与 slash 命令（`.claude/commands/*.md`）的 frontmatter 入图：触发条件（"Use when…"）、`allowed-tools`、`argument-hint`、`model` 折叠进可搜索文本——"哪个 skill 负责发版""哪个命令收 base-branch 参数"可直接命中 |
| **搜索排序** | 统一按符号种类加权 | 知识文件按语义类型再加权：**memory > skill = command > readme > 普通 doc**，常驻指令优先浮出 |
| **Agent 能回答的问题** | "X 是怎么工作的"等代码结构/流程问题 | 额外支持 "README 里关于部署是怎么说的" "哪个 skill 负责发版" "CLAUDE.md 对测试有什么要求" "改这个函数会影响哪些文档/CI" |
| **实时更新** | 代码文件改动 ~1s 入图 | 同一管线覆盖制品文件——改完 `CLAUDE.md`/`SKILL.md` 约 1 秒后图谱即最新 |
| **安装方式** | npm / 一键安装脚本（预编译 bundle） | 从源码构建（见下文），其余 `codegraph install` / `init` 用法与上游一致 |
| **索引版本** | EXTRACTION_VERSION 14 | 17（存量索引会提示重建，`codegraph index -f` 即可） |

架构、原理与扩展方法详见 [docs/artifact-knowledge-graph.md](docs/artifact-knowledge-graph.md)。

## Get Started

### 1. 从源码安装 CLI

本分支未发布到 npm，需要从源码构建（要求 **Node.js ≥ 18 且 < 25**）：

```bash
git clone https://github.com/Mint-hfut/codegraph.git
cd codegraph
npm ci            # 安装依赖
npm run build     # 编译到 dist/（含 schema 与 tree-sitter wasm 资源）
npm link          # 把 codegraph 命令注册到全局 PATH（Linux/macOS 可能需要 sudo）
```

验证安装：

```bash
codegraph --version
```

<sub>不想 `npm link` 污染全局？也可以直接用 `node /path/to/codegraph/dist/bin/codegraph.js` 调用，或在 MCP 配置里把 `command` 指向该路径。</sub>

<sub>**升级方式**：在仓库目录 `git pull && npm ci && npm run build` 即可（上游的 `codegraph upgrade` 命令走的是上游 npm/bundle 发布渠道，**在本分支不要使用**）。升级后在各项目里跑 `codegraph index -f` 重建索引以获得新版引擎的覆盖。</sub>

### 2. Wire up your agent(s)

In a **new terminal**, run the installer to connect CodeGraph to the agents you use:

```bash
codegraph install
```

<sub>Detects and auto-configures Claude Code, Cursor, Codex CLI, opencode, Hermes Agent, Gemini CLI, Antigravity IDE, and Kiro — wiring the CodeGraph MCP server into each. **This is the step that connects CodeGraph to your agent;** installing the CLI in step 1 does not do it on its own.</sub>

### 3. Initialize each project

```bash
cd your-project
codegraph init -i
```

<sub>`codegraph init` just creates the local `.codegraph/` index directory; adding `-i` (`--index`) also builds the initial graph in the same step. Without `-i`, run `codegraph index` afterwards to populate it.</sub>

<div align="center">

![1_C_VYnhpys0UHrOuOgpgoyw](https://github.com/user-attachments/assets/f168182f-4d9a-44e0-94d7-08d018cc8a3a)

</div>

### Uninstall

Changed your mind? One command removes CodeGraph from every agent it configured:

```bash
codegraph uninstall
```

<sub>Reverses the installer — strips CodeGraph's MCP server config, instructions, and permissions from each configured agent. Your project indexes (`.codegraph/`) are left untouched; remove those per-project with `codegraph uninit`. Use `--target` to remove from specific agents, or `--yes` to run non-interactively.</sub>

---

## Why CodeGraph?

When Claude Code explores a codebase, it spawns **Explore agents** that scan files with grep, glob, and Read — consuming tokens on every tool call.

**CodeGraph gives those agents a pre-indexed knowledge graph** — symbol relationships, call graphs, and code structure. Agents query the graph instantly instead of scanning files.

### Benchmark Results

Tested across **7 real-world open-source codebases** spanning 7 languages, comparing an agent (Claude Code, headless) answering one architecture question **with** and **without** CodeGraph. Each cell is the savings at the **median of 4 runs per arm**. _Re-validated on Opus 4.8 (2026-06-02), on the current build (`codegraph_explore` as the primary tool)._

> **Average: 16% cheaper · 47% fewer tokens · 22% faster · 58% fewer tool calls**

| Codebase | Language | Cost | Tokens | Time | Tool calls |
|----------|----------|------|--------|------|------------|
| **VS Code** | TypeScript · ~10k files | 18% cheaper | 64% fewer | 11% faster | 81% fewer |
| **Excalidraw** | TypeScript · ~640 | even | 25% fewer | 27% faster | 40% fewer |
| **Django** | Python · ~3k | 8% cheaper | 60% fewer | 13% faster | 77% fewer |
| **Tokio** | Rust · ~790 | even | 38% fewer | 18% faster | 57% fewer |
| **OkHttp** | Java · ~645 | 25% cheaper | 54% fewer | 31% faster | 50% fewer |
| **Gin** | Go · ~110 | 19% cheaper | 23% fewer | 24% faster | 44% fewer |
| **Alamofire** | Swift · ~110 | 40% cheaper | 64% fewer | 33% faster | 58% fewer |

CodeGraph cuts **tokens, tool calls, and wall-clock time on every repo** — across small, medium, and large codebases — and answers them with **near-zero file reads**, while the no-CodeGraph agent spends its budget on grep/find/Read discovery. `codegraph_explore` shows the answer in full — the mechanism plus the exact methods you asked about, even when they're buried in a multi-thousand-line file — while collapsing redundant interchangeable implementations to signatures, so the response is sized to the *answer* rather than the file count. **Cost stays flat-to-cheaper everywhere** — largest on the small repos (Alamofire, OkHttp), roughly break-even on the most response-heavy ones (Excalidraw, Tokio), where CodeGraph trades the no-CodeGraph agent's many small grep/read round-trips for a few large, cache-heavy tool responses.

<details>
<summary><strong>Per-repo breakdown — WITH vs WITHOUT (median of 4)</strong></summary>

**VS Code** · ~10k files
| Metric | WITH cg | WITHOUT cg | Δ |
|---|---|---|---|
| Time | 1m 59s | 2m 13s | 11% faster |
| File Reads | 0 | 9 | −9 |
| Grep/Bash | 0 | 11 | −11 |
| Tool calls | 4 | 21 | 81% fewer |
| Total tokens | 640k | 1.79M | 64% fewer |
| Cost | $0.68 | $0.83 | 18% cheaper |

**Excalidraw** · ~640 files
| Metric | WITH cg | WITHOUT cg | Δ |
|---|---|---|---|
| Time | 1m 32s | 2m 6s | 27% faster |
| File Reads | 0 | 7 | −7 |
| Grep/Bash | 1 | 8 | −7 |
| Tool calls | 9 | 15 | 40% fewer |
| Total tokens | 1.27M | 1.69M | 25% fewer |
| Cost | $0.78 | $0.78 | even |

**Django** · ~3k files
| Metric | WITH cg | WITHOUT cg | Δ |
|---|---|---|---|
| Time | 1m 43s | 1m 58s | 13% faster |
| File Reads | 0 | 9 | −9 |
| Grep/Bash | 0 | 5 | −5 |
| Tool calls | 3 | 13 | 77% fewer |
| Total tokens | 559k | 1.41M | 60% fewer |
| Cost | $0.57 | $0.62 | 8% cheaper |

**Tokio** · ~790 files
| Metric | WITH cg | WITHOUT cg | Δ |
|---|---|---|---|
| Time | 1m 55s | 2m 20s | 18% faster |
| File Reads | 0 | 8 | −8 |
| Grep/Bash | 0 | 6 | −6 |
| Tool calls | 6 | 14 | 57% fewer |
| Total tokens | 1.08M | 1.73M | 38% fewer |
| Cost | $0.82 | $0.82 | even |

**OkHttp** · ~645 files
| Metric | WITH cg | WITHOUT cg | Δ |
|---|---|---|---|
| Time | 1m 1s | 1m 29s | 31% faster |
| File Reads | 0 | 4 | −4 |
| Grep/Bash | 2 | 6 | −4 |
| Tool calls | 5 | 10 | 50% fewer |
| Total tokens | 502k | 1.10M | 54% fewer |
| Cost | $0.41 | $0.55 | 25% cheaper |

**Gin** · ~110 files
| Metric | WITH cg | WITHOUT cg | Δ |
|---|---|---|---|
| Time | 1m 14s | 1m 37s | 24% faster |
| File Reads | 1 | 6 | −5 |
| Grep/Bash | 1 | 2 | −1 |
| Tool calls | 5 | 9 | 44% fewer |
| Total tokens | 651k | 847k | 23% fewer |
| Cost | $0.46 | $0.57 | 19% cheaper |

**Alamofire** · ~110 files
| Metric | WITH cg | WITHOUT cg | Δ |
|---|---|---|---|
| Time | 1m 35s | 2m 21s | 33% faster |
| File Reads | 0 | 9 | −9 |
| Grep/Bash | 0 | 4 | −4 |
| Tool calls | 5 | 12 | 58% fewer |
| Total tokens | 766k | 2.10M | 64% fewer |
| Cost | $0.57 | $0.95 | 40% cheaper |

</details>

<details>
<summary><strong>Full benchmark details</strong></summary>

**Methodology.** Each arm is `claude -p` (Claude Opus 4.8) run headlessly against the repo with `--strict-mcp-config`: **WITH** = CodeGraph's MCP server enabled, **WITHOUT** = an empty MCP config. Built-in Read/Grep/Bash stay available to both. Same question per repo, **4 runs per arm, median reported**. Cost = the run's `total_cost_usd`; Tokens = total tokens processed (input incl. cached + output); Time = wall-clock; Tool calls = every tool invocation, including those inside any sub-agents the model spawns. Repos cloned at `--depth 1` and indexed by the same CodeGraph build that served them. Re-validated 2026-06-02 on the current build. These numbers are lower than the prior Opus 4.7 validation — not a CodeGraph regression but a stronger native baseline: Opus 4.8 greps/reads efficiently on the main thread instead of fanning out into large Explore-subagent sweeps, so the no-CodeGraph arm is leaner than it used to be. Per-repo numbers move run-to-run with how hard the without-arm thrashes (the median-of-4 smooths it, but tails remain — e.g. Django's without-arm hit $2.71/14m one batch).

**Queries:**
| Codebase | Query |
|----------|-------|
| VS Code | "How does the extension host communicate with the main process?" |
| Excalidraw | "How does Excalidraw render and update canvas elements?" |
| Django | "How does Django's ORM build and execute a query from a QuerySet?" |
| Tokio | "How does tokio schedule and run async tasks on its runtime?" |
| OkHttp | "How does OkHttp process a request through its interceptor chain?" |
| Gin | "How does gin route requests through its middleware chain?" |
| Alamofire | "How does Alamofire build, send, and validate a request?" |

**Why CodeGraph wins:** with the index available, the agent answers directly — usually one `codegraph_explore` returns the relevant source — and stops, usually with zero file reads. Without it, the agent spends most of its budget on discovery (find/ls/grep) before reading the right code. CodeGraph only helps when queried *directly*, so its instructions steer agents to answer directly rather than delegate exploration to file-reading sub-agents — otherwise a sub-agent reads files regardless and CodeGraph becomes overhead.

</details>

---

## Key Features

| | |
|---|---|
| **Smart Context Building** | One tool call returns entry points, related symbols, and code snippets — no expensive exploration agents |
| **Full-Text Search** | Find code by name instantly across your entire codebase, powered by FTS5 |
| **Impact Analysis** | Trace callers, callees, and the full impact radius of any symbol before making changes |
| **Always Fresh** | File watcher uses native OS events (FSEvents/inotify/ReadDirectoryChangesW) with debounced auto-sync — the graph stays current as you code, zero config |
| **20+ Languages** | TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, C, C++, Objective-C, Swift, Kotlin, Dart, Lua, Luau, Svelte, Liquid, Pascal/Delphi |
| **项目知识图谱（本分支新增）** | README/markdown 文档、Agent 技能（SKILL.md，含同目录捆绑包强关联）与记忆（CLAUDE.md/AGENTS.md，搜索权重更高）、Dockerfile/Compose、CI workflow、package.json、二进制资产（只记名字）与代码同图，文档↔代码高置信互联；`extraRoots` 支持索引项目外的全局技能/记忆 — [详情](docs/artifact-knowledge-graph.md) |
| **Framework-aware Routes** | Recognizes web-framework routing files and links URL patterns to their handlers across 14 frameworks |
| **Mixed iOS / React Native / Expo** | Closes cross-language flows that static parsing misses: Swift ↔ ObjC bridging, React Native legacy bridge + TurboModules + Fabric view components, native → JS event emitters, Expo Modules |
| **100% Local** | No data leaves your machine. No API keys. No external services. SQLite database only |

<details>
<summary><strong>How auto-syncing works — and why you don't need to run <code>codegraph sync</code> manually</strong></summary>

When your agent (Claude Code, Cursor, Codex, opencode) launches `codegraph serve --mcp`, three layers keep the index in step with your code — and make sure the agent never gets a silent wrong answer in the brief window between an edit and the next sync:

1. **File watcher with debounced auto-sync.** A native FSEvents / inotify / ReadDirectoryChangesW watcher captures every source-file create / modify / delete and triggers a re-index after a debounce window (default `2000ms`, tunable via `CODEGRAPH_WATCH_DEBOUNCE_MS`, clamped to `[100ms, 60s]`). Bursts of edits collapse into a single sync.

2. **Per-file staleness banner.** During the brief debounce window, MCP tool responses that would reference a still-pending file prepend a `⚠️` banner naming it and telling the agent to `Read` it directly. Pending files NOT referenced by the response surface as a small footer instead. Either way, the agent gets an explicit signal — validated with Claude Code, where the agent literally says "Reading the file directly for the live content" before opening it.

3. **Connect-time catch-up.** When the MCP server (re)connects, codegraph runs a fast `(size, mtime)` + content-hash reconciliation against the working tree before answering the first query — so edits made while no MCP server was running (a `git pull` from the terminal, edits from another editor, a previous agent session that exited) get absorbed on the next session's first tool call.

```
agent writes src/Widget.ts
  → watcher fires (<100ms)
  → debounce (default 2s)
  → sync; Widget.ts is in the index
  → next agent query sees it
```

**Verify any time** with `codegraph_status` (via MCP) or `codegraph status` (CLI). If anything is pending, you'll see a `### Pending sync:` section naming the files and their edit age.

The handful of cases where manual `codegraph sync` makes sense: the watcher is disabled (sandboxed environments, or `CODEGRAPH_NO_DAEMON=1`), or you're scripting against the index outside an agent session and want a pre-flight sync at the start of your script.

→ Full deep-dive in [Guides → Indexing a Project](https://colbymchenry.github.io/codegraph/guides/indexing/#stay-fresh-automatically).

</details>

---

## Framework-aware Routes

CodeGraph detects web-framework routing files and emits `route` nodes linked by `references` edges to their handler classes or functions. Querying callers of a view/controller now surfaces the URL pattern that binds it.

| Framework | Shapes recognized |
|---|---|
| **Django** | `path()`, `re_path()`, `url()`, `include()` in `urls.py` (CBV `.as_view()`, dotted paths) |
| **Flask** | `@app.route('/path', methods=[...])`, blueprint routes |
| **FastAPI** | `@app.get(...)`, `@router.post(...)`, all standard methods |
| **Express** | `app.get(...)`, `router.post(...)` with middleware chains |
| **NestJS** | `@Controller` + `@Get/@Post/...`, GraphQL `@Resolver` + `@Query/@Mutation`, `@MessagePattern`/`@EventPattern`, `@SubscribeMessage` |
| **Laravel** | `Route::get()`, `Route::resource()`, `Controller@action`, tuple syntax |
| **Drupal** | `*.routing.yml` routes (`_controller`, `_form`, entity handlers); `hook_*` implementations in `.module`/`.theme`/`.install`/`.inc` |
| **Rails** | `get '/x', to: 'users#index'`, hash-rocket `=>` syntax |
| **Spring** | `@GetMapping`, `@PostMapping`, `@RequestMapping` on methods |
| **Gin / chi / gorilla / mux** | `r.GET(...)`, `router.HandleFunc(...)` |
| **Axum / actix / Rocket** | `.route("/x", get(handler))` |
| **ASP.NET** | `[HttpGet("/x")]` attributes on action methods |
| **Vapor** | `app.get("x", use: handler)` |
| **React Router** / **SvelteKit** | Route component nodes |

---

## Mixed iOS / React Native / Expo bridging

Real iOS and React Native codebases live across multiple languages — a Swift caller invokes an Objective-C selector that's been auto-bridged, a JS file calls into a native module via the React Native bridge, a JSX component delegates to a native view manager. Static tree-sitter extraction stops at each language boundary. CodeGraph bridges them so `trace`, `callers`, `callees`, and `impact` connect end-to-end across the gap.

| Boundary | JS / Swift side | Native side | How |
|---|---|---|---|
| **Swift → ObjC** | Swift `obj.foo(bar:)` | ObjC selector `-fooWithBar:` | `@objc` auto-bridging rules (including init/property/protocol forms) + Cocoa preposition prefixes (`With`/`For`/`By`/`In`/`On`/`At`/…) |
| **ObjC → Swift** | ObjC `[obj fooWithBar:]` | Swift `@objc func foo(bar:)` | Reverse-bridge name candidates; verifies `@objc` exposure from source |
| **React Native legacy bridge** | JS `NativeModules.X.fn(...)` | ObjC `RCT_EXPORT_METHOD` / `RCT_REMAP_METHOD` · Java/Kotlin `@ReactMethod` | Parses macro/annotation declarations to build a JS-name → native-method map |
| **React Native TurboModules** | JS `import M from './NativeM'; M.fn(...)` | Native impl matching the Codegen spec | Treats the `Native<X>.ts` spec interface as ground truth |
| **RN native → JS events** | JS `new NativeEventEmitter(...).addListener('e', cb)` | ObjC `[self sendEventWithName:@"e" body:...]` · Swift `sendEvent(withName: "e", ...)` · Java/Kotlin `.emit("e", ...)` | Synthesized cross-language event channel keyed by literal event name |
| **Expo Modules** | JS `requireNativeModule('X').fn(...)` | Swift / Kotlin `Module { Name("X"); AsyncFunction("fn") { ... } }` | Parses the Expo DSL literals; synthetic method nodes resolve via existing name-match |
| **Fabric view components** | JSX `<MyView prop={v}/>` | TS Codegen spec + native impl class | Spec → `component` node; convention-based name+suffix lookup (`View`/`ComponentView`/`Manager`/`ViewManager`) bridges to native |
| **Legacy Paper view managers** | JSX `<MyView prop={v}/>` | ObjC `RCT_EXPORT_VIEW_PROPERTY` · Java/Kotlin `@ReactProp` | Same as Fabric — Paper-era declarations also produce `component` + `property` nodes |

**Validated on real codebases** (small + medium + large for each bridge):

| Bridge | Small | Medium | Large |
|---|---|---|---|
| Swift ↔ ObjC | [Charts](https://github.com/danielgindi/Charts) | [realm-swift](https://github.com/realm/realm-swift) | [Wikipedia-iOS](https://github.com/wikimedia/wikipedia-ios) |
| RN legacy bridge | [AsyncStorage](https://github.com/react-native-async-storage/async-storage) | [react-native-svg](https://github.com/software-mansion/react-native-svg) | [react-native-firebase](https://github.com/invertase/react-native-firebase) |
| RN native → JS events | [RNGeolocation](https://github.com/Agontuk/react-native-geolocation-service) | — | react-native-firebase |
| Expo Modules | expo-haptics | expo-camera | expo SDK sweep (7 packages) |
| Fabric / Paper views | [react-native-segmented-control](https://github.com/react-native-segmented-control/segmented-control) | [react-native-screens](https://github.com/software-mansion/react-native-screens) | [react-native-skia](https://github.com/Shopify/react-native-skia) |

Each bridge emits edges tagged `provenance:'heuristic'` with `metadata.synthesizedBy:` set to a stable channel name (e.g. `swift-objc-bridge`, `rn-event-channel`, `fabric-native-impl`, `expo-module-extract`), so the agent can tell at a glance how a hop got into the graph.

---

## Quick Start

### 1. Run the Installer

完成[从源码安装](#1-从源码安装-cli)后，运行交互式安装器把 CodeGraph 接入你的 agent：

```bash
codegraph install
```

The installer will:
- Ask which agent(s) to configure — auto-detects installed ones from: **Claude Code**, **Cursor**, **Codex CLI**, **opencode**, **Hermes Agent**, **Gemini CLI**, **Antigravity IDE**, **Kiro**
- Prompt to install `codegraph` on your PATH (so agents can launch the MCP server)
- Ask whether configs apply to all your projects or just this one
- Write each chosen agent's MCP server config (the codegraph usage guide is delivered by the MCP server itself, so no instructions file is added to `CLAUDE.md` / `AGENTS.md` / etc.)
- Set up auto-allow permissions when Claude Code is one of the targets
- Initialize your current project (local installs only)

**Non-interactive (scripting / CI):**

```bash
codegraph install --yes                              # auto-detect agents, install global
codegraph install --target=cursor,claude --yes       # explicit target list
codegraph install --target=auto --location=local     # detected agents, project-local
codegraph install --print-config codex               # print snippet, no file writes
```

| Flag | Values | Default |
|---|---|---|
| `--target` | `auto`, `all`, `none`, or csv (`claude,cursor,...`) | prompt |
| `--location` | `global`, `local` | prompt |
| `--yes` | (boolean) | prompt every step |
| `--no-permissions` | (boolean) skip Claude auto-allow list | permissions on |
| `--print-config <id>` | dump snippet for one agent and exit | — |

### 2. Restart Your Agent

Restart your agent (Claude Code / Cursor / Codex CLI / opencode / Hermes Agent / Gemini CLI / Antigravity IDE / Kiro) for the MCP server to load.

### 3. Initialize Projects

```bash
cd your-project
codegraph init -i
```

Builds the per-project knowledge graph index. A single global `codegraph install` works in every project you open — no need to re-run the installer per project.

That's it — your agent will use CodeGraph tools automatically when a `.codegraph/` directory exists.

<details>
<summary><strong>Manual Setup (Alternative)</strong></summary>

**先完成[从源码安装](#1-从源码安装-cli)**（`npm link` 后 `codegraph` 命令全局可用；
不想 link 的话，把下面配置里的 `command` 换成 `node`、`args` 换成
`["/path/to/codegraph/dist/bin/codegraph.js", "serve", "--mcp"]`）。

**Add to `~/.claude.json`:**
```json
{
  "mcpServers": {
    "codegraph": {
      "type": "stdio",
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

**Add to `~/.claude/settings.json` (optional, for auto-allow):**
```json
{
  "permissions": {
    "allow": [
      "mcp__codegraph__codegraph_search",
      "mcp__codegraph__codegraph_explore",
      "mcp__codegraph__codegraph_callers",
      "mcp__codegraph__codegraph_callees",
      "mcp__codegraph__codegraph_impact",
      "mcp__codegraph__codegraph_node",
      "mcp__codegraph__codegraph_status",
      "mcp__codegraph__codegraph_files"
    ]
  }
}
```

</details>

<details>
<summary><strong>Agent Tool Guidance</strong></summary>

CodeGraph's MCP server delivers its usage guidance to your agent **automatically**, in the MCP `initialize` response — there's no instructions file to manage and nothing is added to your `CLAUDE.md` / `AGENTS.md` / `GEMINI.md`. In short, it tells the agent to:

- **Answer structural questions directly with CodeGraph** — it *is* the pre-built index, so a grep/read loop just repeats work it already did. Treat the returned source as already read.
- **Pick the tool by intent:** `codegraph_explore` for almost anything — "how does X work", a flow/"how does X reach Y", or surveying an area (one call returns the relevant symbols' source grouped by file); `codegraph_search` to just locate a symbol; `codegraph_callers`/`codegraph_callees` to walk call flow; `codegraph_impact` before editing; `codegraph_node` for one specific symbol's full source (it returns every overload for an ambiguous name).
- **Trust the results — don't re-verify with grep**, and check the staleness banner after edits.
- If `.codegraph/` doesn't exist yet, offer to run `codegraph init -i`.

The exact text is `src/mcp/server-instructions.ts` — the single source of truth.

</details>

---

## How It Works

```
┌───────────────────────────────────────────────────────────────────┐
│                            Claude Code                            │
│                                                                   │
│   "How does a request reach the database?"                        │
│       calls CodeGraph tools directly — no Explore sub-agent       │
│                                 │                                 │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                        CodeGraph MCP Server                       │
│                                                                   │
│       explore · search · callers · callees · impact · node        │
│                                 │                                 │
│                                 ▼                                 │
│                       SQLite knowledge graph                      │
│          symbols · edges · files · FTS5 full-text search          │
└───────────────────────────────────────────────────────────────────┘
```

1. **Extraction** — [tree-sitter](https://tree-sitter.github.io/) parses source code into ASTs. Language-specific queries extract nodes (functions, classes, methods) and edges (calls, imports, extends, implements).

2. **Storage** — Everything goes into a local SQLite database (`.codegraph/codegraph.db`) with FTS5 full-text search.

3. **Resolution** — After extraction, references are resolved: function calls → definitions, imports → source files, class inheritance, and framework-specific patterns.

4. **Auto-Sync** — The MCP server watches your project using native OS file events. Changes are debounced (2-second quiet window), filtered to source files only, and incrementally synced. The graph stays fresh as you code — no configuration needed.

---

## CLI Reference

```bash
codegraph                         # Run interactive installer
codegraph install                 # Run installer (explicit)
codegraph uninstall               # Remove CodeGraph from your agents (inverse of install)
codegraph init [path]             # Initialize in a project (--index to also index)
codegraph uninit [path]           # Remove CodeGraph from a project (--force to skip prompt)
codegraph index [path]            # Full index (--force to re-index, --quiet for less output)
codegraph sync [path]             # Incremental update
codegraph status [path]           # Show statistics
codegraph query <search>          # Search symbols (--kind, --limit, --json)
                                  #   --kind document / section 可检索文档、技能、记忆、CI 等制品节点
                                  #   例: codegraph query "release" --kind document
codegraph files [path]            # Show file structure (--format, --filter, --max-depth, --json)
codegraph callers <symbol>        # Find what calls a function/method (--limit, --json)
codegraph callees <symbol>        # Find what a function/method calls (--limit, --json)
codegraph impact <symbol>         # Analyze what code is affected by changing a symbol (--depth, --json)
codegraph affected [files...]     # Find test files affected by changes (see below)
codegraph serve --mcp             # Start MCP server
codegraph upgrade [version]       # Update to the latest release (--check, --force)
```

### `codegraph affected`

Traces import dependencies transitively to find which test files are affected by changed source files.

```bash
codegraph affected src/utils.ts src/api.ts         # Pass files as arguments
git diff --name-only | codegraph affected --stdin   # Pipe from git diff
codegraph affected src/auth.ts --filter "e2e/*"     # Custom test file pattern
```

| Option | Description | Default |
|--------|-------------|---------|
| `--stdin` | Read file list from stdin | `false` |
| `-d, --depth <n>` | Max dependency traversal depth | `5` |
| `-f, --filter <glob>` | Custom glob to identify test files | auto-detect |
| `-j, --json` | Output as JSON | `false` |
| `-q, --quiet` | Output file paths only | `false` |

**CI/hook example:**

```bash
#!/usr/bin/env bash
AFFECTED=$(git diff --name-only HEAD | codegraph affected --stdin --quiet)
if [ -n "$AFFECTED" ]; then
  npx vitest run $AFFECTED
fi
```

---

## MCP Tools

When running as an MCP server, CodeGraph exposes these tools to Claude Code:

| Tool | Purpose |
|------|---------|
| `codegraph_explore` | **Primary.** Answer almost any question in one call — "how does X work", a flow ("how does X reach Y"), or surveying an area — returning the relevant symbols' verbatim source grouped by file, plus a relationship map and blast radius. Surfaces dynamic-dispatch hops (callbacks, React re-render, interface→impl) grep can't follow. |
| `codegraph_search` | Find symbols by name across the codebase |
| `codegraph_callers` | Find what calls a function |
| `codegraph_callees` | Find what a function calls |
| `codegraph_impact` | Analyze what code is affected by changing a symbol |
| `codegraph_node` | Get one specific symbol's details + full source (returns every overload for an ambiguous name) |
| `codegraph_files` | Get indexed file structure (faster than filesystem scanning) |
| `codegraph_status` | Check index health and statistics |

### 查询项目知识（本分支新增）

本分支的图谱还包含**项目知识制品**——README/markdown 文档、Agent 技能（`SKILL.md`）、
Agent 记忆（`CLAUDE.md`/`AGENTS.md`/Cursor 规则）、Dockerfile/Compose、CI workflow、
`package.json`——它们以 `document`/`section` 节点的形式与代码同图，**无需任何新工具**，
agent 用同样的 `codegraph_explore` / `codegraph_search` 即可命中。直接向 agent 提问：

- "README 里关于部署是怎么说的？"
- "哪个 skill 负责发版流程？"
- "CLAUDE.md 对测试有什么要求？"
- "这个 Dockerfile 分几个构建 stage、打包了哪些文件？"
- "改 `prepare-release.mjs` 会影响哪些文档和 CI job？"（文档→代码的 `references` 边反查）

`codegraph_search` 的 `kind` 参数支持 `document` / `section` 过滤。文档中显式提到的文件
路径和**全图唯一**的符号名会连边到对应代码节点；歧义提及一律不连（错边比没边更糟）。
记忆文件在搜索排序中权重高于普通文档（memory > skill = command > readme > doc）；skill
与 slash 命令的 frontmatter（触发条件、`allowed-tools`、`argument-hint`、`model`）折叠进
可搜索文本，所以"哪个 skill 负责发版""哪个命令收某参数"可直接命中；图片/视频/PDF
等二进制资产**只索引名字**（内容零读取），README 里的图片链接会连到对应资产节点。

**项目外的技能与记忆**（如 `~/.claude/skills`、用户级 `CLAUDE.md`）也能入图——在
`.codegraph/config.json` 中声明 `extraRoots`：

```json
{
  "extraRoots": [
    "~/.claude/skills",
    { "path": "~/.claude/CLAUDE.md", "name": "global-memory" }
  ]
}
```

这些文件以 `~extra/<name>/…` 虚拟路径进入图谱，实时监听、增量同步、搜索与取内容全部照常；
凭证目录（`~/.ssh`、`~/.aws` 等）即使写进配置也会被拒绝。修改配置后在下次打开项目时生效。
详见 [docs/artifact-knowledge-graph.md](docs/artifact-knowledge-graph.md)。

---

## Library Usage

CodeGraph can be embedded directly. 本分支未发布到 npm，在你的项目里通过
本地路径或 `npm link` 引入（API 与上游一致）：

```bash
npm i /path/to/codegraph     # 本地路径依赖；或在本仓库 npm link 后 npm link @colbymchenry/codegraph
```

```typescript
import CodeGraph from '@colbymchenry/codegraph';
// CommonJS works too:
//   const { CodeGraph } = require('@colbymchenry/codegraph');

const cg = await CodeGraph.init('/path/to/project');
// Or: const cg = await CodeGraph.open('/path/to/project');

await cg.indexAll({
  onProgress: (p) => console.log(`${p.phase}: ${p.current}/${p.total}`)
});

const results = cg.searchNodes('UserService');
const callers = cg.getCallers(results[0].node.id);
const context = await cg.buildContext('fix login bug', { maxNodes: 20, includeCode: true, format: 'markdown' });
const impact = cg.getImpactRadius(results[0].node.id, 2);

cg.watch();   // auto-sync on file changes
cg.unwatch(); // stop watching
cg.close();
```

Lower-level building blocks are exported from the same entry point for callers
that drive the graph directly: `DatabaseConnection`, `QueryBuilder`,
`getDatabasePath`, `initGrammars` / `loadGrammarsForLanguages`, and `FileLock`.

**Embedding requirements**

- 先在本仓库执行 `npm run build`（本地路径依赖解析到 `dist/` 产物）。
- The API runs on **your** runtime, so it needs **Node 22.5+** for the built-in
  `node:sqlite` (Electron qualifies when its bundled Node is 22.5+). The CLI and
  MCP server are unaffected — they run on the self-contained bundled runtime.
- TypeScript types ship with the package. As with any Node-targeting library,
  keep `@types/node` available and `skipLibCheck: true` (the common default).

---

## Configuration

There isn't any — CodeGraph is zero-config, with **no config file** to write or
keep in sync. Language support is automatic from the file extension; there's
nothing to wire up per language.

What it skips out of the box:

- **Dependency, build, and cache directories** — `node_modules`, `vendor`,
  `dist`, `build`, `target`, `.venv`, `Pods`, `.next`, and the like across every
  [supported stack](#supported-languages) — so the graph is your code, not
  third-party noise. This holds even with no `.gitignore`.
- **Anything in your `.gitignore`** — honored in git repos via git, and in
  non-git projects by reading `.gitignore` directly (root and nested).
- **Files larger than 1 MB** — generated bundles, minified JS, vendored blobs.

To keep something else out, add it to `.gitignore`. To pull a default-excluded
directory back **in** (say you really do want a vendored dependency indexed),
add a negation — `!vendor/`. The defaults apply uniformly, so committing a
dependency or build directory doesn't force it into the graph; the `.gitignore`
negation is the explicit opt-in.

## Supported Platforms

Every release ships a self-contained build (bundled Node runtime — nothing to
compile) for all three desktop OSes, on both Intel/AMD (x64) and ARM (arm64):

| Platform | Architectures | Install |
|----------|---------------|---------|
| Windows | x64, arm64 | PowerShell installer or npm |
| macOS | x64, arm64 | shell installer or npm |
| Linux | x64, arm64 | shell installer or npm |

See [Get Started](#get-started) for the one-line install commands.

## Supported Agents

The interactive installer auto-detects and configures each of these — wiring up
the MCP server (which delivers its own usage guidance, so no instructions file
is written):

- **Claude Code**
- **Cursor**
- **Codex CLI**
- **opencode**
- **Hermes Agent**
- **Gemini CLI**
- **Antigravity IDE**
- **Kiro**

## Supported Languages

| Language | Extension | Status |
|----------|-----------|--------|
| TypeScript | `.ts`, `.tsx` | Full support |
| JavaScript | `.js`, `.jsx`, `.mjs` | Full support |
| Python | `.py` | Full support |
| Go | `.go` | Full support |
| Rust | `.rs` | Full support |
| Java | `.java` | Full support |
| C# | `.cs` | Full support |
| PHP | `.php` | Full support |
| Ruby | `.rb` | Full support |
| C | `.c`, `.h` | Full support |
| C++ | `.cpp`, `.hpp`, `.cc` | Full support |
| Objective-C | `.m`, `.mm`, `.h` | Partial support (classes, protocols, methods, `@property`, `#import`, message sends; `.mm` ObjC++ may parse incompletely) |
| Swift | `.swift` | Full support |
| Kotlin | `.kt`, `.kts` | Full support |
| Scala | `.scala`, `.sc` | Full support (classes, traits, methods, type aliases, Scala 3 enums) |
| Dart | `.dart` | Full support |
| Svelte | `.svelte` | Full support (script extraction, Svelte 5 runes, SvelteKit routes) |
| Vue | `.vue` | Full support (script + script-setup extraction, Nuxt page/API/middleware routes) |
| Liquid | `.liquid` | Full support |
| Pascal / Delphi | `.pas`, `.dpr`, `.dpk`, `.lpr` | Full support (classes, records, interfaces, enums, DFM/FMX form files) |
| Lua | `.lua` | Full support (functions, methods with receivers, local variables, `require` imports, call edges) |
| Luau | `.luau` | Full support (everything in Lua, plus `type`/`export type` aliases, typed signatures, and Roblox instance-path `require`) |

### 项目知识制品（本分支新增）

| 制品类型 | 匹配文件 | 图谱内容 |
|---|---|---|
| Markdown 文档 | `*.md` / `*.markdown` / `*.mdx` | document + 标题层级 section 树，全文可搜，文档→代码连边 |
| Agent 技能 | `SKILL.md`、`*/skills/` 下的 markdown | frontmatter `name`/`description` 成为节点身份，触发条件（"Use when…"）、`allowed-tools`、`model` 折叠进可搜索文本；SKILL.md 自动连边到同目录全部文件（捆绑包强关联） |
| Slash 命令 | dot 工具目录下的 `commands/*.md`（`.claude/commands/` 等） | document(command) + section 树，`argument-hint`/`allowed-tools`/`model` 折叠进可搜索文本 |
| Agent 记忆 / 指令 | `CLAUDE.md`、`AGENTS.md`、`GEMINI.md`、`.mdc`（Cursor 规则） | document(memory) + section 树，改动 ~1s 入图 |
| Dockerfile | `Dockerfile`、`Containerfile`、`*.dockerfile` | 构建 stage 为 section，`COPY`/`RUN` 引用的项目文件连边 |
| Docker Compose | `docker-compose*.yml`、`compose*.yaml` | service 为 section，dockerfile/env_file 连边 |
| GitHub Actions | `.github/workflows/*.yml` | job 为 section，`run:` 脚本与本地 action 连边 |
| 包清单 | `package.json` | npm script 为 section，入口字段（main/bin）连边 |
| 二进制资产 | 图片/视频/音频/PDF/字体/压缩包 | **只索引名字与大小，内容零读取**；文档中的资产引用连边 |
| 项目外知识 | `.codegraph/config.json` 的 `extraRoots` 指定的目录/文件 | 以 `~extra/…` 虚拟路径入图，监听/同步/搜索照常 |

## Measured cross-file coverage

Impact and blast-radius queries are only as good as the dependency graph behind them, so coverage is measured rather than asserted. **Fair coverage** = the share of symbol-bearing source files that have at least one *resolved cross-file dependent* — something that imports, calls, references, or (through a framework convention) routes to them — on a real-world benchmark repo per language. The residual is always a genuine static-analysis frontier (runtime dynamic dispatch, reflection / DI containers, framework-convention entry points, vendored third-party code), never hidden by gaming the denominator.

| Language | Benchmark repo | Coverage |
|---|---|---|
| TypeScript / JavaScript | this repo | 95.8% |
| Python | psf/requests | 100% |
| Go | gin-gonic/gin | 96.6% |
| Rust | BurntSushi/ripgrep | 86.7% |
| Java | google/gson | 93.3% |
| C# | jbogard/MediatR | 85.2% |
| PHP | guzzle/guzzle | 100% |
| Ruby | sidekiq/sidekiq | 100% |
| C | redis/redis | 92.2% |
| C++ | google/leveldb | 94.8% |
| Objective-C | SDWebImage | 91.6% |
| Swift | Alamofire | 95.3% |
| Kotlin | square/okhttp | 96.2% |
| Scala | gatling/gatling | 91.2% |
| Dart | flutter/packages | 92.4% |
| Svelte / SvelteKit | sveltejs/realworld | 100% |
| Vue / Nuxt | nuxt/movies | 93.5% |
| Lua | nvim-telescope/telescope.nvim | 84.2% |
| Luau | dphfox/Fusion | 92.2% |
| Liquid | Shopify/dawn | 73.8% |
| Pascal / Delphi | PascalCoin | 75.7% |

Framework routing is validated the same way, on a canonical app per framework: Express 100%, FastAPI 98%, Flask 100%, NestJS 96.8%, Gin 96.5%, Axum 100%, Rocket 93.8%, Vapor 100%, Laravel 92%, Rails 89.6%, React Router 100% — and the convention/reflection-heavy ones at their honest static-analysis ceiling: ASP.NET 83.9%, Spring 83.3%, Drupal 78.9%, Django 74.1%.

## Troubleshooting

**"CodeGraph not initialized"** — Run `codegraph init` in your project directory first.

**Indexing is slow** — Check that `node_modules` and other large directories are excluded. Use `--quiet` to reduce output overhead.

**MCP hits `database is locked`** — current builds shouldn't: CodeGraph bundles its own Node runtime and uses Node's built-in `node:sqlite` in WAL mode, where concurrent reads never block on a writer. If you still see it:

- **You're on an old build.** 在仓库目录 `git pull && npm ci && npm run build` 更新到最新源码构建。
- **`codegraph status` shows `Journal:` other than `wal`** — WAL couldn't be enabled on this filesystem (common on network shares and WSL2 `/mnt`), so reads can block on writes. Move the project (with its `.codegraph/` folder) onto a local disk.

**MCP server not connecting** — Ensure the project is initialized/indexed, verify the path in your MCP config, and check that `codegraph serve --mcp` works from the command line.

**Missing symbols** — The MCP server auto-syncs on save (wait a couple seconds). Run `codegraph sync` manually if needed. Check that the file's language is supported and isn't inside a `.gitignore`d or default-excluded directory (e.g. `node_modules`, `dist`).

**Sharing one checkout between Windows and WSL** — Don't point both at the same `.codegraph/`: the background-server lock and the SQLite index are tied to the OS that wrote them, and SQLite locking across the WSL2/Windows filesystem boundary is unreliable. Give each side its own index in the same tree by setting `CODEGRAPH_DIR` to a distinct name on one of them — e.g. `CODEGRAPH_DIR=.codegraph-win` on Windows, leaving WSL on the default `.codegraph`. CodeGraph skips any sibling `.codegraph-*` directory when indexing and watching, so the two never trip over each other.

## Star History

<a href="https://www.star-history.com/?repos=colbymchenry%2Fcodegraph&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=colbymchenry/codegraph&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=colbymchenry/codegraph&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=colbymchenry/codegraph&type=date&legend=top-left" />
 </picture>
</a>

## License

MIT

---

<div align="center">

**Made for AI coding agents — Claude Code, Cursor, Codex CLI, opencode, Hermes Agent, Gemini CLI, Antigravity IDE, and Kiro**

[Report Bug](https://github.com/Mint-hfut/codegraph/issues) · [Request Feature](https://github.com/Mint-hfut/codegraph/issues) · [上游项目](https://github.com/colbymchenry/codegraph)

</div>
