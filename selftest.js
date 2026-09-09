#!/usr/bin/env node
'use strict';
/**
 * Smoke test: runs the real pipeline the app uses, against a file you pass in.
 *   node selftest.js "/path/to/export.csv"
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const { runBatch } = require('./lib/pipeline');
const { readHeader } = require('./lib/csv');
const { detect, describe } = require('./lib/detect');
const { normPhone, formatPhone } = require('./lib/clean');

// Every shape an export might carry must reduce to the same ten digits.
const PHONE_ACCEPT = [
  '+1703 439 9049', '+1703-439-9049', '(703)-439-9049', '(703) 439-9049',
  '703.439.9049', '703 439 9049', '7034399049', '1-703-439-9049',
  '1 (703) 439-9049', '+1 (703) 439-9049', '+17034399049', '001-703-439-9049',
  '011-1-703-439-9049', '703/439/9049', '[703] 439.9049', '="(703) 439-9049"',
  '7034399049.0', '7.034399049e+09', '703-439-9049 x123', '703-439-9049 ext. 5',
  '(703) 439-9049 #22', 'cell 703-439-9049 / home 571-309-6400',
  'Ph: +1 703 439 9049 (mobile)',
];
const PHONE_REJECT = [
  '', 'N/A', 'none', '-', '0000000000', '1111111111', '123', '70343990',
  '911-439-9049', '411-555-1234', '+44 20 7946 0958', 'abc', '(103) 439-9049',
  '703-139-9049',
];

const srcs = process.argv.slice(2);
if (!srcs.length) { console.error('usage: node selftest.js <file.csv> [more.csv ...]'); process.exit(2); }

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadclean-'));
let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
};

(async () => {
  for (const s of srcs) {
    console.log('\nDETECT ' + path.basename(s));
    const info = describe(detect(await readHeader(s)));
    console.log('  ' + JSON.stringify(info));
  }

  console.log('\nRUN (csv + xlsx, defaults)');
  const res = await runBatch(srcs, {
    outputFolder: outDir, formatCsv: true, formatXlsx: true,
    scrubDnc: false, requirePhone: true, dedupePhone: true,
    dedupeAcrossFiles: true, borrowEmail: false,
  });
  if (res.error) { console.error('  ERROR ' + res.error); process.exit(1); }

  for (const r of res.results) {
    console.log(`\n${r.name}: read ${r.read}, wrote ${r.written}, noPhone ${r.noPhone}, dupe ${r.dupePhone}`);
    check('run succeeded', r.ok, r.error || '');
    if (!r.ok) continue;
    check('produced 2 files', r.outputs.length === 2);
    for (const f of r.outputs) check('file exists and is non-empty: ' + path.basename(f), fs.existsSync(f) && fs.statSync(f).size > 0);

    const csv = r.outputs.find((f) => f.endsWith('.csv'));
    const lines = fs.readFileSync(csv, 'utf8').trim().split(/\r?\n/);
    check('header is exactly the 8 agreed columns',
      lines[0] === 'First Name,Last Name,Email,Phone,Address,City,State,Postal Code', lines[0]);
    check('row count matches reported', lines.length - 1 === r.written, `${lines.length - 1} vs ${r.written}`);

    const body = lines.slice(1).map((l) => l.split(','));
    const badAccept = PHONE_ACCEPT.filter((v) => normPhone(v) !== '7034399049');
    check('all input phone formats normalise to one number', badAccept.length === 0, badAccept.join(' | '));
    const badReject = PHONE_REJECT.filter((v) => normPhone(v) !== '');
    check('unusable phone values are rejected', badReject.length === 0, badReject.join(' | '));
    check('canonical output shape', formatPhone('7034399049') === '+1703 439 9049', formatPhone('7034399049'));

    check('every row has a phone', body.every((c) => c[3] && c[3].length));
    check('every phone is +1XXX XXX XXXX', body.every((c) => /^\+1\d{3} \d{3} \d{4}$/.test(c[3])));
    check('phones are unique', new Set(body.map((c) => c[3])).size === body.length);
    check('every row has an address', body.every((c) => c[4] && c[4].length));
    check('every row has a name', body.every((c) => (c[0] && c[0].length) || (c[1] && c[1].length)));
    check('no Excel ="" wrappers survive', !fs.readFileSync(csv, 'utf8').includes('="'));
  }

  console.log(`\noutput: ${outDir}`);
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
