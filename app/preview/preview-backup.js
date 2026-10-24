/* Local backup only. Never uploads or connects to GAS. */
(function(root){
'use strict';
const KEY='hiranuma.preview.20261024.v1',LIMIT=20*1024*1024;
const fail=message=>{throw new Error(message);};
function validate(raw){
 if(typeof raw!=='string'||raw.length>LIMIT)fail('バックアップが大きすぎるか形式が不正です。');
 let data;try{data=JSON.parse(raw);}catch(_){fail('JSONを読み取れません。');}
 if(data?.version!==1||!Array.isArray(data.sheets)||!Array.isArray(data.properties))fail('未対応の保存形式です。');
 const names=new Set();
 for(const entry of data.sheets){
  if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'||!Array.isArray(entry[1])||names.has(entry[0]))fail('シート構成が不正です。');
  names.add(entry[0]);const rows=entry[1],headers=rows[0];
  if(!Array.isArray(headers)||!headers.length||headers.some(h=>typeof h!=='string'||['__proto__','constructor','prototype'].includes(h))||new Set(headers).size!==headers.length)fail('列の形式が不正です。');
  if(rows.some(row=>!Array.isArray(row)||row.length>headers.length||row.some(v=>v!==null&&!['string','number','boolean'].includes(typeof v))))fail('行の形式が不正です。');
 }
 for(const name of ['m_households','m_guardians','m_members','sessions','events','event_layouts','timeline_items'])if(!names.has(name))fail('必要なシートがありません。');
 if(data.properties.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='string')))fail('設定の形式が不正です。');
 return data;
}
async function digest(raw){return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),v=>v.toString(16).padStart(2,'0')).join('');}
async function exportBackup(storage){const payload=storage.getItem(KEY);if(!payload)fail('保存済みデータがありません。先に変更を保存してください。');validate(payload);const sha256=await digest(payload);if(storage.getItem(KEY)!==payload)fail('書出し中に保存内容が変わりました。再実行してください。');return JSON.stringify({format:'hiranuma-preview-backup',version:1,createdAt:new Date().toISOString(),sha256,payload});}
async function inspect(text){if(typeof text!=='string'||text.length>LIMIT*2)fail('ファイルが大きすぎます。');let envelope;try{envelope=JSON.parse(text);}catch(_){fail('バックアップファイルを読み取れません。');}if(envelope.format!=='hiranuma-preview-backup'||envelope.version!==1)fail('対応するバックアップではありません。');const data=validate(envelope.payload);if(await digest(envelope.payload)!==envelope.sha256)fail('内容の照合に失敗しました。ファイルを変更しないでください。');return {payload:envelope.payload,sha256:envelope.sha256,sheets:data.sheets.map(([name,rows])=>({name,historyRows:rows.length-1}))};}
const api={KEY,validate,exportBackup,inspect};root.BandPreviewBackup=api;if(typeof module!=='undefined')module.exports=api;
if(!root.document)return;
root.document.addEventListener('DOMContentLoaded',()=>{
 const aside=document.querySelector('[aria-label="プレビューの説明"]');if(!aside)return;
 const section=document.createElement('details'),summary=document.createElement('summary');summary.textContent='この端末のデータを書き出す';section.append(summary);
 const note=document.createElement('p');note.textContent='先に入力を保存してください。バックアップには名簿などが含まれます。「ファイル」に保管し、公開場所へ置かないでください。この操作は保存データを変更しません。';section.append(note);
 const status=document.createElement('p');status.setAttribute('role','status');const output=document.createElement('button');output.type='button';output.textContent='保存済みデータを書き出す';output.onclick=async()=>{try{output.disabled=true;if(document.getElementById('workspace')?.disabled||document.getElementById('save-state')?.textContent.includes('未保存'))fail('保存が終わってから書き出してください。未保存の入力はファイルに含まれません。');const text=await exportBackup(localStorage);const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='marching-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent='ダウンロードを要求しました。「ファイル」に保存されたことを確認してください。';}catch(e){status.textContent=e.message;}finally{output.disabled=false;}};section.append(output);
 section.append(status);aside.append(section);
});
})(typeof window==='undefined'?globalThis:window);
