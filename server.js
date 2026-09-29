// @anchor: server_tot_desc
// 本地 HTTP 服务：托管前端静态资源，并提供上下文文件解析与示例文件加载接口。
// 零第三方依赖，仅使用 Node 内置模块；默认端口 8317（避开 8080）。

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { analyzeRaw } = require('./parse');

const ROOT = __dirname;
const BASE_PORT = 8317;
const MAX_PORT = 8327;
const MAX_BODY = 400 * 1024 * 1024;

// @anchor: server_mime
// 静态资源扩展名到 MIME 类型的映射
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.jsonl': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};
// @anchor: server_mime_end

// @anchor: server_helpers
// 统一 JSON 响应与请求体读取工具
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, cb) {
  const chunks = [];
  let size = 0;
  let done = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      done = true;
      cb(new Error('请求体超过上限'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (done) return;
    cb(null, Buffer.concat(chunks).toString('utf8'));
  });
  req.on('error', (err) => {
    if (!done) {
      done = true;
      cb(err);
    }
  });
}
// @anchor: server_helpers_end

// @anchor: server_static
// 读取并返回项目内的静态文件，阻止目录穿越
function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel.indexOf('..') !== -1) {
    res.writeHead(400);
    res.end('bad request');
    return;
  }
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 not found');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}
// @anchor: server_static_end

// @anchor: server_parse_api
// 接收 base64 文件数据，解码解析后返回结构化分析结果
function handleParse(req, res) {
  readBody(req, (err, body) => {
    if (err) {
      sendJson(res, 413, { error: '文件读取失败：' + err.message });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      sendJson(res, 400, { error: '请求体不是合法 JSON' });
      return;
    }
    if (!payload || typeof payload.data !== 'string') {
      sendJson(res, 400, { error: '缺少 data 字段' });
      return;
    }
    try {
      const buf = Buffer.from(payload.data, 'base64');
      const result = analyzeRaw(buf, payload.name || '');
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, 500, { error: '解析失败：' + e.message });
    }
  });
}
// @anchor: server_parse_api_end

// @anchor: server_examples
// 列出并可加载 example 目录中的示例转录文件
function listExamples(res) {
  const dir = path.join(ROOT, 'example');
  fs.readdir(dir, (err, files) => {
    if (err) {
      sendJson(res, 200, { files: [] });
      return;
    }
    sendJson(res, 200, { files: files.filter((f) => /\.jsonl(\.gz)?$/i.test(f)) });
  });
}

function loadExample(name, res) {
  if (!name || name.indexOf('..') !== -1 || name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) {
    sendJson(res, 400, { error: '非法文件名' });
    return;
  }
  const full = path.join(ROOT, 'example', name);
  fs.readFile(full, (err, buf) => {
    if (err) {
      sendJson(res, 404, { error: '示例文件不存在' });
      return;
    }
    try {
      sendJson(res, 200, analyzeRaw(buf, name));
    } catch (e) {
      sendJson(res, 500, { error: '解析失败：' + e.message });
    }
  });
}
// @anchor: server_examples_end

// @anchor: server_route
// 请求路由：区分静态资源、解析接口与示例接口
function handleRequest(req, res) {
  const url = req.url.split('?')[0];
  const query = (req.url.split('?')[1] || '');
  if (req.method === 'POST' && url === '/api/parse') {
    handleParse(req, res);
    return;
  }
  if (req.method === 'GET' && url === '/api/examples') {
    listExamples(res);
    return;
  }
  if (req.method === 'GET' && url === '/api/example') {
    const m = /(?:^|&)name=([^&]*)/.exec(query);
    loadExample(m ? decodeURIComponent(m[1]) : '', res);
    return;
  }
  if (req.method === 'GET') {
    serveStatic(req.url, res);
    return;
  }
  sendJson(res, 405, { error: 'method not allowed' });
}
// @anchor: server_route_end

// @anchor: server_start
// 在端口范围内启动服务，端口被占用时自动后移
function start(port) {
  if (port > MAX_PORT) {
    console.error('可用端口区间已被占满，无法启动。');
    process.exit(1);
    return;
  }
  const server = http.createServer(handleRequest);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn('端口 ' + port + ' 被占用，尝试 ' + (port + 1) + ' ...');
      start(port + 1);
    } else {
      console.error('服务异常：', err.message);
      process.exit(1);
    }
  });
  server.listen(port, () => {
    console.log('==================================================');
    console.log(' 上下文解析工具已启动');
    console.log(' 访问地址: http://localhost:' + port);
    console.log(' 按 Ctrl+C 停止服务');
    console.log('==================================================');
  });
}
// @anchor: server_start_end

start(BASE_PORT);
