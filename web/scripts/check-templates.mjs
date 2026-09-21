#!/usr/bin/env node
/**
 * Does every value key the renderer reads actually exist in the template
 * contract the API serves?
 *
 * Checked against the LIVE API rather than against backend source, deliberately:
 * source can be ahead of what is deployed, and the renderer talks to the
 * deployed thing. A rename that has not shipped yet should not fail this, and a
 * rename that HAS shipped must.
 *
 * Follows the backend's `check:*` convention — no test framework, one script,
 * non-zero exit on a real problem.
 *
 *   npm run check:templates
 *   API_BASE=http://127.0.0.1:8092 npm run check:templates
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API_BASE = (process.env.API_BASE ?? 'https://momentica.ferbotz.com/api').replace(/\/+$/, '');

const manifestPath = fileURLToPath(new URL('../src/templates/manifest.json', import.meta.url));
const { templates } = JSON.parse(readFileSync(manifestPath, 'utf8'));

/** groupList children are one level deep, and a template may read those too. */
function declaredKeys(fields) {
  const keys = new Set();
  for (const field of fields ?? []) {
    keys.add(field.key);
    for (const child of field.fields ?? []) keys.add(child.key);
  }
  return keys;
}

const problems = [];
let checked = 0;

for (const entry of templates) {
  let contract;
  try {
    const response = await fetch(`${API_BASE}/v1/templates/${entry.id}`);
    if (!response.ok) {
      problems.push(`${entry.id}: API returned ${response.status} — is it live in the registry?`);
      continue;
    }
    const body = await response.json();
    contract = body?.data;
  } catch (error) {
    problems.push(`${entry.id}: could not reach ${API_BASE} (${error.message})`);
    continue;
  }

  if (!contract?.fields) {
    problems.push(`${entry.id}: API response carried no field contract.`);
    continue;
  }

  const declared = declaredKeys(contract.fields);
  const missing = entry.readsKeys.filter((key) => !declared.has(key));
  if (missing.length > 0) {
    problems.push(
      `${entry.id}: reads keys the API does not declare -> ${missing.join(', ')}\n` +
        `    declared: ${[...declared].join(', ')}`,
    );
  }

  // Not a failure — a template may legitimately choose not to render an
  // optional field — but worth seeing, because it is usually an oversight.
  const unread = [...declared].filter((key) => !entry.readsKeys.includes(key));
  if (unread.length > 0) {
    console.log(`  note  ${entry.id}: declared but not rendered -> ${unread.join(', ')}`);
  }

  checked += 1;
}

if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`\n✓ ${checked} template(s) match the contract at ${API_BASE}\n`);
