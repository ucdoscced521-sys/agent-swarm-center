/**
 * gate.mjs — 主脑判定逻辑（Step 1 验证对象）
 *
 * 职责：只做协议里规定主脑该做的事
 *   1) 取 outbox/<task-id>.verdict.md 的【首行】判定
 *   2) 校验 EVIDENCE 指向的文件【真实存在】
 *   3) 无证据 / 首行不合规 / 文件缺失 → 一律 FAIL
 *   4) 记录实际读取字节数，用于【客观证明】主脑没有读正文
 *
 * 设计约束：绝不解析 verdict 正文的其余内容。
 */
import fs from 'node:fs';
import path from 'node:path';

const HEAD_BYTES = 4096; // 只读文件头部，不整文件读入

export function readHead(file, maxBytes = HEAD_BYTES) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    return { text: buf.subarray(0, n).toString('utf8'), bytesRead: n };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @returns {{task:string, verdict:'PASS'|'FAIL'|'BLOCKED', reason:string,
 *            declared:string|null, evidence:string[], missing:string[],
 *            bytesRead:number, fileSize:number, headOnly:boolean, firstLine:string|null}}
 */
export function judge(taskId, swarmDir) {
  const verdictPath = path.join(swarmDir, 'bus', 'outbox', `${taskId}.verdict.md`);
  const base = {
    task: taskId,
    verdict: 'FAIL',
    reason: '',
    declared: null,
    evidence: [],
    missing: [],
    bytesRead: 0,
    fileSize: 0,
    headOnly: true,
    firstLine: null,
  };

  // C1: verdict 文件是否存在
  if (!fs.existsSync(verdictPath)) {
    return { ...base, reason: 'no_verdict' };
  }

  const { size } = fs.statSync(verdictPath);
  const { text, bytesRead } = readHead(verdictPath);
  const lines = text.split(/\r?\n/);

  // C2: 首行必须严格匹配 ### 判定: PASS|FAIL|BLOCKED
  const firstRaw = (lines[0] ?? '').trim();
  const m = /^###\s*判定:\s*(PASS|FAIL|BLOCKED)$/.exec(firstRaw);
  if (!m) {
    return { ...base, reason: 'malformed_verdict', fileSize: size, bytesRead, firstLine: firstRaw };
  }
  const declared = m[1];

  // C3: EVIDENCE 至少 1 项，且每个路径都真实存在
  const evLine = lines.find((l) => /^EVIDENCE:/.test(l.trim())) ?? '';
  const paths = evLine
    .replace(/^EVIDENCE:/, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const missing = paths.filter((p) => !fs.existsSync(path.join(swarmDir, p)));

  if (paths.length === 0) {
    return { ...base, reason: 'evidence_absent', declared, fileSize: size, bytesRead, firstLine: firstRaw };
  }
  if (missing.length > 0) {
    return {
      ...base, reason: 'evidence_dangling', declared, evidence: paths, missing,
      fileSize: size, bytesRead, firstLine: firstRaw,
    };
  }

  // C4: 证据成立 → 采信子智能体的声明
  return {
    ...base,
    verdict: declared,
    reason: 'ok',
    declared,
    evidence: paths,
    fileSize: size,
    bytesRead,
    firstLine: firstRaw,
  };
}

// CLI 直用：node gate.mjs <swarmDir> <taskId>
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('gate.mjs')) {
  const [, , swarmDir = '.swarm', taskId] = process.argv;
  if (!taskId) {
    console.error('usage: node gate.mjs <swarmDir> <taskId>');
    process.exit(2);
  }
  console.log(JSON.stringify(judge(taskId, swarmDir), null, 2));
}
