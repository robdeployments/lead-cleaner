'use strict';
const path = require('path');
const fs = require('fs');

const { CsvWriter } = require('./csv');
const { cleanFile, newState, OUTPUT_HEADERS } = require('./clean');
const { XlsxWriter, MultiWriter } = require('./xlsx');

const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Never silently overwrite an earlier run: add a timestamp if the name is taken. */
function outPath(folder, base, ext) {
  let f = path.join(folder, `${base}_clean.${ext}`);
  if (fs.existsSync(f)) f = path.join(folder, `${base}_clean_${stamp()}.${ext}`);
  return f;
}

/**
 * Clean every file in `files` into `opts.outputFolder`.
 * Pure of Electron so it can be run and tested headlessly.
 * onProgress({index, total, name, rows}) is optional.
 */
async function runBatch(files, opts, onProgress = () => {}) {
  const folder = opts.outputFolder;
  if (!folder) return { error: 'Pick an output folder first.' };
  if (!opts.formatCsv && !opts.formatXlsx) return { error: 'Pick at least one output format.' };
  try { fs.mkdirSync(folder, { recursive: true }); }
  catch (err) { return { error: `Cannot write to that folder: ${err.message}` }; }

  const shared = newState();
  const results = [];

  for (let i = 0; i < files.length; i++) {
    const src = files[i];
    const name = path.basename(src);
    const base = name.replace(/\.[^.]+$/, '');
    const state = opts.dedupeAcrossFiles ? shared : newState();
    const before = {
      noPhone: state.noPhone, dupePhone: state.dupePhone,
      dnc: state.dncScrubbed, borrowed: state.emailBorrowed,
    };

    const written = [];
    try {
      const writers = [];
      if (opts.formatCsv)  { const f = outPath(folder, base, 'csv');  writers.push(new CsvWriter(f, OUTPUT_HEADERS));  written.push(f); }
      if (opts.formatXlsx) { const f = outPath(folder, base, 'xlsx'); writers.push(new XlsxWriter(f, OUTPUT_HEADERS)); written.push(f); }
      const sink = new MultiWriter(writers);

      onProgress({ index: i, total: files.length, name, rows: 0 });
      const r = await cleanFile(src, sink, opts, state,
        (rows) => onProgress({ index: i, total: files.length, name, rows }));
      await sink.close();

      results.push({
        name, ok: true, outputs: written, read: r.read, written: r.written,
        noPhone: state.noPhone - before.noPhone,
        dupePhone: state.dupePhone - before.dupePhone,
        dncScrubbed: state.dncScrubbed - before.dnc,
        emailBorrowed: state.emailBorrowed - before.borrowed,
        detection: r.detection,
      });
    } catch (err) {
      for (const f of written) { try { fs.unlinkSync(f); } catch {} }
      results.push({ name, ok: false, error: err.message });
    }
  }

  return { results, folder };
}

module.exports = { runBatch, outPath };
