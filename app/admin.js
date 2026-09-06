'use strict';
(() => {
  const api = BandAPI.create('a');
  const $ = id => document.getElementById(id);
  const bool = v => v === true || v === 'true' || v === 1 || v === '1' || v === '○';
  const roles = ['搬入出', '引率', '転換', '受付', '撮影', '見守り'];
  const tabs = [['month', '月設定'], ['schedule', '先生・予定'], ['duty', '集計・当番'], ['publish', '公開確認']];
  const dirty = { sessions: new Set(), selfPractice: new Set(), dutyAssignments: new Set(), teacherAvailability: new Set() };
  const today = new Date();
  let monthId = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  let tab = 'month', data, busy = false, monthDirty = false, deadlineDraft;
  const dutyKey = r => [r['予定ID'], r['役割'], r['区分']].join('|');
  const availabilityKey = r => [r['先生ID'], r['予定ID'], r['枠']].join('|');
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
  const sessions = () => data.sessions.filter(s => monthKey(s['月ID']) === monthKey(monthId)).sort((a, b) => a['日付'].localeCompare(b['日付']));
  const active = name => data.masters[name].filter(r => bool(r['在籍']));
  const hasChanges = () => monthDirty || Object.values(dirty).some(set => set.size);
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
    for (const [id, name] of options) wrap.append(button(name, () => change(id), value === id)); return wrap;
  }
  function picker(label, options, value, change) {
    const wrap = el('div'); wrap.append(el('h3', label));
    const list = pills([['', '未設定'], ...options], value || '', change, label);
    if (options.length > 8) wrap.append(field(`${label}を絞り込み`, '', q => { for (const b of list.children) b.hidden = Boolean(q) && !b.textContent.includes(q) && b.textContent !== '未設定'; }, 'search'));
    wrap.append(list); return wrap;
  }
  function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; $('message').setAttribute('role', error ? 'alert' : 'status'); }
  function mark(collection, key) { dirty[collection].add(key); updateSaveState(); }
  function updateSaveState() {
    $('save-state').textContent = hasChanges() ? '未保存の変更あり' : '保存済み';
    $('save').disabled = busy || !hasChanges();
    const publish = $('publish-month'); if (publish) publish.disabled = busy || hasChanges() || !data.shared || !sessions().length || missing().length > 0;
  }
  async function run(task, success) {
    if (busy) return;
    busy = true; $('workspace').disabled = true; $('connect').disabled = true;
    message('処理中です…');
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
    const next = await api.request('admin_bootstrap'); data = next;
    Object.values(dirty).forEach(set => set.clear()); monthDirty = false; deadlineDraft = undefined;
    $('connection').hidden = true; $('workspace').hidden = false; render();
  }
  function render() {
    $('month-title').textContent = `${monthId.replace('-', '年')}月 · ${currentMonth()?.['状態'] || '未作成'}`;
    $('tabs').replaceChildren(...tabs.map(([id, label]) => {
      const b = button(label, () => { tab = id; render(); }, tab === id); b.setAttribute('aria-controls', 'panel'); return b;
    }));
    $('panel').replaceChildren();
    ({ month: renderMonth, schedule: renderSchedule, duty: renderDuty, publish: renderPublish })[tab]();
    updateSaveState();
  }
  function switchMonth(next) {
    if (next === monthId) return;
    if (hasChanges()) { message('月を切り替える前に「変更を保存」を押してください。破棄する場合は再読み込みしてください。', true); return; }
    monthId = next; deadlineDraft = undefined; render();
  }
  function renderMonth() {
    const panel = $('panel'); const card = el('section', undefined, 'card'); card.append(el('h2', '対象月'));
    const year = Number(monthId.slice(0, 4));
    const yearRow = el('div', undefined, 'row');
    yearRow.append(button('前年', () => switchMonth(`${Math.max(2000, year - 1)}-${monthId.slice(5)}`)));
    yearRow.append(pills([year - 1, year, year + 1].filter(y => y >= 2000 && y <= 2099).map(y => [String(y), `${y}年`]), String(year), y => switchMonth(`${y}-${monthId.slice(5)}`), '年'));
    yearRow.append(button('翌年', () => switchMonth(`${Math.min(2099, year + 1)}-${monthId.slice(5)}`))); card.append(yearRow);
    const months = pills(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, '0'), `${i + 1}月`]), monthId.slice(5), m => switchMonth(`${year}-${m}`), '月'); months.className = 'months'; card.append(months);
    const month = currentMonth();
    if (!deadlineDraft) deadlineDraft = { parentDeadline: month?.['保護者入力締切'] || '' };
    const deadlines = el('div', undefined, 'grid');
    deadlines.append(field('保護者入力締切（任意）', deadlineDraft.parentDeadline, v => { deadlineDraft.parentDeadline = v; monthDirty = Boolean(month); updateSaveState(); }, 'date'));
    card.append(deadlines, el('p', '先生の入力締切はありません。保護者の締切だけ必要に応じて設定できます。', 'muted'));
    if (!month) {
      let copy = true; card.append(check('前月の集合・開始・終了・解散時間を引き継ぐ', true, v => { copy = v; }));
      card.append(button('土曜日の候補を作成', () => run(async () => {
        const prior = new Date(year, Number(monthId.slice(5)) - 2, 1);
        const copyFromMonthId = copy ? `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}` : '';
        await api.request('admin_create_month', { monthId, copyFromMonthId, teacherDeadline: '', ...deadlineDraft }); tab = 'schedule'; await load();
      }, '土曜日の候補を作成しました。'), undefined, 'primary'));
    } else card.append(el('p', `${sessions().length}件の候補があります。締切の変更は上部の「変更を保存」で保存します。`));
    panel.append(card);
  }
  function requireMonth() {
    if (currentMonth()) return true;
    $('panel').append(el('p', '「月設定」で対象月を作成してください。')); return false;
  }
  function slots(s) { return s['種別'] === '本番' ? [['am', '終日']] : [['am', '午前'], ['pm', '午後']]; }
  function renderSchedule() {
    if (!requireMonth()) return;
    const panel = $('panel'); panel.append(el('p', '午前・午後を別々に設定します。可否のボタンを押すと管理者による代理入力ができ、○の先生から各枠1名または2名を選べます。', 'muted'), placeMaster());
    for (const s of sessions()) panel.append(sessionCard(s));
    panel.append(button('日付を指定して予定追加', () => {
      const s = { '予定ID': `S${crypto.randomUUID()}`, '月ID': monthId, '日付': `${monthId}-01`, '種別': '通常練習', '実施有無_am': '実施', staffing_am: '未定', '担当先生ID_am': '', '実施有無_pm': '実施', staffing_pm: '未定', '担当先生ID_pm': '', ...practiceTimes({}), '場所ID': data.masters.places[0]?.['場所ID'] || '', '確定状態': '下書き', '備考': '' };
      data.sessions.push(s); mark('sessions', s['予定ID']); render(); document.getElementById(s['予定ID']).scrollIntoView({ block: 'start' });
    }));
  }
  function placeMaster() {
    const card = el('section', undefined, 'card'); card.append(el('h2', '場所マスター'), el('p', '平沼小学校以外の場所が必要なときだけ追加します。', 'muted'));
    card.append(pills(data.masters.places.map(place => [place['場所ID'], place['名称']]), '', () => {}, '登録済みの場所'));
    const row = el('div', undefined, 'row'); const input = document.createElement('input'); input.type = 'text'; input.placeholder = '例：西公会堂'; input.maxLength = 80;
    row.append(input, button('場所を追加', () => run(async () => {
      const result = await api.request('admin_save_place', { name: input.value }); data.masters.places.push(result.place); render();
    }, '場所を追加しました。'))); card.append(row); return card;
  }
  function sessionCard(s) {
    const card = el('article', undefined, 'card'); card.id = s['予定ID'];
    const set = (key, value, redraw = false) => { s[key] = value; mark('sessions', s['予定ID']); if (redraw) card.replaceWith(sessionCard(s)); };
    const head = el('div', undefined, 'row'); head.append(el('h2', s['日付']), el('span', dirty.sessions.has(s['予定ID']) ? '編集中' : s['確定状態'], 'badge'));
    head.append(button('候補から削除', () => {
      if (!confirm(`${s['日付']}を候補から削除しますか？公開中の場合は共有画面からも消えます。履歴は残ります。`)) return;
      if (hasChanges()) { message('削除前に変更を保存してください。新規予定を取り消す場合は再読み込みで破棄できます。', true); return; }
      run(async () => { await api.request('admin_delete_session', { sessionId: s['予定ID'] }); await load(); }, '予定を削除しました。');
    }, undefined, 'danger')); card.append(head);
    card.append(field('日付', s['日付'], v => set('日付', v), 'date'));
    card.append(pills(['通常練習', '自主練', '本番', 'その他'].map(v => [v, v]), s['種別'], v => {
      s['種別'] = v;
      if (v === '本番') { s.staffing_pm = ''; s['担当先生ID_pm'] = ''; }
      else if (!s.staffing_pm) s.staffing_pm = '未定';
      set('種別', v, true);
    }, '予定の種別'));
    const times = el('div', undefined, 'grid'); for (const key of ['集合', '開始', '終了', '解散']) times.append(field(key, s[key], v => set(key, v), 'time')); card.append(times);
    card.append(picker('場所', data.masters.places.map(p => [p['場所ID'], p['名称']]), s['場所ID'], v => set('場所ID', v, true)));
    card.append(availabilityTable(s, () => card.replaceWith(sessionCard(s))));
    for (const [slot, label] of slots(s)) {
      const block = el('section', undefined, 'slot'); block.append(el('h3', `${label}の指導体制`));
      block.append(pills([['実施', '実施する'], ['なし', '実施しない']], s[`実施有無_${slot}`] || '実施', v => {
        s[`実施有無_${slot}`] = v;
        if (v === 'なし') { s[`staffing_${slot}`] = ''; s[`担当先生ID_${slot}`] = ''; }
        else if (!s[`staffing_${slot}`]) s[`staffing_${slot}`] = '先生あり';
        Object.assign(s, practiceTimes(s));
        mark('sessions', s['予定ID']); card.replaceWith(sessionCard(s));
      }, `${label}の実施有無`));
      if ((s[`実施有無_${slot}`] || '実施') === 'なし') { block.append(el('p', 'この枠は練習を実施しません。先生・保護者の入力対象外です。', 'muted')); card.append(block); continue; }
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
    const caption = el('caption', '先生の可否（押して代理入力）'); table.append(caption);
    const availableSlots = slots(s).filter(([slot]) => (s[`実施有無_${slot}`] || '実施') !== 'なし');
    if (!availableSlots.length) return el('p', '実施する枠がないため、先生の可否はありません。', 'muted');
    const head = el('tr'); head.append(el('th', '先生')); availableSlots.forEach(([, label]) => head.append(el('th', label))); const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    for (const teacher of active('teachers')) {
      const tr = el('tr'); tr.append(el('th', teacher['氏名']));
      for (const [, label] of availableSlots) {
        let row = data.teacherAvailability.find(r => r['予定ID'] === s['予定ID'] && r['先生ID'] === teacher['先生ID'] && r['枠'] === label);
        const td = el('td'); const b = button(row?.['可否'] || '未入力', () => {
          const options = ['', '○', '×']; const value = options[(options.indexOf(row?.['可否'] || '') + 1) % options.length];
          if (!row) { row = { '予定ID': s['予定ID'], '先生ID': teacher['先生ID'], '枠': label }; data.teacherAvailability.push(row); }
          row['可否'] = value; mark('teacherAvailability', availabilityKey(row)); redraw();
        }); b.setAttribute('aria-label', `${teacher['氏名']}・${label}：${row?.['可否'] || '未入力'}（押して変更）`); td.append(b); tr.append(td);
      }
      body.append(tr);
    }
    table.append(body); wrap.append(table); return wrap;
  }
  function isSelfPractice(s) { return s.staffing_am === '自主練' || (s['種別'] !== '本番' && s.staffing_pm === '自主練'); }
  function missingFor(s) {
    if (!isSelfPractice(s)) return [];
    const checklist = data.selfPractice.find(r => r['予定ID'] === s['予定ID']) || {};
    const valid = new Set(active('guardians').map(g => g['保護者ID'])); const missing = [];
    const duties = new Set(data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID'] && valid.has(d['保護者ID'])).map(d => d['保護者ID']));
    if (duties.size < 2) missing.push('当番2名以上');
    for (const key of ['鍵の担当', '中止判断者']) if (!valid.has(checklist[key])) missing.push(key);
    if (!String(checklist['緊急連絡先'] || '').trim()) missing.push('緊急連絡先'); return missing;
  }
  function missing() { return sessions().flatMap(s => missingFor(s).map(key => `${s['日付']}：${key}`)); }
  function selfPracticeForm(s) {
    let row = data.selfPractice.find(r => r['予定ID'] === s['予定ID']);
    if (!row) { row = { '予定ID': s['予定ID'] }; data.selfPractice.push(row); }
    const wrap = el('section', undefined, 'slot'); wrap.append(el('h3', '自主練チェックリスト（日単位）'));
    const status = el('p', undefined, 'status-line');
    const refresh = () => { const items = missingFor(s); status.textContent = items.length ? `未設定：${items.join('、')}` : '公開に必要な4条件を満たしています。'; status.className = items.length ? 'warning' : 'success'; updateSaveState(); };
    const set = (key, value) => { row[key] = value; mark('selfPractice', s['予定ID']); refresh(); };
    const guardians = active('guardians').map(g => [g['保護者ID'], g['表示名']]);
    for (const key of ['鍵の担当', '中止判断者']) {
      let pick; const draw = () => picker(key, guardians, row[key], v => { set(key, v); const next = draw(); pick.replaceWith(next); pick = next; }); pick = draw(); wrap.append(pick);
    }
    wrap.append(field('緊急連絡先（管理者のみ表示）', row['緊急連絡先'], v => set('緊急連絡先', v)), check('施設使用申請済（確認用・公開の必須条件には含めない）', row['施設使用申請済'], v => set('施設使用申請済', v)), field('実施報告（管理者のみ表示）', row['実施報告'], v => set('実施報告', v), 'textarea'), status);
    wrap.append(button('集計・当番で2名を割り当てる', () => { tab = 'duty'; render(); })); refresh(); return wrap;
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
        answered += members.filter(m => data.attendance.some(a => a['予定ID'] === s['予定ID'] && a['子どもID'] === m['子どもID'])).length;
        if (representative && data.dutyOffers.some(d => d['予定ID'] === s['予定ID'] && d['保護者ID'] === representative['保護者ID'])) answered++;
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
    card.append(el('p', `出席予定：午前${attendance.filter(a => bool(a['午前'])).length}名 ／ 午後${attendance.filter(a => bool(a['午後'])).length}名`));
    const available = active('guardians').filter(g => data.dutyOffers.some(d => d['予定ID'] === s['予定ID'] && d['保護者ID'] === g['保護者ID'] && bool(d['可否'])));
    card.append(el('p', `当番可：${available.map(g => g['表示名']).join('、') || 'まだいません'}`));
    const notes = el('details'); notes.append(el('summary', '家庭からの連絡事項（管理者のみ）'));
    for (const a of attendance.filter(a => a['連絡事項'])) { const member = data.masters.members.find(m => m['子どもID'] === a['子どもID']); notes.append(el('p', `${member?.['氏名'] || '退籍メンバー'}：${a['連絡事項']}`, 'note')); }
    for (const d of data.dutyOffers.filter(d => d['予定ID'] === s['予定ID'] && d['メモ'])) { const guardian = data.masters.guardians.find(g => g['保護者ID'] === d['保護者ID']); notes.append(el('p', `${guardian?.['表示名'] || '退籍保護者'}：${d['メモ']}`, 'note')); }
    card.append(notes);
    const allRoles = [...new Set([...roles, ...data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID']).map(d => d['役割'])])];
    const rolePicker = el('div'); let role = '見守り';
    const renderRole = () => {
      rolePicker.replaceChildren(pills(allRoles.map(r => [r, r]), role, r => { role = r; renderRole(); }, '当番の役割'));
      const options = active('guardians').map(g => [g['保護者ID'], `${g['表示名']}${available.includes(g) ? '（可）' : '（要確認）'}`]);
      const roleAssignments = data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID'] && d['役割'] === role && d['保護者ID']);
      rolePicker.append(picker('担当を追加', options, '', value => {
        if (!value || roleAssignments.some(d => d['保護者ID'] === value)) return;
        const assignment = { '予定ID': s['予定ID'], '役割': role, '区分': `A-${crypto.randomUUID()}`, '保護者ID': value };
        data.dutyAssignments.push(assignment); mark('dutyAssignments', dutyKey(assignment)); renderRole();
      }));
      for (const assignment of roleAssignments) {
        const guardian = data.masters.guardians.find(g => g['保護者ID'] === assignment['保護者ID']);
        const row = el('div', undefined, 'row'); row.append(el('span', guardian?.['表示名'] || '退籍保護者'), button('外す', () => { assignment['保護者ID'] = ''; mark('dutyAssignments', dutyKey(assignment)); renderRole(); }, undefined, 'danger')); rolePicker.append(row);
      }
      const assigned = data.dutyAssignments.filter(d => d['予定ID'] === s['予定ID'] && d['保護者ID']);
      const assignedByRole = Object.entries(assigned.reduce((result, assignment) => { (result[assignment['役割']] ||= []).push(data.masters.guardians.find(g => g['保護者ID'] === assignment['保護者ID'])?.['表示名'] || '退籍保護者'); return result; }, {}));
      rolePicker.append(el('p', `割当一覧：${assignedByRole.map(([name, names]) => `${name}：${names.join('、')}`).join(' ／ ') || '未設定'}`));
      if (isSelfPractice(s)) rolePicker.append(el('p', missingFor(s).length ? `自主練の不足：${missingFor(s).join('、')}` : '自主練の公開条件を満たしています。', missingFor(s).length ? 'warning' : 'success'));
    };
    renderRole(); card.append(rolePicker); return card;
  }
  function renderPublish() {
    if (!requireMonth()) return;
    const panel = $('panel'); const card = el('section', undefined, 'card'); card.append(el('h2', '公開前チェック'));
    const items = missing();
    if (items.length) { const list = el('ul', undefined, 'checklist error'); items.forEach(item => list.append(el('li', item))); card.append(list); }
    else card.append(el('p', sessions().length ? '自主練の公開条件を満たしています。' : '公開する予定がありません。', sessions().length ? 'success' : 'warning'));
    if (hasChanges()) card.append(el('p', '未保存の変更があります。先に「変更を保存」を押してください。', 'warning'));
    card.append(el('p', '予定・当番・自主練情報を変更して保存すると、その予定は下書きに戻ります。公開ボタンで再び共有できます。', 'muted'));
    const publish = button(`${monthId}の予定を${currentMonth()['状態'] === '公開' ? '再公開' : '公開'}`, () => run(async () => { await api.request('admin_publish_month', { monthId }); await load(); }, '公開しました。下の共有画面に反映されています。'), undefined, 'primary'); publish.id = 'publish-month'; card.append(publish); panel.append(card);
    panel.append(el('h2', '現在の共有画面（公開済みのみ）')); const shared = el('div'); if (data.shared) BandShared.render(shared, data.shared, monthId); else shared.append(el('p', '最新の公開状態を確認できていません。変更を保存し直すか、再読み込みしてください。', 'warning')); panel.append(shared);
  }
  async function saveChanges() {
    if (monthDirty) { await api.request('admin_save_month', { monthId, ...deadlineDraft }); monthDirty = false; }
    const actions = [
      ['sessions', 'admin_save_sessions', s => s['予定ID'], rows => rows],
      ['selfPractice', 'admin_save_selfpractice', s => s['予定ID'], rows => rows],
      ['dutyAssignments', 'admin_save_duty_assignments', dutyKey, rows => rows],
      ['teacherAvailability', 'admin_save_teacher_availability', availabilityKey, rows => rows.filter(r => {
        const s = data.sessions.find(s => s['予定ID'] === r['予定ID']); return slots(s).some(([, label]) => label === r['枠']);
      }).map(r => ({ teacherId: r['先生ID'], sessionId: r['予定ID'], slot: r['枠'], availability: r['可否'] }))]
    ];
    for (const [collection, action, key, transform] of actions) {
      if (!dirty[collection].size) continue;
      const records = transform(data[collection].filter(r => dirty[collection].has(key(r))));
      if (records.length) await api.request(action, { records }); dirty[collection].clear();
    }
    await load();
  }
  $('save').addEventListener('click', () => run(saveChanges, '変更を保存しました。公開確認タブで公開できます。'));
  $('reload').addEventListener('click', () => { if (!hasChanges() || confirm('未保存の変更を破棄して再読み込みしますか？')) run(load, '最新の状態を読み込みました。'); });
  $('forget').addEventListener('click', () => { if (!hasChanges() || confirm('未保存の変更を破棄して認証を解除しますか？')) { api.forget(); data = undefined; $('panel').replaceChildren(); $('workspace').hidden = true; message('認証を解除しました。再度利用するには管理者の招待URLから開いてください。'); } });
  $('connect').addEventListener('click', () => run(async () => { api.configure($('api-url').value.trim()); await load(); }, '接続しました。'));
  window.addEventListener('beforeunload', e => { if (hasChanges()) { e.preventDefault(); e.returnValue = ''; } });
  if (!api.hasToken) message('管理者の招待URL（admin.html?a=…）から開いてください。', true);
  else if (!api.endpoint) { $('connection').hidden = false; message('初回の接続先を設定してください。'); }
  else run(load, '読み込みました。');
})();
