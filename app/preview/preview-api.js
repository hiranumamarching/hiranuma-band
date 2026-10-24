(()=>{
'use strict';
// 外部サービスを使わない、架空データ専用のGAS実行環境。
const randomUUID = () => crypto.randomUUID();
function createHarness() {
  const sheets = new Map(), properties = new Map(), externalSpreadsheets = new Map();
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
  function addExternalSpreadsheet(id, definitions) {
    const referenceSheets = new Map();
    Object.entries(definitions).forEach(([name, rows]) => { const sheet = new Sheet(name); sheet.rows = structuredClone(rows); referenceSheets.set(name, sheet); });
    externalSpreadsheets.set(id, { getSheetByName: name => referenceSheets.get(name) });
  }
  const propertyStore = { getProperty: key => properties.get(key), setProperty: (key, value) => properties.set(key, value) };
  const context = ({ Date, console, PropertiesService: { getScriptProperties: () => propertyStore }, SpreadsheetApp: { create: () => spreadsheet, openById: id => { if (id === 'DUMMY_DATABASE') return spreadsheet; if (externalSpreadsheets.has(id)) return externalSpreadsheets.get(id); throw new Error('unknown database'); } }, Logger: { log() {} }, Session: { getScriptTimeZone: () => 'Asia/Tokyo' }, Utilities: { getUuid: randomUUID, formatDate: (date, zone, format) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`, time = `${parts.hour}:${parts.minute}`;
    return format === 'yyyy-MM' ? `${parts.year}-${parts.month}` : format === 'yyyy-MM-dd' ? day : format === 'HH:mm' ? time : `${day}T${time}:${parts.second}`;
  } }, LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) }, ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) } });
  Object.assign(context,((env)=>{const {Date,console,PropertiesService,SpreadsheetApp,Logger,Session,Utilities,LockService,ContentService}=env;
/**
 * 平沼マーチングバンド 運営支援アプリの初期化スクリプト。
 * GAS エディタに setup.gs と Code.gs を貼り付けてから、setupBandDatabase() を一度だけ実行する。
 * 既存の「全器材」スプレッドシートには触れない。
 */

const BAND_DB_SCHEMA = {
  m_instruments: ['楽器ID', '表示名', '有効', '更新時刻'],
  m_households: ['家庭ID', '家庭名', '緊急連絡先', '招待トークン', '在籍'],
  m_guardians: ['保護者ID', '家庭ID', '表示名', '対応可能な役割', '在籍'],
  m_members: ['子どもID', '家庭ID', '氏名', '基本担当楽器', '在籍', '学年'],
  m_teachers: ['先生ID', '氏名', '担当楽器', '招待トークン', '在籍'],
  m_places: ['場所ID', '名称', '並び順', '有効'],
  months: ['月ID', '状態', '先生入力締切', '保護者入力締切'],
  sessions: ['予定ID', '月ID', '日付', '種別', '実施有無_am', 'staffing_am', '担当先生ID_am', '実施有無_pm', 'staffing_pm', '担当先生ID_pm', '集合', '開始', '終了', '解散', '場所ID', '確定状態', '備考', '集合場所ID'],
  session_selfpractice: ['予定ID', '鍵の担当', '中止判断者', '緊急連絡先', '施設使用申請済', '実施報告'],
  teacher_availability: ['先生ID', '予定ID', '枠', '可否', '送信時刻'],
  attendance: ['子どもID', '予定ID', '午前', '午後', '連絡事項', '入力者', '送信時刻'],
  duty_offers: ['保護者ID', '予定ID', '可否', 'メモ', '送信時刻'],
  duty_assignments: ['予定ID', '役割', '保護者ID', '区分', '更新時刻'],
  events: ['予定ID', '本番名', '会場', '衣装', '子どもの持ち物', '全体連絡'],
  event_layouts: ['配置図ID', '予定ID', '図名', '備考', '配置JSON', '有効', '更新時刻'],
  timeline_items: ['項目ID', '予定ID', '日区分', '時刻', '並び順', 'scope', '種別', '内容', '場所ID', '担当', '担当自由入力', '持ち物', '注意点', '有効', 'stageJSON'],
  guide_items: ['項目ID', '種別', '区分', '並び順', '内容', '有効', '更新時刻'],
  annual_event_candidates: ['候補ID', '並び順', '月', '本番名', '日程', '場所', '演奏時間', '楽器運び', '演奏できる楽器', '連絡先', '事前打ち合わせ', 'その他', '有効', '更新時刻'],
  reference_backups: ['バックアップID', '種別', '内容JSON', '作成時刻']
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
  migrateStageSchema();
  migratePlacesSchema();
  migrateMembersSchema();
  migrateTeachersSchema();
  migrateTimelineSchema();
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
    memberRows.push(['M' + String(index).padStart(3, '0'), 'H' + String(householdNumber).padStart(3, '0'), 'メンバー' + String(index).padStart(2, '0'), '', true, '']);
  }

  appendSeedRows_(spreadsheet.getSheetByName('m_households'), householdRows);
  appendSeedRows_(spreadsheet.getSheetByName('m_guardians'), guardianRows);
  appendSeedRows_(spreadsheet.getSheetByName('m_members'), memberRows);
  appendSeedRows_(spreadsheet.getSheetByName('m_teachers'), [
    ['T001', 'テスト先生A', '', createInviteToken_(), true],
    ['T002', 'テスト先生B', '', createInviteToken_(), true],
    ['T003', 'テスト先生C', '', createInviteToken_(), true],
    ['T004', 'テスト先生D', '', createInviteToken_(), true]
  ]);
  appendSeedRows_(spreadsheet.getSheetByName('m_places'), [['P001', '平沼小学校', 1, true]]);
  appendSeedRows_(spreadsheet.getSheetByName('months'), [['2026-09', '下書き', '', '']]);
  appendSeedRows_(spreadsheet.getSheetByName('sessions'), [
    ['S20260905', '2026-09', '2026-09-05', '通常練習', '実施', '未定', '', '実施', '未定', '', '09:45', '10:00', '15:00', '15:15', 'P001', '下書き', ''],
    ['S20260912', '2026-09', '2026-09-12', '通常練習', '実施', '未定', '', '実施', '未定', '', '09:45', '10:00', '15:00', '15:15', 'P001', '下書き', ''],
    ['S20260919', '2026-09', '2026-09-19', '通常練習', '実施', '未定', '', '実施', '未定', '', '09:45', '10:00', '15:00', '15:15', 'P001', '下書き', ''],
    ['S20260926', '2026-09', '2026-09-26', '通常練習', '実施', '未定', '', '実施', '未定', '', '09:45', '10:00', '15:00', '15:15', 'P001', '下書き', '']
  ]);
}

function appendSeedRows_(sheet, rows) {
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function createInviteToken_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** 場所の履歴・表示状態を変えず、有効列だけを必要な場合に追加する。 */
function migratePlacesSchema() {
  return withWriteLock_(function() {
    const sheet = getDatabase_().getSheetByName('m_places');
    if (!sheet) throw new Error('m_places がありません。');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('有効') < 0) sheet.getRange(1, headers.length + 1, 1, 1).setValues([['有効']]);
    return { columnsAdded: headers.indexOf('有効') < 0 ? 1 : 0, retired: 0 };
  });
}

/** 既存の名簿行は残したまま、子どもの学年列だけを末尾に追加する。 */
function migrateMembersSchema() {
  return withWriteLock_(function() {
    const sheet = getDatabase_().getSheetByName('m_members');
    if (!sheet) throw new Error('m_members がありません。');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('学年') >= 0) return { columnsAdded: 0 };
    sheet.getRange(1, headers.length + 1, 1, 1).setValues([['学年']]);
    return { columnsAdded: 1 };
  });
}

/** 既存の先生名簿は残したまま、担当楽器列だけを末尾に追加する。 */
function migrateTeachersSchema() {
  return withWriteLock_(function() {
    const sheet = getDatabase_().getSheetByName('m_teachers');
    if (!sheet) throw new Error('m_teachers がありません。');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('担当楽器') >= 0) return { columnsAdded: 0 };
    sheet.getRange(1, headers.length + 1, 1, 1).setValues([['担当楽器']]);
    return { columnsAdded: 1 };
  });
}

/** 進行項目は履歴を残したまま、有効・無効を切り替えられるようにする。 */
function migrateTimelineSchema() {
  return withWriteLock_(function() {
    const sheet = getDatabase_().getSheetByName('timeline_items');
    if (!sheet) throw new Error('timeline_items がありません。');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('有効') >= 0) return { columnsAdded: 0 };
    const existing = latestRows_(readTable_('timeline_items'), function(row) { return row['項目ID']; });
    sheet.getRange(1, headers.length + 1, 1, 1).setValues([['有効']]);
    if (existing.length) appendObjects_('timeline_items', existing.map(function(row) { row['有効'] = true; return row; }));
    return { columnsAdded: 1, itemsMigrated: existing.length };
  });
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
      next['実施有無_am'] = row['実施有無_am'] || '実施';
      next['担当先生ID_am'] = next.staffing_am === '先生あり' ? row['担当先生ID'] || '' : '';
      next['実施有無_pm'] = row['種別'] === '本番' ? 'なし' : (row['実施有無_pm'] || '実施');
      next.staffing_pm = row['種別'] === '本番' ? '' : next.staffing_am;
      next['担当先生ID_pm'] = row['種別'] === '本番' ? '' : next['担当先生ID_am'];
      return next;
    });
    if (migrated.length) appendObjects_('sessions', migrated);
    return { columnsAdded: missing.length, sessionsMigrated: migrated.length };
  });
}

/** 演奏進行欄を末尾へ追記。既存セル・行・列位置を変更しない。 */
function migrateStageSchema() {
  return withWriteLock_(function() {
    const sheet = getDatabase_().getSheetByName('timeline_items');
    if (!sheet) throw new Error('timeline_items がありません。');
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('stageJSON') >= 0) return { columnsAdded: 0 };
    sheet.getRange(1, headers.length + 1, 1, 1).setValues([['stageJSON']]); return { columnsAdded: 1 };
  });
}


/** 本番反映前にバックアップ後に実行する、追記のみの構造移行（ダミー投入なし）。 */
function migratePerformanceSchema() {
  withWriteLock_(function() {
    ['event_layouts', 'm_instruments'].forEach(function(name) { ensureSheet_(getDatabase_(), name, BAND_DB_SCHEMA[name]); });
  });
  migrateSessionsSchema(); migrateStageSchema();
  return { version: 2 };
}

/**
 * 平沼マーチングバンド 運営支援アプリ API。
 * setup.gs と同じ GAS プロジェクトに貼り付け、ウェブアプリとしてデプロイする。
 *
 * GET : action と k（家庭）/t（先生）/a（管理者）トークンを渡す。
 * POST: JSON { action, k|t|a, ...payload } を渡す。
 * 書き込みは append-only。最新行の決定は同一キーの最後の行を採用する。
 */

const API_ERROR = {
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  INVALID_REQUEST: 'invalid_request',
  DEADLINE_CLOSED: 'deadline_closed',
  NOT_CONFIGURED: 'not_configured',
  SELF_PRACTICE_INCOMPLETE: 'self_practice_incomplete'
};

function doGet(e) {
  try {
    return jsonResponse_(handleRead_(e && e.parameter ? e.parameter : {}));
  } catch (error) {
    return jsonResponse_({ ok: false, error: apiErrorCode_(error), message: error.message });
  }
}

function doPost(e) {
  try {
    const request = parsePostRequest_(e);
    return jsonResponse_(['admin_bootstrap', 'teacher_bootstrap', 'parent_bootstrap', 'parent_card'].indexOf(request.action) >= 0 ? handleRead_(request) : handleWrite_(request));
  } catch (error) {
    return jsonResponse_({ ok: false, error: apiErrorCode_(error), message: error.message });
  }
}

function handleRead_(request) {
  // 公開予定と当番の読み取り途中に下書き保存が割り込まないようにする。
  return withWriteLock_(function() { return readAuthorized_(request); });
}

function readAuthorized_(request) {
  const auth = authorize_(request);
  switch (request.action) {
    case 'parent_bootstrap':
      requireRole_(auth, 'parent');
      return { ok: true, data: parentBootstrap_(auth) };
    case 'parent_card':
      requireRole_(auth, 'parent');
      return { ok: true, data: parentCard_(auth, request.sessionId || '') };
    case 'teacher_bootstrap':
      requireRole_(auth, 'teacher');
      return { ok: true, data: teacherBootstrap_(auth) };
    case 'admin_bootstrap':
      requireRole_(auth, 'admin');
      return { ok: true, data: adminBootstrap_() };
    default:
      throw apiError_(API_ERROR.INVALID_REQUEST, 'GET action が不正です。');
  }
}

function handleWrite_(request) {
  const auth = authorize_(request);
  switch (request.action) {
    case 'save_teacher_availability':
      requireRole_(auth, 'teacher');
      return { ok: true, data: saveTeacherAvailability_(auth, request) };
    case 'save_parent_month':
      requireRole_(auth, 'parent');
      return { ok: true, data: saveParentMonth_(auth, request) };
    case 'admin_create_month':
    case 'admin_save_month':
    case 'admin_delete_session':
    case 'admin_save_sessions':
    case 'admin_save_selfpractice':
    case 'admin_save_duty_assignments':
    case 'admin_save_event':
    case 'admin_save_instruments':
    case 'admin_save_layouts':
    case 'admin_save_timeline_items':
    case 'admin_save_teacher_availability':
    case 'admin_save_place':
    case 'admin_set_place_visibility':
    case 'admin_import_references':
    case 'admin_save_guide_items':
    case 'admin_save_annual_event_candidates':
    case 'admin_backup_references':
    case 'admin_save_households':
    case 'admin_save_guardians':
    case 'admin_save_members':
    case 'admin_save_roster':
    case 'admin_save_teachers':
    case 'admin_publish_month':
      requireRole_(auth, 'admin');
      return { ok: true, data: saveAdmin_(request) };
    default:
      throw apiError_(API_ERROR.INVALID_REQUEST, 'POST action が不正です。');
  }
}

function parentBootstrap_(auth) {
  const householdId = auth.household['家庭ID'];
  const household = withoutKeys_(auth.household, ['招待トークン']);
  const latestHousehold = latestRows_(readTable_('m_households'), function(row) { return row['家庭ID']; }).find(function(row) { return row['家庭ID'] === householdId; });
  if (latestHousehold) household['家庭名'] = latestHousehold['家庭名'];
  const members = latestRows_(readTable_('m_members'), function(row) { return row['子どもID']; }).filter(function(row) {
    return row['家庭ID'] === householdId && asBoolean_(row['在籍']);
  });
  const guardians = latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }).filter(function(row) {
    return row['家庭ID'] === householdId && asBoolean_(row['在籍']);
  });
  const sessions = publishedSessions_();
  const inputSessions = activeSessions_();
  const attendanceLatest = latestRows_(readTable_('attendance'), function(row) {
    return row['子どもID'] + '|' + row['予定ID'];
  });
  const dutyLatest = latestRows_(readTable_('duty_offers'), function(row) {
    return row['保護者ID'] + '|' + row['予定ID'];
  });
  const memberIds = indexBy_(members, '子どもID');
  const guardianIds = indexBy_(guardians, '保護者ID');
  const ownAttendance = attendanceLatest.filter(function(row) { return !!memberIds[row['子どもID']]; });
  const ownDutyOffers = dutyLatest.filter(function(row) { return !!guardianIds[row['保護者ID']]; });

  return {
    performanceVersion: 2,
    household: household,
    guardians: guardians,
    members: members,
    months: latestRows_(readTable_('months'), function(row) { return row['月ID']; }),
    sessions: sessions,
    layouts: publicLayouts_(sessions),
    daySchedule: publicDaySchedule_(sessions),
    events: publicEventNames_(sessions),
    inputSessions: inputSessions,
    attendance: ownAttendance,
    dutyOffers: ownDutyOffers,
    attendanceCounts: attendanceCounts_(sessions),
    dutyAssignments: publicDutyAssignments_(sessions),
    places: placesForReferences_(sessions.concat(inputSessions), publicDaySchedule_(sessions)),
    teachers: publicTeachers_(),
    references: referenceSources_(false)
  };
}

function parentCard_(auth, sessionId) {
  const householdId = auth.household['家庭ID'];
  const guardians = latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }).filter(function(row) { return row['家庭ID'] === householdId && asBoolean_(row['在籍']); });
  const members = latestRows_(readTable_('m_members'), function(row) { return row['子どもID']; }).filter(function(row) { return row['家庭ID'] === householdId && asBoolean_(row['在籍']); });
  const allowedIds = {};
  guardians.forEach(function(row) { allowedIds[row['保護者ID']] = true; });
  members.forEach(function(row) { allowedIds[row['子どもID']] = true; });
  const sessions = publishedSessions_().filter(function(row) { return row['種別'] === '本番' && (!sessionId || row['予定ID'] === sessionId); });
  const allowedSessions = indexBy_(sessions, '予定ID');
  const items = latestRows_(readTable_('timeline_items'), function(item) { return item['項目ID']; }).filter(function(item) {
    return asBoolean_(item['有効']) && !!allowedSessions[item['予定ID']] && hasAssignedId_(item['担当'], allowedIds);
  }).sort(compareTimeline_).map(function(item) {
    const row = {};
    ['項目ID', '予定ID', '日区分', '時刻', '並び順', 'scope', '種別', '内容', '場所ID', '持ち物', '注意点'].forEach(function(key) { row[key] = item[key]; });
    projectTimelinePlace_(item, row);
    row['担当'] = String(item['担当'] || '').split(',').map(function(id) { return id.trim(); }).filter(function(id) { return allowedIds[id]; }).join(',');
    return row;
  });
  const events = latestRows_(readTable_('events'), function(row) { return row['予定ID']; }).filter(function(row) { return !!allowedSessions[row['予定ID']]; }).map(function(event) {
    const row = {}; ['予定ID', '本番名', '会場', '衣装', '子どもの持ち物', '全体連絡'].forEach(function(key) { row[key] = event[key]; }); return row;
  });
  return {
    guardians: guardians.map(function(row) { return { '保護者ID': row['保護者ID'], '表示名': row['表示名'] }; }),
    members: members.map(function(row) { return { '子どもID': row['子どもID'], '氏名': row['氏名'] }; }),
    sessions: sessions, events: events, places: placesForReferences_(sessions, publicDaySchedule_(sessions).concat(items)), layouts: publicLayouts_(sessions), daySchedule: publicDaySchedule_(sessions), timelineItems: items,
    stageItems: latestRows_(readTable_('timeline_items'), function(item) { return item['項目ID']; }).filter(function(item) { return asBoolean_(item['有効']) && allowedSessions[item['予定ID']] && item.scope === 'ステージ進行'; }).sort(compareStage_).map(function(item) { return publicStage_(item, allowedIds); })
  };
}

function teacherBootstrap_(auth) {
  const months = latestRows_(readTable_('months'), function(row) { return row['月ID']; });
  const monthMap = indexBy_(months, '月ID');
  const sessions = activeSessions_().filter(function(row) {
    return !!monthMap[row['月ID']];
  });
  const availability = latestRows_(readTable_('teacher_availability'), function(row) {
    return row['先生ID'] + '|' + row['予定ID'] + '|' + row['枠'];
  }).filter(function(row) { return row['先生ID'] === auth.teacher['先生ID']; });
  return {
    teacher: withoutKeys_(auth.teacher, ['招待トークン']),
    months: months,
    sessions: sessions,
    places: placesForReferences_(sessions),
    availability: availability,
    now: new Date().toISOString()
  };
}

function adminBootstrap_() {
  const householdRows = latestRows_(readTable_('m_households'), function(row) { return row['家庭ID']; });
  const teacherRows = latestRows_(readTable_('m_teachers'), function(row) { return row['先生ID']; });
  const masters = {
    households: householdRows.map(function(row) { return withoutKeys_(row, ['招待トークン']); }),
    guardians: latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }),
    members: latestRows_(readTable_('m_members'), function(row) { return row['子どもID']; }),
    teachers: teacherRows.map(function(row) { return withoutKeys_(row, ['招待トークン']); }),
    places: allPlaces_()
  };
  return {
    performanceVersion: 2,
    instruments: instrumentRows_(),
    masters: masters,
    shared: sharedSchedule_(),
    months: latestRows_(readTable_('months'), function(row) { return row['月ID']; }),
    sessions: activeSessions_(),
    selfPractice: latestRows_(readTable_('session_selfpractice'), function(row) { return row['予定ID']; }),
    teacherAssignmentConflicts: teacherAssignmentConflicts_(activeSessions_()),
    teacherAvailability: latestRows_(readTable_('teacher_availability'), function(row) { return row['先生ID'] + '|' + row['予定ID'] + '|' + row['枠']; }),
    attendance: latestRows_(readTable_('attendance'), function(row) { return row['子どもID'] + '|' + row['予定ID']; }),
    dutyOffers: latestRows_(readTable_('duty_offers'), function(row) { return row['保護者ID'] + '|' + row['予定ID']; }),
    dutyAssignments: dutyAssignments_(),
    layouts: layoutRows_(),
    events: latestRows_(readTable_('events'), function(row) { return row['予定ID']; }),
    timelineItems: latestRows_(readTable_('timeline_items'), function(row) { return row['項目ID']; }).filter(function(row) { return asBoolean_(row['有効']); }),
    invites: {
      households: householdRows.filter(function(row) { return asBoolean_(row['在籍']) && row['招待トークン']; }).map(function(row) { return { id: row['家庭ID'], name: row['家庭名'], token: row['招待トークン'] }; }),
      teachers: teacherRows.filter(function(row) { return asBoolean_(row['在籍']) && row['招待トークン']; }).map(function(row) { return { id: row['先生ID'], name: row['氏名'], token: row['招待トークン'] }; })
    },
    references: referenceSources_(true)
  };
}

function saveTeacherAvailability_(auth, request) {
  const rows = Array.isArray(request.records) ? request.records : [];
  if (!rows.length) throw apiError_(API_ERROR.INVALID_REQUEST, '可否の入力がありません。');
  const sessions = indexBy_(activeSessions_(), '予定ID');
  const monthMap = indexBy_(latestRows_(readTable_('months'), function(row) { return row['月ID']; }), '月ID');
  const teacherId = auth.teacher['先生ID'];
  const records = rows.map(function(row) {
    const session = sessions[row.sessionId];
    if (!session || !monthMap[session['月ID']]) throw apiError_(API_ERROR.INVALID_REQUEST, '予定IDが不正です。');
    // 先生の可否入力に締切は設けない。管理者が予定を確定するまで修正できる。
    const slot = String(row.slot || '');
    if (session['種別'] === '本番') throw apiError_(API_ERROR.INVALID_REQUEST, '本番は先生の入力対象外です。');
    if (['午前', '午後', '終日'].indexOf(slot) === -1) throw apiError_(API_ERROR.INVALID_REQUEST, '枠が不正です。');
    if (session['種別'] === '本番' && slot !== '終日') throw apiError_(API_ERROR.INVALID_REQUEST, '本番は終日で入力します。');
    if (session['種別'] !== '本番' && slot === '終日') throw apiError_(API_ERROR.INVALID_REQUEST, '練習は午前または午後で入力します。');
    if (['○', '×', ''].indexOf(String(row.availability || '')) === -1) throw apiError_(API_ERROR.INVALID_REQUEST, '可否が不正です。');
    return { '先生ID': teacherId, '予定ID': session['予定ID'], '枠': slot, '可否': row.availability, '送信時刻': new Date() };
  });
  withWriteLock_(function() { appendObjects_('teacher_availability', records); });
  return { saved: records.length };
}

function saveParentMonth_(auth, request) {
  return withWriteLock_(function() {
  const attendanceRows = Array.isArray(request.attendance) ? request.attendance : [];
  const dutyRows = Array.isArray(request.dutyOffers) ? request.dutyOffers : [];
  if (!attendanceRows.length && !dutyRows.length) throw apiError_(API_ERROR.INVALID_REQUEST, '送信する入力がありません。');
  const householdId = auth.household['家庭ID'];
  const memberMap = indexBy_(latestRows_(readTable_('m_members'), function(row) { return row['子どもID']; }).filter(function(row) { return row['家庭ID'] === householdId && asBoolean_(row['在籍']); }), '子どもID');
  const guardianMap = indexBy_(latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }).filter(function(row) { return row['家庭ID'] === householdId && asBoolean_(row['在籍']); }), '保護者ID');
  const sessions = indexBy_(activeSessions_(), '予定ID');
  const months = indexBy_(latestRows_(readTable_('months'), function(row) { return row['月ID']; }), '月ID');
  const fallbackGuardianId = Object.keys(guardianMap)[0] || '';
  const priorAttendance = keyedRows_(latestRows_(readTable_('attendance'), function(row) { return row['子どもID'] + '|' + row['予定ID']; }), function(row) { return row['子どもID'] + '|' + row['予定ID']; });
  const priorOffers = keyedRows_(latestRows_(readTable_('duty_offers'), function(row) { return row['保護者ID'] + '|' + row['予定ID']; }), function(row) { return row['保護者ID'] + '|' + row['予定ID']; });
  const attendance = attendanceRows.map(function(row) {
    const session = sessions[row.sessionId];
    if (!memberMap[row.memberId] || !session) throw apiError_(API_ERROR.FORBIDDEN, 'この家庭では送信できない子どもまたは予定です。');
    ensureDeadlineOpen_(months[session['月ID']], '保護者入力締切');
    const guardianId = row.guardianId || fallbackGuardianId;
    if (!guardianMap[guardianId]) throw apiError_(API_ERROR.FORBIDDEN, '入力者がこの家庭に属していません。');
    const amOpen = session['実施有無_am'] !== 'なし';
    const pmOpen = session['種別'] !== '本番' && session['実施有無_pm'] !== 'なし';
    if ((!amOpen && asBoolean_(row.morning)) || (!pmOpen && asBoolean_(row.afternoon))) throw apiError_(API_ERROR.INVALID_REQUEST, '実施しない枠には出席を送信できません。');
    const prior = priorAttendance[row.memberId + '|' + row.sessionId] || {};
    return { '子どもID': row.memberId, '予定ID': row.sessionId, '午前': amOpen ? partialAnswer_(row, 'morning', prior['午前']) : '', '午後': pmOpen ? partialAnswer_(row, 'afternoon', prior['午後']) : '', '連絡事項': row.note === undefined ? prior['連絡事項'] || '' : String(row.note || ''), '入力者': guardianId, '送信時刻': new Date() };
  });
  const offers = dutyRows.map(function(row) {
    const session = sessions[row.sessionId];
    if (!session || !fallbackGuardianId || (row.guardianId && row.guardianId !== fallbackGuardianId)) throw apiError_(API_ERROR.FORBIDDEN, 'この家庭では送信できない当番可否です。');
    ensureDeadlineOpen_(months[session['月ID']], '保護者入力締切');
    return { '保護者ID': fallbackGuardianId, '予定ID': row.sessionId, '可否': partialAnswer_(row, 'available', (priorOffers[fallbackGuardianId + '|' + row.sessionId] || {})['可否']), 'メモ': row.note === undefined ? (priorOffers[fallbackGuardianId + '|' + row.sessionId] || {})['メモ'] || '' : String(row.note || ''), '送信時刻': new Date() };
  });
    if (attendance.length) appendObjects_('attendance', attendance);
    if (offers.length) appendObjects_('duty_offers', offers);
  return { attendanceSaved: attendance.length, dutyOffersSaved: offers.length };
  });
}

function saveAdmin_(request) {
  switch (request.action) {
    case 'admin_create_month':
      return adminCreateMonth_(request);
    case 'admin_save_month':
      return adminSaveMonth_(request);
    case 'admin_delete_session':
      return adminDeleteSession_(request.sessionId);
    case 'admin_save_sessions':
      return adminSaveSessions_(request.records || []);
    case 'admin_save_selfpractice':
      return adminSaveSelfPractice_(request.records || []);
    case 'admin_save_duty_assignments':
      return adminSaveDutyAssignments_(request.records || []);
    case 'admin_save_event':
      return adminAppend_(request.records || [], 'events', ['予定ID', '本番名']);
    case 'admin_save_instruments':
      return adminSaveInstruments_(request.records || []);
    case 'admin_save_layouts':
      return adminSaveLayouts_(request.records || []);
    case 'admin_save_timeline_items':
      return adminSaveTimelineItems_(request.records || []);
    case 'admin_save_teacher_availability':
      return adminSaveTeacherAvailability_(request.records || []);
    case 'admin_save_place':
      return adminSavePlace_(request);
    case 'admin_set_place_visibility':
      return adminSetPlaceVisibility_(request);
    case 'admin_import_references':
      return adminImportReferences_();
    case 'admin_save_guide_items':
      return adminSaveGuideItems_(request.records || []);
    case 'admin_save_annual_event_candidates':
      return adminSaveAnnualEventCandidates_(request.records || []);
    case 'admin_backup_references':
      return adminBackupReferences_();
    case 'admin_save_households':
      return adminSaveHouseholds_(request.records || []);
    case 'admin_save_guardians':
      return adminSaveGuardians_(request.records || []);
    case 'admin_save_members':
      return adminSaveMembers_(request.records || []);
    case 'admin_save_roster':
      return adminSaveRoster_(request.records || []);
    case 'admin_save_teachers':
      return adminSaveTeachers_(request.records || []);
    case 'admin_publish_month':
      return adminPublishMonth_(request.monthId);
    default:
      throw apiError_(API_ERROR.INVALID_REQUEST, '管理者 action が不正です。');
  }
}

/**
 * 締切を過ぎた先生の可否を、管理者が代理で入力・修正するための書き込み。
 * 先生本人の締切チェック(ensureDeadlineOpen_)は行わない。
 */
function adminSaveTeacherAvailability_(records) {
  if (!Array.isArray(records) || !records.length) throw apiError_(API_ERROR.INVALID_REQUEST, '可否の入力がありません。');
  const sessions = indexBy_(activeSessions_(), '予定ID');
  const teachers = indexBy_(readTable_('m_teachers'), '先生ID');
  const rows = records.map(function(row) {
    const session = sessions[row.sessionId];
    if (!session) throw apiError_(API_ERROR.INVALID_REQUEST, '予定IDが不正です。');
    if (!teachers[row.teacherId]) throw apiError_(API_ERROR.INVALID_REQUEST, '先生IDが不正です。');
    const slot = String(row.slot || '');
    if (['午前', '午後', '終日'].indexOf(slot) === -1) throw apiError_(API_ERROR.INVALID_REQUEST, '枠が不正です。');
    if (session['種別'] === '本番' && slot !== '終日') throw apiError_(API_ERROR.INVALID_REQUEST, '本番は終日で入力します。');
    if (session['種別'] !== '本番' && slot === '終日') throw apiError_(API_ERROR.INVALID_REQUEST, '練習は午前または午後で入力します。');
    if (['○', '×', ''].indexOf(String(row.availability || '')) === -1) throw apiError_(API_ERROR.INVALID_REQUEST, '可否が不正です。');
    return { '先生ID': row.teacherId, '予定ID': session['予定ID'], '枠': slot, '可否': row.availability, '送信時刻': new Date() };
  });
  withWriteLock_(function() { appendObjects_('teacher_availability', rows); });
  return { saved: rows.length };
}

function adminSavePlace_(request) {
  const name = String(request.name || '').trim();
  if (!name || name.length > 80) throw apiError_(API_ERROR.INVALID_REQUEST, '場所名は1〜80文字で入力してください。');
  return withWriteLock_(function() {
    const all = latestRows_(readTable_('m_places'), function(row) { return row['場所ID']; });
    if (all.some(function(row) { return row['名称'] === name && placeIsVisible_(row); })) throw apiError_(API_ERROR.INVALID_REQUEST, '同じ場所が既にあります。');
    if (all.some(function(row) { return row['名称'] === name; })) throw apiError_(API_ERROR.INVALID_REQUEST, '非表示の同名の場所があります。場所一覧から復元してください。');
    const numbers = all.map(function(row) { const match = String(row['場所ID']).match(/^P(\d+)$/); return match ? Number(match[1]) : 0; });
    const orders = all.map(function(row) { return Number(row['並び順']) || 0; });
    const row = { '場所ID': 'P' + String(Math.max.apply(null, [0].concat(numbers)) + 1).padStart(3, '0'), '名称': name, '並び順': Math.max.apply(null, [0].concat(orders)) + 1, '有効': true };
    appendObjects_('m_places', [row]);
    return { place: row };
  });
}

// 場所の削除ではなく、同じIDの表示状態だけを履歴として追記する。
function adminSetPlaceVisibility_(request) {
  if (typeof request.visible !== 'boolean') throw apiError_(API_ERROR.INVALID_REQUEST, '表示状態は true または false で指定してください。');
  const placeId = String(request.placeId || '').trim();
  return withWriteLock_(function() {
    const all = allPlaces_();
    const prior = all.find(function(row) { return row['場所ID'] === placeId; });
    if (!prior) throw apiError_(API_ERROR.INVALID_REQUEST, '場所が見つかりません。');
    if (placeIsVisible_(prior) === request.visible) return { place: prior };
    if (request.visible && all.some(function(row) { return row['場所ID'] !== placeId && row['名称'] === prior['名称'] && placeIsVisible_(row); })) {
      throw apiError_(API_ERROR.INVALID_REQUEST, '同じ名前の表示中の場所があります。復元できません。');
    }
    const row = copyObject_(prior); row['有効'] = request.visible;
    appendObjects_('m_places', [row]);
    return { place: row };
  });
}

function adminSaveHouseholds_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    const existing = indexBy_(latestRows_(readTable_('m_households'), function(row) { return row['家庭ID']; }), '家庭ID');
    const rows = records.map(function(record) {
      const id = String(record['家庭ID'] || '').trim(); const active = asBoolean_(record['在籍']); const name = String(record['家庭名'] || '').trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || (active && !name)) throw apiError_(API_ERROR.INVALID_REQUEST, '家庭IDまたは家庭名が不正です。');
      const prior = existing[id] || {};
      return { '家庭ID': id, '家庭名': name, '緊急連絡先': prior['緊急連絡先'] || '', '招待トークン': prior['招待トークン'] || createInviteToken_(), '在籍': active };
    });
    appendObjects_('m_households', rows); return { saved: rows.length };
  });
}

function adminSaveGuardians_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    const households = indexBy_(latestRows_(readTable_('m_households'), function(row) { return row['家庭ID']; }), '家庭ID');
    const rows = records.map(function(record) {
      const id = String(record['保護者ID'] || '').trim(); const householdId = String(record['家庭ID'] || '').trim(); const active = asBoolean_(record['在籍']); const name = String(record['表示名'] || '').trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !households[householdId] || (active && !name)) throw apiError_(API_ERROR.INVALID_REQUEST, '保護者の家庭または表示名が不正です。');
      return { '保護者ID': id, '家庭ID': householdId, '表示名': name, '対応可能な役割': String(record['対応可能な役割'] || '').trim(), '在籍': active };
    });
    appendObjects_('m_guardians', rows); return { saved: rows.length };
  });
}

function adminSaveMembers_(records) {
  return withWriteLock_(function() {
    ensureMembersSchema_();
    requireRecords_(records);
    const households = indexBy_(latestRows_(readTable_('m_households'), function(row) { return row['家庭ID']; }), '家庭ID');
    const rows = records.map(function(record) {
      const id = String(record['子どもID'] || '').trim(); const householdId = String(record['家庭ID'] || '').trim(); const active = asBoolean_(record['在籍']); const name = String(record['氏名'] || '').trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !households[householdId] || (active && !name)) throw apiError_(API_ERROR.INVALID_REQUEST, 'お子さまの家庭または氏名が不正です。');
      return { '子どもID': id, '家庭ID': householdId, '氏名': name, '基本担当楽器': instrumentText_(record['基本担当楽器'] === undefined ? (latestRows_(readTable_('m_members'), function(r) { return r['子どもID']; }).find(function(r) { return r['子どもID'] === id; }) || {})['基本担当楽器'] || '' : record['基本担当楽器']), '在籍': active, '学年': String(record['学年'] || '').trim() };
    });
    appendObjects_('m_members', rows); return { saved: rows.length };
  });
}

/**
 * 表形式の名簿を現在の状態として保存する。物理的な行は追記し、画面には最新行だけを返す。
 * 同じ家庭名・保護者名を新しい行に入力した場合は、既存の家庭・保護者へまとめる。
 */
function adminSaveRoster_(records) {
  return withWriteLock_(function() {
    ensureMembersSchema_();
    if (!Array.isArray(records)) throw apiError_(API_ERROR.INVALID_REQUEST, '名簿データが不正です。');
    const households = indexBy_(latestRows_(readTable_('m_households'), function(row) { return row['家庭ID']; }), '家庭ID');
    const guardians = indexBy_(latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }), '保護者ID');
    const members = indexBy_(latestRows_(readTable_('m_members'), function(row) { return row['子どもID']; }), '子どもID');
    const householdByName = {};
    Object.keys(households).forEach(function(id) { if (asBoolean_(households[id]['在籍']) && households[id]['家庭名']) householdByName[households[id]['家庭名']] = id; });
    const guardianByName = {}, memberByName = {};
    Object.keys(guardians).forEach(function(id) { const row = guardians[id]; if (asBoolean_(row['在籍']) && row['表示名']) guardianByName[row['家庭ID'] + '|' + row['表示名']] = id; });
    Object.keys(members).forEach(function(id) { const row = members[id]; if (asBoolean_(row['在籍']) && row['氏名']) memberByName[row['家庭ID'] + '|' + row['氏名']] = id; });
    const nextHouseholds = {}, nextGuardians = {}, nextMembers = {};
    records.forEach(function(record) {
      const householdName = String(record.householdName || '').trim();
      const guardianName = String(record.guardianName || '').trim();
      const childNames = [String(record.child1Name || '').trim(), String(record.child2Name || '').trim()];
      if (!householdName && !guardianName && !childNames[0] && !childNames[1]) return;
      if (!householdName) throw apiError_(API_ERROR.INVALID_REQUEST, '家庭名を入力してください。');
      let householdId = String(record.householdId || '').trim();
      if (!households[householdId] && !nextHouseholds[householdId]) householdId = householdByName[householdName] || householdId;
      if (!householdId) householdId = 'H-' + Utilities.getUuid();
      const previousHousehold = households[householdId] || nextHouseholds[householdId] || {};
      nextHouseholds[householdId] = { '家庭ID': householdId, '家庭名': householdName, '緊急連絡先': previousHousehold['緊急連絡先'] || '', '招待トークン': previousHousehold['招待トークン'] || createInviteToken_(), '在籍': true };
      householdByName[householdName] = householdId;
      if (guardianName) {
        let guardianId = String(record.guardianId || '').trim();
        if (!guardians[guardianId] && !nextGuardians[guardianId]) guardianId = guardianByName[householdId + '|' + guardianName] || guardianId;
        if (!guardianId) guardianId = 'G-' + Utilities.getUuid();
        nextGuardians[guardianId] = { '保護者ID': guardianId, '家庭ID': householdId, '表示名': guardianName, '対応可能な役割': String(record.guardianRoles || '').trim(), '在籍': true };
        guardianByName[householdId + '|' + guardianName] = guardianId;
      }
      [[childNames[0], String(record.child1Grade || '').trim(), record.child1Id, record.child1Instrument], [childNames[1], String(record.child2Grade || '').trim(), record.child2Id, record.child2Instrument]].forEach(function(child) {
        if (!child[0]) return;
        let memberId = String(child[2] || '').trim();
        if (!members[memberId] && !nextMembers[memberId]) memberId = memberByName[householdId + '|' + child[0]] || memberId;
        if (!memberId) memberId = 'M-' + Utilities.getUuid();
        const previousMember = members[memberId] || nextMembers[memberId] || {};
        nextMembers[memberId] = { '子どもID': memberId, '家庭ID': householdId, '氏名': child[0], '基本担当楽器': instrumentText_(child[3] === undefined ? previousMember['基本担当楽器'] || '' : child[3]), '在籍': true, '学年': child[1] };
        memberByName[householdId + '|' + child[0]] = memberId;
      });
    });
    const retiredHouseholds = Object.keys(households).filter(function(id) { return asBoolean_(households[id]['在籍']) && !nextHouseholds[id]; }).map(function(id) { const row = copyObject_(households[id]); row['在籍'] = false; return row; });
    const retiredGuardians = Object.keys(guardians).filter(function(id) { return asBoolean_(guardians[id]['在籍']) && !nextGuardians[id]; }).map(function(id) { const row = copyObject_(guardians[id]); row['在籍'] = false; return row; });
    const retiredMembers = Object.keys(members).filter(function(id) { return asBoolean_(members[id]['在籍']) && !nextMembers[id]; }).map(function(id) { const row = copyObject_(members[id]); row['在籍'] = false; return row; });
    appendObjects_('m_households', Object.keys(nextHouseholds).map(function(id) { return nextHouseholds[id]; }).concat(retiredHouseholds));
    appendObjects_('m_guardians', Object.keys(nextGuardians).map(function(id) { return nextGuardians[id]; }).concat(retiredGuardians));
    appendObjects_('m_members', Object.keys(nextMembers).map(function(id) { return nextMembers[id]; }).concat(retiredMembers));
    return { households: Object.keys(nextHouseholds).length, guardians: Object.keys(nextGuardians).length, members: Object.keys(nextMembers).length };
  });
}

function adminSaveTeachers_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    const existing = indexBy_(latestRows_(readTable_('m_teachers'), function(row) { return row['先生ID']; }), '先生ID');
    const rows = records.map(function(record) {
      const id = String(record['先生ID'] || '').trim(); const active = asBoolean_(record['在籍']); const name = String(record['氏名'] || '').trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || (active && !name)) throw apiError_(API_ERROR.INVALID_REQUEST, '先生IDまたは氏名が不正です。');
      return { '先生ID': id, '氏名': name, '担当楽器': String(record['担当楽器'] || '').trim(), '招待トークン': existing[id]?.['招待トークン'] || createInviteToken_(), '在籍': active };
    });
    appendObjects_('m_teachers', rows); return { saved: rows.length };
  });
}

function adminCreateMonth_(request) {
  return withWriteLock_(function() {
    const monthId = validMonthId_(request.monthId);
    const existing = latestRows_(readTable_('months'), function(row) { return row['月ID']; });
    if (indexBy_(existing, '月ID')[monthId]) throw apiError_(API_ERROR.INVALID_REQUEST, '対象月は既に存在します。');
    const sessions = request.generateSaturdays === false ? [] : createSaturdaySessions_(monthId, request.copyFromMonthId || '');
    validateDeadline_(request.teacherDeadline); validateDeadline_(request.parentDeadline);
    ensureSessionsSchema_();
    appendObjects_('sessions', sessions);
    appendObjects_('months', [{ '月ID': monthId, '状態': '下書き', '先生入力締切': request.teacherDeadline || '', '保護者入力締切': request.parentDeadline || '' }]);
    return { monthId: monthId, sessionsCreated: sessions.length };
  });
}

function createSaturdaySessions_(monthId, copyFromMonthId) {
  const parts = monthId.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const prior = activeSessions_().filter(function(row) { return row['月ID'] === copyFromMonthId; })[0] || {};
  const defaults = {
    '集合': prior['集合'] || '09:45', '開始': prior['開始'] || '10:00', '終了': prior['終了'] || '15:00', '解散': prior['解散'] || '15:15', '場所ID': prior['場所ID'] || 'P001'
  };
  const records = [];
  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1) break;
    if (date.getDay() !== 6) continue;
    const isoDate = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    records.push({ '予定ID': 'S' + isoDate.replace(/-/g, ''), '月ID': monthId, '日付': isoDate, '種別': '通常練習', '実施有無_am': '実施', 'staffing_am': '未定', '担当先生ID_am': '', '実施有無_pm': '実施', 'staffing_pm': '未定', '担当先生ID_pm': '', '集合': defaults['集合'], '開始': defaults['開始'], '終了': defaults['終了'], '解散': defaults['解散'], '場所ID': defaults['場所ID'], '確定状態': '下書き', '備考': '' });
  }
  return records;
}

function adminSaveSessions_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    const existing = indexBy_(activeSessions_(), '予定ID');
    const rows = records.map(function(record) {
      const row = cleanSession_(record);
      if (existing[row['予定ID']] && existing[row['予定ID']]['月ID'] !== row['月ID']) throw apiError_(API_ERROR.INVALID_REQUEST, '予定の所属月は変更できません。');
      row['確定状態'] = '下書き'; // 公開は検証付きの専用APIだけで行う。
      return row;
    });
    appendObjects_('sessions', rows);
    return { saved: rows.length };
  });
}

function adminAppend_(records, sheetName, requiredKeys) {
  if (!Array.isArray(records) || !records.length) throw apiError_(API_ERROR.INVALID_REQUEST, '保存する行がありません。');
  records.forEach(function(record) {
    requiredKeys.forEach(function(key) { if (record[key] === undefined || record[key] === '') throw apiError_(API_ERROR.INVALID_REQUEST, key + ' は必須です。'); });
  });
  withWriteLock_(function() {
    if (sheetName === 'events') {
      const sessions = indexBy_(activeSessions_(), '予定ID');
      records.forEach(function(row) { if (!sessions[row['予定ID']] || sessions[row['予定ID']]['種別'] !== '本番') throw apiError_(API_ERROR.INVALID_REQUEST, '本番予定を選んでください。'); });
      unpublishSessions_(records.map(function(row) { return row['予定ID']; }));
    }
    appendObjects_(sheetName, records);
  });
  return { saved: records.length, sheet: sheetName };
}

function adminSaveTimelineItems_(records) {
  return withWriteLock_(function() {
    if (!Array.isArray(records) || !records.length) throw apiError_(API_ERROR.INVALID_REQUEST, '保存する進行項目がありません。');
    ensureTimelineSchema_();
    const eventSessions = indexBy_(activeSessions_().filter(function(row) { return row['種別'] === '本番'; }), '予定ID');
    const previousItems = indexBy_(latestRows_(readTable_('timeline_items'), function(row) { return row['項目ID']; }), '項目ID');
    const validScopes = ['当日進行', 'ステージ進行'];
    const validDays = ['前日', '当日'];
    const rows = records.map(function(record) {
      assertKnownKeys_(record, BAND_DB_SCHEMA.timeline_items);
      const row = {};
      BAND_DB_SCHEMA.timeline_items.forEach(function(key) { row[key] = record[key] === undefined ? '' : record[key]; });
      row['項目ID'] = String(row['項目ID']).trim();
      row['予定ID'] = String(row['予定ID']).trim();
      row['日区分'] = String(row['日区分'] || '当日').trim();
      row.scope = String(row.scope || '当日進行').trim();
      row['種別'] = String(row['種別'] || '予定').trim();
      row['内容'] = String(row['内容']).trim();
      row['時刻'] = String(row['時刻']).trim();
      row['並び順'] = Number(row['並び順']) || 0;
      row.stageJSON = JSON.stringify(normalizeStage_(record.stageJSON === undefined ? (previousItems[row['項目ID']] || {}).stageJSON : record.stageJSON, row['予定ID']));
      row['有効'] = row['有効'] === false || row['有効'] === 'false' ? false : true;
      if (!row['項目ID'] || !row['予定ID']) throw apiError_(API_ERROR.INVALID_REQUEST, '進行項目IDと予定IDが必要です。');
      if (!eventSessions[row['予定ID']]) throw apiError_(API_ERROR.INVALID_REQUEST, '本番予定を選んでください。');
      if (validDays.indexOf(row['日区分']) < 0 || validScopes.indexOf(row.scope) < 0) throw apiError_(API_ERROR.INVALID_REQUEST, '進行項目の区分が不正です。');
      if (row['有効'] && !row['内容']) throw apiError_(API_ERROR.INVALID_REQUEST, '進行内容を入力してください。');
      if (row['時刻'] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row['時刻'])) throw apiError_(API_ERROR.INVALID_REQUEST, '時刻はHH:MMで入力してください。');
      row['場所ID'] = String(row['場所ID'] || '').trim();
      const prior = previousItems[row['項目ID']];
      if (row['有効']) validatePlaceReference_(row['場所ID'], prior && prior['予定ID'] === row['予定ID'] ? prior['場所ID'] : '', false, '進行の場所');
      return row;
    });
    unpublishSessions_(rows.map(function(row) { return row['予定ID']; }));
    appendObjects_('timeline_items', rows);
    return { saved: rows.length };
  });
}

function adminPublishMonth_(monthId) {
  return withWriteLock_(function() {
    const month = indexBy_(latestRows_(readTable_('months'), function(row) { return row['月ID']; }), '月ID')[monthId];
    if (!month) throw apiError_(API_ERROR.INVALID_REQUEST, '対象月が見つかりません。');
    const sessions = activeSessions_().filter(function(row) { return row['月ID'] === monthId; });
    if (!sessions.length) throw apiError_(API_ERROR.INVALID_REQUEST, '公開する予定がありません。');
    sessions.forEach(cleanSession_);
    const missing = selfPracticeMissingItems_(sessions);
    if (missing.length) throw apiError_(API_ERROR.SELF_PRACTICE_INCOMPLETE, '自主練の公開条件が不足しています: ' + missing.join(' / '));
    appendObjects_('sessions', sessions.map(function(session) { const row = copyObject_(session); row['確定状態'] = '公開'; return row; }));
    const publishedMonth = copyObject_(month); publishedMonth['状態'] = '公開'; appendObjects_('months', [publishedMonth]);
    return { monthId: monthId, publishedSessions: sessions.length };
  });
}

function selfPracticeMissingItems_(sessions) {
  const selfPractice = indexBy_(latestRows_(readTable_('session_selfpractice'), function(row) { return row['予定ID']; }), '予定ID');
  const assignments = dutyAssignments_();
  const missing = [];
  sessions.filter(function(session) { return session['種別'] !== '本番' && (session.staffing_am === '自主練' || session.staffing_pm === '自主練'); }).forEach(function(session) {
    const checklist = selfPractice[session['予定ID']] || {};
    const fields = [['緊急連絡先', '緊急連絡先']];
    const guardians = indexBy_(latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }).filter(function(row) { return asBoolean_(row['在籍']); }), '保護者ID');
    fields.forEach(function(field) {
      const value = checklist[field[0]];
      if (!String(value || '').trim() || (field[0] !== '緊急連絡先' && !guardians[value])) missing.push(session['日付'] + ' ' + field[1]);
    });
    const guardianIds = {};
    assignments.filter(function(row) { return row['予定ID'] === session['予定ID']; }).forEach(function(row) { if (guardians[row['保護者ID']]) guardianIds[row['保護者ID']] = true; });
    if (Object.keys(guardianIds).length < 2) missing.push(session['日付'] + ' 当番2名');
  });
  return missing;
}

function publishedMonths_() {
  return latestRows_(readTable_('months'), function(row) { return row['月ID']; }).filter(function(row) { return row['状態'] === '公開'; });
}

function publishedSessions_() {
  const monthMap = indexBy_(publishedMonths_(), '月ID');
  return activeSessions_().filter(function(row) {
    return !!monthMap[row['月ID']] && row['確定状態'] === '公開';
  });
}

function attendanceCounts_(sessions) {
  const allowed = indexBy_(sessions, '予定ID');
  const latest = latestRows_(readTable_('attendance'), function(row) { return row['子どもID'] + '|' + row['予定ID']; });
  const counts = {};
  sessions.forEach(function(session) { counts[session['予定ID']] = { morning: 0, afternoon: 0 }; });
  latest.forEach(function(row) {
    if (!allowed[row['予定ID']]) return;
    if (asBoolean_(row['午前'])) counts[row['予定ID']].morning += 1;
    if (asBoolean_(row['午後'])) counts[row['予定ID']].afternoon += 1;
  });
  return counts;
}

function publicDutyAssignments_(sessions) {
  const allowed = indexBy_(sessions, '予定ID');
  const guardians = indexBy_(readTable_('m_guardians'), '保護者ID');
  return dutyAssignments_().filter(function(row) { return !!allowed[row['予定ID']] && !!guardians[row['保護者ID']]; }).map(function(row) {
    return { '予定ID': row['予定ID'], '役割': row['役割'], '区分': row['区分'] || '', '表示名': guardians[row['保護者ID']]['表示名'] };
  });
}

function authorize_(request) {
  const adminToken = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  if (request.a && adminToken && String(request.a) === adminToken) return { role: 'admin' };
  if (request.k) {
    const household = readTable_('m_households').filter(function(row) { return String(row['招待トークン']) === String(request.k) && asBoolean_(row['在籍']); })[0];
    if (household) return { role: 'parent', household: household };
  }
  if (request.t) {
    const teacher = readTable_('m_teachers').filter(function(row) { return String(row['招待トークン']) === String(request.t) && asBoolean_(row['在籍']); })[0];
    if (teacher) return { role: 'teacher', teacher: teacher };
  }
  throw apiError_(API_ERROR.UNAUTHORIZED, '招待URLが無効です。');
}

function readTable_(sheetName) {
  const sheet = getDatabase_().getSheetByName(sheetName);
  if (!sheet) throw apiError_(API_ERROR.NOT_CONFIGURED, sheetName + ' がありません。');
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(function(row) { return row.some(function(cell) { return cell !== ''; }); }).map(function(row) {
    const result = {};
    headers.forEach(function(header, index) { result[header] = formatCell_(row[index], header); });
    return result;
  });
}

function appendObjects_(sheetName, records) {
  const sheet = getDatabase_().getSheetByName(sheetName);
  if (!sheet) throw apiError_(API_ERROR.NOT_CONFIGURED, sheetName + ' がありません。');
  if (!records.length) return;
  if (sheetName === 'sessions') ensureSessionsSchema_();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = records.map(function(record) { return headers.map(function(header) { return sheetLiteral_(record[header] === undefined ? '' : record[header]); }); });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function getDatabase_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw apiError_(API_ERROR.NOT_CONFIGURED, '先に setupBandDatabase() を実行してください。');
  return SpreadsheetApp.openById(id);
}

function ensureDeadlineOpen_(month, columnName) {
  if (!month) throw apiError_(API_ERROR.INVALID_REQUEST, '対象月が見つかりません。');
  const deadline = month[columnName];
  if (deadline && new Date(/^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline + 'T23:59:59+09:00' : deadline).getTime() < Date.now()) throw apiError_(API_ERROR.DEADLINE_CLOSED, columnName + 'を過ぎています。');
}

function withWriteLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw apiError_(API_ERROR.INVALID_REQUEST, '混み合っています。少し待って再送してください。');
  try { return callback(); } finally { lock.releaseLock(); }
}

function latestRows_(rows, keyFunction) {
  const latest = {};
  rows.forEach(function(row) { latest[keyFunction(row)] = row; });
  return Object.keys(latest).map(function(key) { return latest[key]; });
}

function indexBy_(rows, key) {
  const index = {};
  rows.forEach(function(row) { index[row[key]] = row; });
  return index;
}

function withoutKeys_(row, keys) {
  const result = copyObject_(row);
  keys.forEach(function(key) { delete result[key]; });
  return result;
}

function copyObject_(row) {
  const result = {};
  Object.keys(row).forEach(function(key) { result[key] = row[key]; });
  return result;
}

function hasAssignedId_(assigned, allowedIds) {
  return String(assigned || '').split(',').map(function(value) { return value.trim(); }).some(function(id) { return !!allowedIds[id]; });
}

function compareTimeline_(left, right) {
  const dayOrder = { '前日': 0, '当日': 1 };
  const day = (dayOrder[left['日区分']] === undefined ? 9 : dayOrder[left['日区分']]) - (dayOrder[right['日区分']] === undefined ? 9 : dayOrder[right['日区分']]);
  if (day) return day;
  const time = String(left['時刻'] || '99:99').localeCompare(String(right['時刻'] || '99:99'));
  if (time) return time;
  return Number(left['並び順'] || 0) - Number(right['並び順'] || 0);
}

function asBoolean_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1' || String(value) === '○';
}

function formatCell_(value, header) {
  if (value instanceof Date && header === '月ID') return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM');
  if (value instanceof Date && ['日付', '先生入力締切', '保護者入力締切'].indexOf(header) >= 0) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (value instanceof Date && ['集合', '開始', '終了', '解散', '時刻'].indexOf(header) >= 0) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  return value;
}

function parsePostRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) throw apiError_(API_ERROR.INVALID_REQUEST, 'JSON本文がありません。');
  try { return JSON.parse(e.postData.contents); } catch (error) { throw apiError_(API_ERROR.INVALID_REQUEST, 'JSONを解析できません。'); }
}

function requireRole_(auth, role) {
  if (auth.role !== role) throw apiError_(API_ERROR.FORBIDDEN, 'この操作の権限がありません。');
}

function apiError_(code, message) {
  const error = new Error(message);
  error.apiCode = code;
  return error;
}

function apiErrorCode_(error) {
  return error && error.apiCode ? error.apiCode : API_ERROR.INVALID_REQUEST;
}

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function activeSessions_() {
  return latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; }).filter(function(row) { return row['確定状態'] !== '削除'; }).map(function(row) {
    return withoutKeys_(row, ['staffing', '担当先生ID']);
  });
}

// 予定×役割×内部識別子を割当枠とする。保護者IDが空の最新行は割当解除。
function dutyAssignments_() {
  return latestRows_(readTable_('duty_assignments'), function(row) { return row['予定ID'] + '|' + row['役割'] + '|' + row['区分']; }).filter(function(row) { return !!row['保護者ID']; });
}

function publicTeachers_() {
  return readTable_('m_teachers').map(function(row) { return { '先生ID': row['先生ID'], '氏名': row['氏名'] }; });
}

function placeIsVisible_(row) {
  return row['有効'] === undefined || row['有効'] === '' || asBoolean_(row['有効']);
}

function allPlaces_() {
  return latestRows_(readTable_('m_places'), function(row) { return row['場所ID']; }).sort(function(a, b) {
    return (Number(a['並び順']) || 0) - (Number(b['並び順']) || 0);
  });
}

function activePlaces_() {
  return allPlaces_().filter(placeIsVisible_);
}

// 新規候補は表示中のみ。保存済みの参照名は、非表示にしても各画面で解決できる。
function placesForReferences_(sessions, items) {
  const referenced = new Set();
  (sessions || []).forEach(function(row) { ['場所ID', '集合場所ID'].forEach(function(key) { if (row[key]) referenced.add(row[key]); }); });
  (items || []).forEach(function(row) { if (row['場所ID']) referenced.add(row['場所ID']); });
  return allPlaces_().filter(function(row) { return placeIsVisible_(row) || referenced.has(row['場所ID']); });
}

function validatePlaceReference_(placeId, priorPlaceId, required, label) {
  if (!placeId && !required) return;
  const places = allPlaces_();
  const place = places.find(function(row) { return row['場所ID'] === placeId; });
  if (place && (placeIsVisible_(place) || placeId === priorPlaceId)) return;
  if (place && !placeIsVisible_(place)) throw apiError_(API_ERROR.INVALID_REQUEST, label + 'は非表示のため新しく選べません。場所一覧から復元してください。');
  if (!places.some(placeIsVisible_)) throw apiError_(API_ERROR.INVALID_REQUEST, '表示中の場所がありません。場所を追加または復元してください。');
  throw apiError_(API_ERROR.INVALID_REQUEST, label + 'を選んでください。');
}

function sharedSchedule_() {
  const sessions = publishedSessions_();
  return { sessions: sessions, layouts: publicLayouts_(sessions), daySchedule: publicDaySchedule_(sessions), events: publicEventNames_(sessions), dutyAssignments: publicDutyAssignments_(sessions), attendanceCounts: attendanceCounts_(sessions), places: placesForReferences_(sessions, publicDaySchedule_(sessions)), teachers: publicTeachers_() };
}

function publicEventNames_(sessions) {
  const sessionIds = new Set(sessions.filter(function(row) { return row['種別'] === '本番' && row['確定状態'] === '公開'; }).map(function(row) { return row['予定ID']; }));
  return latestRows_(readTable_('events'), function(row) { return row['予定ID']; }).filter(function(row) { return sessionIds.has(row['予定ID']); }).map(function(row) {
    return { '予定ID': row['予定ID'], '本番名': row['本番名'] };
  });
}

// 全体の当日予定だけを公開。個人担当・注意点・連絡先はこの経路に含めない。
function publicDaySchedule_(sessions) {
  const sessionIds = new Set(sessions.filter(function(row) { return row['種別'] === '本番' && row['確定状態'] === '公開'; }).map(function(row) { return row['予定ID']; }));
  return latestRows_(readTable_('timeline_items'), function(row) { return row['項目ID']; }).filter(function(row) {
    return sessionIds.has(row['予定ID']) && asBoolean_(row['有効']) && row.scope !== 'ステージ進行';
  }).sort(compareTimeline_).map(function(item) {
    const row = {};
    ['項目ID', '予定ID', '日区分', '時刻', '並び順', '種別', '内容', '場所ID'].forEach(function(key) { row[key] = item[key]; });
    projectTimelinePlace_(item, row);
    return row;
  });
}

/**
 * 表示元はアプリ用DB。初回だけ既存シートから取り込み、その後の編集履歴もここに追記する。
 * 元の当番表・年間本番表は、取り込み時以外は参照も書き込みもしない。
 */
function referenceSources_(includeAdmin) {
  const guideItems = latestRows_(readTable_('guide_items'), function(row) { return row['項目ID']; }).filter(function(row) { return asBoolean_(row['有効']); }).sort(referenceOrder_);
  const candidates = latestRows_(readTable_('annual_event_candidates'), function(row) { return row['候補ID']; }).filter(function(row) { return asBoolean_(row['有効']); }).sort(referenceOrder_);
  if (!guideItems.length && !candidates.length) return { status: 'not_imported', guide: { items: [] }, annualEvents: [] };
  return {
    status: 'ready',
    guide: { items: guideItems.map(function(row) { return { id: row['項目ID'], type: row['種別'], section: row['区分'], order: row['並び順'], content: row['内容'], active: true }; }) },
    annualEvents: candidates.map(function(row) {
      const event = { id: row['候補ID'], order: row['並び順'], month: row['月'], name: row['本番名'], schedule: row['日程'], venue: row['場所'], duration: row['演奏時間'], transport: row['楽器運び'], instruments: row['演奏できる楽器'], meeting: row['事前打ち合わせ'], notes: row['その他'], active: true };
      if (includeAdmin) event.contact = row['連絡先'];
      return event;
    })
  };
}

function referenceOrder_(left, right) {
  return (Number(left['並び順']) || 0) - (Number(right['並び順']) || 0);
}

function adminImportReferences_() {
  return withWriteLock_(function() {
    if (readTable_('guide_items').length || readTable_('annual_event_candidates').length) throw apiError_(API_ERROR.INVALID_REQUEST, 'すでに取り込み済みです。編集は「ガイド・本番候補」タブから行ってください。');
    const properties = PropertiesService.getScriptProperties();
    const dutyId = properties.getProperty('DUTY_GUIDE_SOURCE_SPREADSHEET_ID');
    const annualId = properties.getProperty('ANNUAL_EVENTS_SOURCE_SPREADSHEET_ID');
    if (!dutyId || !annualId) throw apiError_(API_ERROR.NOT_CONFIGURED, 'GASのスクリプト プロパティに、元シート2件のIDを設定してください。');
    const guideItems = sourceGuideItems_(referenceSheetValues_(dutyId, 'シート1'));
    const candidates = sourceAnnualEventCandidates_(referenceSheetValues_(annualId, 'シート2'));
    if (!guideItems.length && !candidates.length) throw apiError_(API_ERROR.INVALID_REQUEST, '元シートに取り込める内容がありません。');
    if (guideItems.length) appendObjects_('guide_items', guideItems);
    if (candidates.length) appendObjects_('annual_event_candidates', candidates);
    return { guideItems: guideItems.length, annualEvents: candidates.length };
  });
}

function sourceGuideItems_(rows) {
  let section = '案内';
  return rows.reduce(function(items, row, index) {
    const cells = row.filter(function(value) { return String(value || '').trim(); });
    if (!cells.length) return items;
    const content = cells.join(' · ');
    const heading = String(cells[0]).match(/^【(.+)】$/);
    const type = heading ? '見出し' : /^□/.test(String(cells[0])) ? '手順' : '本文';
    if (heading) section = heading[1];
    items.push({ '項目ID': 'GI-SOURCE-' + String(index + 1).padStart(3, '0'), '種別': type, '区分': section, '並び順': index + 1, '内容': heading ? heading[1] : content.replace(/^□\s*/, ''), '有効': true, '更新時刻': new Date() });
    return items;
  }, []);
}

function sourceAnnualEventCandidates_(rows) {
  const parsed = parseAnnualEvents_(rows, true);
  return parsed.map(function(event, index) {
    return { '候補ID': 'AEC-SOURCE-' + String(index + 1).padStart(3, '0'), '並び順': index + 1, '月': event.month, '本番名': event.name, '日程': event.schedule, '場所': event.venue, '演奏時間': event.duration, '楽器運び': event.transport, '演奏できる楽器': event.instruments, '連絡先': event.contact || '', '事前打ち合わせ': event.meeting, 'その他': event.notes, '有効': true, '更新時刻': new Date() };
  });
}

function adminSaveGuideItems_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    const rows = records.map(function(record) {
      const type = String(record['種別'] || '本文');
      if (['本文', '見出し', '手順'].indexOf(type) < 0) throw apiError_(API_ERROR.INVALID_REQUEST, 'ガイド項目の種類が不正です。');
      const content = String(record['内容'] || '').trim();
      if (!record['項目ID']) throw apiError_(API_ERROR.INVALID_REQUEST, 'ガイド項目IDが不正です。');
      return { '項目ID': String(record['項目ID']), '種別': type, '区分': String(record['区分'] || '案内').trim(), '並び順': Number(record['並び順']) || 0, '内容': content, '有効': asBoolean_(record['有効']) && !!content, '更新時刻': new Date() };
    });
    appendObjects_('guide_items', rows); return { saved: rows.length };
  });
}

function adminSaveAnnualEventCandidates_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    const rows = records.map(function(record) {
      const name = String(record['本番名'] || '').trim();
      if (!record['候補ID'] || (asBoolean_(record['有効']) && !name)) throw apiError_(API_ERROR.INVALID_REQUEST, '本番名を入力してください。');
      return { '候補ID': String(record['候補ID']), '並び順': Number(record['並び順']) || 0, '月': String(record['月'] || '').trim(), '本番名': name, '日程': String(record['日程'] || '').trim(), '場所': String(record['場所'] || '').trim(), '演奏時間': String(record['演奏時間'] || '').trim(), '楽器運び': String(record['楽器運び'] || '').trim(), '演奏できる楽器': String(record['演奏できる楽器'] || '').trim(), '連絡先': String(record['連絡先'] || '').trim(), '事前打ち合わせ': String(record['事前打ち合わせ'] || '').trim(), 'その他': String(record['その他'] || '').trim(), '有効': asBoolean_(record['有効']), '更新時刻': new Date() };
    });
    appendObjects_('annual_event_candidates', rows); return { saved: rows.length };
  });
}

function adminBackupReferences_() {
  return withWriteLock_(function() {
    const snapshot = { guideItems: latestRows_(readTable_('guide_items'), function(row) { return row['項目ID']; }), annualEvents: latestRows_(readTable_('annual_event_candidates'), function(row) { return row['候補ID']; }) };
    appendObjects_('reference_backups', [{ 'バックアップID': 'RB-' + Utilities.getUuid(), '種別': 'ガイド・年間本番候補', '内容JSON': JSON.stringify(snapshot), '作成時刻': new Date() }]);
    return { backedUp: true };
  });
}

function referenceSheetValues_(spreadsheetId, sheetName) {
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error('参照元シートが見つかりません。');
  return sheet.getDataRange().getValues().map(function(row) { return row.map(function(value) { return String(value || '').trim(); }); });
}

function parseDutyGuide_(rows) {
  const sections = [];
  let current;
  rows.forEach(function(row) {
    const text = row[0]; const heading = text.match(/^【(.+)】$/);
    if (heading) { current = { title: heading[1], items: [] }; sections.push(current); return; }
    if (current && /^□/.test(text)) current.items.push(text.replace(/^□\s*/, ''));
  });
  const practiceRows = rows.filter(function(row) { return row.some(function(cell) { return /^(土曜日|午前|午後|[01]?\d:\d\d集合)$/.test(cell); }); });
  const notes = rows.map(function(row) { return row[0]; }).filter(function(text) { return /^※|^1日練習/.test(text); });
  return { introduction: rows[2] && rows[2][0] || '', practiceRows: practiceRows, notes: notes, sections: sections };
}

function parseAnnualEvents_(rows, includeAdmin) {
  const headerIndex = rows.findIndex(function(row) { return row.indexOf('本番') >= 0; });
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex]; const index = function(name) { return headers.indexOf(name); };
  const value = function(row, name) { const column = index(name); return column >= 0 ? row[column] || '' : ''; };
  let month = '';
  return rows.slice(headerIndex + 1).reduce(function(events, row) {
    if (row[0]) month = row[0];
    const name = value(row, '本番'); if (!name) return events;
    const event = { month: month, name: name, schedule: value(row, '日程'), venue: value(row, '場所'), duration: value(row, '演奏時間'), transport: value(row, '楽器運び'), instruments: value(row, '演奏できる楽器'), meeting: value(row, '事前打ち合わせ'), notes: value(row, 'その他') };
    if (includeAdmin) event.contact = value(row, '連絡先');
    events.push(event); return events;
  }, []);
}

function requireRecords_(records) {
  if (!Array.isArray(records) || !records.length) throw apiError_(API_ERROR.INVALID_REQUEST, '保存する行がありません。');
}

function validMonthId_(value) {
  const month = String(value || '');
  if (!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) throw apiError_(API_ERROR.INVALID_REQUEST, '年月は2000〜2099年で指定します。');
  return month;
}

function validateDeadline_(value) {
  if (value && !validDate_(value)) throw apiError_(API_ERROR.INVALID_REQUEST, '締切日が不正です。');
}

function validDate_(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function cleanSession_(record) {
  const row = {};
  const prior = indexBy_(activeSessions_(), '予定ID')[String(record['予定ID'] || '').trim()] || {};
  BAND_DB_SCHEMA.sessions.forEach(function(key) {
    const value = record[key] === undefined && key === '集合場所ID' ? (prior[key] || '') : record[key];
    row[key] = String(value === undefined ? '' : value).trim();
  });
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(row['予定ID'])) throw apiError_(API_ERROR.INVALID_REQUEST, '予定IDが不正です。');
  validMonthId_(row['月ID']);
  if (!indexBy_(latestRows_(readTable_('months'), function(item) { return item['月ID']; }), '月ID')[row['月ID']]) throw apiError_(API_ERROR.INVALID_REQUEST, '対象月がありません。');
  if (!validDate_(row['日付']) || row['日付'].slice(0, 7) !== row['月ID']) throw apiError_(API_ERROR.INVALID_REQUEST, '日付は対象月内で指定します。');
  if (['通常練習', '自主練', '本番', 'その他'].indexOf(row['種別']) < 0) throw apiError_(API_ERROR.INVALID_REQUEST, '種別が不正です。');
  const teachers = indexBy_(readTable_('m_teachers').filter(function(item) { return asBoolean_(item['在籍']); }), '先生ID');
  ['am', 'pm'].forEach(function(slot) {
    const execution = '実施有無_' + slot;
    const staffing = 'staffing_' + slot; const teacher = '担当先生ID_' + slot;
    if (row[execution] === '') row[execution] = slot === 'pm' && row['種別'] === '本番' ? 'なし' : '実施';
    if (['実施', 'なし'].indexOf(row[execution]) < 0) throw apiError_(API_ERROR.INVALID_REQUEST, '午前・午後の実施有無を指定してください。');
    if (slot === 'pm' && row['種別'] === '本番') { row[execution] = 'なし'; row[staffing] = ''; row[teacher] = ''; return; }
    if (row[execution] === 'なし') { row[staffing] = ''; row[teacher] = ''; return; }
    if (row['種別'] === '自主練') { row[staffing] = '自主練'; row[teacher] = ''; return; }
    if (['未定', '先生あり', '自主練'].indexOf(row[staffing]) < 0) throw apiError_(API_ERROR.INVALID_REQUEST, '午前・午後の指導体制を指定してください。');
    if (row[staffing] === '先生あり') {
      const teacherIds = row[teacher].split(',').map(function(id) { return id.trim(); }).filter(Boolean);
      const uniqueTeacherIds = teacherIds.filter(function(id, index) { return teacherIds.indexOf(id) === index; });
      if (teacherIds.length < 1 || teacherIds.length > 2 || uniqueTeacherIds.length !== teacherIds.length || teacherIds.some(function(id) { return !teachers[id]; })) {
        throw apiError_(API_ERROR.INVALID_REQUEST, '担当先生は在籍中の先生から1名または2名選んでください。');
      }
      row[teacher] = teacherIds.join(',');
    }
    if (row[staffing] !== '先生あり') row[teacher] = '';
  });
  const times = ['集合', '開始', '終了', '解散'].map(function(key) { return row[key]; });
  const knownTimes = row['種別'] === '本番' ? times.filter(function(time) { return time !== ''; }) : times;
  knownTimes.forEach(function(time) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw apiError_(API_ERROR.INVALID_REQUEST, '集合・開始・終了・解散時刻を指定してください。'); });
  if (knownTimes.join('|') !== knownTimes.slice().sort().join('|')) throw apiError_(API_ERROR.INVALID_REQUEST, '集合→開始→終了→解散の順に指定してください。');
  validatePlaceReference_(row['場所ID'], prior['場所ID'], true, row['種別'] === '通常練習' ? '練習場所' : '場所');
  validatePlaceReference_(row['集合場所ID'], prior['集合場所ID'], false, '集合場所');
  return row;
}

function ensureSessionsSchema_() {
  const sheet = getDatabase_().getSheetByName('sessions');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (BAND_DB_SCHEMA.sessions.some(function(key) { return headers.indexOf(key) < 0; })) throw apiError_(API_ERROR.NOT_CONFIGURED, 'GASで migrateSessionsSchema() を実行してください。');
}

function ensureMembersSchema_() {
  const sheet = getDatabase_().getSheetByName('m_members');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('学年') < 0) throw apiError_(API_ERROR.NOT_CONFIGURED, 'GASで setupBandDatabase() を実行して、子どもの学年欄を追加してください。');
}

function ensureTimelineSchema_() {
  const sheet = getDatabase_().getSheetByName('timeline_items');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('stageJSON') < 0) throw apiError_(API_ERROR.NOT_CONFIGURED, 'GASで setupBandDatabase() を実行して演奏進行欄を追加してください。');
  if (headers.indexOf('有効') < 0) throw apiError_(API_ERROR.NOT_CONFIGURED, 'GASで setupBandDatabase() を実行して、進行項目の有効欄を追加してください。');
}

function adminSaveMonth_(request) {
  return withWriteLock_(function() {
    const month = indexBy_(latestRows_(readTable_('months'), function(row) { return row['月ID']; }), '月ID')[request.monthId];
    if (!month) throw apiError_(API_ERROR.INVALID_REQUEST, '対象月がありません。');
    validateDeadline_(request.teacherDeadline); validateDeadline_(request.parentDeadline);
    const row = copyObject_(month); row['先生入力締切'] = request.teacherDeadline || ''; row['保護者入力締切'] = request.parentDeadline || '';
    appendObjects_('months', [row]); return { saved: 1 };
  });
}

function adminDeleteSession_(sessionId) {
  return withWriteLock_(function() {
    const row = indexBy_(activeSessions_(), '予定ID')[sessionId];
    if (!row) throw apiError_(API_ERROR.INVALID_REQUEST, '予定がありません。');
    row['確定状態'] = '削除'; appendObjects_('sessions', [row]); return { saved: 1 };
  });
}

function unpublishSessions_(ids) {
  const rows = activeSessions_().filter(function(row) { return ids.indexOf(row['予定ID']) >= 0 && row['確定状態'] === '公開'; }).map(function(row) { row['確定状態'] = '下書き'; return row; });
  if (rows.length) appendObjects_('sessions', rows);
}

function adminSaveSelfPractice_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    const sessions = indexBy_(activeSessions_(), '予定ID');
    const guardians = indexBy_(latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }).filter(function(row) { return asBoolean_(row['在籍']); }), '保護者ID');
    const rows = records.map(function(record) {
      if (!sessions[record['予定ID']]) throw apiError_(API_ERROR.INVALID_REQUEST, '予定がありません。');
      const prior = latestRows_(readTable_('session_selfpractice'), function(row) { return row['予定ID']; }).find(function(row) { return row['予定ID'] === record['予定ID']; }) || {};
      ['鍵の担当', '中止判断者'].forEach(function(key) { if (record[key] === undefined) record[key] = prior[key] || ''; });
      const row = copyObject_(record); row['施設使用申請済'] = asBoolean_(row['施設使用申請済']); return row;
    });
    unpublishSessions_(rows.map(function(row) { return row['予定ID']; }));
    appendObjects_('session_selfpractice', rows); return { saved: rows.length };
  });
}

function adminSaveDutyAssignments_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    const sessions = indexBy_(activeSessions_(), '予定ID');
    const guardians = indexBy_(latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }).filter(function(row) { return asBoolean_(row['在籍']); }), '保護者ID');
    const rows = records.map(function(record) {
      if (!sessions[record['予定ID']] || !String(record['役割'] || '').trim() || !/^[A-Za-z0-9_\-\u3040-\u30ff\u4e00-\u9faf]{1,80}$/.test(String(record['区分'] || ''))) throw apiError_(API_ERROR.INVALID_REQUEST, '当番の予定・役割・識別子が不正です。');
      if (record['保護者ID'] && !guardians[record['保護者ID']]) throw apiError_(API_ERROR.INVALID_REQUEST, '保護者が不正です。');
      return { '予定ID': record['予定ID'], '役割': String(record['役割']).trim(), '区分': record['区分'], '保護者ID': record['保護者ID'] || '', '更新時刻': new Date() };
    });
    unpublishSessions_(rows.map(function(row) { return row['予定ID']; }));
    appendObjects_('duty_assignments', rows); return { saved: rows.length };
  });
}

// Sheetsが自由入力を数式として実行しないよう文字列化する。
function sheetLiteral_(value) {
  return typeof value === 'string' && /^[=+@-]/.test(value) ? "'" + value : value;
}

function keyedRows_(rows, key) { const result = {}; rows.forEach(function(row) { result[key(row)] = row; }); return result; }
function partialAnswer_(record, key, prior) {
  if (record[key] === undefined) return prior === undefined ? '' : prior;
  if (record[key] === null || record[key] === '') return '';
  if (record[key] === true || record[key] === false) return record[key];
  throw apiError_(API_ERROR.INVALID_REQUEST, '回答は出席・欠席・未入力で指定してください。');
}

function teacherAssignmentConflicts_(sessions) {
  const availability = keyedRows_(latestRows_(readTable_('teacher_availability'), function(row) { return row['先生ID'] + '|' + row['予定ID'] + '|' + row['枠']; }), function(row) { return row['先生ID'] + '|' + row['予定ID'] + '|' + row['枠']; });
  const conflicts = [];
  sessions.filter(function(s) { return s['種別'] !== '本番'; }).forEach(function(s) { ['am', 'pm'].forEach(function(slot) {
    if (s['実施有無_' + slot] === 'なし' || s['staffing_' + slot] !== '先生あり') return;
    const label = slot === 'am' ? '午前' : '午後';
    String(s['担当先生ID_' + slot] || '').split(',').filter(Boolean).forEach(function(id) { const row = availability[id.trim() + '|' + s['予定ID'] + '|' + label]; if (!row || row['可否'] !== '○') conflicts.push({ sessionId: s['予定ID'], date: s['日付'], slot: label, teacherId: id.trim(), availability: row ? row['可否'] : '' }); });
  }); }); return conflicts;
}

function layoutRows_() {
  if (!getDatabase_().getSheetByName('event_layouts')) return [];
  return latestRows_(readTable_('event_layouts'), function(row) { return row['配置図ID']; }).filter(function(row) { return asBoolean_(row['有効']); }).map(function(row) {
    return { id: row['配置図ID'], sessionId: row['予定ID'], name: row['図名'], notes: row['備考'], items: JSON.parse(row['配置JSON'] || '[]'), active: true };
  });
}
function publicLayouts_(sessions) {
  const allowed = indexBy_(sessions, '予定ID');
  return layoutRows_().filter(function(row) { return allowed[row.sessionId] && allowed[row.sessionId]['種別'] === '本番'; }).map(function(row) {
    return { id: row.id, sessionId: row.sessionId, name: row.name, notes: row.notes, items: row.items.map(function(item) { return { id: item.id, kind: item.kind, label: item.label, x: item.x, y: item.y }; }) };
  });
}
function adminSaveLayouts_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    const sessions = indexBy_(activeSessions_(), '予定ID');
    const members = indexBy_(latestRows_(readTable_('m_members'), function(row) { return row['子どもID']; }).filter(function(row) { return asBoolean_(row['在籍']); }), '子どもID');
    const rows = records.map(function(record) {
      assertKnownKeys_(record, ['id','sessionId','name','notes','items','active']);
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(record.id || '')) || !sessions[record.sessionId] || sessions[record.sessionId]['種別'] !== '本番') throw apiError_(API_ERROR.INVALID_REQUEST, '本番予定と配置図IDを指定してください。');
      if (!String(record.name || '').trim() || !Array.isArray(record.items) || record.items.length > 100) throw apiError_(API_ERROR.INVALID_REQUEST, '図名と100項目以内の配置を指定してください。');
      const ids = {};
      const items = record.items.map(function(item) {
        assertKnownKeys_(item, ['id','kind','label','memberId','x','y']);
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(item.id || '')) || ids[item.id] || ['person','instrument'].indexOf(item.kind) < 0 || !String(item.label || '').trim() || String(item.label).length > 40 || typeof item.x !== 'number' || typeof item.y !== 'number' || !isFinite(item.x) || !isFinite(item.y) || item.x < 5 || item.x > 95 || item.y < 5 || item.y > 90) throw apiError_(API_ERROR.INVALID_REQUEST, '配置項目の名称・種類・位置が不正です。');
        ids[item.id] = true;
        if (item.memberId && (item.kind !== 'person' || !members[item.memberId])) throw apiError_(API_ERROR.INVALID_REQUEST, '在籍中のメンバーを選んでください。');
        return { id: String(item.id), kind: item.kind, label: item.memberId ? members[item.memberId]['氏名'] : String(item.label).trim(), memberId: item.memberId || '', x: item.x, y: item.y };
      });
      return { '配置図ID': record.id, '予定ID': record.sessionId, '図名': String(record.name).trim(), '備考': String(record.notes || ''), '配置JSON': JSON.stringify(items), '有効': record.active !== false, '更新時刻': new Date() };
    });
    if (!getDatabase_().getSheetByName('event_layouts')) throw apiError_(API_ERROR.NOT_CONFIGURED, 'setupBandDatabase()で配置図タブを追加してください。');
    unpublishSessions_(rows.map(function(row) { return row['予定ID']; }));
    appendObjects_('event_layouts', rows);
    return { saved: rows.length };
  });
}

// 演奏進行は専用JSON欄。自由文の注意点や持ち物を構造化データで上書きしない。
function normalizeStage_(value, sessionId) {
  if (!value) return { speakers: [], microphones: [], prepare: [], layoutId: '', changes: '' };
  let stage; try { stage = typeof value === 'string' ? JSON.parse(value) : value; } catch (_) { throw apiError_(API_ERROR.INVALID_REQUEST, '演奏進行の形式が不正です。'); }
  if (!stage || typeof stage !== 'object' || Array.isArray(stage)) throw apiError_(API_ERROR.INVALID_REQUEST, '演奏進行の形式が不正です。');
  assertKnownKeys_(stage, ['speakers','prepare','microphones','layoutId','changes','placeText']);
  const people = {};
  latestRows_(readTable_('m_members'), function(row) { return row['子どもID']; }).filter(function(row) { return asBoolean_(row['在籍']); }).forEach(function(row) { people[row['子どもID']] = true; });
  latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }).filter(function(row) { return asBoolean_(row['在籍']); }).forEach(function(row) { people[row['保護者ID']] = true; });
  function ids(values) { if (!Array.isArray(values)) throw apiError_(API_ERROR.INVALID_REQUEST, '演奏担当の形式が不正です。'); return values.filter(function(id, index) { if (typeof id !== 'string' || !people[id]) throw apiError_(API_ERROR.INVALID_REQUEST, '在籍中の演奏担当を選んでください。'); return values.indexOf(id) === index; }); }
  function person(id) { if (!id) return ''; if (typeof id !== 'string' || !people[id]) throw apiError_(API_ERROR.INVALID_REQUEST, '在籍中のマイク担当を選んでください。'); return id; }
  function text(value, limit) { if (value === undefined || value === null) return ''; if (typeof value !== 'string' || value.length > limit) throw apiError_(API_ERROR.INVALID_REQUEST, '演奏進行の入力が長すぎるか形式が不正です。'); return value.trim(); }
  const microphones = stage.microphones || [];
  if (!Array.isArray(microphones) || microphones.length > 100) throw apiError_(API_ERROR.INVALID_REQUEST, 'マイク欄の形式が不正です。');
  const layoutId = text(stage.layoutId, 100);
  if (layoutId && !layoutRows_().some(function(layout) { return layout.id === layoutId && layout.sessionId === sessionId; })) throw apiError_(API_ERROR.INVALID_REQUEST, 'この本番の配置図を選んでください。');
  return Object.assign({}, Object.prototype.hasOwnProperty.call(stage, 'placeText') ? {placeText: text(stage.placeText, 200)} : {}, { speakers: ids(stage.speakers || []), prepare: ids(stage.prepare || []), microphones: microphones.map(function(mic) { if (!mic || typeof mic !== 'object' || Array.isArray(mic)) throw apiError_(API_ERROR.INVALID_REQUEST, 'マイク欄の形式が不正です。'); assertKnownKeys_(mic, ['label','from','to']); return { label: text(mic.label, 80), from: person(mic.from), to: person(mic.to) }; }), layoutId: layoutId, changes: text(stage.changes, 1000) });
}
function compareStage_(a, b) {
  const day = { '前日': 0, '当日': 1 }; return (day[a['日区分']] || 0) - (day[b['日区分']] || 0) || Number(a['並び順'] || 0) - Number(b['並び順'] || 0) || String(a['項目ID']).localeCompare(String(b['項目ID']));
}
function publicStage_(item, allowedIds) {
  let stage; try { stage = JSON.parse(item.stageJSON || '{}'); } catch (_) { stage = {}; }
  const names = {};
  latestRows_(readTable_('m_members'), function(row) { return row['子どもID']; }).filter(function(row) { return asBoolean_(row['在籍']); }).forEach(function(row) { names[row['子どもID']] = row['氏名']; });
  latestRows_(readTable_('m_guardians'), function(row) { return row['保護者ID']; }).filter(function(row) { return asBoolean_(row['在籍']); }).forEach(function(row) { names[row['保護者ID']] = row['表示名']; });
  const roles = {}; function role(id, label) { if (allowedIds[id]) { roles[id] = roles[id] || []; if (roles[id].indexOf(label) < 0) roles[id].push(label); } }
  (stage.speakers || []).forEach(function(id) { role(id, '話す担当'); }); (stage.prepare || []).forEach(function(id) { role(id, '次の準備'); });
  const microphones = (stage.microphones || []).map(function(mic) { role(mic.from, 'マイクを渡す'); role(mic.to, 'マイクを受け取る'); return { label: mic.label || '', fromName: names[mic.from] || '', toName: names[mic.to] || '' }; });
  String(item['担当'] || '').split(',').forEach(function(id) { role(id, '進行担当'); });
  return { id: item['項目ID'], sessionId: item['予定ID'], day: item['日区分'], order: item['並び順'], time: item['時刻'], kind: item['種別'], title: item['内容'], stage: { speakerNames: (stage.speakers || []).map(function(id) { return names[id] || ''; }).filter(Boolean), prepareNames: (stage.prepare || []).map(function(id) { return names[id] || ''; }).filter(Boolean), microphones: microphones, layoutId: stage.layoutId || '', changes: stage.changes || '' }, roles: roles };
}

function instrumentText_(value) {
  if (typeof value !== 'string' || value.trim().length > 40) throw apiError_(API_ERROR.INVALID_REQUEST, '使用楽器は40文字以内で入力してください。');
  return value.trim();
}
function instrumentRows_() {
  if (!getDatabase_().getSheetByName('m_instruments')) return [];
  return latestRows_(readTable_('m_instruments'), function(row) { return row['楽器ID']; });
}
function adminSaveInstruments_(records) {
  return withWriteLock_(function() {
    requireRecords_(records);
    if (!getDatabase_().getSheetByName('m_instruments')) throw apiError_(API_ERROR.NOT_CONFIGURED, '楽器マスターの構造移行が必要です。');
    const all = indexBy_(instrumentRows_(), '楽器ID');
    const rows = records.map(function(record) {
      const id = String(record['楽器ID'] || ''); const name = instrumentText_(record['表示名']);
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !name || typeof record['有効'] !== 'boolean') throw apiError_(API_ERROR.INVALID_REQUEST, '楽器ID・表示名・有効状態が不正です。');
      if (all[id] && all[id]['表示名'] !== name) throw apiError_(API_ERROR.INVALID_REQUEST, '登録済み楽器の名前は変更できません。別の候補として追加してください。');
      const row = { '楽器ID': id, '表示名': name, '有効': record['有効'], '更新時刻': new Date() }; all[id] = row; return row;
    });
    const names = {}; Object.keys(all).forEach(function(id) { const row = all[id]; if(asBoolean_(row['有効'])) { if(names[row['表示名']]) throw apiError_(API_ERROR.INVALID_REQUEST, '同じ表示名の楽器が既にあります。'); names[row['表示名']] = true; } });
    appendObjects_('m_instruments', rows); return { saved: rows.length };
  });
}

function assertKnownKeys_(record, allowed) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(function(key) { return allowed.indexOf(key) < 0; })) throw apiError_(API_ERROR.INVALID_REQUEST, '未対応の項目があります。保存せず入力形式を確認してください。');
}

function projectTimelinePlace_(item, row) {
  let stage; try { stage = JSON.parse(item.stageJSON || '{}'); } catch (_) { return; }
  if (stage && typeof stage.placeText === 'string') row['場所自由入力'] = stage.placeText;
}

return {projectTimelinePlace_,setupBandDatabase,ensureSheet_,seedDemoData_,appendSeedRows_,createInviteToken_,migratePlacesSchema,migrateMembersSchema,migrateTeachersSchema,migrateTimelineSchema,migrateSessionsSchema,migrateStageSchema,migratePerformanceSchema,doGet,doPost,handleRead_,readAuthorized_,handleWrite_,parentBootstrap_,parentCard_,teacherBootstrap_,adminBootstrap_,saveTeacherAvailability_,saveParentMonth_,saveAdmin_,adminSaveTeacherAvailability_,adminSavePlace_,adminSetPlaceVisibility_,adminSaveHouseholds_,adminSaveGuardians_,adminSaveMembers_,adminSaveRoster_,adminSaveTeachers_,adminCreateMonth_,createSaturdaySessions_,adminSaveSessions_,adminAppend_,adminSaveTimelineItems_,adminPublishMonth_,selfPracticeMissingItems_,publishedMonths_,publishedSessions_,attendanceCounts_,publicDutyAssignments_,authorize_,readTable_,appendObjects_,getDatabase_,ensureDeadlineOpen_,withWriteLock_,latestRows_,indexBy_,withoutKeys_,copyObject_,hasAssignedId_,compareTimeline_,asBoolean_,formatCell_,parsePostRequest_,requireRole_,apiError_,apiErrorCode_,jsonResponse_,activeSessions_,dutyAssignments_,publicTeachers_,placeIsVisible_,allPlaces_,activePlaces_,placesForReferences_,validatePlaceReference_,sharedSchedule_,publicEventNames_,publicDaySchedule_,referenceSources_,referenceOrder_,adminImportReferences_,sourceGuideItems_,sourceAnnualEventCandidates_,adminSaveGuideItems_,adminSaveAnnualEventCandidates_,adminBackupReferences_,referenceSheetValues_,parseDutyGuide_,parseAnnualEvents_,requireRecords_,validMonthId_,validateDeadline_,validDate_,cleanSession_,ensureSessionsSchema_,ensureMembersSchema_,ensureTimelineSchema_,adminSaveMonth_,adminDeleteSession_,unpublishSessions_,adminSaveSelfPractice_,adminSaveDutyAssignments_,sheetLiteral_,keyedRows_,partialAnswer_,teacherAssignmentConflicts_,layoutRows_,publicLayouts_,adminSaveLayouts_,normalizeStage_,compareStage_,publicStage_,instrumentText_,instrumentRows_,adminSaveInstruments_,assertKnownKeys_};})(context));
  function post(request) { return JSON.parse(context.doPost({ postData: { contents: JSON.stringify(request) } }).text); }
  function admin(action, payload = {}) { const response = post({ ...payload, action, a: properties.get('ADMIN_TOKEN') }); if (!response.ok) throw Object.assign(new Error(response.message), { code: response.error }); return response.data; }
  return { context, sheets, spreadsheet, properties, post, admin, addExternalSpreadsheet, get writes() { return writes; }, get locked() { return locked; } };
}


const KEY='hiranuma.preview.20261024.v1';
const snapshot=h=>JSON.stringify({version:1,sheets:[...h.sheets].map(([name,s])=>[name,s.rows]),properties:[...h.properties]});
function restore(text){const saved=JSON.parse(text);if(saved.version!==1)throw Error('プレビュー保存形式が違います');const h=createHarness();for(const [name,rows] of saved.sheets)h.spreadsheet.insertSheet(name).rows=rows;for(const [k,v] of saved.properties)h.properties.set(k,v);return h;}
function initial(){const h=createHarness();h.context.setupBandDatabase();const now=new Date(),month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
if(month!=='2026-09')h.admin('admin_create_month',{monthId:month,generateSaturdays:true});
const sample=h.admin('admin_bootstrap').sessions[0];const id='PREVIEW-EVENT';const event={...sample,'予定ID':id,'月ID':month,'日付':month+'-24','種別':'本番','集合':'','開始':'','終了':'','解散':'','実施有無_am':'実施',staffing_am:'未定','担当先生ID_am':'','実施有無_pm':'なし',staffing_pm:'','担当先生ID_pm':'','備考':'架空の本番です。集合・時刻は未定。'};
h.admin('admin_save_sessions',{records:[event]});h.admin('admin_save_event',{records:[{'予定ID':id,'本番名':'架空本番サンプル','会場':'架空ホール','衣装':'見本の衣装','子どもの持ち物':'見本の持ち物','全体連絡':'操作確認用の架空データです。'}]});
h.admin('admin_save_instruments',{records:[{'楽器ID':'PREVIEW-I1','表示名':'トランペット3','有効':true},{'楽器ID':'PREVIEW-I2','表示名':'ドラム1','有効':true}]});
h.admin('admin_save_layouts',{records:[{id:'PREVIEW-L1',sessionId:id,name:'曲Aの配置',notes:'位置と楽器を編集して保存できます。',active:true,items:[{id:'P1',kind:'person',label:'メンバー01',memberId:'M001',x:25,y:30},{id:'PAIR-P1',kind:'instrument',label:'トランペット3',memberId:'',x:25,y:45}]},{id:'PREVIEW-L2',sessionId:id,name:'曲Bの配置',notes:'曲ごとに配置を切り替えます。',active:true,items:[{id:'P2',kind:'person',label:'メンバー01',memberId:'M001',x:65,y:40}]}]});
h.admin('admin_save_timeline_items',{records:[{ '項目ID':'PREVIEW-T1','予定ID':id,'日区分':'当日','時刻':'','並び順':1,scope:'ステージ進行','種別':'曲','内容':'見本の曲A','担当':'M001','有効':true,stageJSON:'{"layoutId":"PREVIEW-L1","changes":"変更なし"}'},{'項目ID':'PREVIEW-T2','予定ID':id,'日区分':'当日','並び順':2,scope:'ステージ進行','種別':'MC','内容':'見本のあいさつ','有効':true,stageJSON:'{"speakers":["M001"],"microphones":[{"label":"マイク1","from":"G001","to":"M001"}]}'},{'項目ID':'PREVIEW-T3','予定ID':id,'日区分':'当日','並び順':3,scope:'ステージ進行','種別':'曲','内容':'見本の曲B','有効':true,stageJSON:'{"layoutId":"PREVIEW-L2","changes":"右へ移動"}'},{'項目ID':'PREVIEW-D1','予定ID':id,'日区分':'当日','時刻':'09:30','並び順':1,scope:'当日進行','種別':'予定','内容':'架空の集合確認','場所ID':'P001','有効':true}]});
h.admin('admin_publish_month',{monthId:month});return h;}
let h;let storageError='';try{const saved=localStorage.getItem(KEY);h=saved?restore(saved):initial();}catch(e){h=initial();storageError='端末内の保存データを読めませんでした。変更を保存する前に確認してください。';}
window.BandAPI={create(role){return{hasToken:true,endpoint:'架空データ・このブラウザー内保存',configure(){throw Error('プレビューから外部サービスへ接続できません。');},forget(){},async request(action,payload={}){
let saved;try{saved=localStorage.getItem(KEY);if(saved)h=restore(saved);}catch(e){throw Error('端末内の保存データを読み取れません。初期状態へ戻す操作で復旧できます。');}
const before=snapshot(h);const auth=role==='a'?{a:h.properties.get('ADMIN_TOKEN')}:role==='k'?{k:h.context.readTable_('m_households')[0]['招待トークン']}:{t:h.context.readTable_('m_teachers')[0]['招待トークン']};
const result=h.post({...payload,...auth,action});if(!result.ok){h=restore(before);throw Object.assign(Error(result.message),{code:result.error});}
if(!['admin_bootstrap','parent_bootstrap','parent_card','teacher_bootstrap'].includes(action)){try{localStorage.setItem(KEY,snapshot(h));}catch(e){h=restore(before);throw Error('このブラウザーに保存できませんでした。入力内容を残して再試行してください。');}}
if(result.data.invites)result.data.invites={households:[],teachers:[]};return result.data;
}};}};
document.addEventListener('DOMContentLoaded',()=>{document.getElementById('preview-reset').addEventListener('click',()=>{if(confirm('このプレビューの架空データだけを初期状態に戻しますか？')){try{localStorage.removeItem(KEY);location.reload();}catch(e){alert('端末内の保存を変更できません。');}}});if(storageError)document.querySelector('[aria-label="プレビューの説明"]').append(document.createTextNode(storageError));});
})();
