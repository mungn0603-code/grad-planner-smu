// 현재 앱 전역 위에서 도는 픽스처 생성·추출 함수. Node(vm)와 브라우저가 같은 파일을 쓴다.
var __rng=s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
var __set=v=>JSON.parse(JSON.stringify(v,(k,x)=>x instanceof Set?[...x]:x));
function __build(f){const r=__rng(f.seed),pick=a=>a[Math.floor(r()*a.length)];
  S=emptyState(f.year);S.sample=false;S.nowSet=true;S.track=TRK.length?TRK[0][0]:'';
  S.mode=modeOk(f.mode,f.year)?f.mode:'single';
  if(f.leave)setLeave(new Set([f.leave]));
  S.now=f.now;const ni=nowIdx(),sel={};
  SEMS.forEach((s,i)=>{if(i>=ni)return;const ed=slotEd(s),[g,h]=s.split('-').map(Number);
    CURR[ed].filter(c=>c.y===g&&c.s===h).forEach(c=>{if(f.p==='all'||r()<0.8)sel['o:'+c.c]={on:true,slot:s};});});
  CURR[CUR].forEach(c=>{if(sIdx(c.y+'-'+c.s)>=ni&&r()<0.35)sel['n:'+c.c]={on:true};});
  S.sel={[f.year]:sel};
  const slots=SEMS.concat(['1-1s','2-2s']),slot=()=>r()<0.08?null:pick(slots);
  const ge=n=>{const g=GE_CAT[Math.floor(r()*GE_CAT.length)];for(let i=0;i<n;i++){}return g;};
  const nGe=f.p==='all'?12:4+Math.floor(r()*10);
  for(let i=0;i<nGe;i++){const g=ge();S.custom.push({id:'g'+i,name:g.n,cr:g.cr,kind:g.k,area:g.a,slot:slot()});}
  if(r()<0.5)S.custom.push({id:'x1',name:'직접 입력 교양',cr:2,kind:'교선',area:pick(AREAS),slot:slot()});
  if(r()<0.4){const c=pick(CURR[CUR]);S.custom.push({id:'m1',name:c.n,cr:c.cr,kind:pick(['전선','전심']),area:'해당 없음',slot:slot()});}
  if(S.mode!=='single')for(let i=0;i<3+Math.floor(r()*6);i++)S.custom.push({id:'e'+i,name:'추가전공 '+i,cr:3,kind:'추가전공',area:'해당 없음',slot:slot()});
  if(r()<0.3)S.custom.push({id:'o1',name:'마이크로전공 과목',cr:3,kind:'일선',area:'해당 없음',slot:slot()});
  S.cdrEx=Object.fromEntries(TRK.map(([k])=>[k,r()<0.5?1:0]));
  S.gpa=r()<0.3?null:Math.round((1+r()*3.5)*100)/100;S.port=r()<0.5;
  migrateNow(S.now,true);retakeAll();}
function __audit(){const items=planItems(),cov=coveredNow(items),c=calc(items,cov),r=reqOf(),g=geState();
  const cdr={};TRK.forEach(([k])=>{const x=cdrCount(k);cdr[k]={done:x.done,all:x.all,ex:x.ex};});
  let thesis=null;if(IS_GREEN){const t=thesisItem((l,ok,txt)=>({ok,txt}));thesis={ok:t.ok,deep:+(t.txt.match(/전공심화 (\d+)/)||[])[1],cap:!/캡스톤 I·II 필요/.test(t.txt)};}
  const counted=items.filter(i=>i.on&&!(i.key.startsWith('n:')&&cov[i.c.c])).map(i=>({key:i.key,c:i.c.c,cr:i.c.cr,t:i.c.t,slot:i.slot,src:i.src}));
  return __set({req:r,done:c.done,all:c.all,ge:{basic:g.basic,core:g.core,bal:g.bal},cdr,thesis,gpa:S.gpa,port:!!S.port,counted,
    terms:Object.fromEntries(ALLS.map(s=>[s,termOfSlot(s)]))});}
function __plan(tracks,sea){SM.mode='plan';SM.tracks=tracks;SM.sea=!!sea;SM.over22=false;SM.swaps=[];
  const P=smProfile(),pl=smPlan(P),chk=smCheck(P,pl);
  return __set({rows:pl.rows.map(x=>({slot:x.slot,c:x.c.code,n:x.c.name,cr:x.c.cr,ge:x.c.ge,why:x.why})),load:pl.load,fut:pl.fut,sea:pl.sea,
    chk:chk.map(l=>({k:l.k,a:l.a,b:l.b,need:l.need,ok:l.ok}))});}
function __static(){const maps={};Object.keys(CURR).forEach(y=>{maps[y]=mapsOf(y);});
  return __set({id:U.id,name:U.name,CUR,EDS,SHORT,TRK:TRK.map(x=>x[0]),IS_GREEN,maps,balEx:U.balEx,
    consts:{GE_CAT,BASIC_REQ,CAPSTONE,OVR,CHAINS,CDR_REQ,SMR_SET:SMR.set,SM_W,AREAS,KINDS}});}
