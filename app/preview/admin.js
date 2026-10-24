'use strict';
(() => {
  const api = BandAPI.create('a');
  const $ = id => document.getElementById(id);
  const bool = v => v === true || v === 'true' || v === 1 || v === '1' || v === '○';
  const roles = ['当番'];
  const tabs = [['month', '日程作成'], ['plan', '予定・当番'], ['event', '本番'], ['roster', '名簿'], ['publish', '公開'], ['references', 'ガイド']];
  const utilityTabs = [];
  const dirty = { sessions: new Set(), selfPractice: new Set(), dutyAssignments: new Set(), teacherAvailability: new Set(), teachers: new Set(), events: new Set(), timelineItems: new Set(), layouts: new Set(), instruments: new Set(), guideItems: new Set(), annualEvents: new Set() };
  const familyAddDraft = {}; let familyAddOpen = false;
  const newSessionIds = new Set(), newMonthIds = new Set(), expandedSessions = new Set(), savedSessions = new Map(), savedTimelinePlaces = new Map(), placeAddDrafts = new Map();
  let sessionAddDraft = null;
  const hasPendingFamily = () => Object.values(familyAddDraft).some(value => String(value).trim());
  const timeFields = BandPracticePlan.timeKeys;
  const protectedTimes = new Map(), practiceNotices = new Map(), practiceSlotDrafts = new Map();
  const today = new Date();
  let monthId = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  let tab = 'month', rosterTab = 'families', data, busy = false, monthDirty = false, rosterDirty = false, deadlineDraft, rosterDraft = [];
  const dutyKey = r => [r['予定ID'], r['役割'], r['区分']].join('|');
  const availabilityKey = r => [r['先生ID'], r['予定ID'], r['枠']].join('|');
  const proxyEditing = new Set();
  const guideKey = r => r.id;
  const annualEventKey = r => r.id;
  const eventKey = r => r['予定ID'];
  const timelineKey = r => r['項目ID'];
  const rosterKeys = { teachers: r => r['先生ID'] };
  const monthKey = value => String(value || '').trim().slice(0, 7);
  const teacherIds = value => [...new Set(String(value || '').split(',').map(id => id.trim()).filter(Boolean))];
  const practiceTimes = session => {
    if (session['種別'] === '本番') return {};
    const am = (session['実施有無_am'] || '実施') !== 'なし', pm = (session['実施有無_pm'] || '実施') !== 'なし';
    if (am && pm) return { '集合': '09:45', '開始': '10:00', '終了': '15:00', '解散': '15:15' };
    if (am) return { '集合': '09:45', '開始': '10:00', '終了': '12:00', '解散': '12:15' };
    if (pm) return { '集合': '12:45', '開始': '13:00', '終了': '15:00', '解散': '15:15' };
    return {};
  };
  const currentMonth = () => data.months.find(m => monthKey(m['月ID']) === monthKey(monthId));
  const eventTitle = session => data.events.find(event => event['予定ID'] === session['予定ID'])?.['本番名']?.trim() || '本番名未設定';
  const sessions = () => data.sessions.filter(s => monthKey(s['月ID']) === monthKey(monthId)).sort((a, b) => a['日付'].localeCompare(b['日付']));
  const active = name => data.masters[name].filter(r => bool(r['在籍']));
  function memberGradeKey(member) {
    const value = String(member['学年'] || '').trim();
    if (!value) return [9, 99];
    if (value.includes('年長')) return [0, 0];
    const number = Number(value.match(/\d+/)?.[0] || 99);
    const level = value.includes('中') ? 2 : value.includes('高') ? 3 : 1;
    return [level, number];
  }
  const sortedMembers = () => active('members').slice().sort((a, b) => {
    const [aLevel, aGrade] = memberGradeKey(a); const [bLevel, bGrade] = memberGradeKey(b);
    return aLevel - bLevel || aGrade - bGrade || String(a['氏名'] || '').localeCompare(String(b['氏名'] || ''), 'ja');
  });
  const hasChanges = () => Boolean(sessionAddDraft) || newMonthIds.size > 0 || hasPendingFamily() || monthDirty || rosterDirty || Object.values(dirty).some(set => set.size);
  function el(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
  function button(label, click, selected, className) {
    const n = el('button', label, className); n.type = 'button'; n.addEventListener('click', click);
    if (selected !== undefined) n.setAttribute('aria-pressed', String(selected)); return n;
  }
  function field(label, value, change, type = 'text') {
    const wrap = el('label', label); const input = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.value = value || ''; input.addEventListener('input', () => change(input.value)); wrap.append(input); return wrap;
  }
  function check(label, value, change) {
    const wrap = el('label'); const input = el('input'); input.type = 'checkbox'; input.checked = bool(value);
    input.addEventListener('change', () => change(input.checked)); wrap.append(input, document.createTextNode(label)); return wrap;
  }
  function pills(options, value, change, label) {
    const wrap = el('div', undefined, 'pills'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', label);
    for (const [id, name] of options) { const choice = button(name, () => { if (change(id) === false) return; Array.from(wrap.children).forEach(node => node.setAttribute('aria-pressed', String(node === choice))); }, value === id); wrap.append(choice); } return wrap;
  }
  function picker(label, options, value, change, emptyLabel = '未設定') {
    const wrap = el('div'); wrap.append(el('h3', label));
    const list = pills([['', emptyLabel], ...options], value || '', change, label);
    if (options.length > 8) wrap.append(field(`${label}を絞り込み`, '', q => { for (const b of list.children) b.hidden = Boolean(q) && !b.textContent.includes(q) && b.textContent !== emptyLabel; }, 'search'));
    wrap.append(list); return wrap;
  }
  function guardianSelect(label, options, value, change) {
    const wrap = el('label', label), select = document.createElement('select');
    select.setAttribute('aria-label', label);
    const choices = [['', '未設定'], ...options];
    if (value && !choices.some(([id]) => id === value)) choices.push([value, '旧担当（現在の名簿外）']);
    choices.forEach(([id, name]) => { const option = el('option', name); option.value = id; select.append(option); });
    select.value = value || ''; select.addEventListener('change', () => change(select.value)); wrap.append(select); return wrap;
  }
  let messageTimer; function message(text, error = false) { clearTimeout(messageTimer); if (!error && !/中です…$/.test(text)) messageTimer = setTimeout(() => { $('message').textContent = ''; }, 4000); $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').setAttribute('role', error ? 'alert' : 'status'); }
  function confirmRemoval(name, callback) {
    const backdrop = el('div', undefined, 'confirm-backdrop'); const dialog = el('section', undefined, 'confirm-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '削除の確認');
    dialog.append(el('h2', '削除しますか？'), el('p', `「${name || 'この項目'}」を現在の名簿から外します。保存前なら再読み込みで戻せます。`));
    const cancel = button('キャンセル', () => backdrop.remove()); const remove = button('削除', () => { backdrop.remove(); callback(); }, undefined, 'danger'); dialog.append(el('div', undefined, 'row')); dialog.lastChild.append(cancel, remove); backdrop.append(dialog); backdrop.addEventListener('click', event => { if (event.target === backdrop) backdrop.remove(); }); document.body.append(backdrop); cancel.focus();
  }
  function mark(collection, key) { dirty[collection].add(key); updateSaveState(); }
  function markRoster() { rosterDirty = true; updateSaveState(); }
  function updateSaveState() {
    $('save-state').textContent = hasChanges() ? '未保存の変更あり' : data && sessions().some(s => s['確定状態'] !== '公開') ? '下書き保存済み・未公開の予定あり' : '保存済み';
    $('save').disabled = busy || !hasChanges();
    $('go-publish').hidden = tab === 'publish' || hasChanges() || !data || !sessions().some(s => s['確定状態'] !== '公開');
    document.querySelectorAll('[data-event-save]').forEach(node => { node.disabled = busy || !hasChanges(); });
    document.querySelectorAll('[data-event-save-state]').forEach(node => { node.textContent = busy ? '保存中…' : hasChanges() ? '未保存の変更あり' : '保存済み'; });
    const publish = $('publish-month'); if (publish) publish.disabled = busy || hasChanges() || !data.shared || !sessions().length || missing().length > 0;
  }
  async function run(task, success) {
    if (busy) return;
    busy = true; $('workspace').disabled = true; $('connect').disabled = true;
    message('処理中です…'); if (data) updateSaveState();
    try { await task(); if (success) message(success); }
    catch (error) {
      if (error.code === 'unauthorized' || error.code === 'forbidden') { data = undefined; $('panel').replaceChildren(); $('workspace').hidden = true; api.forget(); }
      if (data) data.shared = null; // 書き込み応答が不明な場合、古い公開スナップショットを表示しない。
      if (!data && api.hasToken) { $('connection').hidden = false; $('api-url').value = api.endpoint; }
      if (data && tab === 'publish') render();
      message(error.message || '接続に失敗しました。再読み込みして確認してください。', true);
    } finally { busy = false; $('workspace').disabled = false; $('connect').disabled = false; if (data) updateSaveState(); }
  }
  async function load() {
    const next = await api.request('admin_bootstrap'); if(next.performanceVersion !== 2) throw new Error('保存APIの更新が必要です。旧APIへの保存を停止しました。管理者に確認してください。'); data = next; rosterDraft = buildRosterDraft();
    protectedTimes.clear(); practiceNotices.clear(); practiceSlotDrafts.clear();
    newSessionIds.clear(); newMonthIds.clear(); savedSessions.clear(); sessionAddDraft = null;
    data.sessions.forEach(session => savedSessions.set(session['予定ID'], { ...session }));
    savedTimelinePlaces.clear(); data.timelineItems.forEach(item => savedTimelinePlaces.set(item['項目ID'], item['場所ID'] || '')); placeAddDrafts.clear();
    Object.keys(familyAddDraft).forEach(key => delete familyAddDraft[key]); familyAddOpen = false;
    data.sessions.forEach(session => protectedTimes.set(session['予定ID'], new Set(timeFields.filter(key => session[key] !== undefined && session[key] !== ''))));
    Object.values(dirty).forEach(set => set.clear()); monthDirty = false; rosterDirty = false; deadlineDraft = undefined;
    $('connection').hidden = true; $('workspace').hidden = false; render();
  }
  function render() {
    $('month-title').textContent = `${monthId.replace('-', '年')}月 · ${currentMonth()?.['状態'] || '未作成'}`;
    $('tabs').replaceChildren(...tabs.map(([id, label]) => {
      const b = button(label, () => { tab = id; render(); }, tab === id); b.setAttribute('aria-controls', 'panel'); return b;
    }));
    $('utility-tabs').replaceChildren(...utilityTabs.map(([id, label]) => {
      const b = button(label, () => { tab = id; render(); }, tab === id); b.setAttribute('aria-controls', 'panel'); return b;
    }));
    $('panel').replaceChildren();
    ({ month: renderMonth, plan: renderPlan, schedule: renderSchedule, duty: renderDuty, event: renderEvent, publish: renderPublish, roster: renderRoster, references: renderReferences })[tab]();
    updateSaveState();
  }
  function switchMonth(next) {
    if (next === monthId) return false;
    if (hasChanges()) { message('月を切り替える前に「変更を保存」を押してください。破棄する場合は再読み込みしてください。', true); return false; }
    monthId = next; deadlineDraft = undefined; render(); return true;
  }
  function renderMonth() {
    const panel = $('panel'); const card = el('section', undefined, 'card'); card.append(el('h2', '月間スケジュール'));
    const year = Number(monthId.slice(0, 4));
    const yearRow = el('div', undefined, 'row year-row');
    yearRow.append(button('◀', () => switchMonth(`${Math.max(2000, year - 1)}-${monthId.slice(5)}`)), el('strong', `${year}年`), button('▶', () => switchMonth(`${Math.min(2099, year + 1)}-${monthId.slice(5)}`)));
    yearRow.firstChild.setAttribute('aria-label', '前年'); yearRow.lastChild.setAttribute('aria-label', '翌年'); card.append(yearRow);
    const months = pills(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), `${i + 1}月`]), monthId.slice(5), m => switchMonth(`${year}-${m}`), '月'); months.className = 'months'; card.append(months);
    const month = currentMonth();
    if (!deadlineDraft) deadlineDraft = { parentDeadline: month?.['保護者入力締切'] || '' };
    const deadlines = el('div', undefined, 'grid');
    deadlines.append(field('保護者入力締切（任意）', deadlineDraft.parentDeadline, v => { deadlineDraft.parentDeadline = v; monthDirty = Boolean(month); updateSaveState(); }, 'date'));
    card.append(deadlines);
    if (!month) {
      let copy = true; card.append(check('前月の集合・開始・終了・解散時間を引き継ぐ', true, v => { copy = v; }));
      card.append(button('日程を追加', openSessionAdd, undefined, 'primary'));
      card.append(el('p', '日付を選んで1件ずつ追加できます。まとめて作る場合は下のボタンを使ってください。', 'muted'));
      card.append(button('土曜日の日程を作成', () => run(async () => {
        if (hasChanges()) throw new Error('ほかの未保存の変更があります。先に保存してから日程を作成してください。');
        const prior = new Date(year, Number(monthId.slice(5)) - 2, 1);
        const copyFromMonthId = copy ? `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}` : '';
        await api.request('admin_create_month', { monthId, copyFromMonthId, teacherDeadline: '', ...deadlineDraft }); tab = 'plan'; await load();
      }, '土曜日の日程を作成しました。'), undefined, 'primary'));
    } else {
            card.append(button('日程を追加', openSessionAdd, undefined, 'primary'));
      const list = el('div', undefined, 'month-session-list');
      sessions().forEach(s => {
        const row = el('div', undefined, 'month-session-row');
        const place = data.masters.places.find(p => p['場所ID'] === s['場所ID']);
        const placeLabel = s['種別'] === '通常練習' ? practicePlaceSummary(s) : place?.['名称'] || '場所未設定';
        const summary = el('div', undefined, 'month-session-summary');
        summary.append(el('strong', `${s['日付']}　${s['種別'] === '本番' ? eventTitle(s) + '（本番）' : s['種別']}`), el('span', `${placeLabel}　集合 ${s['集合'] || '未定'} → 解散 ${s['解散'] || '未定'}`, 'muted'));
        row.append(summary);
        const actions = el('div', undefined, 'session-actions');
        actions.append(button('編集', () => editSession(s)), sessionRemoveButton(s)); row.append(actions);
        list.append(row);
      });
      card.append(el('h3', `候補日一覧（${sessions().length}件）`), list);
    }
    panel.append(card);
  }
  function requireMonth() {
    if (currentMonth()) return true;
    $('panel').append(el('p', '「日程作成」で対象月を作成してください。')); return false;
  }
  function editSession(s) {
    expandedSessions.add(s['予定ID']); tab = 'plan'; render();
    document.getElementById(s['予定ID'])?.scrollIntoView({ block: 'start' });
  }
  function openEventSchedule(s) {
    if (!data.sessions.some(session => session['予定ID'] === s['予定ID'] && session['種別'] === '本番' && monthKey(session['月ID']) === monthKey(monthId))) { message('この月の本番予定を選んでください。', true); return; }
    selectedEvents.set(monthId, s['予定ID']); eventViews.set(s['予定ID'], 'day'); tab = 'event'; render();
    document.getElementById(`event-day-${s['予定ID']}`)?.scrollIntoView({ block: 'start' });
  }
  function openSessionAdd() {
    if (sessionAddDraft || document.querySelector('.session-add-dialog')) return;
    const draft = { date: '', type: '通常練習', mode: 'all' }; sessionAddDraft = draft; updateSaveState();
    const dialog = el('dialog', undefined, 'session-add-dialog'); dialog.setAttribute('aria-label', '日程を追加');
    dialog.append(el('h2', '日程を追加'), el('p', `${monthId.replace('-', '年')}月の日付を選んでください。追加後は未保存の下書きになります。`, 'muted'));
    const dateField = field('日付（必須）', '', value => { draft.date = value; error.textContent = ''; }, 'date');
    const dateInput = dateField.lastChild; dateInput.min = `${monthId}-01`;
    dateInput.max = `${monthId}-${new Date(Number(monthId.slice(0, 4)), Number(monthId.slice(5)), 0).getDate()}`; dateInput.required = true;
    dialog.append(dateField, el('h3', '予定の種別'));
    const modeSection = el('section', undefined, 'session-add-mode'), preview = el('p', undefined, 'muted');
    const updatePreview = () => { modeSection.hidden = draft.type === '本番'; const times = BandPracticePlan.defaults(draft.mode); preview.textContent = draft.type === '本番' ? '時刻は未定で追加します。「本番日の流れ」で集合・解散と当日の予定を入力できます。' : draft.mode === 'off' ? '休みとして追加します。再開時のために標準時刻を保持します。' : `標準：${times['集合']}集合 → ${times['開始']}開始 → ${times['終了']}終了 → ${times['解散']}解散（追加後に変更できます）`; };
    dialog.append(pills(['通常練習', '自主練', '本番', 'その他'].map(value => [value, value]), draft.type, value => { draft.type = value; updatePreview(); }, '追加する予定の種別'));
    modeSection.append(el('h3', '練習する時間帯'), pills([['am', '午前のみ'], ['pm', '午後のみ'], ['all', '1日'], ['off', '休み']], draft.mode, value => { draft.mode = value; updatePreview(); }, '追加する練習の時間帯')); dialog.append(modeSection, preview); updatePreview();
    const error = el('p', '', 'error'); error.setAttribute('role', 'alert'); dialog.append(error);
    let committed = false;
    const add = button('追加する', () => {
      if (committed || sessionAddDraft !== draft) return;
      const parts = draft.date.split('-').map(Number), parsed = new Date(parts[0], parts[1] - 1, parts[2]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || monthKey(draft.date) !== monthId || parsed.getFullYear() !== parts[0] || parsed.getMonth() + 1 !== parts[1] || parsed.getDate() !== parts[2]) { error.textContent = `${monthId}内の日付を選んでください。`; dateInput.focus(); return; }
      const candidates = data.masters.places.filter(placeIsActive);
      const defaultPlace = draft.type === '通常練習' ? candidates.find(place => place['名称'] === '平沼小音楽室') : undefined;
      const collectionPlace = draft.type === '通常練習' ? candidates.find(place => place['名称'] === '平沼小川側の門') : undefined;
      const session = { ...BandPracticePlan.defaults('all'), '予定ID': `S${crypto.randomUUID()}`, '月ID': monthId, '日付': draft.date, '種別': draft.type, '実施有無_am': '実施', staffing_am: '未定', '担当先生ID_am': '', '実施有無_pm': 'なし', staffing_pm: '', '担当先生ID_pm': '', '場所ID': draft.type === '通常練習' ? defaultPlace?.['場所ID'] || '' : candidates[0]?.['場所ID'] || '', '集合場所ID': collectionPlace?.['場所ID'] || '', '確定状態': '下書き', '備考': '' };
      if (draft.type !== '本番') {
        BandPracticePlan.apply(session, draft.mode);
        for (const slot of ['am', 'pm']) session[`staffing_${slot}`] = session[`実施有無_${slot}`] === 'なし' ? '' : draft.type === '自主練' ? '自主練' : '未定';
      } else timeFields.forEach(key => { session[key] = ''; });
      if (!currentMonth()) { data.months.push({ '月ID': monthId, '状態': '下書き', '先生入力締切': '', '保護者入力締切': deadlineDraft?.parentDeadline || '' }); newMonthIds.add(monthId); }
      committed = true; sessionAddDraft = null; dialog.close();
      data.sessions.push(session); newSessionIds.add(session['予定ID']); mark('sessions', session['予定ID']); editSession(session);
      message(`${session['日付']}を追加しました。まだ未保存です。「下書きを保存」で保存できます。`);
    }, undefined, 'primary');
    const cancel = button('キャンセル', () => dialog.close()); const actions = el('div', undefined, 'session-actions'); actions.append(cancel, add); dialog.append(actions);
    dialog.addEventListener('close', () => { if (sessionAddDraft === draft) sessionAddDraft = null; dialog.remove(); updateSaveState(); }, { once: true });
    document.body.append(dialog); dialog.showModal(); cancel.focus();
  }
  function discardSessionDraft(sessionId) {
    const keys = { sessions: row => row['予定ID'], selfPractice: row => row['予定ID'], dutyAssignments: dutyKey, teacherAvailability: availabilityKey, events: eventKey, timelineItems: timelineKey, layouts: row => row.id };
    for (const [collection, key] of Object.entries(keys)) {
      data[collection] = (data[collection] || []).filter(row => { if ((row['予定ID'] || row.sessionId) !== sessionId) return true; dirty[collection].delete(key(row)); return false; });
    }
    dirty.sessions.delete(sessionId); newSessionIds.delete(sessionId); savedSessions.delete(sessionId); expandedSessions.delete(sessionId); proxyEditing.delete(sessionId); protectedTimes.delete(sessionId); practiceNotices.delete(sessionId);
    for (const slot of ['am', 'pm']) practiceSlotDrafts.delete(`${sessionId}-${slot}`);
    for (const collection of ['attendance', 'dutyOffers']) data[collection] = (data[collection] || []).filter(row => row['予定ID'] !== sessionId);
    if (data.shared) {
      for (const collection of ['sessions', 'selfPractice', 'dutyAssignments', 'events', 'timelineItems', 'layouts']) if (Array.isArray(data.shared[collection])) data.shared[collection] = data.shared[collection].filter(row => (row['予定ID'] || row.sessionId) !== sessionId);
      if (data.shared.attendanceCounts) delete data.shared.attendanceCounts[sessionId];
    }
    if (newMonthIds.has(monthId) && !sessions().length) { newMonthIds.delete(monthId); data.months = data.months.filter(month => monthKey(month['月ID']) !== monthId); monthDirty = false; }
  }
  function sessionRemoveButton(s) {
    const fresh = newSessionIds.has(s['予定ID']);
    return button(fresh ? '追加を取り消す' : '削除', () => {
      const fresh = newSessionIds.has(s['予定ID']);
      if (busy || !data.sessions.some(row => row['予定ID'] === s['予定ID'])) return;
      const saved = savedSessions.get(s['予定ID']), original = saved && saved['日付'] !== s['日付'] ? `（保存済みの日付：${saved['日付']}）` : '';
      const target = `${s['日付']}・${s['種別']} ${s['開始'] || ''}${s['終了'] ? `–${s['終了']}` : ''}${original}`;
      const question = fresh ? `${target}の追加を取り消しますか？この日程の未保存入力だけを破棄します。他の変更は残ります。` : `${target}を削除しますか？この日程と関連する未保存入力を削除し、保存済みの日程は共有画面からもすぐに消えます。履歴は残ります。他の未保存の変更は残ります。`;
      if (!confirm(question)) return;
      if (fresh) { discardSessionDraft(s['予定ID']); render(); message('この日程の追加を取り消しました。他の変更は残っています。'); return; }
      return run(async () => { await api.request('admin_delete_session', { sessionId: s['予定ID'] }); discardSessionDraft(s['予定ID']); render(); }, `${s['日付']}を削除して保存しました。他の未保存の変更は残っています。`);
    }, undefined, 'danger');
  }
  function renderPlan() {
    const panel = $('panel');
    const toolbar = el('div', undefined, 'schedule-toolbar'); toolbar.append(button('日程を追加', openSessionAdd, undefined, 'primary'), el('p', '追加・編集は「下書きを保存」で保存します。保存済みの日程の削除は、確認後すぐに反映されます。', 'muted')); panel.append(toolbar);
    if (!sessions().length) panel.append(el('p', 'この月の日程はまだありません。「日程を追加」から作成できます。', 'card'));
    for (const s of sessions()) panel.append(planCard(s));
  }
  function planCard(s) {
    const card = el('article', undefined, 'card plan-card'); card.id = `plan-${s['予定ID']}`;
    const place = data.masters.places.find(p => p['場所ID'] === s['場所ID']);
    const head = el('div', undefined, 'session-head'); head.append(el('h2', s['種別'] === '本番' ? eventTitle(s) : s['日付'], s['種別'] === '本番' ? 'event-title' : ''), el('span', s['種別'], 'badge'));
    const actions = el('div', undefined, 'session-actions'); actions.append(button('編集', () => editSession(s)), sessionRemoveButton(s)); head.append(actions); card.append(head);
    if (s['種別'] === '本番') card.append(el('p', s['日付'], 'eyebrow'), button('本番日の流れを編集', () => openEventSchedule(s), undefined, 'primary'));
    if (newSessionIds.has(s['予定ID'])) card.append(el('p', '追加した日程・未保存', 'session-draft-state'));
    card.append(el('p', `${s['種別'] === '通常練習' ? practicePlaceSummary(s) : place?.['名称'] || '場所未設定'}・集合 ${s['集合'] || '未定'}・${s['開始'] || '未定'}–${s['終了'] || '未定'}・解散 ${s['解散'] || '未定'}`, 'session-meta'));
    if (s['種別'] === '本番') BandShared.renderDaySchedule(card, s, data.timelineItems, data.masters.places);
    const attendance = data.attendance.filter(a => a['予定ID'] === s['予定ID']);
    const counts = s['種別'] === '本番' ? `終日${attendance.filter(a => bool(a['午前'])).length}名` : `午前${attendance.filter(a => bool(a['午前'])).length}名 ／ 午後${attendance.filter(a => bool(a['午後'])).length}名`;
    card.append(el('p', `出席予定：${counts}　　当番候補：${active('guardians').filter(g => data.dutyOffers.some(d => d['予定ID'] === s['予定ID'] && d['保護者ID'] === g['保護者ID'] && bool(d['可否']))).length}名`, 'attendance-summary'));
    card.append(memberDetails(s, attendance));
    const overview = el('div', undefined, 'plan-overview');
    const undecided = slots(s).every(([slot, label]) => ['担当未定', '未定'].includes(teacherSummary(s, slot)) && dutySummary(s, label) === '未設定');
    if (undecided) { card.append(el('p', '先生・当番：未定', 'plan-undecided')); }
    else {
    for (const [slot, label] of slots(s)) {
      const cell = el('section', undefined, 'plan-overview-cell'); cell.append(el('h3', label));
      const teacher = el('p'); teacher.append(el('span', '先生', 'overview-label'), document.createElement('br'), document.createTextNode(teacherSummary(s, slot)));
      const duty = el('p'); duty.append(el('span', '当番', 'overview-label'), document.createElement('br'), document.createTextNode(dutySummary(s, label)));
      cell.append(teacher, duty);
      overview.append(cell);
    }
    card.append(overview);
    }
    const details = document.createElement('details'); details.className = 'plan-details'; details.open = expandedSessions.has(s['予定ID']); details.addEventListener('toggle', () => { if (details.open) expandedSessions.add(s['予定ID']); else expandedSessions.delete(s['予定ID']); }); const summary = document.createElement('summary'); summary.textContent = '詳細・修正'; details.append(summary);
    const edit = document.createElement('div'); edit.append(sessionCard(s));
    const duty = document.createElement('section'); duty.append(el('h3', '出席集計・当番')); const holder = document.createElement('div'); holder.append(dutyCard(s)); duty.append(holder); edit.append(duty);
    details.append(edit); card.append(details); return card;
  }
  function memberDetails(s, attendance) {
    const details = document.createElement('details'); details.className = 'member-details';
    details.append(Object.assign(document.createElement('summary'), { textContent: '参加メンバーを表示（全員）' }));
    const table = el('table'); const head = el('tr'); (s['種別'] === '本番' ? ['子ども', '終日'] : ['子ども', '午前', '午後']).forEach(label => head.append(el('th', label))); const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    sortedMembers().forEach(member => {
      const row = attendance.find(a => a['子どもID'] === member['子どもID']) || {};
      const tr = el('tr'); tr.append(el('td', member['氏名']), memberStatus(row['午前'])); if (s['種別'] !== '本番') tr.append(memberStatus(row['午後'])); body.append(tr);
    });
    table.append(body); details.append(table); return details;
  }
  function memberStatus(value) {
    const cell = el('td');
    if (bool(value)) { cell.textContent = '○ 参加'; cell.className = 'status-ok'; }
    else if (value === false || value === 'false' || value === '×') { cell.textContent = '× 不参加'; cell.className = 'status-no'; }
    else { cell.textContent = '未入力'; cell.className = 'status-blank'; }
    return cell;
  }
  function teacherSummary(s, slot) {
    if ((s[`実施有無_${slot}`] || '実施') === 'なし') return '練習なし';
    if (s['種別'] === '本番' && s.staffing_am !== '先生あり') return '先生参加：未定／不在';
    const staffing = s[`staffing_${slot}`] || '先生あり'; if (staffing !== '先生あり') return staffing;
    const names = teacherIds(s[`担当先生ID_${slot}`]).map(id => data.masters.teachers.find(t => t['先生ID'] === id)?.['氏名']).filter(Boolean);
    return names.join('、') || '担当未定';
  }
  function dutySummary(s, label) {
    const valid = new Set(active('guardians').map(g => g['保護者ID']));
    const names = data.dutyAssignments.filter(d => {
      if (d['予定ID'] !== s['予定ID'] || !d['保護者ID'] || !valid.has(d['保護者ID'])) return false;
      if (s['種別'] === '本番') return true;
      const division = String(d['区分'] || ''); return division.startsWith(`${label}-`) || (!division.startsWith('午前-') && !division.startsWith('午後-') && label === '午前');
    }).map(d => data.masters.guardians.find(g => g['保護者ID'] === d['保護者ID'])?.['表示名']).filter(Boolean);
    return names.join('、') || '未設定';
  }
  function slots(s) { return s['種別'] === '本番' ? [['am', '終日']] : [['am', '午前'], ['pm', '午後']]; }
  function renderSchedule() { renderPlan(); }
  const placeIsActive = place => place['有効'] === undefined || place['有効'] === '' || bool(place['有効']);
  const placeName = id => data.masters.places.find(place => place['場所ID'] === id)?.['名称'] || '未設定';
  const practicePlaceSummary = s => `集合場所：${placeName(s['集合場所ID'])} ／ 練習場所：${placeName(s['場所ID'])}`;
  function placeOptions(currentId) {
    return data.masters.places.filter(place => placeIsActive(place) || place['場所ID'] === currentId)
      .slice().sort((a, b) => (Number(a['並び順']) || 0) - (Number(b['並び順']) || 0))
      .map(place => [place['場所ID'], `${place['名称']}${placeIsActive(place) ? '' : '（候補から非表示）'}`]);
  }
  function rememberPlace(place) {
    const index = data.masters.places.findIndex(item => item['場所ID'] === place['場所ID']);
    if (index < 0) data.masters.places.push(place); else data.masters.places[index] = place;
  }
  function hasUnsavedPlaceSelection(placeId) {
    return data.sessions.some(session => ['場所ID', '集合場所ID'].some(key => session[key] === placeId && savedSessions.get(session['予定ID'])?.[key] !== placeId)) ||
      data.timelineItems.some(item => item['有効'] !== false && item['場所ID'] === placeId && savedTimelinePlaces.get(item['項目ID']) !== placeId);
  }
  function openPlaceManager() {
    if (document.querySelector('.place-management-dialog')) return;
    const dialog = el('dialog', undefined, 'place-management-dialog'); dialog.setAttribute('aria-label', '場所の候補を管理');
    dialog.append(el('h2', '場所の候補を管理'), el('p', '不要な場所を候補から外せます。登録済みの日程や当日の流れに使われている名前は残り、いつでも候補に戻せます。', 'muted'), el('p', 'ここでの操作はすぐ保存されます。日程の未保存の変更はそのまま残ります。', 'muted'));
    const list = el('div'), status = el('p', '', 'muted'); status.setAttribute('role', 'status');
    let pending = false, closed = false;
    const close = button('閉じる', () => { if (!pending) dialog.close(); });
    const draw = () => {
      if (!data) return;
      list.replaceChildren();
      for (const visible of [true, false]) {
        const section = el('section', undefined, visible ? 'place-manager-active' : 'place-manager-hidden'); section.append(el('h3', visible ? '表示中の候補' : '非表示の候補'));
        const places = data.masters.places.filter(place => placeIsActive(place) === visible);
        if (!places.length) section.append(el('p', visible ? '表示中の候補はありません。下から戻すか、場所を追加してください。' : '非表示の候補はありません。', 'muted'));
        for (const place of places) {
          const row = el('div', undefined, 'place-manager-row'); row.dataset.placeId = place['場所ID']; row.append(el('span', place['名称']));
          const action = button(visible ? '候補から外す' : '候補に戻す', async () => {
            if (pending || busy || closed || !dialog.open) return;
            if (placeIsActive(data.masters.places.find(item => item['場所ID'] === place['場所ID']) || {}) !== visible) { draw(); return; }
            if (visible && hasUnsavedPlaceSelection(place['場所ID'])) { status.className = 'error'; status.textContent = 'この場所を選んだ未保存の日程・流れがあります。先に保存するか、別の場所へ変更してください。'; return; }
            pending = true; status.className = 'muted'; status.textContent = '保存中…'; draw();
            await run(async () => {
              try {
                const result = await api.request('admin_set_place_visibility', { placeId: place['場所ID'], visible: !visible });
                rememberPlace(result.place); render(); status.className = 'success'; status.textContent = `「${place['名称']}」を${visible ? '候補から外しました。下の一覧から戻せます。' : '候補に戻しました。'}`;
              } catch (error) { status.className = 'error'; status.textContent = error.message || '保存できませんでした。もう一度お試しください。'; throw error; }
            });
            pending = false; close.disabled = false; if (!closed) draw();
          });
          action.disabled = pending; row.append(action); section.append(row);
        }
        list.append(section);
      }
      close.disabled = pending;
    };
    dialog.append(status, list, close);
    dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
    dialog.addEventListener('close', () => { closed = true; dialog.remove(); });
    document.body.append(dialog); draw(); dialog.showModal(); close.focus();
  }
  function placePicker(s, redraw, key = '場所ID', heading = s['種別'] === '本番' ? '集合場所' : s['種別'] === '通常練習' ? '練習場所' : '場所') {
    const wrap = el('section', undefined, 'place-choice'); wrap.dataset.placeKey = key;
    wrap.append(el('h3', heading));
    const options = placeOptions(s[key]);
    if (key === '集合場所ID') options.unshift(['', '未設定']);
    wrap.append(pills(options, s[key] || '', value => {
      if ((s[key] || '') === value) return false;
      s[key] = value; mark('sessions', s['予定ID']); redraw();
    }, heading));
    if (!options.length) wrap.append(el('p', '表示中の候補がありません。場所を追加するか、候補の管理から戻してください。', 'muted'));
    if (s[key] && !placeIsActive(data.masters.places.find(place => place['場所ID'] === s[key]) || {})) wrap.append(el('p', 'この場所は候補から非表示です。登録済みの選択はそのまま保存できます。', 'muted'));
    const draftKey = `${s['予定ID']}|${key}`;
    const input = document.createElement('input'); input.type = 'text'; input.placeholder = '追加する場所'; input.maxLength = 80; input.value = placeAddDrafts.get(draftKey) || '';
    input.addEventListener('input', () => placeAddDrafts.set(draftKey, input.value));
    const add = button('＋他の場所を追加', () => run(async () => {
      const result = await api.request('admin_save_place', { name: input.value });
      rememberPlace(result.place); s[key] = result.place['場所ID']; placeAddDrafts.delete(draftKey); mark('sessions', s['予定ID']); render();
    }, '場所を追加しました。'));
    const row = el('div', undefined, 'row'); row.append(input, add); wrap.append(row, button('場所の候補を管理', openPlaceManager));
    return wrap;
  }
  function sessionCard(s) {
    const card = el('article', undefined, 'card'); card.id = s['予定ID'];
    const set = (key, value, redraw = false) => { s[key] = value; mark('sessions', s['予定ID']); if (redraw) card.replaceWith(sessionCard(s)); };
    const head = el('div', undefined, 'row'); head.append(el('h2', s['種別'] === '本番' ? eventTitle(s) : s['日付'], s['種別'] === '本番' ? 'event-title' : ''), el('span', dirty.sessions.has(s['予定ID']) ? '編集中' : s['確定状態'], 'badge'));
    head.append(sessionRemoveButton(s)); card.append(head);
    card.append(field('日付', s['日付'], v => set('日付', v), 'date'));
    if (s['種別'] === '本番') card.append(button('本番日の流れを編集', () => openEventSchedule(s), undefined, 'primary'), el('p', '集合・解散は「当日の流れ」と共通です。本番名や細かな予定はそこで編集できます。', 'muted'));
    card.append(pills(['通常練習', '自主練', '本番', 'その他'].map(v => [v, v]), s['種別'], v => {
      s['種別'] = v;
      if (v === '本番') { s.staffing_pm = ''; s['担当先生ID_pm'] = ''; }
      else if (!s.staffing_pm) s.staffing_pm = '未定';
      if (v === '自主練') for (const slot of ['am', 'pm']) { s[`staffing_${slot}`] = s[`実施有無_${slot}`] === 'なし' ? '' : '自主練'; s[`担当先生ID_${slot}`] = ''; }
      set('種別', v, true);
    }, '予定の種別'));
    const sessionId = s['予定ID'];
    const protectedSet = protectedTimes.get(sessionId) || new Set(); protectedTimes.set(sessionId, protectedSet);
    if (s['種別'] !== '本番') {
      const pattern = el('section', undefined, 'practice-pattern'); pattern.append(el('h3', '練習する時間帯'));
      pattern.append(pills([['am', '午前のみ'], ['pm', '午後のみ'], ['all', '1日'], ['off', '休み']], BandPracticePlan.mode(s), value => {
        if (value === BandPracticePlan.mode(s)) return;
        const previous = { am: s['実施有無_am'] !== 'なし', pm: s['実施有無_pm'] !== 'なし' };
        BandPracticePlan.apply(s, value, protectedSet);
        for (const slot of ['am', 'pm']) {
          const key = sessionId + '-' + slot, enabled = s[`実施有無_${slot}`] !== 'なし';
          if (!enabled && previous[slot]) { practiceSlotDrafts.set(key, { staffing: s[`staffing_${slot}`], teachers: s[`担当先生ID_${slot}`] }); s[`staffing_${slot}`] = ''; s[`担当先生ID_${slot}`] = ''; }
          else if (enabled && !previous[slot]) { const draft = practiceSlotDrafts.get(key); s[`staffing_${slot}`] = s['種別'] === '自主練' ? '自主練' : draft?.staffing || '未定'; s[`担当先生ID_${slot}`] = s['種別'] === '自主練' ? '' : draft?.teachers || ''; }
        }
        practiceNotices.set(sessionId, value === 'off' ? '休みにしました。入力済みの時刻は、練習を再開するときのために保持しています。' : protectedSet.size ? '入力済みの時刻は保持しました。必要なら調整するか「標準時刻を使う」を選んでください。' : '選んだ時間帯の標準時刻を入れました。必要なら調整できます。');
        mark('sessions', sessionId); card.replaceWith(sessionCard(s));
      }, '練習する時間帯'));
      if (practiceNotices.has(sessionId)) { const notice = el('p', practiceNotices.get(sessionId), 'muted'); notice.setAttribute('role', 'status'); pattern.append(notice); }
      card.append(pattern);
    }
    const timesSection = el('section', undefined, 'session-times'); timesSection.append(el('h3', s['種別'] !== '本番' && BandPracticePlan.mode(s) === 'off' ? '再開時のために保持する時刻' : '時刻を確認・調整'));
    const times = el('div', undefined, 'grid'); for (const key of timeFields) times.append(field(key, s[key], v => { protectedSet.add(key); set(key, v); }, 'time')); timesSection.append(times); if (s['種別'] === '本番') timesSection.append(el('p', '空欄は時間未定として保存します。', 'muted'), button('時刻を未定にする', () => { timeFields.forEach(key => set(key, '')); card.replaceWith(sessionCard(s)); }));
    if (s['種別'] !== '本番' && BandPracticePlan.mode(s) !== 'off') {
      const standard = BandPracticePlan.defaults(BandPracticePlan.mode(s));
      timesSection.append(el('p', `標準：${standard['集合']}集合 → ${standard['開始']}開始 → ${standard['終了']}終了 → ${standard['解散']}解散`, 'muted'), button('標準時刻を使う', () => {
        if (timeFields.some(key => s[key] && s[key] !== standard[key]) && !confirm('入力済みの時刻を、この時間帯の標準時刻に置き換えますか？')) return;
        Object.assign(s, standard); protectedSet.clear(); practiceNotices.set(sessionId, '標準時刻を入れました。必要なら調整できます。'); mark('sessions', sessionId); card.replaceWith(sessionCard(s));
      }));
    }
    card.append(timesSection);
    if (s['種別'] === '通常練習') card.append(placePicker(s, () => card.replaceWith(sessionCard(s)), '集合場所ID', '集合場所'));
    card.append(placePicker(s, () => card.replaceWith(sessionCard(s))));
    card.append(availabilityTable(s, () => card.replaceWith(sessionCard(s))));
    for (const [slot, label] of slots(s)) {
      if (s['種別'] !== '本番' && s[`実施有無_${slot}`] === 'なし') continue;
      const block = el('section', undefined, 'slot');
      if (s['種別'] === '本番') {
        block.append(el('h3', '本番の状態'), el('p', s['実施有無_am'] === 'なし' ? '中止' : '実施予定'));
        block.append(button(s['実施有無_am'] === 'なし' ? '実施予定に戻す' : '中止に変更', () => {
          if (!confirm(s['実施有無_am'] === 'なし' ? '実施予定に戻しますか？' : 'この本番を中止に変更しますか？')) return;
          s['実施有無_am'] = s['実施有無_am'] === 'なし' ? '実施' : 'なし'; mark('sessions', sessionId); card.replaceWith(sessionCard(s));
        }));
        const supplement = el('details'); supplement.append(el('summary', '先生の参加（補足）'));
        supplement.append(pills([['未定', '参加未定／不在'], ['先生あり', '参加あり']], s.staffing_am === '先生あり' ? '先生あり' : '未定', value => { s.staffing_am = value; if(value !== '先生あり') s['担当先生ID_am'] = ''; mark('sessions',sessionId); card.replaceWith(sessionCard(s)); }, '本番の先生参加'));
        if (s.staffing_am === '先生あり') supplement.append(teacherPicker(s, slot, label, () => card.replaceWith(sessionCard(s))));
        block.append(supplement); card.append(block); continue;
      }
      block.append(el('h3', `${label}の練習`));
      if ((s[`実施有無_${slot}`] || '実施') === 'なし') { block.append(el('p', 'この枠は練習を実施しません。先生・保護者の入力対象外です。', 'muted')); card.append(block); continue; }
      if (s['種別'] === '自主練') { block.append(el('p', '自主練（先生の担当は設定しません）', 'muted')); card.append(block); continue; }
      block.append(el('p', '指導体制', 'muted'));
      block.append(pills(['先生あり', '自主練', '未定'].map(v => [v, v]), s[`staffing_${slot}`] || '先生あり', v => {
        s[`staffing_${slot}`] = v; if (v !== '先生あり') s[`担当先生ID_${slot}`] = ''; mark('sessions', s['予定ID']); card.replaceWith(sessionCard(s));
      }, `${label}の指導体制`));
      if (s[`staffing_${slot}`] === '先生あり') block.append(teacherPicker(s, slot, label, () => card.replaceWith(sessionCard(s))));
      card.append(block);
    }
    card.append(field('共有する備考', s['備考'], v => set('備考', v), 'textarea'));
    if (isSelfPractice(s)) card.append(selfPracticeForm(s));
    return card;
  }
  function teacherPicker(s, slot, label, redraw) {
    const fieldName = `担当先生ID_${slot}`;
    const selected = teacherIds(s[fieldName]);
    const eligibleIds = new Set(data.teacherAvailability
      .filter(r => r['予定ID'] === s['予定ID'] && r['枠'] === label && r['可否'] === '○')
      .map(r => r['先生ID']));
    const teachers = active('teachers').filter(t => eligibleIds.has(t['先生ID']) || selected.includes(t['先生ID']));
    const wrap = el('div'); wrap.append(el('h3', `担当先生（${label}・○の先生から1名または2名）`));
    if (!teachers.length) { wrap.append(el('p', '○の先生がまだいません。上の可否を入力すると選べます。', 'muted')); return wrap; }
    const choices = el('div', undefined, 'pills'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', `${label}の担当先生`);
    for (const teacher of teachers) {
      const id = teacher['先生ID']; const isSelected = selected.includes(id); const eligible = eligibleIds.has(id);
      const labelText = eligible ? teacher['氏名'] : `${teacher['氏名']}（要確認）`;
      choices.append(button(labelText, () => {
        const next = teacherIds(s[fieldName]); const index = next.indexOf(id);
        if (index >= 0) next.splice(index, 1);
        else {
          if (!eligible) { message('担当には○の先生だけを選べます。', true); return; }
          if (next.length >= 2) { message('担当先生は各枠2名まで選べます。', true); return; }
          next.push(id);
        }
        s[fieldName] = next.join(','); mark('sessions', s['予定ID']); redraw();
      }, isSelected));
    }
    wrap.append(choices, el('p', selected.length ? `${selected.length}名を選択中です。` : '担当先生を1名または2名選んでください。', selected.length ? 'muted' : 'warning'));
    return wrap;
  }
  function availabilityTable(s, redraw) {
    const wrap = el('div', undefined, 'table-wrap'); const table = el('table', undefined, 'availability');
    const editing = proxyEditing.has(s['予定ID']);
    const caption = el('caption', '先生の可否');
    caption.append(button(editing ? '完了' : '代理入力', () => {
      if (editing) proxyEditing.delete(s['予定ID']);
      else proxyEditing.add(s['予定ID']);
      redraw();
    }));
    table.append(caption);
    const availableSlots = slots(s).filter(([slot]) => (s[`実施有無_${slot}`] || '実施') !== 'なし');
    if (!availableSlots.length) return el('p', '実施する枠がないため、先生の可否はありません。', 'muted');
    const head = el('tr'); head.append(el('th', '先生')); availableSlots.forEach(([, label]) => head.append(el('th', label))); const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    for (const teacher of active('teachers')) {
      const tr = el('tr'); tr.append(el('th', teacher['氏名']));
      for (const [, label] of availableSlots) {
        let row = data.teacherAvailability.find(r => r['予定ID'] === s['予定ID'] && r['先生ID'] === teacher['先生ID'] && r['枠'] === label);
        const td = el('td');
        if (!editing) { td.append(el('span', row?.['可否'] || '未入力')); tr.append(td); continue; }
        const b = button(row?.['可否'] || '未入力', () => {
          const options = ['', '○', '×']; const value = options[(options.indexOf(row?.['可否'] || '') + 1) % options.length];
          if (!row) { row = { '予定ID': s['予定ID'], '先生ID': teacher['先生ID'], '枠': label }; data.teacherAvailability.push(row); }
          row['可否'] = value; mark('teacherAvailability', availabilityKey(row)); redraw();
        }); b.setAttribute('aria-label', `${teacher['氏名']}・${label}：${row?.['可否'] || '未入力'}（押して変更）`); td.append(b); tr.append(td);
      }
      body.append(tr);
    }
    table.append(body); wrap.append(table); return wrap;
  }
  function isSelfPractice(s) { return s['種別'] !== '本番' && (s.staffing_am === '自主練' || s.staffing_pm === '自主練'); }
  function missingFor(s) {
    const conflicts = slots(s).filter(([slot]) => s['種別'] !== '本番' && s[`実施有無_${slot}`] !== 'なし' && s[`staffing_${slot}`] === '先生あり').flatMap(([slot, label]) => teacherIds(s[`担当先生ID_${slot}`]).filter(id => !data.teacherAvailability.some(row => row['先生ID'] === id && row['予定ID'] === s['予定ID'] && row['枠'] === label && row['可否'] === '○')).map(id => `${label}の担当先生：${data.masters.teachers.find(t => t['先生ID'] === id)?.['氏名'] || id}の可否が○ではありません`));
    if (!isSelfPractice(s)) return [];
    const checklist = data.selfPractice.find(r => r['予定ID'] === s['予定ID']) || {};
    const valid = new Set(active('guardians').map(g => g['保護者ID'])); const missing = [];
    const duties = new Set(data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID'] && valid.has(d['保護者ID'])).map(d => d['保護者ID']));
    if (duties.size < 2) missing.push('当番2名以上');
    if (!String(checklist['緊急連絡先'] || '').trim()) missing.push('緊急連絡先'); return missing;
  }
  function missing() { return sessions().flatMap(s => missingFor(s).map(key => `${s['日付']}：${key}`)); }
  function selfPracticeForm(s) {
    let row = data.selfPractice.find(r => r['予定ID'] === s['予定ID']);
    if (!row) { row = { '予定ID': s['予定ID'] }; data.selfPractice.push(row); }
    const wrap = el('section', undefined, 'slot'); wrap.append(el('h3', '自主練チェックリスト（日単位）'));
    const status = el('p', undefined, 'status-line');
    const refresh = () => { const items = missingFor(s); status.textContent = items.length ? `未設定：${items.join('、')}` : '公開に必要な条件を満たしています。'; status.className = items.length ? 'warning' : 'success'; updateSaveState(); };
    const set = (key, value) => { row[key] = value; mark('selfPractice', s['予定ID']); refresh(); };
    wrap.append(el('p', '鍵は通常当番が担当します。別の人の場合は備考に記入してください。', 'muted'));
    wrap.append(field('緊急連絡先（管理者のみ表示）', row['緊急連絡先'], v => set('緊急連絡先', v)), check('施設使用申請済（確認用・公開の必須条件には含めない）', row['施設使用申請済'], v => set('施設使用申請済', v)), field('実施報告（管理者のみ表示）', row['実施報告'], v => set('実施報告', v), 'textarea'), status);
    wrap.append(button('当番を割り当てる', () => { tab = 'plan'; render(); })); refresh(); return wrap;
  }
  function renderDuty() {
    if (!requireMonth()) return;
    const panel = $('panel'); const summary = el('section', undefined, 'card'); summary.append(el('h2', '家庭の入力状況'));
    const table = el('table'); const head = el('tr'); for (const title of ['家庭', '回答状況', '当番可']) head.append(el('th', title)); const thead = el('thead'); thead.append(head); table.append(thead); const body = el('tbody');
    const monthSessions = sessions();
    for (const household of active('households')) {
      const members = active('members').filter(m => m['家庭ID'] === household['家庭ID']); const guardians = active('guardians').filter(g => g['家庭ID'] === household['家庭ID']); const representative = guardians[0];
      let answered = 0, offered = 0; const expected = (members.length + (representative ? 1 : 0)) * monthSessions.length;
      for (const s of monthSessions) {
        answered += members.filter(m => data.attendance.some(a => a['予定ID'] === s['予定ID'] && a['子どもID'] === m['子どもID'] && slots(s).filter(([slot]) => s[`実施有無_${slot}`] !== 'なし').every(([slot]) => a[slot === 'am' ? '午前' : '午後'] !== '' && a[slot === 'am' ? '午前' : '午後'] !== undefined))).length;
        if (representative && data.dutyOffers.some(d => d['予定ID'] === s['予定ID'] && d['保護者ID'] === representative['保護者ID'] && d['可否'] !== '' && d['可否'] !== undefined)) answered++;
        if (representative && data.dutyOffers.some(d => d['予定ID'] === s['予定ID'] && d['保護者ID'] === representative['保護者ID'] && bool(d['可否']))) offered++;
      }
      const tr = el('tr'); tr.append(el('td', household['家庭名']), el('td', expected === 0 ? '対象なし' : `${answered === 0 ? '未入力' : answered === expected ? '入力済' : '一部入力'} ${answered}/${expected}`), el('td', `${offered}/${monthSessions.length}日`)); body.append(tr);
    }
    table.append(body); summary.append(table, el('p', '子ども全員の出席回答と、家庭ごとの当番可否がそろうと入力済です。', 'muted')); panel.append(summary);
    for (const s of monthSessions) panel.append(dutyCard(s));
  }
  function dutyCard(s) {
    const card = el('article', undefined, 'card'); card.append(el('h2', s['日付']));
    const attendance = data.attendance.filter(a => a['予定ID'] === s['予定ID']);
    const isEvent = s['種別'] === '本番';
    card.append(el('p', isEvent ? `出席予定：終日${attendance.filter(a => bool(a['午前'])).length}名` : `出席予定：午前${attendance.filter(a => bool(a['午前'])).length}名 ／ 午後${attendance.filter(a => bool(a['午後'])).length}名`));
    const available = active('guardians').filter(g => data.dutyOffers.some(d => d['予定ID'] === s['予定ID'] && d['保護者ID'] === g['保護者ID'] && bool(d['可否'])));
    card.append(el('p', `当番可：${available.map(g => g['表示名']).join('、') || 'まだいません'}`));
    const notes = el('details'); notes.append(el('summary', '家庭からの連絡事項（管理者のみ）'));
    for (const a of attendance.filter(a => a['連絡事項'])) { const member = data.masters.members.find(m => m['子どもID'] === a['子どもID']); notes.append(el('p', `${member?.['氏名'] || '退籍メンバー'}：${a['連絡事項']}`, 'note')); }
    for (const d of data.dutyOffers.filter(d => d['予定ID'] === s['予定ID'] && d['メモ'])) { const guardian = data.masters.guardians.find(g => g['保護者ID'] === d['保護者ID']); notes.append(el('p', `${guardian?.['表示名'] || '退籍保護者'}：${d['メモ']}`, 'note')); }
    card.append(notes);
    const allRoles = [...new Set([...roles, ...data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID']).map(d => d['役割'])])];
    const rolePicker = el('div'); let role = '当番'; let dutySlot = '午前';
    const renderRole = () => {
      const addRole = el('div', undefined, 'row'); const roleInput = document.createElement('input'); roleInput.type = 'text'; roleInput.maxLength = 40; roleInput.placeholder = '役割を追加（例：レッスン見守り）';
      addRole.append(roleInput, button('役割を追加', () => {
        const name = roleInput.value.trim(); if (!name) return;
        if (!allRoles.includes(name)) allRoles.push(name);
        role = name; renderRole();
      }));
      rolePicker.replaceChildren(addRole);
      rolePicker.append(pills(allRoles.map(r => [r, r]), role, r => { role = r; renderRole(); }, '当番の役割'));
      // Keep the original storage key while presenting one all-day event shift.
      rolePicker.append(pills(isEvent ? [['午前', '終日']] : [['午前', '午前'], ['午後', '午後']], dutySlot, value => { dutySlot = value; renderRole(); }, '当番の時間帯'));
      const options = active('guardians').map(g => [g['保護者ID'], `${g['表示名']}${available.includes(g) ? '（可）' : '（要確認）'}`]);
      const roleAssignments = data.dutyAssignments.filter(d => {
        if (d['予定ID'] !== s['予定ID'] || d['役割'] !== role || !d['保護者ID']) return false;
        if (isEvent) return true;
        const division = String(d['区分'] || '');
        return division.startsWith(`${dutySlot}-`) || (!division.startsWith('午前-') && !division.startsWith('午後-') && dutySlot === '午前');
      });
      rolePicker.append(guardianSelect('担当を追加', options, '', value => {
        if (!value || roleAssignments.some(d => d['保護者ID'] === value)) return;
        const assignment = { '予定ID': s['予定ID'], '役割': role, '区分': `${dutySlot}-${crypto.randomUUID()}`, '保護者ID': value };
        data.dutyAssignments.push(assignment); mark('dutyAssignments', dutyKey(assignment)); renderRole();
      }));
      for (const assignment of roleAssignments) {
        const guardian = data.masters.guardians.find(g => g['保護者ID'] === assignment['保護者ID']);
        const row = el('div', undefined, 'row'); row.append(el('span', guardian?.['表示名'] || '退籍保護者'), button('外す', () => { assignment['保護者ID'] = ''; mark('dutyAssignments', dutyKey(assignment)); renderRole(); }, undefined, 'danger')); rolePicker.append(row);
      }
      const assigned = data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID'] && d['保護者ID']);
      const assignedByRole = Object.entries(assigned.reduce((result, assignment) => {
        const division = String(assignment['区分'] || '');
        const slotLabel = isEvent ? '終日' : division.startsWith('午後-') ? '午後' : division.startsWith('午前-') ? '午前' : '時間帯未設定';
        const key = `${assignment['役割']}（${slotLabel}）`;
        (result[key] ||= []).push(data.masters.guardians.find(g => g['保護者ID'] === assignment['保護者ID'])?.['表示名'] || '退籍保護者'); return result;
      }, {}));
      rolePicker.append(el('p', `割当一覧：${assignedByRole.map(([name, names]) => `${name}：${names.join('、')}`).join(' ／ ') || '未設定'}`));
      if (isSelfPractice(s)) rolePicker.append(el('p', missingFor(s).length ? `自主練の不足：${missingFor(s).join('、')}` : '先生・自主練の公開条件を満たしています。', missingFor(s).length ? 'warning' : 'success'));
    };
    renderRole(); card.append(rolePicker); return card;
  }
  function renderRoster() {
    const panel = $('panel'); const intro = el('section', undefined, 'card'); intro.append(el('h2', '名簿の管理'), el('p', '現在の名簿を表で直接編集します。保存前は自由に修正・行削除でき、保存後もこの画面には現在の内容だけを表示します。', 'muted'));
    panel.append(intro, pills([['families', '家庭・保護者・子ども'], ['teachers', '先生'], ['instruments', '使用楽器'], ['invites', '招待URL']], rosterTab, value => { rosterTab = value; render(); }, '名簿の種類'));
    if (rosterTab === 'families') renderFamilies(panel); else if (rosterTab === 'teachers') renderTeachers(panel); else if(rosterTab === 'instruments') renderInstruments(panel); else renderInviteUrls(panel);
  }
  function inviteUrl(page, parameter, token) {
    const url = new URL(location.href); url.pathname = url.pathname.replace(/\/app\/admin\.html$/, `/app/${page}.html`); url.search = ''; url.hash = ''; url.searchParams.set(parameter, token); return url.href;
  }
  function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const input = document.createElement('textarea'); input.value = value; document.body.append(input); input.select(); document.execCommand('copy'); input.remove(); return Promise.resolve();
  }
  function renderInviteUrls(panel) {
    const card = el('section', undefined, 'card'); card.append(el('h2', '招待URL一覧'), el('p', 'このURLを知っている人は該当画面を開けます。運営メンバー・先生・各家庭だけに送ってください。', 'warning'));
    const appendList = (title, rows, page, parameter) => {
      card.append(el('h3', title));
      if (!rows.length) { card.append(el('p', '在籍中の登録がありません。', 'muted')); return; }
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(row => {
        const url = inviteUrl(page, parameter, row.token); const details = document.createElement('details'); details.className = 'slot'; const summary = el('summary', row.name || '名称未入力'); const body = el('div'); const input = document.createElement('input'); input.type = 'text'; input.value = url; input.readOnly = true; input.setAttribute('aria-label', `${row.name}の招待URL`);
        const copy = button('コピー', () => copyText(url).then(() => { copy.textContent = 'コピーしました'; copy.disabled = true; message(`${row.name}の招待URLをコピーしました。`); setTimeout(() => { copy.textContent = 'コピー'; copy.disabled = false; }, 1600); }).catch(() => message('コピーできませんでした。URLを長押ししてコピーしてください。', true)), undefined, 'primary');
        body.append(input, copy); details.append(summary, body); card.append(details);
      });
    };
    const invites = data.invites || {}; appendList('先生用', invites.teachers || [], 'teacher', 't'); appendList('保護者用', invites.households || [], 'parent', 'k'); panel.append(card);
  }
  function buildRosterDraft() {
    const households = active('households').sort((a, b) => String(a['家庭名']).localeCompare(String(b['家庭名'])));
    const guardians = active('guardians'), members = active('members'); const rows = [];
    households.forEach(household => {
      const familyGuardians = guardians.filter(row => row['家庭ID'] === household['家庭ID']); const familyMembers = members.filter(row => row['家庭ID'] === household['家庭ID']);
      const count = Math.max(1, familyGuardians.length, Math.ceil(familyMembers.length / 2));
      for (let index = 0; index < count; index += 1) {
        const guardian = familyGuardians[index] || {}; const child1 = familyMembers[index * 2] || {}; const child2 = familyMembers[index * 2 + 1] || {};
        rows.push({ id: crypto.randomUUID(), householdId: household['家庭ID'], householdName: household['家庭名'] || '', guardianId: guardian['保護者ID'] || '', guardianName: guardian['表示名'] || '', guardianRoles: guardian['対応可能な役割'] || '', child1Id: child1['子どもID'] || '', child1Name: child1['氏名'] || '', child1Grade: child1['学年'] || '', child1Instrument: child1['基本担当楽器'] || '', child2Id: child2['子どもID'] || '', child2Name: child2['氏名'] || '', child2Grade: child2['学年'] || '', child2Instrument: child2['基本担当楽器'] || '' });
      }
    });
    return rows;
  }
  function newRosterRow() { return { id: crypto.randomUUID(), householdId: `H-${crypto.randomUUID()}`, householdName: '', guardianId: `G-${crypto.randomUUID()}`, guardianName: '', guardianRoles: '', child1Id: '', child1Name: '', child1Grade: '', child2Id: '', child2Name: '', child2Grade: '' }; }
  const familyOpen = new Map();
  function renderFamilies(panel) {
    const note = el('p', '家庭名は1回だけ表示し、その下に保護者と子どもを分けて入力します。', 'muted');
    const editor = el('section', undefined, 'card family-add-editor'); editor.hidden = !familyAddOpen;
    editor.append(el('h2', '新しい家庭'));
    editor.append(el('p', '家庭名だけでも追加できます。保護者・子どもは後から追加できます。', 'muted'));
    const addField = (label, placeholder, type = 'text') => { const wrap = el('label', label); const input = document.createElement('input'); input.type = type; input.placeholder = placeholder; wrap.append(input); return [wrap, input]; };
    const householdField = addField('家庭名', '例：戸塚'); const guardianField = addField('保護者名（任意）', '例：戸塚（母）');
    const child1Field = addField('子ども1（任意）', '子どもの氏名'); const grade1Field = addField('学年', '例：3年');
    const child2Field = addField('子ども2（任意）', '子どもの氏名'); const grade2Field = addField('学年', '例：1年');
    [[householdField, 'householdName'], [guardianField, 'guardianName'], [child1Field, 'child1Name'], [grade1Field, 'child1Grade'], [child2Field, 'child2Name'], [grade2Field, 'child2Grade']].forEach(([field, key]) => { field[1].value = familyAddDraft[key] || ''; field[1].addEventListener('input', () => { familyAddDraft[key] = field[1].value; updateSaveState(); }); });
    const fields = el('div', undefined, 'grid'); fields.append(householdField[0], guardianField[0], child1Field[0], grade1Field[0], child2Field[0], grade2Field[0]); editor.append(fields, instrumentPicker(familyAddDraft, 'child1Instrument', updateSaveState, '子ども1の使用楽器'), instrumentPicker(familyAddDraft, 'child2Instrument', updateSaveState, '子ども2の使用楽器'));
    const error = el('p', undefined, 'error'); error.hidden = true; editor.append(error);
    const editorActions = el('div', undefined, 'row'); const cancel = button('キャンセル', () => { Object.keys(familyAddDraft).forEach(key => delete familyAddDraft[key]); familyAddOpen = false; render(); }); const submit = button('家庭を追加', () => {
      const householdName = householdField[1].value.trim(); if (!householdName) { error.textContent = '家庭名を入力してください。'; error.hidden = false; householdField[1].focus(); return; }
      const row = newRosterRow(); row.householdName = householdName; row.guardianName = guardianField[1].value.trim(); row.child1Name = child1Field[1].value.trim(); row.child1Grade = grade1Field[1].value.trim(); row.child2Name = child2Field[1].value.trim(); row.child2Grade = grade2Field[1].value.trim();
      if (row.child1Name) row.child1Id = `M-${crypto.randomUUID()}`; if (row.child2Name) row.child2Id = `M-${crypto.randomUUID()}`;
      row.child1Instrument = familyAddDraft.child1Instrument || ''; row.child2Instrument = familyAddDraft.child2Instrument || ''; rosterDraft.push(row); familyOpen.set(row.householdId, true); Object.keys(familyAddDraft).forEach(key => delete familyAddDraft[key]); familyAddOpen = false; markRoster(); render();
    }, undefined, 'primary'); editorActions.append(cancel, submit); editor.append(editorActions);
    const add = button(familyAddOpen ? '追加を閉じる' : '家庭を追加', () => { editor.hidden = !editor.hidden; familyAddOpen = !editor.hidden; add.textContent = editor.hidden ? '家庭を追加' : '追加を閉じる'; if (!editor.hidden) householdField[1].focus(); }, undefined, 'primary');
    const groups = [...new Map(rosterDraft.map(row => [row.householdId, { householdId: row.householdId, householdName: row.householdName || '', rows: [] }])).values()];
    rosterDraft.forEach(row => groups.find(group => group.householdId === row.householdId)?.rows.push(row));
    const list = el('div', undefined, 'family-roster-list');
    const textInput = (row, key, placeholder, label) => { const input = document.createElement('input'); input.value = row[key] || ''; input.placeholder = placeholder; input.setAttribute('aria-label', label || placeholder); input.addEventListener('input', () => { row[key] = input.value; markRoster(); }); return input; };
    const removePerson = (row, kind, slot) => {
      if (kind === 'guardian') { row.guardianName = ''; row.guardianRoles = ''; }
      else { row[`${slot}Id`] = ''; row[`${slot}Name`] = ''; row[`${slot}Grade`] = ''; }
      if (!row.guardianName && !row.child1Name && !row.child2Name && rosterDraft.some(item => item.householdId === row.householdId && item.id !== row.id)) rosterDraft = rosterDraft.filter(item => item.id !== row.id);
      markRoster(); render();
    };
    groups.forEach(group => {
      const card = el('details', undefined, 'card family-roster-card'); card.open = familyOpen.get(group.householdId) || false;
      const summary = el('summary'); summary.style.overflowWrap = 'anywhere'; summary.style.cursor = 'pointer';
      const updateSummary = () => { const names = group.rows.flatMap(row => [row.guardianName, row.child1Name, row.child2Name]).filter(Boolean); summary.textContent = `${group.rows[0]?.householdName || '家庭名未入力'} — ${[...new Set(names)].join('・') || 'メンバー未入力'}`; };
      updateSummary(); card.append(summary); card.addEventListener('toggle', () => { if (card.isConnected) familyOpen.set(group.householdId, card.open); });
      card.addEventListener('input', () => { familyOpen.set(group.householdId, true); updateSummary(); });
      const head = el('div', undefined, 'family-roster-head');
      const familyName = document.createElement('input'); familyName.value = group.householdName; familyName.placeholder = '家庭名'; familyName.setAttribute('aria-label', '家庭名'); familyName.addEventListener('input', () => { rosterDraft.filter(row => row.householdId === group.householdId).forEach(row => { row.householdName = familyName.value; }); markRoster(); });
      head.append(familyName, button('家庭を削除', () => confirmRemoval(group.householdName || 'この家庭', () => { rosterDraft = rosterDraft.filter(row => row.householdId !== group.householdId); markRoster(); render(); }), undefined, 'danger')); card.append(head);
      const guardians = el('section', undefined, 'family-roster-section'); guardians.append(el('h3', '保護者')); const guardianList = el('div', undefined, 'family-roster-people');
      group.rows.filter(row => row.guardianName || (!row.child1Name && !row.child2Name)).forEach(row => { const item = el('div', undefined, 'family-roster-person'); item.append(textInput(row, 'guardianName', '保護者名'), textInput(row, 'guardianRoles', '例：見守り・楽器運び', '役職・対応できること（任意）'), button('×', () => removePerson(row, 'guardian'), undefined, 'danger')); guardianList.append(item); });
      guardians.append(guardianList, button('保護者を追加', () => { const row = { ...newRosterRow(), householdId: group.householdId, householdName: familyName.value }; rosterDraft.push(row); markRoster(); render(); })); card.append(guardians);
      const children = el('section', undefined, 'family-roster-section'); children.append(el('h3', '子ども')); const childList = el('div', undefined, 'family-roster-people');
      group.rows.forEach(row => { for (const slot of ['child1', 'child2']) if (row[`${slot}Name`] || row[`${slot}Id`]) { const item = el('div', undefined, 'family-roster-person'); item.append(textInput(row, `${slot}Name`, '子どもの氏名'), textInput(row, `${slot}Grade`, '学年', '学年'), button('×', () => removePerson(row, 'child', slot), undefined, 'danger')); item.append(instrumentPicker(row, `${slot}Instrument`, () => markRoster())); childList.append(item); } });
      children.append(childList, button('子どもを追加', () => { const row = group.rows.find(item => !item.child1Name || !item.child2Name) || { ...newRosterRow(), householdId: group.householdId, householdName: familyName.value }; const slot = !row.child1Name ? 'child1' : 'child2'; row[`${slot}Id`] ||= `M-${crypto.randomUUID()}`; if (!group.rows.includes(row)) rosterDraft.push(row); markRoster(); render(); })); card.append(children); list.append(card);
    });
    panel.append(note, add, editor, list);
  }
  function instrumentPicker(row, key, change, label = '使用楽器') {
    const wrap = el('section', undefined, 'instrument-picker'); wrap.append(el('h4', label));
    const choices = (data.instruments || []).filter(item => bool(item['有効'])).map(item => item['表示名']);
    let other = Boolean(row[key] && !choices.includes(row[key]));
    const draw = () => {
      wrap.replaceChildren(el('h4', label));
      wrap.append(pills([['', '未設定'], ...choices.map(name => [name, name]), ['__other', 'その他']], other ? '__other' : row[key] || '', value => { other = value === '__other'; row[key] = other ? '' : value; change(); draw(); }, label));
      if (other) { const input = field('その他の楽器（40文字以内）', row[key], value => { row[key] = value.trim(); change(); warning(); }); input.lastChild.maxLength = 40; wrap.append(input); }
      wrap.append(warn); warning();
    };
    const warn = el('p', '', 'warning'); const warning = () => {
      const count = rosterDraft.reduce((n, item) => n + ['child1Instrument','child2Instrument'].filter(k => item[k] && item[k] === row[key]).length, 0);
      warn.textContent = row[key] && count > (rosterDraft.includes(row) ? 1 : 0) ? '同じ楽器を使用する子どもがいます。確認のうえ、そのまま保存できます。' : '';
    }; draw(); return wrap;
  }
  function renderInstruments(panel) {
    const card = el('section', undefined, 'card'); card.append(el('h2', '使用楽器の候補'), el('p', '楽器種類と番号を合わせて登録します（例：トランペット3）。削除しても、子どもに保存された使用楽器は残ります。配置図へは自動反映しません。', 'muted'));
    let name = ''; const input = field('楽器種類＋番号', '', value => { name = value; }); input.lastChild.maxLength = 40;
    card.append(input, button('楽器を登録', () => {
      const value = name.trim(); if (!value || value.length > 40) { message('楽器名を1〜40文字で入力してください。',true); return; }
      if(data.instruments.some(item => bool(item['有効']) && item['表示名'] === value)) { message('同じ楽器が登録されています。',true); return; }
      const item = { '楽器ID': `I-${crypto.randomUUID()}`, '表示名': value, '有効': true }; data.instruments.push(item); mark('instruments',item['楽器ID']); render();
    }));
    data.instruments.filter(item => bool(item['有効'])).forEach(item => { const row = el('div',undefined,'row'); row.append(el('span',item['表示名']),button('候補から削除',()=>{ item['有効']=false;mark('instruments',item['楽器ID']);render(); }));card.append(row); });panel.append(card);
  }
  function renderTeachers(panel) {
    panel.append(el('p', '候補日入力に表示する先生です。スマホを使わない先生も、ここには登録し、可否は管理者が「予定・当番」タブで代理入力できます。', 'muted'));
    panel.append(button('先生を追加', () => { const teacher = { '先生ID': `T-${crypto.randomUUID()}`, '氏名': '', '担当楽器': '', '在籍': true }; data.masters.teachers.push(teacher); mark('teachers', rosterKeys.teachers(teacher)); render(); }, undefined, 'primary'));
    data.masters.teachers.sort((a, b) => Number(bool(b['在籍'])) - Number(bool(a['在籍'])) || String(a['氏名']).localeCompare(String(b['氏名']))).forEach(teacher => {
      const card = el('article', undefined, 'card roster-card'); card.append(el('h2', teacher['氏名'] || '新しい先生'), el('span', bool(teacher['在籍']) ? '在籍中' : '在籍終了', 'badge'));
      card.append(field('氏名', teacher['氏名'], value => { teacher['氏名'] = value; mark('teachers', rosterKeys.teachers(teacher)); }));
      card.append(field('担当楽器', teacher['担当楽器'], value => { teacher['担当楽器'] = value; mark('teachers', rosterKeys.teachers(teacher)); }));
      card.append(button(bool(teacher['在籍']) ? '削除' : '復帰', () => { const change = () => { teacher['在籍'] = !bool(teacher['在籍']); mark('teachers', rosterKeys.teachers(teacher)); render(); }; if (bool(teacher['在籍'])) confirmRemoval(teacher['氏名'] || 'この先生', change); else change(); }, undefined, bool(teacher['在籍']) ? 'danger' : undefined)); panel.append(card);
    });
  }
  function eventSessions() { return sessions().filter(s => s['種別'] === '本番'); }
  function eventFor(session) {
    let event = data.events.find(row => row['予定ID'] === session['予定ID']);
    if (!event) { event = { '予定ID': session['予定ID'], '本番名': '', '会場': '', '衣装': '', '子どもの持ち物': '', '全体連絡': '' }; data.events.push(event); }
    return event;
  }
  const selectedEvents = new Map();
  function renderEvent() {
    if (!requireMonth()) return;
    const panel = $('panel'); const candidates = eventSessions();
    panel.append(el('p', '曲・MC、当日の流れ、配置図を切り替えて編集できます。', 'muted'));
    if (!candidates.length) panel.append(el('section', '「予定・当番」タブで予定の種別を「本番」にすると、ここで編集できます。', 'card warning'));
    else {
      let selectedId = candidates.some(s => s['予定ID'] === selectedEvents.get(monthId)) ? selectedEvents.get(monthId) : candidates[0]['予定ID'];
      const selector = el('section', undefined, 'card'); selector.append(el('h2', '編集する本番'));
      const body = el('div'); const draw = () => { body.replaceChildren(eventEditor(candidates.find(s => s['予定ID'] === selectedId))); updateSaveState(); };
      selector.append(pills(candidates.map(s => [s['予定ID'], `${s['日付']} ${eventFor(s)['本番名'] || '本番名未入力'}`]), selectedId, id => { selectedId = id; selectedEvents.set(monthId, id); draw(); }, '編集する本番'), body); panel.append(selector); draw();
    }
    const references = data.references || {};
    const annual=el('details');annual.append(el('summary','年間の本番候補・資料'));annual.append(references.status === 'ready' ? referenceEventEditor(references.annualEvents || []) : referenceImportCard());panel.append(annual);
  }
  const eventViews = new Map(), selectedTimelineItems = new Map(), eventBasicsOpen = new Map();
  function openEventTemplate(session, onAdded) {
    if (document.querySelector('.event-template-dialog')) return;
    const sessionId = session['予定ID'];
    const names = ['リハーサル', '積み込み・搬出', '移動', '搬入・準備', '本番', '撤収・搬出', '帰校'];
    const existingNames = () => new Set(data.timelineItems.filter(item => item['予定ID'] === sessionId && item.scope !== 'ステージ進行' && item['日区分'] === '当日' && item['有効'] !== false).map(item => item['内容']));
    const selected = new Set(), existing = existingNames();
    const dialog = el('dialog', undefined, 'event-template-dialog'); dialog.setAttribute('aria-label', '基本の流れを追加');
    dialog.append(el('h2', '基本の流れを追加'), el('p', '平沼小での集合から、リハ・積み込み、会場への移動、帰校までのひな形です。必要な項目だけ選んでください。'), el('p', '集合・解散は日程の共通欄を使います。時刻は未定、場所は本番の会場で追加し、後から編集できます。既存の項目は変更しません。', 'muted'));
    names.forEach(name => {
      if (!existing.has(name)) selected.add(name);
      const choice = check(name + (existing.has(name) ? '（追加済み）' : ''), !existing.has(name), value => { if (value) selected.add(name); else selected.delete(name); add.disabled = !selected.size; });
      choice.children[0].disabled = existing.has(name); dialog.append(choice);
    });
    let committed = false;
    const add = button('選んだ項目を追加', () => {
      if (committed || !dialog.open || !selected.size) return;
      if (!data.sessions.some(item => item['予定ID'] === sessionId && item['種別'] === '本番')) { message('本番予定が見つかりません。追加を取り消して日程を確認してください。', true); return; }
      const present = existingNames(), added = [];
      let order = Math.max(0, ...data.timelineItems.filter(item => item['予定ID'] === sessionId && item.scope !== 'ステージ進行' && item['日区分'] === '当日').map(item => Number(item['並び順']) || 0));
      names.filter(name => selected.has(name) && !present.has(name)).forEach(name => {
        const item = { '項目ID': `TL-${crypto.randomUUID()}`, '予定ID': sessionId, '日区分': '当日', '時刻': '', '並び順': ++order, scope: '当日進行', '種別': '予定', '内容': name, stageJSON: JSON.stringify({placeText: data.events.find(event => event['予定ID'] === sessionId)?.['会場'] || ''}), '場所ID': '', '担当': '', '担当自由入力': '', '持ち物': '', '注意点': '', '有効': true };
        data.timelineItems.push(item); mark('timelineItems', item['項目ID']); added.push(item);
      });
      committed = true; dialog.close(); onAdded(added); message(added.length ? `${added.length}件の流れを追加しました。時刻・場所を確認して保存してください。` : '追加済みの項目はそのまま保持しました。');
    }, undefined, 'primary'); add.disabled = !selected.size;
    const cancel = button('キャンセル', () => { committed = true; dialog.close(); }); const actions = el('div', undefined, 'row'); actions.append(cancel, add); dialog.append(actions);
    dialog.addEventListener('close', () => { committed = true; dialog.remove(); }, { once: true }); document.body.append(dialog); dialog.showModal(); cancel.focus();
  }
  function eventEditor(session) {
    const sessionId=session['予定ID'];const wrap=el('div',undefined,'event-workspace');const event=eventFor(session);
    wrap.id=`event-day-${sessionId}`;
    const heading=el('section',undefined,'event-heading');const title=el('h2',eventTitle(session),'event-title');heading.append(title,el('p',`${session['日付']} · 本番`,'eyebrow'),field('本番名',event['本番名'],value=>{event['本番名']=value;mark('events',eventKey(event));title.textContent=value.trim()||'本番名未設定';}));
    const essentials = el('div', undefined, 'grid');
    essentials.append(field('日付', session['日付'], value => { session['日付'] = value; mark('sessions', sessionId); }, 'date'), field('会場', event['会場'], value => { event['会場'] = value; mark('events', sessionId); }));
    timeFields.forEach(key => essentials.append(field(key + '（未定可）', session[key], value => { session[key] = value; mark('sessions', sessionId); }, 'time')));
    heading.append(essentials, el('p', '時刻の空欄は「未定」で保存します。', 'muted'), button('時刻を未定にする', () => { timeFields.forEach(key => { session[key] = ''; }); mark('sessions', sessionId); render(); }), placePicker(session, () => render()), field('共有備考', session['備考'], value => { session['備考'] = value; mark('sessions', sessionId); }, 'textarea'), button('出欠・当番を確認', () => editSession(session)));

    let view=eventViews.get(sessionId)||'day';
    const timeline=data.timelineItems.filter(item=>item['予定ID']===sessionId);
    const toolbar=el('div',undefined,'event-toolbar');const tabsBox=el('div',undefined,'event-view-tabs');const actions=el('div',undefined,'event-actions');const body=el('div');
    const rows=()=>timeline.filter(item=>item['有効']!==false && (view==='stage'?item.scope==='ステージ進行':item.scope!=='ステージ進行')).sort((a,b)=>(a['日区分']==='前日'?0:1)-(b['日区分']==='前日'?0:1)||(view==='stage'?Number(a['並び順']||0)-Number(b['並び順']||0):BandShared.compareTimeline(a,b)));
    let selectedId=selectedTimelineItems.get(sessionId+'-'+view)||'';
    const overview=el('div',undefined,'timeline-overview event-list');const editor=el('div',undefined,'event-detail');const previewContent=el('div');const dayPreview=el('div',undefined,'event-day-preview');
    const moveNotice=el('p',undefined,'muted reorder-notice');moveNotice.setAttribute('role','status');const addHint=el('p',undefined,'muted insertion-hint');let draggingId='';
    const applyMove=(id,targetId,after=false)=>{const changed=BandShared.reorderTimeline(timeline,id,targetId,after);if(!changed.length)return;changed.forEach(item=>mark('timelineItems',timelineKey(item)));selectedId=id;selectedTimelineItems.set(sessionId+'-'+view,id);drawEditor();drawOverview();const item=timeline.find(i=>i['項目ID']===id);const list=rows().filter(i=>i['日区分']===item['日区分']);moveNotice.textContent=`${item['内容']||'名前未入力'}を${list.indexOf(item)+1}番目へ移動しました。`;overview.querySelector(`[data-item-id="${CSS.escape(id)}"]`)?.scrollIntoView({block:'nearest'});};
    const reorder=(item,delta)=>{const list=rows().filter(i=>i['日区分']===item['日区分']);const index=list.indexOf(item);const target=list[index+delta];if(target)applyMove(item['項目ID'],target['項目ID'],delta>0);};
    const drawOverview=()=>{dayPreview.replaceChildren();BandShared.renderDaySchedule(dayPreview,session,timeline,data.masters.places);previewContent.replaceChildren();BandShared.renderProgress(previewContent,timeline.filter(item=>item['有効']!==false&&item.scope==='ステージ進行').map(stageDisplay),data.layouts.filter(l=>l.sessionId===sessionId),'','admin-'+sessionId);overview.replaceChildren();const selected=rows().find(i=>i['項目ID']===selectedId);addHint.textContent=selected?`追加先：選択中「${selected['内容']||'名前未入力'}」の直後`:'追加先：一覧の末尾';for(const day of ['前日','当日']){const items=rows().filter(item=>item['日区分']===day);if(!items.length)continue;overview.append(el('h3',day));const list=el('div',undefined,'timeline-overview-rows');items.forEach((item,index)=>{const shell=el('article',undefined,'reorder-row');shell.dataset.itemId=item['項目ID'];shell.classList.toggle('selected',item['項目ID']===selectedId);
      const handle=button('⠿',()=>{selectedId=item['項目ID'];selectedTimelineItems.set(sessionId+'-'+view,selectedId);drawEditor();drawOverview();});handle.className='drag-handle';handle.draggable=true;handle.setAttribute('aria-label',`${item['内容']||'名前未入力'}をつかんで移動`);handle.title='PC：ここをドラッグして並べ替え';handle.addEventListener('dragstart',e=>{draggingId=item['項目ID'];e.dataTransfer.setData('text/plain',draggingId);e.dataTransfer.effectAllowed='move';shell.classList.add('dragging');});handle.addEventListener('dragend',()=>{draggingId='';overview.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(n=>n.classList.remove('drop-before','drop-after','dragging'));});
      const row=button('',()=>{selectedId=item['項目ID'];selectedTimelineItems.set(sessionId+'-'+view,selectedId);drawEditor();drawOverview();},item['項目ID']===selectedId,'timeline-overview-row');row.setAttribute('aria-label',`${day} ${item['時刻']||'時刻未定'} ${item['内容']||'内容未入力'}を編集`);row.append(el('strong',view==='day'?item['時刻']||'未定':`${index+1}. ${item['種別']}`),el('span',item['内容']||'名前未入力'));if(view==='day')row.append(el('small',BandShared.timelinePlace(item,data.masters.places)||'場所：未定','muted'));
      const controls=el('div',undefined,'row-moves');const up=button('↑ 上へ',()=>reorder(item,-1));up.disabled=index===0;up.setAttribute('aria-label',`${item['内容']||'名前未入力'}を上へ`);const down=button('↓ 下へ',()=>reorder(item,1));down.disabled=index===items.length-1;down.setAttribute('aria-label',`${item['内容']||'名前未入力'}を下へ`);controls.append(up,down);shell.append(handle,row,controls);
      shell.addEventListener('dragover',e=>{if(!draggingId||draggingId===item['項目ID'])return;const source=timeline.find(i=>i['項目ID']===draggingId);if(source?.['日区分']!==day||source?.scope!==item.scope)return;e.preventDefault();e.dataTransfer.dropEffect='move';const after=e.clientY>shell.getBoundingClientRect().top+shell.offsetHeight/2;overview.querySelectorAll('.drop-before,.drop-after').forEach(n=>n.classList.remove('drop-before','drop-after'));shell.classList.add(after?'drop-after':'drop-before');});shell.addEventListener('dragleave',e=>{if(!shell.contains(e.relatedTarget))shell.classList.remove('drop-before','drop-after');});shell.addEventListener('drop',e=>{e.preventDefault();const id=draggingId;const after=shell.classList.contains('drop-after');draggingId='';applyMove(id,item['項目ID'],after);});list.append(shell);});overview.append(list);}if(!rows().length)overview.append(el('p','「＋追加」から曲・MC・その他を選んで始めます。','muted'));};
    overview.addEventListener('dragover',e=>{if(!draggingId)return;const box=overview.getBoundingClientRect();if(e.clientY<box.top+28)overview.scrollTop-=14;else if(e.clientY>box.bottom-28)overview.scrollTop+=14;});
    const drawEditor=()=>{editor.replaceChildren();const item=rows().find(item=>item['項目ID']===selectedId);if(!item){editor.append(el('p','一覧から項目を選んで編集します。','muted'));return;}editor.append(timelineEditor(item,()=>{drawEditor();drawOverview();},drawOverview));const controls=el('div',undefined,'layout-controls');const list=rows().filter(row=>row['日区分']===item['日区分']);const index=list.indexOf(item);const up=button('同じ日の一覧で前へ',()=>reorder(item,-1));up.disabled=index<=0;const down=button('同じ日の一覧で後へ',()=>reorder(item,1));down.disabled=index>=list.length-1;controls.append(up,down);editor.append(controls);};
    const add=(kind,scope)=>{const anchor=rows().find(i=>i['項目ID']===selectedId&&i.scope===scope);const item={'項目ID':`TL-${crypto.randomUUID()}`,'予定ID':sessionId,'日区分':anchor?.['日区分']||'当日','時刻':'','並び順':Math.max(0,...timeline.map(row=>Number(row['並び順'])||0))+1,scope,'種別':kind,'内容':'',stageJSON:JSON.stringify({placeText:scope==='当日進行'?(event['会場']||''):''}),'場所ID':'','担当':'','担当自由入力':'','持ち物':'','注意点':'','有効':true};timeline.push(item);data.timelineItems.push(item);if(anchor)BandShared.reorderTimeline(timeline,item['項目ID'],anchor['項目ID'],true).forEach(row=>mark('timelineItems',timelineKey(row)));selectedId=item['項目ID'];selectedTimelineItems.set(sessionId+'-'+view,selectedId);mark('timelineItems',timelineKey(item));drawEditor();drawOverview();editor.scrollIntoView({block:'nearest'});};
    const chooseAddition = () => {
      if (document.querySelector('.event-add-dialog')) return;
      document.activeElement?.blur();
      const dialog = el('dialog', undefined, 'event-add-dialog'); dialog.setAttribute('aria-label', '追加する項目を選択');
      dialog.append(el('h2', '何を追加しますか？'));
      const options = el('div', undefined, 'event-add-options');
      [['曲', '曲', 'stage', 'ステージ進行'], ['MC', 'MC', 'stage', 'ステージ進行'], ['その他の進行項目', 'その他', 'day', '当日進行']].forEach(([label, kind, nextView, scope]) => {
        options.append(button(label, () => {
          dialog.close();
          view = nextView; eventViews.set(sessionId, view); selectedId = selectedTimelineItems.get(sessionId+'-'+view) || ''; draw(); add(kind, scope);
        }));
      });
      dialog.append(options, el('p', '曲・MCは「曲・MC」、その他は「当日の流れ」に追加します。', 'muted'), button('キャンセル', () => dialog.close()));
      dialog.addEventListener('close', () => dialog.remove(), { once: true }); document.body.append(dialog); dialog.showModal();
    };
    const draw=()=>{
      tabsBox.replaceChildren(pills([['day','当日の流れ'],['stage','曲・MC'],['layout','配置図']],view,id=>{document.activeElement?.blur();view=id;eventViews.set(sessionId,id);selectedId=selectedTimelineItems.get(sessionId+'-'+id)||'';draw();},'本番画面の切替'));
      const save = button('保存', ()=>$('save').click()); save.dataset.eventSave = '';
      const state = el('span', undefined, 'event-save-state'); state.dataset.eventSaveState = ''; state.setAttribute('role','status');
      actions.replaceChildren(button('＋追加', chooseAddition, undefined, 'primary'), save, state);
      if(view==='day')actions.append(button('基本の流れを追加',()=>openEventTemplate(session,added=>{timeline.push(...added);selectedId=added[0]?.['項目ID']||selectedId;selectedTimelineItems.set(sessionId+'-day',selectedId);draw();})));
      addHint.hidden = view === 'layout'; moveNotice.hidden = view === 'layout';
      body.replaceChildren();
      if(view==='layout'){body.append(layoutEditor(session)); updateSaveState(); return;}
      if(view==='day'){
        body.append(el('p', '時刻・内容・場所を入力します。未入力は「未定」で表示します。', 'muted'));
      }
      if(!rows().some(item=>item['項目ID']===selectedId))selectedId=rows()[0]?.['項目ID']||'';
      selectedTimelineItems.set(sessionId+'-'+view,selectedId);
      const split=el('div',undefined,'event-split');split.append(overview,editor);body.append(split);drawEditor();drawOverview();
      if(view==='day'){const preview=el('details',undefined,'event-preview');preview.append(el('summary','全体の流れの表示を確認'),dayPreview);body.append(preview);}
      if(view==='stage'){const preview=el('details',undefined,'event-preview');preview.append(el('summary','今・次の確認画面を見る'));preview.append(previewContent);body.append(preview);}
      updateSaveState();
    };
    toolbar.append(tabsBox);draw();
    const basic=el('details',undefined,'event-basic');basic.append(el('summary','本番の基本情報（名前・会場・時刻など）'),heading);basic.open=eventBasicsOpen.get(sessionId) ?? !event['本番名'];basic.addEventListener('toggle',()=>{if(basic.isConnected)eventBasicsOpen.set(sessionId,basic.open);});const set=(key,value)=>{event[key]=value;mark('events',eventKey(event));};const grid=el('div',undefined,'grid');['衣装'].forEach(key=>grid.append(field(key,event[key],value=>set(key,value))));basic.append(grid,field('子どもの持ち物',event['子どもの持ち物'],value=>set('子どもの持ち物',value),'textarea'),field('全体連絡',event['全体連絡'],value=>set('全体連絡',value),'textarea'));wrap.append(toolbar,basic,actions,addHint,moveNotice,body);return wrap;
  }
  const selectedLayouts = new Map(), selectedLayoutItems = new Map();
  function layoutEditor(session) {
    data.layouts ||= [];
    const candidates = data.layouts.filter(row=>row.sessionId===session['予定ID'] && row.active!==false);
    let layout = candidates.find(row=>row.id===selectedLayouts.get(session['予定ID'])) || candidates[0];
    const wrap = el('section', undefined, 'slot'); wrap.append(el('h2', '配置図'));
    if (!layout) { wrap.append(button('配置図を作成', () => { const row = { id: `LAY-${crypto.randomUUID()}`, sessionId: session['予定ID'], name: '演奏時の配置', notes: '', items: [], active: true }; data.layouts.push(row); mark('layouts', row.id); wrap.replaceWith(layoutEditor(session)); }, undefined, 'primary')); return wrap; }
    wrap.append(pills(candidates.map(l=>[l.id,l.name]),layout.id,id=>{selectedLayouts.set(session['予定ID'],id);wrap.replaceWith(layoutEditor(session));},'編集する配置図'),button('別の曲の配置図を作成',()=>{const row={id:`LAY-${crypto.randomUUID()}`,sessionId:session['予定ID'],name:'新しい曲の配置',notes:'',items:[],active:true};data.layouts.push(row);selectedLayouts.set(session['予定ID'],row.id);mark('layouts',row.id);render();}));
    let selected = selectedLayoutItems.get(layout.id) || '';
    const update = () => mark('layouts', layout.id);
    const metadata = el('details', undefined, 'layout-settings'); metadata.append(el('summary', '図名・備考'), field('図名', layout.name, value => { layout.name = value; update(); }), field('備考', layout.notes, value => { layout.notes = value; update(); }, 'textarea'));
    const openLarge = id => BandLayoutEditor.open({ layout, selectedId: id, onChange: update, isDirty: () => dirty.layouts.has(layout.id), save: async () => { if (dirty.sessions.has(layout.sessionId)) throw new Error('本番の予定も未保存です。閉じて本番画面の「保存」を押すと、配置も一緒に保存できます。'); await api.request('admin_save_layouts', { records: [layout] }); dirty.layouts.delete(layout.id); const fresh = await api.request('admin_bootstrap'); data.shared = fresh.shared; data.months = fresh.months; data.sessions.forEach(row => { const saved = fresh.sessions.find(s => s['予定ID'] === row['予定ID']); if (saved) row['確定状態'] = saved['確定状態']; }); updateSaveState(); }, onClose: id => { selected = id; selectedLayoutItems.set(layout.id, id); redraw(); editLarge.focus({preventScroll:true}); } });
    const editLarge = button('配置図を大きく編集', () => openLarge(selected), undefined, 'primary layout-open-editor');
    const drawing = el('div'); const controls = el('div');
    const redraw = () => {
      drawing.replaceChildren(); controls.replaceChildren();
      BandShared.renderLayout(drawing, layout, id => { selected = id; selectedLayoutItems.set(layout.id, id); openLarge(id); });
      controls.append(pills(layout.items.map(item => [item.id, `${item.kind === 'person' ? '人' : BandShared.layoutModel.pairedPerson(layout,item) ? '担当楽器' : '楽器'}：${item.label}${item.kind === 'person' && BandShared.layoutModel.pairedInstrument(layout,item.id) ? `／${BandShared.layoutModel.pairedInstrument(layout,item.id).label}` : ''}`]), selected, id => { selected = id; selectedLayoutItems.set(layout.id, id); redraw(); }, '配置項目を選択'));
      const item = layout.items.find(item => item.id === selected);
      if (!item) return;
      const person = item.kind === 'person' ? item : BandShared.layoutModel.pairedPerson(layout, item);
      if (person) {
        const assigned = BandShared.layoutModel.pairedInstrument(layout,person.id);
        const input = document.createElement('input'); input.value = assigned?.label || ''; input.placeholder = '担当楽器未設定'; input.maxLength = 40; input.setAttribute('aria-label', `${person.label}の担当楽器（この配置図）`);
        const label = el('label', `${person.label}の担当楽器（この配置図）`); label.append(input);
        input.addEventListener('input', () => { try { BandShared.layoutModel.setInstrument(layout,person.id,input.value); update(); drawing.replaceChildren(); BandShared.renderLayout(drawing,layout,id => { selected=id; selectedLayoutItems.set(layout.id,id); openLarge(id); }); } catch(error) { message(error.message,true); } }); controls.append(label, el('p','楽器名の変更はこの配置図だけに反映します。名簿の担当楽器は変更しません。','muted'));
      }
      controls.append(el('h3', `選択：${item.label}`), button('選択した項目を外す', () => { BandShared.layoutModel.remove(layout, selected); selected = layout.items[0]?.id || ''; update(); redraw(); }, undefined, 'danger'));
    };
    const add = (kind, label, memberId = '') => { if (layout.items.length >= 100) { message('配置は100項目までです。', true); return; } const item = { id: `POS-${crypto.randomUUID()}`, kind, label, memberId, x: 20 + (layout.items.length % 4) * 20, y: 25 + (Math.floor(layout.items.length / 4) % 3) * 20 }; layout.items.push(item); selected = item.id; update(); redraw(); return item; };
    const members = el('details'); members.append(el('summary', '＋人を追加（メンバーから選択）'), pills(sortedMembers().map(member => [member['子どもID'], member['氏名']]), '', id => { if (layout.items.some(item => item.memberId === id)) { message('このメンバーは配置済みです。', true); return; } add('person', data.masters.members.find(member => member['子どもID'] === id)['氏名'], id); }, '配置するメンバー'));
    const instruments = el('details'); instruments.append(el('summary', '＋楽器を追加')); const instrumentChoices = (data.instruments || []).filter(item => bool(item['有効'])); if (instrumentChoices.length) instruments.append(pills(instrumentChoices.map(item => [item['楽器ID'], item['表示名']]), '', id => { const instrument = instrumentChoices.find(item => item['楽器ID'] === id); if (instrument) add('instrument', instrument['表示名']); }, '登録済み楽器から追加')); else instruments.append(el('p', '登録済みの楽器はありません。自由入力で追加できます。', 'muted')); const input = document.createElement('input'); input.placeholder = '楽器名（40文字以内）'; input.maxLength = 40; input.setAttribute('aria-label', '追加する楽器名'); const freeInstrument = el('div', undefined, 'row'); freeInstrument.append(input, button('自由入力で追加', () => { if (!input.value.trim()) return; add('instrument', input.value.trim()); input.value = ''; })); instruments.append(el('p', '自由入力はこの配置図だけに追加します。楽器マスターには登録しません。', 'muted'), freeInstrument);
    const combinedMembers = el('details'); combinedMembers.append(el('summary', '＋名前と担当楽器を一体で追加'), pills(sortedMembers().map(member => [member['子どもID'], `${member['氏名']}／${member['基本担当楽器'] || '担当楽器未設定'}`]), '', id => {
      const member = data.masters.members.find(member => member['子どもID'] === id); let person = layout.items.find(item => item.kind === 'person' && item.memberId === id);
      if (person) { selected=person.id; BandShared.layoutModel.setMode(layout,'combined'); redraw(); message('このメンバーは配置済みです。担当楽器を確認・変更できます。'); return; }
      person=add('person',member['氏名'],id);
      if (!person) return;
      try { BandShared.layoutModel.setInstrument(layout,person.id,member['基本担当楽器'] || ''); BandShared.layoutModel.setMode(layout,'combined'); update(); redraw(); } catch(error) { message(error.message,true); }
    }, '一体で配置するメンバー'));
    const settings = el('details', undefined, 'layout-settings'); settings.append(el('summary', '人・楽器の追加と設定'), controls, members, combinedMembers, instruments);
    wrap.append(editLarge, el('p', '図の中をタップして選択し、ドラッグや矢印で位置を調整できます。', 'muted'), drawing, settings, metadata); redraw(); return wrap;
  }
  function timelineEditor(item, redraw, refreshOverview = () => {}) {
    const row = el('article', undefined, 'card timeline-item'); const set = (key, value, refresh = false) => { item[key] = value; mark('timelineItems', timelineKey(item)); if (refresh) redraw(); else refreshOverview(); };
    const head = el('div', undefined, 'row'); head.append(el('h3', item['内容'] || '新しい進行項目'), button('削除', () => confirmRemoval(item['内容'] || 'この進行項目', () => { item['有効'] = false; mark('timelineItems', timelineKey(item)); redraw(); }), undefined, 'danger')); row.append(head);
    const isDay = item.scope !== 'ステージ進行';
    const grid = el('div', undefined, 'grid'); if (!isDay) grid.append(field('時刻（任意）', item['時刻'], value => set('時刻', value), 'time')); grid.append(field('並び順', item['並び順'], value => set('並び順', value), 'number'));
    const advanced=el('details');advanced.append(el('summary','時刻・区分・場所・持ち物など'));
    advanced.append(grid, pills([['前日', '前日'], ['当日', '当日']], item['日区分'], value => set('日区分', value), '日区分'), pills([['当日進行', '当日進行'], ['ステージ進行', 'ステージ進行']], item.scope, value => set('scope', value, true), '進行の種類'), pills([['予定', '予定'], ['曲', '曲'], ['MC', 'MC'], ['転換', '転換'], ['その他', 'その他']], item['種別'], value => set('種別', value, true), '項目の種別'));
    if (isDay) row.append(field('時刻（未定なら空欄）', item['時刻'], value => set('時刻', value), 'time'));
    row.append(field(item['種別']==='曲'?'曲名':item['種別']==='MC'?'MCの内容':'内容', item['内容'], value=>set('内容',value),'textarea'));
    const place = field('場所（空欄は未定）', BandShared.timelinePlace(item, data.masters.places), value => {
      const stage = BandShared.readStage(item); stage.placeText = value; set('stageJSON', JSON.stringify(stage));
    });
    place.querySelector('input').maxLength = 200;
    place.querySelector('input').placeholder = '会場名・会場内の具体的な位置';
    row.append(place);
    const suggestions = el('details'); suggestions.append(el('summary', '場所の候補から入力'));
    suggestions.append(picker('入力補助', placeOptions(item['場所ID']), '', value => {
      const stage = BandShared.readStage(item); stage.placeText = data.masters.places.find(p => p['場所ID'] === value)?.['名称'] || '';
      set('stageJSON', JSON.stringify(stage), true);
    }, '未定'));
    row.append(suggestions);
    const people = el('section'); people.append(el('h3', '個人カードに表示する担当（複数選択可）'));
    const choices = [...active('guardians').map(person => [person['保護者ID'], `保護者：${person['表示名']}`]), ...sortedMembers().map(person => [person['子どもID'], `子ども：${person['氏名']}`])];
    const selected = teacherIds(item['担当']); const buttons = el('div', undefined, 'pills'); buttons.setAttribute('role', 'group'); buttons.setAttribute('aria-label', '進行項目の担当');
    buttons.append(guardianSelect('進行項目の担当を追加', choices.filter(([id]) => !selected.includes(id)), '', id => { if(id) set('担当', [...selected, id].join(','), true); }));
    selected.forEach(id => buttons.append(button(`${choices.find(([key])=>key===id)?.[1] || '旧担当'}を外す`, () => set('担当', selected.filter(key=>key!==id).join(','), true))));
    people.append(buttons, el('p', '名簿から選んだ担当の個人カードに表示します。自由入力の名前は個人カードに自動で結び付きません。', 'muted')); advanced.append(people);
    if (item.scope === 'ステージ進行') row.append(stageEditor(item, redraw, refreshOverview));
    advanced.append(field('担当の自由入力（保護者名など）', item['担当自由入力'], value => set('担当自由入力', value)), field('持ち物', item['持ち物'], value => set('持ち物', value)), field('注意点', item['注意点'], value => set('注意点', value), 'textarea'));
    row.append(advanced);return row;
  }
  function stageChoices() { return [...active('guardians').map(p=>[p['保護者ID'],p['表示名']]),...sortedMembers().map(p=>[p['子どもID'],p['氏名']])]; }
  function stageDisplay(item) {
    const stage=BandShared.readStage(item);const choices=stageChoices();const name=id=>choices.find(([key])=>key===id)?.[1] || '';
    return {id:item['項目ID'],day:item['日区分'],order:item['並び順'],kind:item['種別'],title:item['内容'],stage:{speakerNames:stage.speakers.map(name).filter(Boolean),prepareNames:stage.prepare.map(name).filter(Boolean),microphones:stage.microphones.map(m=>({label:m.label,fromName:name(m.from),toName:name(m.to)})),layoutId:stage.layoutId,changes:stage.changes}};
  }
  const stageDetailsOpen = new Map();
  function stageEditor(item, redraw, refreshOverview) {
    const box=el('section',undefined,'stage-editor');box.append(el('h3','演奏進行の担当・受け渡し'),el('p','未指定の欄も保存できます。','muted'));
    const stage=BandShared.readStage(item);const save=(redrawNow=false)=>{item.stageJSON=JSON.stringify(stage);mark('timelineItems',timelineKey(item));if(redrawNow)redraw();else refreshOverview();};const choices=stageChoices();
    function multi(label,key){const details=el('details');details.append(el('summary',`${label}：${stage[key].map(id=>choices.find(([p])=>p===id)?.[1] || '参照先を確認').join('・') || '未指定'}`));details.append(guardianSelect(label+'を追加',choices.filter(([id])=>!stage[key].includes(id)),'',id=>{if(id){stage[key].push(id);save(true);}}));stage[key].forEach(id=>details.append(button(`${choices.find(([p])=>p===id)?.[1] || '旧担当'}を外す`,()=>{stage[key]=stage[key].filter(p=>p!==id);save(true);})));return details;}

    const speakers=multi('話す担当（複数可）','speakers');if(item['種別']==='MC')box.append(speakers);box.append(multi('次の準備担当（複数可）','prepare'));
    const mics=el('div',undefined,'microphone-editor');mics.append(el('h4','マイクの受け渡し'));
    stage.microphones.forEach((mic,index)=>{const detail=el('details');detail.append(el('summary',`${index+1}. ${mic.label || '呼び名未指定'}：${choices.find(([id])=>id===mic.from)?.[1] || '渡す人未指定'} → ${choices.find(([id])=>id===mic.to)?.[1] || '受け取る人未指定'}`));detail.append(field('マイクの呼び名（任意）',mic.label,v=>{mic.label=v;save();}),guardianSelect('渡す人',choices,mic.from,v=>{mic.from=v;save(true);}),guardianSelect('受け取る人',choices,mic.to,v=>{mic.to=v;save(true);}),button('この受け渡しを削除',()=>{stage.microphones.splice(index,1);save(true);},undefined,'danger'));mics.append(detail);});
    mics.append(button('マイク受け渡しを追加',()=>{stage.microphones.push({label:'',from:'',to:''});save(true);}));if(item['種別']==='MC')box.append(mics);else{const optional=el('details');optional.append(el('summary','話す担当・マイク（必要な場合）'),speakers,mics);box.append(optional);}
    const changes=el('div');changes.append(picker('この曲の配置図',data.layouts.filter(l=>l.sessionId===item['予定ID'] && l.active!==false).map(l=>[l.id,l.name]),stage.layoutId,v=>{stage.layoutId=v;save();}),field('持替・配置変更（変更なしも入力可）',stage.changes,v=>{stage.changes=v;save();},'textarea'));if(item['種別']==='曲')box.append(changes);else{const optional=el('details');optional.append(el('summary','配置・持替（必要な場合）'),changes);box.append(optional);}box.querySelectorAll('details').forEach((detail,index)=>{const key=item['項目ID']+'-'+index;detail.open=stageDetailsOpen.get(key)||false;detail.addEventListener('toggle',()=>{if(detail.isConnected)stageDetailsOpen.set(key,detail.open);});});return box;
  }
  function renderReferences() {
    const panel = $('panel'); const references = data.references || {};
    const intro = el('section', undefined, 'card'); intro.append(el('h2', '当番ガイド'), el('p', '当番の手順や注意事項を編集します。元のスプレッドシートは初回取り込み時以外、変更しません。', 'muted')); panel.append(intro);
    if (references.status !== 'ready') { panel.append(referenceImportCard()); return; }
    panel.append(referenceGuideEditor(references.guide?.items || []), referenceBackup());
  }
  function referenceImportCard() {
    const card = el('section', undefined, 'card'); card.append(el('h2', '元の資料を取り込む'));
    card.append(el('p', '初回だけ、当番ガイドと年間本番一覧の内容をアプリ用DBへコピーします。取り込み後はガイド・本番画面で編集でき、元のシートはそのまま保管されます。'));
    card.append(button('元のスプレッドシートから取り込む', () => run(async () => { if (hasChanges()) throw new Error('未保存の変更があります。先に保存してから取り込んでください。'); await api.request('admin_import_references'); await load(); }, '元の資料を取り込みました。内容を確認・編集できます。'), undefined, 'primary'));
    return card;
  }
  function referenceGuideEditor(items) {
    const card = el('section', undefined, 'card'); card.append(el('h2', '当番ガイド'));
    card.append(el('p', '元の資料の行をすべて取り込んでいます。本文・見出し・手順を選んで編集してください。文章を空欄にして保存すると、その行は表示されなくなります。', 'muted'));
    const list = el('div');
    const draw = () => {
      list.replaceChildren();
      items.filter(item => item.active !== false).sort((a, b) => Number(a.order) - Number(b.order)).forEach(item => {
        const row = el('article', undefined, 'slot');
        const set = (key, value) => { item[key] = value; mark('guideItems', guideKey(item)); };
        row.append(pills([['本文', '本文'], ['見出し', '見出し'], ['手順', '手順']], item.type || '本文', value => { set('type', value); draw(); }, '項目の種類'));
        row.append(field('内容', item.content, value => set('content', value), 'textarea'));
        list.append(row);
      });
    };
    draw();
    card.append(list, button('項目を追加', () => { const item = { id: `GI-${crypto.randomUUID()}`, type: '手順', section: '追加', order: Math.max(0, ...items.map(row => Number(row.order) || 0)) + 1, content: '', active: true }; items.push(item); mark('guideItems', guideKey(item)); draw(); }));
    return card;
  }
  function referenceEventEditor(events) {
    const card = el('section', undefined, 'card'); card.append(el('h2', '年間本番候補'), el('p', '連絡先は管理者だけに保存・表示されます。実施が決まった本番は「日程作成」で当月の予定として追加します。', 'muted'));
    const list = el('div');
    const draw = () => {
      list.replaceChildren();
      events.filter(event => event.active !== false).sort((a, b) => Number(a.order) - Number(b.order)).forEach(event => {
        const details = document.createElement('details'); details.className = 'slot'; const summary = document.createElement('summary'); summary.textContent = `${event.month || '月未定'} · ${event.name || '本番名未入力'}　${event.schedule || ''}`; details.append(summary);
        const body = el('div'); const set = (key, value) => { event[key] = value; mark('annualEvents', annualEventKey(event)); };
        const fields = [['本番名', 'name'], ['月', 'month'], ['日程の目安', 'schedule'], ['場所', 'venue'], ['演奏時間', 'duration'], ['楽器運び', 'transport'], ['演奏できる楽器', 'instruments'], ['連絡先（管理者のみ）', 'contact'], ['事前打合せ', 'meeting']];
        const grid = el('div', undefined, 'grid'); fields.forEach(([label, key]) => grid.append(field(label, event[key], value => set(key, value)))); body.append(grid, field('その他・注意事項', event.notes, value => set('notes', value), 'textarea'));
        body.append(button('候補から外す', () => { event.active = false; mark('annualEvents', annualEventKey(event)); draw(); }, undefined, 'danger')); details.append(body); list.append(details);
      });
    };
    draw();
    card.append(list, button('本番候補を追加', () => { const event = { id: `AEC-${crypto.randomUUID()}`, order: Math.max(0, ...events.map(row => Number(row.order) || 0)) + 1, month: '', name: '', schedule: '', venue: '', duration: '', transport: '', instruments: '', contact: '', meeting: '', notes: '', active: true }; events.push(event); mark('annualEvents', annualEventKey(event)); draw(); }));
    return card;
  }
  function referenceBackup() {
    const card = el('section', undefined, 'card'); card.append(el('h2', '保存・バックアップ'));
    card.append(el('p', '「変更を保存」でアプリ用スプレッドシートへ履歴を残します。さらに現在の内容を1件のバックアップとして保存できます。', 'muted'));
    card.append(button('いまバックアップを作成', () => run(async () => { if (hasChanges()) throw new Error('未保存の変更があります。先に保存してからバックアップを作成してください。'); await api.request('admin_backup_references'); }, '現在のガイド・本番候補をバックアップしました。'))); return card;
  }
  function renderPublish() {
    if (!requireMonth()) return;
    const panel = $('panel'); const card = el('section', undefined, 'card'); card.append(el('h2', '公開前チェック'));
    const items = missing();
    if (items.length) { const list = el('ul', undefined, 'checklist error'); items.forEach(item => list.append(el('li', item))); card.append(list); }
    else card.append(el('p', sessions().length ? '先生・自主練の公開条件を満たしています。' : '公開する予定がありません。', sessions().length ? 'success' : 'warning'));
    if (hasChanges()) card.append(el('p', '未保存の変更があります。先に「変更を保存」を押してください。', 'warning'));
    card.append(el('p', '予定・当番・自主練情報を変更して保存すると、その予定は下書きに戻ります。保存だけでは公開されません。確認後に公開してください。', 'muted'));
    const publish = button(`${monthId}の予定を${currentMonth()['状態'] === '公開' ? '再公開' : '公開'}`, () => run(async () => { await api.request('admin_publish_month', { monthId }); await load(); }, '公開しました。下の共有画面に反映されています。'), undefined, 'primary'); publish.id = 'publish-month'; card.append(publish); panel.append(card);
    panel.append(el('h2', '現在の共有画面（公開済みのみ）')); const shared = el('div'); if (data.shared) BandShared.render(shared, data.shared, monthId); else shared.append(el('p', '最新の公開状態を確認できていません。変更を保存し直すか、再読み込みしてください。', 'warning')); panel.append(shared);
  }
  async function saveChanges() {
    if (sessionAddDraft) throw new Error('入力中の日程があります。「追加する」か「キャンセル」を選んでから保存してください。');
    if (hasPendingFamily()) throw new Error('入力中の家庭があります。名簿で「家庭を追加」を押して一覧に追加するか、入力をキャンセルしてから保存してください。');
    if (newMonthIds.has(monthId)) { await api.request('admin_create_month', { monthId, generateSaturdays: false, teacherDeadline: '', parentDeadline: deadlineDraft?.parentDeadline || '' }); newMonthIds.delete(monthId); monthDirty = false; }
    if (monthDirty) { await api.request('admin_save_month', { monthId, ...deadlineDraft }); monthDirty = false; }
    if (rosterDirty) { await api.request('admin_save_roster', { records: rosterDraft }); rosterDirty = false; }
    const actions = [
      ['instruments', 'admin_save_instruments', row => row['楽器ID'], rows => rows],
      ['teachers', 'admin_save_teachers', rosterKeys.teachers, rows => rows],
      ['sessions', 'admin_save_sessions', s => s['予定ID'], rows => rows],
      ['selfPractice', 'admin_save_selfpractice', s => s['予定ID'], rows => rows],
      ['dutyAssignments', 'admin_save_duty_assignments', dutyKey, rows => rows],
      ['events', 'admin_save_event', eventKey, rows => rows],
      ['layouts', 'admin_save_layouts', row => row.id, rows => rows],
      ['timelineItems', 'admin_save_timeline_items', timelineKey, rows => rows],
      ['guideItems', 'admin_save_guide_items', guideKey, rows => rows.map(item => ({ '項目ID': item.id, '種別': item.type, '区分': item.section, '並び順': item.order, '内容': item.content, '有効': item.active !== false && String(item.content || '').trim() !== '' }))],
      ['annualEvents', 'admin_save_annual_event_candidates', annualEventKey, rows => rows.map(event => ({ '候補ID': event.id, '並び順': event.order, '月': event.month, '本番名': event.name, '日程': event.schedule, '場所': event.venue, '演奏時間': event.duration, '楽器運び': event.transport, '演奏できる楽器': event.instruments, '連絡先': event.contact, '事前打ち合わせ': event.meeting, 'その他': event.notes, '有効': event.active !== false }))],
      ['teacherAvailability', 'admin_save_teacher_availability', availabilityKey, rows => rows.filter(r => {
        const s = data.sessions.find(s => s['予定ID'] === r['予定ID']); return slots(s).some(([, label]) => label === r['枠']);
      }).map(r => ({ teacherId: r['先生ID'], sessionId: r['予定ID'], slot: r['枠'], availability: r['可否'] }))]
    ];
    for (const [collection, action, key, transform] of actions) {
      if (!dirty[collection].size) continue;
      const source = collection === 'teachers' ? data.masters.teachers : collection === 'guideItems' ? (data.references?.guide?.items || []) : collection === 'annualEvents' ? (data.references?.annualEvents || []) : data[collection];
      const records = transform(source.filter(r => dirty[collection].has(key(r))));
      if (records.length) await api.request(action, { records });
      if (collection === 'sessions') records.forEach(row => { newSessionIds.delete(row['予定ID']); savedSessions.set(row['予定ID'], { ...row }); });
      if (collection === 'timelineItems') records.forEach(row => savedTimelinePlaces.set(row['項目ID'], row['場所ID'] || ''));
      dirty[collection].clear();
      if (collection === 'sessions' && ['month', 'plan', 'schedule'].includes(tab)) render();
    }
    // 保存と公開は別操作。保存後に最新の下書きを一度読み直す。
    await load();
  }
  $('go-publish').addEventListener('click', () => { tab = 'publish'; render(); });
  $('save').addEventListener('click', () => run(saveChanges, '下書きを保存しました。公開状況で確認してから公開してください。'));
  $('reload').addEventListener('click', () => { if (!hasChanges() || confirm('未保存の変更を破棄して再読み込みしますか？')) run(load, '最新の状態を読み込みました。'); });
  $('forget').addEventListener('click', () => { if (!hasChanges() || confirm('未保存の変更を破棄して認証を解除しますか？')) { api.forget(); data = undefined; $('panel').replaceChildren(); $('workspace').hidden = true; message('認証を解除しました。再度利用するには管理者の招待URLから開いてください。'); } });
  $('connect').addEventListener('click', () => run(async () => { api.configure($('api-url').value.trim()); await load(); }, '接続しました。'));
  window.addEventListener('beforeunload', e => { if (hasChanges()) { e.preventDefault(); e.returnValue = ''; } });
  if (!api.hasToken) message('管理者の招待URL（admin.html?a=…）から開いてください。', true);
  else if (!api.endpoint) { $('connection').hidden = false; message('初回の接続先を設定してください。'); }
  else run(load, '読み込みました。');
})();
