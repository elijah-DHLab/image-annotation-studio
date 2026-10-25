// Offline integration tests. Uses the application's actual XLSX reader and app code.
// DOM and Google transport are simulated; this is not a browser/network test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const elements = new Map();
function el(id) {
  if (!elements.has(id)) elements.set(id, {
    value:'', innerHTML:'', textContent:'', title:'', disabled:false, dataset:{}, style:{},
    classList:{toggle(){},contains(){return false},add(){},remove(){}},
    querySelectorAll(){return []}, addEventListener(){}, remove(){}, setAttribute(){},
  });
  return elements.get(id);
}
let transport, alerts=[];
const context = {
  console:{log:console.log,warn(){},error(){}}, TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,
  Blob,Response,AbortController,URLSearchParams,URL,crypto:webcrypto,setTimeout,clearTimeout,
  localStorage:{getItem(){return null},setItem(){},removeItem(){}},
  alert(msg){alerts.push(msg)},confirm(){return true},
  document:{getElementById:el,querySelectorAll(){return []},createElement(){return {remove(){}}},
    head:{appendChild(script){transport(script)}}},
  fetch:async()=>({ok:false,status:503}),
};
context.window=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'pako_inflate.min.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'xlsx-reader.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'data/register-bundled.js'),'utf8'),context);
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
new vm.Script(code); // Syntax-check the unchanged production code first.
code=code.replace('    init();', `
    renderAll=()=>{renderTerms();renderRelationComposer();renderMarkRegister()};
    window.api={data,readSourceSheets,useSnapshot,loadSheet,loadWorkbookFile,termOptions,
      predicateOptions,sourceSummary,newProject,createAnnotation,renderRelationComposer,
      canonicalCsv,deleteAnnotation,jsonLdProject,renderTerms,applyLanguage,
      getSourceKind:()=>sourceKind};`);
vm.runInContext(code,context);
const a=context.api;
function googleResponse(sheets,script){
  const url=new URL(script.src), name=url.searchParams.get('sheet');
  assert.equal(url.pathname,'/spreadsheets/d/1SA4BpAIzvyGni1vWtfShJsrmiT4e6NsNKOUAawrg-Jg/gviz/tq');
  assert.equal(url.searchParams.get('headers'),'0');
  assert.ok(sheets[name], 'Request must use an actual worksheet name: '+name);
  const rows=sheets[name],width=Math.max(...rows.map(r=>r.length));
  const cb=url.searchParams.get('tqx').split('responseHandler:')[1];
  context[cb]({status:'ok',table:{cols:Array.from({length:width},(_,i)=>({id:String(i),label:''})),
    rows:rows.map(row=>({c:Array.from({length:width},(_,i)=>({v:row[i]??null}))}))}});
}
async function main(){
  const workbookPath=process.argv[2];
  assert.ok(workbookPath,'Pass the real XLSX fixture path');
  const bytes=fs.readFileSync(workbookPath);
  const file={name:path.basename(workbookPath),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
  const workbook=await context.LocalXlsx.parse(file);
  assert.equal(Object.keys(workbook.sheets).length,8);
  const loaded=a.readSourceSheets(workbook.sheets);
  assert.equal(loaded['מונחים | Terms'].length,8);
  assert.equal(loaded['חומרים | Materials'].length,0);
  assert.equal(loaded['מושגים | Concepts'].length,7);
  console.log('PASS: actual XLSX reader parses all 8 real tabs, including empty materials');

  assert.equal(a.useSnapshot(context.BUNDLED_REGISTER),true);
  assert.equal(a.termOptions().length,8);
  assert.equal(a.predicateOptions().length,14);
  assert.ok(el('termPalette').innerHTML.includes('Genitalia - Male'));
  assert.equal((el('termPalette').innerHTML.match(/data-term-id=/g)||[]).length,8);
  assert.ok(a.sourceSummary().en.includes('1 unresolved concept'));
  assert.ok(el('connectionStatus').textContent.includes('עותק גיבוי'));
  console.log('PASS: bundled snapshot renders 8 term buttons and 14 predicates; missing CON-0008 is nonblocking');

  transport=script=>script.onerror();
  assert.equal(await a.loadSheet(),false);
  assert.equal(a.termOptions().length,8);
  assert.ok(el('connectionStatus').textContent.includes('נכשל'));
  assert.equal(el('syncNow').disabled,false);
  console.log('PASS: offline/blocked Google preserves usable terms and shows a visible warning');

  transport=script=>googleResponse(workbook.sheets,script);
  assert.equal(await a.loadSheet(),true);
  assert.equal(a.getSourceKind(),'live');
  assert.ok(el('connectionStatus').textContent.includes('מחובר'));
  assert.ok(a.data.dataSource.startsWith('Google Sheets live:'));
  assert.equal(a.useSnapshot(context.BUNDLED_REGISTER),false);
  console.log('PASS: JSONP requests use the actual tab names; live source supersedes backup');

  a.newProject();a.data.imageInfo={width:1000,height:800};
  a.data.project.image={fileName:'test-image.jpg',width:1000,height:800,mediaType:'image/jpeg',sha256:'testhash',registrationStatus:'unregistered'};
  el('termSelect').value='TERM-0006';a.createAnnotation({kind:'point',points:[{x:250,y:200}]});
  el('termSelect').value='TERM-0008';a.createAnnotation({kind:'rect',x:100,y:100,width:200,height:160,points:[]});
  assert.equal(a.data.project.annotations.length,2);
  assert.equal(a.data.project.annotations[0].geometry.points[0].x,.25);
  assert.equal(a.data.project.annotations[1].conceptId,'CON-0008');
  a.renderRelationComposer();
  el('relationSubject').value=a.data.project.annotations[0].id;
  el('relationObject').value=a.data.project.annotations[1].id;
  el('relationPredicate').value=a.predicateOptions()[0];el('addRelation').onclick();
  assert.equal(a.data.project.relations.length,1);
  const projectBefore=JSON.stringify(a.data.project);
  const changed=JSON.parse(JSON.stringify(workbook.sheets));
  changed['מונחים | Terms'][4][2]='Updated Zodiac label';
  changed['ערכי קשרים | Relation values'].push(['','בדיקה | Test predicate','','']);
  transport=script=>googleResponse(changed,script);
  assert.equal(await a.loadSheet(),true);
  assert.ok(el('termPalette').innerHTML.includes('Updated Zodiac label'));
  assert.equal(a.predicateOptions().length,15);
  assert.equal(JSON.stringify(a.data.project),projectBefore);
  assert.ok(el('relationComposer').innerHTML.includes('Test predicate'));
  console.log('PASS: refresh updates terms and relation choices without changing existing annotations/revisions');

  const broken=JSON.parse(JSON.stringify(changed));broken['מונחים | Terms']=broken['חומרים | Materials'];
  transport=script=>googleResponse(broken,script);
  assert.equal(await a.loadSheet(),false);
  assert.ok(el('termPalette').innerHTML.includes('Updated Zodiac label'));
  assert.equal(a.predicateOptions().length,15);
  console.log('PASS: wrong-tab/header response is rejected without clearing or downgrading live data');

  const pending=[];transport=script=>pending.push(script);
  const refresh=a.loadSheet();await a.loadWorkbookFile(file);
  pending.forEach(script=>googleResponse(changed,script));await refresh;
  assert.equal(a.getSourceKind(),'local');
  assert.equal(a.termOptions()[0].label,'Zodiac Man');
  assert.equal(JSON.stringify(a.data.project),projectBefore);
  console.log('PASS: local Excel import wins over an in-flight online request');

  const csv=a.canonicalCsv();
  for(const value of ['TERM-0006','TERM-0008','CON-0008','test-image.jpg',a.data.project.relations[0].subjectId])assert.ok(csv.includes(value));
  const jsonld=a.jsonLdProject();assert.equal(jsonld['dh:annotations'].length,2);
  a.deleteAnnotation(a.data.project.annotations[0].id);
  assert.equal(a.data.project.annotations.length,1);assert.equal(a.data.project.relations.length,0);
  assert.ok(a.data.project.revisions.length>4);
  a.data.lang='en';a.renderTerms();
  assert.ok(el('termSelect').innerHTML.includes('Select a term'));
  assert.equal(alerts.length,0);
  console.log('PASS: CSV/JSON-LD export, normalized geometry, relation creation, cascading deletion and English labels');

  const materialStart=html.indexOf('id="materialPanel"');
  assert.ok(html.indexOf('id="connectionStatus"')<materialStart);
  assert.equal((html.match(/id="connectionStatus"/g)||[]).length,1);
  assert.ok(!fs.readFileSync(path.join(root,'.github/workflows/sync-sheet.yml'),'utf8').includes('continue-on-error'));
  console.log('PASS: status sits outside the hidden setup panel; workflow cannot silently publish a failed sync');
}
main().catch(e=>{console.error(e);process.exitCode=1});
