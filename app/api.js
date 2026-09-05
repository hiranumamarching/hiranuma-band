/* 同じ招待URL方式を teacher.html / parent.html でも利用する。 */
'use strict';
window.BandAPI = (() => {
  const endpointKey = 'hiranuma.app.endpoint';
  // 手動デプロイ後、ここには公開可能な Web App URL のみ設定してよい。
  const defaultEndpoint = '';
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
      url.searchParams.delete(role);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    let endpoint = storageGet(endpointKey) || defaultEndpoint;
    return {
      get endpoint() { return endpoint; },
      get hasToken() { return Boolean(token); },
      configure(value) { if (!validEndpoint(value)) throw new Error('GAS Web App の /exec URL を指定してください。'); endpoint = value; storageSet(endpointKey, endpoint); },
      forget() { token = ''; storageSet(key, ''); },
      async request(action, payload = {}) {
        if (!token) throw new Error('管理者の招待URL（admin.html?a=…）から開いてください。');
        if (!validEndpoint(endpoint)) throw new Error('GAS Web App の接続先を設定してください。');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ ...payload, action, [role]: token }), credentials: 'omit', redirect: 'follow', signal: controller.signal });
          if (!response.ok) throw new Error('接続できません。GASのデプロイ設定を確認してください。');
          const result = await response.json();
          if (!result.ok) { const error = new Error(result.message || '処理に失敗しました。'); error.code = result.error; throw error; }
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
