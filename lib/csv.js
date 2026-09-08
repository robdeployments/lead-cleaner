'use strict';
const fs = require('fs');

/**
 * Streaming RFC 4180 CSV reader.
 * Handles quoted fields, embedded commas/newlines/quotes, CRLF, and a UTF-8 BOM.
 * Calls onRow(arrayOfStrings) for every record, then returns a promise.
 */
function readCsv(filePath, onRow) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });

    let field = '';
    let row = [];
    let inQuotes = false;
    let quoteJustClosed = false;
    let sawAnyChar = false;
    let count = 0;
    let bomStripped = false;

    const endField = () => { row.push(field); field = ''; };
    const endRow = () => {
      endField();
      // Skip a trailing empty line (a single empty field and nothing else).
      if (!(row.length === 1 && row[0] === '')) { onRow(row); count++; }
      row = [];
    };

    stream.on('data', (chunk) => {
      if (!bomStripped) {
        if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
        bomStripped = true;
      }
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (inQuotes) {
          if (c === '"') { inQuotes = false; quoteJustClosed = true; }
          else field += c;
          continue;
        }
        if (quoteJustClosed) {
          quoteJustClosed = false;
          if (c === '"') { field += '"'; inQuotes = true; continue; } // escaped ""
        }
        if (c === '"' && field === '') { inQuotes = true; sawAnyChar = true; continue; }
        if (c === ',') { endField(); sawAnyChar = true; continue; }
        if (c === '\r') continue;
        if (c === '\n') { endRow(); sawAnyChar = true; continue; }
        field += c;
        sawAnyChar = true;
      }
    });

    stream.on('end', () => {
      if (inQuotes || field !== '' || row.length) endRow();
      if (!sawAnyChar) return resolve(0);
      resolve(count);
    });
    stream.on('error', reject);
  });
}

/** Read only the header row, cheaply. */
function readHeader(filePath) {
  return new Promise((resolve, reject) => {
    let header = null;
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 16 });
    let field = '', row = [], inQuotes = false, quoteJustClosed = false, bomStripped = false;
    stream.on('data', (chunk) => {
      if (header) return;
      if (!bomStripped) {
        if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1);
        bomStripped = true;
      }
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];
        if (inQuotes) {
          if (c === '"') { inQuotes = false; quoteJustClosed = true; } else field += c;
          continue;
        }
        if (quoteJustClosed) {
          quoteJustClosed = false;
          if (c === '"') { field += '"'; inQuotes = true; continue; }
        }
        if (c === '"' && field === '') { inQuotes = true; continue; }
        if (c === ',') { row.push(field); field = ''; continue; }
        if (c === '\r') continue;
        if (c === '\n') { row.push(field); header = row; stream.destroy(); return resolve(header); }
        field += c;
      }
    });
    stream.on('close', () => { if (!header) { row.push(field); resolve(row); } });
    stream.on('error', reject);
  });
}

const NEEDS_QUOTE = /[",\r\n]/;
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return NEEDS_QUOTE.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Buffered CSV writer so big exports don't build one giant string in memory. */
class CsvWriter {
  constructor(filePath, headers) {
    this.stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
    this.buf = headers.map(csvCell).join(',') + '\r\n';
  }
  write(values) {
    this.buf += values.map(csvCell).join(',') + '\r\n';
    if (this.buf.length > 1 << 20) { this.stream.write(this.buf); this.buf = ''; }
  }
  close() {
    return new Promise((resolve, reject) => {
      this.stream.on('error', reject);
      this.stream.end(this.buf, resolve);
      this.buf = '';
    });
  }
}

module.exports = { readCsv, readHeader, CsvWriter, csvCell };
