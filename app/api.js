/* 同じ招待URL方式を teacher.html / parent.html でも利用する。 */
'use strict';
window.BandAPI = (() => {
  const endpointKey = 'hiranuma.app.endpoint';
  // 手動デプロイ後、ここには公開可能な Web App URL のみ設定してよい。
  const defaultEndpoint = 'https://script.google.com/macros/s/AKfycbyHCjWCQTb6H61Sz4hAY4Luo83e5i3SR0wkmUPRdtI-3P2o-VzdBmovHv48pK-kZUVMYg/exec';
  function storageGet(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
  function storageSet(key, value) { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* 保存できない端末では今回の招待URLのみ利用 */ } }
  function validEndpoint(value) {
    try { const url = new URL(value); return url.origin === 'https://script.google.com' && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) && !url.search && !url.hash; } catch { return false; }
  }
  function create(role) {
    const key = `hiranuma.app.token.${role}`;
    const url = new URL(location.href);
    const incoming = url.searchParams.get(role);
    let token = incoming === null ? storageGet(key) : incoming;
    if (incoming !== null) {
      storageSet(key, token);
      // 招待URLを再起動後もそのまま使えるよう、全ロールのトークンをURLに残す。
    }
    let endpoint = storageGet(endpointKey) || defaultEndpoint;
    const inviteLabel = role === 'a' ? '管理者' : role === 't' ? '先生' : '保護者';
    let revision = null, pending = null;
    return {
      acceptRevision(value) { revision = value; pending = null; },
      get endpoint() { return endpoint; },
      get hasToken() { return Boolean(token); },
      configure(value) { if (!validEndpoint(value)) throw new Error('GAS Web App の /exec URL を指定してください。'); endpoint = value; storageSet(endpointKey, endpoint); },
      forget() { token = ''; storageSet(key, ''); },
      async request(action, payload = {}) {
        if (!token) throw new Error(`${inviteLabel}用の招待URLから開いてください。`);
        if (!validEndpoint(endpoint)) throw new Error('GAS Web App の接続先を設定してください。');
        const read = ['admin_export_backup','admin_bootstrap','teacher_bootstrap','parent_bootstrap','parent_card'].includes(action);
        const input = JSON.stringify({action, payload});
        if (!read && revision === null) throw new Error('最新の画面を読み込んでから保存してください。');
        if (!read && pending && pending.input !== input) { const e = new Error('前回の保存結果を先に確認してください。入力は保持しています。'); e.code = 'recovery_required'; throw e; }
        if (!read && !pending) pending = {input, expectedRevision: revision, requestId: crypto.randomUUID()};
        const metadata = read ? {} : {expectedRevision:pending.expectedRevision, requestId:pending.requestId};
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ ...payload, ...metadata, action, [role]: token }), credentials: 'omit', redirect: 'follow', signal: controller.signal });
          if (!response.ok) throw new Error('接続できません。GASのデプロイ設定を確認してください。');
          const result = await response.json();
          if (!result.ok) { const error = new Error(result.message || '処理に失敗しました。'); error.code = result.error; throw error; }
          if (result.data?._protocol !== 1 || typeof result.data._revision !== 'string') { const e = new Error('保存APIの競合保護が未更新です。管理者に確認してください。'); e.code='upgrade_required'; throw e; }
          if (!read) { revision = result.data._revision; pending = null; }
          else if (revision === null || (role !== 'a' && action.endsWith('_bootstrap'))) revision = result.data._revision;
          return result.data;
        } catch (error) {
          if (error.name === 'AbortError') throw new Error('応答を確認できませんでした。保存された可能性があります。再読み込みして状態を確認してください。');
          throw error;
        } finally { clearTimeout(timeout); }
      }
    };
  }
  return { create };
})();
