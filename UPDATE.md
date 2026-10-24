# UPDATE - 全量上下文解析工具

<!-- @anchor: log_001 -->
## 首次创建
- 新增 parse.js：gzip 魔数解压、JSONL 逐行解析、request/response 去重合并、按助手工具轮切分迭代、工具分类与字符长度统计。
- 新增 server.js：原生 http 服务，静态托管 + /api/parse + /api/examples + /api/example，端口 8317 起自动后移（避开 8080）。
- 新增 index.html / style.css / script.js：拖放与选择上传、示例一键加载、汇总卡片、迭代明细着色（读=蓝/写=红/compile=绿）、按类型/工具名/最小字符筛选、合并同名调用。
- 导出支持：完整 JSON、精简 JSON（仅工具调用与字符长度）、CSV、Markdown、纯工具+字符文本，可仅导出当前筛选结果。
- 新增 run.bat 一键启动并打开浏览器。
- 用 example/ 下 .jsonl 与 .jsonl.gz 端到端验证：识别 8 个迭代（7 工具轮 / 1 回答轮）、12 次工具调用、读入 376 / 写入 12702 字符。
<!-- @anchor: log_001_end -->

<!-- @anchor: log_002 -->
## 修复 run.bat 双击闪退
- 根因：run.bat 只有 LF 行尾（CR=0，LF=20），且含跨行 `if errorlevel 1 ( ... )` 括号块。cmd.exe 解析 LF-only 批处理时跨行块边界会错位，导致命令落到块内 `exit /b 1` 或整行被误读，进程立刻结束 → 窗口闪退。
- 修复：run.bat 改为纯 ASCII + 全单行命令（无跨行括号块、无 label/goto），行尾统一为 CRLF；延时不用 `timeout`（依赖 stdin）改用 `ping -n 3 127.0.0.1`；去掉嵌套引号的 `start "title" /min cmd /c "... start "" url"`。
- 新增启动前校验：检测 node 是否在 PATH、server.js 是否与 run.bat 同目录；缺失时打印提示并 pause，不再直接退出。
- 复验：run.bat CR=37 / LF=37、非 ASCII 字节 0、无跨行括号块；example 解析结果不变（8 迭代 / 7 工具轮 / 12 次调用 / 读 376 / 写 12702 字符）。
<!-- @anchor: log_002_end -->


<!-- @anchor: log_003 -->
## 导出新增可选「工具参数 / 工具结果」附加项
- 前端：导出分组内新增「含工具参数」「含工具结果」两个复选框（id=exportArgs / exportResult），带 tooltip 说明生效范围；选项默认关闭，保持原「仅工具调用 + 字符长度」的精简导出。
- 生效范围：精简 JSON（新增 args / argsText / resultText 字段与 include 标记）、CSV（追加「工具参数」「工具结果」列，7 列变 9 列）、Markdown（表头追加两列，换行转 `<br>`、竖线转义）、纯工具文本（追加 `[参数]` / `[结果]` 缩进段）。完整 JSON 视为「完整」，恒含原文，不受开关影响。
- 口径：参数原文取 tool_calls 的 function.arguments（JSON 字符串），结果原文取对应 tool_call_id 的 tool 消息内容；换行统一为 LF，避免 CRLF 混入导出文本。
- 附带修正：合并同名连续调用时，除 charLength 外还累加 argsLength / resultLength，并合并 argsText / resultText 原文，导出的参数/结果长度与合并次数保持一致口径。
- 验证：临时 Node 脚本以 DOM 打桩加载 script.js，并用 parse.js 真实解析 example（12 次调用 / 读 376 / 写 12702 字符）验证开关组合——CSV 7→9 列、Markdown 4→6 列、纯文本 `[参数]`/`[结果]` 段落、精简 JSON 含/不含原文、完整 JSON 恒含原文，全部通过；移除测试钩子后复跑加载测试通过。
<!-- @anchor: log_003_end -->



<!-- @anchor: log_004 -->
## 新增工具调用失败解析与失败类别/工具总类筛选
- 后端（parse.js）：新增 `parse_fail_kinds` 判定表（FAIL_RULES + FAIL_KIND_LABEL、EMPTY_RULES + EMPTY_KIND_LABEL）与 `parse_fail_detect` 判定函数（firstLineOf / detectResultState / applyResultState）。判定完全依据工具结果文本首行特征，覆盖 workflow-read-only tools 包的实际返回形态：安全扫描拦截（security）、只能操作/写入工作项目·路径 ..·以 . 开头·UPDATE.md 不支持读取·不能删除目录（access）、缺少参数·未知工具（arg）、编译失败与编译超时及「编译成功但无 main 方法」（compile）、运行失败·阻塞·启动即退出·运行超时（run）、写入/读取/删除/列目录/解析结构/重建索引失败等（io）、文件或项目路径不存在·锚点不存在或不唯一·尚无项目索引（notfound）、两锚点间无内容或位置非法（state），其余以 ❌/⛔/⏱️/⚠️ 开头者归 other；「🔍 未找到匹配」单列为 empty，非失败。
- 后端统计：每次调用新增 status / failed / failKind / failLabel / failReason；迭代卡新增 failCalls / emptyCalls；analyzeRaw 新增 failures 汇总（calls、chars、byKind、byTool）与 summary.failedCalls / emptyCalls / noneCalls，toolStats 补 failed / failedChars。
- 前端（index.html / style.css / script.js）：新增「调用结果」单选（全部/仅成功/仅失败/仅未找到/仅无记录）与「失败类别」多选（按解析结果动态生成、可整组隐藏），「工具类型」标注为（总类）；`fail_filter` 锚点集中实现类别初始化、单调用放行判定与筛选生效判定，`buildFilteredView` 统一承担总类/结果/类别/工具名/最小字符筛选，汇总卡片与失败统计条随筛选联动（新增「失败调用」「未找到 / 无记录」卡片，失败类别与失败来源工具统计条）；迭代与调用条目对失败加色标、失败类别徽标、失败次数与失败原因折叠面板，合并同名连续调用时汇总失败类别与原因。
- 导出：CSV（10 列）/ Markdown / 纯文本恒定新增「状态」「失败类别」「失败原因」，精简 JSON 新增 status / failed / failKind / failReason，完整 JSON 保留 failures 汇总。
- 验证：`tmp/test-context-fail.js`（DOM 打桩端到端）合成 31 次调用覆盖全部失败形态并回归 example 真实日志，断言类别归类、汇总计数、结果/类别/总类筛选、合并模式与五种导出格式，全部 104 项通过；验证后已移除 parse.js / script.js 内的临时测试钩子并复跑通过。
<!-- @anchor: log_004_end -->


<!-- @anchor: log_005 -->
## 新增「按轮次整理」视图（推理 + 调用 + 结果三段折叠、调用与结果一一配对）
- 前端结构（index.html）：筛选条新增「视图」单选（调用列表 / 按轮次整理，name=viewMode）；新增 `#rounds` 容器（`html_rounds` 锚点）承载轮次卡片；导出组新增「轮次 Markdown」按钮（data-export="rounds"）。
- 轮次视图（script.js `rounds_view` 锚点）：`renderView` 按 state.view 切换 `#iterations` / `#rounds` 显隐；`buildRoundView` 复用 buildFilteredView 并临时关闭「合并同名调用」以保持调用与结果一一对应，同时补齐 reasoning；`renderRoundCard` 生成 `<details>` 折叠卡，卡头给出轮次号、轮型、失败数与「推理字符 / 调用次数 / 结果条数 / 涉及字符」，卡体依序为 ①推理内容（含助手文本折叠）②工具调用 ③工具结果，两部分条目共用 `#i` 编号与 `→ 结果 #i` 提示实现配对，结果条目另示状态/失败类别/结果字符与计入字符。
- 样式（style.css）：新增 `css_rounds` 区块（轮次卡、三部分左侧色条、配对条目按 read/write/compile/other 着色、失败覆盖色、编号徽标）；新增 `css_hidden` 区块 `[hidden]{display:none!important}`，修复 `.controls` / `.iterations` 等自带 display 规则时 hidden 属性失效（此前筛选条在上传前就可见）。
- 导出（script.js `rounds_export` 锚点）：`collectRounds` / `buildRoundsExportData` / `toRoundsMarkdown` 生成按轮次整理的 Markdown（汇总头 + 每轮三段 + 编号配对），推理内容恒定导出，参数与结果原文受既有「含工具参数 / 含工具结果」开关控制，四反引号围栏避免原文三反引号截断。
- 后端（parse.js）：`pickReasoning` 兼容 reasoning_content / reasoning / thinking 三种推理字段命名，迭代对象 reasoning 由此取值。
- 验证：`tmp/test-rounds.js`（DOM 打桩）用真实 example 校验——轮次卡片 7 张、三部分顺序、配对条目 24（12 调用 ×2）、编号提示、第 1 轮在第 2 轮之前、切回列表后轮次容器隐藏、仅写入筛选后残留读入条目为 0、轮次 Markdown 结构正常；example 统计不回归（8 迭代 / 7 工具轮 / 12 调用 / 读 376 / 写 12702）；验证后删除临时脚本。
<!-- @anchor: log_005_end -->


<!-- @anchor: log_006 -->
## 轮次视图改为「调用+结果」成对展示 + 任一勾选的选定导出
- 视图结构（script.js `rounds_view` 锚点）：轮次卡由 `<details>/<summary>` 改为 div 头部 + 折叠体，头部内嵌勾选框与展开按钮（summary 内点击会连带折叠，故放弃 details）；轮次内容压缩为 ① 推理内容 ② 工具调用与结果，`renderPairBlock` 让每次调用下方紧邻其结果块，结果块用 details 压缩成一行摘要（`结果 #i` + 状态 + 首行 80 字符预览 + 结果字符/计入字符），展开看原文；失败结果仍按失败色描边，`peekLine` 取首行预览。
- 勾选模型（新锚点 `rounds_select`）：`state.selection` 存 rounds（轮次序号）与 calls（`轮次:原始轮次内序号`，由 `buildCallNoMap` 生成，避免筛选后编号漂移）；`syncSelection` 只刷新计数与勾选态不重绘以保留展开；轮次勾选连带全部调用，勾选单次调用自动带上所属轮次；`handleRoundsAction` 支持全选 / 清空 / 展开结果 / 压缩结果，`bindRoundsEvents` 用事件委托区分工具条、勾选框与头部展开；载入新文件时 `clearSelection` 重置。
- 选定导出（script.js `rounds_export` / `handle_export`）：`collectSelectedRounds` 按轮次顺序只取勾选调用，`buildSelectionExportData` 用其中内容重算汇总；新增 `toSelectionJson`；`toRoundsMarkdown` 改为 ① 推理 ② 调用与结果配对结构并支持 `opts.reasoning`；导出按钮新增 `sel-md` / `sel-json`，空选定时给出提示。
- 导出附加内容：`readExportOptions` 增加 reasoning（对应新复选框 `#exportReasoning`，默认开启，此前推理恒导出）；精简 JSON 在开关开启时附加每轮 reasoning / assistantText；`toMarkdown` / `toPlain` 的附加内容说明同步。
- 界面（index.html / style.css）：导出组新增「含推理内容」与「选定 Markdown / 选定 JSON」；轮次视图顶部工具条 `rounds-bar`（计数 + 全选 / 清空 / 展开结果 / 压缩结果）；`css_rounds` 重写为卡片头部、勾选框、`pair-block` / `result-box` / `result-head__peek`、`btn--mini`、选中轮次描边等样式，移除原 details/summary 与 `.pair-item--*` 规则。
- 验证：DOM 打桩 + 真实 example（parse.js）离线校验——默认筛选下轮次数=工具轮次 7、视图调用 12、每轮成对区块数与结果摘要数等于调用数且恒为「调用→结果」顺序、结果默认压缩、轮次内容默认折叠、勾选/取消/全选/清空与选定集合一致、选定汇总字符等于所选调用之和、选定 Markdown 不含被取消的调用、选定 JSON 结构与非空校验；`tmp/check-static.js` 校验 CSS 括号配平与 id/类引用齐全；example 统计不回归（8 迭代 / 7 工具轮 / 12 调用 / 读 376 / 写 12702）。验证后移除 script.js 临时导出钩子与临时测试脚本。
<!-- @anchor: log_006_end -->


<!-- @anchor: log_007 -->
## 导出附加内容「工具参数」独立可选化与省略标注
- 导出一致性（script.js `rounds_export`）：`toSelectionJson` 在开启「含工具参数」时同时输出结构化 `args`（与精简 JSON 对齐）与 `argsText`；`include` 增加 `omitted` 数组（reasoning / toolArgs / toolResult），下游可据此确认导出范围。
- 省略可视化（新函数 `mdArgsSection` / `mdResultSection` / `omittedList`）：轮次 Markdown 与选定 Markdown 在参数/结果开关关闭时原位输出「（导出设置：不含工具参数/工具结果；对应字符仍计入统计）」，开启但无内容时输出「（无参数）」；此前为静默缺失，易被误判为日志无参数。
- 导出反馈（script.js `handle_export`）：新增 `optionsSummary` / `exportBaseName` / `exportStamp`，所有导出（含轮次、选定）完成后回写状态提示，显示本次「推理 / 参数 / 结果」开关状态；完整 JSON 提示恒含原文。
- 界面（index.html / style.css）：导出组拆为「导出范围」「附加内容」两段标签并加 `.export-note` 说明（未勾选内容会标注省略、字符统计恒定保留、完整 JSON 恒含原文）；三个复选框 tooltip 同步为「作用于哪些导出格式」。
- 验证：DOM 打桩 + 真实 example 全流程（加载 → 全选轮次 → 各格式导出）31 项断言通过——参数关闭时 JSON 无 `args`/`argsText` 但保留 `argsLength`、`include.omitted` 含 toolArgs、Markdown 标注省略；参数开启时输出结构化 args 与原文、CSV 由 10 列扩到 11 列、Markdown 增列、轮次 Markdown 12 次调用均无省略标记；完整 JSON 恒含参数与结果；example 统计不回归（8 迭代 / 7 工具轮 / 12 调用 / 读 376 / 写 12702）。验证后删除临时脚本。
<!-- @anchor: log_007_end -->

<!-- @anchor: log_008 -->
## 工具参数与工具结果彻底分开导出 + 结果附录卷
- 独立选项收尾（script.js `export_builders` / `rounds_export`）：`readExportOptions` 新增 `resultAppendix`；`failReasonText` 改为接收 opts——「含工具结果」关闭时失败原因只输出「（结果原文未导出，N 字符）」占位，开着时首行截断到 200 字符，确保结果原文不会从失败原因列渗漏；精简 JSON / CSV / Markdown / 纯文本 / 轮次与选定 Markdown / 选定 JSON 全部改传 opts。
- 结果附录（新锚点 `export_appendix`）：`addAppendix` / `appendixPointer` / `mdAppendix` / `txtAppendix` 把结果原文集中到文末「附录：工具结果」，正文只留 `→ 附录 Rn`（表格列改名为「工具结果（附录引用）」，轮次 Markdown 输出「结果原文见文末附录 Rn」）；`toMarkdown` / `toRoundsMarkdown` / `toPlain` 均支持，开关 `#exportResultAppendix` 默认勾选，取消即恢复内联。
- 单卷导出（新锚点 `export_volumes`）：`toArgsMarkdown` / `toResultMarkdown` 分别只输出参数原文或结果原文（`# 工具参数卷` / `# 工具结果卷`，含参数与结果字符分项合计），互不掺杂，也不受附加项开关影响；`handleExport` 新增 `args-md` / `result-md` 分支与 `exportVolume` 文件名（`_args_` / `_results_`）。
- 统计口径（parse.js `parse_analyze`）：summary 增加 `argsChars` / `resultChars` 分项合计，`summarizeView` 同步输出，导出头部显示「参数字符 / 结果字符」；`toJson` / `toSelectionJson` 的 `include` 增加 `toolResultMode`（appendix / inline）。
- 界面（index.html）：附加内容组标注「各自独立」，三个复选框 tooltip 明确互不影响；新增「结果移到文末附录」开关与「仅参数 Markdown / 仅结果 Markdown」按钮，导出组拆为「整份导出 / 单卷导出 / 选定」三段标签。
- 验证：DOM 打桩加载 script.js + 真实 example，48 项断言通过（全关时各格式无结果原文、只参数时无 resultText 且 Markdown 无结果列、只结果内联/附录两种形态、附录引用编号 R1 且原文仅出现在附录之后、单卷互不掺杂、选定导出 toolResultMode、按钮分发与状态回显）；静态自检（id / 按钮 / CSS 类）通过；example 统计不回归（8 迭代 / 7 工具轮 / 12 调用 / 读 376 / 写 12702，参数 13837 / 结果 621 字符；gz 一致）。验证后清理 tmp 临时脚本。
<!-- @anchor: log_008_end -->


<!-- @anchor: update_log_end -->
<!-- @anchor: update_log_end_end -->
