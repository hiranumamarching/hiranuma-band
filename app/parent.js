'use strict';
(() => {
  const api = BandAPI.create('k');
  const $ = id => document.getElementById(id);
  const state = { data: undefined, monthId: '', guardianId: '', tab: 'input', attendance: new Map(), offers: new Map(), busy: false, openSessions: new Set() };
  const tabs = [['input', '月間入力'], ['share', '公開予定'], ['card', '個人カード']];
  const attendanceKey = (memberId, sessionId) => `${memberId}|${sessionId}`;
  const offerKey = (guardianId, sessionId) => `${guardianId}|${sessionId}`;
  const monthKey = value => String(value || '').trim().slice(0, 7);
  const monthLabel = value => monthKey(value).replace('-', '年') + '月';
  const bool = value => value === true || value === 'true' || value === 1 || value === '1' || value === '○';
  const inputSessions = () => (state.data?.inputSessions || []).filter(s => monthKey(s['月ID']) === state.monthId).sort((a, b) => a['日付'].localeCompare(b['日付']));
  const members = () => state.data?.members || [];
  const guardians = () => state.data?.guardians || [];
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function button(label, click, selected, className) { const node = el('button', label, className); node.type = 'button'; node.addEventListener('click', click); if (selected !== undefined) node.setAttribute('aria-pressed', String(selected)); return node; }
  function pills(options, value, change, label) { const wrap = el('div', undefined, 'pills'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', label); options.forEach(([id, name]) => wrap.append(button(name, () => change(id), value === id))); return wrap; }
  function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').setAttribute('role', error ? 'alert' : 'status'); }
  function slotList(session) { return session['種別'] === '本番' ? [['am', '終日']] : [['am', '午前'], ['pm', '午後']]; }
  function isOpen(session, slot) { return session['種別'] === '本番' ? slot === 'am' : session[`実施有無_${slot}`] !== 'なし'; }
  function existingAttendance(memberId, sessionId) { return (state.data.attendance || []).find(row => row['子どもID'] === memberId && row['予定ID'] === sessionId) || {}; }
  function attendanceValue(memberId, sessionId) { return state.attendance.get(attendanceKey(memberId, sessionId)) || existingAttendance(memberId, sessionId); }
  function offerValue(guardianId, sessionId) { return state.offers.get(offerKey(guardianId, sessionId)) || (state.data.dutyOffers || []).find(row => row['保護者ID'] === guardianId && row['予定ID'] === sessionId) || {}; }
  function markAttendance(memberId, sessionId, patch) { state.attendance.set(attendanceKey(memberId, sessionId), { ...attendanceValue(memberId, sessionId), ...patch }); }
  function markOffer(guardianId, sessionId, patch) { state.offers.set(offerKey(guardianId, sessionId), { ...offerValue(guardianId, sessionId), ...patch }); }
  function inputMonths() { return (state.data?.months || []).filter(m => (state.data?.inputSessions || []).some(s => monthKey(s['月ID']) === monthKey(m['月ID']))).sort((a, b) => monthKey(a['月ID']).localeCompare(monthKey(b['月ID']))); }
  function dateLabel(value) { const date = new Date(`${value}T00:00:00+09:00`); return `${date.getMonth() + 1}月${date.getDate()}日（${['日','月','火','水','木','金','土'][date.getDay()]}）`; }
  function placeName(session) { return (state.data.places || []).find(place => place['場所ID'] === session['場所ID'])?.['名称'] || '場所未設定'; }
  function completeAttendance(memberId, session) { const row = attendanceValue(memberId, session['予定ID']); return slotList(session).filter(([slot]) => isOpen(session, slot)).every(([slot]) => typeof row[slot === 'am' ? 'morning' : 'afternoon'] === 'boolean'); }
  function allComplete() { return inputSessions().every(session => members().every(member => completeAttendance(member['子どもID'], session))) && inputSessions().every(session => typeof offerValue(state.guardianId, session['予定ID'])['available'] === 'boolean'); }
  function render() {
    $('tabs').replaceChildren(...tabs.map(([id, label]) => button(label, () => { state.tab = id; render(); }, state.tab === id)));
    const panel = $('panel'); panel.replaceChildren();
    if (state.tab === 'input') renderInput(panel); else if (state.tab === 'share') window.BandShared.render(panel, state.data, state.monthId); else renderCards(panel);
  }
  function renderInput(panel) {
    const context = el('section', undefined, 'card parent-context');
    context.append(el('p', monthLabel(state.monthId), 'eyebrow'), el('h2', `${state.data.household?.['家庭名'] || 'ご家庭'}の入力`));
    context.append(el('p', '登録済みのお子さまを同じ画面で入力できます。当番可否はご家庭で1回入力します。', 'muted')); panel.append(context);
    panel.append(pills(inputMonths().map(m => [monthKey(m['月ID']), monthLabel(m['月ID'])]), state.monthId, id => { state.monthId = id; state.openSessions.clear(); render(); }, '対象月'));
    const overview = el('section', undefined, 'card month-overview');
    for (const session of inputSessions()) {
      const answered = members().filter(member => completeAttendance(member['子どもID'], session)).length;
      const duty = typeof offerValue(state.guardianId, session['予定ID']).available === 'boolean' ? 1 : 0;
      const status = answered === members().length && duty ? '入力済み' : '未入力あり';
      const row = el('div', undefined, 'overview-row'); row.append(el('strong', dateLabel(session['日付']).replace('月', '/').replace('日（', '（')), el('span', `${members().length ? `出席 ${answered}/${members().length}人` : '子ども未登録'}`), el('span', `当番 ${duty}/1`, 'muted'), el('span', status, 'badge')); overview.append(row);
    }
    panel.append(overview, el('p', '日付を開くと、兄弟それぞれの出席と当番可否を変更できます。', 'muted'));
    if (!inputSessions().length) { panel.append(el('p', 'この月の入力対象予定はありません。', 'muted')); return; }
    inputSessions().forEach(session => panel.append(sessionEditor(session)));
    const bar = el('div', undefined, 'save-bar'); bar.append(el('p', allComplete() ? '全員分の入力がそろっています。' : '未入力の出席または当番可否があります。', allComplete() ? 'success' : 'muted'), button('この月の入力を送信する', save, undefined, 'primary')); bar.lastChild.disabled = state.busy; panel.append(bar);
  }
  function sessionEditor(session) {
    const details = document.createElement('details'); details.className = 'card'; details.open = state.openSessions.has(session['予定ID']);
    details.addEventListener('toggle', () => { if (details.open) state.openSessions.add(session['予定ID']); else state.openSessions.delete(session['予定ID']); });
    const summary = document.createElement('summary'); const head = el('span', undefined, 'session-head'); head.append(el('h2', dateLabel(session['日付'])), el('span', session['種別'], 'badge')); summary.append(head, el('span', `${placeName(session)} · ${session['集合']}集合 · ${session['開始']}–${session['終了']} · ${session['解散']}解散`, 'session-meta')); details.append(summary);
    const body = el('div', undefined, 'session-body');
    for (const member of members()) body.append(memberEditor(member, session));
    body.append(dutyEditor(session)); details.append(body); return details;
  }
  function memberEditor(member, session) {
    const wrap = el('section', undefined, 'member'); wrap.append(el('h3', member['氏名']));
    for (const [slot, label] of slotList(session)) {
      if (!isOpen(session, slot)) continue;
      const key = slot === 'am' ? 'morning' : 'afternoon'; const value = attendanceValue(member['子どもID'], session['予定ID'])[key];
      const row = el('div', undefined, 'slot-row'); row.append(el('strong', label), pills([['', '未入力'], ['yes', '出席'], ['no', '欠席']], value === true ? 'yes' : value === false ? 'no' : '', id => { markAttendance(member['子どもID'], session['予定ID'], { [key]: id === 'yes' ? true : id === 'no' ? false : undefined }); state.openSessions.add(session['予定ID']); render(); }, `${member['氏名']} ${dateLabel(session['日付'])} ${label}の出席`)); wrap.append(row);
    }
    const note = document.createElement('input'); note.type = 'text'; note.placeholder = '連絡事項（任意：遅刻・早退など）'; note.value = attendanceValue(member['子どもID'], session['予定ID'])['連絡事項'] || '';
    note.addEventListener('input', () => markAttendance(member['子どもID'], session['予定ID'], { '連絡事項': note.value })); wrap.append(note); return wrap;
  }
  function dutyEditor(session) {
    const wrap = el('section', undefined, 'duty');
    wrap.append(el('h3', '保護者当番'), el('p', '当日の担当は管理者が調整して確定します。', 'muted'));
    const value = offerValue(state.guardianId, session['予定ID']).available;
    wrap.append(pills([['', '未入力'], ['yes', '当番に入れる'], ['no', '入れない']], value === true ? 'yes' : value === false ? 'no' : '', id => { markOffer(state.guardianId, session['予定ID'], { available: id === 'yes' ? true : id === 'no' ? false : undefined }); state.openSessions.add(session['予定ID']); render(); }, `${dateLabel(session['日付'])}の当番可否`));
    const note = document.createElement('input'); note.type = 'text'; note.placeholder = '当番に関するメモ（任意）'; note.value = offerValue(state.guardianId, session['予定ID'])['メモ'] || '';
    note.addEventListener('input', () => markOffer(state.guardianId, session['予定ID'], { 'メモ': note.value })); wrap.append(note); return wrap;
  }
  function renderCards(panel) { panel.append(el('section', '本番が公開されると、保護者・お子さま別の個人カードをここで確認できます。', 'card')); }
  async function save() {
    if (state.busy) return;
    if (!allComplete()) { message('出席または当番可否が未入力の日があります。', true); return; }
    state.busy = true; render(); message('送信中です…');
    try {
      const attendance = inputSessions().flatMap(session => members().map(member => { const row = attendanceValue(member['子どもID'], session['予定ID']); return { memberId: member['子どもID'], sessionId: session['予定ID'], morning: Boolean(row.morning), afternoon: Boolean(row.afternoon), note: row['連絡事項'] || '', guardianId: state.guardianId }; }));
      const dutyOffers = inputSessions().map(session => { const row = offerValue(state.guardianId, session['予定ID']); return { guardianId: state.guardianId, sessionId: session['予定ID'], available: Boolean(row.available), note: row['メモ'] || '' }; });
      await api.request('save_parent_month', { attendance, dutyOffers }); await load(); message('この月の入力を送信しました。');
    } catch (error) { message(error.message || '送信できませんでした。', true); } finally { state.busy = false; render(); }
  }
  async function load() {
    state.data = await api.request('parent_bootstrap'); state.attendance.clear(); state.offers.clear();
    const firstMonth = inputMonths()[0]; state.monthId = state.monthId && inputMonths().some(m => monthKey(m['月ID']) === state.monthId) ? state.monthId : monthKey(firstMonth?.['月ID']);
    state.guardianId = guardians()[0]?.['保護者ID'] || '';
    $('connection').hidden = true; $('workspace').hidden = false; render();
  }
  async function connect() { try { api.configure($('api-url').value.trim()); await load(); message('接続しました。'); } catch (error) { message(error.message || '接続できませんでした。', true); } }
  $('connect').addEventListener('click', connect);
  if (!api.hasToken) message('保護者用の招待URL（parent.html?k=…）から開いてください。', true);
  else if (!api.endpoint) { $('connection').hidden = false; message('初回の接続先を設定してください。'); }
  else load().then(() => message('読み込みました。')).catch(error => message(error.message || '読み込めませんでした。', true));
})();
