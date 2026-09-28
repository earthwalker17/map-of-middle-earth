#!/usr/bin/env node
// Restore / verify fetched third-party data (never committed):
//   data      data/source/manifest.json        geography sources (Arda DEM + vectors, ME-GIS); the four
//                                              32k DEM GeoTIFF quadrants (~160-315 MB each) come from a
//                                              GitHub release and are streamed to disk with progress
//   textures  public/textures/_manifest.json   Poly Haven CC0 PBR maps
//
//   node tools/refs/fetch-data.mjs                         fetch missing / sha-mismatched files
//   node tools/refs/fetch-data.mjs --check                 verify only (exit 1 on any problem)
//   options: --only data|textures   --match <text>   --keep-mismatch
import { loadManifest, parseArgs, syncItems } from './lib.mjs';

const SETS = {
  data: 'data/source/manifest.json',
  textures: 'public/textures/_manifest.json',
};
const USAGE = 'usage: node tools/refs/fetch-data.mjs [--check] [--only data|textures] [--match <text>] [--keep-mismatch]';

let args;
try {
  args = parseArgs(process.argv.slice(2), { values: ['only', 'match'] });
  for (const f of args.flags) if (!['check', 'keep-mismatch', 'help'].includes(f)) throw new Error(`unknown flag --${f}`);
  if (args.opts.only && !(args.opts.only in SETS)) throw new Error(`--only must be one of: ${Object.keys(SETS).join(', ')}`);
} catch (e) {
  console.error(`${e.message}\n${USAGE}`);
  process.exit(2);
}
if (args.flags.has('help')) {
  console.log(USAGE);
  process.exit(0);
}

let problems = 0;
for (const [name, manifest] of Object.entries(SETS)) {
  if (args.opts.only && args.opts.only !== name) continue;
  let items = await loadManifest(manifest);
  if (args.opts.match) items = items.filter((it) => it.file.includes(args.opts.match));
  problems += await syncItems(`${name} (${manifest})`, items, {
    check: args.flags.has('check'),
    keepMismatch: args.flags.has('keep-mismatch'),
  });
}
console.log(problems ? `\n${problems} problem(s).` : '\nAll fetchable data files present and verified.');
process.exitCode = problems ? 1 : 0;
