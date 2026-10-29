'use strict';
// Large, browser-local layout editor. Persisted layout records keep the v1 schema.
window.BandLayoutEditor = (() => {
  const selections = new Map(), histories = new Map();
  const el = (tag, text, name) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (name) n.className = name; return n; };
  const button = (text, action, name) => { const n = el('button', text, name); n.type = 'button'; n.addEventListener('click', action); return n; };
  function open({ layout, selectedId, onChange, onClose, save, isDirty }) {
    if (document.querySelector('.layout-editor-dialog')) return;
    document.activeElement?.blur();
    let selected = selectedId || selections.get(layout.id) || '', dragging = null, saving = false;
    const history = histories.get(layout.id) || []; histories.set(layout.id, history);
    const positions = () => layout.items.map(({ id, x, y }) => ({ id, x, y }));
    const restore = rows => rows.forEach(row => { const item = layout.items.find(i => i.id === row.id); if (item) Object.assign(item, { x: row.x, y: row.y }); });
    const record = before => { if (JSON.stringify(before) === JSON.stringify(positions())) return false; history.push(before); if (history.length > 50) history.shift(); onChange(); return true; };
    const dialog = el('dialog', undefined, 'layout-editor-dialog'); dialog.setAttribute('aria-label', '配置図を大きく編集');
    const frame = el('div', undefined, 'layout-editor-frame');
    const head = el('div', undefined, 'layout-editor-head'); const heading = el('h2', layout.name || '配置図');
    const close = button('閉じる', () => { if (!saving) dialog.close(); }); head.append(heading, close);
    const modes = el('div', undefined, 'layout-editor-modes'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '配置図の表示方式');
    const hint = el('p', '対象をタップして選択。選んだ対象だけをドラッグできます。', 'layout-editor-hint');
    const board = el('div', undefined, 'layout-edit-board'); board.setAttribute('role', 'group'); board.setAttribute('aria-label', '配置図。下が客席側');
    const controls = el('div', undefined, 'layout-editor-controls');
    const selection = el('p', '', 'layout-editor-selection'); selection.setAttribute('aria-live', 'polite');
    const moves = el('div', undefined, 'layout-editor-moves'); moves.setAttribute('role', 'group'); moves.setAttribute('aria-label', '選択した対象を1ずつ微調整');
    const footer = el('div', undefined, 'layout-editor-footer'); const status = el('span', '', 'layout-editor-state'); status.setAttribute('role', 'status');
    const undo = button('元に戻す', () => { if (!history.length || saving) return; cancelDrag(); restore(history.pop()); onChange(); paint(); refresh(); });
    const saveButton = button('配置を保存', async () => {
      if (saving || !isDirty()) return;
      cancelDrag(); saving = true; refresh();
      try { await save(); status.textContent = '保存済み'; }
      catch (error) { status.textContent = error.message || '保存できませんでした。もう一度お試しください。'; status.classList.add('error'); }
      finally { saving = false; refresh(false); }
    }, 'primary');
    footer.append(status, undo, saveButton); controls.append(selection, moves); frame.append(head, modes, hint, board, controls, footer); dialog.append(frame); document.body.append(dialog);
    function current() { return layout.items.find(i => i.id === selected); }
    function refresh(state = true) {
      const item = current(); selection.textContent = item ? `選択：${item.label}` : '図の中から対象を選んでください';
      moves.querySelectorAll('button').forEach(n => n.disabled = !item || saving);
      undo.disabled = !history.length || saving; saveButton.disabled = !isDirty() || saving; close.disabled = saving;
      modes.querySelectorAll('button').forEach(n => n.disabled = saving);
      if (state) { status.classList.remove('error'); status.textContent = saving ? '保存中…' : isDirty() ? '未保存の変更あり' : '保存済み'; }
      board.classList.toggle('is-saving', saving);
    }
    function cancelDrag() { if (!dragging) return; const prior = dragging; dragging = null; if (prior.started) restore(prior.before); paint(); }
    function bounds(item) {
      const n = board.querySelector(`[data-layout-item="${CSS.escape(item.id)}"]`);
      const halfX = n ? n.offsetWidth / Math.max(board.clientWidth, 1) * 50 + 1 : 5;
      const halfY = n ? n.offsetHeight / Math.max(board.clientHeight, 1) * 50 + 1 : 5;
      return { minX: Math.max(5, halfX), maxX: Math.min(95, 100 - halfX), minY: Math.max(5, halfY), maxY: Math.min(90, 100 - halfY - 5) };
    }
    function move(dx, dy) {
      const item = current(); if (!item) return;
      const pair = BandShared.layoutModel.mode(layout) === 'combined' && item.kind === 'person' ? BandShared.layoutModel.pairedInstrument(layout, item.id) : null;
      const group = pair ? [item, pair] : [item];
      // Movement uses the unchanged v1 coordinate limits. Visual label padding is
      // handled by paint(), so a wide, separately positioned pair cannot create
      // an impossible intersection or push its hidden instrument out of range.
      dx = Math.max(Math.max(...group.map(row => 5 - row.x)), Math.min(dx, Math.min(...group.map(row => 95 - row.x))));
      dy = Math.max(Math.max(...group.map(row => 5 - row.y)), Math.min(dy, Math.min(...group.map(row => 90 - row.y))));
      group.forEach(row => { row.x = Math.round((row.x + dx) * 100) / 100; row.y = Math.round((row.y + dy) * 100) / 100; }); paint();
    }
    [['←', '左へ微調整', -1, 0], ['↑', '奥へ微調整', 0, -1], ['↓', '手前へ微調整', 0, 1], ['→', '右へ微調整', 1, 0]].forEach(([label, name, dx, dy]) => {
      const n = button(label, () => { if (!current() || saving) return; const before = positions(); move(dx, dy); record(before); refresh(); }); n.setAttribute('aria-label', name); moves.append(n);
    });
    function paint() {
      board.querySelectorAll('[data-layout-item]').forEach(n => {
        const item = layout.items.find(i => i.id === n.dataset.layoutItem); if (!item) return;
        const b = bounds(item); n.style.left = `${Math.max(b.minX, Math.min(b.maxX, item.x))}%`; n.style.top = `${Math.max(b.minY, Math.min(b.maxY, item.y))}%`;
        n.classList.toggle('is-selected', item.id === selected); n.setAttribute('aria-pressed', String(item.id === selected));
      });
    }
    function select(id) { selected = id; selections.set(layout.id, id); paint(); refresh(); }
    function draw() {
      cancelDrag();
      const mode = BandShared.layoutModel.mode(layout); const item = current();
      if (mode === 'combined' && item && BandShared.layoutModel.pairedPerson(layout, item)) selected = BandShared.layoutModel.pairedPerson(layout, item).id;
      if (!current()) selected = '';
      selections.set(layout.id, selected); modes.replaceChildren();
      [['separate', '人・楽器を別々'], ['combined', '名前＋担当楽器']].forEach(([id, label]) => {
        const n = button(label, () => { BandShared.layoutModel.setMode(layout, id); draw(); }); n.setAttribute('aria-pressed', String(id === mode)); modes.append(n);
      });
      board.replaceChildren(el('span', '客席側 ↓', 'layout-edit-audience'));
      layout.items.filter(i => mode !== 'combined' || !BandShared.layoutModel.pairedPerson(layout, i)).forEach(item => {
        const node = el('button', undefined, `layout-edit-item ${item.kind === 'person' ? 'is-person' : 'is-instrument'}`); node.type = 'button'; node.dataset.layoutItem = item.id;
        node.append(el('span', item.label));
        const paired = mode === 'combined' && item.kind === 'person'; const instrument = paired && BandShared.layoutModel.pairedInstrument(layout, item.id);
        if (paired) node.append(el('small', instrument?.label || '担当楽器未設定'));
        node.setAttribute('aria-label', `${item.label}${paired ? `／${instrument?.label || '担当楽器未設定'}` : ''}`);
        node.addEventListener('click', event => { if (event.detail === 0 && !saving) select(item.id); });
        node.addEventListener('keydown', event => {
          const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!delta || selected !== item.id || saving) return; event.preventDefault(); const before = positions(); move(...delta); record(before); refresh();
        });
        node.addEventListener('pointerdown', event => {
          if (saving || !event.isPrimary || event.button !== 0 || dragging) return;
          dragging = { pointerId: event.pointerId, id: item.id, eligible: selected === item.id, startX: event.clientX, startY: event.clientY, before: positions(), started: false };
          node.setPointerCapture(event.pointerId);
        });
        node.addEventListener('pointermove', event => {
          if (!dragging || dragging.pointerId !== event.pointerId) return;
          const dx = event.clientX - dragging.startX, dy = event.clientY - dragging.startY;
          if (!dragging.eligible || Math.hypot(dx, dy) < 6 && !dragging.started) return;
          event.preventDefault(); dragging.started = true; restore(dragging.before);
          move(dx / board.clientWidth * 100, dy / board.clientHeight * 100);
        });
        node.addEventListener('pointerup', event => {
          if (!dragging || dragging.pointerId !== event.pointerId) return;
          const prior = dragging; dragging = null;
          if (prior.started) { record(prior.before); refresh(); }
          else if (Math.hypot(event.clientX - prior.startX, event.clientY - prior.startY) < 6) select(item.id);
        });
        node.addEventListener('pointercancel', cancelDrag); node.addEventListener('lostpointercapture', () => { if (dragging?.id === item.id) cancelDrag(); });
        board.append(node);
      });
      if (!layout.items.length) board.append(el('p', '配置する人・楽器を前の画面で追加してください。', 'layout-editor-empty'));
      paint(); refresh();
    }
    const viewport = () => { const v = window.visualViewport; dialog.style.setProperty('--editor-height', `${v?.height || window.innerHeight}px`); dialog.style.setProperty('--editor-top', `${v?.offsetTop || 0}px`); paint(); };
    const observer = new ResizeObserver(paint); observer.observe(board);
    const scrollY = window.scrollY, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      cancelDrag(); observer.disconnect(); window.visualViewport?.removeEventListener('resize', viewport); window.visualViewport?.removeEventListener('scroll', viewport); window.removeEventListener('resize', viewport);
      document.body.style.overflow = previousOverflow; dialog.remove(); window.scrollTo(0, scrollY); onClose(selected);
    }, { once: true });
    window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport); window.addEventListener('resize', viewport);
    dialog.showModal(); viewport(); draw(); close.focus({ preventScroll: true });
  }
  return { open };
})();
