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



<!-- @anchor: update_log_end -->
<!-- @anchor: update_log_end_end -->
