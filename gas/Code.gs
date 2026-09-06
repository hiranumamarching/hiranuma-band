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
    case 'admin_save_timeline_items':
    case 'admin_save_teacher_availability':
    case 'admin_save_place':
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
    household: withoutKeys_(auth.household, ['招待トークン']),
    guardians: guardians,
    members: members,
    months: latestRows_(readTable_('months'), function(row) { return row['月ID']; }),
    sessions: sessions,
    inputSessions: inputSessions,
    attendance: ownAttendance,
    dutyOffers: ownDutyOffers,
    attendanceCounts: attendanceCounts_(sessions),
    dutyAssignments: publicDutyAssignments_(sessions),
    places: activePlaces_(),
    teachers: publicTeachers_()
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
    places: activePlaces_(),
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
    places: activePlaces_()
  };
  return {
    masters: masters,
    shared: sharedSchedule_(),
    months: latestRows_(readTable_('months'), function(row) { return row['月ID']; }),
    sessions: activeSessions_(),
    selfPractice: latestRows_(readTable_('session_selfpractice'), function(row) { return row['予定ID']; }),
    teacherAvailability: latestRows_(readTable_('teacher_availability'), function(row) { return row['先生ID'] + '|' + row['予定ID'] + '|' + row['枠']; }),
    attendance: latestRows_(readTable_('attendance'), function(row) { return row['子どもID'] + '|' + row['予定ID']; }),
    dutyOffers: latestRows_(readTable_('duty_offers'), function(row) { return row['保護者ID'] + '|' + row['予定ID']; }),
    dutyAssignments: dutyAssignments_(),
    events: latestRows_(readTable_('events'), function(row) { return row['予定ID']; }),
    timelineItems: readTable_('timeline_items')
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
  const attendanceRows = Array.isArray(request.attendance) ? request.attendance : [];
  const dutyRows = Array.isArray(request.dutyOffers) ? request.dutyOffers : [];
  if (!attendanceRows.length && !dutyRows.length) throw apiError_(API_ERROR.INVALID_REQUEST, '送信する入力がありません。');
  const householdId = auth.household['家庭ID'];
  const memberMap = indexBy_(readTable_('m_members').filter(function(row) { return row['家庭ID'] === householdId; }), '子どもID');
  const guardianMap = indexBy_(readTable_('m_guardians').filter(function(row) { return row['家庭ID'] === householdId; }), '保護者ID');
  const sessions = indexBy_(activeSessions_(), '予定ID');
  const months = indexBy_(latestRows_(readTable_('months'), function(row) { return row['月ID']; }), '月ID');
  const fallbackGuardianId = Object.keys(guardianMap)[0] || '';
  const attendance = attendanceRows.map(function(row) {
    const session = sessions[row.sessionId];
    if (!memberMap[row.memberId] || !session) throw apiError_(API_ERROR.FORBIDDEN, 'この家庭では送信できない子どもまたは予定です。');
    ensureDeadlineOpen_(months[session['月ID']], '保護者入力締切');
    const guardianId = row.guardianId || fallbackGuardianId;
    if (!guardianMap[guardianId]) throw apiError_(API_ERROR.FORBIDDEN, '入力者がこの家庭に属していません。');
    const amOpen = session['種別'] === '本番' || session['実施有無_am'] !== 'なし';
    const pmOpen = session['種別'] !== '本番' && session['実施有無_pm'] !== 'なし';
    if ((!amOpen && asBoolean_(row.morning)) || (!pmOpen && asBoolean_(row.afternoon))) throw apiError_(API_ERROR.INVALID_REQUEST, '実施しない枠には出席を送信できません。');
    return { '子どもID': row.memberId, '予定ID': row.sessionId, '午前': amOpen && asBoolean_(row.morning), '午後': pmOpen && asBoolean_(row.afternoon), '連絡事項': String(row.note || ''), '入力者': guardianId, '送信時刻': new Date() };
  });
  const offers = dutyRows.map(function(row) {
    const session = sessions[row.sessionId];
    if (!session || !fallbackGuardianId || (row.guardianId && row.guardianId !== fallbackGuardianId)) throw apiError_(API_ERROR.FORBIDDEN, 'この家庭では送信できない当番可否です。');
    ensureDeadlineOpen_(months[session['月ID']], '保護者入力締切');
    return { '保護者ID': fallbackGuardianId, '予定ID': row.sessionId, '可否': asBoolean_(row.available), 'メモ': String(row.note || ''), '送信時刻': new Date() };
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
    case 'admin_save_timeline_items':
      return adminAppend_(request.records || [], 'timeline_items', ['項目ID', '予定ID', '日区分', '種別', '内容']);
    case 'admin_save_teacher_availability':
      return adminSaveTeacherAvailability_(request.records || []);
    case 'admin_save_place':
      return adminSavePlace_(request);
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
    if (activePlaces_().some(function(row) { return row['名称'] === name; })) throw apiError_(API_ERROR.INVALID_REQUEST, '同じ場所が既にあります。');
    const numbers = all.map(function(row) { const match = String(row['場所ID']).match(/^P(\d+)$/); return match ? Number(match[1]) : 0; });
    const orders = all.map(function(row) { return Number(row['並び順']) || 0; });
    const row = { '場所ID': 'P' + String(Math.max.apply(null, [0].concat(numbers)) + 1).padStart(3, '0'), '名称': name, '並び順': Math.max.apply(null, [0].concat(orders)) + 1, '有効': true };
    appendObjects_('m_places', [row]);
    return { place: row };
  });
}

function adminCreateMonth_(request) {
  return withWriteLock_(function() {
    const monthId = validMonthId_(request.monthId);
    const existing = latestRows_(readTable_('months'), function(row) { return row['月ID']; });
    if (indexBy_(existing, '月ID')[monthId]) throw apiError_(API_ERROR.INVALID_REQUEST, '対象月は既に存在します。');
    const sessions = createSaturdaySessions_(monthId, request.copyFromMonthId || '');
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
  withWriteLock_(function() { appendObjects_(sheetName, records); });
  return { saved: records.length, sheet: sheetName };
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
  sessions.filter(function(session) { return session.staffing_am === '自主練' || (session['種別'] !== '本番' && session.staffing_pm === '自主練'); }).forEach(function(session) {
    const checklist = selfPractice[session['予定ID']] || {};
    const fields = [['鍵の担当', '鍵の担当'], ['中止判断者', '中止判断者'], ['緊急連絡先', '緊急連絡先']];
    const guardians = indexBy_(readTable_('m_guardians').filter(function(row) { return asBoolean_(row['在籍']); }), '保護者ID');
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
    return { '予定ID': row['予定ID'], '役割': row['役割'], '表示名': guardians[row['保護者ID']]['表示名'] };
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
  const day = (dayOrder[left['日区分']] || 9) - (dayOrder[right['日区分']] || 9);
  if (day) return day;
  const time = String(left['時刻']).localeCompare(String(right['時刻']));
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

function activePlaces_() {
  return latestRows_(readTable_('m_places'), function(row) { return row['場所ID']; }).filter(function(row) {
    return row['有効'] === undefined || row['有効'] === '' || asBoolean_(row['有効']);
  }).sort(function(a, b) { return (Number(a['並び順']) || 0) - (Number(b['並び順']) || 0); });
}

function sharedSchedule_() {
  const sessions = publishedSessions_();
  return { sessions: sessions, dutyAssignments: publicDutyAssignments_(sessions), attendanceCounts: attendanceCounts_(sessions), places: activePlaces_(), teachers: publicTeachers_() };
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
  BAND_DB_SCHEMA.sessions.forEach(function(key) { row[key] = String(record[key] === undefined ? '' : record[key]).trim(); });
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
  times.forEach(function(time) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw apiError_(API_ERROR.INVALID_REQUEST, '集合・開始・終了・解散時刻を指定してください。'); });
  if (times.join('|') !== times.slice().sort().join('|')) throw apiError_(API_ERROR.INVALID_REQUEST, '集合→開始→終了→解散の順に指定してください。');
  if (!indexBy_(activePlaces_(), '場所ID')[row['場所ID']]) throw apiError_(API_ERROR.INVALID_REQUEST, '場所を選んでください。');
  return row;
}

function ensureSessionsSchema_() {
  const sheet = getDatabase_().getSheetByName('sessions');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (BAND_DB_SCHEMA.sessions.some(function(key) { return headers.indexOf(key) < 0; })) throw apiError_(API_ERROR.NOT_CONFIGURED, 'GASで migrateSessionsSchema() を実行してください。');
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
    const guardians = indexBy_(readTable_('m_guardians').filter(function(row) { return asBoolean_(row['在籍']); }), '保護者ID');
    const rows = records.map(function(record) {
      if (!sessions[record['予定ID']]) throw apiError_(API_ERROR.INVALID_REQUEST, '予定がありません。');
      ['鍵の担当', '中止判断者'].forEach(function(key) { if (record[key] && !guardians[record[key]]) throw apiError_(API_ERROR.INVALID_REQUEST, key + 'を在籍保護者から選んでください。'); });
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
    const guardians = indexBy_(readTable_('m_guardians').filter(function(row) { return asBoolean_(row['在籍']); }), '保護者ID');
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
