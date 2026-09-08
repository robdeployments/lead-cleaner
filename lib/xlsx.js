'use strict';
const ExcelJS = require('exceljs');

/**
 * Streaming XLSX sink with the same .write()/.close() shape as CsvWriter,
 * so cleanFile doesn't care which format it is feeding.
 */
class XlsxWriter {
  constructor(filePath, headers) {
    this.wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true });
    this.ws = this.wb.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] });
    this.ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(14, h.length + 4) }));
    this.ws.getRow(1).font = { bold: true };
    this.ws.getRow(1).commit();
  }
  write(values) {
    const row = this.ws.addRow(values);
    // Keep phone and postal code as text so Excel can't eat the + or a leading zero.
    row.getCell(4).numFmt = '@';
    row.getCell(8).numFmt = '@';
    row.commit();
  }
  async close() {
    this.ws.commit();
    await this.wb.commit();
  }
}

/** Fan writes out to several sinks at once (CSV and XLSX in one pass). */
class MultiWriter {
  constructor(writers) { this.writers = writers; }
  write(values) { for (const w of this.writers) w.write(values); }
  async close() { for (const w of this.writers) await w.close(); }
}

module.exports = { XlsxWriter, MultiWriter };
