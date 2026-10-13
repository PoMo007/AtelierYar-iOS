/* AtelierYar — local-first attendance & payroll manager. */
(() => {
  'use strict';
  const DATA_KEY = 'atelierYar.data.v1';
  const SETTINGS_KEY = 'atelierYar.settings.v1';
  const fa = n => Number(n || 0).toLocaleString('fa-IR', {maximumFractionDigits: 2});
  const money = n => `${fa(Math.round((Number(n) || 0) * 100) / 100)} ${settings.currency || 'تومان'}`;
  const makeId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const nowISO = () => new Date().toISOString();
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const parseISO = iso => { const [y,m,d] = String(iso || todayISO()).slice(0,10).split('-').map(Number); return new Date(y, (m||1)-1, d||1, 12, 0, 0); };
  const toISODate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const toFa = s => String(s).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  const toEn = s => String(s).replace(/[۰-۹٠-٩]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d) >= 0 ? String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)) : String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const jalaliFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {year:'numeric', month:'long', day:'numeric'});
  const jalaliNumFmt = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {timeZone:'UTC', year:'numeric', month:'numeric', day:'numeric'});
  const shortDateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {year:'numeric', month:'short', day:'numeric'});
  const jp = date => {
    const parts = jalaliNumFmt.formatToParts(date);
    return {year:Number(parts.find(x=>x.type==='year')?.value), month:Number(parts.find(x=>x.type==='month')?.value), day:Number(parts.find(x=>x.type==='day')?.value)};
  };
  const jpISO = iso => jp(new Date(`${String(iso||todayISO()).slice(0,10)}T12:00:00Z`));
  const jalaliDate = iso => jalaliFmt.format(parseISO(iso));
  const jalaliShort = iso => shortDateFmt.format(parseISO(iso));
  const jalaliTodayParts = () => jpISO(todayISO());
  const isoFromJalali = (jy, jm, jd) => {
    // Search a Gregorian window around the start of the matching Persian year.
    const start = Date.UTC(jy + 621, 2, 1, 12);
    for (let i = -10; i <= 390; i++) {
      const d = new Date(start + i * 86400000);
      const p = jp(d);
      if (p.year === jy && p.month === jm && p.day === jd) return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
    }
    return todayISO();
  };
  const jalaliMonthDays = (jy, jm) => {
    const start = Date.UTC(jy + 621, 2, 1, 12), found=[];
    for (let i=-10; i<=390; i++) {
      const d = new Date(start + i*86400000), p=jp(d);
      if (p.year===jy && p.month===jm) found.push({day:p.day, iso:`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`, weekday:(d.getUTCDay()+1)%7});
    }
    return found;
  };
  const defaultData = () => ({schemaVersion:1, groups:[], employees:[], attendances:[], advances:[], plans:[], events:[], meta:{updatedAt:nowISO()}});
  const readJSON = (key, fallback) => { try { const raw=localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  let data = readJSON(DATA_KEY, defaultData());
  let settings = Object.assign({theme:'dark', accent:'violet', currency:'تومان', ghOwner:'', ghRepo:'', ghBranch:'main', ghPath:'data/atelier-yar.json', ghToken:'', lastSync:'', syncState:'local'}, readJSON(SETTINGS_KEY, {}));
  if(!settings.themeChosen) settings.theme='dark'; // dark is the default until the user picks a theme
  if (!data || !Array.isArray(data.groups)) data = defaultData();
  ['groups','employees','attendances','advances','plans','events'].forEach(k => { if (!Array.isArray(data[k])) data[k]=[]; });
  if (!data.meta) data.meta = {updatedAt:nowISO()};
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const live = (item) => item && !item.deletedAt;
  const activeEmployees = () => data.employees.filter(e=>live(e)&&e.active!==false);
  const liveEmployees = () => data.employees.filter(live);
  const liveGroups = () => data.groups.filter(live);
  // One attendance per employee per night (the group is only a label). Old data may hold duplicates; keep the newest.
  const attTime = a => Date.parse(a.updatedAt||a.createdAt||0)||0;
  const attList = () => { const m=new Map(); data.attendances.forEach(a=>{ if(!live(a))return; const k=`${a.employeeId}|${a.date}`, o=m.get(k); if(!o||attTime(a)>=attTime(o)) m.set(k,a); }); return [...m.values()]; };
  const liveGroupOf = id => { const g=getGroup(id); return g&&live(g)?g:null; };
  // "باغ رویال: ۴ شب · آتلیه ماد: ۶ شب" for a list of attendance records (information only, never separate payroll)
  const groupBreakdown = recs => { const m=new Map(); recs.forEach(r=>{ const n=liveGroupOf(r.groupId)?.name||'بدون مجموعه'; m.set(n,(m.get(n)||0)+1); }); const parts=[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([n,c])=>`${n}: ${fa(c)} شب`); return parts.length?parts.join(' · '):'—'; };
  const getGroup = id => data.groups.find(g=>g.id===id);
  const getEmployee = id => data.employees.find(e=>e.id===id);
  const fmtMoneyInput = n => { const v=Math.round((Number(n)||0)*100)/100; const [i,d]=String(v).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(d?'.'+d:''); };
  const fmtMoneyText = raw => { const t=toEn(String(raw||'')).replace(/[^0-9.]/g,''); const [i,...r]=t.split('.'); const ip=i.replace(/^0+(?=\d)/,'').replace(/\B(?=(\d{3})+(?!\d))/g,','); return r.length?ip+'.'+r.join('').slice(0,2):ip; };
  function formatMoneyField(el){ const pos=el.selectionStart??el.value.length; const digitsBefore=toEn(el.value.slice(0,pos)).replace(/[^0-9.]/g,'').length; const f=fmtMoneyText(el.value); if(f===el.value)return; el.value=f; let c=0,np=0; for(;np<f.length&&c<digitsBefore;np++){ if(/[0-9.]/.test(f[np]))c++; } try{el.setSelectionRange(np,np);}catch(_){} }
  const numeric = v => { const n=Number(toEn(String(v??'').replace(/[٬،,\s\u00a0]/g,'').trim())); return Number.isFinite(n) ? n : 0; };
  const wagePeriodLabel = p => ({daily:'روزانه',weekly:'هفتگی',monthly:'ماهانه'}[p] || 'روزانه');
  const wagePeriodUnit = p => ({daily:'هر شب',weekly:'هفته',monthly:'ماه'}[p] || 'هر شب');
  const nightRate = e => {
    if (Number(e?.nightRateOverride)>0) return Number(e.nightRateOverride);
    const amount=Number(e?.wageAmount)||0;
    if (e?.wagePeriod==='weekly') return amount/7;
    if (e?.wagePeriod==='monthly') return amount/30;
    return amount;
  };
  let autoSyncTimer=null, syncing=false, pendingSync=false, lastFocusSync=0;
  function saveData({triggerSync=true}={}) { data.meta={...(data.meta||{}), updatedAt:nowISO()}; localStorage.setItem(DATA_KEY, JSON.stringify(data)); updateStorageStats(); if(triggerSync){if(syncing)pendingSync=true;else queueAutoSync();} }
  function queueAutoSync(){ if(!githubConfigValid() || !navigator.onLine || syncing) return; clearTimeout(autoSyncTimer); autoSyncTimer=setTimeout(()=>{if(githubConfigValid() && !syncing) syncNow({silent:true});},1800); }

  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); applyAppearance(); updateSyncIndicators(); }
  const ACCENTS=['violet','navy','slate','emerald','teal','rose','coral','amber','plum','graphite'];
  function applyAppearance() { document.documentElement.dataset.theme=settings.theme||'dark'; if(!ACCENTS.includes(settings.accent))settings.accent='violet'; document.documentElement.dataset.accent=settings.accent; $('#themeToggle').textContent=settings.theme==='dark'?'☾':'☼'; $$('#themeSegment button').forEach(b=>b.classList.toggle('active',b.dataset.theme===settings.theme)); $$('.swatches button').forEach(b=>b.classList.toggle('active',b.dataset.accent===settings.accent)); $('#currencySetting').value=settings.currency||'تومان'; try{const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),mt=document.querySelector('meta[name="theme-color"]');if(mt&&bg)mt.setAttribute('content',bg);}catch(_){} syncSystemBars(); }
  function esc(s) { return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function safeInitial(s) { return (String(s||'؟').trim()[0]||'؟'); }
  function toast(message, kind='success', duration=3300) { const el=document.createElement('div'); el.className=`toast ${kind}`; el.textContent=message; $('#toastRegion').appendChild(el); setTimeout(()=>el.remove(),duration); }
  function showPage(page) {
    const titleMap={dashboard:'داشبورد',attendance:'ثبت شبانه',planner:'برنامه‌ریزی',employees:'کارکنان',groups:'مجموعه‌ها',payroll:'حقوق و مساعده',reports:'گزارش‌ها',settings:'تنظیمات'};
    $$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${page}`)); $$('.nav-item[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); $('#pageTitle').textContent=titleMap[page]||'آتلیه‌یار'; $$('.bn-item[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); const more=$('#bnMore'); if(more)more.classList.toggle('active',!['dashboard','attendance','planner','payroll'].includes(page)); window.scrollTo(0,0);
    if (page==='dashboard') renderDashboard(); if(page==='attendance') renderAttendance(); if(page==='planner') renderPlanner(); if(page==='employees') renderEmployees(); if(page==='groups') renderGroups(); if(page==='payroll') renderPayroll(); if(page==='reports') renderReports(); if(page==='settings') renderSettings();
  }

  /* ---------- Navigation, overlays and the Android hardware back button ----------
     Back order: close the open sheet / calendar / menu -> previous page -> on the
     dashboard show "press again to exit" -> exit.
     Android (Capacitor): the official App plugin delivers 'backButton' to us.
     Fallback (desktop/browser/WebView without the plugin): a single "guard" history
     entry sits ahead of the base entry so Back/mouse-back lands on popstate first. */
  const layers=[];
  const pageStack=['dashboard'];
  let exitArmed=false, exitTimer=null, guardCount=0, nativeApp=null;
  function layerOpen(id){return layers.some(l=>l.id===id);}
  function openLayer(id,close){ rearmBack(); if(layerOpen(id))return; layers.push({id,close}); }
  function closeLayer(id){ const i=layers.findIndex(l=>l.id===id); if(i<0)return false; const [l]=layers.splice(i,1); try{l.close();}catch(_){} return true; }
  function ensureGuard(){ if(guardCount>0)return; try{history.pushState({atelierGuard:true},'');guardCount=1;}catch(_){} }
  function rearmBack(){ exitArmed=false; clearTimeout(exitTimer); ensureGuard(); }
  function handleBack(){
    if(layers.length){ closeLayer(layers[layers.length-1].id); return true; }
    if(pageStack.length>1){ pageStack.pop(); showPage(pageStack[pageStack.length-1]); return true; }
    return false;
  }
  // 'handled' = consumed inside the app, 'hint' = asked the user to press again, 'exit' = leave the app.
  function onBackPress(){
    if(handleBack()){ exitArmed=false; clearTimeout(exitTimer); return 'handled'; }
    if(exitArmed)return 'exit';
    exitArmed=true; toast('برای خروج از برنامه، یک بار دیگر «برگشت» را بزنید','info',2300);
    clearTimeout(exitTimer); exitTimer=setTimeout(()=>{exitArmed=false;ensureGuard();},2400);
    return 'hint';
  }
  function setPage(page){
    rearmBack(); closeLayer('menu'); closeLayer('calendar');
    const top=pageStack[pageStack.length-1];
    if(page!==top){ const idx=pageStack.indexOf(page); if(idx>=0)pageStack.length=idx+1; else pageStack.push(page); }
    showPage(page);
  }
  function openMenu(){ $('#sidebar').classList.add('open'); document.body.classList.add('menu-open'); openLayer('menu',()=>{$('#sidebar').classList.remove('open');document.body.classList.remove('menu-open');}); }
  function toggleMenu(){ if(layerOpen('menu'))closeLayer('menu'); else openMenu(); }
  function nativePlugin(name){
    try{ const cap=window.Capacitor; if(!cap)return null; return (cap.Plugins&&cap.Plugins[name])||(typeof cap.registerPlugin==='function'?cap.registerPlugin(name):null); }catch(_){ return null; }
  }
  function initBackHandling(){
    // 1) Android: official App plugin (authoritative when present)
    if(window.Capacitor&&typeof window.Capacitor.isNativePlatform==='function'&&window.Capacitor.isNativePlatform()){
      nativeApp=nativePlugin('App');
      if(nativeApp&&typeof nativeApp.addListener==='function'){
        try{
          const reg=nativeApp.addListener('backButton',()=>{ if(onBackPress()==='exit'){ try{nativeApp.exitApp();}catch(_){} } });
          if(reg&&typeof reg.catch==='function')reg.catch(()=>{});
        }catch(_){}
      }
    }
    // 2) History guard (desktop/browser, and a safety net on Android).
    //    Chrome only trusts history entries created after a user gesture, so arm on first interaction.
    try{history.replaceState({atelierBase:true},'');}catch(_){}
    ['pointerup','click','keydown'].forEach(t=>document.addEventListener(t,rearmBack,{capture:true,passive:true}));
    window.addEventListener('popstate',()=>{
      guardCount=Math.max(0,guardCount-1);
      if(onBackPress()==='handled')ensureGuard();
    });
  }

  /* ---------- Platform helpers ---------- */
  const IS_NATIVE = Boolean(window.Capacitor && typeof window.Capacitor.isNativePlatform==='function' && window.Capacitor.isNativePlatform());
  const IS_PHONE_LAYOUT = () => window.matchMedia('(max-width:900px)').matches;
  function syncSystemBars(){
    if(!IS_NATIVE)return;
    try{
      const cap=window.Capacitor, SB=(cap.Plugins&&cap.Plugins.SystemBars)||(typeof cap.registerPlugin==='function'?cap.registerPlugin('SystemBars'):null);
      if(SB&&typeof SB.setStyle==='function'){ const r=SB.setStyle({style:(settings.theme==='dark')?'DARK':'LIGHT'}); if(r&&r.catch)r.catch(()=>{}); }
    }catch(_){}
  }
  // Give every table cell its column title so tables can become cards on phones.
  function labelTables(root){
    (root||document).querySelectorAll('table.data-table').forEach(t=>{
      const heads=[...t.querySelectorAll('thead th')].map(th=>th.textContent.trim());
      t.querySelectorAll('tbody tr, tfoot tr').forEach(tr=>{ let i=0; [...tr.children].forEach(td=>{ if(heads[i]&&!td.dataset.label)td.dataset.label=heads[i]; i+=td.colSpan||1; }); });
    });
  }
  function initTableLabels(){
    const host=$('#content'); if(!host)return; let t=null;
    new MutationObserver(()=>{clearTimeout(t);t=setTimeout(()=>labelTables(host),0);}).observe(host,{childList:true,subtree:true});
    labelTables(host);
  }
  function fillGroupSelect(select, {all=false, blank=false, selected}={}) {
    if(!select)return; const prev=selected!==undefined?selected:select.value; const opts=[];
    if(all) opts.push('<option value="all">همه مجموعه‌ها</option>'); if(blank) opts.push('<option value="">بدون مجموعه</option>');
    liveGroups().forEach(g=>opts.push(`<option value="${esc(g.id)}">${esc(g.name)}</option>`)); select.innerHTML=opts.join('');
    if([...select.options].some(o=>o.value===prev)) select.value=prev; else if(select.options.length) select.selectedIndex=0;
  }
  function ensureDefaultDates() {
    const today=todayISO(), t=parseISO(today), start=new Date(t); start.setDate(start.getDate()-9);
    if(!$('#attendanceDate').value) $('#attendanceDate').value=jalaliDate(today);
    $('#attendanceDate').dataset.iso=$('#attendanceDate').dataset.iso||today;
    if(!$('#payrollFrom').dataset.iso) $('#payrollFrom').dataset.iso=toISODate(start);
    if(!$('#payrollTo').dataset.iso) $('#payrollTo').dataset.iso=today;
    $('#payrollFrom').value=jalaliDate($('#payrollFrom').dataset.iso); $('#payrollTo').value=jalaliDate($('#payrollTo').dataset.iso);
  }
  let appStarted=false;
  const attExpanded=new Set();
  function init() {
    if(appStarted)return; appStarted=true;
    document.documentElement.classList.add(IS_NATIVE?'is-native':'is-web'); if(/Electron/i.test(navigator.userAgent))document.documentElement.classList.add('is-desktop');
    applyAppearance(); ensureDefaultDates();
    $('#todayLabel').textContent=jalaliDate(todayISO()); $('#footerDate').textContent=jalaliShort(todayISO());
    bindEvents(); renderAll(); updateStorageStats(); updateSyncIndicators(); initTableLabels(); initBackHandling();
    if(githubConfigValid()) queueAutoSync();
    window.addEventListener('focus',()=>{const now=Date.now();if(now-lastFocusSync>30000&&githubConfigValid()&&navigator.onLine){lastFocusSync=now;syncNow({silent:true});}});
    window.addEventListener('online',()=>{if(githubConfigValid())queueAutoSync();});
    if(!IS_NATIVE && 'serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost' || location.hostname==='127.0.0.1')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  function renderAll() { renderDashboard(); renderAttendance(); renderPlanner(); renderEmployees(); renderGroups(); renderPayroll(); renderReports(); renderSettings(); }

  function recordsInRange(collection, from, to) { return collection.filter(r=>live(r)&&r.date>=from&&r.date<=to); }
  function calcPayroll(from,to) {
    // Every night of an employee counts together, whatever group it was recorded for.
    const attend=recordsInRange(attList(),from,to);
    const adv=recordsInRange(data.advances,from,to).filter(r=>r.deductFromPayroll!==false);
    const map=new Map();
    const ensure=id=>{if(!map.has(id)){const e=getEmployee(id); map.set(id,{employee:e||{id,name:'کارمند حذف‌شده'},records:[],gross:0,advance:0,nights:0,attendanceIds:[],advanceIds:[]});}return map.get(id);};
    attend.forEach(r=>{const row=ensure(r.employeeId);row.gross+=Number(r.payAmount)||0;row.nights++;row.records.push(r);row.attendanceIds.push(r.id);});
    adv.forEach(r=>{const row=ensure(r.employeeId);row.advance+=Number(r.amount)||0;row.advanceIds.push(r.id);});
    const rows=[...map.values()].filter(r=>r.gross!==0||r.advance!==0||(!r.employee.deletedAt)).sort((a,b)=>(a.employee.name||'').localeCompare(b.employee.name||'','fa'));
    const gross=rows.reduce((s,r)=>s+r.gross,0), advances=rows.reduce((s,r)=>s+r.advance,0);
    return {rows,gross,advances,net:gross-advances,nights:attend.length,from,to};
  }
  function renderDashboard() {
    const today=todayISO(), start=parseISO(today);start.setDate(start.getDate()-9); const from=toISODate(start), totals=calcPayroll(from,today);
    $('#statEmployees').textContent=fa(activeEmployees().length); $('#statGroupsFoot').textContent=`در ${fa(liveGroups().length)} مجموعه`;
    const todayAtt=attList().filter(a=>a.date===today); $('#statAttendance').textContent=fa(todayAtt.length);
    $('#statPayroll').innerHTML=`${fa(totals.gross)} <small>${esc(settings.currency)}</small>`; $('#statAdvances').innerHTML=`${fa(totals.advances)} <small>${esc(settings.currency)}</small>`;
    const dashRows=totals.rows.filter(r=>r.gross||r.advance).slice(0,6);
    $('#dashboardPayroll').innerHTML=dashRows.length?dashRows.map(r=>`<div class="summary-line"><div class="summary-person"><div class="summary-avatar">${esc(safeInitial(r.employee.name))}</div><div><b>${esc(r.employee.name||'کارمند')}</b><small>${fa(r.nights)} شب کاری</small></div></div><div class="summary-pay">${money(r.gross-r.advance)}<small>خالص حقوق</small></div></div>`).join(''):`<div class="empty-inline"><b>هنوز اطلاعاتی ثبت نشده</b>با ثبت کارکنان و حضورهای شبانه، خلاصه حقوق اینجا نمایش داده می‌شود.</div>`;
    const recent=attList().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,5);
    $('#recentAttendance').innerHTML=recent.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>مجموعه</th><th>تاریخ</th><th>مبلغ شب</th></tr></thead><tbody>${recent.map(r=>{const e=getEmployee(r.employeeId),g=liveGroupOf(r.groupId);return `<tr><td><div class="table-name"><span class="table-avatar">${esc(safeInitial(e?.name))}</span><b>${esc(e?.name||'کارمند حذف‌شده')}</b></div></td><td>${esc(g?.name||'—')}</td><td>${esc(jalaliShort(r.date))}</td><td><b>${money(r.payAmount)}</b></td></tr>`}).join('')}</tbody></table></div>`:`<div class="empty-inline">هنوز حضوری ثبت نشده است.</div>`;
  }
  function groupOptions(selected){ return `<option value="" ${!selected?'selected':''}>بدون مجموعه</option>`+liveGroups().map(g=>`<option value="${esc(g.id)}" ${g.id===selected?'selected':''}>${esc(g.name)}</option>`).join(''); }
  function renderAttendance() {
    const date=$('#attendanceDate').dataset.iso||todayISO(); $('#attendanceDate').value=jalaliDate(date);
    const defGroup=liveGroupOf(settings.lastAttGroup)?settings.lastAttGroup:'', q=$('#attendanceSearch').value.trim().toLocaleLowerCase('fa');
    // All active employees are available every night; the group is just a label chosen per person.
    const employees=activeEmployees().filter(e=>!q||`${e.name} ${e.role||''}`.toLocaleLowerCase('fa').includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'fa'));
    const records=attList().filter(a=>a.date===date); const byEmp=new Map(records.map(r=>[r.employeeId,r])); const planKeys=new Set(plannedOn(date).map(p=>p.employeeId)); const advByEmp=new Map(nightAdvances(date).map(a=>[a.employeeId,a]));
    $('#attendanceEmpty').hidden=employees.length>0; $('#attendanceRows').innerHTML=employees.map(e=>{const r=byEmp.get(e.id), rate=r?Number(r.payAmount):nightRate(e), rowGroup=r?(liveGroupOf(r.groupId)?r.groupId:''):defGroup, expanded=attExpanded.has(e.id);return `<tr data-att-emp="${esc(e.id)}" class="${r?'present-row':''}${expanded?' expanded':''}"><td><label class="check-control"><input class="att-check" type="checkbox" ${r?'checked':''} aria-label="حضور ${esc(e.name)}"></label></td><td><div class="table-name"><span class="table-avatar">${esc(safeInitial(e.name))}</span><div><b>${esc(e.name)}</b><small>${esc(e.role||'')}${(!r&&planKeys.has(e.id))?`${e.role?' · ':''}<span class="plan-badge">برنامه‌ریزی‌شده</span>`:''}</small></div></div></td><td><span class="soft-tag">${wagePeriodLabel(e.wagePeriod)}</span><button type="button" class="att-toggle" data-att-toggle="${esc(e.id)}" aria-expanded="${expanded?'true':'false'}" aria-label="باز و بسته کردن جزئیات ${esc(e.name)}">${expanded?'▴':'▾'}</button></td><td><select class="note-input att-group" ${r?'':'disabled'} aria-label="مجموعه ${esc(e.name)} در این شب">${groupOptions(rowGroup)}</select></td><td><input class="money-input att-amount" data-money inputmode="numeric" type="text" autocomplete="off" value="${esc(fmtMoneyInput(rate))}" ${r?'':'disabled'} aria-label="مبلغ حقوق این شب برای ${esc(e.name)}"></td><td><input class="money-input att-advance" data-money inputmode="numeric" type="text" autocomplete="off" placeholder="اختیاری" value="${esc(advByEmp.get(e.id)?fmtMoneyInput(advByEmp.get(e.id).amount):'')}" ${r?'':'disabled'} aria-label="مساعده این شب برای ${esc(e.name)}"></td><td><input class="note-input att-note" type="text" maxlength="160" placeholder="اختیاری" value="${esc(r?.note||'')}" ${r?'':'disabled'}></td></tr>`;}).join('');
    renderPlanHint(date); updateAttendanceTotal(); renderDateAttendanceSummary();
  }
  // Optional advance entered from the nightly sheet: one linked record per employee+night (source:'attendance'), editable/removable from the same row.
  function nightAdvances(date){ return data.advances.filter(a=>live(a)&&a.source==='attendance'&&a.date===date); }
  function syncNightAdvance(date,employeeId,amount){
    const id=`adv_att_${date}_${employeeId}`; const cur=data.advances.find(a=>a.id===id&&a.source==='attendance'); const liveCur=cur&&live(cur)?cur:null; amount=Math.max(0,Number(amount)||0);
    if(amount>0){ if(liveCur&&Number(liveCur.amount)===amount)return; const a=cur||{id,createdAt:nowISO()}; Object.assign(a,{employeeId,date,amount,source:'attendance',note:a.note||'ثبت شبانه',deductFromPayroll:true,updatedAt:nowISO(),deletedAt:null}); if(!cur)data.advances.push(a); }
    else if(liveCur){ liveCur.deletedAt=nowISO(); liveCur.updatedAt=liveCur.deletedAt; }
  }
  function renderPlanHint(date){ const box=$('#planHint'); if(!box)return; const pls=plannedOn(date), evs=data.events.filter(x=>live(x)&&x.date===date&&liveGroupOf(x.groupId)); if(!pls.length&&!evs.length){box.innerHTML='';return;} box.innerHTML=`<div class="attendance-hint plan-hint"><span class="hint-icon">▥</span><div class="plan-hint-body">${evs.length?`<div>مراسم این روز: ${evs.map(x=>`<b>${esc(liveGroupOf(x.groupId).name)}</b>`).join('، ')}</div>`:''}${pls.length?`<div>برنامه‌ریزی‌شده: ${pls.map(p=>`${esc(getEmployee(p.employeeId).name)}${liveGroupOf(p.groupId)?` (${esc(liveGroupOf(p.groupId).name)})`:''}`).join('، ')}</div>`:''}</div>${pls.length?`<button type="button" class="btn btn-outline btn-small" id="applyPlanBtn">تیک برنامه‌ریزی‌شده‌ها</button>`:''}</div>`; }
  function applyPlanToAttendance(){ const date=$('#attendanceDate').dataset.iso||todayISO(); const pm=new Map(plannedOn(date).map(p=>[p.employeeId,p])); let n=0; $$('#attendanceRows tr[data-att-emp]').forEach(tr=>{ const p=pm.get(tr.dataset.attEmp); if(!p)return; const cb=tr.querySelector('.att-check'); if(!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));} const gs=tr.querySelector('.att-group'); if(gs&&liveGroupOf(p.groupId))gs.value=p.groupId; else if(gs)gs.value=''; n++; }); updateAttendanceTotal(); toast(n?`${fa(n)} نفر طبق برنامه تیک خورد؛ بعد از بررسی ذخیره کنید.`:'کسی از برنامه‌ریزی‌شده‌ها در این لیست نیست.',n?'success':'info'); }  function updateAttendanceTotal() { const rows=$$('#attendanceRows tr[data-att-emp]'), checked=rows.filter(r=>r.querySelector('.att-check')?.checked);const sum=checked.reduce((s,r)=>s+numeric(r.querySelector('.att-amount')?.value),0);$('#attendanceSelectedCount').textContent=`${fa(checked.length)} نفر انتخاب شده`;$('#attendanceSelectedSum').textContent=money(sum); }
  function renderDateAttendanceSummary(){const date=$('#attendanceDate').dataset.iso||todayISO();const records=attList().filter(r=>r.date===date);const advMap=new Map(nightAdvances(date).map(a=>[a.employeeId,a]));$('#dateAttendanceSummary').innerHTML=records.length?`<div class="summary-list">${records.map(r=>{const e=getEmployee(r.employeeId);return `<div class="summary-line"><div class="summary-person"><div class="summary-avatar">${esc(safeInitial(e?.name))}</div><div><b>${esc(e?.name||'کارمند حذف‌شده')}</b><small>${esc(liveGroupOf(r.groupId)?.name||'بدون مجموعه')}${r.note?` · ${esc(r.note)}`:''}${advMap.get(r.employeeId)?` · مساعده ${money(advMap.get(r.employeeId).amount)}`:''}</small></div></div><div class="summary-pay">${money(r.payAmount)}</div></div>`}).join('')}</div>`:`<div class="empty-inline">برای این تاریخ هنوز حضوری ذخیره نشده است.</div>`;}
  function saveAttendance(){const date=$('#attendanceDate').dataset.iso||todayISO();const rows=$$('#attendanceRows tr[data-att-emp]');let saved=0,removed=0;
    rows.forEach(row=>{const employeeId=row.dataset.attEmp, checked=row.querySelector('.att-check').checked;
      // Same employee + same night is ONE record, no matter which group it was entered under.
      const same=data.attendances.filter(x=>live(x)&&x.date===date&&x.employeeId===employeeId).sort((x,y)=>attTime(y)-attTime(x));
      const newId=`att_${date}_${employeeId}`;
      let item=same[0]||data.attendances.find(x=>x.id===newId);
      if(checked){const pay=Math.max(0,numeric(row.querySelector('.att-amount').value));if(!item){item={id:newId,createdAt:nowISO()};data.attendances.push(item);}Object.assign(item,{date,groupId:row.querySelector('.att-group')?.value||'',employeeId,payAmount:pay,note:row.querySelector('.att-note').value.trim(),updatedAt:nowISO(),deletedAt:null});same.slice(1).forEach(d=>{d.deletedAt=nowISO();d.updatedAt=d.deletedAt;});saved++;}
      else if(same.length){same.forEach(d=>{d.deletedAt=nowISO();d.updatedAt=d.deletedAt;});removed++;}
      syncNightAdvance(date,employeeId,checked?numeric(row.querySelector('.att-advance')?.value):0);
    }); saveData();renderAttendance();renderDashboard();renderPayroll();renderReports();renderGroups();renderEmployees();toast(`${fa(saved)} حضور ذخیره شد${removed?` و ${fa(removed)} مورد از این شب حذف شد`:''}.`);
  }

  function renderEmployees(){const q=$('#employeeSearch').value.trim().toLocaleLowerCase('fa'),sf=$('#employeeStatusFilter').value||'active';const myAtt=id=>attList().filter(a=>a.employeeId===id);let emps=liveEmployees().filter(e=>(sf==='all'||(sf==='active'&&e.active!==false)||(sf==='inactive'&&e.active===false))&&(!q||`${e.name} ${e.role||''} ${e.phone||''}`.toLocaleLowerCase('fa').includes(q))).sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'));$('#employeeCount').textContent=`${fa(emps.length)} کارمند`;
    $('#employeesGrid').innerHTML=emps.length?emps.map(e=>{const mine=myAtt(e.id), allNight=mine.reduce((s,a)=>s+Number(a.payAmount||0),0);return `<article class="employee-card"><div class="employee-card-head"><div class="employee-avatar">${esc(safeInitial(e.name))}</div><div><h3>${esc(e.name)}</h3><p>${esc(e.role||'بدون سمت')}</p></div><span class="employee-status ${e.active===false?'inactive':''}">${e.active===false?'غیرفعال':'فعال'}</span></div><div class="employee-card-money"><div><small>حقوق تعریف‌شده</small><strong>${money(e.wageAmount)} <small>/${wagePeriodUnit(e.wagePeriod)}</small></strong></div><div class="night-total"><small>جمع حضورهای ثبت‌شده</small><strong>${money(allNight)}</strong></div></div><div class="employee-card-actions"><span class="soft-tag">${fa(mine.length)} شب ثبت‌شده</span><div class="card-action-group"><button class="icon-action" data-edit-employee="${esc(e.id)}" title="ویرایش">✎</button><button class="icon-action" data-toggle-employee="${esc(e.id)}" title="فعال/غیرفعال">${e.active===false?'✓':'Ⅱ'}</button><button class="icon-action" data-delete-employee="${esc(e.id)}" title="حذف">⌫</button></div></div></article>`}).join(''):`<div class="empty-inline" style="grid-column:1/-1"><b>کارمندی پیدا نشد</b>برای شروع یک کارمند اضافه کنید و حقوق او را مشخص کنید.<br><button class="btn btn-primary btn-small" id="emptyAddEmployee" style="margin-top:12px">＋ افزودن کارمند</button></div>`;
  }
  function renderGroups(){const groups=liveGroups();$('#groupsGrid').innerHTML=groups.length?groups.map((g,i)=>{const attend=attList().filter(a=>a.groupId===g.id), people=new Set(attend.map(a=>a.employeeId));return `<article class="group-card"><div class="group-card-top"><div class="group-icon">${['▦','⌂','▤','⌘'][i%4]}</div><div><h3>${esc(g.name)}</h3><p>${esc(g.description||'برچسب محل کار')}</p></div></div><div class="group-card-stats"><div><span>نیروهای حاضر</span><b>${fa(people.size)}</b></div><div><span>شب‌های ثبت‌شده</span><b>${fa(attend.length)}</b></div></div><div class="group-card-actions"><button class="btn btn-outline btn-small" data-group-attendance="${esc(g.id)}">ثبت حضور</button><button class="icon-action" data-edit-group="${esc(g.id)}" title="ویرایش">✎</button><button class="icon-action" data-delete-group="${esc(g.id)}" title="حذف">⌫</button></div></article>`}).join(''):`<div class="empty-inline" style="grid-column:1/-1"><b>هنوز مجموعه‌ای اضافه نکرده‌اید</b>از همین‌جا باغ رویال، باغ ماد یا سالن‌های دیگر را اضافه کنید.<br><button class="btn btn-primary btn-small" id="emptyAddGroup" style="margin-top:12px">＋ افزودن مجموعه</button></div>`;}

  function renderPayroll(){const from=$('#payrollFrom').dataset.iso||todayISO(),to=$('#payrollTo').dataset.iso||todayISO(),calc=calcPayroll(from,to);$('#payrollKpis').innerHTML=`<div class="payroll-kpi"><span>جمع حقوق شب‌کاری</span><strong>${money(calc.gross)}</strong></div><div class="payroll-kpi"><span>مساعده قابل کسر در بازه</span><strong>${money(calc.advances)}</strong></div><div class="payroll-kpi net"><span>خالص قابل پرداخت</span><strong>${money(calc.net)}</strong></div>`;
    const rows=calc.rows.filter(r=>r.gross||r.advance||!r.employee.deletedAt);$('#payrollTable').innerHTML=rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>شب‌کاری</th><th>جمع حقوق</th><th>مساعده</th><th>خالص پرداختی</th><th>محل شب‌ها (توضیحی)</th></tr></thead><tbody>${rows.map(r=>`<tr><td><div class="table-name"><span class="table-avatar">${esc(safeInitial(r.employee.name))}</span><b>${esc(r.employee.name||'کارمند حذف‌شده')}</b></div></td><td>${fa(r.nights)} شب</td><td>${money(r.gross)}</td><td>${r.advance?`<span style="color:var(--orange)">− ${money(r.advance)}</span>`:money(0)}</td><td><b>${money(r.gross-r.advance)}</b></td><td><small class="muted">${esc(groupBreakdown(r.records))}</small></td></tr>`).join('')}</tbody><tfoot><tr><td><b>جمع کل</b></td><td>${fa(calc.nights)} شب</td><td><b>${money(calc.gross)}</b></td><td><b>${money(calc.advances)}</b></td><td><b>${money(calc.net)}</b></td><td></td></tr></tfoot></table></div>`:`<div class="empty-inline"><b>برای این بازه اطلاعاتی نیست</b>حضور یا مساعده‌ای در بازه انتخاب‌شده ثبت نشده است.</div>`;
    const advs=recordsInRange(data.advances,from,to).sort((a,b)=>b.date.localeCompare(a.date));$('#advancesTable').innerHTML=advs.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>تاریخ</th><th>مبلغ</th><th>کسر از حقوق</th><th>یادداشت</th><th>مدیریت</th></tr></thead><tbody>${advs.map(a=>{const e=getEmployee(a.employeeId);return `<tr><td><b>${esc(e?.name||'کارمند حذف‌شده')}</b></td><td>${esc(jalaliShort(a.date))}</td><td><b>${money(a.amount)}</b></td><td><span class="${a.deductFromPayroll===false?'soft-tag':'status-tag'}">${a.deductFromPayroll===false?'خیر':'بله'}</span></td><td>${a.source==='attendance'?'<span class="soft-tag">ثبت شبانه</span> ':''}${esc(a.note&&!(a.source==='attendance'&&a.note==='ثبت شبانه')?a.note:(a.source==='attendance'?'':'—'))}</td><td><div class="card-action-group"><button class="icon-action" data-edit-advance="${esc(a.id)}" title="ویرایش">✎</button><button class="icon-action" data-delete-advance="${esc(a.id)}" title="حذف">⌫</button></div></td></tr>`}).join('')}</tbody></table></div>`:`<div class="empty-inline">در این بازه مساعده‌ای ثبت نشده است.</div>`;
  }
  function renderReports(){const today=todayISO(),start=new Date(parseISO(today));start.setDate(start.getDate()-9);const calc=calcPayroll(toISODate(start),today);$('#reportCards').innerHTML=`<div class="report-card"><span>کل شب‌های ثبت‌شده</span><strong>${fa(attList().length)}</strong></div><div class="report-card"><span>کل مبلغ حقوق شب‌کاری</span><strong>${money(attList().reduce((s,a)=>s+Number(a.payAmount||0),0))}</strong></div><div class="report-card"><span>خالص حقوق ۱۰ روز اخیر</span><strong>${money(calc.net)}</strong></div>`;
    const emps=liveEmployees().map(e=>({e,recs:attList().filter(a=>a.employeeId===e.id),nights:attList().filter(a=>a.employeeId===e.id).length,gross:attList().filter(a=>a.employeeId===e.id).reduce((s,a)=>s+Number(a.payAmount||0),0)})).sort((a,b)=>b.nights-a.nights);$('#reportEmployeeTable').innerHTML=emps.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>کل شب‌ها</th><th>جمع حقوق ثبت‌شده</th><th>محل شب‌ها (توضیحی)</th></tr></thead><tbody>${emps.map(x=>`<tr><td><div class="table-name"><span class="table-avatar">${esc(safeInitial(x.e.name))}</span><b>${esc(x.e.name)}</b></div></td><td>${fa(x.nights)}</td><td><b>${money(x.gross)}</b></td><td><small class="muted">${esc(groupBreakdown(x.recs))}</small></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-inline">برای تهیه گزارش ابتدا کارمند اضافه کنید.</div>`;}
  function renderSettings(){ $('#ghOwner').value=settings.ghOwner||'';$('#ghRepo').value=settings.ghRepo||'';$('#ghBranch').value=settings.ghBranch||'main';$('#ghPath').value=settings.ghPath||'data/atelier-yar.json';$('#ghToken').value=settings.ghToken||'';$('#lastSyncLabel').textContent=settings.lastSync?`آخرین همگام‌سازی: ${new Date(settings.lastSync).toLocaleString('fa-IR')}`:'هنوز همگام‌سازی انجام نشده';updateStorageStats();updateSyncIndicators(); }
  function updateStorageStats(){const node=$('#storageStats');if(node)node.textContent=`${fa(liveEmployees().length)} کارمند، ${fa(attList().length)} حضور، ${fa(data.advances.filter(live).length)} مساعده`}
  function updateSyncIndicators(){const configured=Boolean(settings.ghOwner&&settings.ghRepo&&settings.ghToken),connected=configured&&settings.syncState==='connected',failed=configured&&settings.syncState==='error';const dot=$('#syncDot');if(dot)dot.classList.toggle('connected',connected);const title=$('#syncMiniTitle'),text=$('#syncMiniText');if(title)title.textContent=connected?'GitHub متصل است':failed?'خطای همگام‌سازی':configured?'آماده همگام‌سازی':'همگام‌سازی محلی';if(text)text.textContent=connected?'همگام‌سازی فعال':failed?'اتصال را بررسی کنید':settings.lastSync?'آخرین اتصال ثبت‌شده':'اطلاعات روی این دستگاه';const st=$('#syncStatusTitle'),ss=$('#syncStatusText');if(st)st.textContent=connected?'اتصال آماده است':failed?'خطا در آخرین اتصال':configured?'تنظیمات اتصال ذخیره شده':'اتصال تنظیم نشده';if(ss)ss.textContent=connected?`آخرین سینک: ${settings.lastSync?new Date(settings.lastSync).toLocaleString('fa-IR'):'هنوز انجام نشده'}`:failed?'«بررسی اتصال» را بزنید و مجوز مخزن و اعتبار توکن را بررسی کنید.':configured?'برای بررسی تنظیمات، «بررسی اتصال» را بزنید.':'ابتدا مخزن خصوصی و توکن دسترسی محدود بسازید.';}

  function openModal(title,subtitle,body,actions=''){$('#modalRoot').innerHTML=`<div class="modal-backdrop" data-backdrop><section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div><h3>${title}</h3><p>${subtitle||''}</p></div><button class="modal-close" data-close-modal aria-label="بستن">×</button></div>${body}${actions}</section></div>`;openLayer('modal',()=>{$('#modalRoot').innerHTML='';});if(!IS_PHONE_LAYOUT()){const first=$('#modalRoot input:not([type=hidden]),#modalRoot select');if(first)first.focus();}}
  function closeModal(){if(!closeLayer('modal'))$('#modalRoot').innerHTML='';}
  function modalActions(label='ذخیره'){return `<div class="modal-actions"><button class="btn btn-primary" type="submit">${label}</button><button class="btn btn-outline" type="button" data-close-modal>انصراف</button></div>`}
  function employeeModal(id){const e=id?getEmployee(id):null;openModal(e?'ویرایش پروفایل کارمند':'افزودن کارمند',e?'اطلاعات و شرایط پرداخت را اصلاح کنید.':'اطلاعات اولیه و میزان حقوق را وارد کنید. نیروها بین همهٔ مجموعه‌ها مشترک‌اند.',`<form id="employeeForm" data-id="${esc(id||'')}" class="modal-form"><label class="field"><span>نام و نام خانوادگی *</span><input name="name" required maxlength="90" value="${esc(e?.name||'')}" placeholder="مثلاً علی رضایی"></label><label class="field"><span>سمت / توضیح کوتاه</span><input name="role" maxlength="70" value="${esc(e?.role||'')}" placeholder="مثلاً عکاس، نورپرداز"></label><label class="field"><span>شماره تماس (اختیاری)</span><input name="phone" maxlength="30" value="${esc(e?.phone||'')}" inputmode="tel" placeholder="۰۹۱۲..."></label><label class="field"><span>نوع حقوق</span><select name="wagePeriod"><option value="daily" ${(!e||e.wagePeriod==='daily')?'selected':''}>روزانه (هر شب کاری)</option><option value="weekly" ${e?.wagePeriod==='weekly'?'selected':''}>هفتگی (تقسیم بر ۷)</option><option value="monthly" ${e?.wagePeriod==='monthly'?'selected':''}>ماهانه (تقسیم بر ۳۰)</option></select></label><label class="field"><span>مبلغ حقوق تعریف‌شده *</span><input name="wageAmount" data-money type="text" inputmode="numeric" autocomplete="off" required value="${esc(e?.wageAmount!=null&&e?.wageAmount!==''?fmtMoneyInput(e.wageAmount):'')}" placeholder="مثلاً ۱۲۰۰۰۰۰"></label><label class="field"><span>مبلغ اختصاصی هر شب (اختیاری)</span><input name="nightRateOverride" data-money type="text" inputmode="numeric" autocomplete="off" value="${esc(e?.nightRateOverride?fmtMoneyInput(e.nightRateOverride):'')}" placeholder="در صورت تفاوت با نرخ پیش‌فرض"></label><label class="field"><span>وضعیت</span><select name="active"><option value="true" ${e?.active!==false?'selected':''}>فعال</option><option value="false" ${e?.active===false?'selected':''}>غیرفعال</option></select></label><label class="field full"><span>یادداشت</span><textarea name="note" maxlength="300" rows="2" placeholder="اطلاعات تکمیلی اختیاری">${esc(e?.note||'')}</textarea></label>${modalActions(e?'ذخیره تغییرات':'ساخت پروفایل')}</form>`);}
  function groupModal(id){const g=id?getGroup(id):null;openModal(g?'ویرایش مجموعه':'افزودن مجموعه',g?'نام و توضیحات مجموعه را اصلاح کنید.':'فقط برچسبی برای اینکه هر شب بدانید نیرو کجا بوده؛ حقوق جدا حساب نمی‌شود.',`<form id="groupForm" data-id="${esc(id||'')}" class="modal-form"><label class="field full"><span>نام مجموعه *</span><input name="name" required maxlength="90" value="${esc(g?.name||'')}" placeholder="مثلاً باغ رویال"></label><label class="field full"><span>توضیحات (اختیاری)</span><input name="description" maxlength="150" value="${esc(g?.description||'')}" placeholder="باغ، سالن یا محل برگزاری"></label>${modalActions(g?'ذخیره تغییرات':'افزودن مجموعه')}</form>`);}
  function advanceModal(id){const a=id?data.advances.find(x=>x.id===id):null;const emps=liveEmployees().sort((x,y)=>(x.name||'').localeCompare(y.name||'','fa'));const employeeId=a?.employeeId||emps[0]?.id||'';const date=a?.date||todayISO();openModal(a?'ویرایش مساعده':'ثبت مساعده','مبلغ پیش‌پرداخت را برای یک کارمند ثبت کنید.',`<form id="advanceForm" data-id="${esc(id||'')}" class="modal-form"><label class="field full"><span>کارمند *</span><select name="employeeId" id="advanceEmployee" required>${emps.map(e=>`<option value="${esc(e.id)}" ${e.id===employeeId?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label><label class="field"><span>تاریخ مساعده (شمسی)</span><div class="date-input-wrap"><input class="date-text" name="dateLabel" id="advanceDate" readonly value="${esc(jalaliDate(date))}"><input type="hidden" name="date" value="${esc(date)}"><button class="date-open" id="advanceDateOpen" type="button">▦</button><div class="calendar-pop" id="advanceCalendar"></div></div></label><label class="field"><span>مبلغ (تومان) *</span><input name="amount" data-money type="text" inputmode="numeric" autocomplete="off" required value="${esc(a?.amount?fmtMoneyInput(a.amount):'')}" placeholder="مثلاً ۵۰۰۰۰۰"></label><label class="field full"><span>یادداشت</span><input name="note" maxlength="160" value="${esc(a?.note||'')}" placeholder="مثلاً مساعده نیمه دوره"></label><label class="field full"><span>نحوه محاسبه</span><select name="deductFromPayroll"><option value="true" ${a?.deductFromPayroll!==false?'selected':''}>از حقوق همین بازه کسر شود</option><option value="false" ${a?.deductFromPayroll===false?'selected':''}>فقط ثبت شود؛ در جمع خالص کسر نشود</option></select></label>${modalActions(a?'ذخیره تغییرات':'ثبت مساعده')}</form>`);}
  function confirmDelete(title,body,onYes){openModal(title,'',`<p class="danger-copy">${body}</p><div class="modal-actions"><button class="btn btn-danger-outline" id="confirmDeleteBtn" type="button">حذف</button><button class="btn btn-outline" data-close-modal type="button">انصراف</button></div>`);$('#confirmDeleteBtn').addEventListener('click',()=>{onYes();closeModal();});}

  function bindEvents(){
    document.addEventListener('click',e=>{
      if(plannerClick(e))return;
      const nav=e.target.closest('[data-page]');if(nav){setPage(nav.dataset.page);return;}
      const go=e.target.closest('[data-go]');if(go){setPage(go.dataset.go);return;}
      if(e.target.closest('#themeToggle')){settings.theme=settings.theme==='dark'?'light':'dark';settings.themeChosen=true;saveSettings();return;}
      if(e.target.closest('#mobileMenu')||e.target.closest('#bnMore')){toggleMenu();return;}
      if(e.target.closest('#scrim')){handleBack();return;}
      const attToggle=e.target.closest('[data-att-toggle]');if(attToggle){const id=attToggle.dataset.attToggle,tr=attToggle.closest('tr'),open=!attExpanded.has(id);if(open)attExpanded.add(id);else attExpanded.delete(id);tr.classList.toggle('expanded',open);attToggle.textContent=open?'▴':'▾';attToggle.setAttribute('aria-expanded',open?'true':'false');return;}
      const nameCell=IS_PHONE_LAYOUT()&&e.target.closest('#attendanceRows td:nth-child(2)');if(nameCell){const cb=nameCell.closest('tr').querySelector('.att-check');if(cb){cb.checked=!cb.checked;cb.dispatchEvent(new Event('change',{bubbles:true}));}return;}
      if(e.target.matches('[data-close-modal]')||e.target.closest('[data-close-modal]')||e.target.matches('[data-backdrop]')){closeModal();return;}
      const editEmp=e.target.closest('[data-edit-employee]');if(editEmp){employeeModal(editEmp.dataset.editEmployee);return;}
      const delEmp=e.target.closest('[data-delete-employee]');if(delEmp){const id=delEmp.dataset.deleteEmployee,e=getEmployee(id);confirmDelete('حذف کارمند',`پروفایل «${esc(e?.name)}» از فهرست حذف می‌شود. سابقه‌های قبلی برای محاسبات حفظ می‌شوند.`,()=>{const x=getEmployee(id);x.deletedAt=nowISO();x.updatedAt=x.deletedAt;saveData();renderAll();toast('پروفایل کارمند حذف شد.');});return;}
      const toggleEmp=e.target.closest('[data-toggle-employee]');if(toggleEmp){const x=getEmployee(toggleEmp.dataset.toggleEmployee);x.active=x.active===false?true:false;x.updatedAt=nowISO();saveData();renderEmployees();renderDashboard();toast(x.active?'کارمند فعال شد.':'کارمند غیرفعال شد.');return;}
      const editGroup=e.target.closest('[data-edit-group]');if(editGroup){groupModal(editGroup.dataset.editGroup);return;}
      const delGroup=e.target.closest('[data-delete-group]');if(delGroup){const id=delGroup.dataset.deleteGroup,g=getGroup(id);confirmDelete('حذف مجموعه',`مجموعه «${esc(g?.name)}» از فهرست حذف می‌شود. سوابق حضور و حقوق پاک نمی‌شوند؛ فقط برچسب مجموعه از آن شب‌ها نمایش داده نمی‌شود.`,()=>{const x=getGroup(id);x.deletedAt=nowISO();x.updatedAt=x.deletedAt;saveData();renderAll();toast('مجموعه حذف شد.');});return;}
      const groupAtt=e.target.closest('[data-group-attendance]');if(groupAtt){setPage('attendance');settings.lastAttGroup=groupAtt.dataset.groupAttendance;localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));renderAttendance();return;}
      const editAdv=e.target.closest('[data-edit-advance]');if(editAdv){advanceModal(editAdv.dataset.editAdvance);return;}
      const delAdv=e.target.closest('[data-delete-advance]');if(delAdv){const id=delAdv.dataset.deleteAdvance;confirmDelete('حذف مساعده','این مساعده از محاسبات بعدی حذف می‌شود. سوابق به‌صورت نرم حذف می‌شود تا همگام‌سازی درست بماند.',()=>{const a=data.advances.find(x=>x.id===id);a.deletedAt=nowISO();a.updatedAt=a.deletedAt;saveData();renderAll();toast('مساعده حذف شد.');});return;}
      const calBtn=e.target.closest('[data-calendar]');if(calBtn){showCalendar(calBtn.dataset.calendar,calBtn.nextElementSibling);return;}
      if(e.target.closest('#attendanceDateOpen')){showCalendar('attendanceDate',$('#attendanceCalendar'));return;}
      if(e.target.closest('#advanceDateOpen')){showCalendar('advanceDate',$('#advanceCalendar'),true);return;}
      if(e.target.closest('#addEmployee')||e.target.closest('#emptyAddEmployee')){employeeModal();return;}
      if(e.target.closest('#applyPlanBtn')){applyPlanToAttendance();return;}
      if(e.target.closest('#addGroup')||e.target.closest('#emptyAddGroup')){groupModal();return;}
      if(e.target.closest('[data-quick-advance]')){if(!liveEmployees().length){toast('برای ثبت مساعده ابتدا یک کارمند بسازید.','error');setPage('employees');return;}setPage('payroll');advanceModal();return;}
      if(e.target.closest('#addAdvance')){if(!liveEmployees().length){toast('برای ثبت مساعده ابتدا یک کارمند بسازید.','error');setPage('employees');return;}advanceModal();return;}
      const theme=e.target.closest('#themeSegment [data-theme]');if(theme){settings.theme=theme.dataset.theme;settings.themeChosen=true;saveSettings();return;}
      const accent=e.target.closest('.swatches [data-accent]');if(accent){settings.accent=accent.dataset.accent;saveSettings();return;}
    });
    document.addEventListener('change',e=>{
      if(e.target.matches('.att-check')){const tr=e.target.closest('tr'),id=tr.dataset.attEmp;tr.classList.toggle('present-row',e.target.checked);tr.querySelector('.att-amount').disabled=!e.target.checked;tr.querySelector('.att-note').disabled=!e.target.checked;tr.querySelector('.att-advance').disabled=!e.target.checked;const gs=tr.querySelector('.att-group');if(gs){gs.disabled=!e.target.checked;if(e.target.checked&&!gs.value)gs.value=(liveGroupOf(settings.lastAttGroup)?settings.lastAttGroup:'');}const tgl=tr.querySelector('.att-toggle');if(tgl){const open=e.target.checked;if(open)attExpanded.add(id);else attExpanded.delete(id);tr.classList.toggle('expanded',open);tgl.textContent=open?'▴':'▾';tgl.setAttribute('aria-expanded',open?'true':'false');}updateAttendanceTotal();}
      if(e.target.matches('.att-amount'))updateAttendanceTotal();
      if(e.target.matches('.att-group')){settings.lastAttGroup=e.target.value;localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}
      if(e.target.matches('#attendanceSearch'))renderAttendance();
      if(e.target.matches('#plApplyGroup'))planner.applyGroup=e.target.value;
      if(e.target.matches('#employeeSearch,#employeeStatusFilter'))renderEmployees();
      if(e.target.matches('#currencySetting')){settings.currency=e.target.value;saveSettings();renderAll();}
      if(e.target.matches('#importBackupFile'))importBackup(e.target.files?.[0]);
    });
    document.addEventListener('input',e=>{if(e.target.matches('[data-money]'))formatMoneyField(e.target);if(e.target.matches('.att-amount'))updateAttendanceTotal();if(e.target.matches('#employeeSearch'))renderEmployees();if(e.target.matches('#attendanceSearch'))renderAttendance();});
    document.addEventListener('submit',e=>{const f=e.target;if(f.id==='employeeForm'){e.preventDefault();submitEmployee(f);}if(f.id==='groupForm'){e.preventDefault();submitGroup(f);}if(f.id==='advanceForm'){e.preventDefault();submitAdvance(f);}});
    $('#saveAttendance').addEventListener('click',saveAttendance);
    $('#attendanceDate').addEventListener('click',()=>showCalendar('attendanceDate',$('#attendanceCalendar')));
    $('#applyPayroll').addEventListener('click',()=>{renderPayroll();toast('محاسبه حقوق برای بازه انتخاب‌شده به‌روزرسانی شد.');});
    $('#quickLast10').addEventListener('click',()=>{const s=parseISO(todayISO());s.setDate(s.getDate()-9);$('#payrollFrom').dataset.iso=toISODate(s);$('#payrollTo').dataset.iso=todayISO();$('#payrollFrom').value=jalaliDate($('#payrollFrom').dataset.iso);$('#payrollTo').value=jalaliDate($('#payrollTo').dataset.iso);renderPayroll();});
    $('#quickCurrentMonth').addEventListener('click',()=>{const p=jalaliTodayParts();$('#payrollFrom').dataset.iso=isoFromJalali(p.year,p.month,1);$('#payrollTo').dataset.iso=todayISO();$('#payrollFrom').value=jalaliDate($('#payrollFrom').dataset.iso);$('#payrollTo').value=jalaliDate($('#payrollTo').dataset.iso);renderPayroll();});
    $('#exportPayrollCsv').addEventListener('click',exportPayrollCsv);$('#exportBackup').addEventListener('click',exportBackup);$('#backupBtn').addEventListener('click',exportBackup);
    $('#testGitHub').addEventListener('click',async()=>{saveGitHubFields();await testGitHub();});$('#syncNow').addEventListener('click',async()=>{saveGitHubFields();await syncNow();});
    $('#toggleToken').addEventListener('click',()=>{const i=$('#ghToken');i.type=i.type==='password'?'text':'password';$('#toggleToken').textContent=i.type==='password'?'نمایش':'پنهان';});
    $('#clearToken').addEventListener('click',()=>{if(confirm('توکن فقط از این دستگاه پاک شود؟')){settings.ghToken='';settings.syncState='local';saveSettings();renderSettings();toast('توکن از این دستگاه پاک شد.');}});
    $('#resetData').addEventListener('click',()=>{if(confirm('همه مجموعه‌ها، کارکنان، حضورها و مساعده‌ها حذف شوند؟ اگر GitHub Sync فعال است، حذف‌ها در همگام‌سازی بعدی نیز منتقل می‌شوند. ابتدا از اطلاعات پشتیبان بگیرید.')){const stamp=nowISO();syncCollections.forEach(k=>data[k].forEach(item=>{if(!item.deletedAt){item.deletedAt=stamp;item.updatedAt=stamp;}}));data.meta={...(data.meta||{}),updatedAt:stamp};saveData();renderAll();toast('اطلاعات حذف شدند؛ در سینک بعدی حذف‌ها منتقل می‌شوند.');}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')handleBack();});
    document.addEventListener('focusin',e=>{if(IS_PHONE_LAYOUT()&&e.target.matches('input,select,textarea')){setTimeout(()=>{try{e.target.scrollIntoView({block:'center',behavior:'smooth'});}catch(_){}},320);}});
    document.addEventListener('click',e=>{if(layerOpen('calendar')&&!e.target.closest('.calendar-pop')&&!e.target.closest('.date-input-wrap')){e.stopPropagation();e.preventDefault();closeLayer('calendar');}},true);
  }
  function submitEmployee(form){const fd=new FormData(form),id=form.dataset.id,name=String(fd.get('name')||'').trim();if(!name){toast('نام کارمند را وارد کنید.','error');return;}const e=id?getEmployee(id):{id:makeId('emp'),createdAt:nowISO()};Object.assign(e,{name,role:String(fd.get('role')||'').trim(),phone:String(fd.get('phone')||'').trim(),wagePeriod:String(fd.get('wagePeriod')||'daily'),wageAmount:Math.max(0,numeric(fd.get('wageAmount'))),nightRateOverride:Math.max(0,numeric(fd.get('nightRateOverride'))),active:fd.get('active')!=='false',note:String(fd.get('note')||'').trim(),updatedAt:nowISO(),deletedAt:null});if(!id)data.employees.push(e);saveData();closeModal();renderAll();toast(id?'تغییرات کارمند ذخیره شد.':'پروفایل کارمند ساخته شد.');}
  function submitGroup(form){const fd=new FormData(form),id=form.dataset.id,name=String(fd.get('name')||'').trim();if(!name){toast('نام مجموعه را وارد کنید.','error');return;}const duplicate=liveGroups().some(g=>g.name.toLocaleLowerCase('fa')===name.toLocaleLowerCase('fa')&&g.id!==id);if(duplicate){toast('مجموعه‌ای با این نام از قبل وجود دارد.','error');return;}const g=id?getGroup(id):{id:makeId('grp'),createdAt:nowISO()};Object.assign(g,{name,description:String(fd.get('description')||'').trim(),updatedAt:nowISO(),deletedAt:null});if(!id)data.groups.push(g);saveData();closeModal();renderAll();toast(id?'مجموعه ویرایش شد.':'مجموعه اضافه شد.');}
  function submitAdvance(form){const fd=new FormData(form),id=form.dataset.id,employeeId=String(fd.get('employeeId')||''),date=String(fd.get('date')||todayISO()),amount=numeric(fd.get('amount'));if(!employeeId||amount<=0){toast('کارمند و مبلغ معتبر را وارد کنید.','error');return;}const a=id?data.advances.find(x=>x.id===id):{id:makeId('adv'),createdAt:nowISO()};Object.assign(a,{employeeId,date,amount,note:String(fd.get('note')||'').trim(),deductFromPayroll:fd.get('deductFromPayroll')!=='false',updatedAt:nowISO(),deletedAt:null});if(!id)data.advances.push(a);saveData();closeModal();renderAll();toast(id?'مساعده ویرایش شد.':'مساعده ثبت شد.');}

  let currentCalendar={inputId:null,monthYear:null,month:null,modal:false};
  function showCalendar(inputId,container,modal=false){if(!container){container=inputId==='attendanceDate'?$('#attendanceCalendar'):$(`#calendar-${inputId}`);}if(!container)return;const input=inputId==='advanceDate'?$('#advanceDate'):$('#'+inputId),iso=inputId==='advanceDate'?$('#advanceForm input[name="date"]')?.value:input?.dataset.iso;const p=jpISO(iso||todayISO());currentCalendar={inputId,container,year:p.year,month:p.month,modal};renderCalendar();$$('.calendar-pop.open').forEach(c=>{if(c!==container)c.classList.remove('open');});container.classList.add('open');openLayer('calendar',()=>$$('.calendar-pop.open').forEach(c=>c.classList.remove('open')));}
  function renderCalendar(){const {inputId,container,year,month}=currentCalendar;if(!container)return;const monthNames=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];const days=jalaliMonthDays(year,month),first=days[0],offset=first?.weekday||0,selectedIso=inputId==='advanceDate'?$('#advanceForm input[name="date"]')?.value:(inputId==='attendanceDate'?$('#attendanceDate').dataset.iso:$('#'+inputId)?.dataset.iso),today=todayISO();let cells='';for(let i=0;i<offset;i++)cells+='<span class="calendar-day blank"></span>';for(const d of days){cells+=`<button type="button" class="calendar-day ${d.iso===selectedIso?'chosen':''} ${d.iso===today?'today':''}" data-calendar-day="${d.iso}">${toFa(d.day)}</button>`;}container.innerHTML=`<div class="calendar-head"><button class="calendar-nav" type="button" data-month-step="-1">‹</button><strong>${monthNames[month-1]} ${toFa(year)}</strong><button class="calendar-nav" type="button" data-month-step="1">›</button></div><div class="calendar-grid"><span class="calendar-weekday">ش</span><span class="calendar-weekday">ی</span><span class="calendar-weekday">د</span><span class="calendar-weekday">س</span><span class="calendar-weekday">چ</span><span class="calendar-weekday">پ</span><span class="calendar-weekday">ج</span>${cells}</div>`;
    container.querySelectorAll('[data-month-step]').forEach(b=>b.addEventListener('click',()=>{let m=currentCalendar.month+Number(b.dataset.monthStep),y=currentCalendar.year;if(m<1){m=12;y--}if(m>12){m=1;y++}currentCalendar.month=m;currentCalendar.year=y;renderCalendar();}));
    container.querySelectorAll('[data-calendar-day]').forEach(b=>b.addEventListener('click',()=>{const chosen=b.dataset.calendarDay;if(inputId==='advanceDate'){const f=$('#advanceForm');f.querySelector('[name="date"]').value=chosen;$('#advanceDate').value=jalaliDate(chosen);}else{const input=$('#'+inputId);input.dataset.iso=chosen;input.value=jalaliDate(chosen);if(inputId==='attendanceDate'){renderAttendance();}else if(inputId==='payrollFrom'||inputId==='payrollTo'){renderPayroll();}}closeLayer('calendar');}));
  }


  /* ---------- Planner: تقویم برنامه‌ریزی (نیروها + مراسم مجموعه‌ها) ---------- */
  const MONTHS=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const WEEKDAYS=['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
  const planner={year:0,month:0,mode:'emp',range:'all',empId:'',grpId:'all',applyGroup:null};
  const groupColor=id=>{ if(!id)return 'var(--muted)'; const i=Math.max(0,liveGroups().findIndex(g=>g.id===id)); return `hsl(${(i*83+255)%360} 62% 52%)`; };
  const plannerDays=()=>jalaliMonthDays(planner.year,planner.month).filter(d=>planner.range==='all'||(planner.range==='1'&&d.day<=10)||(planner.range==='2'&&d.day>10&&d.day<=20)||(planner.range==='3'&&d.day>20));
  function plansByKey(){ const m=new Map(); data.plans.forEach(p=>{ const e=getEmployee(p.employeeId); if(live(p)&&e&&live(e)) m.set(`${p.date}|${p.employeeId}`,p); }); return m; }
  function eventsByDate(){ const m=new Map(); data.events.forEach(ev=>{ if(!live(ev)||!liveGroupOf(ev.groupId))return; if(!m.has(ev.date))m.set(ev.date,[]); m.get(ev.date).push(ev); }); return m; }
  const plannedOn=date=>data.plans.filter(p=>live(p)&&p.date===date&&getEmployee(p.employeeId)&&live(getEmployee(p.employeeId)));
  function planUpsert(date,empId,groupId){ const id=`plan_${date}_${empId}`; let it=data.plans.find(p=>p.id===id); if(!it){it={id,createdAt:nowISO()};data.plans.push(it);} Object.assign(it,{date,employeeId:empId,groupId:groupId||'',updatedAt:nowISO(),deletedAt:null}); }
  function planRemove(date,empId){ const it=data.plans.find(p=>p.id===`plan_${date}_${empId}`); if(it&&live(it)){it.deletedAt=nowISO();it.updatedAt=it.deletedAt;} }
  function eventSet(date,groupId,on){ const id=`ev_${date}_${groupId}`; let it=data.events.find(x=>x.id===id); if(on){ if(!it){it={id,createdAt:nowISO()};data.events.push(it);} Object.assign(it,{date,groupId,updatedAt:nowISO(),deletedAt:null}); } else if(it&&live(it)){ it.deletedAt=nowISO(); it.updatedAt=it.deletedAt; } }
  const chip=(text,gid)=>`<span class="pl-chip" style="--gc:${groupColor(gid)}">${esc(text)}</span>`;
  const dayLabel=d=>`${WEEKDAYS[d.weekday]} ${toFa(d.day)} ${MONTHS[planner.month-1]}`;
  function renderPlanner(){
    const root=$('#plannerRoot'); if(!root)return;
    if(!planner.year){ const t=jalaliTodayParts(); planner.year=t.year; planner.month=t.month; }
    const emps=activeEmployees().sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa')), groups=liveGroups();
    if(!emps.some(e=>e.id===planner.empId)) planner.empId=emps[0]?.id||'';
    if(planner.grpId!=='all'&&!groups.some(g=>g.id===planner.grpId)) planner.grpId='all';
    if(planner.applyGroup===null||(planner.applyGroup&&!liveGroupOf(planner.applyGroup))) planner.applyGroup=(liveGroupOf(settings.lastAttGroup)?settings.lastAttGroup:(groups[0]?.id||''));
    const days=plannerDays(), pm=plansByKey(), ev=eventsByDate(), today=todayISO();
    const rangeBtn=(v,l)=>`<button type="button" data-pl-range="${v}" class="${planner.range===v?'active':''}">${l}</button>`;
    const modeBtn=(v,l)=>`<button type="button" data-pl-mode="${v}" class="${planner.mode===v?'active':''}">${l}</button>`;
    let html=`<div class="pl-toolbar"><div class="pl-month"><button type="button" class="calendar-nav" data-pl-month="-1" aria-label="ماه قبل">›</button><strong>${MONTHS[planner.month-1]} ${toFa(planner.year)}</strong><button type="button" class="calendar-nav" data-pl-month="1" aria-label="ماه بعد">‹</button><button type="button" class="btn btn-quiet btn-small" data-pl-today>این ماه</button></div><div class="segmented pl-seg">${rangeBtn('all','کل ماه')}${rangeBtn('1','۱ تا ۱۰')}${rangeBtn('2','۱۱ تا ۲۰')}${rangeBtn('3','۲۱ تا آخر')}</div><div class="segmented pl-seg">${modeBtn('emp','برنامهٔ نیروها')}${modeBtn('grp','مراسم مجموعه‌ها')}</div></div>`;
    // ----- picker
    if(planner.mode==='emp'){
      html+=`<div class="pl-picker"><div class="pl-picker-title">کارمند را انتخاب کنید</div>`;
      html+=emps.length?`<div class="pl-chips">${emps.map(e=>{const n=days.filter(d=>pm.has(`${d.iso}|${e.id}`)).length;return `<button type="button" class="pl-pick ${e.id===planner.empId?'active':''}" data-pl-emp="${esc(e.id)}">${esc(e.name)}${n?`<small>${fa(n)} روز</small>`:''}</button>`;}).join('')}</div>`:`<div class="empty-inline">ابتدا از بخش کارکنان یک کارمند اضافه کنید.</div>`;
      html+=`<div class="pl-apply"><label class="field"><span>مجموعه برای روزهایی که تیک می‌زنید</span><select id="plApplyGroup"><option value="" ${!planner.applyGroup?'selected':''}>بدون مجموعه</option>${groups.map(g=>`<option value="${esc(g.id)}" ${g.id===planner.applyGroup?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label><div class="button-row"><button type="button" class="btn btn-outline btn-small" data-pl-fill>همهٔ روزهای نمایش‌داده‌شده</button><button type="button" class="btn btn-danger-outline" data-pl-clear>پاک‌کردن این بازه</button></div></div></div>`;
    } else {
      html+=`<div class="pl-picker"><div class="pl-picker-title">مجموعه را انتخاب کنید</div>`;
      if(groups.length){
        const allN=days.filter(d=>(ev.get(d.iso)||[]).length>0).length;
        html+=`<div class="pl-chips"><button type="button" class="pl-pick all ${planner.grpId==='all'?'active':''}" data-pl-grp="all"><i class="pl-dot all"></i>همهٔ مجموعه‌ها${allN?`<small>${fa(allN)} روز</small>`:''}</button>${groups.map(g=>{const n=days.filter(d=>data.events.some(x=>live(x)&&x.date===d.iso&&x.groupId===g.id)).length;return `<button type="button" class="pl-pick ${g.id===planner.grpId?'active':''}" style="--gc:${groupColor(g.id)}" data-pl-grp="${esc(g.id)}"><i class="pl-dot"></i>${esc(g.name)}${n?`<small>${fa(n)} مراسم</small>`:''}</button>`;}).join('')}</div>`;
        html+=planner.grpId==='all'?`<p class="muted" style="margin:12px 0 0">این حالت فقط نمایش کلی روزهای مراسم همهٔ مجموعه‌هاست؛ برای ثبت یا حذف مراسم یک مجموعهٔ مشخص را از بالا انتخاب کنید.</p>`:`<div class="pl-apply"><div class="button-row"><button type="button" class="btn btn-outline btn-small" data-pl-fill>همهٔ روزهای نمایش‌داده‌شده</button><button type="button" class="btn btn-danger-outline" data-pl-clear>پاک‌کردن این بازه</button></div></div>`;
      } else {
        html+=`<div class="empty-inline">ابتدا از بخش مجموعه‌ها یک مجموعه بسازید.</div>`;
      }
      html+=`</div>`;
    }
    // ----- grid
    const selEmp=getEmployee(planner.empId), selGrp=getGroup(planner.grpId);
    const offset=days[0]?.weekday||0;
    let cells='';
    for(let i=0;i<offset;i++) cells+='<span class="pl-day blank"></span>';
    days.forEach(d=>{
      const isToday=d.iso===today, wk=d.weekday===6?' weekend':'', evs=ev.get(d.iso)||[];
      if(planner.mode==='emp'){
        const pl=planner.empId?pm.get(`${d.iso}|${planner.empId}`):null;
        cells+=`<button type="button" class="pl-day${pl?' planned':''}${isToday?' today':''}${wk}" ${pl?`style="--gc:${groupColor(pl.groupId)}"`:''} data-pl-day="${d.iso}"><span class="pl-num">${toFa(d.day)}</span>${pl?`<span class="pl-tag">${esc(liveGroupOf(pl.groupId)?.name||'حاضر')}</span>`:''}${evs.length?`<span class="pl-ev">★ ${esc(evs.map(x=>liveGroupOf(x.groupId).name).join('، '))}</span>`:''}</button>`;
      } else if(planner.grpId==='all'){
        const dayGroupIds=[...new Set(evs.map(x=>x.groupId))];
        cells+=`<button type="button" class="pl-day${dayGroupIds.length?' planned multi':''}${isToday?' today':''}${wk}" data-pl-day="${d.iso}"><span class="pl-num">${toFa(d.day)}</span>${dayGroupIds.length?`<span class="pl-multidots">${dayGroupIds.map(gid=>`<i class="pl-dot" style="--gc:${groupColor(gid)}"></i>`).join('')}</span><span class="pl-ev">${esc(dayGroupIds.map(gid=>liveGroupOf(gid)?.name).filter(Boolean).join('، '))}</span>`:''}</button>`;
      } else {
        const on=evs.some(x=>x.groupId===planner.grpId), people=plannedOn(d.iso).filter(p=>p.groupId===planner.grpId).length;
        cells+=`<button type="button" class="pl-day${on?' planned':''}${isToday?' today':''}${wk}" ${on?`style="--gc:${groupColor(planner.grpId)}"`:''} data-pl-day="${d.iso}"><span class="pl-num">${toFa(d.day)}</span>${on?`<span class="pl-tag">مراسم</span>`:''}${people?`<span class="pl-ev ppl">${fa(people)} نیرو</span>`:''}</button>`;
      }
    });
    const head=['ش','ی','د','س','چ','پ','ج'].map((w,i)=>`<span class="pl-wd${i===6?' weekend':''}">${w}</span>`).join('');
    const hint=planner.mode==='emp'?(selEmp?`روی هر روز بزنید تا حضور «${esc(selEmp.name)}» تیک بخورد؛ دوباره بزنید تا برداشته شود. اگر مجموعهٔ بالا را عوض کنید و روی روز تیک‌خورده بزنید، فقط مجموعهٔ آن روز عوض می‌شود.`:''):(planner.grpId==='all'?'رنگ هر مجموعه در تقویم ثابت است؛ اگر روزی چند مجموعه مراسم داشته باشند، همهٔ رنگ‌ها و نام‌ها با هم نشان داده می‌شوند.':(selGrp?`روی روزهایی که «${esc(selGrp.name)}» مراسم دارد بزنید؛ دوباره بزنید تا برداشته شود.`:''));
    html+=`<div class="pl-grid-wrap"><div class="pl-grid pl-head">${head}</div><div class="pl-grid">${cells}</div></div>${hint?`<p class="pl-hint">${hint}</p>`:''}`;
    // ----- selected group's ceremony days
    if(planner.mode==='grp'&&selGrp){
      const mine=jalaliMonthDays(planner.year,planner.month).filter(d=>data.events.some(x=>live(x)&&x.date===d.iso&&x.groupId===selGrp.id));
      html+=`<div class="pl-ceremony" style="--gc:${groupColor(selGrp.id)}"><b>روزهای مراسم ${esc(selGrp.name)} در ${MONTHS[planner.month-1]}:</b> ${mine.length?mine.map(d=>`<span class="pl-chip" style="--gc:${groupColor(selGrp.id)}">${toFa(d.day)} ${MONTHS[planner.month-1]}</span>`).join(' '):'<span class="muted">هنوز روزی تیک نخورده است.</span>'}</div>`;
    }
    // ----- summary of the visible range
    const rows=days.map(d=>{ const evs=ev.get(d.iso)||[], pls=plannedOn(d.iso); if(!evs.length&&!pls.length)return ''; const people=pls.sort((a,b)=>(getEmployee(a.employeeId)?.name||'').localeCompare(getEmployee(b.employeeId)?.name||'','fa')).map(p=>chip(`${getEmployee(p.employeeId).name}${liveGroupOf(p.groupId)?` · ${liveGroupOf(p.groupId).name}`:''}`,p.groupId)).join(''); return `<div class="pl-row"><div class="pl-row-day"><b>${dayLabel(d)}</b><small>${pls.length?`${fa(pls.length)} نیرو`:'بدون نیرو'}</small></div><div class="pl-row-body">${evs.length?`<div class="pl-row-ev">${evs.map(x=>`<span class="pl-chip ev" style="--gc:${groupColor(x.groupId)}">★ مراسم ${esc(liveGroupOf(x.groupId).name)}</span>`).join('')}</div>`:''}<div class="pl-row-people">${people||'<span class="muted">—</span>'}</div></div></div>`; }).join('');
    html+=`<div class="pl-summary"><div class="panel-head"><div><h3>خلاصهٔ برنامه</h3><p class="muted">روزهایی از بازهٔ انتخاب‌شده که نیرو یا مراسم دارند</p></div></div>${rows||'<div class="empty-inline">برای این بازه هنوز برنامه‌ای ثبت نشده است.</div>'}</div>`;
    root.innerHTML=html;
  }
  function plannerClick(e){
    const t=e.target; let el;
    if((el=t.closest('[data-pl-day]'))){
      const iso=el.dataset.plDay;
      if(planner.mode==='emp'){
        if(!planner.empId){toast('ابتدا یک کارمند انتخاب کنید.','error');return true;}
        const cur=plansByKey().get(`${iso}|${planner.empId}`), ag=planner.applyGroup||'';
        if(cur&&(cur.groupId||'')===ag) planRemove(iso,planner.empId); else planUpsert(iso,planner.empId,ag);
      } else {
        if(planner.grpId==='all'){toast('برای ثبت یا حذف مراسم، یک مجموعهٔ مشخص را از بالا انتخاب کنید.','info');return true;}
        if(!planner.grpId){toast('ابتدا یک مجموعه بسازید و انتخاب کنید.','error');return true;}
        eventSet(iso,planner.grpId,!data.events.some(x=>live(x)&&x.date===iso&&x.groupId===planner.grpId));
      }
      saveData(); renderPlanner(); return true;
    }
    if((el=t.closest('[data-pl-month]'))){ let m=planner.month+Number(el.dataset.plMonth),y=planner.year; if(m<1){m=12;y--} if(m>12){m=1;y++} planner.month=m;planner.year=y; renderPlanner(); return true; }
    if(t.closest('[data-pl-today]')){ const p=jalaliTodayParts(); planner.year=p.year; planner.month=p.month; renderPlanner(); return true; }
    if((el=t.closest('[data-pl-range]'))){ planner.range=el.dataset.plRange; renderPlanner(); return true; }
    if((el=t.closest('[data-pl-mode]'))){ planner.mode=el.dataset.plMode; renderPlanner(); return true; }
    if((el=t.closest('[data-pl-emp]'))){ planner.empId=el.dataset.plEmp; renderPlanner(); return true; }
    if((el=t.closest('[data-pl-grp]'))){ planner.grpId=el.dataset.plGrp; renderPlanner(); return true; }
    if(t.closest('[data-pl-fill]')){
      const days=plannerDays();
      if(planner.mode==='emp'){ if(!planner.empId)return true; days.forEach(d=>planUpsert(d.iso,planner.empId,planner.applyGroup||'')); }
      else { if(!planner.grpId||planner.grpId==='all')return true; days.forEach(d=>eventSet(d.iso,planner.grpId,true)); }
      saveData(); renderPlanner(); toast('روزهای این بازه تیک خورد.'); return true;
    }
    if(t.closest('[data-pl-clear]')){
      const days=plannerDays(), label=planner.range==='all'?'این ماه':'این بازه';
      if(planner.mode==='emp'){ if(!planner.empId)return true; const n=days.filter(d=>plansByKey().has(`${d.iso}|${planner.empId}`)).length; if(!n){toast('در این بازه روز تیک‌خورده‌ای نیست.','info');return true;} if(!confirm(`همهٔ روزهای برنامه‌ریزی‌شدهٔ این کارمند در ${label} پاک شود؟`))return true; days.forEach(d=>planRemove(d.iso,planner.empId)); }
      else { if(!planner.grpId||planner.grpId==='all')return true; const n=days.filter(d=>data.events.some(x=>live(x)&&x.date===d.iso&&x.groupId===planner.grpId)).length; if(!n){toast('در این بازه مراسمی تیک نخورده است.','info');return true;} if(!confirm(`همهٔ مراسم‌های این مجموعه در ${label} پاک شود؟`))return true; days.forEach(d=>eventSet(d.iso,planner.grpId,false)); }
      saveData(); renderPlanner(); toast('پاک شد.'); return true;
    }
    return false;
  }

  function backupObject(){return {app:'AtelierYar',schemaVersion:1,exportedAt:nowISO(),data:JSON.parse(JSON.stringify(data)),preferences:{theme:settings.theme,accent:settings.accent,currency:settings.currency}};}
  function downloadBlob(filename,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function exportBackup(){const blob=new Blob([JSON.stringify(backupObject(),null,2)],{type:'application/json;charset=utf-8'});downloadBlob(`AtelierYar-backup-${todayISO()}.json`,blob);toast('نسخه پشتیبان آماده شد.');}
  async function importBackup(file){if(!file)return;try{const parsed=JSON.parse(await file.text()),incoming=parsed.data||parsed;if(!incoming||!Array.isArray(incoming.groups)||!Array.isArray(incoming.employees)||!Array.isArray(incoming.attendances)||!Array.isArray(incoming.advances))throw new Error('ساختار فایل معتبر نیست');if(!confirm('اطلاعات فعلی با محتوای فایل پشتیبان جایگزین شود؟ قبل از ادامه می‌توانید از داده فعلی خروجی بگیرید.'))return;data={schemaVersion:1,groups:incoming.groups,employees:incoming.employees,attendances:incoming.attendances,advances:incoming.advances,plans:Array.isArray(incoming.plans)?incoming.plans:[],events:Array.isArray(incoming.events)?incoming.events:[],meta:incoming.meta||{updatedAt:nowISO()}};saveData();renderAll();toast('بازیابی پشتیبان انجام شد.');}catch(err){toast(`فایل پشتیبان خوانده نشد: ${err.message}`,'error',6000);}finally{$('#importBackupFile').value='';}}
  function exportPayrollCsv(){const from=$('#payrollFrom').dataset.iso||todayISO(),to=$('#payrollTo').dataset.iso||todayISO(),c=calcPayroll(from,to);const lines=[['کارمند','تعداد شب','جمع حقوق','مساعده','خالص پرداختی','محل شب‌ها'],...c.rows.map(r=>[r.employee.name||'کارمند حذف‌شده',r.nights,Math.round(r.gross),Math.round(r.advance),Math.round(r.gross-r.advance),groupBreakdown(r.records)])];const csv='\ufeff'+lines.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');downloadBlob(`AtelierYar-payroll-${from}-${to}.csv`,new Blob([csv],{type:'text/csv;charset=utf-8'}));toast('خروجی CSV آماده شد.');}

  function saveGitHubFields(){settings.ghOwner=$('#ghOwner').value.trim();settings.ghRepo=$('#ghRepo').value.trim();settings.ghBranch=$('#ghBranch').value.trim()||'main';settings.ghPath=$('#ghPath').value.trim()||'data/atelier-yar.json';settings.ghToken=$('#ghToken').value.trim();settings.syncState='local';saveSettings();}
  function githubConfigValid(){return settings.ghOwner&&settings.ghRepo&&settings.ghBranch&&settings.ghPath&&settings.ghToken;}
  function ghHeaders(){return {'Accept':'application/vnd.github+json','Authorization':`Bearer ${settings.ghToken}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};}
  function ghUrl(path=''){return `https://api.github.com/repos/${encodeURIComponent(settings.ghOwner)}/${encodeURIComponent(settings.ghRepo)}/contents/${path?path.split('/').map(encodeURIComponent).join('/'):''}`;}
  async function ghRequest(url, options={}){const r=await fetch(url,{...options,headers:{...ghHeaders(),...(options.headers||{})}});let j={};try{j=await r.json();}catch{}if(!r.ok){const err=new Error(j.message||`GitHub API error ${r.status}`);err.status=r.status;throw err;}return j;}
  async function testGitHub(){if(!githubConfigValid()){toast('نام کاربری، مخزن و توکن را کامل کنید.','error');return;}$('#testGitHub').disabled=true;$('#testGitHub').textContent='در حال بررسی…';try{await ghRequest(`https://api.github.com/repos/${encodeURIComponent(settings.ghOwner)}/${encodeURIComponent(settings.ghRepo)}`);settings.syncState='connected';saveSettings();toast('اتصال GitHub موفق بود. دسترسی مخزن تأیید شد.');}catch(err){settings.syncState='error';saveSettings();toast(`اتصال ناموفق بود: ${friendlyGithubError(err)}`,'error',6500);}finally{$('#testGitHub').disabled=false;$('#testGitHub').textContent='بررسی اتصال';renderSettings();}}
  function friendlyGithubError(err){if(err.status===401)return'توکن معتبر نیست یا منقضی شده است.';if(err.status===403)return'دسترسی Contents یا محدودیت درخواست را بررسی کنید.';if(err.status===404)return'مخزن پیدا نشد؛ Owner، Repo و دسترسی خصوصی را بررسی کنید.';return err.message||'خطای ارتباط با GitHub.';}
  const syncCollections=['groups','employees','attendances','advances','plans','events'];
  function syncPayload(){const o={app:'AtelierYar',schemaVersion:1,updatedAt:nowISO()};syncCollections.forEach(k=>o[k]=data[k]);o.meta=data.meta||{};return o;}
  function mergeCollections(local,remote){const out={schemaVersion:1,meta:{updatedAt:nowISO()}};syncCollections.forEach(k=>{const map=new Map();[...(remote[k]||[]),...(local[k]||[])].forEach(item=>{const old=map.get(item.id);if(!old){map.set(item.id,item);return;}const ta=Date.parse(old.updatedAt||old.deletedAt||old.createdAt||0)||0,tb=Date.parse(item.updatedAt||item.deletedAt||item.createdAt||0)||0;if(tb>ta||(tb===ta&&item.deletedAt&&!old.deletedAt))map.set(item.id,item);});out[k]=[...map.values()];});return out;}
  function utf8ToB64(str){const bytes=new TextEncoder().encode(str);let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}
  function decodeGitHubContent(content){const binary=atob(String(content||'').replace(/\n/g,''));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new TextDecoder('utf-8').decode(bytes);}
  async function getRemoteFile(){try{const j=await ghRequest(`${ghUrl(settings.ghPath)}?ref=${encodeURIComponent(settings.ghBranch)}`);if(j.type!=='file')throw new Error('مسیر انتخاب‌شده فایل نیست.');let raw=j.content;if(!raw&&j.download_url){const response=await fetch(j.download_url,{headers:ghHeaders(),cache:'no-store'});if(!response.ok)throw new Error(`دانلود فایل داده از GitHub ناموفق بود (${response.status}).`);return {data:JSON.parse(await response.text()),sha:j.sha};}return {data:JSON.parse(decodeGitHubContent(raw)),sha:j.sha};}catch(err){if(err.status===404)return {data:null,sha:null};throw err;}}
  async function putRemoteFile(payload,sha){const body={message:`AtelierYar sync ${new Date().toISOString()}`,content:utf8ToB64(JSON.stringify(payload,null,2)),branch:settings.ghBranch};if(sha)body.sha=sha;return ghRequest(ghUrl(settings.ghPath),{method:'PUT',body:JSON.stringify(body)});}
  async function syncNow({silent=false}={}){if(syncing)return;if(!githubConfigValid()){toast('ابتدا اطلاعات اتصال GitHub را در تنظیمات کامل کنید.','error');return;}syncing=true;clearTimeout(autoSyncTimer);const button=$('#syncNow');if(button){button.disabled=true;button.textContent='در حال همگام‌سازی…';}try{let remote=await getRemoteFile();let merged=mergeCollections(syncPayload(),remote.data||{});try{await putRemoteFile(merged,remote.sha);}catch(err){if(err.status!==409&&err.status!==422)throw err;remote=await getRemoteFile();merged=mergeCollections(merged,remote.data||{});await putRemoteFile(merged,remote.sha);}
      syncCollections.forEach(k=>data[k]=merged[k]);data.meta={...(merged.meta||{}),updatedAt:nowISO()};saveData({triggerSync:false});settings.syncState='connected';settings.lastSync=nowISO();saveSettings();renderAll();if(!silent)toast('همگام‌سازی دوطرفه با GitHub انجام شد.');
    }catch(err){settings.syncState='error';saveSettings();if(!silent)toast(`همگام‌سازی ناموفق بود: ${friendlyGithubError(err)}`,'error',7000);else console.warn('AtelierYar sync:',err.message);}finally{syncing=false;if(button){button.disabled=false;button.innerHTML='همگام‌سازی';}renderSettings();if(pendingSync){pendingSync=false;queueAutoSync();}}}

  /* ---------- خروجی جدول حضور و حقوق: چاپ / عکس / PDF / Excel / CSV / کپی متن ----------
     یک جدول مثل برگهٔ دستی: ردیف = روز، ستون = کارمند، خانه = مبلغ همان شب (یا خط مورب برای غیبت)،
     و در پایین: تعداد شب، جمع حقوق، مساعده و خالص قابل پرداخت هر نفر. بدون هیچ کتابخانهٔ بیرونی. */
  const SX_COLS=8, SX_MAX_DAYS=35;
  const SX_FONT="Tahoma,'Segoe UI','Noto Sans Arabic','Noto Naskh Arabic',Arial,sans-serif";
  const SX={preset:'last10',year:0,month:0,sel:new Set(),q:'',busy:false,opts:Object.assign({mode:'amount',adv:true,sign:true,slash:true,thousands:false},settings.sheetOpts||{})};
  const SX_PRESETS=[['last10','۱۰ روز اخیر'],['d1','۱ تا ۱۰'],['d2','۱۱ تا ۲۰'],['d3','۲۱ تا آخر'],['month','کل ماه'],['payroll','بازهٔ صفحهٔ حقوق']];
  const sxMonthPreset=p=>['d1','d2','d3','month'].includes(p);
  function sxRange(){
    const today=todayISO();
    if(SX.preset==='last10'){const s=parseISO(today);s.setDate(s.getDate()-9);return {from:toISODate(s),to:today};}
    if(SX.preset==='payroll')return {from:$('#payrollFrom')?.dataset.iso||today,to:$('#payrollTo')?.dataset.iso||today};
    const all=jalaliMonthDays(SX.year,SX.month); if(!all.length)return {from:today,to:today};
    const pick=SX.preset==='d1'?all.filter(d=>d.day<=10):SX.preset==='d2'?all.filter(d=>d.day>10&&d.day<=20):SX.preset==='d3'?all.filter(d=>d.day>20):all;
    return {from:pick[0].iso,to:pick[pick.length-1].iso};
  }
  function sxDays(from,to){const out=[];const d=parseISO(from);let guard=0;while(toISODate(d)<=to&&guard++<400){out.push(toISODate(d));d.setDate(d.getDate()+1);}return out;}
  function sxBuild(){
    const {from,to}=sxRange(), isoDays=sxDays(from,to), o=SX.opts;
    const att=new Map(); attList().forEach(a=>{if(a.date>=from&&a.date<=to)att.set(`${a.employeeId}|${a.date}`,Number(a.payAmount)||0);});
    const advBy=new Map(); data.advances.forEach(r=>{if(live(r)&&r.date>=from&&r.date<=to&&r.deductFromPayroll!==false)advBy.set(r.employeeId,(advBy.get(r.employeeId)||0)+(Number(r.amount)||0));});
    const emps=[...SX.sel].map(getEmployee).filter(Boolean).sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'));
    const cols=emps.map(e=>{let nights=0,gross=0;const cells=isoDays.map(iso=>{const k=`${e.id}|${iso}`;if(att.has(k)){nights++;gross+=att.get(k);return att.get(k);}return null;});const adv=advBy.get(e.id)||0;return {id:e.id,name:e.name||'—',cells,nights,gross,adv,net:gross-adv};});
    const days=isoDays.map(iso=>{const p=jpISO(iso);return {iso,label:`${toFa(p.day)} ${MONTHS[p.month-1]}`,wd:WEEKDAYS[(parseISO(iso).getDay()+1)%7]};});
    const unit=o.thousands?`هزار ${settings.currency||'تومان'}`:(settings.currency||'تومان');
    const num=v=>fa(o.thousands?v/1000:v);
    const rangeLabel=(from===to?jalaliDate(from):`${jalaliDate(from)} تا ${jalaliDate(to)}`)+` — مبالغ به ${unit}`;
    const foot=[{key:'nights',label:'تعداد شب'},{key:'gross',label:'جمع حقوق'}];
    if(o.adv)foot.push({key:'adv',label:'مساعده (کسر)'});
    foot.push({key:'net',label:'خالص قابل پرداخت'});
    if(o.sign)foot.push({key:'sign',label:'امضا'});
    const val=(c,k)=>k==='nights'?fa(c.nights):k==='gross'?num(c.gross):k==='adv'?(c.adv?num(c.adv):'—'):k==='net'?num(c.net):'';
    const tot={gross:cols.reduce((s,c)=>s+c.gross,0),adv:cols.reduce((s,c)=>s+c.adv,0),nights:cols.reduce((s,c)=>s+c.nights,0)};tot.net=tot.gross-tot.adv;
    return {from,to,days,cols,opts:o,num,unit,rangeLabel,foot,val,tot,landscape:days.length<=16,cell:v=>o.mode==='mark'?'X':num(v)};
  }
  const sxChunks=S=>{const out=[];for(let i=0;i<Math.max(1,S.cols.length);i+=SX_COLS)out.push(S.cols.slice(i,i+SX_COLS));return out;};
  function sxHtml(S){
    const ch=sxChunks(S);
    return ch.map((cols,ci)=>{
      const head=`<tr><th class="sx-corner">روز</th>${cols.map(c=>`<th>${esc(c.name)}</th>`).join('')}</tr>`;
      const body=S.days.map((d,i)=>`<tr><th class="sx-day">${esc(d.label)}<small>${esc(d.wd)}</small></th>${cols.map(c=>{const v=c.cells[i];return `<td class="${v==null?(S.opts.slash?'sx-off':'sx-empty'):'sx-has'}">${v==null?'':esc(S.cell(v))}</td>`;}).join('')}</tr>`).join('');
      const foot=S.foot.map(f=>`<tr class="sx-f-${f.key}"><th class="sx-day">${esc(f.label)}</th>${cols.map(c=>`<td>${esc(S.val(c,f.key))}</td>`).join('')}</tr>`).join('');
      const last=ci===ch.length-1;
      return `<div class="sx-sheet ${S.landscape?'sx-land':'sx-port'}"><div class="sx-head"><b>جدول حضور و حقوق</b><span>${esc(S.rangeLabel)}</span>${ch.length>1?`<em>صفحه ${fa(ci+1)} از ${fa(ch.length)}</em>`:''}</div><div class="sx-scroll"><table class="sx-table"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>${last?`<div class="sx-grand">جمع خالص قابل پرداخت (همهٔ نفرات): <b>${esc(S.num(S.tot.net))} ${esc(S.unit)}</b></div>`:''}<div class="sx-foot">تهیه‌شده با آتلیه‌یار · ${esc(jalaliDate(todayISO()))}</div></div>`;
    }).join('');
  }
  /* ----- رسم روی Canvas (برای PNG / JPG / PDF) ----- */
  function sxPage(S,cols,pi,pn){
    const L=S.landscape,W=L?1754:1240,H=L?1240:1754,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
    g.fillStyle='#fff';g.fillRect(0,0,W,H);g.direction='rtl';g.textBaseline='middle';g.textAlign='center';
    const M=Math.round(W*.035);
    const txt=(t,cx,cy,maxW,size,weight='400',color='#111')=>{let s=size;g.font=`${weight} ${s}px ${SX_FONT}`;while(s>9&&g.measureText(t).width>maxW){s--;g.font=`${weight} ${s}px ${SX_FONT}`;}g.fillStyle=color;g.fillText(t,cx,cy);};
    txt('جدول حضور و حقوق',W/2,M+34,W-2*M,46,'700');
    txt(S.rangeLabel,W/2,M+92,W-2*M,28,'400','#444');
    if(pn>1)txt(`صفحه ${fa(pi+1)} از ${fa(pn)}`,M+110,M+34,200,24,'400','#666');
    const topY=M+135, units=1+S.days.length+S.foot.length+(S.opts.sign?.6:0), availH=H-topY-M-110;
    const rowH=Math.max(18,Math.min(Math.floor(availH/units),Math.round(H*.055)));
    const dayW=Math.round(Math.min(W*.14,210)), colW=Math.round(Math.min(280,(W-2*M-dayW)/Math.max(cols.length,3)));
    const tableW=dayW+colW*cols.length, x0=Math.round((W-tableW)/2), rightX=x0+tableW, colX=j=>rightX-dayW-colW*(j+1);
    g.lineWidth=2;g.strokeStyle='#222';
    const cell=(x,y,w,h,fill)=>{if(fill){g.fillStyle=fill;g.fillRect(x,y,w,h);}g.strokeRect(x,y,w,h);};
    const fs=rowH*.42; let y=topY;
    // header
    cell(rightX-dayW,y,dayW,rowH,'#e9ecf5');txt('روز',rightX-dayW/2,y+rowH/2,dayW-10,fs,'700');
    cols.forEach((col,j)=>{cell(colX(j),y,colW,rowH,'#e9ecf5');txt(col.name,colX(j)+colW/2,y+rowH/2,colW-14,fs,'700');});
    y+=rowH;
    S.days.forEach((d,i)=>{
      cell(rightX-dayW,y,dayW,rowH,'#f6f7fb');
      if(rowH>=36){txt(d.label,rightX-dayW/2,y+rowH*.36,dayW-10,fs*.95,'700');txt(d.wd,rightX-dayW/2,y+rowH*.74,dayW-10,fs*.6,'400','#777');}
      else txt(d.label,rightX-dayW/2,y+rowH/2,dayW-10,fs*.95,'700');
      cols.forEach((col,j)=>{const v=col.cells[i],x=colX(j);cell(x,y,colW,rowH);
        if(v==null){if(S.opts.slash){g.save();g.strokeStyle='#666';g.lineWidth=1.6;g.beginPath();g.moveTo(x+3,y+rowH-3);g.lineTo(x+colW-3,y+3);g.stroke();g.restore();}}
        else txt(S.cell(v),x+colW/2,y+rowH/2,colW-12,fs*(S.opts.mode==='mark'?1.1:1),S.opts.mode==='mark'?'700':'400');});
      y+=rowH;
    });
    S.foot.forEach(f=>{
      const h=f.key==='sign'?rowH*1.6:rowH, fill=f.key==='net'?'#dff3e6':'#e9ecf5';
      cell(rightX-dayW,y,dayW,h,fill);txt(f.label,rightX-dayW/2,y+h/2,dayW-10,fs*.95,'700');
      cols.forEach((col,j)=>{cell(colX(j),y,colW,h,f.key==='net'?'#eaf8ef':(f.key==='sign'?null:'#f6f7fb'));if(f.key!=='sign')txt(S.val(col,f.key),colX(j)+colW/2,y+h/2,colW-12,fs*(f.key==='net'?1.08:1),(f.key==='net'||f.key==='gross')?'700':'400',f.key==='adv'?'#b4540a':'#111');});
      y+=h;
    });
    if(pi===pn-1)txt(`جمع خالص قابل پرداخت (همهٔ نفرات): ${S.num(S.tot.net)} ${S.unit}`,W/2,y+46,W-2*M,rowH*.5<26?26:Math.min(34,rowH*.55),'700');
    txt(`تهیه‌شده با آتلیه‌یار · ${jalaliDate(todayISO())}`,W/2,H-M+4,W-2*M,22,'400','#888');
    return c;
  }
  const sxPages=S=>{const ch=sxChunks(S);return ch.map((cols,i)=>sxPage(S,cols,i,ch.length));};
  const canvasBlob=(c,type,q)=>new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('ساخت تصویر ناموفق بود')),type,q));
  async function sxImage(S,type){
    const pages=sxPages(S); let c=pages[0];
    if(pages.length>1){c=document.createElement('canvas');c.width=pages[0].width;c.height=pages.reduce((s,p)=>s+p.height,0);const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);let y=0;pages.forEach(p=>{g.drawImage(p,0,y);y+=p.height;});}
    return canvasBlob(c,type,.93);
  }
  function sxPdf(S){
    const pages=sxPages(S), enc=new TextEncoder(), parts=[], offs=[]; let len=0;
    const push=b=>{const u=typeof b==='string'?enc.encode(b):b;parts.push(u);len+=u.length;};
    const PW=S.landscape?842:595, PH=S.landscape?595:842, n=pages.length;
    push('%PDF-1.4\n%âãÏÓ\n');
    const begin=id=>{offs[id]=len;push(`${id} 0 obj\n`);}, end=()=>push('\nendobj\n');
    begin(1);push('<< /Type /Catalog /Pages 2 0 R >>');end();
    begin(2);push(`<< /Type /Pages /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] /Count ${n} >>`);end();
    pages.forEach((cv,i)=>{
      const pid=3+i*3,cid=pid+1,iid=pid+2,b64=cv.toDataURL('image/jpeg',.92).split(',')[1],bin=atob(b64),jpg=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)jpg[k]=bin.charCodeAt(k);
      const content=`q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
      begin(pid);push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);end();
      begin(cid);push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);end();
      begin(iid);push(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);push(jpg);push('\nendstream');end();
    });
    const total=2+n*3, xref=len;
    push(`xref\n0 ${total+1}\n0000000000 65535 f \n`);
    for(let id=1;id<=total;id++)push(`${String(offs[id]).padStart(10,'0')} 00000 n \n`);
    push(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out=new Uint8Array(len);let p=0;parts.forEach(u=>{out.set(u,p);p+=u.length;});
    return new Blob([out],{type:'application/pdf'});
  }
  /* ----- Excel (.xlsx) ----- */
  const CRC_T=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
  const crc32=u=>{let c=0xFFFFFFFF;for(let i=0;i<u.length;i++)c=CRC_T[(c^u[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;};
  function zipStore(files){
    const enc=new TextEncoder(),parts=[],central=[];let off=0;
    files.forEach(f=>{const nm=enc.encode(f.name),data=enc.encode(f.text),crc=crc32(data),sz=data.length;
      const lh=new DataView(new ArrayBuffer(30));lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);lh.setUint16(10,0,true);lh.setUint16(12,0x21,true);lh.setUint32(14,crc,true);lh.setUint32(18,sz,true);lh.setUint32(22,sz,true);lh.setUint16(26,nm.length,true);
      parts.push(new Uint8Array(lh.buffer),nm,data);
      const ch=new DataView(new ArrayBuffer(46));ch.setUint32(0,0x02014b50,true);ch.setUint16(4,20,true);ch.setUint16(6,20,true);ch.setUint16(8,0x0800,true);ch.setUint16(14,0x21,true);ch.setUint32(16,crc,true);ch.setUint32(20,sz,true);ch.setUint32(24,sz,true);ch.setUint16(28,nm.length,true);ch.setUint32(42,off,true);
      central.push(new Uint8Array(ch.buffer),nm);off+=30+nm.length+sz;});
    const csize=central.reduce((s,u)=>s+u.length,0),eo=new DataView(new ArrayBuffer(22));eo.setUint32(0,0x06054b50,true);eo.setUint16(8,files.length,true);eo.setUint16(10,files.length,true);eo.setUint32(12,csize,true);eo.setUint32(16,off,true);
    return new Blob([...parts,...central,new Uint8Array(eo.buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  const xmlEsc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const colL=i=>{let s='';i++;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26);}return s;};
  function sxXlsx(S){
    const nC=S.cols.length, lastCol=colL(nC), r0=4, first=r0+1, lastDay=r0+S.days.length;
    const str=(r,s,t)=>`<c r="${r}" s="${s}" t="inlineStr"><is><t>${xmlEsc(t)}</t></is></c>`;
    const numc=(r,s,v,f)=>`<c r="${r}" s="${s}">${f?`<f>${f}</f>`:''}<v>${v}</v></c>`;
    const blank=(r,s)=>`<c r="${r}" s="${s}"/>`;
    const rows=[];
    rows.push(`<row r="1" ht="24" customHeight="1">${str('A1',8,'جدول حضور و حقوق')}</row>`);
    rows.push(`<row r="2">${str('A2',0,S.rangeLabel.replace(/ — مبالغ به .*/,'')+' — مبالغ به '+(settings.currency||'تومان'))}</row>`);
    rows.push(`<row r="${r0}">${str(`A${r0}`,1,'روز')}${S.cols.map((c,j)=>str(`${colL(j+1)}${r0}`,1,c.name)).join('')}</row>`);
    S.days.forEach((d,i)=>{const r=first+i;rows.push(`<row r="${r}">${str(`A${r}`,2,`${d.label} (${d.wd})`)}${S.cols.map((c,j)=>{const v=c.cells[i],ref=`${colL(j+1)}${r}`;return v==null?blank(ref,2):numc(ref,3,v);}).join('')}</row>`);});
    let r=lastDay+1; const rowOf={};
    S.foot.forEach(f=>{rowOf[f.key]=r;const cells=S.cols.map((c,j)=>{const L=colL(j+1),ref=`${L}${r}`;
      if(f.key==='nights')return numc(ref,6,c.nights,`COUNT(${L}${first}:${L}${lastDay})`);
      if(f.key==='gross')return numc(ref,4,c.gross,`SUM(${L}${first}:${L}${lastDay})`);
      if(f.key==='adv')return numc(ref,3,c.adv);
      if(f.key==='net')return numc(ref,5,c.net,`${L}${rowOf.gross}-${S.opts.adv?`${L}${rowOf.adv}`:'0'}`);
      return blank(ref,2);}).join('');
      rows.push(`<row r="${r}"${f.key==='sign'?' ht="34" customHeight="1"':''}>${str(`A${r}`,7,f.label)}${cells}</row>`);r++;});
    rows.push(`<row r="${r+1}">${str(`A${r+1}`,7,'جمع کل خالص')}${numc(`B${r+1}`,5,S.tot.net,S.cols.length?`SUM(B${rowOf.net}:${lastCol}${rowOf.net})`:null)}</row>`);
    const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="${nC+1}" width="17" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${S.landscape?'landscape':'portrait'}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
    const border='<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>';
    const al='<alignment horizontal="center" vertical="center"/>';
    const xf=(num,font,fill,bd)=>`<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="${bd}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`;
    const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="14"/><name val="Tahoma"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9ECF5"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDFF3E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${border}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9">${xf(0,0,0,0)}${xf(0,1,2,1)}${xf(0,0,0,1)}${xf(164,0,0,1)}${xf(164,1,2,1)}${xf(164,1,3,1)}${xf(0,1,2,1)}${xf(0,1,2,1)}${xf(0,2,0,0)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    return zipStore([
      {name:'[Content_Types].xml',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
      {name:'_rels/.rels',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="حقوق" sheetId="1" r:id="rId1"/></sheets></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
      {name:'xl/styles.xml',text:styles},
      {name:'xl/worksheets/sheet1.xml',text:sheet}
    ]);
  }
  function sxCsv(S){
    const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const lines=[['روز',...S.cols.map(c=>c.name)]];
    S.days.forEach((d,i)=>lines.push([`${d.label} (${d.wd})`,...S.cols.map(c=>c.cells[i]==null?'':Math.round(c.cells[i]))]));
    S.foot.filter(f=>f.key!=='sign').forEach(f=>lines.push([f.label,...S.cols.map(c=>f.key==='nights'?c.nights:f.key==='gross'?Math.round(c.gross):f.key==='adv'?Math.round(c.adv):Math.round(c.net))]));
    return new Blob(['\ufeff'+lines.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  }
  function sxText(S){
    const cur=settings.currency||'تومان', m=v=>`${fa(Math.round(v))} ${cur}`;
    const rows=S.cols.map(c=>`• ${c.name}: ${fa(c.nights)} شب — جمع ${m(c.gross)}${c.adv?` — مساعده ${m(c.adv)}`:''} — قابل پرداخت ${m(c.net)}`);
    return `حقوق ${S.rangeLabel.replace(/ — مبالغ به .*/,'')}\n${rows.join('\n')}\nجمع کل قابل پرداخت: ${m(S.tot.net)}`;
  }
  /* ----- تحویل فایل: اندروید = برگهٔ اشتراک‌گذاری، ویندوز/مرورگر = دانلود ----- */
  const blobToB64=b=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=()=>rej(r.error);r.readAsDataURL(b);});
  async function deliverFile(name,blob,mime){
    if(IS_NATIVE){
      const FS=nativePlugin('Filesystem'),SH=nativePlugin('Share');
      if(FS&&SH&&typeof FS.writeFile==='function'){
        try{const w=await FS.writeFile({path:`exports/${name}`,data:await blobToB64(blob),directory:'CACHE',recursive:true});await SH.share({title:name,files:[w.uri],dialogTitle:'ذخیره یا ارسال فایل'});return 'shared';}
        catch(err){if(/cancel/i.test(String(err?.message||err)))return 'cancelled';console.warn('AtelierYar share:',err);}
      }
      try{const f=new File([blob],name,{type:mime});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return 'shared';}}catch(err){if(err&&err.name==='AbortError')return 'cancelled';}
    }
    downloadBlob(name,blob);return 'downloaded';
  }
  function sxPrint(S){
    if(IS_NATIVE){toast('چاپ مستقیم در اندروید نیست؛ PDF ساخته می‌شود، بعد از باز کردن آن «چاپ» را بزنید.','info',4500);return sxExport('pdf');}
    let root=$('#sxPrintRoot');if(!root){root=document.createElement('div');root.id='sxPrintRoot';document.body.appendChild(root);}
    let st=$('#sxPageStyle');if(!st){st=document.createElement('style');st.id='sxPageStyle';document.head.appendChild(st);}
    st.textContent=`@page{size:A4 ${S.landscape?'landscape':'portrait'};margin:8mm}`;
    root.innerHTML=sxHtml(S);document.body.classList.add('sx-printing');
    const done=()=>{document.body.classList.remove('sx-printing');root.innerHTML='';window.removeEventListener('afterprint',done);};
    window.addEventListener('afterprint',done);setTimeout(()=>{try{window.print();}catch(_){done();}},80);
  }
  async function sxCopy(S){
    const t=sxText(S);
    try{await navigator.clipboard.writeText(t);}catch{const ta=document.createElement('textarea');ta.value=t;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(_){}ta.remove();}
    toast('خلاصهٔ متنی کپی شد؛ در پیام‌رسان بچسبانید.');
  }
  async function sxExport(kind){
    if(SX.busy)return;
    const S=sxBuild();
    if(!S.cols.length){toast('حداقل یک کارمند را انتخاب کنید.','error');return;}
    if(S.days.length>SX_MAX_DAYS){toast(`حداکثر ${fa(SX_MAX_DAYS)} روز در یک جدول جا می‌شود؛ بازه را کوتاه‌تر کنید.`,'error');return;}
    if(kind==='print')return sxPrint(S);
    if(kind==='copy')return sxCopy(S);
    SX.busy=true;$$('[data-sx-export]').forEach(b=>b.disabled=true);
    const base=`AtelierYar-${S.from}_${S.to}`;
    try{
      try{await document.fonts?.ready;}catch(_){}
      let name,blob,mime;
      if(kind==='xlsx'){name=`${base}.xlsx`;blob=sxXlsx(S);mime=blob.type;}
      else if(kind==='csv'){name=`${base}.csv`;blob=sxCsv(S);mime='text/csv';}
      else if(kind==='pdf'){name=`${base}.pdf`;blob=sxPdf(S);mime='application/pdf';}
      else if(kind==='jpg'){name=`${base}.jpg`;blob=await sxImage(S,'image/jpeg');mime='image/jpeg';}
      else {name=`${base}.png`;blob=await sxImage(S,'image/png');mime='image/png';}
      const r=await deliverFile(name,blob,mime);
      if(r==='downloaded')toast('فایل آماده شد و دانلود شد.');
    }catch(err){console.error(err);toast(`ساخت خروجی ناموفق بود: ${err.message||err}`,'error',6000);}
    finally{SX.busy=false;$$('[data-sx-export]').forEach(b=>b.disabled=false);}
  }
  /* ----- پنجرهٔ تنظیم خروجی ----- */
  function sxEmpStats(e,from,to){let n=0,g=0;attList().forEach(a=>{if(a.employeeId===e.id&&a.date>=from&&a.date<=to){n++;g+=Number(a.payAmount)||0;}});const hasAdv=data.advances.some(r=>live(r)&&r.employeeId===e.id&&r.date>=from&&r.date<=to&&r.deductFromPayroll!==false);return {n,g,hasAdv};}
  function sxRenderEmps(){
    const {from,to}=sxRange(), q=SX.q.trim().toLocaleLowerCase('fa');
    const list=liveEmployees().sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa')).filter(e=>!q||`${e.name} ${e.role||''}`.toLocaleLowerCase('fa').includes(q));
    $('#sxEmps').innerHTML=list.length?list.map(e=>{const s=sxEmpStats(e,from,to);return `<label class="sx-emp${e.active===false?' off':''}"><input type="checkbox" data-sx-emp="${esc(e.id)}" ${SX.sel.has(e.id)?'checked':''}><span><b>${esc(e.name)}</b><small>${s.n?`${fa(s.n)} شب · ${money(s.g)}`:'بدون حضور در این بازه'}${e.active===false?' · غیرفعال':''}</small></span></label>`;}).join(''):'<div class="empty-inline">کارمندی پیدا نشد.</div>';
    $('#sxCount').textContent=`${fa(SX.sel.size)} نفر انتخاب شده`;
  }
  function sxPreselect(){const {from,to}=sxRange();SX.sel=new Set(liveEmployees().filter(e=>{const s=sxEmpStats(e,from,to);return s.n||s.hasAdv;}).map(e=>e.id));if(!SX.sel.size)activeEmployees().forEach(e=>SX.sel.add(e.id));}
  function sxRefresh(pre){
    if(!$('#sxRoot'))return;
    if(pre)sxPreselect();
    $$('#sxPresets [data-sx-preset]').forEach(b=>b.classList.toggle('active',b.dataset.sxPreset===SX.preset));
    const mb=$('#sxMonthBar');mb.hidden=!sxMonthPreset(SX.preset);$('#sxMonthName').textContent=`${MONTHS[SX.month-1]} ${toFa(SX.year)}`;
    const {from,to}=sxRange(), days=sxDays(from,to).length, tooLong=days>SX_MAX_DAYS;
    $('#sxRangeLabel').innerHTML=`${esc(from===to?jalaliDate(from):`${jalaliDate(from)} تا ${jalaliDate(to)}`)} <span class="muted">(${fa(days)} روز)</span>${tooLong?` <b class="sx-warn">بیشتر از ${fa(SX_MAX_DAYS)} روز است؛ بازه را کوتاه‌تر کنید.</b>`:''}`;
    sxRenderEmps();
    const o=SX.opts;$('#sxMode').value=o.mode;['adv','sign','slash','thousands'].forEach(k=>{const el=$(`#sxOpt-${k}`);if(el)el.checked=!!o[k];});
    const S=sxBuild();
    $('#sxPreview').innerHTML=S.cols.length&&!tooLong?sxHtml(S):`<div class="empty-inline">${tooLong?'بازه خیلی طولانی است.':'برای دیدن پیش‌نمایش، حداقل یک کارمند را انتخاب کنید.'}</div>`;
    $$('[data-sx-export]').forEach(b=>b.disabled=SX.busy||!S.cols.length||tooLong);
  }
  function sxOpen(){
    if(!liveEmployees().length){toast('ابتدا یک کارمند اضافه کنید.','error');setPage('employees');return;}
    const t=jalaliTodayParts();SX.year=t.year;SX.month=t.month;SX.preset='last10';SX.q='';
    const opt=(k,l)=>`<label class="sx-check"><input type="checkbox" id="sxOpt-${k}"><span>${l}</span></label>`;
    const exp=(k,i,l)=>`<button type="button" class="btn btn-outline sx-exp" data-sx-export="${k}"><span class="sx-ico">${i}</span>${l}</button>`;
    openModal('خروجی جدول حضور و حقوق','کارمندان و بازه را انتخاب کنید؛ جدول روزبه‌روز و مبلغ قابل پرداخت هر نفر ساخته می‌شود.',`<div class="sx" id="sxRoot">
      <div class="sx-block"><div class="sx-label">بازه</div><div class="segmented sx-seg" id="sxPresets">${SX_PRESETS.map(([k,l])=>`<button type="button" data-sx-preset="${k}">${l}</button>`).join('')}</div>
        <div class="sx-monthbar" id="sxMonthBar"><button type="button" class="calendar-nav" data-sx-month="-1" aria-label="ماه قبل">›</button><strong id="sxMonthName"></strong><button type="button" class="calendar-nav" data-sx-month="1" aria-label="ماه بعد">‹</button></div>
        <div class="sx-range" id="sxRangeLabel"></div></div>
      <div class="sx-block"><div class="sx-label"><span>کارمندان <small id="sxCount" class="muted"></small></span><span class="sx-mini"><button type="button" class="btn btn-quiet btn-small" data-sx-sel="all">همه</button><button type="button" class="btn btn-quiet btn-small" data-sx-sel="active">دارای سابقه</button><button type="button" class="btn btn-quiet btn-small" data-sx-sel="none">هیچ‌کدام</button></span></div>
        <div class="field"><input id="sxSearch" type="search" placeholder="جستجوی نام…" autocomplete="off"></div><div class="sx-emps" id="sxEmps"></div></div>
      <div class="sx-block"><div class="sx-label">گزینه‌ها</div><div class="sx-opts"><label class="field sx-modefield"><span>محتوای خانه‌ها</span><select id="sxMode"><option value="amount">مبلغ هر شب</option><option value="mark">فقط علامت حضور (X)</option></select></label>${opt('adv','ردیف مساعده و خالص پرداختی')}${opt('slash','خط مورب برای روزهای غیبت')}${opt('sign','ردیف امضا (برای پرداخت)')}${opt('thousands','مبالغ به هزار (کوتاه‌تر)')}</div></div>
      <div class="sx-block"><div class="sx-label">پیش‌نمایش</div><div class="sx-preview" id="sxPreview"></div></div>
      <div class="sx-exports"><div class="sx-grid">${exp('print','⎙','چاپ')}${exp('pdf','PDF','فایل PDF')}${exp('png','▣','عکس PNG')}${exp('jpg','▤','عکس JPG')}${exp('xlsx','XLS','اکسل (.xlsx)')}${exp('csv','CSV','فایل CSV')}${exp('copy','❐','کپی متن')}</div><p class="subtle-note">${IS_NATIVE?'در اندروید، بعد از ساخت فایل، برگهٔ اشتراک‌گذاری باز می‌شود (ذخیره، تلگرام، واتساپ، چاپ…).':'فایل‌ها در پوشهٔ دانلودها ذخیره می‌شوند؛ «چاپ» پنجرهٔ چاپگر را باز می‌کند.'} PDF و عکس به صورت تصویر ساخته می‌شوند تا فونت فارسی همه‌جا درست دیده شود.</p></div>
    </div>`);
    const m=$('#modalRoot .modal');if(m)m.classList.add('modal-wide');
    sxRefresh(true);
  }
  function sxSaveOpts(){settings.sheetOpts={...SX.opts};localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}
  document.addEventListener('click',e=>{
    const t=e.target;
    if(t.closest('#openSheetExport')||t.closest('[data-sx-open]')){sxOpen();return;}
    if(!t.closest('#sxRoot'))return;
    let el;
    if((el=t.closest('[data-sx-preset]'))){SX.preset=el.dataset.sxPreset;sxRefresh(true);return;}
    if((el=t.closest('[data-sx-month]'))){let m=SX.month+Number(el.dataset.sxMonth),y=SX.year;if(m<1){m=12;y--;}if(m>12){m=1;y++;}SX.month=m;SX.year=y;sxRefresh(true);return;}
    if((el=t.closest('[data-sx-sel]'))){const k=el.dataset.sxSel;if(k==='all')liveEmployees().forEach(x=>SX.sel.add(x.id));else if(k==='none')SX.sel.clear();else sxPreselect();sxRefresh();return;}
    if((el=t.closest('[data-sx-export]'))){sxExport(el.dataset.sxExport);return;}
  });
  document.addEventListener('change',e=>{
    const t=e.target;if(!t.closest||!t.closest('#sxRoot'))return;
    if(t.matches('[data-sx-emp]')){t.checked?SX.sel.add(t.dataset.sxEmp):SX.sel.delete(t.dataset.sxEmp);$('#sxCount').textContent=`${fa(SX.sel.size)} نفر انتخاب شده`;sxRefresh();return;}
    if(t.id==='sxMode'){SX.opts.mode=t.value;sxSaveOpts();sxRefresh();return;}
    const m=/^sxOpt-(\w+)$/.exec(t.id||'');if(m){SX.opts[m[1]]=t.checked;sxSaveOpts();sxRefresh();}
  });
  document.addEventListener('input',e=>{if(e.target.id==='sxSearch'){SX.q=e.target.value;sxRenderEmps();}});

  // Calendar popovers for the two payroll date fields.
  document.addEventListener('click',e=>{if(e.target.closest('[data-calendar]'))return;});
  // Wire calendar open buttons created statically in the page.
  $$('[data-calendar]').forEach(b=>b.addEventListener('click',()=>showCalendar(b.dataset.calendar,$(`#calendar-${b.dataset.calendar}`))));
  document.addEventListener('DOMContentLoaded',init);
  if(document.readyState!=='loading')init();
})();
