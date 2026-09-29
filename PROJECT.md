# PROJECT - 全量上下文解析工具

## 项目定位
离线工具，供开发者分析 Agent 会话的 JSONL 上下文转录：识别迭代、提取各轮工具调用，并按读入 / 写入 / 编译统计字符长度，用于评估上下文占用。

## 整体架构
- parse.js：后端解析核心，负责 gzip 解码、JSONL 逐行解析、请求上下文与响应增量去重合并、按助手工具轮切分迭代、工具分类与字符长度统计。
- server.js：原生 http 服务，托管前端静态资源并提供 /api/parse、/api/examples、/api/example；零第三方依赖，端口 8317（避开 8080，占用时自动后移）。
- index.html / style.css / script.js：前端三件套，负责上传与拖放、示例加载、汇总卡片、迭代明细着色与筛选导出。
- run.bat：Windows 一键启动脚本，负责环境校验、后台延迟打开浏览器、前台运行服务。
- 数据流：浏览器读取文件 → base64 → /api/parse → analyzeRaw 返回结构化 JSON → 前端渲染 / 筛选 / 导出。
- 依赖方向：script.js → server.js → parse.js，单向；run.bat 只调用 node，不参与数据流。

## 关键决策
- request 记录为累积上下文、response 为增量，故按消息标识（tool_call_id / tool_calls 的 id / 内容散列）去重合并，同时兼容累积与增量两种日志形态。
- 文件传输用 base64 + JSON 而非 multipart，省去解析库以保持零依赖；gzip 由后端按魔数 1f 8b 识别解压。
- 字符长度定义：读入取工具结果长度，写入取 code / content 字段长度（无内容字段时退化为参数长度），编译取输出长度。
- run.bat 坚持纯 ASCII + 单行命令 + CRLF：可靠优先于中文提示，Windows 控制台编码与 cmd 解析兼容性代价太高。

## 规范约定
- 前端固定三件套命名；后端按 parse / server 模块分离。
- 锚点命名 模块_功能；工具分类集中在 parse_tool_kinds 锚点维护，增删工具只改此处。
- run.bat 内不写 label / goto / 跨行括号块 / 非 ASCII 字符。

## 已知限制与坑
- 迭代以「助手带工具调用消息」切分，纯回答轮单列为 answer 迭代，不计入工具轮次。
- base64 会使传输体积膨胀约 33%，以请求体 400MB 上限兜底。
- 工具结果依赖 tool_call_id 回填，若日志缺失该字段则结果长度无法统计。
- 批处理行尾陷阱：经文本工具写出的 .bat 只有 LF 行尾，cmd.exe 对 LF-only 批处理中的跨行 `( )` 块、label/goto 会解析错位，表现为双击后窗口闪退。故 run.bat 只允许单行命令，并需保持 CRLF（改完用字节检查确认 CR 数 > 0）。
- run.bat 打开的浏览器地址固定为 http://localhost:8317，若该端口已被占用，服务会后退到 8318+，实际地址以控制台打印为准。

## 启动方式
需 Node.js（仅用内置模块，无需 npm 安装）。双击 run.bat 启动并自动打开 http://localhost:8317，或执行 `node server.js`。
