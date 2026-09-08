'use strict';
const { readCsv, readHeader, CsvWriter } = require('./csv');
const { detect, describe } = require('./detect');

const OUTPUT_HEADERS = ['First Name', 'Last Name', 'Email', 'Phone', 'Address', 'City', 'State', 'Postal Code'];

/** Exports wrap values as ="(703) 439-9049" to stop Excel mangling them. Strip that. */
function raw(v) {
  if (v == null) return '';
  let s = String(v).trim();
  if (s.length > 3 && s.charCodeAt(0) === 61 && s.charCodeAt(1) === 34 && s.endsWith('"')) {
    s = s.slice(2, -1);
  }
  return s.trim();
}

/** 10 US digits, or '' if the value can't be one. */
function normPhone(v) {
  const d = raw(v).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return d.length === 10 ? d : '';
}

function formatPhone(d, style) {
  if (!d) return '';
  if (style === 'digits') return d;
  if (style === 'pretty') return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return '+1' + d;
}

/** MM/DD/YYYY or YYYY-MM-DD -> sortable YYYYMMDD number. Unparseable dates sort last. */
function seenScore(v) {
  const s = raw(v);
  if (!s) return -1;
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return +m[3] * 10000 + +m[1] * 100 + +m[2];
  m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (m) return +m[1] * 10000 + +m[2] * 100 + +m[3];
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  return -1;
}

const EMAIL_RX = /^[^\s@,;]+@[^\s@,;.]+\.[^\s@,;]{2,}$/;
function normEmail(v) {
  const s = raw(v).toLowerCase();
  return EMAIL_RX.test(s) ? s : '';
}

/**
 * Exports arrive in mixed case. Re-case only values that are entirely uppercase
 * so already-clean names like "McDonald" are left alone.
 */
function normName(v) {
  const s = raw(v).replace(/\s+/g, ' ');
  if (!s || s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s'\-.])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
          .replace(/\bMc([a-z])/g, (_, ch) => 'Mc' + ch.toUpperCase());
}

const DNC_RX = /^(y|yes|true|1)$/i;

/**
 * Turn one source row into an output row, or null if it should be dropped.
 * `state` carries the cross-row dedupe set and the running counters.
 */
function buildRow(cols, map, opts, state) {
  const at = (i) => (i >= 0 && i < cols.length ? cols[i] : '');

  // --- 1. Collect every phone on the row, keeping the contact block it came from.
  const cands = [];
  const seenInRow = new Set();
  for (const c of map.contacts) {
    for (const p of c.phones) {
      const d = normPhone(at(p.i));
      if (!d || seenInRow.has(d)) continue;   // drop repeats within the same row
      seenInRow.add(d);
      const dnc = DNC_RX.test(raw(at(p.dnc)));
      if (opts.scrubDnc && dnc) { state.dncScrubbed++; continue; }
      cands.push({ d, dnc, contact: c, order: cands.length, score: seenScore(at(p.seen)) });
    }
  }

  if (!cands.length) {
    state.noPhone++;
    if (opts.requirePhone) return null;
  }

  // --- 2. Freshest number wins; column order breaks ties.
  cands.sort((a, b) => (b.score - a.score) || (a.order - b.order));
  const best = cands[0] || null;

  if (best && opts.dedupePhone) {
    if (state.seenPhones.has(best.d)) { state.dupePhone++; return null; }
    state.seenPhones.add(best.d);
  }

  // --- 3. Name: the contact tied to the winning phone, then owners. Never an agent.
  let first = '', last = '';
  if (best) { first = normName(at(best.contact.first)); last = normName(at(best.contact.last)); }
  if (!first && !last) {
    for (const c of map.contacts) {
      const f = normName(at(c.first)), l = normName(at(c.last));
      if (f || l) { first = f; last = l; break; }
    }
  }
  if (!first && !last) {
    for (const o of map.owners) {
      const f = normName(at(o.first)), l = normName(at(o.last));
      if (f || l) { first = f; last = l; break; }
    }
  }
  if (!first && !last) {
    for (const o of map.owners) {
      const b = normName(at(o.biz));
      if (b) { last = b; break; }   // company records carry the name in Last Name
    }
  }

  // --- 4. Email: only the matched contact's own addresses by default, since an
  // address from another contact block belongs to a different person.
  let email = '';
  const firstEmailIn = (c) => {
    for (const e of c.emails) { const v = normEmail(at(e.i)); if (v) return v; }
    return '';
  };
  if (best) email = firstEmailIn(best.contact);
  if (!email && (!best || opts.borrowEmail)) {
    for (const c of map.contacts) {
      if (best && c === best.contact) continue;
      const v = firstEmailIn(c);
      if (v) { email = v; if (best) state.emailBorrowed++; break; }
    }
  }

  return [
    first,
    last,
    email,
    best ? formatPhone(best.d, opts.phoneFormat) : '',
    raw(at(map.address)),
    raw(at(map.city)),
    raw(at(map.state)),
    raw(at(map.zip)),
  ];
}

function newState() {
  return { seenPhones: new Set(), noPhone: 0, dupePhone: 0, dncScrubbed: 0, emailBorrowed: 0 };
}

/**
 * Clean one file into `sink` (anything with .write(rowArray)).
 * `state` is shared across files when deduping over a whole batch.
 */
async function cleanFile(filePath, sink, opts, state, onProgress) {
  const header = await readHeader(filePath);
  const map = detect(header);
  const info = describe(map);
  if (!info.usable) {
    const err = new Error('No Contact#_Phone# columns found. This file does not look like a skip-trace export.');
    err.detection = info;
    throw err;
  }

  let read = 0, written = 0, isHeader = true;
  await readCsv(filePath, (cols) => {
    if (isHeader) { isHeader = false; return; }
    if (cols.length === 1 && cols[0] === '') return;
    read++;
    const out = buildRow(cols, map, opts, state);
    if (out) { sink.write(out); written++; }
    if (onProgress && read % 5000 === 0) onProgress(read);
  });

  return { read, written, detection: info, header };
}

module.exports = {
  OUTPUT_HEADERS, cleanFile, buildRow, newState,
  raw, normPhone, formatPhone, seenScore, normEmail, normName,
};
