/**
 * 平沼マーチングバンド 運営支援アプリの初期化スクリプト。
 * GAS エディタに setup.gs と Code.gs を貼り付けてから、setupBandDatabase() を一度だけ実行する。
 * 既存の「全器材」スプレッドシートには触れない。
 */

const BAND_DB_SCHEMA = {
  m_households: ['家庭ID', '家庭名', '緊急連絡先', '招待トークン', '在籍'],
  m_guardians: ['保護者ID', '家庭ID', '表示名', '対応可能な役割', '在籍'],
  m_members: ['子どもID', '家庭ID', '氏名', '基本担当楽器', '在籍'],
  m_teachers: ['先生ID', '氏名', '招待トークン', '在籍'],
  m_places: ['場所ID', '名称', '並び順'],
  months: ['月ID', '状態', '先生入力締切', '保護者入力締切'],
  sessions: ['予定ID', '月ID', '日付', '種別', 'staffing_am', '担当先生ID_am', 'staffing_pm', '担当先生ID_pm', '集合', '開始', '終了', '解散', '場所ID', '確定状態', '備考'],
  session_selfpractice: ['予定ID', '鍵の担当', '中止判断者', '緊急連絡先', '施設使用申請済', '実施報告'],
  teacher_availability: ['先生ID', '予定ID', '枠', '可否', '送信時刻'],
  attendance: ['子どもID', '予定ID', '午前', '午後', '連絡事項', '入力者', '送信時刻'],
  duty_offers: ['保護者ID', '予定ID', '可否', 'メモ', '送信時刻'],
  duty_assignments: ['予定ID', '役割', '保護者ID', '区分', '更新時刻'],
  events: ['予定ID', '本番名', '会場', '衣装', '子どもの持ち物', '全体連絡'],
  timeline_items: ['項目ID', '予定ID', '日区分', '時刻', '並び順', 'scope', '種別', '内容', '場所ID', '担当', '担当自由入力', '持ち物', '注意点']
};

/**
 * 新規のアプリ用スプレッドシートを作成する。再実行しても既存行を削除・上書きしない。
 * @return {{spreadsheetId:string, spreadsheetUrl:string, adminToken:string, created:boolean}}
 */
function setupBandDatabase() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty('SPREADSHEET_ID');
  let spreadsheet;
  let created = false;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create('平沼マーチングバンド 運営DB');
    spreadsheetId = spreadsheet.getId();
    properties.setProperty('SPREADSHEET_ID', spreadsheetId);
    created = true;
  }

  Object.keys(BAND_DB_SCHEMA).forEach(function(sheetName) {
    ensureSheet_(spreadsheet, sheetName, BAND_DB_SCHEMA[sheetName]);
  });

  let adminToken = properties.getProperty('ADMIN_TOKEN');
  if (!adminToken) {
    adminToken = createInviteToken_();
    properties.setProperty('ADMIN_TOKEN', adminToken);
  }

  migrateSessionsSchema();
  seedDemoData_(spreadsheet);
  const result = {
    spreadsheetId: spreadsheetId,
    spreadsheetUrl: spreadsheet.getUrl(),
    adminToken: adminToken,
    created: created
  };
  Logger.log(JSON.stringify(result));
  return result;
}

function ensureSheet_(spreadsheet, sheetName, headers) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#eaf0ff');
  }
}

function seedDemoData_(spreadsheet) {
  const householdsSheet = spreadsheet.getSheetByName('m_households');
  if (householdsSheet.getLastRow() > 1) return;

  const householdRows = [];
  const guardianRows = [];
  const memberRows = [];
  for (let index = 1; index <= 10; index += 1) {
    const householdId = 'H' + String(index).padStart(3, '0');
    householdRows.push([householdId, 'テスト家庭' + String(index).padStart(2, '0'), '管理者に確認', createInviteToken_(), true]);
    guardianRows.push(['G' + String(index).padStart(3, '0'), householdId, '保護者' + String(index).padStart(2, '0'), '搬入出・引率・見守り', true]);
    if (index <= 4) {
      guardianRows.push(['G' + String(index + 10).padStart(3, '0'), householdId, '保護者' + String(index).padStart(2, '0') + '補助', '受付・撮影', true]);
    }
  }
  for (let index = 1; index <= 14; index += 1) {
    const householdNumber = index <= 10 ? index : index - 10;
    memberRows.push(['M' + String(index).padStart(3, '0'), 'H' + String(householdNumber).padStart(3, '0'), 'メンバー' + String(index).padStart(2, '0'), '', true]);
  }

  appendSeedRows_(spreadsheet.getSheetByName('m_households'), householdRows);
  appendSeedRows_(spreadsheet.getSheetByName('m_guardians'), guardianRows);
  appendSeedRows_(spreadsheet.getSheetByName('m_members'), memberRows);
  appendSeedRows_(spreadsheet.getSheetByName('m_teachers'), [
    ['T001', 'テスト先生A', createInviteToken_(), true],
    ['T002', 'テスト先生B', createInviteToken_(), true],
    ['T003', 'テスト先生C', createInviteToken_(), true],
    ['T004', 'テスト先生D', createInviteToken_(), true]
  ]);
  appendSeedRows_(spreadsheet.getSheetByName('m_places'), [
    ['P001', '平沼小学校', 1], ['P002', '西公会堂', 2], ['P003', 'ステージ', 3],
    ['P004', '左袖', 4], ['P005', '右袖', 5], ['P006', 'ステージ裏', 6]
  ]);
  appendSeedRows_(spreadsheet.getSheetByName('months'), [['2026-09', '下書き', '', '']]);
  appendSeedRows_(spreadsheet.getSheetByName('sessions'), [
    ['S20260905', '2026-09', '2026-09-05', '通常練習', '未定', '', '未定', '', '09:30', '10:00', '15:00', '15:30', 'P001', '下書き', ''],
    ['S20260912', '2026-09', '2026-09-12', '通常練習', '未定', '', '未定', '', '09:30', '10:00', '15:00', '15:30', 'P001', '下書き', ''],
    ['S20260919', '2026-09', '2026-09-19', '通常練習', '未定', '', '未定', '', '09:30', '10:00', '15:00', '15:30', 'P001', '下書き', ''],
    ['S20260926', '2026-09', '2026-09-26', '通常練習', '未定', '', '未定', '', '09:30', '10:00', '15:00', '15:30', 'P001', '下書き', '']
  ]);
}

function appendSeedRows_(sheet, rows) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function createInviteToken_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** 旧列・既存行を残し、足りないヘッダーと移行行だけを追記する。再実行可能。 */
function migrateSessionsSchema() {
  return withWriteLock_(function() {
    const sheet = getDatabase_().getSheetByName('sessions');
    if (!sheet) throw new Error('sessions がありません。');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const missing = BAND_DB_SCHEMA.sessions.filter(function(key) { return headers.indexOf(key) < 0; });
    if (missing.length) sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    const rows = latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; });
    const migrated = rows.filter(function(row) { return !row.staffing_am; }).map(function(row) {
      const next = copyObject_(row);
      next.staffing_am = row.staffing || '未定';
      next['担当先生ID_am'] = next.staffing_am === '先生あり' ? row['担当先生ID'] || '' : '';
      next.staffing_pm = row['種別'] === '本番' ? '' : next.staffing_am;
      next['担当先生ID_pm'] = row['種別'] === '本番' ? '' : next['担当先生ID_am'];
      return next;
    });
    if (migrated.length) appendObjects_('sessions', migrated);
    return { columnsAdded: missing.length, sessionsMigrated: migrated.length };
  });
}
