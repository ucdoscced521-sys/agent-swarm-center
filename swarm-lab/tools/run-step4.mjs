/**
 * run-step4.mjs — Step 4「主脑边界硬化」验证
 *
 * 要证明的不是"守卫能返回 false"，而是：
 *   ① 白名单精确 —— 该放的放、该拒的拒，且归因到具体规则
 *   ② 默认拒绝 —— 未声明路径一律拒（白名单模式，不是黑名单）
 *   ③ 【承重】—— 没有守卫时这些动作会真的发生（产生真实文件），有了守卫则不会
 *   ④ 结构性而非提示词 —— 守卫判定不读任何 prompt
 *
 * 运行: node tools/run-step4.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract, authorize, enforce, audit } from './capability-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.dirname(HERE);
const SWARM = path.join(LAB, '.swarm');
const CONTRACT = path.join(LAB, 'contracts', 'master-capability.json');
const SANDBOX = path.join(LAB, 'runs', 'guard-sandbox');
const EVENTS = path.join(SWARM, 'state', 'events.jsonl');

const A = [];
const check = (name, expected, actual, ok) => A.push({ name, expected, actual, ok: !!ok });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); };

const contract = loadContract(CONTRACT);

// ── A. 正向：必须放行（不误伤）────────────────────────────────
const ALLOW_CASES = [
  ['read .swarm/state/brief.json', { action: 'read', path: '.swarm/state/brief.json' }],
  ['read .swarm/HANDOFF.md', { action: 'read', path: '.swarm/HANDOFF.md' }],
  ['read verdict 首行', { action: 'read', path: '.swarm/bus/outbox/T-001.verdict.head' }],
  ['write inbox 派单说明书', { action: 'write', path: '.swarm/bus/inbox/T-001.task.md' }],
  ['write decisions.md', { action: 'write', path: '.swarm/decisions.md' }],
  ['write tasks.json', { action: 'write', path: '.swarm/state/tasks.json' }],
  ['append events.jsonl', { action: 'append', path: '.swarm/state/events.jsonl' }],
  ['tool Agent（派人）', { tool: 'Agent' }],
  ['tool SendMessage（派单/收单）', { tool: 'SendMessage' }],
];

// ── B. 负向：必须拒绝，且说明命中哪一层 ───────────────────────
const DENY_CASES = [
  ['tool Bash（跑测试）', { tool: 'Bash' }, 'deny'],
  ['exec 任意命令', { action: 'exec', path: 'npm test' }, 'deny'],
  ['write src/count-fields.mjs（写代码）', { action: 'write', path: 'src/count-fields.mjs' }, 'deny'],
  ['write index.html（写交付物）', { action: 'write', path: 'index.html' }, 'deny'],
  ['write 证据（伪造 evidence）', { action: 'write', path: '.swarm/evidence/T-001/forged.txt' }, 'deny'],
  ['write 判定（自己给自己判 PASS）', { action: 'write', path: '.swarm/bus/outbox/T-001.verdict.json' }, 'deny'],
  ['read verdict 正文（污染上下文）', { action: 'read', path: '.swarm/bus/outbox/T-001.verdict.body' }, 'deny'],
  ['read 证据文件', { action: 'read', path: '.swarm/evidence/T-001/proof.txt' }, 'deny'],
  ['read 源码', { action: 'read', path: 'src/app.mjs' }, 'deny'],
  ['tool MultiEdit', { tool: 'MultiEdit' }, 'deny'],
  ['write 未声明路径（默认拒）', { action: 'write', path: '.swarm/whatever.txt' }, 'default'],
];

// ── 执行判定 + 审计 ───────────────────────────────────────────
const results = { allow: [], deny: [] };
// 注意：events.jsonl 是 append-only 的共享审计轨，绝不能清空。
// （踩过：这里曾写 fs.rmSync(EVENTS) —— 把 Step 2 写下的 task.start/task.end 全擦掉了，
//   破坏性地掩盖了前序证据。任何步骤都无权删除历史事件。）
const auditBefore = fs.existsSync(EVENTS)
  ? fs.readFileSync(EVENTS, 'utf8').split('\n').filter((l) => l.includes('capability.decision')).length
  : 0;

for (const [name, action] of ALLOW_CASES) {
  const d = authorize(contract, action);
  audit(EVENTS, action, d);
  results.allow.push({ name, d });
  check(`P·放行｜${name}`, 'ALLOW', d.allow ? `ALLOW(${d.rule})` : `DENY(${d.rule})`, d.allow);
}
for (const [name, action, expectLayer] of DENY_CASES) {
  const d = authorize(contract, action);
  audit(EVENTS, action, d);
  results.deny.push({ name, d, expectLayer });
  check(`N·拒绝｜${name}`, 'DENY', d.allow ? `ALLOW(${d.rule})` : `DENY(${d.rule})`, !d.allow);
}
const layerOk = results.deny.every((r) => r.d.layer === r.expectLayer);
check('N·归因层正确（deny 层 / 默认层）', `${DENY_CASES.length}/${DENY_CASES.length}`,
  results.deny.map((r) => `${r.d.layer}`).join(','), layerOk);

// ── C. 承重证明：没有守卫时，这些动作会真的发生 ────────────────
const DANGEROUS = [
  { action: { action: 'write', path: 'src/evil.mjs' } },
  { action: { action: 'write', path: 'index.html' } },
  { action: { action: 'write', path: '.swarm/evidence/T-001/forged.txt' } },
  { action: { action: 'write', path: '.swarm/bus/outbox/T-001.verdict.json' } },
];
const doWrite = (act) => {
  const abs = path.join(SANDBOX, act.path);
  w(abs, 'FORGED BY MASTER\n');
  return abs;
};

fs.rmSync(SANDBOX, { recursive: true, force: true });
const naiveCreated = DANGEROUS.filter(({ action }) => {
  try { doWrite(action); return true; } catch { return false; }
}).length;
check('C1 无守卫时：危险动作真的产生了文件（风险真实存在）', `${DANGEROUS.length} 个`,
  `${naiveCreated} 个`, naiveCreated === DANGEROUS.length);

fs.rmSync(SANDBOX, { recursive: true, force: true });
const guardedCreated = DANGEROUS.filter(({ action }) => {
  const r = enforce(contract, action, doWrite);
  return r.ok;
}).length;
const onDisk = fs.existsSync(SANDBOX)
  ? fs.readdirSync(SANDBOX, { recursive: true }).filter((f) => fs.statSync(path.join(SANDBOX, f)).isFile()).length
  : 0;
check('C2 有守卫时：危险动作被拦（0 个执行成功）', '0 个', `${guardedCreated} 个`, guardedCreated === 0);
check('C3 有守卫时：磁盘上零残留文件（真拦住，不是只记日志）', '0 个', `${onDisk} 个`, onDisk === 0);

// ── D. 结构性而非提示词 ───────────────────────────────────────
const guardSrc = fs.readFileSync(path.join(HERE, 'capability-guard.mjs'), 'utf8');
check('D1 守卫判定不依赖任何 prompt（零 prompt 字样）', '0 次',
  `${(guardSrc.match(/prompt/gi) ?? []).length} 次`, !/prompt/i.test(guardSrc));

const auditCount = fs.existsSync(EVENTS)
  ? fs.readFileSync(EVENTS, 'utf8').trim().split('\n').filter((l) => l.includes('capability.decision')).length
  : 0;
const auditDelta = auditCount - auditBefore;
check('D2 审计留痕完整（本步每次判定都新增记录）', `${ALLOW_CASES.length + DENY_CASES.length} 条`,
  `${auditDelta} 条（累计 ${auditCount}）`, auditDelta === ALLOW_CASES.length + DENY_CASES.length);

// ── 报告 ───────────────────────────────────────────────────────
const passed = A.filter((x) => x.ok).length;
const L = [];
L.push('# Step 4 · 主脑边界硬化验证报告', '');
L.push(`- 运行时间：${new Date().toISOString()}`);
L.push(`- 断言结果：**${passed}/${A.length} 通过**`);
L.push('- 成本：0 credits', '');
L.push('## 硬化点');
L.push('');
L.push('| | 硬化前（提示词自律） | 硬化后（物理约束） |');
L.push('|---|---|---|');
L.push('| 依据 | 提示词里写「禁止自己写代码」 | `contracts/master-capability.json` 契约 |');
L.push('| 判序 | 无 | **deny 优先 → allow 匹配 → 否则默认拒绝** |');
L.push('| 越界后果 | 模型"应该"会忍住 | 函数层直接拒绝，副作用不发生 |');
L.push('| 留痕 | 无 | 每次判定写 `capability.decision` 事件 |');
L.push('');
L.push('## A · 正向：该放的必须放（9 条，防误伤）');
L.push('');
L.push('| 动作 | 判定 | 命中规则 |');
L.push('|------|------|----------|');
for (const r of results.allow) L.push(`| ${r.name} | ${r.d.allow ? '✅ ALLOW' : '❌ DENY'} | \`${r.d.rule}\` |`);
L.push('');
L.push('## B · 负向：该拒的必须拒（11 条）');
L.push('');
L.push('| 动作 | 判定 | 命中层 | 命中规则 |');
L.push('|------|------|--------|----------|');
for (const r of results.deny) {
  L.push(`| ${r.name} | ${r.d.allow ? '❌ ALLOW' : '✅ DENY'} | ${r.d.layer} | \`${r.d.rule}\` |`);
}
L.push('');
L.push('## C · 承重证明（本步最关键）');
L.push('');
L.push('同一批危险动作（写代码 / 写交付物 / 伪造证据 / 自己给自己判 PASS），两种模式各跑一次：');
L.push('');
L.push('| 模式 | 执行成功的动作数 | 磁盘残留文件数 |');
L.push('|------|------------------|----------------|');
L.push(`| 无守卫（naive） | **${naiveCreated} / ${DANGEROUS.length}** | ${naiveCreated} |`);
L.push(`| 有守卫（enforce） | **${guardedCreated} / ${DANGEROUS.length}** | **${onDisk}** |`);
L.push('');
L.push('无守卫时危险动作**真的写下了文件**——说明风险不是假想的；');
L.push('有守卫时执行数为 0 且磁盘零残留——说明守卫**承重**，不是只记日志。');
L.push('');
L.push('## D · 结构性保证');
L.push('');
L.push('- 守卫源码零 `prompt` 字样 → 判定与提示词**完全无关**，改提示词无法绕过。');
L.push(`- 审计留痕：本步新增 ${auditDelta} 条（累计 ${auditCount} 条）→ 越界尝试可事后追溯。`);
L.push('- `events.jsonl` 为 append-only 共享审计轨，任何步骤无权清空（本步曾误删前序事件，已修复）。');
L.push('');
L.push('## E · CLI 侧双保险（记录，非本次断言范围）');
L.push('');
L.push('契约是**应用层**闸门。宿主层还有一道（两处参数均已在 `--help` 实测确认存在）：');
L.push('');
L.push('```bash');
L.push('# WorkBuddy：整表清空 / 显式黑名单 / 权限模式');
L.push('node <cbc> -p "<task>" --tools ""                              # 禁用全部内置工具');
L.push('node <cbc> -p "<task>" --disallowedTools "Bash,Edit,Write"     # 黑名单');
L.push('node <cbc> -p "<task>" --permission-mode plan                  # 计划模式');
L.push('node <cbc> -p "<task>" --subagent-permission-mode <mode>       # 子智能体权限');
L.push('# Codex：沙箱与审批');
L.push('codex exec -C <wt> -s read-only "<plan-task>"                  # 只读沙箱');
L.push('```');
L.push('');
L.push('> ⚠️ **诚实标注**：以上宿主层参数**本次未做端到端验证**。原因是 Step 1 已证实：');
L.push('> 从 WorkBuddy 会话内部调用 WorkBuddy CLI 的 `-p` 不执行一次性回合（进程启动后空转）。');
L.push('> 该验证必须在外部控制台进行，不构成本步的通过条件，仅作双保险记录。');
L.push('> **本步的通过条件完全建立在应用层契约上——这一层已实测有效且不依赖宿主。**');
L.push('');
L.push('## 断言明细');
L.push('');
L.push('| # | 断言 | 期望 | 实际 | 结果 |');
L.push('|---|------|------|------|------|');
A.forEach((x, i) => L.push(`| ${i + 1} | ${x.name} | ${x.expected} | ${String(x.actual).replace(/\|/g, '/')} | ${x.ok ? '✅' : '❌'} |`));
L.push('');
L.push('## 结论');
L.push('');
L.push(passed === A.length
  ? `✅ **Step 4 成立**：「主脑只调度不干活」从提示词自律变为**物理约束** —— 白名单精确（${ALLOW_CASES.length} 条放行 / ${DENY_CASES.length} 条拒绝 / 默认拒），且有承重证明。`
  : '❌ **存在不通过项**：边界未硬化到位。');
w(path.join(LAB, 'step4-report.md'), L.join('\n') + '\n');
fs.appendFileSync(path.join(SWARM, 'main-log.md'),
  `(step4) 主脑边界硬化：断言 ${passed}/${A.length}，naive=${naiveCreated} guarded=${guardedCreated}\n`);

console.log(`STEP4 ${passed}/${A.length} ${passed === A.length ? 'PASS' : 'FAIL'}`);
process.exit(passed === A.length ? 0 : 1);
