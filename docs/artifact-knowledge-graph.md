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
| 二进制资产 | 图片/视频/音频/PDF/字体/压缩包（png、jpg、svg、mp4、mp3、pdf、woff2、zip…） | `asset` | 无（**只索引名字，绝不读内容**） |

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

记忆 / 技能文件修改后约 1 秒，图谱即为最新状态。`EXTRACTION_VERSION` 已从 14 升至 16，
存量索引会在 `codegraph status` 中提示重建。

## 5. 项目外的知识：extra roots（额外索引根）

Agent 的技能和持久记忆经常放在项目目录之外（如 `~/.claude/skills/`、用户级
`CLAUDE.md`）。在 `.codegraph/config.json` 中声明后即可纳入图谱：

```json
{
  "extraRoots": [
    "~/.claude/skills",
    { "path": "~/.claude/CLAUDE.md", "name": "global-memory" }
  ]
}
```

- 条目可以是**目录或单个文件**，支持 `~` 展开；`name` 可选（默认取 basename，重名自动加后缀）；
- 这些文件以**虚拟路径前缀** `~extra/<name>/…` 进入图谱（如
  `~extra/skills/deploy/SKILL.md`），不会与项目路径冲突，且在所有工具输出中可见"来自项目外"；
- **实时更新同样生效**：watcher 会对每个 extra root 安装独立监听（目录用递归/逐目录策略，
  单文件监听其父目录以兼容编辑器的原子替换写入），事件映射回虚拟路径后走同一条
  去抖 → sync 管线；`codegraph sync` 的 (size, mtime)+哈希对账也覆盖它们；
- **安全收口**：虚拟路径的解析集中在 `validatePathWithinRoot` 一处，只有项目自己的
  config 显式注册过的根才可解析，且施加与项目根相同的词法 + realpath 包含性检查
  （`../` 逃逸、符号链接逃逸一律拒绝）；凭证目录（`~/.ssh`、`~/.aws`、`~/.gnupg` 等）、
  文件系统根、整个 home 目录即使写进 config 也会被拒绝；位于项目内部或包含项目的
  路径同样跳过（前者已被正常扫描覆盖，后者会失控）；每个 root 上限 2000 个文件。
- 修改 config 后在下次打开项目（或 daemon 重启）时生效；改动这些文件约 1 秒后图谱即更新。

## 6. Skill 捆绑包：同目录文件强关联

一个 skill 目录是自包含的捆绑包（SKILL.md + 脚本 + 参考文档）。仅靠"SKILL.md 里显式提到
谁就连谁"会漏掉没被点名的成员，因此解析阶段新增 **skill-bundle 合成**：每个 `SKILL.md`
的 document 节点向其目录子树内**每个已索引文件**发一条 `references` 边
（`metadata.synthesizedBy: 'skill-bundle'`）。

- 同目录成员关系是**确定性事实**，不是启发式猜测，因此不打 `provenance: 'heuristic'`；
- 只从 SKILL.md 这个规范锚点出发（星形拓扑），不做成员两两互连（边数爆炸）；
- 幂等（重复 sync 不会重复发边），每个捆绑包上限 100 个文件；
- 效果：问"发版的 skill 怎么用"，一次 explore 连 SKILL.md 没点名的辅助脚本和参考文档
  一起带出来。

## 7. 记忆文件权重更高 + 二进制资产只记名字

**搜索排序**：document/section 参与 `kindBonus` 排序后，再按语义类型加权
（`docTypeBonus`，按路径分类，对 document 和它的 section 都生效）：
`memory +6 > skill +4 > readme +2 > 普通 doc 0`。记忆文件是常驻指令，与查询匹配时
应排在普通文档之前——加权后一条匹配的 memory 与一个匹配的函数同级。

**二进制资产**：图片/视频/音频/PDF/字体/压缩包以 `file → document(signature='asset')`
进入图谱，**内容零读取**——索引器用 `size:mtime` 占位串代替文件内容参与哈希/变更检测，
超大文件也不受体积上限影响。收益：按文件名可搜到资产；README 里的
`![logo](assets/logo.png)` 能解析成真实的 doc→asset 边；改 `assets/` 下的文件能反查
哪些文档引用了它。

## 8. Agent 如何使用

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

## 9. 如何扩展新的制品类型

注册表模式（仿 `src/installer/targets/`）：**一个新提取器文件 + 注册表一行**。

1. 在 `src/extraction/artifacts/` 新建 `<type>-extractor.ts`，输出
   `file → document → section` 形状（公共构件在 `common.ts`：`createFileNode` /
   `createDocumentNode` / `MentionCollector`）；
2. 在 `detect.ts` 加路径判定（如是新扩展名，还需在 `grammars.ts` 的 `EXTENSION_MAP`
   登记）；
3. 在 `registry.ts` 的 `ARTIFACT_EXTRACTORS` 加一项；
4. 在 `__tests__/artifacts.test.ts` 补测试；提升 `EXTRACTION_VERSION`。

## 10. 验证数据

- **测试**：`__tests__/artifacts.test.ts` 17 个用例（路径判定、各提取器单元测试、端到端
  连边精度——含"跨文件同名符号不连边"的负向断言，asset/skill-bundle/记忆排序）+
  `__tests__/extra-roots.test.ts` 7 个用例（config 解析、虚拟路径安全收口的逃逸拒绝、
  端到端索引/同步/删除、watcher 虚拟路径过滤）；全量套件 1361 通过。
- **Dogfood**（对本仓库自身建索引，外挂一个含 SKILL.md+notes.md 的 extra root）：
  4297 节点 / 17205 边，47 个 document（33 doc、4 skill、2 memory、2 readme、
  2 workflow、2 package-manifest、2 asset），无节点爆炸；extra root 文件以
  `~extra/skills/…` 路径入图且 docType 正确；skill-bundle 边把 SKILL.md 与未被点名的
  同目录 notes.md 关联；`codegraph query "sample external skill" --kind document`
  第一名即外部技能。

## 11. 涉及文件

```
新增  src/extraction/artifacts/        制品提取器框架（detect / common / registry + 6 个提取器，含 asset）
新增  src/extra-roots.ts               extra roots：config 解析、注册表、虚拟路径解析、扫描
新增  src/resolution/skill-bundle.ts   skill-bundle 边合成
新增  __tests__/artifacts.test.ts      17 个测试（含 asset / bundle / 排序）
新增  __tests__/extra-roots.test.ts    7 个测试（config / 安全 / e2e / watcher）
修改  src/types.ts                     NodeKind += document, section；Language += markdown, dockerfile, json, binary
修改  src/extraction/grammars.ts       扩展名映射、语言检测、isSourceFile
修改  src/extraction/tree-sitter.ts    extractFromSource 制品分发
修改  src/extraction/index.ts          扫描追加 extra roots；asset 零读取；路径解析统一过安全校验
修改  src/sync/watcher.ts              extra roots 监听 + 虚拟路径事件映射
修改  src/utils.ts                     validatePathWithinRoot 识别虚拟路径
修改  src/index.ts                     构造时加载注册 extraRoots；watch 传入
修改  src/resolution/index.ts          resolveDocMention 严格连边分支；skill-bundle 合成调用
修改  src/resolution/types.ts          resolvedBy += 'doc-mention'
修改  src/search/query-utils.ts        kindBonus += document/section；docTypeBonus
修改  src/db/queries.ts                搜索重排序应用 docTypeBonus
修改  src/mcp/tools.ts                 search kind 枚举
修改  src/mcp/server-instructions.ts   agent 指导
修改  src/context/index.ts             高价值 kind 列表
修改  src/extraction/extraction-version.ts  14 → 16
```
