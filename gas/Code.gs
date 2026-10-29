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
    return jsonResponse_(['admin_export_backup', 'admin_bootstrap', 'teacher_bootstrap', 'parent_bootstrap', 'parent_card'].indexOf(request.action) >= 0 ? handleRead_(request) : handleWrite_(request));
  } catch (error) {
    return jsonResponse_({ ok: false, error: apiErrorCode_(error), message: error.message });
  }
}

function handleRead_(request) {
  // 公開予定と当番の読み取り途中に下書き保存が割り込まないようにする。
  return withWriteLock_(function() { const result = readAuthorized_(request); result.data._revision = databaseRevision_(); result.data._protocol = 1; return result; });
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
    case 'admin_export_backup':
      requireRole_(auth, 'admin');
      return {ok:true,data:{backup:exportSharedBackup_()}};
    case 'admin_bootstrap':
      requireRole_(auth, 'admin');
      return { ok: true, data: adminBootstrap_() };
    default:
      throw apiError_(API_ERROR.INVALID_REQUEST, 'GET action が不正です。');
  }
}

function dispatchWrite_(request) {
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
    stageItems:teacherPublishedStage_(),
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
    publishedEvents:publicEventNames_(publishedSessions_()),
    publishedSessions:publishedSessions_(),
    layouts:publicLayouts_(publishedSessions_()),
    daySchedule:publicDaySchedule_(publishedSessions_()),
    stageItems:teacherPublishedStage_(),
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
  if(dutyRows.length){const sheet=getDatabase_().getSheetByName('duty_offers');const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];if(!headers.includes('午前可否')||!headers.includes('午後可否'))throw apiError_(API_ERROR.NOT_CONFIGURED,'当番時間帯の保存列の更新が必要です。');}
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
    const prior=priorOffers[fallbackGuardianId+'|'+row.sessionId]||{};
    const touched=row.morning!==undefined||row.afternoon!==undefined;
    if(!touched && (typeof prior['午前可否']==='boolean'||typeof prior['午後可否']==='boolean') && row.available!==undefined && partialAnswer_(row,'available',prior['可否'])!==prior['可否'])throw apiError_(API_ERROR.INVALID_REQUEST,'午前・午後を指定できる画面で回答してください。');
    for(const key of ['morning','afternoon'])if(row[key]!==undefined&&row[key]!==null&&typeof row[key]!=='boolean')throw apiError_(API_ERROR.INVALID_REQUEST,'当番の午前・午後は可能/不可/未回答で指定してください。');
    const morning=partialAnswer_(row,'morning',prior['午前可否']);const afternoon=partialAnswer_(row,'afternoon',prior['午後可否']);
    const available=touched?(morning===true||afternoon===true?true:morning===false&&afternoon===false?false:''):partialAnswer_(row,'available',prior['可否']);
    return { '保護者ID': fallbackGuardianId, '予定ID': row.sessionId, '可否': available, '午前可否':morning, '午後可否':afternoon, 'メモ': row.note === undefined ? (priorOffers[fallbackGuardianId + '|' + row.sessionId] || {})['メモ'] || '' : String(row.note || ''), '送信時刻': new Date() };
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
    const household = latestRows_(readTable_('m_households'), function(row) { return row['家庭ID']; }).filter(function(row) { return String(row['招待トークン']) === String(request.k) && asBoolean_(row['在籍']); })[0];
    if (household) return { role: 'parent', household: household };
  }
  if (request.t) {
    const teacher = latestRows_(readTable_('m_teachers'), function(row) { return row['先生ID']; }).filter(function(row) { return String(row['招待トークン']) === String(request.t) && asBoolean_(row['在籍']); })[0];
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

let writeLockDepth_ = 0;
function withWriteLock_(callback) {
  if (writeLockDepth_) return callback();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw apiError_(API_ERROR.INVALID_REQUEST, '混み合っています。少し待って再送してください。');
  try { writeLockDepth_++; return callback(); } finally { writeLockDepth_--; lock.releaseLock(); }
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

// Conservative whole-database compare-and-swap. Reserve before writing so a
// partial failure cannot be retried blindly. All nested writers share this lock.
function databaseRevision_() { return String(PropertiesService.getScriptProperties().getProperty('DATA_REVISION') || '0'); }
function handleWrite_(request) {
  return withWriteLock_(function() {
    const auth = authorize_(request);
    if (request.action.indexOf('admin_') === 0) requireRole_(auth, 'admin');
    if (request.action === 'save_parent_month') requireRole_(auth, 'parent');
    if (request.action === 'save_teacher_availability') requireRole_(auth, 'teacher');
    if (typeof request.expectedRevision !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(request.requestId || '')) throw apiError_('upgrade_required', '保存方式が更新されました。入力を控えてから最新画面を開いてください。');
    const props = PropertiesService.getScriptProperties();
    const identity = auth.role + ':' + (auth.household ? auth.household['家庭ID'] : auth.teacher ? auth.teacher['先生ID'] : 'admin');
    const fingerprint = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(request)).map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    let last; try { last = JSON.parse(props.getProperty('LAST_WRITE_RECEIPT') || 'null'); } catch (_) { last = null; }
    if (last && last.id === request.requestId && last.identity === identity) {
      if (last.fingerprint !== fingerprint) throw apiError_('conflict', '同じ送信番号の入力内容が変わっています。最新内容を確認してください。');
      if (last.status === 'done' && last.result) return last.result;
      throw apiError_('recovery_required', '前回の保存結果が確定できません。入力は残っています。最新内容と照合してから再開してください。');
    }
    if (request.expectedRevision !== databaseRevision_()) throw apiError_('conflict', 'ほかの端末の保存が先に反映されています。入力は残っています。最新内容を確認してください。');
    const revision = Utilities.getUuid();
    const receipt = {id:request.requestId,identity:identity,fingerprint:fingerprint,status:'pending',revision:revision};
    props.setProperty('DATA_REVISION', revision);
    props.setProperty('LAST_WRITE_RECEIPT', JSON.stringify(receipt));
    const result = dispatchWrite_(request);
    result.data = result.data || {}; result.data._revision = revision; result.data._protocol = 1;
    receipt.status = 'done';
    if (JSON.stringify(result).length < 2000) receipt.result = result;
    props.setProperty('LAST_WRITE_RECEIPT', JSON.stringify(receipt));
    return result;
  });
}

function teacherPublishedStage_(){const allowed=indexBy_(publishedSessions_(),'予定ID');return latestRows_(readTable_('timeline_items'),function(r){return r['項目ID'];}).filter(function(r){return allowed[r['予定ID']]&&asBoolean_(r['有効'])&&r.scope==='ステージ進行';}).sort(compareStage_).map(function(r){return publicStage_(r,{});});}
function exportSharedBackup_(){const tables={};Object.keys(BAND_DB_SCHEMA).forEach(function(name){const sheet=getDatabase_().getSheetByName(name);if(sheet)tables[name]=sheet.getDataRange().getValues();});return {format:'hiranuma-shared-backup',version:1,createdAt:new Date().toISOString(),tables:tables};}
// Operator-only local candidate. Restore only to an empty target; never replaces rows.
function restoreSharedBackupToEmpty_(backup){if(!backup||backup.format!=='hiranuma-shared-backup'||backup.version!==1||!backup.tables)throw Error('バックアップ形式が不正です');const names=Object.keys(backup.tables);if(names.length!==Object.keys(BAND_DB_SCHEMA).length||names.some(function(n){return !BAND_DB_SCHEMA[n];}))throw Error('表の構成が一致しません');names.forEach(function(n){const rows=backup.tables[n],sheet=getDatabase_().getSheetByName(n);if(!sheet||sheet.getLastRow()>1)throw Error('空の復元先だけに復元できます');if(!Array.isArray(rows)||!Array.isArray(rows[0])||rows[0].length<BAND_DB_SCHEMA[n].length||new Set(rows[0]).size!==rows[0].length||BAND_DB_SCHEMA[n].some(function(k){return rows[0].indexOf(k)<0;})||rows.some(function(r){return !Array.isArray(r)||r.length>rows[0].length||r.some(function(v){return v!==null&&typeof v==='object';});}))throw Error('列または行の形式が不正です');});names.forEach(function(n){if(JSON.stringify(getDatabase_().getSheetByName(n).getDataRange().getValues()[0])!==JSON.stringify(backup.tables[n][0]))throw Error('復元先の列を先に整合してください');});names.forEach(function(n){const rows=backup.tables[n];if(rows.length>1)getDatabase_().getSheetByName(n).getRange(2,1,rows.length-1,rows[0].length).setValues(rows.slice(1).map(function(r){return rows[0].map(function(_,i){return r[i]===undefined?'':r[i];});}));});return {restored:true};}
