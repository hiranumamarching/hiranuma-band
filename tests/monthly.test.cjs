const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./gas-harness.cjs');
function fresh() { const h = createHarness(); h.context.setupBandDatabase(); return h; }
function bootstrap(h) { return h.admin('admin_bootstrap'); }
function selfPractice(h, afternoon = true) {
  const s = bootstrap(h).sessions[0]; s.staffing_am = afternoon ? '先生あり' : '自主練'; s['担当先生ID_am'] = afternoon ? 'T001' : ''; s.staffing_pm = afternoon ? '自主練' : '先生あり'; s['担当先生ID_pm'] = afternoon ? '' : 'T002';
  h.admin('admin_save_sessions', { records: [s] }); return s;
}
function checklist(h, id) { h.admin('admin_save_selfpractice', { records: [{ '予定ID': id, '鍵の担当': 'G001', '中止判断者': 'G002', '緊急連絡先': '架空の連絡窓口', '施設使用申請済': false }] }); }
function assignment(h, id, guardian, division = '主', role = '見守り') { h.admin('admin_save_duty_assignments', { records: [{ '予定ID': id, '役割': role, '区分': division, '保護者ID': guardian }] }); }
function parent(h, id = 'H001') { const household = h.context.readTable_('m_households').find(r => r['家庭ID'] === id); return h.post({ action: 'parent_bootstrap', k: household['招待トークン'] }); }

test('初期化はダミーのみ・再実行は追記しない・新sessions15列', () => {
  const h = fresh(); const count = h.writes; h.context.setupBandDatabase(); assert.equal(h.writes, count);
  const columns = h.sheets.get('sessions').rows[0]; assert.equal(columns.length, 15); assert(!columns.includes('staffing')); assert(columns.includes('担当先生ID_pm'));
  assert.equal(bootstrap(h).masters.teachers.length, 4);
});

test('旧スキーマ移行は既存列/行を保存・両枠コピー・本番PM空・再実行可能', () => {
  const h = fresh(); const sheet = h.sheets.get('sessions');
  sheet.rows = [['予定ID','月ID','日付','種別','staffing','担当先生ID','集合','開始','終了','解散','場所ID','確定状態','備考'], ['OLD','2026-09','2026-09-05','通常練習','先生あり','T001','09:30','10:00','15:00','15:30','P001','公開',''], ['EVENT','2026-09','2026-09-06','本番','自主練','','09:30','10:00','15:00','15:30','P001','公開','']];
  const old = structuredClone(sheet.rows);
  assert.throws(() => h.admin('admin_create_month', { monthId: '2026-10' }), /migrateSessionsSchema/);
  const result = h.context.migrateSessionsSchema(); assert.equal(result.columnsAdded, 4); assert.equal(result.sessionsMigrated, 2);
  assert.deepEqual(sheet.rows[0].slice(0, 13), old[0]); assert.deepEqual(sheet.rows[1], old[1]); assert.deepEqual(sheet.rows[2], old[2]);
  const rows = bootstrap(h).sessions; assert.equal(rows[0].staffing_pm, '先生あり'); assert.equal(rows[0]['担当先生ID_pm'], 'T001'); assert.equal(rows[1].staffing_pm, '');
  assert(!('staffing' in rows[0])); assert.equal(h.context.migrateSessionsSchema().sessionsMigrated, 0);
});

test('月作成:土曜自動生成・前月時刻引継ぎ・重複禁止・締切更新追記', () => {
  const h = fresh(); const s = bootstrap(h).sessions[0]; s['集合'] = '08:00'; s['解散'] = '16:00'; h.admin('admin_save_sessions', { records: [s] });
  const r = h.admin('admin_create_month', { monthId: '2026-10', copyFromMonthId: '2026-09' }); assert.equal(r.sessionsCreated, 5);
  const dates = bootstrap(h).sessions.filter(s => s['月ID'] === '2026-10'); assert.deepEqual(dates.map(s => s['日付']), ['2026-10-03','2026-10-10','2026-10-17','2026-10-24','2026-10-31']);
  assert(dates.every(s => s['集合'] === '08:00' && s['解散'] === '16:00' && s.staffing_am === '未定' && s.staffing_pm === '未定'));
  assert.throws(() => h.admin('admin_create_month', { monthId: '2026-10' }), /既に存在/);
  h.admin('admin_save_month', { monthId: '2026-10', teacherDeadline: '2026-09-20', parentDeadline: '2026-09-25' }); assert.equal(bootstrap(h).months.find(m => m['月ID'] === '2026-10')['先生入力締切'], '2026-09-20');
});

test('午前午後の先生指定は独立・本番終日・不正な担当と日付を拒否', () => {
  const h = fresh(); const s = bootstrap(h).sessions[0]; Object.assign(s, { staffing_am: '先生あり', '担当先生ID_am': 'T001', staffing_pm: '先生あり', '担当先生ID_pm': 'T002' });
  h.admin('admin_save_sessions', { records: [s] }); assert.equal(bootstrap(h).sessions[0]['担当先生ID_pm'], 'T002');
  assert.throws(() => h.admin('admin_save_sessions', { records: [{ ...s, '担当先生ID_pm': '' }] }), /担当先生/);
  assert.throws(() => h.admin('admin_save_sessions', { records: [{ ...s, '日付': '2026-09-31' }] }), /日付/);
  h.admin('admin_save_sessions', { records: [{ ...s, '予定ID': 'NEW_EVENT', '日付': '2026-09-06', '種別': '本番' }] }); const event = bootstrap(h).sessions.find(s => s['予定ID'] === 'NEW_EVENT'); assert.equal(event.staffing_pm, ''); assert.equal(event['担当先生ID_pm'], '');
});

for (const afternoon of [true, false]) test(`${afternoon ? '午後' : '午前'}だけ自主練でも4条件必須・同じ保護者は1名・施設申請は任意`, () => {
  const h = fresh(); const s = selfPractice(h, afternoon);
  assert.throws(() => h.admin('admin_publish_month', { monthId: '2026-09' }), /当番2名/);
  checklist(h, s['予定ID']); assignment(h, s['予定ID'], 'G001'); assignment(h, s['予定ID'], 'G001', '副');
  assert.throws(() => h.admin('admin_publish_month', { monthId: '2026-09' }), /当番2名/);
  assignment(h, s['予定ID'], 'G002', '副'); h.admin('admin_publish_month', { monthId: '2026-09' }); assert.equal(parent(h).data.sessions.length, 4);
});

test('当番再割当/解除は追記・編集で下書き化・再公開・旧担当を表示しない', () => {
  const h = fresh(); const s = selfPractice(h); checklist(h,s['予定ID']); assignment(h,s['予定ID'],'G001'); assignment(h,s['予定ID'],'G002','副'); h.admin('admin_publish_month',{monthId:'2026-09'});
  assignment(h,s['予定ID'],'G003'); assert(!parent(h).data.sessions.some(r => r['予定ID'] === s['予定ID']));
  h.admin('admin_publish_month',{monthId:'2026-09'}); const duties = parent(h).data.dutyAssignments; assert.equal(duties.length,2); assert(duties.some(d => d['表示名'] === '保護者03')); assert(!duties.some(d => d['表示名'] === '保護者01'));
  assignment(h,s['予定ID'],'','副'); assert.throws(() => h.admin('admin_publish_month',{monthId:'2026-09'}), /当番2名/);
});

test('保護者の公開当番は表示名付きallowlistのみ・他家庭連絡事項は不送信', () => {
  const h = fresh(); const s = bootstrap(h).sessions[0]; assignment(h,s['予定ID'],'G002');
  h.context.appendObjects_('attendance',[{'予定ID':s['予定ID'],'子どもID':'M001','午前':true,'午後':false,'連絡事項':'自家庭用'},{'予定ID':s['予定ID'],'子どもID':'M002','午前':true,'午後':true,'連絡事項':'他家庭の秘密連絡'}]);
  h.context.appendObjects_('duty_offers',[{'予定ID':s['予定ID'],'保護者ID':'G001','可否':true,'メモ':'自家庭メモ'},{'予定ID':s['予定ID'],'保護者ID':'G002','可否':true,'メモ':'他家庭の秘密メモ'}]);
  h.admin('admin_publish_month',{monthId:'2026-09'}); const r = parent(h).data;
  assert.equal(r.dutyAssignments[0]['表示名'],'保護者02'); assert.deepEqual(Object.keys(r.dutyAssignments[0]).sort(), ['予定ID','区分','役割','表示名'].sort());
  assert.equal(r.attendance[0]['連絡事項'],'自家庭用'); assert.equal(r.dutyOffers[0]['メモ'],'自家庭メモ'); assert(!JSON.stringify(r).includes('他家庭の秘密'));
  assert.equal(r.attendanceCounts[s['予定ID']].morning,2); assert.deepEqual(bootstrap(h).shared.dutyAssignments,r.dutyAssignments);
});

test('公開状態の直接指定を無視・チェックリスト編集でも公開解除', () => {
  const h = fresh(); const s = selfPractice(h); h.admin('admin_save_sessions',{records:[{...s,'確定状態':'公開'}]}); assert.equal(parent(h).data.sessions.length,0);
  checklist(h,s['予定ID']); assignment(h,s['予定ID'],'G001'); assignment(h,s['予定ID'],'G002','副'); h.admin('admin_publish_month',{monthId:'2026-09'});
  h.admin('admin_save_selfpractice',{records:[{'予定ID':s['予定ID'],'緊急連絡先':''}]}); assert(!parent(h).data.sessions.some(r=>r['予定ID']===s['予定ID'])); assert.throws(()=>h.admin('admin_publish_month',{monthId:'2026-09'}),/緊急連絡先/);
});

test('候補削除は追記墓標・先生/保護者/管理者から除外・再公開で復活しない', () => {
  const h = fresh(); h.admin('admin_publish_month',{monthId:'2026-09'}); const before = structuredClone(h.sheets.get('sessions').rows); const id='S20260905';
  h.admin('admin_delete_session',{sessionId:id}); assert.deepEqual(h.sheets.get('sessions').rows.slice(0,before.length),before);
  h.admin('admin_publish_month',{monthId:'2026-09'}); assert.equal(bootstrap(h).sessions.length,3); assert.equal(parent(h).data.sessions.length,3);
  const teacher=h.context.readTable_('m_teachers')[0]; const r=h.post({action:'teacher_bootstrap',t:teacher['招待トークン']}); assert(!r.data.sessions.some(s=>s['予定ID']===id));
  assert.throws(()=>h.admin('admin_save_teacher_availability',{records:[{sessionId:id,teacherId:'T001',slot:'午前',availability:'○'}]}),/予定ID/);
});

test('管理者の先生可否代理入力APIを維持・通常2枠/本番1枠・履歴追記', () => {
  const h=fresh(); const input={sessionId:'S20260905',teacherId:'T001',slot:'午後',availability:'○'};
  h.admin('admin_save_teacher_availability',{records:[input]}); h.admin('admin_save_teacher_availability',{records:[{...input,availability:'×'}]}); assert.equal(bootstrap(h).teacherAvailability[0]['可否'],'×'); assert.equal(h.sheets.get('teacher_availability').getLastRow(),3);
  assert.throws(()=>h.admin('admin_save_teacher_availability',{records:[{...input,slot:'終日'}]}),/午前または午後/);
});

test('無効トークン/越権/他家庭への書込を拒否・例外でもLock解除', () => {
  const h=fresh(); const household=h.context.readTable_('m_households')[0];
  for(const action of ['admin_bootstrap','parent_bootstrap','admin_create_month']) { const r=h.post({action}); assert.equal(r.ok,false); assert.equal(r.data,undefined); }
  const denied=h.post({action:'admin_publish_month',k:household['招待トークン'],monthId:'2026-09'}); assert.equal(denied.error,'forbidden');
  const r=h.post({action:'save_parent_month',k:household['招待トークン'],attendance:[{memberId:'M002',sessionId:'S20260905',morning:true}]}); assert.equal(r.error,'forbidden'); assert.equal(h.locked,false);
});

test('日付/時刻セルを画面用形式に変換・数式入力を文字列として保存', () => {
  const h=fresh(); assert.equal(h.context.formatCell_(new Date('2026-09-05T00:00:00+09:00'),'日付'),'2026-09-05'); assert.equal(h.context.formatCell_(new Date('2026-09-05T09:30:00+09:00'),'集合'),'09:30');
  assert.equal(h.context.sheetLiteral_('=IMPORTXML("dummy")'),'\'=IMPORTXML("dummy")');
  const s=bootstrap(h).sessions[0]; s['備考']='=架空テキスト'; h.admin('admin_save_sessions',{records:[s]}); assert.equal(bootstrap(h).sessions[0]['備考'],'=架空テキスト');
});

test('保存後の親兄弟2名の回答集計は最新行を採用', () => {
  const h=fresh(); const household=h.context.readTable_('m_households')[0];
  const base={action:'save_parent_month',k:household['招待トークン']}; const attendance=[{memberId:'M001',sessionId:'S20260905',morning:true,afternoon:true},{memberId:'M011',sessionId:'S20260905',morning:true,afternoon:false}];
  assert(h.post({...base,attendance}).ok); assert(h.post({...base,attendance:[{...attendance[0],morning:false}]}).ok); h.admin('admin_publish_month',{monthId:'2026-09'});
  assert.equal(parent(h).data.attendanceCounts.S20260905.morning,1); assert.equal(h.sheets.get('attendance').getLastRow(),4);
});

test('公開データの読取全体が書込と同じLock内で実行される', () => {
  const h=fresh(); const original=h.context.readTable_; let calls=0;
  h.context.readTable_=function(...args) { assert.equal(h.locked,true,'テーブルの読取にLockが必要'); calls++; return original(...args); };
  bootstrap(h); assert(calls>10); assert.equal(h.locked,false);
});
