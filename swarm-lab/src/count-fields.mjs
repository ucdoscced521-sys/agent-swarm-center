#!/usr/bin/env node
import fs from 'node:fs';
const file = process.argv[2];
if (!file) { console.error('usage: count-fields.mjs <json-file>'); process.exit(2); }
if (!fs.existsSync(file)) { console.error('file not found: ' + file); process.exit(3); }
try {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    console.error('top level must be a JSON object'); process.exit(4);
  }
  console.log(Object.keys(data).length);
} catch (e) { console.error('invalid json: ' + e.message); process.exit(5); }
