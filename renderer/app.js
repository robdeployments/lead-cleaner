'use strict';
const $ = (id) => document.getElementById(id);

const CHECKS = ['formatCsv', 'formatXlsx', 'scrubDnc', 'requirePhone', 'dedupePhone', 'dedupeAcrossFiles', 'borrowEmail'];
let files = [];     // [{path, name, size, usable, phoneCols, contacts, missing, error}]
let settings = {};
let running = false;

const fmtBytes = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB'
  : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B';
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

async function boot() {
  settings = await window.api.getSettings();
  for (const k of CHECKS) $(k).checked = !!settings[k];
  $('outputFolder').value = settings.outputFolder || '';
  syncScope();
  render();
}

function syncScope() { $('scopeWrap').classList.toggle('hidden', !$('dedupePhone').checked); }

async function persist(patch) { settings = await window.api.setSettings(patch); }

for (const k of CHECKS) {
  $(k).addEventListener('change', () => {
    persist({ [k]: $(k).checked });
    if (k === 'dedupePhone') syncScope();
    render();
  });
}

$('pickFolder').addEventListener('click', async () => {
  const f = await window.api.pickFolder();
  if (f) { $('outputFolder').value = f; await persist({ outputFolder: f }); render(); }
});

async function addFiles(paths) {
  const fresh = paths.filter((p) => !files.some((f) => f.path === p));
  if (!fresh.length) return;
  $('status').textContent = 'Reading headers…';
  const info = await window.api.inspect(fresh);
  files = files.concat(info);
  render();
}

$('pick').addEventListener('click', async () => addFiles(await window.api.pickFiles()));
$('addMore').addEventListener('click', async () => addFiles(await window.api.pickFiles()));
$('clear').addEventListener('click', () => { files = []; render(); });

// Drag and drop straight from Finder / Explorer.
const dz = $('dropzone');
['dragenter', 'dragover'].forEach((e) => document.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => document.addEventListener(e, (ev) => { ev.preventDefault(); if (e === 'drop' || ev.relatedTarget === null) dz.classList.remove('over'); }));
document.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const paths = [...(ev.dataTransfer?.files || [])]
    .map((f) => window.api.pathFor ? window.api.pathFor(f) : f.path)
    .filter((p) => p && /\.(csv|tsv|txt)$/i.test(p));
  if (paths.length) addFiles(paths);
});

function render() {
  $('filesPanel').classList.toggle('hidden', files.length === 0);
  $('fileCount').textContent = files.length;
  const list = $('fileList');
  list.textContent = '';

  files.forEach((f, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'fname'; name.textContent = f.name; name.title = f.path;
    li.appendChild(name);

    const meta = document.createElement('span');
    if (f.error) { meta.className = 'err'; meta.textContent = f.error; }
    else if (!f.usable) { meta.className = 'err'; meta.textContent = 'No phone columns found'; }
    else {
      meta.className = 'meta';
      const bits = [fmtBytes(f.size), `${f.phoneCols} phones`];
      if (f.missing && f.missing.length) bits.push(`missing ${f.missing.join('/')}`);
      meta.textContent = bits.join(' · ');
    }
    li.appendChild(meta);

    const rm = document.createElement('button');
    rm.className = 'rm'; rm.textContent = '×'; rm.title = 'Remove';
    rm.addEventListener('click', () => { files.splice(i, 1); render(); });
    li.appendChild(rm);
    list.appendChild(li);
  });

  const usable = files.filter((f) => f.usable).length;
  const hasFormat = $('formatCsv').checked || $('formatXlsx').checked;
  $('run').disabled = running || !usable || !$('outputFolder').value || !hasFormat;
  $('run').textContent = running ? 'Working…' : usable > 1 ? `Clean ${usable}` : 'Clean';

  if (running) return;
  if (!files.length) $('status').textContent = '';
  else if (!usable) $('status').textContent = 'No phone columns found.';
  else if (!hasFormat) $('status').textContent = 'Pick a format.';
  else if (!$('outputFolder').value) $('status').textContent = 'Pick an output folder.';
  else $('status').textContent = `${plural(usable, 'file')} ready`;
}

// Files handed over by the OS: launch arguments, or Finder's Open With.
window.api.onOpenFiles((paths) => addFiles(paths));

window.api.onProgress((d) => {
  $('status').textContent = d.rows
    ? `[${d.index + 1}/${d.total}] ${d.name} — ${d.rows.toLocaleString()} rows read…`
    : `[${d.index + 1}/${d.total}] ${d.name}…`;
});

$('run').addEventListener('click', async () => {
  const usable = files.filter((f) => f.usable);
  if (!usable.length) return;
  running = true; render();
  $('status').textContent = 'Starting…';

  const opts = { outputFolder: $('outputFolder').value };
  for (const k of CHECKS) opts[k] = $(k).checked;

  const res = await window.api.run({ files: usable.map((f) => f.path), opts });
  running = false;

  if (res.error) { $('status').textContent = res.error; render(); return; }
  showResults(res);
  render();
});

let lastOutput = null;

function showResults(res) {
  const body = $('resultsBody');
  body.textContent = '';
  let total = 0, failed = 0;
  lastOutput = null;

  for (const r of res.results) {
    const box = document.createElement('div');
    box.className = 'result' + (r.ok ? '' : ' fail');
    const h = document.createElement('h3'); h.textContent = r.name; box.appendChild(h);

    if (!r.ok) {
      failed++;
      const p = document.createElement('p'); p.className = 'sub'; p.textContent = r.error;
      box.appendChild(p);
    } else {
      total += r.written;
      if (!lastOutput && r.outputs.length) lastOutput = r.outputs[0];

      const n = document.createElement('div');
      n.className = 'big-num'; n.textContent = plural(r.written, 'clean row');
      box.appendChild(n);

      const dl = document.createElement('dl');
      const add = (k, v) => {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.appendChild(dt); dl.appendChild(dd);
      };
      add('Rows read', r.read.toLocaleString());
      if (r.noPhone) add('Dropped, no phone', r.noPhone.toLocaleString());
      if (r.dupePhone) add('Dropped, duplicate phone', r.dupePhone.toLocaleString());
      if (r.dncScrubbed) add('DNC numbers removed', r.dncScrubbed.toLocaleString());
      if (r.emailBorrowed) add('Emails from another contact', r.emailBorrowed.toLocaleString());
      for (const o of r.outputs) add('Saved', o.split(/[\\/]/).pop());
      box.appendChild(dl);
    }
    body.appendChild(box);
  }

  $('resultsTitle').textContent = failed
    ? `Finished with ${plural(failed, 'problem')}`
    : `${plural(total, 'clean row')} saved`;
  $('revealBtn').disabled = !lastOutput;
  $('resultsOverlay').classList.remove('hidden');
  $('status').textContent = `Saved to ${res.folder}`;
}

$('closeResults').addEventListener('click', () => $('resultsOverlay').classList.add('hidden'));
$('resultsOverlay').addEventListener('click', (e) => { if (e.target === $('resultsOverlay')) $('resultsOverlay').classList.add('hidden'); });
$('revealBtn').addEventListener('click', () => { if (lastOutput) window.api.reveal(lastOutput); });

boot();
