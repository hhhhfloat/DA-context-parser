// @anchor: parse_tot_desc
// 上下文转录解析核心：解压、逐行解析 JSONL、合并请求与响应、识别迭代、
// 归类工具（读/写/编译）并统计每次调用涉及的字符长度。

'use strict';

const zlib = require('zlib');

// @anchor: parse_tool_kinds
// 工具分类表：读入(蓝)、写入(红)、编译运行(绿)，未收录者归为其它
const READ_TOOLS = new Set([
  'list_directory',
  'read_file',
  'read_between_anchors',
  'get_file_structure',
  'search_text',
  'find_references',
  'find_callers',
  'find_callees',
  'describe_anchors',
  'list_anchors'
]);

const WRITE_TOOLS = new Set([
  'write_file',
  'insert_at_anchor',
  'delete_between_anchors',
  'delete_file',
  'build_anchor_index'
]);

const COMPILE_TOOLS = new Set(['compile_and_run']);

// 判断工具所属类别，用于前端着色与字符长度取值
function classifyTool(name) {
  if (COMPILE_TOOLS.has(name)) return 'compile';
  if (WRITE_TOOLS.has(name)) return 'write';
  if (READ_TOOLS.has(name)) return 'read';
  return 'other';
}
// @anchor: parse_tool_kinds_end

// @anchor: parse_decode
// 依据 gzip 魔数决定解压还是按 UTF-8 解码，并去除 BOM
function decodeBuffer(buffer) {
  let buf = buffer;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}
// @anchor: parse_decode_end

// @anchor: parse_jsonl
// 逐行解析 JSONL，记录空行与非法行信息
function parseJsonl(text) {
  const lines = text.split(/\r?\n/);
  const records = [];
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch (e) {
      errors.push({ line: i + 1, message: e.message });
    }
  }
  return { records, errors, lineCount: lines.length };
}
// @anchor: parse_jsonl_end

// @anchor: parse_hash
// 轻量 djb2 散列，为无标识消息生成稳定去重键
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
// @anchor: parse_hash_end

// @anchor: parse_message_key
// 为消息生成去重键：工具结果用调用ID，助手轮用工具调用ID，其余用角色+内容散列
function messageKey(msg) {
  if (msg.role === 'tool' && msg.tool_call_id) {
    return 'tool|' + msg.tool_call_id;
  }
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    return (
      'asst|' +
      msg.tool_calls
        .map((t) => (t && t.id) || (t && t.function && t.function.name) || 'x')
        .join(',')
    );
  }
  const content =
    typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
  return 'msg|' + (msg.role || '') + '|' + content.length + '|' + hashString(content);
}
// @anchor: parse_message_key_end

// @anchor: parse_merge
// 合并请求累积上下文与响应增量，按键去重并保持顺序，重建完整消息序列
function buildConversation(records) {
  const ordered = [];
  const seen = new Set();
  const toolNames = new Set();
  const responses = [];
  let requestCount = 0;
  let responseCount = 0;

  const push = (msg) => {
    if (!msg || typeof msg !== 'object') return;
    const key = messageKey(msg);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(msg);
  };

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    if (rec.type === 'request') {
      requestCount++;
      const body = rec.body || {};
      if (Array.isArray(body.tools)) {
        for (const t of body.tools) {
          const n = t && t.function && t.function.name;
          if (n) toolNames.add(n);
        }
      }
      if (Array.isArray(body.messages)) {
        body.messages.forEach(push);
      }
    } else if (rec.type === 'response') {
      responseCount++;
      const body = rec.body || {};
      const choice = Array.isArray(body.choices) ? body.choices[0] : null;
      const msg = choice && choice.message ? choice.message : null;
      if (msg) {
        if (body.usage) msg._usage = body.usage;
        msg._source = 'response';
        push(msg);
      }
      responses.push({
        model: body.model || null,
        timestamp: rec.timestamp || null,
        usage: body.usage || null
      });
    }
  }

  return { messages: ordered, toolNames: [...toolNames], requestCount, responseCount, responses };
}
// @anchor: parse_merge_end

// @anchor: parse_char_count
// 计算单次调用字符长度：读入取结果长度，写入取写入内容长度，编译取输出长度
function computeCharLength(call) {
  if (call.kind === 'write') {
    const args = call.args;
    let sum = 0;
    let found = false;
    if (args && typeof args === 'object') {
      for (const key of ['code', 'content']) {
        if (typeof args[key] === 'string') {
          sum += args[key].length;
          found = true;
        }
      }
    }
    return found ? sum : call.argsLength;
  }
  return call.resultLength;
}
// @anchor: parse_char_count_end

// @anchor: parse_extract_calls
// 以助手工具轮次为迭代，提取每轮工具调用并关联对应工具结果
function extractIterations(messages) {
  const iterations = [];
  const callIndex = new Map();
  let pendingUser = null;

  for (const msg of messages) {
    const role = msg.role;
    if (role === 'system') continue;

    if (role === 'user') {
      const c = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
      pendingUser = c;
      continue;
    }

    if (role === 'assistant') {
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (calls.length) {
        const iter = {
          index: iterations.length + 1,
          kind: 'tools',
          user: pendingUser,
          assistantText: text,
          reasoning: msg.reasoning_content || '',
          usage: msg._usage || null,
          fromResponse: msg._source === 'response',
          calls: [],
          charLength: 0,
          totals: { read: 0, write: 0, compile: 0, other: 0 }
        };
        for (const tc of calls) {
          const fn = (tc && tc.function) || {};
          const name = fn.name || 'unknown';
          const argsText =
            typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {});
          let argsObj = null;
          try {
            argsObj = JSON.parse(argsText);
          } catch (e) {
            argsObj = null;
          }
          const call = {
            id: (tc && tc.id) || '',
            name,
            kind: classifyTool(name),
            argsText,
            args: argsObj,
            argsLength: argsText ? argsText.length : 0,
            resultText: '',
            resultLength: 0,
            charLength: 0
          };
          iter.calls.push(call);
          if (call.id) callIndex.set(call.id, call);
        }
        iterations.push(iter);
        pendingUser = null;
      } else if (text) {
        iterations.push({
          index: iterations.length + 1,
          kind: 'answer',
          user: pendingUser,
          assistantText: text,
          reasoning: msg.reasoning_content || '',
          usage: msg._usage || null,
          fromResponse: msg._source === 'response',
          calls: [],
          charLength: 0,
          totals: { read: 0, write: 0, compile: 0, other: 0 }
        });
        pendingUser = null;
      }
      continue;
    }

    if (role === 'tool') {
      const call = msg.tool_call_id ? callIndex.get(msg.tool_call_id) : null;
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content == null
          ? ''
          : JSON.stringify(msg.content);
      if (call) {
        call.resultText = text;
        call.resultLength = text.length;
      }
    }
  }

  for (const it of iterations) {
    let total = 0;
    for (const call of it.calls) {
      const len = computeCharLength(call);
      call.charLength = len;
      total += len;
      const bucket = it.totals[call.kind] != null ? call.kind : 'other';
      it.totals[bucket] += len;
    }
    it.charLength = total;
  }

  return iterations;
}
// @anchor: parse_extract_calls_end

// @anchor: parse_analyze
// 解析入口：从原始字节产出文件概览、分类统计、工具明细与迭代列表
function analyzeRaw(buffer, fileName) {
  const text = decodeBuffer(buffer);
  const parsed = parseJsonl(text);
  const conv = buildConversation(parsed.records);
  const iterations = extractIterations(conv.messages);

  const summary = {
    iterations: iterations.length,
    toolIterations: iterations.filter((it) => it.kind === 'tools').length,
    toolCalls: 0,
    totals: {
      read: { calls: 0, chars: 0 },
      write: { calls: 0, chars: 0 },
      compile: { calls: 0, chars: 0 },
      other: { calls: 0, chars: 0 }
    },
    totalChars: 0
  };

  const toolStats = {};
  for (const it of iterations) {
    for (const call of it.calls) {
      summary.toolCalls++;
      const bucket = summary.totals[call.kind] || summary.totals.other;
      bucket.calls++;
      bucket.chars += call.charLength;
      summary.totalChars += call.charLength;
      const st =
        toolStats[call.name] ||
        (toolStats[call.name] = { name: call.name, kind: call.kind, calls: 0, chars: 0 });
      st.calls++;
      st.chars += call.charLength;
    }
  }

  return {
    file: {
      name: fileName || '',
      bytes: buffer.length,
      textLength: text.length,
      lines: parsed.lineCount,
      requests: conv.requestCount,
      responses: conv.responseCount,
      parseErrors: parsed.errors
    },
    tools: conv.toolNames,
    summary,
    toolStats: Object.values(toolStats).sort((a, b) => b.chars - a.chars),
    iterations
  };
}

// @anchor: parse_analyze_end

module.exports = { analyzeRaw, decodeBuffer, classifyTool };
