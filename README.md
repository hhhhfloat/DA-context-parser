# 全量上下文解析工具

离线解析 Agent 会话的 JSONL 上下文转录：识别迭代、提取各轮工具调用，并按**读入 / 写入 / 编译**统计每次调用涉及的字符长度。

## 功能

- 上传或拖放 `.jsonl` / `.json` / `.jsonl.gz`（自动识别 gzip 解压），也可一键加载 `example/` 中的示例。
- 识别迭代：以「助手带工具调用的消息」为一轮，兼容 request 累积上下文与 response 增量两种日志形态。
- 提取各轮工具调用，配色区分：
  - 🔵 蓝 = 读入类工具（list_directory / read_file / get_file_structure / search_text / find_* 等）
  - 🔴 红 = 写入类工具（write_file / insert_at_anchor / delete_file / build_anchor_index 等）
  - 🟢 绿 = `compile_and_run`
- 字符长度：读入取工具结果长度，写入取写入内容（code / content）长度，编译取输出长度。
- 筛选：按工具类型、工具名关键字、最小字符数，可仅显示含工具调用的迭代，可合并同名连续调用。
- 导出（可仅导出当前筛选结果）：
  - **完整 JSON**：全部结构化字段（含参数与结果原文）。
  - **精简 JSON**：仅迭代 + 工具调用 + 字符长度。
  - **CSV**：每次调用一行，含参数/结果字符长度。
  - **Markdown**：汇总 + 调用明细表格。
  - **纯工具 + 字符**：每行一次调用，便于 grep / 排序。
- 导出附加项（复选框，默认关闭）：
  - 「含工具参数」：附加工具调用参数原文（`function.arguments`）。
  - 「含工具结果」：附加工具返回结果原文（对应 `tool_call_id` 的消息内容）。
  - 生效于精简 JSON / CSV / Markdown / 纯文本；完整 JSON 恒含原文。

## 启动

需 Node.js（仅用内置模块，无需 npm 安装）。

- Windows：双击 `run.bat`（自动打开 http://localhost:8317）。
- 任意平台：`node server.js`。

端口默认 8317（已避开 8080），被占用时自动向后寻找可用端口。

> 说明：`run.bat` 内容为纯 ASCII、全部单行命令、CRLF 行尾，请勿用会改行尾或加中文的编辑器随手改它——LF 行尾 + 跨行括号块会让 cmd.exe 解析错位，表现为窗口闪退。若 8317 已被占用，服务会后退到 8318+ 并打印实际地址，浏览器可能仍停在 8317，请以控制台地址为准。

## 目录

```
context-parser/
├── index.html      前端结构
├── style.css       前端样式
├── script.js       前端交互（上传 / 渲染 / 筛选 / 导出）
├── server.js       HTTP 服务与 API
├── parse.js        转录解析核心
├── run.bat         一键启动
├── example/        示例转录文件（.jsonl 与 .jsonl.gz）
├── PROJECT.md      项目理解
└── UPDATE.md       更新记录
```

## API

- `GET /api/examples` — 列出示例文件。
- `GET /api/example?name=<file>` — 解析并返回指定示例的结构化结果。
- `POST /api/parse` — 请求体 `{ name, data }`，`data` 为文件内容的 base64，返回结构化分析结果。
