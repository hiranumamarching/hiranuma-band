// 外部サービスを使わない、架空データ専用のGAS実行環境。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
function createHarness() {
  const sheets = new Map(), properties = new Map();
  let locked = false, writes = 0;
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
    getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    setFrozenRows() {}
    getRange(row, col, height, width) {
      const sheet = this;
      return {
        getValues() { return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => sheet.rows[row - 1 + y]?.[col - 1 + x] ?? '')); },
        setValues(values) {
          if (values.length !== height || values.some(r => r.length !== width)) throw new Error('range shape mismatch');
          for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const yy = row - 1 + y, xx = col - 1 + x; sheet.rows[yy] ||= [];
            if (sheet.rows[yy][xx] !== undefined && sheet.rows[yy][xx] !== '') throw new Error(`既存セル上書き: ${sheet.name} ${yy},${xx}`);
            let value = values[y][x];
            if (typeof value === 'string' && value.startsWith("'")) value = value.slice(1);
            sheet.rows[yy][xx] = value;
          }
          writes++; return this;
        },
        setFontWeight() { return this; }, setBackground() { return this; }
      };
    }
  }
  const spreadsheet = { getSheetByName: name => sheets.get(name), insertSheet: name => { const s = new Sheet(name); sheets.set(name, s); return s; }, getId: () => 'DUMMY_DATABASE', getUrl: () => 'https://example.invalid/dummy' };
  const propertyStore = { getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) };
  const context = vm.createContext({ Date, console, PropertiesService: { getScriptProperties: () => propertyStore }, SpreadsheetApp: { create: () => spreadsheet, openById: id => { if (id !== 'DUMMY_DATABASE') throw new Error('unknown database'); return spreadsheet; } }, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Tokyo' }, Utilities: { getUuid: randomUUID, formatDate: (date, zone, format) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`, time = `${parts.hour}:${parts.minute}`;
    return format === 'yyyy-MM-dd' ? day : format === 'HH:mm' ? time : `${day}T${time}:${parts.second}`;
  } }, LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) }, ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) } });
  for (const file of ['setup.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas', file), 'utf8'), context, { filename: file });
  function post(request) { return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(request) } }).text); }
  function admin(action, payload = {}) { const response = post({ ...payload, action, a: properties.get('ADMIN_TOKEN') }); if (!response.ok) throw Object.assign(new Error(response.message), { code: response.error }); return response.data; }
  return { context, sheets, spreadsheet, properties, post, admin, get writes() { return writes; }, get locked() { return locked; } };
}
module.exports = { createHarness };
