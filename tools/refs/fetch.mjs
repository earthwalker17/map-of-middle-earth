#!/usr/bin/env node
// Restore / verify dev-only reference material listed in reference/manifest.json.
//
//   node tools/refs/fetch.mjs            re-download missing or sha-mismatched files
//   node tools/refs/fetch.mjs --check    verify only (exit 1 if any fetchable file is missing/mismatched)
//   options: --match <text>              only items whose path contains <text>
//            --keep-mismatch             keep a download even if its sha256 differs (upstream changed)
//
// Items with url null (e.g. the user-supplied LEGO renders) are never downloaded, only verified.
import { loadManifest, parseArgs, syncItems } from './lib.mjs';

const USAGE = 'usage: node tools/refs/fetch.mjs [--check] [--match <text>] [--keep-mismatch]';

let args;
try {
  args = parseArgs(process.argv.slice(2), { values: ['match'] });
  for (const f of args.flags) if (!['check', 'keep-mismatch', 'help'].includes(f)) throw new Error(`unknown flag --${f}`);
} catch (e) {
  console.error(`${e.message}\n${USAGE}`);
  process.exit(2);
}
if (args.flags.has('help')) {
  console.log(USAGE);
  process.exit(0);
}

let items = await loadManifest('reference/manifest.json');
if (args.opts.match) items = items.filter((it) => it.file.includes(args.opts.match));

const problems = await syncItems('reference', items, {
  check: args.flags.has('check'),
  keepMismatch: args.flags.has('keep-mismatch'),
});
console.log(problems ? `\n${problems} problem(s).` : '\nAll fetchable reference files present and verified.');
process.exitCode = problems ? 1 : 0;
