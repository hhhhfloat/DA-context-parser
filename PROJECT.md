<!-- @anchor: project_md_intro -->
<!-- 项目说明：定位、架构、关键决策、约定与限制 -->
# PROJECT - 全量上下文解析工具

<!-- @anchor: proj_overview -->
## 项目定位
离线工具，供开发者分析 Agent 会话的 JSONL 上下文转录：识别迭代、提取各轮工具调用，判定调用结果（成功 / 失败 / 未找到 / 无记录），并按读入 / 写入 / 编译统计字符长度，用于评估上下文占用并定位失败来源。
<!-- @anchor: proj_overview_end -->

<!-- @anchor: proj_arch -->
## 整体架构
- parse.js：后端解析核心，负责 gzip 解码、JSONL 逐行解析、请求上下文与响应增量去重合并、按助手工具轮切分迭代、工具分类、调用结果判定与字符长度统计。
- server.js：原生 http 服务，托管前端静态资源并提供 /api/parse、/api/examples、/api/example；零第三方依赖，端口 8317（避开 8080，占用时自动后移）。
- index.html / style.css / script.js：前端三件套，负责上传与拖放、示例加载、汇总卡片（含失败统计）、迭代明细着色与筛选导出；「按轮次整理」视图额外承担配对展示与勾选选定导出。
- run.bat：Windows 一键启动脚本，负责环境校验、后台延迟打开浏览器、前台运行服务。

### 数据流
浏览器读取文件 → base64 → /api/parse → analyzeRaw 返回结构化 JSON（含 failures 汇总）→ 前端渲染 / 筛选 / 勾选 / 导出。

### 依赖方向
script.js → server.js → parse.js，单向；run.bat 只调用 node，不参与数据流。

<!-- @anchor: proj_arch_end -->

<!-- @anchor: proj_decisions -->
## 关键决策
- request 记录为累积上下文、response 为增量，故按消息标识（tool_call_id / tool_calls 的 id / 内容散列）去重合并，同时兼容累积与增量两种日志形态。
- 文件传输用 base64 + JSON 而非 multipart，省去解析库以保持零依赖；gzip 由后端按魔数 1f 8b 识别解压。
- 字符长度定义：读入取工具结果长度，写入取 code / content 字段长度（无内容字段时退化为参数长度），编译取输出长度。
- 失败判定只看工具结果的首行文本特征，不依赖日志字段，因此对历史日志与不同版本的工具文案都可用；结果分四态：ok 成功 / fail 失败 / empty 未找到 / none 无结果记录，其中 empty 与 none 不计入失败。
- 失败来源与耗时开销一并统计：failures.byKind 给类别分布，failures.byTool 给来源工具分布，二者的 chars 说明失败返回占用多少上下文。
- run.bat 坚持纯 ASCII + 单行命令 + CRLF：可靠优先于中文提示，Windows 控制台编码与 cmd 解析兼容性代价太高。
- 参数与结果在导出层彻底解耦：两个独立开关分别决定原文是否落盘，结果关闭时连「失败原因」列也只留占位文字；长结果可用「结果移到文末附录」把原文收进文末、正文只留 R&lt;n&gt; 引用，另有「仅参数 / 仅结果」单卷导出，避免长结果稀释调用结构与参数信息。

<!-- @anchor: proj_decisions_end -->

<!-- @anchor: proj_conventions -->
## 规范约定
- 前端固定三件套命名；后端按 parse / server 分离；锚点命名 模块_功能。
- 工具分类集中在 parse_tool_kinds；失败判定表集中在 parse_fail_kinds（FAIL_RULES 先具体后笼统、末条 other 兜底，中文名由 FAIL_KIND_LABEL 提供，未找到类走 EMPTY_RULES），改文案只动表、不动 detectResultState。
- 筛选维度：工具总类 / 调用结果 / 失败类别 / 工具名 / 最小字符；汇总卡片与导出都以当前筛选视图为准（isFilterActive 判定）。
- 视图约定：`调用列表` 按轮分组；`按轮次整理` 每轮为 ① 推理内容 ② 工具调用与结果，调用下方必须紧跟其结果（details 压缩），故强制关闭同名合并。
- 选定约定：勾选存 state.selection（rounds 存轮次序号、calls 存「轮次:原始轮次内序号」），键以原始调用序位为准以防筛选后编号漂移；导出链路 collectSelectedRounds → buildSelectionExportData。
- 导出约定：CSV / Markdown / 纯文本恒含状态、失败类别、失败原因；精简 JSON 恒含 status / failed / failKind；推理内容由「含推理内容」开关控制（默认开）。
- run.bat 禁 label / goto / 跨行括号块 / 非 ASCII。
- CSS 约定：JS 控显隐一律用 hidden，全局 `[hidden]{display:none!important}` 兜底；轮次卡片用 div 头而非 details/summary，以便标题栏内嵌勾选框。

<!-- @anchor: proj_conventions_end -->

<!-- @anchor: proj_limits -->
## 已知限制与坑
- 迭代以「助手带工具调用消息」切分，纯回答轮单列为 answer 迭代，不计入工具轮次。
- 失败判定基于结果首行特征：若工具返回文案大幅改版（新前缀、新措辞），需同步补 FAIL_RULES，否则会落入 other 或误判为成功。
- 工具结果依赖 tool_call_id 回填，若日志缺失该字段则结果长度与状态无法统计（状态记为 none）。
- base64 会使传输体积膨胀约 33%，以请求体 400MB 上限兜底。
- 批处理行尾陷阱：经文本工具写出的 .bat 只有 LF 行尾，cmd.exe 对 LF-only 批处理中的跨行 `( )` 块、label/goto 会解析错位，表现为双击后窗口闪退。故 run.bat 只允许单行命令，并需保持 CRLF（改完用字节检查确认 CR 数 > 0）。
- run.bat 打开的浏览器地址固定为 http://localhost:8317，若该端口已被占用，服务会后退到 8318+，实际地址以控制台打印为准。
- 推理内容依赖日志字段：仅识别 reasoning_content / reasoning / thinking 三种命名，若转录用了其它字段名，轮次视图的「推理内容」会显示为空（不影响调用与结果统计）。
<!-- @anchor: proj_limits_extra -->
- 轮次视图的结果压缩摘要只取首行前 80 字符，全文需展开（展开仍受 PREVIEW_LIMIT 截断）。
- 勾选按原始轮次序号保存，筛选变化不影响已有勾选；重置需用工具条「清空」或重载文件，否则选定导出可能含当前不可见的轮次。

- 完整 JSON 恒含全部原文（参数与结果都在）。只想取其中一类时请用精简 JSON（关掉另一项开关）、单卷导出或轮次 Markdown。
- 附录默认开启：Markdown / 纯文本导出默认把结果原文收进文末附录，若需要结果与调用紧邻阅读，取消「结果移到文末附录」即可。

<!-- @anchor: proj_limits_end -->

<!-- @anchor: proj_start -->
## 启动方式
需 Node.js（仅用内置模块，无需 npm 安装）。双击 run.bat 启动并自动打开 http://localhost:8317，或执行 `node server.js`。
<!-- @anchor: proj_start_end -->
