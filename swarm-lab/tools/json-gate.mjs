/**
 * json-gate.mjs — 判定硬化版（Step 3）
 *
 * 与 gate.mjs（文本首行 + 正则）的区别：
 *   1) 判定以 JSON 为准，经 JSON Schema 校验 —— 结构不合规在协议层就出不去
 *   2) 新增【任务绑定】校验：verdict.task 必须等于本次任务号 → 补掉文本版的张冠李戴盲区
 *   3) 证据改为数组语义，类型/条数由 schema 强制，无需正则猜
 *   4) 只读文件头部（同 gate.mjs），保持上下文卫生，并给出字节数证据
 *
 * 依赖：零外部依赖，内置 JSON Schema 子集校验器。
 */
import fs from 'node:fs';
import path from 'node:path';

const HEAD_BYTES = 4096;

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

// ── 内置 JSON Schema 子集校验器 ────────────────────────────────
const typeOf = (v) =>
  Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;

export function validateSchema(value, schema, at = '$', errors = []) {
  if (schema.type) {
    const t = typeOf(value);
    const ok = schema.type === 'number' ? t === 'number' : t === schema.type;
    if (!ok) {
      errors.push(`${at}: 期望 ${schema.type}，实际 ${t}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: 值 ${JSON.stringify(value)} 不在枚举 [${schema.enum.join(', ')}] 内`);
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at}: 长度 ${value.length} < minLength ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${at}: 长度 ${value.length} > maxLength ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: 不匹配 pattern ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at}: 条目数 ${value.length} < minItems ${schema.minItems}`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${at}: 条目数 ${value.length} > maxItems ${schema.maxItems}`);
    if (schema.items) value.forEach((v, i) => validateSchema(v, schema.items, `${at}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) {
      if (!(k in value)) errors.push(`${at}: 缺少必填字段 "${k}"`);
    }
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) validateSchema(v, props[k], `${at}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}: 出现未声明字段 "${k}"（additionalProperties=false）`);
    }
  }
  return errors;
}

// ── 判定主逻辑 ─────────────────────────────────────────────────
export function judgeJson(taskId, swarmDir, schemaPath) {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const vp = path.join(swarmDir, 'bus', 'outbox', `${taskId}.verdict.json`);
  const base = {
    task: taskId, verdict: 'FAIL', reason: '', declared: null, evidence: [],
    missing: [], schemaErrors: [], bytesRead: 0, fileSize: 0, headOnly: true, firstLine: null,
  };

  if (!fs.existsSync(vp)) return { ...base, reason: 'no_verdict' };

  const { size } = fs.statSync(vp);
  const { text, bytesRead } = readHead(vp);
  let obj;
  let headOnly = true;
  try {
    obj = JSON.parse(text);
  } catch {
    // 头部 4KB 可能截断了 JSON → 只为解析退回整文件（不消费正文语义），并如实标记
    try {
      obj = JSON.parse(fs.readFileSync(vp, 'utf8'));
      headOnly = false;
    } catch {
      return { ...base, reason: 'malformed_json', fileSize: size, bytesRead, headOnly };
    }
  }
  const hd = { headOnly, fileSize: size, bytesRead };

  const schemaErrors = validateSchema(obj, schema);
  if (schemaErrors.length) {
    return { ...base, ...hd, reason: 'schema_violation', schemaErrors, declared: obj.verdict ?? null };
  }

  // 任务绑定：verdict.task 必须等于本次任务号（文本版的盲区）
  if (obj.task !== taskId) {
    return { ...base, ...hd, reason: 'task_mismatch', schemaErrors: [`声明 task=${obj.task}，实际请求 ${taskId}`], declared: obj.verdict };
  }

  // 证据存在性
  const missing = obj.evidence.filter((p) => !fs.existsSync(path.join(swarmDir, p)));
  if (missing.length) {
    return { ...base, ...hd, reason: 'evidence_dangling', declared: obj.verdict, evidence: obj.evidence, missing };
  }

  return { ...base, ...hd, verdict: obj.verdict, reason: 'ok', declared: obj.verdict, evidence: obj.evidence };
}

// CLI 直用
if (process.argv[1]?.endsWith('json-gate.mjs')) {
  const [, , swarmDir = '.swarm', taskId, schemaPath = 'schemas/verdict.schema.json'] = process.argv;
  if (!taskId) { console.error('usage: node json-gate.mjs <swarmDir> <taskId> [schemaPath]'); process.exit(2); }
  console.log(JSON.stringify(judgeJson(taskId, swarmDir, schemaPath), null, 2));
}
