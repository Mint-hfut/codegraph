# 知识图谱基准测试（Knowledge Benchmark）

本目录是一套**评测 CodeGraph "制品知识图谱" 改进效果**的基准测试,回答一个问题:

> 把 docs / skills / 记忆文件 / slash 命令 / 二进制资产纳入知识图谱(并加上
> skill-bundle 强关联边、记忆文件排序加权、skill/command frontmatter 提取)之后,
> 相比改进之前,**检索质量**和 **agent 端到端表现(成功率 + token 消耗)** 到底有没有变好?

测试方法是同一套语料、同样的问题,只把 **CodeGraph 的 build** 在两臂之间切换:

| 臂 | build | 含义 |
|---|---|---|
| `improved`（改进版） | 当前工作树 | 索引了 docs/skills/memory/commands/assets 的知识图谱 |
| `original`（原始版） | 基线 git ref `16c73e2` | 知识图谱工作**之前**的 CodeGraph（markdown/skills 不入图） |

两臂唯一的变量就是 build,所以任何差距都能归因到这次改进本身。基线臂用 **git worktree
整体 checkout 到 ref** 后重新构建——因为本次改进大多是**新增文件**,文件级回退删不掉它们,
只有整体 checkout 才是真正的 "before"。

---

## 一、两档测试

| 档 | 脚本 | 成本 | 测什么 |
|---|---|---|---|
| **第一档 — 确定性探针** | `run-probe.sh` | **零（不需要大模型）** | 知识是否**可被检索**（检索正确性），秒级、可复现 |
| **第二档 — 完整 agent A/B** | `run-bench.sh` | 真实 agent 运行（opus） | **任务成功率** + **token 消耗**（端到端） |

设计理念(与 CLAUDE.md 的验证方法论一致):**先跑零成本的确定性探针证明"改进改变了可检索的内容",
通过后再花钱跑昂贵的 agent A/B 证明"改进改变了 agent 的结果"。** 第一档不过,第二档不值得花钱。

---

## 二、目录结构

```
scripts/agent-eval/bench-knowledge/
├── README.md            本文件
│
├── 【第一档 · 确定性探针 · 无 LLM】
│   ├── probes.json      8 个探针任务的定义（查询 + 期望命中的节点/边）
│   ├── make-fixture.mjs 生成合成语料（每种特性各来一个）
│   ├── run-probe.sh     编排器：两臂各建索引、跑探针、出对比表
│   ├── probe-bench.mjs  对单个 build 跑探针（走真实 searchNodes + 直接查 SQLite 边）
│   └── probe-report.mjs probe-results.jsonl → 改进/原始对比表
│
└── 【第二档 · 完整 agent A/B · 需 opus】
    ├── tasks.json       知识问答任务（问题 + 断言关键词 + 参考答案）
    ├── run-bench.sh     编排器：两臂各建索引、跑每个任务×重复、打分、出报表
    ├── lib.mjs          stream-json 共享解析（逐 turn token 累加、工具分桶、答案提取）
    ├── parse-bench.mjs  单条运行日志 → 指标 JSON
    ├── score.mjs        单条运行 → {success, by, reason}（断言优先 → LLM 裁判兜底）
    └── report.mjs       results.jsonl → markdown 对比表
```

各文件行数概览(便于审阅):

| 文件 | 行数 | 角色 |
|---|--:|---|
| `probes.json` | 76 | 第一档任务定义 |
| `make-fixture.mjs` | 96 | 合成语料生成器 |
| `run-probe.sh` | 58 | 第一档编排器 |
| `probe-bench.mjs` | 98 | 第一档探针执行 |
| `probe-report.mjs` | 27 | 第一档报表 |
| `tasks.json` | 53 | 第二档任务定义 |
| `run-bench.sh` | 145 | 第二档编排器 |
| `lib.mjs` | 130 | stream-json 解析库 |
| `parse-bench.mjs` | 19 | 第二档指标解析 |
| `score.mjs` | 87 | 第二档打分器 |
| `report.mjs` | 87 | 第二档报表 |

---

## 三、第一档：确定性探针（无 LLM）

### 执行方式

```bash
# 改进版 vs 原始版，约 12 秒，零成本
scripts/agent-eval/bench-knowledge/run-probe.sh

# 只测改进版（跳过基线构建）
SKIP_BASELINE=1 scripts/agent-eval/bench-knowledge/run-probe.sh

# 指定不同的基线 ref
scripts/agent-eval/bench-knowledge/run-probe.sh <baseline-ref>
```

环境变量:`AGENT_EVAL_OUT`（工作目录,默认 `/tmp/bench-knowledge-probe`）、`SKIP_BASELINE=1`。

### 工作流程

1. `make-fixture.mjs` 生成一个**麻雀虽小五脏俱全**的合成语料(见下节)。
2. 用**两个 build** 分别对它建索引(改进版 = 当前 `dist`;原始版 = 基线 ref 的 worktree 构建出的 `dist`)。
3. `probe-bench.mjs` 对每个 build 跑 `probes.json` 里的 8 个探针:
   - `search` 探针 → 调用该 build **自己的 `searchNodes`**(`codegraph_search` 包的就是它),断言期望节点是否在前 N 命中(或断言排第 1)。
   - `edge` 探针 → 直接读 `.codegraph/codegraph.db`,断言期望的合成/解析边是否存在。
   - **全程不涉及任何大模型**,结果确定可复现。

### 合成语料（`make-fixture.mjs` 生成）

```
corpus/
├── CLAUDE.md                              # 记忆文件，含稀有词 "gribblefy"
├── docs/architecture.md                   # 普通 doc，同样含 "gribblefy"（用于排序对比）
├── .claude/skills/deployer/
│   ├── SKILL.md                           # 技能：frontmatter name/description(含"Use when"触发条件)/allowed-tools/model
│   ├── reference.md                       # 捆绑兄弟文件（已索引）
│   └── scripts/deploy.py                  # 捆绑兄弟脚本（已索引）
├── .claude/commands/changelog.md          # slash 命令：frontmatter description/argument-hint/allowed-tools
├── src/app.ts                             # 代码文件，含符号 startApp
├── assets/diagram.png                     # 二进制资产（真实 PNG 字节，内容绝不读取）
└── README.md                             # 引用了 assets/diagram.png 和 src/app.ts
```

### 8 个探针任务（即"测试题目"）

| # | 探针 id | 测的特性 | 通过判据 |
|---|---|---|---|
| 1 | `skill-by-capability` | 技能 frontmatter 描述可搜 | 搜 "deploy roll back safely" → 命中 `deployer/SKILL.md`（signature=skill） |
| 2 | `skill-by-trigger` | "Use when…" 触发条件可搜 | 搜 "blast radius rollout impact"（触发词）→ 命中该 skill |
| 3 | `command-frontmatter` | 命令被识别 + `argument-hint` 折叠进 docstring | 搜 "changelog release version" → 命中 command 文档,且 docstring 含 "Arguments: version" |
| 4 | `memory-outranks-doc` | 记忆文件排序高于普通 doc | 搜 "gribblefy" → 排第 1 的是 `CLAUDE.md`,不是 `docs/architecture.md` |
| 5 | `asset-by-name` | 资产按名可搜、内容不索引 | 搜 "diagram" → 命中 `assets/diagram.png`（signature=asset）,docstring 含 "not indexed" |
| 6 | `skill-bundle-edges` | SKILL.md 连到同目录文件 | 存在从 SKILL.md 到 `reference.md`、`scripts/deploy.py` 的 `references` 边 |
| 7 | `doc-to-asset-edge` | README 图片链接 → 资产节点 | 存在从 README 到 `assets/diagram.png` 文件节点的 `references` 边 |
| 8 | `doc-to-code-edge` | README 符号提及 → 代码节点 | 存在从 README 到 `src/app.ts` 的 `references` 边 |

### 测试结果（实测记录）

> 运行环境:2026-06-17 · Node v22.22.2 · 改进版 HEAD `cc916ac`（EXTRACTION_VERSION 17）·
> 原始版 `16c73e2` · 耗时约 12.5s · **零 LLM 成本**

| 探针 | 改进版 | 原始版 |
|---|:--:|:--:|
| skill-by-capability | ✅ rank 1 | ❌ 索引为空 |
| skill-by-trigger | ✅ rank 1 | ❌ 索引为空 |
| command-frontmatter | ✅ rank 1 | ❌ 索引为空 |
| memory-outranks-doc | ✅ rank 1 | ❌ 索引为空 |
| asset-by-name | ✅ rank 1 | ❌ 索引为空 |
| skill-bundle-edges | ✅ 2/2 边存在 | ❌ 无 SKILL.md 节点 |
| doc-to-asset-edge | ✅ 1/1 边存在 | ❌ 无 README 节点 |
| doc-to-code-edge | ✅ 1/1 边存在 | ❌ 无 README 节点 |
| **合计** | **8 / 8** | **0 / 8** |

**结论**:原始版（`16c73e2`）根本不索引这些知识文件,对应的节点和边都不存在,所以 8 个探针全挂;
改进版全部命中且检索排序都在第 1 位。这个 **8 / 0** 的对比精确隔离了本次改进新增的检索能力。

---

## 四、第二档：完整 agent A/B（成功率 + token 消耗）

### 执行方式

```bash
# 默认：本仓库作语料、基线 16c73e2、每格 1 次、opus
scripts/agent-eval/bench-knowledge/run-bench.sh

# 建议 ≥2 次/格（跑间方差大），并可只跑部分任务
REPS=2 TASKS=skill-add-lang,asset-policy scripts/agent-eval/bench-knowledge/run-bench.sh

# 只看计划、不花钱
DRY_RUN=1 scripts/agent-eval/bench-knowledge/run-bench.sh
```

参数:`[语料目录] [基线ref] [重复次数]`。环境变量:`MODEL`(默认 opus)、`JUDGE_MODEL`(裁判模型,
默认 sonnet)、`TASKS`(限定任务 id)、`MAX_USD`(单次预算)、`NO_JUDGE=1`(只用断言)、`DRY_RUN=1`。

输出(默认 `/tmp/bench-knowledge`):`report.md` 对比表、`results.jsonl`(每次运行一行)、
原始 `run-*.jsonl` agent 日志。

### 两项指标怎么测

- **token 消耗** —— **逐 assistant turn 累加**(`output` + 未缓存的 `input`/`cache_creation`),
  主线程和子 agent 都算。**不**读 `result.usage`——它在 Claude Code 里只含最后一轮,会严重低估
  多轮 agent 的真实消耗(见 CLAUDE.md "Measure tokens by summing per-turn assistant usage")。
  头条数字是 `billable ≈ gen + fresh-input`;缓存读取单独统计(近乎免费)。
- **任务成功率** —— **断言优先,LLM 裁判兜底**(`score.mjs`):
  1. 确定性检查:最终答案里是否出现必需事实(`tasks.json` 的 `mustInclude` / `anyOf`)。免费、可复现。
  2. 断言未命中时,用一次独立的廉价 `claude -p` 裁判对照参考答案判 pass/fail(应对"答对但措辞绕开关键词"的情形)。
     **裁判自己的 token 不计入任一臂**。

辅助上下文:每次运行的 Read+Grep 次数、codegraph 调用次数、时长。

### 第二档任务集（`tasks.json`,6 题,针对本仓库）

| 任务 id | 问题（针对本仓库知识） | 命中关键词 |
|---|---|---|
| `skill-add-lang` | 添加新 tree-sitter 语言该用哪个 skill | `add-lang` |
| `skill-benchmark` | 哪个 skill 用 with/without 对比评测检索质量 | `agent-eval` |
| `memory-sot` | CLAUDE.md 里说 agent 工具指导的唯一真相源是哪个文件 | `server-instructions` |
| `asset-policy` | 二进制资产如何处理、是否读取内容 | `asset` + "name only / not read" |
| `extraction-version` | 当前 EXTRACTION_VERSION 的值及定义位置 | `17` + `extraction-version` |
| `skill-bundle` | 什么把 SKILL.md 和同目录文件关联起来 | `skill-bundle` / 边 |

### 测试结果

> ⚠️ 第二档的完整 agent 矩阵**尚未在本环境跑出统计有效的结果**:它是
> `2 臂 × 任务数 × 重复次数` 次真实 opus 运行 + 一次基线重建 + 两次建索引,既重又受限于
> 本环境探测到的 rate-limit(组织禁用了 overage,五小时窗口)。请在预算充足的环境运行
> `run-bench.sh`,生成的 `report.md` 会形如:
>
> ```
> | Arm      | Success rate | Median billable tokens | Median Read+Grep | Median codegraph | Median duration |
> |----------|--------------|------------------------|------------------|------------------|-----------------|
> | improved | (k/n)        | (xx.xk)                | (n)              | (n)              | (xx s)          |
> | original | (k/n)        | (xx.xk)                | (n)              | (n)              | (xx s)          |
> ```
>
> 已用 canned 日志验证过解析/打分/报表三部分正确(token 逐 turn 累加无误、断言命中/未命中、
> 报表对比),并用一次真实 sonnet 调用验证了 LLM 裁判兜底路径(断言 miss → 裁判判 PASS 并给理由)。

---

## 五、注意事项

- **成本与限流**。第二档是真实 opus 运行;先用 `DRY_RUN=1` 看计划,再用 `TASKS=` 跑小子集。
  组织可能禁用了 overage(超额被拒),注意五小时窗口。第一档无此问题。
- **方差**。agent 运行跑间方差大,用 `REPS≥2` 并看**中位数**,别用单次结论(报表刻意用中位数)。
- **基线 node_modules**。基线 worktree 直接软链当前仓库的 `node_modules` 以省去慢速 `npm ci`——
  基线 ref 离 HEAD 很近(依赖相同)时没问题;若选很久以前的 ref 且依赖有变,改为在 worktree 里
  `npm ci`。
- **`.sh` 脚本不入图**。CodeGraph 不索引 shell 脚本,所以 skill 目录里的 `.sh` 兄弟文件不会产生
  bundle 边(语料里特意用 `deploy.py` 而非 `.sh` 来验证 bundle)。这是已知边界,不是 bug。
- 第二档刻意用无头 `claude -p --output-format stream-json`(干净解析答案文本 + 逐 turn usage),
  不同于 `itrun.sh` 驱动交互式 TUI;对知识问答而言,答案文本和 token 总量是重点,二者在流里都精确。
