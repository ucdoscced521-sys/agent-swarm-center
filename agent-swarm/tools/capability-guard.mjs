/**
 * capability-guard.mjs — 主脑能力守卫（Step 4）
 *
 * 作用：把「主脑只调度不干活」从提示词自律变成【物理不可为】。
 * 主脑的每一次动作都必须过这里；未被白名单放行的动作在函数层就被拒绝。
 *
 * 判序：deny 命中 → 拒 ｜ allow 命中 → 放 ｜ 都不命中 → 默认拒（defaultPolicy=deny）
 * 零外部依赖。
 */
import fs from 'node:fs';
import path from 'node:path';

export function loadContract(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ── 极简 glob：* 不跨 /，** 跨 / ─────────────────────────────
function globToRe(pat) {
  let out = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '*') {
      if (pat[i + 1] === '*') { out += '.*'; i++; }
      else out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

function ruleMatches(rule, action) {
  if (rule.tool) return action.tool === rule.tool;
  if (rule.action && rule.path) {
    if (action.action !== rule.action) return false;
    if (!action.path) return false;
    return globToRe(rule.path).test(action.path.replace(/\\/g, '/'));
  }
  return false;
}

const describe = (r) =>
  r.tool ? `tool:${r.tool}` : `${r.action}:${r.path}`;

/** @returns {{allow:boolean, rule:string, layer:'deny'|'allow'|'default', note:string}} */
export function authorize(contract, action) {
  const a = { ...action, path: action.path ? action.path.replace(/\\/g, '/') : undefined };

  for (const r of contract.deny ?? []) {
    if (ruleMatches(r, a)) {
      return { allow: false, rule: describe(r), layer: 'deny', note: r.note ?? '' };
    }
  }
  for (const r of contract.allow ?? []) {
    if (ruleMatches(r, a)) {
      return { allow: true, rule: describe(r), layer: 'allow', note: r.note ?? '' };
    }
  }
  return {
    allow: false,
    rule: 'defaultPolicy=deny',
    layer: 'default',
    note: '未命中任何白名单 → 默认拒绝',
  };
}

/**
 * 执行门：只有被授权的动作才会真正执行 effect。
 * @param {(action)=>any} effect 真正产生副作用的函数
 */
export function enforce(contract, action, effect) {
  const d = authorize(contract, action);
  if (!d.allow) return { ok: false, decision: d, result: null };
  return { ok: true, decision: d, result: effect(action) };
}

/** 审计留痕（append-only） */
export function audit(logPath, action, decision) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify({
    ts: new Date().toISOString(),
    e: 'capability.decision',
    action: action.tool ? `tool:${action.tool}` : `${action.action}:${action.path}`,
    allow: decision.allow,
    layer: decision.layer,
    rule: decision.rule,
  }) + '\n', 'utf8');
}
