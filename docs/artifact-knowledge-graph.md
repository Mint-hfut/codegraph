# 制品知识图谱（Artifact Knowledge Graph）更新说明

> 本文档描述本分支（Mint-hfut/codegraph）在上游 CodeGraph 之上新增的能力：
> 把**非代码的项目知识文件**（文档、Agent 技能与记忆、构建与 CI 配方）纳入同一张
> 知识图谱，并与代码节点高置信互联。
>
> 对应提交：`feat: index project knowledge files (docs, skills, memory, Dockerfile, CI, package.json) as graph artifacts`

---

## 1. 这次更新做了什么

上游 CodeGraph 的图谱只覆盖**代码**：tree-sitter 解析源码，产出符号节点（class /
function / method …）和关系边（calls / imports / extends …）。项目里同样承载关键知识的
README、`CLAUDE.md`、skills、Dockerfile、CI workflow 等文件完全不在图里——agent 想了解
"README 里关于部署是怎么说的"，只能退回 Read/Grep。

本次更新让以下文件类型作为一等公民进入图谱：

| 制品类型 | 匹配规则 | 语义类型（docType） | section 划分 |
|---|---|---|---|
| Markdown 文档 | `*.md` / `*.markdown` / `*.mdx` | `readme` / `doc` | 标题层级（`#`–`######`）树 |
| Agent 技能 | `SKILL.md`、`*/skills/` 下的 markdown | `skill` | 标题层级树 |
| Agent 记忆 / 指令 | `CLAUDE.md`、`AGENTS.md`、`GEMINI.md`、`copilot-instructions.md`、`.mdc`（Cursor 规则）、`.claude/memory/` | `memory` | 标题层级树 |
| Dockerfile | `Dockerfile`、`Containerfile`、`Dockerfile.*`、`*.dockerfile` | `dockerfile` | 每个构建 stage（`FROM … AS …`） |
| Docker Compose | `docker-compose*.yml`、`compose*.yaml` | `compose` | 每个 service |
| GitHub Actions | `.github/workflows/*.yml` | `workflow` | 每个 job |
| 包清单 | `package.json` | `package-manifest` | 每条 npm script |

---

## 2. 图谱建模

每个制品提取器输出**统一的节点形状**：

```
file:<path> ──contains──> document(signature=docType) ──contains──> section 树
```

- 复用既有的 `file` 节点（与代码文件同一套路径解析 / 依赖查询管线）；
- 新增两个通用 NodeKind：**`document`**（文件级内容节点，`signature` 字段承载语义类型）
  和 **`section`**（内容结构单元）。未来新增制品类型**零类型改动**；
- section 的正文摘要（前 400 字符）写入 FTS5 索引的 `docstring` 列 → 全文可搜；
- section 记录精确的 `startLine`/`endLine` → `codegraph_explore` 直接复用既有的
  "按行号读文件" 机制返回逐字原文。**存储层一行未改**；
- `SKILL.md` 的 YAML frontmatter（`name:` / `description:`）成为 document 节点的名字和
  摘要，所以按"技能做什么"就能搜到技能，而不只是按文件名。

## 3. 高置信 doc→code 连边（宁缺毋滥）

文档提到代码时连一条 `references` 边，但**错误的边比没有边更糟**（会把 agent 引向错误
代码），因此设计为两级闸门：

**提取侧（候选过滤）** — `src/extraction/artifacts/common.ts`：

- 只接受两种形状的提及：markdown 链接 / 反引号中的**显式文件路径**，以及反引号中的
  **标识符形状 token**（`loginUser`、`AuthService.login`）；
- 停用词表过滤 `true` / `npm` / `git` 等伪标识符；
- 每个 section 上限 30 条引用、文件内去重。

**解析侧（精度裁决）** — `src/resolution/index.ts` 的 `resolveDocMention`，文档来源的引用
（节点 ID 前缀 `document:` / `section:`）**不走**代码引用的模糊匹配策略链，而是：

- **路径引用**：只接受精确匹配（置信度 0.95）和后缀匹配（0.85），拒绝"唯一同名文件"
  兜底（0.7）——文档里的路径经常过时或缩写；
- **符号引用**：全图**唯一定义**才连边。唯一性按 `文件路径 + qualifiedName` 复合键判定
  （CodeGraph 的 qualifiedName 故意不含文件路径，单看它会把跨文件同名误判为同一符号）：
  同文件的重载折叠为一个目标（合法连边），跨文件同名一律不连（歧义即沉默）；
- `Class.method` 形式的提及先用接收者名过滤候选。

所有 doc→code 边带 `metadata.resolvedBy: 'doc-mention'`，可审计、可单独清除。

## 4. 实时更新

更新机制**零新增代码**——制品提取器接在统一分发点 `extractFromSource()` 之后，自动继承
整条增量管线：

1. FileWatcher 监到制品文件变化（如编辑了 `CLAUDE.md`）；
2. 2 秒去抖后触发 sync，(size, mtime) 预过滤 + SHA256 对比确认真实变化；
3. 只重提取该文件：旧节点按 file_path 级联删除、新节点写入（节点 ID 是
   `路径+kind+名字+行号` 的确定性哈希）；
4. 该文件的引用重新走严格解析。

记忆 / 技能文件修改后约 1 秒，图谱即为最新状态。`EXTRACTION_VERSION` 已从 14 升至 15，
存量索引会在 `codegraph status` 中提示重建。

## 5. Agent 如何使用

遵循上游验证过的原则——**适配 agent 现有行为，不发明新工具**（实测新 MCP 工具很少被
agent 选中）：

- document / section 直接并入 `codegraph_explore` / `codegraph_search` /
  `codegraph_node` 的现有结果流，agent 零学习成本；
- `codegraph_search` 的 `kind` 参数新增 `document` / `section` 取值；
- MCP `initialize` 指令（`src/mcp/server-instructions.ts`，agent 指导的唯一真相源）新增
  一条意图映射，声明文档/技能/记忆类问题同样用 explore 解决。

典型问题（agent 一次 explore 即可回答）：

- "README 里关于部署是怎么说的？"
- "哪个 skill 负责发版流程？"
- "CLAUDE.md 里对测试有什么要求？"
- "这个 Dockerfile 的构建分几个 stage、打包了哪些文件？"
- 反向："改 `prepare-release.mjs` 会影响哪些文档 / CI job？"（沿 `references` 边反查）

CLI 侧：

```bash
codegraph query "release" --kind document     # 按语义类型检索文档
codegraph query "deploy" --kind section       # 检索文档小节
```

## 6. 如何扩展新的制品类型

注册表模式（仿 `src/installer/targets/`）：**一个新提取器文件 + 注册表一行**。

1. 在 `src/extraction/artifacts/` 新建 `<type>-extractor.ts`，输出
   `file → document → section` 形状（公共构件在 `common.ts`：`createFileNode` /
   `createDocumentNode` / `MentionCollector`）；
2. 在 `detect.ts` 加路径判定（如是新扩展名，还需在 `grammars.ts` 的 `EXTENSION_MAP`
   登记）；
3. 在 `registry.ts` 的 `ARTIFACT_EXTRACTORS` 加一项；
4. 在 `__tests__/artifacts.test.ts` 补测试；提升 `EXTRACTION_VERSION`。

## 7. 验证数据

- **测试**：`__tests__/artifacts.test.ts` 13 个用例（路径判定、各提取器单元测试、端到端
  连边精度——含"跨文件同名符号不连边"的负向断言）；全量套件 1351 通过。
- **Dogfood**（对本仓库自身建索引）：266 文件 → 4216 节点 / 16876 边，其中 42 个
  document + 436 个 section（约 11%，无节点爆炸）；511 条 doc-mention 边抽样全部命中
  正确定义。

## 8. 涉及文件

```
新增  src/extraction/artifacts/        制品提取器框架（detect / common / registry + 5 个提取器）
新增  __tests__/artifacts.test.ts      13 个测试
修改  src/types.ts                     NodeKind += document, section；Language += markdown, dockerfile, json
修改  src/extraction/grammars.ts       扩展名映射、语言检测、isSourceFile
修改  src/extraction/tree-sitter.ts    extractFromSource 制品分发
修改  src/resolution/index.ts          resolveDocMention 严格连边分支
修改  src/resolution/types.ts          resolvedBy += 'doc-mention'
修改  src/mcp/tools.ts                 search kind 枚举
修改  src/mcp/server-instructions.ts   agent 指导
修改  src/context/index.ts             高价值 kind 列表
修改  src/extraction/extraction-version.ts  14 → 15
```
