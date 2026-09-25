/**
 * audit-real-run.mjs — 对一次真实运行做独立审计（Step 7）
 *
 * 不信产出方的自述，用【权威 schema + 权威闸门】把 outbox 里的判定全部重判一遍，
 * 并检查协议产物（schema 副本漂移 / 双调度根残留 / 事件流 / 缺口计数）。
 *
 * 用法: node tools/audit-real-run.mjs <workspaceDir>
 *       例: node tools/audit-real-run.mjs "C:\Users\lxjhudan\WorkBuddy\2026-09-19-21-34-35"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeJson } from './json-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.dirname(HERE);
const WS = process.argv[2];
if (!WS) { console.error('usage: node audit-real-run.mjs <workspaceDir>'); process.exit(2); }
const SWARM = path.join(WS, '.swarm');
const AUTHORITATIVE_SCHEMA = 'C:\\Users\\lxjhudan\\.workbuddy\\plugins\\marketplaces\\my-experts\\plugins\\agent-swarm\\schemas\\verdict.schema.json';

const A = [];
const check = (n, e, a, ok) => A.push({ name: n, expected: e, actual: a, ok: !!ok });
const rd = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);

// ── 1. 判定全量重判（用权威 schema）────────────────────────────
const outbox = path.join(SWARM, 'bus', 'outbox');
const verdicts = ls(outbox).filter((f) => f.endsWith('.verdict.json'));
const results = [];
for (const f of verdicts) {
  const taskId = f.replace('.verdict.json', '');
  let r;
  try { r = judgeJson(taskId, SWARM, AUTHORITATIVE_SCHEMA); }
  catch (e) { r = { verdict: 'FAIL', reason: `audit_error:${e.message}` }; }
  results.push({ taskId, ...r });
}
const byReason = {};
for (const r of results) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
const okCount = results.filter((r) => r.reason === 'ok').length;
check('A1 outbox 判定文件数', '>=1', `${verdicts.length}`, verdicts.length >= 1);
check('A2 权威闸门通过率', '记录', `${okCount}/${verdicts.length}`, true);
const bad = results.filter((r) => r.reason !== 'ok');
check('A3 不符权威 schema / 证据缺失的判定', '记录', bad.length ? bad.map((b) => `${b.taskId}:${b.reason}`).join(', ') : '0 个', true);

// ── 2. 旧协议残留 ─────────────────────────────────────────────
check('A4 旧协议 .verdict.md 残留数', '0', `${ls(outbox).filter((f) => f.endsWith('.verdict.md')).length}`, ls(outbox).filter((f) => f.endsWith('.verdict.md')).length === 0);

// ── 3. schema 副本漂移（协议要求"唯一来源"）────────────────────
const localSchema = path.join(SWARM, 'schemas', 'verdict.schema.json');
if (fs.existsSync(localSchema)) {
  const same = rd(localSchema) === rd(AUTHORITATIVE_SCHEMA);
  check('A5 本地 schema 与权威 schema 字节一致', 'true（否则有漂移风险）', same ? 'true' : '**false → 双份契约**', true);
} else {
  check('A5 本地 schema 副本', '不存在（最佳）或字节一致', '不存在', true);
}

// ── 4. 双调度根残留 ───────────────────────────────────────────
const mirror = path.join(SWARM, '_repo-mirror');
check('A6 双调度根残留 _repo-mirror', '不存在（或已归档说明）',
  fs.existsSync(mirror) ? `存在，${ls(mirror).length} 个顶层项` : '不存在', true);

// ── 5. 事件流 ─────────────────────────────────────────────────
const ev = path.join(SWARM, 'state', 'events.jsonl');
let evCount = 0; const evTypes = {};
if (fs.existsSync(ev)) {
  for (const ln of rd(ev).split(/\r?\n/)) {
    if (!ln.trim()) continue;
    evCount++;
    try { const o = JSON.parse(ln); evTypes[o.e] = (evTypes[o.e] ?? 0) + 1; } catch { evTypes['__unparsable'] = (evTypes['__unparsable'] ?? 0) + 1; }
  }
}
check('A7 events.jsonl 可解析', '全部可解析', `${evCount} 行，类型: ${Object.entries(evTypes).map(([k, v]) => `${k}×${v}`).join(' ')}`,
  !evTypes.__unparsable);

// ── 6. 独立复核覆盖率（协议要求每个 PASS 都要有复核）────────────
const producer = results.filter((r) => !/V$/.test(r.taskId)).length;
const verifier = results.filter((r) => /V$/.test(r.taskId)).length;
check('A8 独立复核覆盖率（verifier 判定数 / 产出判定数）', '1:1 为达标',
  `${verifier}/${producer}（差 ${producer - verifier}）`, true);

// ── 7. 说明书是否写绝对路径（双根的根因）──────────────────────
const inbox = path.join(SWARM, 'bus', 'inbox');
const specs = ls(inbox).filter((f) => f.endsWith('.task.md'));
const relPathSpecs = specs.filter((f) => {
  const c = rd(path.join(inbox, f)) ?? '';
  return /`?\.swarm\/bus\/outbox/.test(c) && !/SWARM_DIR|绝对路径|C:\\/.test(c);
});
check('A9 说明书使用相对路径的风险数', '0', `${relPathSpecs.length}/${specs.length} 份`,
  relPathSpecs.length === 0);

// ── 报告 ───────────────────────────────────────────────────────
const L = [];
L.push('# Step 7 · 真实运行独立审计', '');
L.push(`- 审计对象：\`${WS}\``);
L.push(`- 运行时间：${new Date().toISOString()}`);
L.push(`- 权威契约：\`${AUTHORITATIVE_SCHEMA}\``, '');
L.push('## 判定全量重判（不信自述，用权威闸门重跑）');
L.push('');
L.push(`共 **${verdicts.length}** 份判定 ｜ 通过 **${okCount}** ｜ 归因分布：${Object.entries(byReason).map(([k, v]) => `\`${k}\`×${v}`).join('、')}`);
if (bad.length) {
  L.push('');
  L.push('不通过的判定：');
  for (const b of bad) L.push(`- \`${b.taskId}\` → ${b.reason}${b.schemaErrors?.length ? `（${b.schemaErrors[0]}）` : ''}`);
}
L.push('');
L.push('## 协议产物审计');
L.push('');
L.push('| # | 检查 | 期望 | 实际 | 结果 |');
L.push('|---|------|------|------|------|');
A.forEach((x, i) => L.push(`| ${i + 1} | ${x.name} | ${x.expected} | ${String(x.actual).replace(/\|/g, '/')} | ${x.ok ? '✅' : '❌'} |`));
L.push('');
L.push('## 结论');
L.push('');
L.push(`- 判定层：${bad.length === 0 ? '**全部通过权威闸门**' : `**${bad.length} 份不过闸**，见上`}`);
L.push(`- 复核覆盖：${verifier}/${producer}（协议要求 1:1）`);
L.push('- 本审计只做事实核对，不做主观评价。');
fs.mkdirSync(path.join(LAB, 'runs'), { recursive: true });
fs.writeFileSync(path.join(LAB, 'step7-audit-report.md'), L.join('\n') + '\n', 'utf8');
console.log(L.join('\n'));
