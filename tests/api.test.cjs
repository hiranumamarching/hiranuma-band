const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/api.js'), 'utf8');
function setup(search = '?a=DUMMY001') {
  const storage = new Map(); const requests = []; let replaced;
  const context = vm.createContext({ window: {}, URL, AbortController, setTimeout, clearTimeout,
    location: { href: `https://example.invalid/app/admin.html${search}` }, history: { replaceState: (a,b,url) => { replaced = url; } },
    localStorage: { getItem: key => storage.get(key), setItem: (key,value) => storage.set(key,value), removeItem: key => storage.delete(key) },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ ok: true, data: { sessions: [] } }) }; }
  });
  vm.runInContext(source, context);
  return { context, storage, requests, get replaced() { return replaced; }, create: role => context.window.BandAPI.create(role) };
}
test('管理者トークンをURLから除去して端末保存・再訪・認証解除', () => {
  const h=setup('?a=DUMMY001&view=month'); const api=h.create('a'); assert.equal(h.replaced,'/app/admin.html?view=month'); assert(api.hasToken); assert.equal(h.storage.get('hiranuma.app.token.a'),'DUMMY001');
  h.context.location.href='https://example.invalid/app/admin.html'; const again=h.create('a'); assert(again.hasToken); again.forget(); assert(!h.create('a').hasToken);
});
test('接続先をGASのexecだけに限定・トークンはPOST本文に送信', async () => {
  const h=setup(); const api=h.create('a');
  for(const url of ['https://example.invalid/macros/s/DUMMY/exec','http://script.google.com/macros/s/DUMMY/exec','https://script.google.com/macros/s/DUMMY/dev','https://script.google.com/macros/s/DUMMY/exec?a=DUMMY001']) assert.throws(()=>api.configure(url),/exec/);
  api.configure('https://script.google.com/macros/s/DUMMY/exec'); await api.request('admin_bootstrap',{a:'OVERRIDE'});
  const request=h.requests[0]; assert(!request.url.includes('DUMMY001')); assert.equal(request.options.method,'POST'); assert.equal(request.options.credentials,'omit'); assert.equal(JSON.parse(request.options.body).a,'DUMMY001'); assert.equal(request.options.headers['Content-Type'],'text/plain;charset=UTF-8');
});
test('トークンなしで通信しない・API拒否を呼び出し側に通知', async () => {
  const h=setup(''); const api=h.create('a'); api.configure('https://script.google.com/macros/s/DUMMY/exec'); await assert.rejects(api.request('admin_bootstrap'),/招待URL/); assert.equal(h.requests.length,0);
  h.context.location.href='https://example.invalid/app/admin.html?a=DUMMY001'; const authorized=h.create('a'); h.context.fetch=async()=>({ok:true,json:async()=>({ok:false,error:'unauthorized',message:'招待URLが無効です。'})}); await assert.rejects(authorized.request('admin_bootstrap'),error=>error.code==='unauthorized');
});
test('端末ストレージが禁止されても招待URLから今回の利用が可能', () => {
  const h=setup(); h.context.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}}; const api=h.create('a'); assert(api.hasToken); api.configure('https://script.google.com/macros/s/DUMMY/exec'); assert(api.endpoint);
});
