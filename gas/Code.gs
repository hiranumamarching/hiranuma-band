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
    return jsonResponse_(handleWrite_(request));
  } catch (error) {
    return jsonResponse_({ ok: false, error: apiErrorCode_(error), message: error.message });
  }
}

function handleRead_(request) {
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
    case 'admin_save_sessions':
    case 'admin_save_selfpractice':
    case 'admin_save_duty_assignments':
    case 'admin_save_event':
    case 'admin_save_timeline_items':
    case 'admin_save_teacher_availability':
    case 'admin_publish_month':
      requireRole_(auth, 'admin');
      return { ok: true, data: saveAdmin_(request) };
    default:
      throw apiError_(API_ERROR.INVALID_REQUEST, 'POST action が不正です。');
  }
}

function parentBootstrap_(auth) {
  const householdId = auth.household['家庭ID'];
  const members = readTable_('m_members').filter(function(row) {
    return row['家庭ID'] === householdId && asBoolean_(row['在籍']);
  });
  const guardians = readTable_('m_guardians').filter(function(row) {
    return row['家庭ID'] === householdId && asBoolean_(row['在籍']);
  });
  const sessions = publishedSessions_();
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
    household: withoutKeys_(auth.household, ['招待トークン']),
    guardians: guardians,
    members: members,
    months: publishedMonths_(),
    sessions: sessions,
    attendance: ownAttendance,
    dutyOffers: ownDutyOffers,
    attendanceCounts: attendanceCounts_(sessions),
    dutyAssignments: ownDutyAssignments_(sessions, guardianIds)
  };
}

function parentCard_(auth, sessionId) {
  const householdId = auth.household['家庭ID'];
  const guardians = readTable_('m_guardians').filter(function(row) { return row['家庭ID'] === householdId; });
  const members = readTable_('m_members').filter(function(row) { return row['家庭ID'] === householdId; });
  const allowedIds = {};
  guardians.forEach(function(row) { allowedIds[row['保護者ID']] = true; });
  members.forEach(function(row) { allowedIds[row['子どもID']] = true; });
  const allowedSessions = indexBy_(publishedSessions_(), '予定ID');
  const items = readTable_('timeline_items').filter(function(item) {
    return !!allowedSessions[item['予定ID']] && (!sessionId || item['予定ID'] === sessionId) && hasAssignedId_(item['担当'], allowedIds);
  }).sort(compareTimeline_);
  return { guardians: guardians, members: members, timelineItems: items };
}

function teacherBootstrap_(auth) {
  const months = latestRows_(readTable_('months'), function(row) { return row['月ID']; });
  const monthMap = indexBy_(months, '月ID');
  const sessions = latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; }).filter(function(row) {
    return !!monthMap[row['月ID']];
  });
  const availability = latestRows_(readTable_('teacher_availability'), function(row) {
    return row['先生ID'] + '|' + row['予定ID'] + '|' + row['枠'];
  }).filter(function(row) { return row['先生ID'] === auth.teacher['先生ID']; });
  return {
    teacher: withoutKeys_(auth.teacher, ['招待トークン']),
    months: months,
    sessions: sessions,
    availability: availability,
    now: new Date().toISOString()
  };
}

function adminBootstrap_() {
  const masters = {
    households: readTable_('m_households').map(function(row) { return withoutKeys_(row, ['招待トークン']); }),
    guardians: readTable_('m_guardians'),
    members: readTable_('m_members'),
    teachers: readTable_('m_teachers').map(function(row) { return withoutKeys_(row, ['招待トークン']); }),
    places: readTable_('m_places')
  };
  return {
    masters: masters,
    months: latestRows_(readTable_('months'), function(row) { return row['月ID']; }),
    sessions: latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; }),
    selfPractice: latestRows_(readTable_('session_selfpractice'), function(row) { return row['予定ID']; }),
    teacherAvailability: latestRows_(readTable_('teacher_availability'), function(row) { return row['先生ID'] + '|' + row['予定ID'] + '|' + row['枠']; }),
    attendance: latestRows_(readTable_('attendance'), function(row) { return row['子どもID'] + '|' + row['予定ID']; }),
    dutyOffers: latestRows_(readTable_('duty_offers'), function(row) { return row['保護者ID'] + '|' + row['予定ID']; }),
    dutyAssignments: latestRows_(readTable_('duty_assignments'), function(row) { return row['予定ID'] + '|' + row['役割'] + '|' + row['保護者ID'] + '|' + row['区分']; }),
    events: latestRows_(readTable_('events'), function(row) { return row['予定ID']; }),
    timelineItems: readTable_('timeline_items')
  };
}

function saveTeacherAvailability_(auth, request) {
  const rows = Array.isArray(request.records) ? request.records : [];
  if (!rows.length) throw apiError_(API_ERROR.INVALID_REQUEST, '可否の入力がありません。');
  const sessions = indexBy_(latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; }), '予定ID');
  const monthMap = indexBy_(latestRows_(readTable_('months'), function(row) { return row['月ID']; }), '月ID');
  const teacherId = auth.teacher['先生ID'];
  const records = rows.map(function(row) {
    const session = sessions[row.sessionId];
    if (!session || !monthMap[session['月ID']]) throw apiError_(API_ERROR.INVALID_REQUEST, '予定IDが不正です。');
    ensureDeadlineOpen_(monthMap[session['月ID']], '先生入力締切');
    const slot = String(row.slot || '');
    if (['午前', '午後', '終日'].indexOf(slot) === -1) throw apiError_(API_ERROR.INVALID_REQUEST, '枠が不正です。');
    if (session['種別'] === '本番' && slot !== '終日') throw apiError_(API_ERROR.INVALID_REQUEST, '本番は終日で入力します。');
    if (session['種別'] !== '本番' && slot === '終日') throw apiError_(API_ERROR.INVALID_REQUEST, '練習は午前または午後で入力します。');
    if (['○', '×', '△'].indexOf(String(row.availability || '')) === -1) throw apiError_(API_ERROR.INVALID_REQUEST, '可否が不正です。');
    return { '先生ID': teacherId, '予定ID': session['予定ID'], '枠': slot, '可否': row.availability, '送信時刻': new Date() };
  });
  withWriteLock_(function() { appendObjects_('teacher_availability', records); });
  return { saved: records.length };
}

function saveParentMonth_(auth, request) {
  const attendanceRows = Array.isArray(request.attendance) ? request.attendance : [];
  const dutyRows = Array.isArray(request.dutyOffers) ? request.dutyOffers : [];
  if (!attendanceRows.length && !dutyRows.length) throw apiError_(API_ERROR.INVALID_REQUEST, '送信する入力がありません。');
  const householdId = auth.household['家庭ID'];
  const memberMap = indexBy_(readTable_('m_members').filter(function(row) { return row['家庭ID'] === householdId; }), '子どもID');
  const guardianMap = indexBy_(readTable_('m_guardians').filter(function(row) { return row['家庭ID'] === householdId; }), '保護者ID');
  const sessions = indexBy_(latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; }), '予定ID');
  const months = indexBy_(latestRows_(readTable_('months'), function(row) { return row['月ID']; }), '月ID');
  const fallbackGuardianId = Object.keys(guardianMap)[0] || '';
  const attendance = attendanceRows.map(function(row) {
    const session = sessions[row.sessionId];
    if (!memberMap[row.memberId] || !session) throw apiError_(API_ERROR.FORBIDDEN, 'この家庭では送信できない子どもまたは予定です。');
    ensureDeadlineOpen_(months[session['月ID']], '保護者入力締切');
    const guardianId = row.guardianId || fallbackGuardianId;
    if (!guardianMap[guardianId]) throw apiError_(API_ERROR.FORBIDDEN, '入力者がこの家庭に属していません。');
    return { '子どもID': row.memberId, '予定ID': row.sessionId, '午前': asBoolean_(row.morning), '午後': asBoolean_(row.afternoon), '連絡事項': String(row.note || ''), '入力者': guardianId, '送信時刻': new Date() };
  });
  const offers = dutyRows.map(function(row) {
    const session = sessions[row.sessionId];
    if (!guardianMap[row.guardianId] || !session) throw apiError_(API_ERROR.FORBIDDEN, 'この家庭では送信できない保護者または予定です。');
    ensureDeadlineOpen_(months[session['月ID']], '保護者入力締切');
    return { '保護者ID': row.guardianId, '予定ID': row.sessionId, '可否': asBoolean_(row.available), 'メモ': String(row.note || ''), '送信時刻': new Date() };
  });
  withWriteLock_(function() {
    if (attendance.length) appendObjects_('attendance', attendance);
    if (offers.length) appendObjects_('duty_offers', offers);
  });
  return { attendanceSaved: attendance.length, dutyOffersSaved: offers.length };
}

function saveAdmin_(request) {
  switch (request.action) {
    case 'admin_create_month':
      return adminCreateMonth_(request);
    case 'admin_save_sessions':
      return adminSaveSessions_(request.records || []);
    case 'admin_save_selfpractice':
      return adminAppend_(request.records || [], 'session_selfpractice', ['予定ID']);
    case 'admin_save_duty_assignments':
      return adminAppend_(request.records || [], 'duty_assignments', ['予定ID', '役割', '保護者ID', '区分']);
    case 'admin_save_event':
      return adminAppend_(request.records || [], 'events', ['予定ID', '本番名']);
    case 'admin_save_timeline_items':
      return adminAppend_(request.records || [], 'timeline_items', ['項目ID', '予定ID', '日区分', '種別', '内容']);
    case 'admin_save_teacher_availability':
      return adminSaveTeacherAvailability_(request.records || []);
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
  const sessions = indexBy_(latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; }), '予定ID');
  const teachers = indexBy_(readTable_('m_teachers'), '先生ID');
  const rows = records.map(function(row) {
    const session = sessions[row.sessionId];
    if (!session) throw apiError_(API_ERROR.INVALID_REQUEST, '予定IDが不正です。');
    if (!teachers[row.teacherId]) throw apiError_(API_ERROR.INVALID_REQUEST, '先生IDが不正です。');
    const slot = String(row.slot || '');
    if (['午前', '午後', '終日'].indexOf(slot) === -1) throw apiError_(API_ERROR.INVALID_REQUEST, '枠が不正です。');
    if (session['種別'] === '本番' && slot !== '終日') throw apiError_(API_ERROR.INVALID_REQUEST, '本番は終日で入力します。');
    if (session['種別'] !== '本番' && slot === '終日') throw apiError_(API_ERROR.INVALID_REQUEST, '練習は午前または午後で入力します。');
    if (['○', '×', '△'].indexOf(String(row.availability || '')) === -1) throw apiError_(API_ERROR.INVALID_REQUEST, '可否が不正です。');
    return { '先生ID': row.teacherId, '予定ID': session['予定ID'], '枠': slot, '可否': row.availability, '送信時刻': new Date() };
  });
  withWriteLock_(function() { appendObjects_('teacher_availability', rows); });
  return { saved: rows.length };
}

function adminCreateMonth_(request) {
  const monthId = String(request.monthId || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthId)) throw apiError_(API_ERROR.INVALID_REQUEST, '月IDは YYYY-MM で指定します。');
  const existing = latestRows_(readTable_('months'), function(row) { return row['月ID']; });
  if (indexBy_(existing, '月ID')[monthId]) throw apiError_(API_ERROR.INVALID_REQUEST, '対象月は既に存在します。');
  const sessions = createSaturdaySessions_(monthId, request.copyFromMonthId || '');
  withWriteLock_(function() {
    appendObjects_('months', [{ '月ID': monthId, '状態': '下書き', '先生入力締切': request.teacherDeadline || '', '保護者入力締切': request.parentDeadline || '' }]);
    appendObjects_('sessions', sessions);
  });
  return { monthId: monthId, sessionsCreated: sessions.length };
}

function createSaturdaySessions_(monthId, copyFromMonthId) {
  const parts = monthId.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const prior = latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; }).filter(function(row) { return row['月ID'] === copyFromMonthId; })[0] || {};
  const defaults = {
    '集合': prior['集合'] || '09:30', '開始': prior['開始'] || '10:00', '終了': prior['終了'] || '15:00', '解散': prior['解散'] || '15:30', '場所ID': prior['場所ID'] || 'P001'
  };
  const records = [];
  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1) break;
    if (date.getDay() !== 6) continue;
    const isoDate = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    records.push({ '予定ID': 'S' + isoDate.replace(/-/g, ''), '月ID': monthId, '日付': isoDate, '種別': '通常練習', 'staffing': '未定', '担当先生ID': '', '集合': defaults['集合'], '開始': defaults['開始'], '終了': defaults['終了'], '解散': defaults['解散'], '場所ID': defaults['場所ID'], '確定状態': '下書き', '備考': '' });
  }
  return records;
}

function adminSaveSessions_(records) {
  if (!Array.isArray(records) || !records.length) throw apiError_(API_ERROR.INVALID_REQUEST, '予定がありません。');
  const allowedStaffing = ['未定', '先生あり', '自主練'];
  records.forEach(function(record) {
    if (!record['予定ID'] || allowedStaffing.indexOf(record.staffing || record['staffing']) === -1) throw apiError_(API_ERROR.INVALID_REQUEST, '予定IDまたは staffing が不正です。');
  });
  return adminAppend_(records, 'sessions', ['予定ID', '月ID', '日付', '種別', 'staffing']);
}

function adminAppend_(records, sheetName, requiredKeys) {
  if (!Array.isArray(records) || !records.length) throw apiError_(API_ERROR.INVALID_REQUEST, '保存する行がありません。');
  records.forEach(function(record) {
    requiredKeys.forEach(function(key) { if (record[key] === undefined || record[key] === '') throw apiError_(API_ERROR.INVALID_REQUEST, key + ' は必須です。'); });
  });
  withWriteLock_(function() { appendObjects_(sheetName, records); });
  return { saved: records.length, sheet: sheetName };
}

function adminPublishMonth_(monthId) {
  if (!monthId) throw apiError_(API_ERROR.INVALID_REQUEST, '月IDが必要です。');
  const months = indexBy_(latestRows_(readTable_('months'), function(row) { return row['月ID']; }), '月ID');
  const month = months[monthId];
  if (!month) throw apiError_(API_ERROR.INVALID_REQUEST, '対象月が見つかりません。');
  const sessions = latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; }).filter(function(row) { return row['月ID'] === monthId; });
  const missing = selfPracticeMissingItems_(sessions);
  if (missing.length) throw apiError_(API_ERROR.SELF_PRACTICE_INCOMPLETE, '自主練の公開条件が不足しています: ' + missing.join(' / '));
  withWriteLock_(function() {
    const publishedMonth = copyObject_(month); publishedMonth['状態'] = '公開'; appendObjects_('months', [publishedMonth]);
    appendObjects_('sessions', sessions.map(function(session) { const row = copyObject_(session); row['確定状態'] = '公開'; return row; }));
  });
  return { monthId: monthId, publishedSessions: sessions.length };
}

function selfPracticeMissingItems_(sessions) {
  const selfPractice = indexBy_(latestRows_(readTable_('session_selfpractice'), function(row) { return row['予定ID']; }), '予定ID');
  const assignments = latestRows_(readTable_('duty_assignments'), function(row) { return row['予定ID'] + '|' + row['役割'] + '|' + row['保護者ID'] + '|' + row['区分']; });
  const missing = [];
  sessions.filter(function(session) { return session['staffing'] === '自主練'; }).forEach(function(session) {
    const checklist = selfPractice[session['予定ID']] || {};
    const fields = [['鍵の担当', '鍵の担当'], ['中止判断者', '中止判断者'], ['緊急連絡先', '緊急連絡先'], ['施設使用申請済', '施設使用申請済']];
    fields.forEach(function(field) {
      const value = checklist[field[0]];
      if (!value || (field[0] === '施設使用申請済' && !asBoolean_(value))) missing.push(session['日付'] + ' ' + field[1]);
    });
    const guardianIds = {};
    assignments.filter(function(row) { return row['予定ID'] === session['予定ID']; }).forEach(function(row) { guardianIds[row['保護者ID']] = true; });
    if (Object.keys(guardianIds).length < 2) missing.push(session['日付'] + ' 当番2名');
  });
  return missing;
}

function publishedMonths_() {
  return latestRows_(readTable_('months'), function(row) { return row['月ID']; }).filter(function(row) { return row['状態'] === '公開'; });
}

function publishedSessions_() {
  const monthMap = indexBy_(publishedMonths_(), '月ID');
  return latestRows_(readTable_('sessions'), function(row) { return row['予定ID']; }).filter(function(row) {
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

function ownDutyAssignments_(sessions, guardianIds) {
  const allowedSessions = indexBy_(sessions, '予定ID');
  return latestRows_(readTable_('duty_assignments'), function(row) { return row['予定ID'] + '|' + row['役割'] + '|' + row['保護者ID'] + '|' + row['区分']; }).filter(function(row) {
    return !!allowedSessions[row['予定ID']] && !!guardianIds[row['保護者ID']];
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
    headers.forEach(function(header, index) { result[header] = formatCell_(row[index]); });
    return result;
  });
}

function appendObjects_(sheetName, records) {
  const sheet = getDatabase_().getSheetByName(sheetName);
  if (!sheet) throw apiError_(API_ERROR.NOT_CONFIGURED, sheetName + ' がありません。');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = records.map(function(record) { return headers.map(function(header) { return record[header] === undefined ? '' : record[header]; }); });
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
  if (deadline && new Date(deadline).getTime() < Date.now()) throw apiError_(API_ERROR.DEADLINE_CLOSED, columnName + 'を過ぎています。');
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
  const day = (dayOrder[left['日区分']] || 9) - (dayOrder[right['日区分']] || 9);
  if (day) return day;
  const time = String(left['時刻']).localeCompare(String(right['時刻']));
  if (time) return time;
  return Number(left['並び順'] || 0) - Number(right['並び順'] || 0);
}

function asBoolean_(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1' || String(value) === '○';
}

function formatCell_(value) {
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
