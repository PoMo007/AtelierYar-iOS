/* AtelierYar — local-first attendance & payroll manager. */
(() => {
  'use strict';
  const DATA_KEY = 'atelierYar.data.v1';
  const SETTINGS_KEY = 'atelierYar.settings.v1';
  const SNAP_KEY = 'atelierYar.snapshots.v1', SNAP_TIME_KEY = 'atelierYar.lastSnap.v1', SNAP_MAX = 12, SNAP_EVERY_MS = 6*3600*1000;
  const BIN_COLLECTIONS = ['employees','groups','advances','bonuses','attendancePresets','payments'];
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
  const defaultData = () => ({schemaVersion:1, groups:[], employees:[], attendances:[], advances:[], bonuses:[], plans:[], events:[], attendancePresets:[], payments:[], meta:{updatedAt:nowISO()}});
  const readJSON = (key, fallback) => { try { const raw=localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  let data = readJSON(DATA_KEY, defaultData());
  let settings = Object.assign({theme:'dark', accent:'violet', currency:'تومان', ghOwner:'', ghRepo:'', ghBranch:'main', ghPath:'data/atelier-yar.json', ghToken:'', lastSync:'', syncState:'local'}, readJSON(SETTINGS_KEY, {}));
  if(!settings.themeChosen) settings.theme='dark'; // dark is the default until the user picks a theme
  if (!data || !Array.isArray(data.groups)) data = defaultData();
  ['groups','employees','attendances','advances','bonuses','plans','events','attendancePresets','payments'].forEach(k => { if (!Array.isArray(data[k])) data[k]=[]; });
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
  function saveData({triggerSync=true}={}) { if(triggerSync){auditChanges();pushUndo();} maybeAutoSnapshot(); data.meta={...(data.meta||{}), updatedAt:nowISO()}; localStorage.setItem(DATA_KEY, JSON.stringify(data)); updateStorageStats(); if(triggerSync){if(syncing)pendingSync=true;else queueAutoSync();} }
  function queueAutoSync(){ if(!githubConfigValid() || !navigator.onLine || syncing) return; clearTimeout(autoSyncTimer); autoSyncTimer=setTimeout(()=>{if(githubConfigValid() && !syncing) syncNow({silent:true});},1800); }


  /* ---------- Auto restore points, restore, recycle bin, undo (v1.5.15) ---------- */
  function readSnaps(){ try{ const a=JSON.parse(localStorage.getItem(SNAP_KEY)||'[]'); return Array.isArray(a)?a:[]; }catch(_){ return []; } }
  function writeSnaps(list){ const arr=list.slice(); while(true){ try{ localStorage.setItem(SNAP_KEY,JSON.stringify(arr)); return true; }catch(_){ if(arr.length<=1)return false; const i=arr.findIndex(x=>x.kind==='auto'); arr.splice(i>=0?i:0,1); } } }
  function snapHasContent(raw){ try{ const d=JSON.parse(raw); return ['employees','attendances','groups'].some(k=>Array.isArray(d[k])&&d[k].some(x=>x&&!x.deletedAt)); }catch(_){ return false; } }
  function takeSnapshot(reason,kind,raw){
    try{
      raw=raw||JSON.stringify(data); if(!snapHasContent(raw))return false;
      const list=readSnaps(); list.push({id:makeId('snap'),at:nowISO(),reason,kind,data:raw});
      while(list.length>SNAP_MAX){ const i=list.findIndex(x=>x.kind==='auto'); list.splice(i>=0?i:0,1); }
      const ok=writeSnaps(list); if(ok)localStorage.setItem(SNAP_TIME_KEY,String(Date.now())); return ok;
    }catch(_){ return false; }
  }
  // Snapshot of the state that was persisted BEFORE this save, at most once per 6 hours.
  function maybeAutoSnapshot(){
    try{ const last=Number(localStorage.getItem(SNAP_TIME_KEY))||0; if(Date.now()-last<SNAP_EVERY_MS)return; const prev=localStorage.getItem(DATA_KEY); if(prev)takeSnapshot('خودکار','auto',prev); }catch(_){}
  }
  function snapCounts(raw){ try{ const d=JSON.parse(raw),n=k=>(d[k]||[]).filter(x=>x&&!x.deletedAt).length; return `${fa(n('employees'))} کارمند، ${fa(n('attendances'))} حضور، ${fa(n('advances'))} مساعده، ${fa(n('bonuses'))} پاداش`; }catch(_){ return ''; } }
  function restoreSnapshot(id){
    const sn=readSnaps().find(x=>x.id===id); if(!sn)return; let inc; try{ inc=JSON.parse(sn.data); }catch(_){ toast('این نقطهٔ بازیابی خراب است.','error'); return; }
    takeSnapshot('پیش از بازگردانی','safety',JSON.stringify(data));
    const now=nowISO(), next={schemaVersion:1,meta:{...(inc.meta||{}),updatedAt:now}};
    syncCollections.forEach(k=>{
      const old=Array.isArray(inc[k])?inc[k]:[], ids=new Set(old.map(x=>x.id));
      next[k]=old.map(x=>({...x,updatedAt:now}));
      (data[k]||[]).forEach(x=>{ if(x&&!ids.has(x.id))next[k].push({...x,deletedAt:x.deletedAt||now,updatedAt:now}); });
    });
    data=next; saveData(); renderAll(); toast('اطلاعات به نقطهٔ انتخاب‌شده بازگردانده شد. وضعیت قبلی هم به‌عنوان نقطهٔ بازیابی ذخیره شد.','success',5500);
  }
  function atLabel(iso){ const d=new Date(iso); return `${jalaliShort(toISODate(d))} · ${d.toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})}`; }
  function binLabel(col,x){
    const emp=id=>getEmployee(id)?.name||'کارمند حذف‌شده';
    if(col==='employees')return ['کارمند',x.name||'—',x.role||''];
    if(col==='groups')return ['مجموعه',x.name||'—',x.note||''];
    if(col==='attendancePresets')return ['پریست',x.name||'—',''];
    if(col==='payments')return ['پرداخت',emp(x.employeeId),`${money(x.amount)} · ${x.date?jalaliShort(x.date):''}`];
    if(col==='advances')return ['مساعده',emp(x.employeeId),`${money(x.amount)} · ${x.date?jalaliShort(x.date):''}`];
    return ['پاداش',emp(x.employeeId),`${money(x.amount)} · ${x.date?jalaliShort(x.date):''}`];
  }
  function binItems(){
    const out=[]; BIN_COLLECTIONS.forEach(col=>(data[col]||[]).forEach(x=>{ if(x&&x.deletedAt&&x.source!=='attendance')out.push({col,x}); }));
    return out.sort((a,b)=>String(b.x.deletedAt).localeCompare(String(a.x.deletedAt)));
  }
  function restoreFromBin(col,id){ const x=(data[col]||[]).find(i=>i.id===id); if(!x)return; x.deletedAt=null; x.updatedAt=nowISO(); saveData(); renderAll(); toast('مورد بازگردانده شد.'); }
  function renderSafety(){
    const box=$('#snapshotList'),bin=$('#recycleList'); if(!box||!bin)return; const page=$('#page-settings'); if(page&&!page.classList.contains('active'))return;
    const snaps=readSnaps().slice().reverse();
    box.innerHTML=snaps.length?`<div class="summary-list">${snaps.map(sn=>`<div class="summary-line"><div><b>${esc(atLabel(sn.at))}</b><small>${esc(sn.reason)} — ${esc(snapCounts(sn.data))}</small></div><button type="button" class="btn btn-outline btn-small" data-restore-snap="${esc(sn.id)}">بازگردانی</button></div>`).join('')}</div>`:'<div class="empty-inline">هنوز نقطهٔ بازیابی ساخته نشده است. با اولین تغییر، خودکار ساخته می‌شود.</div>';
    const items=binItems(),shown=items.slice(0,60);
    bin.innerHTML=items.length?`<div class="summary-list">${shown.map(({col,x})=>{const [t,n,sub]=binLabel(col,x);return `<div class="summary-line"><div><b>${esc(t)}: ${esc(n)}</b><small>${esc(sub?sub+' · ':'')}حذف: ${esc(atLabel(x.deletedAt))}</small></div><button type="button" class="btn btn-outline btn-small" data-restore-bin="${esc(col)}|${esc(x.id)}">بازگردانی</button></div>`}).join('')}</div>${items.length>shown.length?`<div class="attendance-history-foot">${fa(items.length-shown.length)} مورد قدیمی‌تر هم هست.</div>`:''}`:'<div class="empty-inline">سطل بازیافت خالی است.</div>';
  }
  function toastAction(message,label,fn,duration=9000){
    const region=$('#toastRegion'),el=document.createElement('div'); el.className='toast success toast-action';
    const t=document.createElement('span'); t.textContent=message; const b=document.createElement('button'); b.type='button'; b.textContent=label;
    b.addEventListener('click',()=>{el.remove();fn();}); el.append(t,b); region.appendChild(el); setTimeout(()=>el.remove(),duration);
  }
  function deletedMap(){ const m=new Map(); syncCollections.forEach(k=>(data[k]||[]).forEach(x=>{ if(x&&x.id)m.set(k+'|'+x.id,!!x.deletedAt); })); return m; }
  function offerUndo(before){
    const fresh=[]; syncCollections.forEach(k=>(data[k]||[]).forEach(x=>{ if(x&&x.deletedAt&&before.get(k+'|'+x.id)===false)fresh.push([k,x.id]); }));
    if(!fresh.length)return;
    const region=$('#toastRegion'); if(region)region.innerHTML='';
    toastAction(`${fa(fresh.length)} مورد حذف شد.`,'بازگردانی',()=>{ const now=nowISO(); fresh.forEach(([k,id])=>{ const x=data[k].find(i=>i.id===id); if(x){x.deletedAt=null;x.updatedAt=now;} }); saveData(); renderAll(); toast('حذف لغو شد.'); });
  }
  function bindSafetyEvents(){
    document.addEventListener('click',e=>{
      const rs=e.target.closest('[data-restore-snap]'); if(rs){ if(!gateOk()){gatePin(()=>rs.click());return;} if(confirm('اطلاعات فعلی با این نقطهٔ بازیابی جایگزین شود؟ وضعیت فعلی هم به‌عنوان یک نقطهٔ بازیابی ذخیره می‌شود.'))restoreSnapshot(rs.dataset.restoreSnap); return; }
      const rb=e.target.closest('[data-restore-bin]'); if(rb){ const [col,id]=rb.dataset.restoreBin.split('|'); restoreFromBin(col,id); return; }
      if(e.target.closest('#makeSnapshot')){ const ok=takeSnapshot('دستی','manual'); toast(ok?'نقطهٔ بازیابی ساخته شد.':'ساخت نقطهٔ بازیابی ممکن نشد (اطلاعاتی نیست یا حافظه پر است).',ok?'success':'error'); renderSafety(); return; }
    });
    setTimeout(()=>{ try{
      const has=liveEmployees().length>0, last=Date.parse(settings.lastBackupExport||'')||0, nag=Date.parse(settings.lastBackupNag||'')||0, day=864e5;
      if(has&&Date.now()-last>7*day&&Date.now()-nag>3*day){ settings.lastBackupNag=nowISO(); localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings)); toast('مدتی از آخرین نسخهٔ پشتیبان فایلی گذشته است؛ از تنظیمات «دریافت نسخه پشتیبان» را بزنید.','info',7000); }
    }catch(_){} },3500);
  }

  /* ---------- Real payments (paid / remaining) + payslip receipts (v1.5.16) ---------- */
  const PAY_METHODS={cash:'نقدی',card:'کارت به کارت',transfer:'حواله / پایا',other:'سایر'};
  let receiptCtx=null;
  function paymentCounts(p,from,to){ if(p.periodFrom&&p.periodTo)return p.periodFrom>=from&&p.periodTo<=to; return p.date>=from&&p.date<=to; }
  function payStatus(r){ const net=r.gross+r.bonus-r.advance, bal=net-r.paid;
    if(net<=0.5&&r.paid<=0.5)return {k:'none',t:'بدون مبلغ'};
    if(r.paid>net+0.5)return {k:'over',t:'پرداخت اضافه'};
    if(bal<=0.5)return {k:'ok',t:'تسویه‌شده'};
    if(r.paid>0)return {k:'part',t:'پرداخت ناقص'};
    return {k:'due',t:'پرداخت‌نشده'}; }
  function payBadge(r){ const st=payStatus(r),net=r.gross+r.bonus-r.advance,bal=net-r.paid; return `<span class="pay-badge ${st.k}">${st.t}</span>${st.k==='ok'||st.k==='none'?'':`<small class="pay-left">${st.k==='over'?'+ '+money(-bal):money(bal)}</small>`}`; }
  function renderPayments(from,to){
    const box=$('#paymentsTable'); if(!box)return;
    const list=data.payments.filter(p=>live(p)&&(paymentCounts(p,from,to)||(p.date>=from&&p.date<=to))).sort((a,b)=>b.date.localeCompare(a.date));
    box.innerHTML=list.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>تاریخ</th><th>مبلغ</th><th>روش</th><th>بابت دوره</th><th>یادداشت</th><th>مدیریت</th></tr></thead><tbody>${list.map(p=>{const e=getEmployee(p.employeeId);return `<tr><td><b>${esc(e?.name||'کارمند حذف‌شده')}</b></td><td>${esc(jalaliShort(p.date))}</td><td><b>${money(p.amount)}</b></td><td>${esc(PAY_METHODS[p.method]||'—')}</td><td><small class="muted">${p.periodFrom?esc(jalaliShort(p.periodFrom)+' تا '+jalaliShort(p.periodTo)):'—'}</small></td><td>${esc(p.note||'—')}</td><td><div class="card-action-group"><button type="button" class="btn btn-outline btn-small" data-receipt-emp="${esc(p.employeeId)}" data-rc-from="${esc(p.periodFrom||'')}" data-rc-to="${esc(p.periodTo||'')}">فیش</button><button type="button" class="icon-action" data-edit-payment="${esc(p.id)}" title="ویرایش">✎</button><button type="button" class="icon-action" data-delete-payment="${esc(p.id)}" title="حذف">⌫</button></div></td></tr>`}).join('')}</tbody></table></div>`:'<div class="empty-inline">در این بازه پرداختی ثبت نشده است. با «ثبت پرداخت» یا دکمهٔ «＋ پرداخت» کنار هر کارمند ثبت کنید.</div>';
  }
  function payInfoHtml(employeeId,pf,pt){
    const r=calcPayroll(pf,pt).rows.find(x=>x.employee.id===employeeId); if(!r)return {html:'برای این کارمند در این دوره مبلغی محاسبه نشده است.',left:0};
    const net=r.gross+r.bonus-r.advance;
    return {html:`خالص دوره: <b>${money(net)}</b> · پرداخت‌شده: <b>${money(r.paid)}</b> · مانده: <b>${money(Math.max(0,net-r.paid))}</b>`,left:Math.max(0,net-r.paid)};
  }
  function paymentModal(id,employeeIdPreset='',range=null){
    const p=id?data.payments.find(x=>x.id===id):null;
    const emps=liveEmployees().sort((x,y)=>(x.name||'').localeCompare(y.name||'','fa'));
    const employeeId=p?.employeeId||employeeIdPreset||emps[0]?.id||'';
    const pf=p?.periodFrom||range?.from||$('#payrollFrom').dataset.iso||todayISO(), pt=p?.periodTo||range?.to||$('#payrollTo').dataset.iso||todayISO(), date=p?.date||todayISO();
    const info=payInfoHtml(employeeId,pf,pt), amount=p?p.amount:info.left;
    openModal(p?'ویرایش پرداخت':'ثبت پرداخت','پرداخت واقعی به کارمند؛ از مانده همان دوره کم می‌شود.',
      `<form id="paymentForm" data-id="${esc(id||'')}" class="modal-form"${p?' data-touched="1"':''}>
        <label class="field full"><span>کارمند *</span><select name="employeeId" required>${emps.map(e=>`<option value="${esc(e.id)}" ${e.id===employeeId?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label>
        <div class="pay-info field full" id="payInfo">${info.html}</div>
        <input type="hidden" name="periodFrom" value="${esc(pf)}"><input type="hidden" name="periodTo" value="${esc(pt)}">
        <div class="field full pay-period"><span>بابت دوره</span><b>${esc(jalaliShort(pf))} تا ${esc(jalaliShort(pt))}</b></div>
        <label class="field"><span>تاریخ پرداخت (شمسی)</span><div class="date-input-wrap"><input class="date-text" name="dateLabel" id="paymentDate" readonly value="${esc(jalaliDate(date))}"><input type="hidden" name="date" value="${esc(date)}"><button class="date-open" id="paymentDateOpen" type="button">▦</button><div class="calendar-pop" id="paymentCalendar"></div></div></label>
        <label class="field"><span>مبلغ پرداخت (${esc(settings.currency||'تومان')}) *</span><input name="amount" data-money type="text" inputmode="numeric" autocomplete="off" required value="${amount?esc(fmtMoneyInput(amount)):''}"></label>
        <label class="field"><span>روش پرداخت</span><select name="method">${Object.entries(PAY_METHODS).map(([k,v])=>`<option value="${k}" ${(p?.method||'cash')===k?'selected':''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>یادداشت (اختیاری)</span><input name="note" maxlength="160" value="${esc(p?.note||'')}" placeholder="مثلاً شمارهٔ پیگیری"></label>
        ${modalActions(p?'ذخیره تغییرات':'ثبت پرداخت')}</form>`);
  }
  function payRecalc(f){
    const info=payInfoHtml(f.elements.employeeId.value,f.elements.periodFrom.value,f.elements.periodTo.value); const box=$('#payInfo'); if(box)box.innerHTML=info.html;
    if(!f.dataset.touched){ f.elements.amount.value=info.left?fmtMoneyInput(info.left):''; }
  }
  function submitPayment(form){
    const fd=new FormData(form),id=form.dataset.id,employeeId=String(fd.get('employeeId')||''),amount=numeric(fd.get('amount'));
    if(!employeeId||amount<=0){toast('کارمند و مبلغ معتبر پرداخت را وارد کنید.','error');return;}
    const pf=String(fd.get('periodFrom')||''),pt=String(fd.get('periodTo')||'');
    const p=id?data.payments.find(x=>x.id===id):{id:makeId('pay'),createdAt:nowISO()};
    Object.assign(p,{employeeId,date:String(fd.get('date')||todayISO()),amount,method:String(fd.get('method')||'cash'),note:String(fd.get('note')||'').trim(),periodFrom:pf,periodTo:pt,updatedAt:nowISO(),deletedAt:null});
    if(!id)data.payments.push(p); saveData(); closeModal(); renderAll();
    if(id)toast('پرداخت ویرایش شد.'); else toastAction('پرداخت ثبت شد.','فیش حقوقی',()=>receiptModal(employeeId,pf,pt),9000);
  }
  /* ----- receipt model + canvas card ----- */
  function receiptModel(employeeId,from,to){
    const calc=calcPayroll(from,to), r=calc.rows.find(x=>x.employee.id===employeeId); if(!r)return null;
    const byDate=(a,b)=>String(a.date).localeCompare(String(b.date));
    const mine=c=>recordsInRange(c,from,to).filter(x=>x.employeeId===employeeId).sort(byDate);
    const nights=r.records.slice().sort(byDate).map(a=>({date:a.date,group:liveGroupOf(a.groupId)?.name||'',pay:Number(a.payAmount)||0}));
    const pays=data.payments.filter(x=>live(x)&&x.employeeId===employeeId&&paymentCounts(x,from,to)).sort(byDate);
    const net=r.gross+r.bonus-r.advance;
    return {employee:r.employee,from,to,nights,advances:mine(data.advances).filter(x=>x.deductFromPayroll!==false),bonuses:mine(data.bonuses),pays,gross:r.gross,bonus:r.bonus,advance:r.advance,net,paid:r.paid,balance:net-r.paid,status:payStatus(r)};
  }
  function rcRound(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
  function drawReceipt(g,M,W,H){
    const PAD=56,CP=64,cw=W-2*PAD,L=PAD+CP,R=W-PAD-CP,inner=R-L,FONT=exportFontStack();
    const acc=(getComputedStyle(document.documentElement).getPropertyValue('--accent')||'').trim()||'#7564e8';
    const ink='#1d2233',mut='#7e8598',lineC='#e6e9f2',green='#1ca67a',orange='#d9822b',red='#dc5d65',blue='#3b82f6';
    const font=(w,s)=>`${w} ${s}px ${FONT}`;
    const T=(t,x,y,s,w,c,al)=>{g.font=font(w,s);g.fillStyle=c;g.textAlign=al||'right';g.fillText(String(t),x,y);};
    const TF=(t,x,y,maxW,s,w,c,al)=>{let z=s;g.font=font(w,z);while(z>12&&g.measureText(String(t)).width>maxW){z--;g.font=font(w,z);}g.fillStyle=c;g.textAlign=al||'right';g.fillText(String(t),x,y);};
    const sep=y=>{g.save();g.strokeStyle=lineC;g.lineWidth=2;g.setLineDash([2,9]);g.lineCap='round';g.beginPath();g.moveTo(L,y);g.lineTo(R,y);g.stroke();g.restore();};
    const tint=(c,a,fn)=>{g.save();g.globalAlpha=a;g.fillStyle=c;fn();g.fill();g.restore();};
    const stCol={ok:green,part:orange,due:red,over:blue,none:mut}[M.status.k]||mut;
    g.fillStyle='#eceff7';g.fillRect(0,0,W,H);
    g.save();g.shadowColor='rgba(40,50,90,.18)';g.shadowBlur=44;g.shadowOffsetY=14;g.fillStyle='#fff';rcRound(g,PAD,PAD,cw,H-2*PAD,40);g.fill();g.restore();
    const hh=260;
    g.save();rcRound(g,PAD,PAD,cw,H-2*PAD,40);g.clip();
    g.fillStyle=acc;g.fillRect(PAD,PAD,cw,hh);
    const gr=g.createLinearGradient(PAD,PAD,PAD+cw,PAD+hh);gr.addColorStop(0,'rgba(255,255,255,.16)');gr.addColorStop(1,'rgba(0,0,0,.32)');g.fillStyle=gr;g.fillRect(PAD,PAD,cw,hh);
    g.fillStyle='rgba(255,255,255,.09)';g.beginPath();g.arc(PAD+130,PAD+30,170,0,7);g.fill();g.beginPath();g.arc(PAD+330,PAD+250,110,0,7);g.fill();
    g.restore();
    T('آتلیه‌یار',R,PAD+66,28,'600','rgba(255,255,255,.86)');
    T('فیش حقوقی',R,PAD+140,72,'800','#fff');
    T(`دورهٔ ${jalaliShort(M.from)} تا ${jalaliShort(M.to)}`,R,PAD+210,28,'500','rgba(255,255,255,.92)');
    T('تاریخ صدور',L,PAD+84,22,'500','rgba(255,255,255,.78)','left');
    T(jalaliShort(todayISO()),L,PAD+126,32,'700','#fff','left');
    let y=PAD+hh+78;
    tint(acc,.14,()=>{g.beginPath();g.arc(R-52,y+30,52,0,7);});
    T(safeInitial(M.employee.name),R-52,y+32,48,'800',acc,'center');
    TF(M.employee.name||'—',R-130,y+8,inner-480,46,'800',ink);
    T(M.employee.role||'—',R-130,y+64,26,'500',mut);
    tint(stCol,.14,()=>rcRound(g,L,y-4,320,64,32));
    T(M.status.t,L+160,y+30,28,'800',stCol,'center');
    y+=146;sep(y);y+=56;
    const signAfter=(val,sg,x,y,sz,color)=>{g.font=font('700',sz);T(sg,x+g.measureText(val).width+16,y,sz,'700',color,'left');};
    const row=(label,sub,val,color,sg)=>{T(label,R,y,30,'600',ink);if(sub){g.font=font('600',30);const w=g.measureText(label).width;T(sub,R-w-14,y+1,24,'500',mut);}T(val,L,y,34,'700',color,'left');if(sg)signAfter(val,sg,L,y,34,color);sep(y+38);y+=78;};
    const box=(label,val,color)=>{tint(color,.12,()=>rcRound(g,L-18,y-44,inner+36,92,28));T(label,R-10,y+2,34,'800',ink);T(val,L+10,y+2,44,'800',color,'left');y+=118;};
    row('جمع حقوق شب‌ها',`(${fa(M.nights.length)} شب)`,money(M.gross),ink);
    row('پاداش','',money(M.bonus),green,'+');
    row('مساعدهٔ کسرشده','',money(M.advance),orange,'−');
    y+=6;box('خالص قابل پرداخت',money(M.net),acc);
    row('پرداخت‌شده',M.pays.length?`(${fa(M.pays.length)} بار)`:'',money(M.paid),green);
    y+=6;box(M.status.k==='over'?'پرداخت اضافه':(M.status.k==='ok'?'تسویه‌شده':'مانده قابل پرداخت'),money(Math.abs(M.status.k==='ok'?0:M.balance)),stCol);
    const title=(t,sub)=>{y+=34;T(t,R,y,32,'800',ink);if(sub)T(sub,L,y+2,22,'500',mut,'left');y+=58;};
    if(M.nights.length){
      title(`ریز شب‌ها (${fa(M.nights.length)} شب)`,`مبالغ به ${settings.currency||'تومان'}`);
      const gap=24,colW=(inner-gap)/2,rowH=60;
      M.nights.forEach((n,i)=>{const col=i%2,rw=Math.floor(i/2),xr=R-col*(colW+gap),yy=y+rw*(rowH+10);
        g.save();g.fillStyle='#f6f7fc';rcRound(g,xr-colW,yy-rowH/2,colW,rowH,16);g.fill();g.restore();
        T(jalaliShort(n.date),xr-18,yy+2,24,'700',ink);TF(n.group||'—',xr-18-150,yy+2,colW-36-150-124,22,'500',mut);T(fa(Math.round(n.pay)),xr-colW+18,yy+2,24,'800',ink,'left');});
      y+=Math.ceil(M.nights.length/2)*(rowH+10);
    }
    const list=(t,items,mk)=>{ if(!items.length)return; title(t); items.forEach(it=>{const r=mk(it);g.save();g.fillStyle='#f6f7fc';rcRound(g,L,y-28,inner,58,16);g.fill();g.restore();T(r.a,R-18,y+2,24,'700',ink);TF(r.b,R-18-190,y+2,inner-36-190-260,22,'500',mut);T(r.c,L+18,y+2,26,'800',r.col,'left');if(r.sg)signAfter(r.c,r.sg,L+18,y+2,26,r.col);y+=68;}); };
    list('پاداش‌ها',M.bonuses,b=>({a:jalaliShort(b.date),b:b.note||'—',c:money(b.amount),sg:'+',col:green}));
    list('مساعده‌ها',M.advances,a=>({a:jalaliShort(a.date),b:a.note||'—',c:money(a.amount),sg:'−',col:orange}));
    list('پرداخت‌ها',M.pays,p=>({a:jalaliShort(p.date),b:[PAY_METHODS[p.method],p.note].filter(Boolean).join(' · ')||'—',c:money(p.amount),col:acc}));
    y+=64;const bw=(inner-70)/2;
    for(let i=0;i<2;i++){const xr=R-i*(bw+70);g.save();g.strokeStyle='#cfd4e3';g.lineWidth=2;g.beginPath();g.moveTo(xr-bw,y+70);g.lineTo(xr,y+70);g.stroke();g.restore();T(i?'امضای مدیر':'امضای کارمند',xr-bw/2,y+108,24,'500',mut,'center');}
    y+=170;T('ساخته‌شده با آتلیه‌یار',W/2,y,22,'500',mut,'center');
    return y+PAD+40;
  }
  async function receiptCanvas(M){
    await ensureFonts(); const W=1240,[c0,g0]=pxCanvas(W,8000),endY=drawReceipt(g0,M,W,8000),H=Math.max(1500,Math.ceil(endY));
    const [c,g]=pxCanvas(W,H);drawReceipt(g,M,W,H);return c;
  }
  function receiptPdf(canvases){
    const enc=new TextEncoder(),parts=[],offs=[];let len=0;const push=b=>{const u=typeof b==='string'?enc.encode(b):b;parts.push(u);len+=u.length;};
    const n=canvases.length;push('%PDF-1.4\n%âãÏÓ\n');const begin=id=>{offs[id]=len;push(`${id} 0 obj\n`);},end=()=>push('\nendobj\n');
    begin(1);push('<< /Type /Catalog /Pages 2 0 R >>');end();
    begin(2);push(`<< /Type /Pages /Kids [${canvases.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] /Count ${n} >>`);end();
    canvases.forEach((cv,i)=>{const PW=595,PH=Math.round(PW*cv.height/cv.width*100)/100,pid=3+i*3,cid=pid+1,iid=pid+2,bin=atob(cv.toDataURL('image/jpeg',.93).split(',')[1]),jpg=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)jpg[k]=bin.charCodeAt(k);
      const content=`q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
      begin(pid);push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);end();
      begin(cid);push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);end();
      begin(iid);push(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);push(jpg);push('\nendstream');end();});
    const total=2+n*3,xref=len;push(`xref\n0 ${total+1}\n0000000000 65535 f \n`);for(let id=1;id<=total;id++)push(`${String(offs[id]).padStart(10,'0')} 00000 n \n`);
    push(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out=new Uint8Array(len);let q=0;parts.forEach(u=>{out.set(u,q);q+=u.length;});return new Blob([out],{type:'application/pdf'});
  }
  async function shareReceipt(name,blob,mime,text){
    if(IS_NATIVE)return deliverFile(name,blob,mime);
    try{const f=new File([blob],name,{type:mime});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name,text});return 'shared';}}catch(err){if(err&&err.name==='AbortError')return 'cancelled';}
    downloadBlob(name,blob);toast('اشتراک مستقیم در این دستگاه ممکن نیست؛ فایل دانلود شد. آن را در پیام‌رسان ارسال کنید.','info',5500);return 'downloaded';
  }
  const rcName=(M,ext)=>`فیش_${String(M.employee.name||'کارمند').trim().replace(/\s+/g,'_')}_${M.from}_${M.to}.${ext}`;
  async function receiptModal(employeeId,from,to){
    from=from||$('#payrollFrom').dataset.iso||todayISO(); to=to||$('#payrollTo').dataset.iso||todayISO();
    const M=receiptModel(employeeId,from,to); if(!M){toast('برای این کارمند در این بازه اطلاعاتی نیست.','error');return;}
    openModal('فیش حقوقی',`${esc(M.employee.name)} — ${esc(jalaliShort(from))} تا ${esc(jalaliShort(to))}`,
      `<div class="receipt-preview" id="receiptPreview"><div class="empty-inline">در حال ساخت فیش…</div></div><div class="receipt-actions"><button type="button" class="btn btn-primary" data-rc-act="share">ارسال در پیام‌رسان</button><button type="button" class="btn btn-outline" data-rc-act="pdf">PDF</button><button type="button" class="btn btn-outline" data-rc-act="save">ذخیره تصویر</button>${window.ClipboardItem&&navigator.clipboard&&!IS_NATIVE?'<button type="button" class="btn btn-outline" data-rc-act="copy">کپی تصویر</button>':''}</div>`);
    const sec=$('#modalRoot .modal'); if(sec)sec.classList.add('receipt-modal');
    try{ const cv=await receiptCanvas(M),blob=await pxToBlob(cv,'image/png'); receiptCtx={M,cv,blob}; const box=$('#receiptPreview'); if(box)box.innerHTML=`<img alt="فیش حقوقی ${esc(M.employee.name)}" src="${cv.toDataURL('image/png')}">`; }
    catch(err){ console.error(err); const box=$('#receiptPreview'); if(box)box.innerHTML=`<div class="empty-inline">ساخت فیش ناموفق بود: ${esc(err.message||err)}</div>`; }
  }
  async function receiptAction(act){
    if(!receiptCtx){toast('فیش هنوز آماده نیست.','error');return;} const {M,cv,blob}=receiptCtx, text=`فیش حقوقی ${M.employee.name} — ${jalaliShort(M.from)} تا ${jalaliShort(M.to)}`;
    try{
      if(act==='share')await shareReceipt(rcName(M,'png'),blob,'image/png',text);
      else if(act==='pdf')await shareReceipt(rcName(M,'pdf'),receiptPdf([cv]),'application/pdf',text);
      else if(act==='save'){ if(IS_NATIVE)await deliverFile(rcName(M,'png'),blob,'image/png'); else {downloadBlob(rcName(M,'png'),blob);toast('تصویر فیش ذخیره شد.');} }
      else if(act==='copy'){ await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]); toast('تصویر کپی شد؛ در پیام‌رسان Paste کنید.'); }
    }catch(err){ console.error(err); toast(`انجام نشد: ${err.message||err}`,'error',5000); }
  }
  async function receiptsAll(){
    const from=$('#payrollFrom').dataset.iso||todayISO(),to=$('#payrollTo').dataset.iso||todayISO(),rows=calcPayroll(from,to).rows.filter(r=>r.nights||r.gross||r.bonus||r.advance||r.paid);
    if(!rows.length){toast('برای این بازه فیشی وجود ندارد.','error');return;} toast('در حال ساخت فیش‌ها…','info',2500);
    try{ const cvs=[]; for(const r of rows){const M=receiptModel(r.employee.id,from,to); if(M)cvs.push(await receiptCanvas(M));}
      await shareReceipt(`فیش‌های_حقوقی_${from}_${to}.pdf`,receiptPdf(cvs),'application/pdf',`فیش‌های حقوقی ${jalaliShort(from)} تا ${jalaliShort(to)}`);
    }catch(err){console.error(err);toast(`ساخت فیش‌ها ناموفق بود: ${err.message||err}`,'error',5000);}
  }
  function bindPaymentEvents(){
    document.addEventListener('click',e=>{
      const t=e.target; let b;
      if((b=t.closest('[data-pay-emp]'))){paymentModal('',b.dataset.payEmp);return;}
      if((b=t.closest('[data-receipt-emp]'))){receiptModal(b.dataset.receiptEmp,b.dataset.rcFrom||'',b.dataset.rcTo||'');return;}
      if(t.closest('#addPayment')){ if(!liveEmployees().length){toast('برای ثبت پرداخت ابتدا یک کارمند بسازید.','error');setPage('employees');return;} paymentModal('');return; }
      if((b=t.closest('[data-edit-payment]'))){paymentModal(b.dataset.editPayment);return;}
      if((b=t.closest('[data-delete-payment]'))){const id=b.dataset.deletePayment;confirmDelete('حذف پرداخت','این پرداخت از محاسبهٔ پرداخت‌شده و مانده حذف می‌شود؛ سابقه برای همگام‌سازی حفظ می‌شود.',()=>{const p=data.payments.find(x=>x.id===id);if(p){p.deletedAt=nowISO();p.updatedAt=p.deletedAt;saveData();renderAll();}});return;}
      if(t.closest('#paymentDateOpen')){showCalendar('paymentDate',$('#paymentCalendar'),true);return;}
      if((b=t.closest('[data-rc-act]'))){receiptAction(b.dataset.rcAct);return;}
      if(t.closest('#receiptsAllPdf')){receiptsAll();return;}
    });
    document.addEventListener('input',e=>{const f=e.target.closest&&e.target.closest('#paymentForm');if(f&&e.target.name==='amount')f.dataset.touched='1';});
    document.addEventListener('change',e=>{const f=e.target.closest&&e.target.closest('#paymentForm');if(f&&e.target.name==='employeeId')payRecalc(f);});
  }
  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); applyAppearance(); updateSyncIndicators(); }
  const ACCENTS=['violet','navy','slate','emerald','teal','rose','coral','amber','plum','graphite'];
  const FONT_STACKS={vazir:"Vazirmatn,Tahoma,'Segoe UI','Noto Sans Arabic',Arial,sans-serif",system:"Tahoma,'Segoe UI','Noto Sans Arabic','Noto Naskh Arabic',Arial,sans-serif"};
  const appFontStack=()=>FONT_STACKS[settings.appFont]||FONT_STACKS.vazir, exportFontStack=()=>FONT_STACKS[settings.exportFont]||FONT_STACKS.vazir;
  function ensureFonts(){ try{ if(!document.fonts||!document.fonts.load)return Promise.resolve(); return Promise.all(['400','500','700','800'].map(w=>document.fonts.load(`${w} 20px Vazirmatn`,'آبپ۰۱۲۳۴۵۶۷۸۹ 0123'))).then(()=>document.fonts.ready).catch(()=>{}); }catch(_){ return Promise.resolve(); } }
  function applyAppearance() { document.documentElement.dataset.theme=settings.theme||'dark'; if(!ACCENTS.includes(settings.accent))settings.accent='violet'; document.documentElement.dataset.accent=settings.accent; $('#themeToggle').textContent=settings.theme==='dark'?'☾':'☼'; $$('#themeSegment button').forEach(b=>b.classList.toggle('active',b.dataset.theme===settings.theme)); $$('.swatches button').forEach(b=>b.classList.toggle('active',b.dataset.accent===settings.accent)); $('#currencySetting').value=settings.currency||'تومان'; const rs=document.documentElement; rs.style.fontFamily=appFontStack(); rs.style.setProperty('--export-font',exportFontStack()); const af=$('#appFontSetting'),ef=$('#exportFontSetting'); if(af)af.value=FONT_STACKS[settings.appFont]?settings.appFont:'vazir'; if(ef)ef.value=FONT_STACKS[settings.exportFont]?settings.exportFont:'vazir'; if(settings.appFont!=='system'||settings.exportFont!=='system')ensureFonts(); try{const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),mt=document.querySelector('meta[name="theme-color"]');if(mt&&bg)mt.setAttribute('content',bg);}catch(_){} syncSystemBars(); }
  function esc(s) { return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function safeInitial(s) { return (String(s||'؟').trim()[0]||'؟'); }
  function toast(message, kind='success', duration=3300) { const el=document.createElement('div'); el.className=`toast ${kind}`; el.textContent=message; $('#toastRegion').appendChild(el); setTimeout(()=>el.remove(),duration); }
  function showPage(page) {
    const titleMap={dashboard:'داشبورد',attendance:'ثبت شبانه',planner:'برنامه‌ریزی',employees:'کارکنان',groups:'مجموعه‌ها',payroll:'حقوق و پرداخت‌ها',reports:'گزارش‌ها',settings:'تنظیمات'};
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
  function openMenu(){ const side=$('#sidebar'),btn=$('#mobileMenu');side.classList.add('open');document.body.classList.add('menu-open');if(btn)btn.setAttribute('aria-expanded','true');openLayer('menu',()=>{side.classList.remove('open');document.body.classList.remove('menu-open');if(btn)btn.setAttribute('aria-expanded','false');}); }
  function toggleMenu(){ if(layerOpen('menu'))closeLayer('menu'); else openMenu(); }
  function initDrawerGestures(){
    let start=null;
    document.addEventListener('touchstart',e=>{
      if(e.touches.length!==1){start=null;return;}
      const t=e.touches[0];start={x:t.clientX,y:t.clientY,target:e.target,atRight:t.clientX>=window.innerWidth*0.70};
    },{passive:true});
    document.addEventListener('touchend',e=>{
      if(!start||!e.changedTouches.length)return;
      const s=start;start=null;const t=e.changedTouches[0],dx=t.clientX-s.x,dy=t.clientY-s.y;
      if(Math.abs(dx)<64||Math.abs(dx)<Math.abs(dy)*1.25)return;
      const menuOpen=layerOpen('menu');
      if(!menuOpen&&s.atRight&&dx<0){openMenu();return;}
      if(menuOpen&&dx>0){closeLayer('menu');}
    },{passive:true});
  }
  function nativePlugin(name){
    try{ const cap=window.Capacitor; if(!cap)return null; return (cap.Plugins&&cap.Plugins[name])||(typeof cap.registerPlugin==='function'?cap.registerPlugin(name):null); }catch(_){ return null; }
  }
  window.__atelierBack=function(){ try{ return onBackPress(); }catch(_){ return 'exit'; } };
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
  // Nightly form drafts stay in memory until explicitly saved. Keys include the date to avoid cross-date edits.
  const attEditing=new Set();
  const attendanceDrafts=new Map();
  const activePresetIds=new Set();
  let currentPresetDate=null;
  let editingPresetId=null;
  const attExpanded=new Set();
  /* ===== v1.6.0: batch / recurring advances & bonuses ===== */
  function repeatFields(){
    const emps=liveEmployees().sort((x,y)=>(x.name||'').localeCompare(y.name||'','fa'));
    return `<details class="batch-box"><summary>ثبت دسته‌ای / تکرارشونده</summary><div class="batch-grid"><label class="field"><span>تکرار</span><select name="repeat"><option value="once">فقط یک‌بار</option><option value="monthly">هر ماه شمسی (همان روز)</option><option value="weekly">هر هفته</option></select></label><label class="field"><span>تعداد دفعات (۲ تا ۲۴)</span><input name="times" type="text" inputmode="numeric" value="3" autocomplete="off"></label></div><div class="batch-emps"><b>ثبت همین مبلغ برای کارمندان دیگر هم</b>${emps.map(e=>`<label class="batch-emp"><input type="checkbox" name="extraEmp" value="${esc(e.id)}"> ${esc(e.name)}</label>`).join('')||'<small class="muted">کارمندی وجود ندارد.</small>'}</div><p class="muted batch-hint">تاریخ، مبلغ و یادداشت بالا برای همهٔ رکوردها یکسان است. بعد از ثبت می‌توانید بازگردانی کنید.</p></details>`;
  }
  function batchDates(iso,rep,times){
    const out=[];
    if(rep==='weekly'){for(let i=0;i<times;i++){const d=parseISO(iso);d.setDate(d.getDate()+7*i);out.push(toISODate(d));}return out;}
    const p=jpISO(iso);
    for(let i=0;i<times;i++){const t=p.year*12+(p.month-1)+i,y=Math.floor(t/12),m=t%12+1,dim=jalaliMonthDays(y,m).length||29;out.push(isoFromJalali(y,m,Math.min(p.day,dim)));}
    return out;
  }
  function submitBatch(form,kind){
    const fd=new FormData(form),rep=String(fd.get('repeat')||'once'),extra=fd.getAll('extraEmp').map(String);
    if(rep==='once'&&!extra.length)return false;
    const first=String(fd.get('employeeId')||''),date=String(fd.get('date')||todayISO()),amount=numeric(fd.get('amount'));
    if(!first||amount<=0){toast('کارمند و مبلغ معتبر را وارد کنید.','error');return true;}
    const times=rep==='once'?1:Math.max(2,Math.min(24,Math.round(numeric(fd.get('times')))||2));
    const emps=[first,...extra.filter(x=>x!==first)];
    if(emps.length*times>300){toast('تعداد رکوردها زیاد است (حداکثر ۳۰۰ در هر بار).','error');return true;}
    const dates=batchDates(date,rep,times),note=String(fd.get('note')||'').trim(),isAdv=kind==='advance',col=isAdv?data.advances:data.bonuses,series=makeId('series'),made=[];
    emps.forEach(emp=>dates.forEach(d=>{const r={id:makeId(isAdv?'adv':'bonus'),createdAt:nowISO(),employeeId:emp,date:d,amount,note,updatedAt:nowISO(),deletedAt:null,seriesId:series};if(isAdv)r.deductFromPayroll=fd.get('deductFromPayroll')!=='false';col.push(r);made.push(r);}));
    saveData();closeModal();renderAll();
    toastAction(`${fa(made.length)} ${isAdv?'مساعده':'پاداش'} ثبت شد.`,'بازگردانی',()=>{const t=nowISO();made.forEach(r=>{r.deletedAt=t;r.updatedAt=t;});saveData();renderAll();toast('ثبت دسته‌ای بازگردانی شد.');},12000);
    return true;
  }

  /* ===== v1.7.1: global undo (واگرد) ===== */
  const undoStack=[];let undoing=false,lastUndoPush=0;
  function pushUndo(){
    if(undoing)return;
    const now=Date.now();if(now-lastUndoPush<1500)return; // one user action = one undo step
    let prev=null;try{prev=localStorage.getItem(DATA_KEY);}catch(_){}
    if(!prev||(undoStack.length&&undoStack[undoStack.length-1].raw===prev))return;
    lastUndoPush=now;undoStack.push({raw:prev,at:now});while(undoStack.length>15)undoStack.shift();updateUndoBtn();
  }
  function updateUndoBtn(){const b=$('#undoBtn');if(!b)return;b.disabled=!undoStack.length;b.dataset.n=undoStack.length?String(undoStack.length):'';b.title=undoStack.length?`واگرد آخرین تغییر (${fa(undoStack.length)} مرحله)`:'چیزی برای واگرد نیست';}
  function doUndo(){
    const e=undoStack.pop();if(!e){toast('چیزی برای واگرد نیست.','error');return;}
    let inc;try{inc=JSON.parse(e.raw);}catch(_){toast('واگرد ممکن نشد.','error');updateUndoBtn();return;}
    const now=nowISO(),next={schemaVersion:1,meta:{...(inc.meta||{}),updatedAt:now}};
    syncCollections.forEach(k=>{
      const old=Array.isArray(inc[k])?inc[k]:[],cur=new Map((data[k]||[]).map(x=>[x.id,x])),ids=new Set(old.map(x=>x.id));
      next[k]=old.map(x=>{const c=cur.get(x.id);return c&&JSON.stringify(c)===JSON.stringify(x)?x:{...x,updatedAt:now};});
      (data[k]||[]).forEach(x=>{if(x&&!ids.has(x.id))next[k].push({...x,deletedAt:x.deletedAt||now,updatedAt:now});});
    });
    undoing=true;try{data=next;saveData();}finally{undoing=false;}lastUndoPush=0;
    renderAll();updateUndoBtn();toast('آخرین تغییر واگرد شد.');
  }
  function bindUndo(){
    const b=$('#undoBtn');if(b)b.addEventListener('click',doUndo);updateUndoBtn();
    document.addEventListener('keydown',ev=>{if((ev.ctrlKey||ev.metaKey)&&!ev.shiftKey&&(ev.key==='z'||ev.key==='Z')){const t=ev.target;if(t&&/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||lockShown)return;ev.preventDefault();doUndo();}});
  }

  /* ===== v1.7.0: report charts, month comparison & accountant Excel ===== */
  function monthRange(y,m){const t=y*12+(m-1);y=Math.floor(t/12);m=t%12+1;const d=jalaliMonthDays(y,m);return {y,m,from:d[0].iso,to:d[d.length-1].iso,label:`${MONTHS[m-1]} ${fa(y).replace(/٬/g,'')}`};}
  function monthStats(from,to){
    const att=recordsInRange(attList(),from,to),sum=(arr,k)=>arr.reduce((s,x)=>s+Number(x[k]||0),0);
    const bon=sum(recordsInRange(data.bonuses,from,to),'amount'),adv=sum(recordsInRange(data.advances,from,to),'amount'),pay=sum(att,'payAmount'),groups=new Map();
    att.forEach(a=>{const n=liveGroupOf(a.groupId)?.name||'بدون مجموعه',o=groups.get(n)||{nights:0,cost:0};o.nights++;o.cost+=Number(a.payAmount||0);groups.set(n,o);});
    return {nights:att.length,pay,bonus:bon,adv,cost:pay+bon,groups};
  }
  function curPrevMonths(){const p=jalaliTodayParts(),c=monthRange(p.year,p.month),q=monthRange(p.year,p.month-1);return {c,q,cs:monthStats(c.from,c.to),qs:monthStats(q.from,q.to)};}
  function barPair(label,a,b,max,cur,prev){
    const w=v=>max>0?Math.max(v>0?2:0,Math.round(v/max*100)):0,diff=b>0?Math.round((a-b)/b*100):null;
    return `<div class="cmp-row"><div class="cmp-label">${esc(label)}${diff===null?'':`<small class="${diff>0?'up':diff<0?'down':''}">${diff>0?'▲':diff<0?'▼':'='} ${fa(Math.abs(diff))}٪</small>`}</div><div class="cmp-bars"><div class="cmp-bar cur" style="width:${w(a)}%"><span>${money(a)}</span></div><div class="cmp-bar prev" style="width:${w(b)}%"><span>${money(b)}</span></div></div></div>`;
  }
  function renderReportCharts(){
    const box=$('#reportCharts');if(!box)return;
    const {c,q,cs,qs}=curPrevMonths();
    const rows=[['حقوق شب‌کاری','pay'],['پاداش','bonus'],['مساعده','adv'],['هزینهٔ کل (حقوق + پاداش)','cost']];
    const max1=Math.max(1,...rows.flatMap(([,k])=>[cs[k],qs[k]]));
    const names=[...new Set([...cs.groups.keys(),...qs.groups.keys()])].sort((a,b)=>((cs.groups.get(b)?.cost||0)+(qs.groups.get(b)?.cost||0))-((cs.groups.get(a)?.cost||0)+(qs.groups.get(a)?.cost||0)));
    const max2=Math.max(1,...names.flatMap(n=>[cs.groups.get(n)?.cost||0,qs.groups.get(n)?.cost||0]));
    const trend=[5,4,3,2,1,0].map(i=>{const p=jalaliTodayParts(),r=monthRange(p.year,p.month-i);return {l:MONTHS[r.m-1],v:monthStats(r.from,r.to).cost};}),tmax=Math.max(1,...trend.map(t=>t.v));
    box.innerHTML=`<div class="cmp-legend"><span><i class="cur"></i>${esc(c.label)} (ماه جاری)</span><span><i class="prev"></i>${esc(q.label)} (ماه قبل)</span></div>
    <h4 class="cmp-title">مقایسهٔ هزینهٔ ماه جاری و ماه قبل</h4>${rows.map(([l,k])=>barPair(l,cs[k],qs[k],max1)).join('')}
    <h4 class="cmp-title">هزینه به تفکیک مجموعه</h4>${names.length?names.map(n=>barPair(`${n} · ${fa(cs.groups.get(n)?.nights||0)} شب`,cs.groups.get(n)?.cost||0,qs.groups.get(n)?.cost||0,max2)).join(''):'<div class="empty-inline">برای این دو ماه حضوری ثبت نشده است.</div>'}
    <h4 class="cmp-title">روند هزینهٔ ۶ ماه اخیر</h4><div class="trend">${trend.map(t=>`<div class="trend-col" title="${esc(money(t.v))}"><span class="trend-val">${t.v?fa(Math.round(t.v/1000)):'۰'}<small>هزار</small></span><div class="trend-bar" style="height:${Math.max(t.v>0?3:0,Math.round(t.v/tmax*100))}px"></div><span class="trend-lbl">${esc(t.l)}</span></div>`).join('')}</div>`;
  }
  function xlsxBuild(sheets){
    const colL=n=>{let o='';for(n++;n>0;n=Math.floor((n-1)/26))o=String.fromCharCode(65+(n-1)%26)+o;return o;};
    // cell: string | number | {v,s,f}; s: 1 header,2 text,3 money,4 total text,5 total money,6 title,7 note
    const cell=(x,ref)=>{const o=(x!==null&&typeof x==='object')?x:{v:x},v=o.v,s=o.s??(typeof v==='number'?3:2);
      if(v===''||v===null||v===undefined)return `<c r="${ref}" s="${s}"/>`;
      if(o.f)return `<c r="${ref}" s="${s}"><f>${xmlEsc(o.f)}</f><v>${Number(v)||0}</v></c>`;
      return typeof v==='number'?`<c r="${ref}" s="${s}"><v>${v}</v></c>`:`<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;};
    const sheetXml=sh=>{const widths=sh.rows.reduce((w,r)=>{r.forEach((x,i)=>{const v=(x!==null&&typeof x==='object')?x.v:x,l=typeof v==='number'?String(Math.round(v)).length+3:String(v??'').length;if(!(x&&x.s===6))w[i]=Math.max(w[i]||10,Math.min(46,l*1.25+3));});return w;},[]);
      const cols=`<cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${Math.max(12,w)}" customWidth="1"/>`).join('')}</cols>`;
      const rowsX=sh.rows.map((r,ri)=>`<row r="${ri+1}"${r.length&&r[0]&&r[0].s===6?' ht="28" customHeight="1"':''}>${r.map((x,ci)=>cell(x,colL(ci)+(ri+1))).join('')}</row>`).join('');
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"${sh.first?' tabSelected="1"':''}>${sh.freeze?`<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze+1}" activePane="bottomLeft" state="frozen"/>`:''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/>${cols}<sheetData>${rowsX}</sheetData><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;};
    const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font><font><b/><sz val="15"/><color rgb="FF1F2A5C"/><name val="Tahoma"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Tahoma"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3B4A9C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EBF8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFC9CEE0"/></left><right style="thin"><color rgb="FFC9CEE0"/></right><top style="thin"><color rgb="FFC9CEE0"/></top><bottom style="thin"><color rgb="FFC9CEE0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const n=sheets.length,ct='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>';
    const wb=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xmlEsc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
    const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    return zipStore([{name:'[Content_Types].xml',text:ct},{name:'_rels/.rels',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},{name:'xl/workbook.xml',text:wb},{name:'xl/_rels/workbook.xml.rels',text:rels},{name:'xl/styles.xml',text:styles},...sheets.map((s,i)=>({name:`xl/worksheets/sheet${i+1}.xml`,text:sheetXml({...s,first:i===0})}))]);
  }
  async function exportReportXlsx(){
    try{
      const {c,q,cs,qs}=curPrevMonths(),H=t=>({v:t,s:1}),T=t=>({v:t,s:4}),TM=(v,f)=>({v,s:5,f}),cur=settings.currency||'تومان';
      const sum=[[{v:'گزارش مالی آتلیه‌یار',s:6}],[{v:`مبالغ به ${cur} · تاریخ تهیه: ${jalaliDate(todayISO())}`,s:7}],[],
        [H('شرح'),H(c.label+' (ماه جاری)'),H(q.label+' (ماه قبل)'),H('تغییر'),H('درصد تغییر')]];
      const line=(l,k,r)=>{sum.push([l,cs[k],qs[k],{v:cs[k]-qs[k],f:`B${r}-C${r}`},{v:qs[k]>0?Math.round((cs[k]-qs[k])/qs[k]*1000)/10:0,f:`IF(C${r}=0,0,ROUND((B${r}-C${r})/C${r}*100,1))`}]);};
      line('تعداد شب','nights',5);line('حقوق شب‌کاری','pay',6);line('پاداش','bonus',7);line('مساعده (پرداخت پیش از تسویه)','adv',8);
      sum.push([T('هزینهٔ کل (حقوق + پاداش)'),TM(cs.cost,'B6+B7'),TM(qs.cost,'C6+C7'),TM(cs.cost-qs.cost,'B9-C9'),{v:qs.cost>0?Math.round((cs.cost-qs.cost)/qs.cost*1000)/10:0,s:5,f:'IF(C9=0,0,ROUND((B9-C9)/C9*100,1))'}]);
      sum.push([]);sum.push([H('مجموعه'),H('شب‌های ماه جاری'),H('هزینهٔ ماه جاری'),H('هزینهٔ ماه قبل'),H('تغییر')]);
      const names=[...new Set([...cs.groups.keys(),...qs.groups.keys()])].sort((a,b)=>a.localeCompare(b,'fa')),g0=sum.length+1;
      names.forEach((n,i)=>{const r=g0+i,a=cs.groups.get(n),b=qs.groups.get(n);sum.push([n,a?.nights||0,a?.cost||0,b?.cost||0,{v:(a?.cost||0)-(b?.cost||0),f:`C${r}-D${r}`}]);});
      if(names.length){const e=g0+names.length-1,r=e+1;sum.push([T('جمع'),TM(names.reduce((s,n)=>s+(cs.groups.get(n)?.nights||0),0),`SUM(B${g0}:B${e})`),TM(cs.pay,`SUM(C${g0}:C${e})`),TM(qs.pay,`SUM(D${g0}:D${e})`),TM(cs.pay-qs.pay,`C${r}-D${r}`)]);}
      sum.push([]);sum.push([{v:'هزینهٔ مجموعه‌ها فقط حقوق شب‌کاری است؛ پاداش و مساعده به مجموعه وابسته نیستند.',s:7}]);
      const from=$('#rptFrom').dataset.iso||c.from,to=$('#rptTo').dataset.iso||c.to,pr=calcPayroll(from,to),usable=pr.rows.filter(r=>r.nights||r.gross||r.bonus||r.advance||r.paid);
      const emp=[[{v:'ریز حقوق کارکنان',s:6}],[{v:`بازه: ${jalaliDate(from)} تا ${jalaliDate(to)} · مبالغ به ${cur}`,s:7}],[],[H('کارمند'),H('تعداد شب'),H('حقوق شب‌کاری'),H('پاداش'),H('مساعده کسرشده'),H('خالص قابل پرداخت'),H('پرداخت‌شده'),H('مانده')]];
      usable.forEach((r,i)=>{const n=5+i;emp.push([r.employee.name||'',r.nights,r.gross,r.bonus,r.advance,{v:r.gross+r.bonus-r.advance,f:`C${n}+D${n}-E${n}`},r.paid,{v:r.gross+r.bonus-r.advance-r.paid,f:`F${n}-G${n}`}]);});
      if(usable.length){const e=4+usable.length,r=e+1,S=L=>`SUM(${L}5:${L}${e})`,tv=k=>usable.reduce((s,x)=>s+x[k],0);emp.push([T('جمع'),TM(tv('nights'),S('B')),TM(tv('gross'),S('C')),TM(tv('bonus'),S('D')),TM(tv('advance'),S('E')),TM(pr.net,S('F')),TM(tv('paid'),S('G')),TM(pr.net-tv('paid'),S('H'))]);}
      const att=reportFiltered().rows.filter(a=>a.date>=from&&a.date<=to).sort((a,b)=>a.date.localeCompare(b.date));
      const log=[[{v:'فهرست حضورها',s:6}],[{v:`بازه: ${jalaliDate(from)} تا ${jalaliDate(to)} · فیلترهای صفحهٔ گزارش‌ها اعمال شده`,s:7}],[],[H('تاریخ'),H('کارمند'),H('مجموعه'),H('مبلغ شب')]];
      att.forEach(a=>log.push([jalaliDate(a.date),getEmployee(a.employeeId)?.name||'کارمند حذف‌شده',liveGroupOf(a.groupId)?.name||'—',Number(a.payAmount||0)]));
      if(att.length)log.push([T('جمع'),T(`${att.length} شب`),T(''),TM(att.reduce((s,a)=>s+Number(a.payAmount||0),0),`SUM(D5:D${4+att.length})`)]);
      const blob=xlsxBuild([{name:'خلاصه و مقایسه',rows:sum},{name:'ریز کارکنان',rows:emp,freeze:4},{name:'حضورها',rows:log,freeze:4}]);
      const nm=`AtelierYar-report-${from}_${to}.xlsx`,mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if(IS_NATIVE)await deliverFile(nm,blob,mime);else{downloadBlob(nm,blob);toast('فایل Excel ساخته شد.');}
    }catch(err){console.warn(err);toast('ساخت فایل Excel انجام نشد.','error');}
  }

  /* ===== v1.6.0: attendance search & filters in reports ===== */
  const RPT={group:'',emp:'',q:''};
  function reportFiltered(){
    const from=$('#rptFrom').dataset.iso||'',to=$('#rptTo').dataset.iso||'',q=RPT.q.trim().toLocaleLowerCase('fa');
    const rows=attList().filter(a=>(!RPT.group||(RPT.group==='none'?!liveGroupOf(a.groupId):a.groupId===RPT.group))&&(!RPT.emp||a.employeeId===RPT.emp)&&(!from||a.date>=from)&&(!to||a.date<=to)&&(!q||`${getEmployee(a.employeeId)?.name||''} ${liveGroupOf(a.groupId)?.name||''}`.toLocaleLowerCase('fa').includes(q))).sort((a,b)=>b.date.localeCompare(a.date));
    return {from,to,rows};
  }
  function renderReportLog(){
    const gs=$('#rptGroup'),es=$('#rptEmployee');if(!gs||!es)return;
    const emps=liveEmployees().sort((x,y)=>(x.name||'').localeCompare(y.name||'','fa'));
    if(RPT.group&&RPT.group!=='none'&&!liveGroups().some(g=>g.id===RPT.group))RPT.group='';
    if(RPT.emp&&!emps.some(e=>e.id===RPT.emp))RPT.emp='';
    gs.innerHTML=`<option value="">همهٔ مجموعه‌ها</option>${liveGroups().map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}<option value="none">بدون مجموعه</option>`;gs.value=RPT.group;
    es.innerHTML=`<option value="">همهٔ کارکنان</option>${emps.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}`;es.value=RPT.emp;
    const {from,to,rows}=reportFiltered(),inR=d=>(!from||d>=from)&&(!to||d<=to);
    const bon=data.bonuses.filter(b=>live(b)&&(!RPT.emp||b.employeeId===RPT.emp)&&inR(b.date)).reduce((s,b)=>s+Number(b.amount||0),0);
    const adv=data.advances.filter(b=>live(b)&&(!RPT.emp||b.employeeId===RPT.emp)&&inR(b.date)).reduce((s,b)=>s+Number(b.amount||0),0);
    const hint=RPT.group?' (مستقل از مجموعه)':'';
    $('#rptSummary').innerHTML=`<div class="report-card"><span>شب‌های پیدا‌شده</span><strong>${fa(rows.length)}</strong></div><div class="report-card"><span>جمع حقوق شب‌کاری</span><strong>${money(rows.reduce((s,a)=>s+Number(a.payAmount||0),0))}</strong></div><div class="report-card"><span>پاداش${hint}</span><strong>${money(bon)}</strong></div><div class="report-card"><span>مساعده${hint}</span><strong>${money(adv)}</strong></div>`;
    const CAP=300,shown=rows.slice(0,CAP);
    $('#rptTable').innerHTML=rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>تاریخ</th><th>کارمند</th><th>مجموعه</th><th>مبلغ شب</th></tr></thead><tbody>${shown.map(r=>{const e=getEmployee(r.employeeId),g=liveGroupOf(r.groupId);return `<tr><td>${esc(jalaliShort(r.date))}</td><td><div class="table-name"><span class="table-avatar">${esc(safeInitial(e?.name))}</span><b>${esc(e?.name||'کارمند حذف‌شده')}</b></div></td><td>${esc(g?.name||'—')}</td><td><b>${money(r.payAmount)}</b></td></tr>`}).join('')}</tbody></table></div>${rows.length>CAP?`<p class="muted batch-hint">${fa(CAP)} مورد از ${fa(rows.length)} نمایش داده شد؛ فیلتر را دقیق‌تر کنید.</p>`:''}`:`<div class="empty-inline">با این فیلتر حضوری پیدا نشد.</div>`;
    if(typeof labelTables==='function')labelTables($('#rptTable'));
  }
  function bindReportEvents(){
    if(!$('#rptGroup'))return;
    $('#rptGroup').addEventListener('change',e=>{RPT.group=e.target.value;renderReportLog();});
    $('#rptEmployee').addEventListener('change',e=>{RPT.emp=e.target.value;renderReportLog();});
    $('#rptSearch').addEventListener('input',e=>{RPT.q=e.target.value;renderReportLog();});
    $('#rptXlsx').addEventListener('click',exportReportXlsx);
    $('#rptClear').addEventListener('click',()=>{RPT.group=RPT.emp=RPT.q='';$('#rptSearch').value='';['#rptFrom','#rptTo'].forEach(s=>{$(s).dataset.iso='';$(s).value='';});renderReportLog();});
  }

  /* ===== v1.6.0: app lock (PIN + biometric) ===== */
  const LOCK_KEY='atelierYar.lock.v1',FAIL_KEY='atelierYar.lockfail.v1';
  let lockCfg={enabled:false},lockShown=false,lastHidden=0,pinTry='',lockBusy=false;
  const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))),unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const rnd=n=>crypto.getRandomValues(new Uint8Array(n));
  function readLock(){try{const c=JSON.parse(localStorage.getItem(LOCK_KEY)||'null');return c&&c.enabled&&c.hash&&c.salt?c:{enabled:false};}catch(_){return {enabled:false};}}
  function writeLock(c){lockCfg=c;try{localStorage.setItem(LOCK_KEY,JSON.stringify(c));return true;}catch(_){toast('ذخیرهٔ تنظیمات قفل ممکن نشد.','error');return false;}}
  async function pinHash(pin,salt,alg){
    if(alg==='pbkdf2'&&window.crypto&&crypto.subtle){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unb64(salt),iterations:150000},k,256));}
    let h1=0xdeadbeef,h2=0x41c6ce57;const s=salt+'|'+pin;for(let r=0;r<4000;r++)for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);h1=Math.imul(h1^c,2654435761);h2=Math.imul(h2^c,1597334677);}h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);return (h2>>>0).toString(16)+(h1>>>0).toString(16);
  }
  async function makeLock(pin,keep={}){const alg=(window.crypto&&crypto.subtle)?'pbkdf2':'js',salt=window.crypto&&crypto.getRandomValues?b64(rnd(16)):String(Math.random()).slice(2);return {...keep,enabled:true,alg,salt,len:pin.length,hash:await pinHash(pin,salt,alg),delay:keep.delay??0};}
  function failState(){try{return JSON.parse(localStorage.getItem(FAIL_KEY)||'{}');}catch(_){return {};}}
  function setFail(o){try{localStorage.setItem(FAIL_KEY,JSON.stringify(o));}catch(_){}}
  function lockWait(){const f=failState();return Math.max(0,Math.ceil(((f.until||0)-Date.now())/1000));}
  async function checkPin(pin){
    const w=lockWait();if(w>0)return {ok:false,wait:w};
    const ok=(await pinHash(pin,lockCfg.salt,lockCfg.alg))===lockCfg.hash;
    if(ok){setFail({});return {ok:true};}
    const n=(failState().n||0)+1,o={n};if(n%5===0)o.until=Date.now()+Math.min(300,30*Math.pow(2,n/5-1))*1000;setFail(o);return {ok:false,wait:lockWait()};
  }
  let bioDiag='',bioErr='';
  const bioHint=()=>bioErr?('خطای سیستم: '+bioErr):({'cancelled':'تأیید لغو شد.','no-plugin':'پلاگین بیومتریک در این APK نیست؛ APK را با نسخهٔ جدید دوباره بسازید و نصب کنید.','none-enrolled':'در تنظیمات گوشی هنوز اثر انگشت یا چهره ثبت نشده است.','no-hw':'این گوشی سخت‌افزار بیومتریک ندارد.','unavailable':'بیومتریک در دسترس نیست (قفل صفحهٔ گوشی را بررسی کنید).'}[bioDiag]||'در این دستگاه یا مرورگر در دسترس نیست');
  async function bioKind(){ bioDiag='';bioErr='';
    const n=nativePlugin('AtelierBiometric');if(n&&typeof n.isAvailable==='function'){try{const r=await n.isAvailable();if(r&&r.available)return 'native';if(r&&(r.code===-1||r.code===-2))return 'native';bioDiag=r&&r.code===11?'none-enrolled':r&&r.code===12?'no-hw':'unavailable';}catch(_){bioDiag='no-plugin';}}
    try{if(window.isSecureContext&&window.PublicKeyCredential&&PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())return 'webauthn';}catch(_){}
    return '';
  }
  async function bioEnroll(){
    const k=await bioKind();if(!k)return null;
    if(k==='native'){try{const r=await nativePlugin('AtelierBiometric').authenticate({reason:'برای فعال‌سازی، انگشت خود را روی حسگر بگذارید',allowDeviceCredential:false});return r&&r.success?{kind:'native'}:null;}catch(e){const c=String((e&&e.code)||''),m=(e&&e.message)||'';if(c==='10'||c==='13'||c==='5'){bioDiag='cancelled';return null;}bioErr='کد '+(c||'؟')+(m?' — '+m:'');return null;}}
    const cred=await navigator.credentials.create({publicKey:{challenge:rnd(32),rp:{name:'آتلیه‌یار'},user:{id:rnd(16),name:'atelieryar',displayName:'آتلیه‌یار'},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required'},timeout:60000}});
    return cred?{kind:'webauthn',cred:b64(cred.rawId)}:null;
  }
  async function bioVerify(){
    const b=lockCfg.bio;if(!b)return false;
    try{
      if(b.kind==='native'){const r=await nativePlugin('AtelierBiometric').authenticate({reason:'باز کردن آتلیه‌یار',allowDeviceCredential:!!lockCfg.bioOnly});return !!(r&&r.success);}
      const a=await navigator.credentials.get({publicKey:{challenge:rnd(32),allowCredentials:[{type:'public-key',id:unb64(b.cred),transports:['internal']}],userVerification:'required',timeout:60000}});
      return !!a;
    }catch(_){return false;}
  }
  function bioAlert(msg){openModal('فعال‌سازی بیومتریک انجام نشد','',`<p class="muted" style="line-height:1.9">${esc(msg)}</p><div class="modal-actions"><button class="btn btn-primary" type="button" data-close-bio>باشه</button></div>`);const b=document.querySelector('[data-close-bio]');if(b)b.addEventListener('click',closeModal);}
  function lockEl(){return document.getElementById('lockScreen');}
  function showLock(autoBio=true){
    if(!lockCfg.enabled)return;
    document.documentElement.classList.add('locked');pinTry='';
    let el=lockEl();
    if(!el){el=document.createElement('div');el.id='lockScreen';el.className='lock-screen';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');
      el.innerHTML=`<div class="lock-card"><div class="lock-mark">🔒</div><h2>آتلیه‌یار قفل است</h2><p class="muted" id="lockMsg">رمز را وارد کنید</p><div class="lock-dots" id="lockDots"></div><div class="lock-pad">${[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" data-pk="${n}">${n.toLocaleString('fa-IR')}</button>`).join('')}<button type="button" data-pk="bio" id="lockBioBtn" aria-label="ورود با بیومتریک">☝</button><button type="button" data-pk="0">${(0).toLocaleString('fa-IR')}</button><button type="button" data-pk="del" aria-label="حذف">⌫</button></div><button type="button" class="lock-bio-big" data-pk="bio" aria-label="ورود با اثر انگشت">☝</button><button type="button" class="lock-pin-link" data-pk="pinmode">ورود با رمز</button></div>`;
      el.addEventListener('click',e=>{const b=e.target.closest('[data-pk]');if(!b)return;const k=b.dataset.pk;if(k==='del')lockKey('del');else if(k==='bio')tryBio();else if(k==='pinmode')el.classList.remove('bio-only');else lockKey(k);});
      document.body.appendChild(el);
    }
    el.hidden=false;lockShown=true;$('#lockBioBtn').style.visibility=lockCfg.bio?'visible':'hidden';lockDots();el.classList.toggle('bio-only',!!(lockCfg.bio&&lockCfg.bioOnly));
    const w=lockWait();$('#lockMsg').textContent=w>0?`چند بار اشتباه وارد شد؛ ${fa(w)} ثانیه صبر کنید.`:'رمز را وارد کنید';
    if(autoBio&&lockCfg.bio)setTimeout(tryBio,350);
  }
  function lockDots(){const n=lockCfg.len||4;$('#lockDots').innerHTML=Array.from({length:n},(_,i)=>`<i class="${i<pinTry.length?'on':''}"></i>`).join('');}
  function unlockApp(){const el=lockEl();if(el)el.hidden=true;lockShown=false;pinTry='';document.documentElement.classList.remove('locked');setTimeout(maybePromptName,300);}
  async function lockKey(k){
    if(lockBusy||!lockShown)return;
    if(k==='del'){pinTry=pinTry.slice(0,-1);lockDots();return;}
    if(pinTry.length>=(lockCfg.len||4))return;
    pinTry+=k;lockDots();
    if(pinTry.length<(lockCfg.len||4))return;
    lockBusy=true;let r;try{r=await checkPin(pinTry);}catch(_){r={ok:false,wait:0};}lockBusy=false;
    if(r.ok){unlockApp();return;}
    pinTry='';const card=$('.lock-card');card.classList.remove('shake');void card.offsetWidth;card.classList.add('shake');lockDots();
    $('#lockMsg').textContent=r.wait>0?`چند بار اشتباه وارد شد؛ ${fa(r.wait)} ثانیه صبر کنید.`:'رمز اشتباه است';
  }
  async function tryBio(){if(lockBusy||!lockShown||!lockCfg.bio)return;lockBusy=true;const ok=await bioVerify();lockBusy=false;if(ok){setFail({});unlockApp();}else if(lockShown)$('#lockMsg').textContent=lockCfg.bioOnly?'تأیید نشد؛ دوباره انگشت را روی حسگر بگذارید':'بیومتریک تأیید نشد؛ رمز را وارد کنید';}
  function initLock(){
    lockCfg=readLock();updateLockButton();bindUndo();bindExtra();setTimeout(maybePromptName,600);
    if(lockCfg.enabled)showLock(true);else document.documentElement.classList.remove('locked');
    document.addEventListener('visibilitychange',()=>{
      if(!lockCfg.enabled)return;
      if(document.hidden){lastHidden=Date.now();}
      else if(!lockShown&&lastHidden&&Date.now()-lastHidden>=(Number(lockCfg.delay)||0)*1000){showLock(true);}
    });
    document.addEventListener('keydown',e=>{if(!lockShown)return;if(/^[0-9]$/.test(e.key))lockKey(e.key);else if(e.key==='Backspace')lockKey('del');});
    const nb=$('#lockNow');if(nb)nb.addEventListener('click',()=>showLock(false));
  }
  function updateLockButton(){const nb=$('#lockNow');if(nb)nb.hidden=!lockCfg.enabled;}
  async function renderLockPanel(){
    const box=$('#lockPanel');if(!box)return;const on=lockCfg.enabled,bk=await bioKind();
    box.innerHTML=`<div class="panel-head"><div><h3>قفل برنامه</h3><p class="muted">ورود با رمز عددی${bk?' یا بیومتریک':''}؛ هنگام باز شدن برنامه پرسیده می‌شود</p></div><span class="settings-icon">🔒</span></div>`+(on?`<div class="setting-row"><div><b>وضعیت</b><small class="muted">قفل فعال است</small></div></div><label class="field"><span>قفل خودکار بعد از خروج از برنامه</span><select id="lockDelay"><option value="0">بلافاصله</option><option value="30">۳۰ ثانیه</option><option value="60">۱ دقیقه</option><option value="300">۵ دقیقه</option></select></label><div class="setting-row"><div><b>ورود با بیومتریک</b><small class="muted">${bk?'اثر انگشت / چهره (رمز همیشه به‌عنوان جایگزین کار می‌کند)':bioHint()}</small></div><button class="btn btn-outline btn-small" id="lockBioToggle" type="button" ${bk||IS_NATIVE?'':'disabled'}>${lockCfg.bio?'غیرفعال‌سازی':'فعال‌سازی'}</button></div>${lockCfg.bio?`<div class="setting-row"><div><b>ورود فقط با اثر انگشت</b><small class="muted">صفحهٔ رمز عددی هنگام ورود نشان داده نمی‌شود (رمز برنامه برای مواقع اضطراری نگه داشته می‌شود)</small></div><button class="btn btn-outline btn-small" id="lockBioOnly" type="button">${lockCfg.bioOnly?'غیرفعال‌سازی':'فعال‌سازی'}</button></div>`:''}<div class="button-row"><button class="btn btn-outline btn-small" id="lockChange" type="button">تغییر رمز</button><button class="btn btn-danger-outline btn-small" id="lockOff" type="button">غیرفعال‌سازی قفل</button></div>`:`<p class="muted">رمز را فراموش نکنید؛ راه بازیابی ندارد (پشتیبان و همگام‌سازی GitHub راه نجات داده‌هاست).</p><div class="button-row"><button class="btn btn-primary btn-small" id="lockOn" type="button">فعال‌سازی قفل</button></div>`);
    const q=s=>box.querySelector(s);
    if(on){q('#lockDelay').value=String(lockCfg.delay||0);q('#lockDelay').addEventListener('change',e=>{writeLock({...lockCfg,delay:Number(e.target.value)});});
      q('#lockChange').addEventListener('click',()=>lockModal('change'));q('#lockOff').addEventListener('click',()=>lockModal('off'));
      q('#lockBioToggle').addEventListener('click',async()=>{if(lockCfg.bio){const c={...lockCfg};delete c.bio;delete c.bioOnly;writeLock(c);renderLockPanel();return;}try{const b=await bioEnroll();if(b){writeLock({...lockCfg,bio:b});toast('ورود با بیومتریک فعال شد.');}else if(bioDiag!=='cancelled')bioAlert(bioHint());}catch(e){bioAlert((e&&e.message)||'نامشخص');}renderLockPanel();});
      const bo=q('#lockBioOnly');if(bo)bo.addEventListener('click',()=>{const c={...lockCfg};if(c.bioOnly)delete c.bioOnly;else c.bioOnly=true;writeLock(c);toast(c.bioOnly?'ورود فقط با اثر انگشت فعال شد.':'صفحهٔ رمز دوباره فعال شد.');renderLockPanel();});
    }else q('#lockOn').addEventListener('click',()=>lockModal('on'));
  }
  function lockModal(mode){
    const pinField=(name,label)=>`<label class="field full"><span>${label}</span><input name="${name}" type="password" inputmode="numeric" autocomplete="off" maxlength="8" required></label>`;
    const body=(mode!=='on'?pinField('cur','رمز فعلی'):'')+(mode!=='off'?pinField('p1','رمز جدید (۴ تا ۸ رقم)')+pinField('p2','تکرار رمز جدید'):'');
    openModal(mode==='on'?'فعال‌سازی قفل':mode==='change'?'تغییر رمز':'غیرفعال‌سازی قفل','',`<form id="lockForm" class="modal-form">${body}${modalActions(mode==='off'?'غیرفعال کن':'ذخیره')}</form>`);
    $('#lockForm').addEventListener('submit',async e=>{
      e.preventDefault();e.stopPropagation();const fd=new FormData(e.target),g=n=>toEn(String(fd.get(n)||'').trim());
      if(mode!=='on'){const r=await checkPin(g('cur'));if(!r.ok){toast(r.wait?`چند ثانیه صبر کنید (${fa(r.wait)}).`:'رمز فعلی درست نیست.','error');return;}}
      if(mode==='off'){try{localStorage.removeItem(LOCK_KEY);}catch(_){}lockCfg={enabled:false};updateLockButton();closeModal();renderLockPanel();toast('قفل برنامه غیرفعال شد.');return;}
      const p1=g('p1');if(!/^\d{4,8}$/.test(p1)){toast('رمز باید ۴ تا ۸ رقم عددی باشد.','error');return;}
      if(p1!==g('p2')){toast('تکرار رمز یکسان نیست.','error');return;}
      const keep=mode==='change'?{delay:lockCfg.delay,bio:lockCfg.bio}:{delay:0};if(!keep.bio)delete keep.bio;
      if(writeLock(await makeLock(p1,keep))){setFail({});updateLockButton();closeModal();renderLockPanel();toast(mode==='on'?'قفل برنامه فعال شد.':'رمز تغییر کرد.');
        if(mode==='on'){try{if(await bioKind()){const b=await bioEnroll();if(b){writeLock({...lockCfg,bio:b});toast('ورود با اثر انگشت هم فعال شد.');renderLockPanel();}}}catch(_){}}}
    });
  }

  /* ===== v1.8.0: sensitive-action gate (confirm / PIN) ===== */
  let gateUntil=0;
  const gateFresh=()=>Date.now()<gateUntil;
  const gateOk=()=>settings.askSensitive===false||!lockCfg.enabled||gateFresh();
  function gatePin(fn){if(gateOk()){fn();return;}showGate('تأیید هویت','برای ادامه رمز برنامه را وارد کنید.',fn,true);}
  function gate(text,fn){if(settings.askSensitive===false||(lockCfg.enabled&&gateFresh())){fn();return;}showGate(lockCfg.enabled?'تأیید هویت':'تأیید تغییر',text,fn,!!lockCfg.enabled);}
  function gateEdit(f,fn,label){if(f.dataset.id||f.id==='attEditForm')gate(`تغییرات ${label} ذخیره شود؟`,fn);else fn();}
  function closeGate(){const g=$('#gateBox');if(g)g.remove();}
  function showGate(title,text,fn,needPin){
    closeGate();if(needPin&&lockCfg.bio&&lockCfg.bioOnly){(async()=>{if(await bioVerify()){gateUntil=Date.now()+45000;fn();}else toast('تأیید هویت انجام نشد.','error');})();return;}const el=document.createElement('div');el.id='gateBox';el.className='gate-box';
    el.innerHTML=`<form class="gate-card" autocomplete="off"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>${needPin?'<input class="gate-pin" name="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="رمز">':''}<p class="gate-err" hidden></p><div class="modal-actions"><button class="btn btn-primary" type="submit">تأیید</button>${needPin&&lockCfg.bio?'<button class="btn btn-outline" type="button" data-gate-bio aria-label="بیومتریک">☝</button>':''}<button class="btn btn-outline" type="button" data-gate-cancel>انصراف</button></div></form>`;
    document.body.appendChild(el);
    const err=m=>{const p=el.querySelector('.gate-err');p.textContent=m;p.hidden=false;};
    const done=()=>{gateUntil=Date.now()+(needPin?45000:3000);closeGate();fn();};
    el.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();e.stopPropagation();if(!needPin){done();return;}const r=await checkPin(toEn(el.querySelector('.gate-pin').value.trim()));if(r.ok)done();else{err(r.wait?`چند بار اشتباه شد؛ ${fa(r.wait)} ثانیه صبر کنید.`:'رمز اشتباه است.');el.querySelector('.gate-pin').value='';}});
    el.querySelector('[data-gate-cancel]').addEventListener('click',closeGate);
    const bb=el.querySelector('[data-gate-bio]');if(bb)bb.addEventListener('click',async()=>{if(await bioVerify())done();else err('بیومتریک تأیید نشد.');});
    const pin=el.querySelector('.gate-pin');if(pin)setTimeout(()=>pin.focus(),50);else el.querySelector('button[type=submit]').focus();
  }

  /* ===== v1.8.0: audit log ===== */
  const AUDIT_KEY='atelierYar.audit.v1',AUD_COLS={employees:'کارمند',groups:'مجموعه',attendances:'حضور',advances:'مساعده',bonuses:'پاداش',payments:'پرداخت'};
  const AUD_ACT={add:'افزودن',edit:'ویرایش',del:'حذف',restore:'بازگردانی',undo:'واگرد'};
  const AUD_F={amount:'مبلغ',payAmount:'مبلغ شب',name:'نام',date:'تاریخ',role:'سمت',wageAmount:'حقوق',wagePeriod:'دوره حقوق',note:'یادداشت',groupId:'مجموعه',employeeId:'کارمند',active:'وضعیت',method:'روش',deductFromPayroll:'کسر از حقوق',phone:'تلفن',periodFrom:'از',periodTo:'تا'};
  function readAudit(){try{const a=JSON.parse(localStorage.getItem(AUDIT_KEY)||'[]');return Array.isArray(a)?a:[];}catch(_){return [];}}
  function auditDesc(col,x){const emp=id=>getEmployee(id)?.name||'کارمند حذف‌شده';
    if(col==='employees'||col==='groups')return x.name||'';
    if(col==='attendances')return `${emp(x.employeeId)} · ${jalaliShort(x.date)} · ${money(x.payAmount)}`;
    return `${emp(x.employeeId)} · ${money(x.amount)} · ${jalaliShort(x.date)}`;}
  function auditChanges(){
    try{
      let prev=null;try{prev=JSON.parse(localStorage.getItem(DATA_KEY)||'null');}catch(_){}
      if(!prev)return;const at=nowISO();
      if(undoing){pushAudit([{at,act:'undo',col:'',desc:'واگرد آخرین تغییر',detail:''}]);return;}
      const out=[];
      Object.keys(AUD_COLS).forEach(col=>{
        const pm=new Map((prev[col]||[]).map(x=>[x.id,x])),list=[];
        (data[col]||[]).forEach(x=>{
          const p=pm.get(x.id);
          if(!p){if(!x.deletedAt)list.push({act:'add',x});return;}
          if(!p.deletedAt&&x.deletedAt){list.push({act:'del',x});return;}
          if(p.deletedAt&&!x.deletedAt){list.push({act:'restore',x});return;}
          if(x.deletedAt)return;
          const ch=Object.keys(AUD_F).filter(k=>JSON.stringify(p[k]??null)!==JSON.stringify(x[k]??null));
          if(ch.length){const f=k=>/amount|Amount/.test(k)?`${AUD_F[k]}: ${fa(p[k])} ← ${fa(x[k])}`:`${AUD_F[k]} تغییر کرد`;list.push({act:'edit',x,detail:ch.slice(0,3).map(f).join(' · ')});}
        });
        ['add','edit','del','restore'].forEach(act=>{
          const g=list.filter(i=>i.act===act);if(!g.length)return;
          if(g.length>6)out.push({at,act,col,desc:`${fa(g.length)} مورد`,detail:''});
          else g.forEach(i=>out.push({at,act,col,desc:auditDesc(col,i.x),detail:i.detail||''}));
        });
      });
      if(out.length)pushAudit(out);
    }catch(err){console.warn('audit',err);}
  }
  function devId(){if(!settings.deviceId){settings.deviceId=Math.random().toString(36).slice(2,6).toUpperCase();try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch(_){}}return settings.deviceId;}
  const auditBy=()=>(settings.userName||'').trim()||'ناشناس';
  function writeAudit(all){const a=all.slice(0,1000);try{localStorage.setItem(AUDIT_KEY,JSON.stringify(a));}catch(_){try{localStorage.setItem(AUDIT_KEY,JSON.stringify(a.slice(0,200)));}catch(__){}}}
  function mergeAudit(a,b){const m=new Map();[...(Array.isArray(b)?b:[]),...(Array.isArray(a)?a:[])].forEach(e=>{if(!e||!e.at)return;const id=e.id||`${e.at}|${e.act}|${e.col}|${e.desc}`;if(!m.has(id))m.set(id,{...e,id});});return [...m.values()].sort((x,y)=>String(y.at).localeCompare(String(x.at))).slice(0,1000);}
  function pushAudit(items){const by=auditBy(),dev=devId(),mine=items.slice().reverse().map(i=>({id:makeId('aud'),by,dev,...i}));writeAudit(mine.concat(readAudit()));}
  function maybePromptName(){
    if(settings.userName||settings.userNamePrompted||lockShown)return;
    openModal('نام شما','این نام کنار هر تغییر در «گزارش تغییرات» نوشته می‌شود تا وقتی چند نفر از برنامه استفاده می‌کنند معلوم باشد چه کسی چه کاری کرده.',`<form id="nameForm" class="modal-form"><label class="field full"><span>نام یا اسم مستعار *</span><input name="n" maxlength="30" required placeholder="مثلاً سارا"></label><p class="muted batch-hint">شناسهٔ این دستگاه: ${esc(devId())}؛ بعداً از تنظیمات قابل تغییر است.</p><div class="modal-actions"><button class="btn btn-primary" type="submit">ذخیره</button><button class="btn btn-outline" type="button" id="nameSkip">بعداً</button></div></form>`);
    $('#nameForm').addEventListener('submit',e=>{e.preventDefault();e.stopPropagation();const n=String(new FormData(e.target).get('n')||'').trim();if(!n)return;settings.userName=n;settings.userNamePrompted=true;saveSettings();closeModal();renderExtraPanel();toast('نام ذخیره شد.');});
    $('#nameSkip').addEventListener('click',()=>{settings.userNamePrompted=true;saveSettings();closeModal();});
  }
  function auditModal(){
    const users=[...new Set(readAudit().map(e=>e.by||'ناشناس'))];
    openModal('گزارش تغییرات','چه کسی، چه چیزی را، کی تغییر داد؛ با همگام‌سازی GitHub تغییرات همهٔ دستگاه‌ها یک‌جا دیده می‌شود.',`<div class="audit-filters"><select id="audUser"><option value="">همهٔ افراد</option>${users.map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join('')}</select><select id="audAct"><option value="">همهٔ عمل‌ها</option>${Object.entries(AUD_ACT).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><select id="audCol"><option value="">همهٔ بخش‌ها</option>${Object.entries(AUD_COLS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><input type="search" id="audQ" placeholder="جستجو..."></div><div id="audList"></div><div class="modal-actions"><button class="btn btn-outline" id="audXlsx" type="button">Excel</button><button class="btn btn-outline" data-close-modal type="button">بستن</button></div>`);
    const filt=()=>{const u=$('#audUser').value,a=$('#audAct').value,c=$('#audCol').value,q=$('#audQ').value.trim().toLocaleLowerCase('fa');return readAudit().filter(e=>(!u||(e.by||'ناشناس')===u)&&(!a||e.act===a)&&(!c||e.col===c)&&(!q||`${e.desc} ${e.detail} ${e.by||''}`.toLocaleLowerCase('fa').includes(q)));};
    const draw=()=>{const all=filt(),shown=all.slice(0,300);
      $('#audList').innerHTML=shown.length?`<div class="audit-list">${shown.map(e=>{const d=new Date(e.at);return `<div class="audit-row act-${esc(e.act)}"><span class="audit-badge">${esc(AUD_ACT[e.act]||e.act)}</span><div><b>${esc(AUD_COLS[e.col]||'')} ${esc(e.desc)}</b><small class="audit-by">${esc(e.by||'ناشناس')}${e.dev?` · ${esc(e.dev)}`:''}</small>${e.detail?`<small>${esc(e.detail)}</small>`:''}</div><time>${esc(jalaliShort(toISODate(d)))} ${d.toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})}</time></div>`}).join('')}</div>${all.length>300?`<p class="muted batch-hint">${fa(300)} مورد از ${fa(all.length)} نمایش داده شد.</p>`:''}`:'<div class="empty-inline">موردی ثبت نشده است.</div>';};
    ['#audUser','#audAct','#audCol'].forEach(s=>$(s).addEventListener('change',draw));$('#audQ').addEventListener('input',draw);draw();
    $('#audXlsx').addEventListener('click',async()=>{try{const all=filt(),H=x=>({v:x,s:1}),rows=[[{v:'گزارش تغییرات آتلیه‌یار',s:6}],[{v:`تاریخ تهیه: ${jalaliDate(todayISO())}`,s:7}],[],[H('تاریخ'),H('ساعت'),H('کاربر'),H('دستگاه'),H('عمل'),H('بخش'),H('مورد'),H('جزئیات')]];
      all.forEach(e=>{const d=new Date(e.at);rows.push([jalaliDate(toISODate(d)),d.toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'}),e.by||'ناشناس',e.dev||'',AUD_ACT[e.act]||e.act,AUD_COLS[e.col]||'',e.desc||'',e.detail||'']);});
      const blob=xlsxBuild([{name:'تغییرات',rows,freeze:4}]),nm=`AtelierYar-audit-${todayISO()}.xlsx`,mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if(IS_NATIVE)await deliverFile(nm,blob,mime);else{downloadBlob(nm,blob);toast('فایل Excel ساخته شد.');}}catch(err){console.warn(err);toast('ساخت فایل Excel انجام نشد.','error');}});
  }
  /* ===== v1.8.0: alerts & reminders ===== */
  const REM_KEY='atelierYar.remind.last';
  function renderAlerts(){
    const box=$('#alertsPanel');if(!box)return;const items=[],today=todayISO(),rm=settings.remind||{},hour=Number(rm.hour??22),h=new Date().getHours();
    const att=attList(),recorded=d=>new Set(att.filter(a=>a.date===d).map(a=>a.employeeId));
    for(let i=0;i<3;i++){const d=parseISO(today);d.setDate(d.getDate()-i);const iso=toISODate(d),have=recorded(iso),miss=plannedOn(iso).filter(p=>!have.has(p.employeeId));
      if(miss.length&&(i>0||h>=hour-2))items.push({lvl:i>0?'warn':'info',text:`${i===0?'امشب':i===1?'دیشب':'دو شب پیش'}: ${fa(miss.length)} نفر برنامه‌ریزی شده‌اند ولی حضورشان ثبت نشده.`,go:'attendance',date:iso,btn:'ثبت حضور'});}
    if(!att.some(a=>a.date===today)&&!plannedOn(today).length&&h>=hour&&activeEmployees().length)items.push({lvl:'info',text:'امشب هنوز هیچ حضوری ثبت نشده است.',go:'attendance',btn:'ثبت حضور'});
    const s30=parseISO(today);s30.setDate(s30.getDate()-29);const c=calcPayroll(toISODate(s30),today);
    const owed=c.rows.filter(r=>r.gross+r.bonus-r.advance-r.paid>0&&r.gross+r.bonus-r.advance>0);
    if(owed.length)items.push({lvl:'warn',text:`${fa(owed.length)} نفر در ۳۰ روز اخیر مانده پرداخت‌نشده دارند (جمعاً ${money(owed.reduce((s,r)=>s+r.gross+r.bonus-r.advance-r.paid,0))}).`,go:'payroll',btn:'حقوق'});
    const over=c.rows.filter(r=>r.gross+r.bonus-r.advance<0);
    if(over.length)items.push({lvl:'bad',text:`مساعدهٔ ${over.map(r=>esc(r.employee.name)).slice(0,3).join('، ')}${over.length>3?' و ...':''} از حقوق ۳۰ روز اخیر بیشتر است.`,go:'payroll',btn:'بررسی'});
    const e3=parseISO(today);e3.setDate(e3.getDate()+2);const due=[...data.advances,...data.bonuses].filter(x=>live(x)&&x.seriesId&&x.date>=today&&x.date<=toISODate(e3));
    if(due.length)items.push({lvl:'info',text:`${fa(due.length)} مساعده/پاداش تکرارشونده تا ۳ روز آینده سررسید دارد.`,go:'payroll',btn:'مشاهده'});
    const last=Date.parse(settings.lastBackupExport||'')||0;
    if(liveEmployees().length&&Date.now()-last>14*86400000)items.push({lvl:'info',text:'بیش از ۱۴ روز از آخرین پشتیبان‌گیری گذشته است.',go:'settings',btn:'پشتیبان'});
    box.hidden=!items.length;
    box.innerHTML=items.length?`<div class="panel-head"><div><h3>هشدارها و یادآورها</h3><p class="muted">مواردی که نیاز به توجه دارند</p></div></div><div class="alert-list">${items.map(i=>`<div class="alert-item ${i.lvl}"><span>${i.text}</span><button class="btn btn-outline btn-small" data-go="${esc(i.go)}"${i.date?` data-alert-date="${esc(i.date)}"`:''}>${esc(i.btn)}</button></div>`).join('')}</div>`:'';
  }
  function notifyUser(title,body){
    toast(body,'success',9000);
    try{if('Notification' in window&&Notification.permission==='granted'){const reg=navigator.serviceWorker&&navigator.serviceWorker.getRegistration?navigator.serviceWorker.getRegistration():null;Promise.resolve(reg).then(r=>{if(r&&r.showNotification)r.showNotification(title,{body});else new Notification(title,{body});}).catch(()=>{});}}catch(_){}
  }
  function checkReminder(){
    const r=settings.remind;if(!r||!r.on)return;const d=todayISO();if(new Date().getHours()<Number(r.hour??22))return;
    let last='';try{last=localStorage.getItem(REM_KEY)||'';}catch(_){}if(last===d)return;
    if(attList().some(a=>a.date===d))return;
    try{localStorage.setItem(REM_KEY,d);}catch(_){}
    notifyUser('آتلیه‌یار','امشب هنوز حضوری ثبت نشده است.');
  }
  function renderExtraPanel(){
    const box=$('#extraPanel');if(!box)return;const rm=settings.remind||{on:false,hour:22},canN='Notification' in window&&!IS_NATIVE;
    box.innerHTML=`<div class="panel-head"><div><h3>یادآور، تأیید و گزارش تغییرات</h3><p class="muted">هشدار حضور، پرسش قبل از کارهای حساس و تاریخچهٔ تغییرات</p></div><span class="settings-icon">🔔</span></div>
    <div class="setting-row"><div><b>یادآور ثبت حضور</b><small class="muted">اگر بعد از ساعت انتخابی حضوری ثبت نشده باشد، هشدار می‌دهد (هنگام باز بودن برنامه)</small></div><button class="btn btn-outline btn-small" id="remToggle" type="button">${rm.on?'غیرفعال‌سازی':'فعال‌سازی'}</button></div>
    <label class="field"><span>ساعت یادآور</span><select id="remHour">${[19,20,21,22,23,0,1,2].map(h=>`<option value="${h}">${fa(h)}:۰۰</option>`).join('')}</select></label>
    ${canN?'<div class="button-row"><button class="btn btn-outline btn-small" id="remPerm" type="button">اجازهٔ اعلان مرورگر</button></div>':'<p class="muted batch-hint">اعلان بیرون از برنامه در این نسخه پشتیبانی نمی‌شود؛ هشدارها داخل برنامه و روی داشبورد نمایش داده می‌شوند.</p>'}
    <div class="setting-row"><div><b>تأیید قبل از ویرایش و کارهای حساس</b><small class="muted">${lockCfg.enabled?'رمز برنامه پرسیده می‌شود':'پرسش تأیید نشان داده می‌شود (با فعال‌کردن قفل، رمز هم پرسیده می‌شود)'}؛ شامل حذف، ویرایش، بازیابی و پاک‌سازی</small></div><button class="btn btn-outline btn-small" id="askToggle" type="button">${settings.askSensitive===false?'فعال‌سازی':'غیرفعال‌سازی'}</button></div>
    <label class="field"><span>نام شما (کنار هر تغییر نوشته می‌شود)</span><div class="inline-save"><input id="userName" maxlength="30" value="${esc(settings.userName||'')}" placeholder="مثلاً سارا"><button class="btn btn-outline btn-small" id="userNameSave" type="button">ذخیره</button></div></label><p class="muted batch-hint">شناسهٔ این دستگاه: ${esc(devId())}</p><div class="button-row"><button class="btn btn-outline btn-small" id="audOpen" type="button">گزارش تغییرات</button><button class="btn btn-danger-outline btn-small" id="audClear" type="button">پاک کردن گزارش</button></div>`;
    const q=s=>box.querySelector(s);q('#remHour').value=String(rm.hour??22);
    q('#remToggle').addEventListener('click',()=>{settings.remind={...rm,on:!rm.on,hour:rm.hour??22};saveSettings();renderExtraPanel();if(settings.remind.on)toast('یادآور فعال شد.');});
    q('#remHour').addEventListener('change',e=>{settings.remind={...(settings.remind||{on:false}),hour:Number(e.target.value)};saveSettings();renderAlerts();});
    const rp=q('#remPerm');if(rp)rp.addEventListener('click',()=>{try{Notification.requestPermission().then(p=>toast(p==='granted'?'اعلان مرورگر مجاز شد.':'اعلان مجاز نشد.',p==='granted'?'success':'error'));}catch(_){toast('مرورگر از اعلان پشتیبانی نمی‌کند.','error');}});
    q('#askToggle').addEventListener('click',()=>{if(settings.askSensitive!==false){gatePin(()=>{settings.askSensitive=false;saveSettings();renderExtraPanel();});}else{settings.askSensitive=true;saveSettings();renderExtraPanel();}});
    q('#audOpen').addEventListener('click',auditModal);
    q('#userNameSave').addEventListener('click',()=>{const n=q('#userName').value.trim();if(!n){toast('نام را وارد کنید.','error');return;}settings.userName=n;settings.userNamePrompted=true;saveSettings();toast('نام ذخیره شد.');});
    q('#audClear').addEventListener('click',()=>gatePin(()=>{if(confirm('گزارش تغییرات پاک شود؟')){try{localStorage.removeItem(AUDIT_KEY);}catch(_){}toast('گزارش تغییرات پاک شد.');}}));
  }

  /* ===== v1.8.0: fast attendance (copy last night, backfill days) ===== */
  function copyPrevNight(){
    const date=$('#attendanceDate').dataset.iso||todayISO(),att=attList();
    const prev=[...new Set(att.filter(a=>a.date<date).map(a=>a.date))].sort().pop();
    if(!prev){toast('شب قبلی برای کپی پیدا نشد.','error');return;}
    const have=new Set(att.filter(a=>a.date===date).map(a=>a.employeeId));let n=0;
    att.filter(a=>a.date===prev).forEach(a=>{const e=getEmployee(a.employeeId);if(!e||!live(e)||e.active===false||have.has(e.id))return;attendanceDrafts.set(`${date}|${e.id}`,{selected:true,groupId:liveGroupOf(a.groupId)?a.groupId:'',payAmount:nightRate(e),advanceAmount:0,note:''});n++;});
    renderAttendance({capture:false});
    toast(n?`${fa(n)} نفر از شب ${jalaliShort(prev)} انتخاب شد؛ برای ثبت، «ذخیره» را بزنید.`:'همهٔ نفرات شب قبل برای این تاریخ ثبت شده‌اند.');
  }
  function backfillModal(){
    const emps=activeEmployees().sort((a,b)=>a.name.localeCompare(b.name,'fa'));
    if(!emps.length){toast('ابتدا کارمند اضافه کنید.','error');return;}
    const p=jalaliTodayParts(),st={y:p.year,m:p.month,days:new Set(),emps:new Set()};
    openModal('ثبت چند شب عقب‌افتاده','کارکنان و روزهای مورد نظر را انتخاب کنید؛ شب‌های ثبت‌شده از قبل رد می‌شوند.',`<div class="batch-emps bf-emps"><b>کارکنان</b>${emps.map(e=>`<label class="batch-emp"><input type="checkbox" data-bf-emp="${esc(e.id)}"> ${esc(e.name)}</label>`).join('')}</div><div class="batch-grid"><label class="field"><span>مجموعه</span><select id="bfGroup">${groupOptions(settings.lastAttGroup||'')}</select></label><label class="field"><span>مبلغ هر شب (خالی = نرخ هر کارمند)</span><input id="bfAmount" data-money type="text" inputmode="numeric" autocomplete="off"></label></div><div class="bf-nav"><button class="btn btn-outline btn-small" id="bfPrev" type="button">‹ ماه قبل</button><b id="bfTitle"></b><button class="btn btn-outline btn-small" id="bfNext" type="button">ماه بعد ›</button></div><div class="bf-grid" id="bfGrid"></div><p class="muted batch-hint" id="bfSum"></p><div class="modal-actions"><button class="btn btn-primary" id="bfSave" type="button">ثبت شب‌ها</button><button class="btn btn-outline" data-close-modal type="button">انصراف</button></div>`);
    const today=todayISO(),sum=()=>{$('#bfSum').textContent=`${fa(st.days.size)} روز × ${fa(st.emps.size)} نفر = ${fa(st.days.size*st.emps.size)} شب`;};
    const draw=()=>{const r=monthRange(st.y,st.m);st.y=r.y;st.m=r.m;$('#bfTitle').textContent=r.label;const days=jalaliMonthDays(r.y,r.m),off=(new Date(days[0].iso+'T12:00:00Z').getUTCDay()+1)%7;
      $('#bfGrid').innerHTML=['ش','ی','د','س','چ','پ','ج'].map(w=>`<i class="bf-wd">${w}</i>`).join('')+'<i></i>'.repeat(off)+days.map(d=>`<button type="button" class="bf-day${st.days.has(d.iso)?' on':''}" data-bf-day="${d.iso}" ${d.iso>today?'disabled':''}>${fa(d.day)}</button>`).join('');sum();};
    draw();
    $('#bfPrev').addEventListener('click',()=>{st.m--;draw();});$('#bfNext').addEventListener('click',()=>{st.m++;draw();});
    $('#bfGrid').addEventListener('click',e=>{const b=e.target.closest('[data-bf-day]');if(!b||b.disabled)return;const d=b.dataset.bfDay;if(st.days.has(d))st.days.delete(d);else st.days.add(d);b.classList.toggle('on');sum();});
    $$('[data-bf-emp]').forEach(c=>c.addEventListener('change',()=>{if(c.checked)st.emps.add(c.dataset.bfEmp);else st.emps.delete(c.dataset.bfEmp);sum();}));
    $('#bfSave').addEventListener('click',()=>{
      if(!st.days.size||!st.emps.size){toast('حداقل یک کارمند و یک روز انتخاب کنید.','error');return;}
      if(st.days.size*st.emps.size>300){toast('حداکثر ۳۰۰ شب در هر بار.','error');return;}
      const groupId=$('#bfGroup').value,custom=numeric($('#bfAmount').value),have=new Set(attList().map(a=>`${a.employeeId}|${a.date}`));let n=0,skip=0;
      st.emps.forEach(id=>{const e=getEmployee(id);st.days.forEach(date=>{if(have.has(`${id}|${date}`)){skip++;return;}const nid=`att_${date}_${id}`;let it=data.attendances.find(x=>x.id===nid);if(!it){it={id:nid,createdAt:nowISO()};data.attendances.push(it);}Object.assign(it,{date,groupId,employeeId:id,payAmount:custom>0?custom:nightRate(e),note:'',updatedAt:nowISO(),deletedAt:null});n++;});});
      saveData();closeModal();renderAll();toast(`${fa(n)} شب ثبت شد${skip?` و ${fa(skip)} مورد تکراری رد شد`:''}.`);
    });
  }
  function bindExtra(){
    const c=$('#copyPrevNight'),b=$('#backfillBtn');if(c)c.addEventListener('click',copyPrevNight);if(b)b.addEventListener('click',backfillModal);
    document.addEventListener('click',e=>{const g=e.target.closest('[data-alert-date]');if(g){const d=g.dataset.alertDate;const i=$('#attendanceDate');if(i){i.dataset.iso=d;renderAttendance();}}},true);
    setInterval(checkReminder,300000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){checkReminder();renderAlerts();}});checkReminder();
  }

  /* ===== v1.8.0: employee history ===== */
  function empHistory(id,from,to){
    const inR=d=>(!from||d>=from)&&(!to||d<=to),items=[];
    attList().filter(a=>a.employeeId===id&&inR(a.date)).forEach(a=>items.push({date:a.date,kind:'شب',desc:liveGroupOf(a.groupId)?.name||'بدون مجموعه',note:a.note||'',amount:Number(a.payAmount||0),sign:1}));
    data.bonuses.filter(x=>live(x)&&x.employeeId===id&&inR(x.date)).forEach(x=>items.push({date:x.date,kind:'پاداش',desc:'',note:x.note||'',amount:Number(x.amount||0),sign:1}));
    data.advances.filter(x=>live(x)&&x.employeeId===id&&inR(x.date)).forEach(x=>items.push({date:x.date,kind:'مساعده',desc:x.deductFromPayroll===false?'بدون کسر':'',note:x.note||'',amount:Number(x.amount||0),sign:-1,ded:x.deductFromPayroll!==false}));
    data.payments.filter(x=>live(x)&&x.employeeId===id&&inR(x.date)).forEach(x=>items.push({date:x.date,kind:'پرداخت',desc:x.method==='cash'?'نقدی':(x.method||''),note:x.note||'',amount:Number(x.amount||0),sign:-1}));
    items.sort((a,b)=>b.date.localeCompare(a.date));
    const sum=k=>items.filter(i=>i.kind===k).reduce((s,i)=>s+i.amount,0),adv=items.filter(i=>i.kind==='مساعده'&&i.ded).reduce((s,i)=>s+i.amount,0);
    const t={nights:items.filter(i=>i.kind==='شب').length,gross:sum('شب'),bonus:sum('پاداش'),adv:sum('مساعده'),paid:sum('پرداخت')};t.balance=t.gross+t.bonus-adv-t.paid;return {items,t};
  }
  function historyModal(id){
    const e=getEmployee(id);if(!e)return;const today=todayISO();
    const range=k=>{if(k==='all')return ['',''];if(k==='cur'||k==='prev'){const p=jalaliTodayParts(),r=monthRange(p.year,p.month-(k==='prev'?1:0));return [r.from,r.to];}const d=parseISO(today);d.setDate(d.getDate()-(Number(k)-1));return [toISODate(d),today];};
    openModal(`سابقهٔ ${e.name}`,'شب‌ها، پاداش‌ها، مساعده‌ها و پرداخت‌ها به ترتیب تاریخ',`<div class="hist-bar"><select id="hsPeriod"><option value="all">از ابتدا</option><option value="cur">ماه جاری</option><option value="prev">ماه قبل</option><option value="30">۳۰ روز اخیر</option><option value="90">۹۰ روز اخیر</option></select><button class="btn btn-outline btn-small" id="hsXlsx" type="button">Excel</button>${IS_NATIVE?'':'<button class="btn btn-outline btn-small" id="hsPrint" type="button">چاپ / PDF</button>'}</div><div id="hsBody"></div><div class="modal-actions"><button class="btn btn-outline" data-close-modal type="button">بستن</button></div>`);
    const draw=()=>{const [f,t]=range($('#hsPeriod').value),{items,t:T}=empHistory(id,f,t);
      $('#hsBody').innerHTML=`<div class="report-cards hist-cards"><div class="report-card"><span>شب‌ها</span><strong>${fa(T.nights)}</strong></div><div class="report-card"><span>حقوق شب‌ها</span><strong>${money(T.gross)}</strong></div><div class="report-card"><span>پاداش</span><strong>${money(T.bonus)}</strong></div><div class="report-card"><span>مساعده</span><strong>${money(T.adv)}</strong></div><div class="report-card"><span>پرداخت‌شده</span><strong>${money(T.paid)}</strong></div><div class="report-card"><span>مانده</span><strong>${money(T.balance)}</strong></div></div>`+(items.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>تاریخ</th><th>نوع</th><th>شرح</th><th>مبلغ</th></tr></thead><tbody>${items.map(i=>`<tr><td>${esc(jalaliShort(i.date))}</td><td><span class="hist-kind k-${i.kind==='شب'?'n':i.kind==='پاداش'?'b':i.kind==='مساعده'?'a':'p'}">${i.kind}</span></td><td>${esc(i.desc)}${i.note?` <small class="muted">${esc(i.note)}</small>`:''}</td><td><b class="${i.sign>0?'pos':'neg'}">${i.sign>0?'+':'−'}${money(i.amount)}</b></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-inline">در این بازه سابقه‌ای نیست.</div>');};
    $('#hsPeriod').addEventListener('change',draw);draw();
    $('#hsXlsx').addEventListener('click',async()=>{try{const [f,t]=range($('#hsPeriod').value),{items,t:T}=empHistory(id,f,t),H=x=>({v:x,s:1}),TT=x=>({v:x,s:4}),TM=(v,fm)=>({v,s:5,f:fm});
      const rows=[[{v:`سابقهٔ ${e.name}`,s:6}],[{v:`${f?jalaliDate(f):'از ابتدا'} تا ${t?jalaliDate(t):jalaliDate(today)} · مبالغ به ${settings.currency||'تومان'}`,s:7}],[],[H('تاریخ'),H('نوع'),H('شرح'),H('مبلغ (+ دریافتی / − کسر)')]];
      items.slice().reverse().forEach(i=>rows.push([jalaliDate(i.date),i.kind,[i.desc,i.note].filter(Boolean).join(' · '),i.sign*i.amount]));
      if(items.length){const n=4+items.length;rows.push([TT('جمع خالص'),TT(''),TT(''),TM(items.reduce((s,i)=>s+i.sign*i.amount,0),`SUM(D5:D${n})`)]);}
      rows.push([]);rows.push([{v:`مانده قابل پرداخت (حقوق + پاداش − مساعده کسرشده − پرداخت): ${fa(T.balance)}`,s:7}]);
      const blob=xlsxBuild([{name:'سابقه',rows,freeze:4}]),nm=`AtelierYar-history-${e.name.replace(/[^\p{L}\p{N}]+/gu,'_')}-${today}.xlsx`,mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if(IS_NATIVE)await deliverFile(nm,blob,mime);else{downloadBlob(nm,blob);toast('فایل Excel ساخته شد.');}}catch(err){console.warn(err);toast('ساخت فایل Excel انجام نشد.','error');}});
    const pr=$('#hsPrint');if(pr)pr.addEventListener('click',()=>{document.documentElement.classList.add('print-modal');const off=()=>{document.documentElement.classList.remove('print-modal');window.removeEventListener('afterprint',off);};window.addEventListener('afterprint',off);window.print();});
  }

  function init() {
    if(appStarted)return; appStarted=true;
    document.documentElement.classList.add(IS_NATIVE?'is-native':'is-web'); if(/Electron/i.test(navigator.userAgent))document.documentElement.classList.add('is-desktop');
    applyAppearance(); initDrawerGestures(); ensureDefaultDates();
    $('#todayLabel').textContent=jalaliDate(todayISO()); $('#footerDate').textContent=jalaliShort(todayISO());
    bindEvents(); bindReportEvents(); initLock(); renderAll(); updateStorageStats(); updateSyncIndicators(); initTableLabels(); initBackHandling();
    if(githubConfigValid()) queueAutoSync();
    window.addEventListener('focus',()=>{const now=Date.now();if(now-lastFocusSync>30000&&githubConfigValid()&&navigator.onLine){lastFocusSync=now;syncNow({silent:true});}});
    window.addEventListener('online',()=>{if(githubConfigValid())queueAutoSync();});
    if(!IS_NATIVE && 'serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost' || location.hostname==='127.0.0.1')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  function compactTitleHelp(title,text){
    if(!title||!text||!String(text).trim())return;
    let wrap=title.parentElement;
    if(!wrap.classList.contains('title-with-help')){wrap=document.createElement('span');wrap.className='title-with-help';title.parentNode.insertBefore(wrap,title);wrap.appendChild(title);}
    const existing=wrap.querySelector('.help-tip');
    if(existing){const prior=existing.dataset.helpTip||'';if(!prior.includes(String(text).trim()))existing.dataset.helpTip=prior?`${prior}\n\n${String(text).trim()}`:String(text).trim();return;}
    const btn=document.createElement('button');btn.type='button';btn.className='help-tip';btn.dataset.helpTip=String(text).trim();btn.setAttribute('aria-label','نمایش توضیح');btn.setAttribute('aria-expanded','false');btn.title='توضیح کوتاه';btn.textContent='i';wrap.appendChild(btn);
  }
  function compactExplanations(){
    document.querySelectorAll('.page-intro p.muted,.panel-head p.muted,.section-title-row p.muted,.preset-section-head p.muted,.setting-description').forEach(p=>{
      if(!p.isConnected||p.dataset.helpCompacted==='1')return;
      const text=(p.textContent||'').trim();if(!text){p.remove();return;}
      let title=p.parentElement?.querySelector('h2,h3');
      if(!title&&p.classList.contains('setting-description'))title=p.closest('.settings-panel')?.querySelector('.panel-head h3');
      if(title){compactTitleHelp(title,text);p.dataset.helpCompacted='1';p.remove();}
    });
    const attendanceHint=document.querySelector('#attendanceHint');
    if(attendanceHint&&!attendanceHint.dataset.helpCompacted){
      const clone=attendanceHint.cloneNode(true);clone.querySelector('.hint-icon')?.remove();
      const text=(clone.textContent||'').trim();
      compactTitleHelp(document.querySelector('#page-attendance h2'),text);
      attendanceHint.hidden=true;attendanceHint.dataset.helpCompacted='1';
    }
    const githubPanel=document.querySelector('#page-settings .settings-panel .warning-note');
    if(githubPanel&&!githubPanel.dataset.helpCompacted){
      const securityText=[document.querySelector('#page-settings .settings-panel .field-help')?.textContent,githubPanel.textContent].filter(Boolean).join(' ');
      const ghTitle=[...document.querySelectorAll('#page-settings .settings-panel .panel-head h3')].find(h=>h.textContent.includes('GitHub'));
      compactTitleHelp(ghTitle,securityText);githubPanel.hidden=true;githubPanel.dataset.helpCompacted='1';
      document.querySelectorAll('#page-settings .settings-panel .field-help').forEach(x=>x.hidden=true);
    }
    document.querySelectorAll('.help-panel').forEach(n=>n.remove());
    document.querySelectorAll('.welcome-row .muted,.quick-actions small').forEach(n=>n.remove());
  }
  function closeHelpPopovers(except=null){
    document.querySelectorAll('.help-popover').forEach(pop=>{if(pop!==except)pop.remove();});
    document.querySelectorAll('.help-tip[aria-expanded="true"]').forEach(btn=>{if(!except||btn.nextElementSibling!==except)btn.setAttribute('aria-expanded','false');});
  }

  function renderAll() { renderDashboard(); renderAlerts(); renderAttendance(); renderPlanner(); renderEmployees(); renderGroups(); renderPayroll(); renderReports(); renderSettings(); compactExplanations(); }
  // Convert low-priority instructional copy into compact, on-demand help.
  compactExplanations();

  function recordsInRange(collection, from, to) { return collection.filter(r=>live(r)&&r.date>=from&&r.date<=to); }
  function calcPayroll(from,to) {
    // Every night of an employee counts together, whatever group it was recorded for.
    const attend=recordsInRange(attList(),from,to);
    const adv=recordsInRange(data.advances,from,to).filter(r=>r.deductFromPayroll!==false);
    const bonuses=recordsInRange(data.bonuses,from,to);
    const map=new Map();
    const ensure=id=>{if(!map.has(id)){const e=getEmployee(id); map.set(id,{employee:e||{id,name:'کارمند حذف‌شده'},records:[],gross:0,advance:0,bonus:0,nights:0,attendanceIds:[],advanceIds:[],bonusIds:[],paid:0,paymentIds:[]});}return map.get(id);};
    attend.forEach(r=>{const row=ensure(r.employeeId);row.gross+=Number(r.payAmount)||0;row.nights++;row.records.push(r);row.attendanceIds.push(r.id);});
    adv.forEach(r=>{const row=ensure(r.employeeId);row.advance+=Number(r.amount)||0;row.advanceIds.push(r.id);});
    bonuses.forEach(r=>{const row=ensure(r.employeeId);row.bonus+=Number(r.amount)||0;row.bonusIds.push(r.id);});
    data.payments.filter(pp=>live(pp)&&paymentCounts(pp,from,to)).forEach(r=>{const row=ensure(r.employeeId);row.paid+=Number(r.amount)||0;row.paymentIds.push(r.id);});
    const rows=[...map.values()].filter(r=>r.gross!==0||r.advance!==0||r.bonus!==0||r.paid!==0||(!r.employee.deletedAt)).sort((a,b)=>(a.employee.name||'').localeCompare(b.employee.name||'','fa'));
    const gross=rows.reduce((s,r)=>s+r.gross,0), advances=rows.reduce((s,r)=>s+r.advance,0), bonusTotal=rows.reduce((s,r)=>s+r.bonus,0);
    const paid=rows.reduce((s,r)=>s+r.paid,0),net=gross+bonusTotal-advances;
    return {rows,gross,advances,bonuses:bonusTotal,net,paid,balance:net-paid,nights:attend.length,from,to};
  }
  function renderDashboard() {
    const today=todayISO(), start=parseISO(today);start.setDate(start.getDate()-9); const from=toISODate(start), totals=calcPayroll(from,today);
    $('#statEmployees').textContent=fa(activeEmployees().length); $('#statGroupsFoot').textContent=`در ${fa(liveGroups().length)} مجموعه`;
    const todayAtt=attList().filter(a=>a.date===today); $('#statAttendance').textContent=fa(todayAtt.length);
    $('#statPayroll').innerHTML=`${fa(totals.gross)} <small>${esc(settings.currency)}</small>`; $('#statAdvances').innerHTML=`${fa(totals.advances)} <small>${esc(settings.currency)}</small>`;
    const dashRows=totals.rows.filter(r=>r.gross||r.advance||r.bonus).slice(0,6);
    $('#dashboardPayroll').innerHTML=dashRows.length?dashRows.map(r=>`<div class="summary-line"><div class="summary-person"><div class="summary-avatar">${esc(safeInitial(r.employee.name))}</div><div><b>${esc(r.employee.name||'کارمند')}</b><small>${fa(r.nights)} شب کاری</small></div></div><div class="summary-pay">${money(r.gross+r.bonus-r.advance)}<small>خالص حقوق</small></div></div>`).join(''):`<div class="empty-inline"><b>هنوز اطلاعاتی ثبت نشده</b>با ثبت کارکنان و حضورهای شبانه، خلاصه حقوق اینجا نمایش داده می‌شود.</div>`;
    const recent=attList().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,5);
    $('#recentAttendance').innerHTML=recent.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>مجموعه</th><th>تاریخ</th><th>مبلغ شب</th></tr></thead><tbody>${recent.map(r=>{const e=getEmployee(r.employeeId),g=liveGroupOf(r.groupId);return `<tr><td><div class="table-name"><span class="table-avatar">${esc(safeInitial(e?.name))}</span><b>${esc(e?.name||'کارمند حذف‌شده')}</b></div></td><td>${esc(g?.name||'—')}</td><td>${esc(jalaliShort(r.date))}</td><td><b>${money(r.payAmount)}</b></td></tr>`}).join('')}</tbody></table></div>`:`<div class="empty-inline">هنوز حضوری ثبت نشده است.</div>`;
  }
  function groupOptions(selected){ return `<option value="" ${!selected?'selected':''}>بدون مجموعه</option>`+liveGroups().map(g=>`<option value="${esc(g.id)}" ${g.id===selected?'selected':''}>${esc(g.name)}</option>`).join(''); }
  function captureAttendanceDrafts(){
    const date=$('#attendanceRows')?.dataset.date||$('#attendanceDate')?.dataset.iso||todayISO();
    $$('#attendanceRows tr[data-att-emp]').forEach(tr=>{
      const employeeId=tr.dataset.attEmp, key=`${date}|${employeeId}`;
      const old=attendanceDrafts.get(key)||{};
      attendanceDrafts.set(key,{
        ...old,
        selected:!!tr.querySelector('.att-check')?.checked,
        groupId:tr.querySelector('.att-group')?.value||'',
        payAmount:numeric(tr.querySelector('.att-amount')?.value),
        advanceAmount:numeric(tr.querySelector('.att-advance')?.value),
        note:tr.querySelector('.att-note')?.value||''
      });
    });
  }
  function renderAttendance({capture=true}={}) {
    if(capture)captureAttendanceDrafts();
    const date=$('#attendanceDate').dataset.iso||todayISO();
    if(currentPresetDate!==date){activePresetIds.clear();currentPresetDate=date;}
    $('#attendanceDate').value=jalaliDate(date);
    const defGroup=liveGroupOf(settings.lastAttGroup)?settings.lastAttGroup:'', q=$('#attendanceSearch').value.trim().toLocaleLowerCase('fa');
    const employees=activeEmployees().filter(e=>!q||`${e.name} ${e.role||''}`.toLocaleLowerCase('fa').includes(q)).sort((a,b)=>a.name.localeCompare(b.name,'fa'));
    const records=attList().filter(a=>a.date===date); const byEmp=new Map(records.map(r=>[r.employeeId,r])); const planKeys=new Set(plannedOn(date).map(p=>p.employeeId)); const advByEmp=new Map(nightAdvances(date).map(a=>[a.employeeId,a]));
    // Completed staff are shown only in the lower history list. They reappear above only while editing.
    const shown=employees.filter(e=>!byEmp.has(e.id)||attEditing.has(`${date}|${e.id}`));
    records.filter(r=>attEditing.has(`${date}|${r.employeeId}`)&&!shown.some(e=>e.id===r.employeeId)).forEach(r=>{const e=getEmployee(r.employeeId);if(e)shown.push(e);});
    $('#attendanceEmpty').hidden=shown.length>0;
    if(!shown.length){
      const empty=$('#attendanceEmpty');
      if(activeEmployees().length){empty.innerHTML='<span class="empty-icon">✓</span><b>همهٔ کارکنان این تاریخ ثبت شده‌اند</b><p>برای اصلاح مبلغ یا توضیحات، از فهرست ثبت‌شده‌ها دکمهٔ ویرایش را بزنید.</p>';}
      else{empty.innerHTML='<span class="empty-icon">♙</span><b>هنوز کارمندی اضافه نشده</b><p>ابتدا از بخش کارکنان یک پروفایل بسازید.</p><button class="btn btn-primary btn-small" data-go="employees">افزودن کارمند</button>';}
    }
    $('#attendanceRows').innerHTML=shown.map(e=>{
      const r=byEmp.get(e.id), key=`${date}|${e.id}`, draft=attendanceDrafts.get(key), adv=advByEmp.get(e.id);
      const checked=draft?!!draft.selected:!!r;
      const rate=draft?Number(draft.payAmount)||0:(r?Number(r.payAmount):nightRate(e));
      const rowGroup=draft?(liveGroupOf(draft.groupId)?draft.groupId:''):(r?(liveGroupOf(r.groupId)?r.groupId:''):defGroup);
      const advanceAmount=draft?Number(draft.advanceAmount)||0:(adv?Number(adv.amount)||0:0);
      const note=draft?draft.note:(r?.note||'');
      const expanded=attExpanded.has(key);
      return `<tr data-att-emp="${esc(e.id)}" class="${checked?'present-row':''}${expanded?' expanded':''}${attEditing.has(key)?' editing-row':''}"><td><label class="check-control"><input class="att-check" type="checkbox" ${checked?'checked':''} aria-label="حضور ${esc(e.name)}"></label></td><td><div class="table-name"><span class="table-avatar">${esc(safeInitial(e.name))}</span><div><b>${esc(e.name)}</b><small>${esc(e.role||'')}${(!r&&planKeys.has(e.id))?`${e.role?' · ':''}<span class="plan-badge">برنامه‌ریزی‌شده</span>`:''}${attEditing.has(key)?' · <span class="plan-badge">در حال ویرایش</span>':''}</small></div></div></td><td><span class="soft-tag">${wagePeriodLabel(e.wagePeriod)}</span><button type="button" class="att-toggle" data-att-toggle="${esc(e.id)}" aria-expanded="${expanded?'true':'false'}" aria-label="نمایش جزئیات ${esc(e.name)}">${expanded?'▴':'▾'}</button></td><td><select class="note-input att-group" ${checked?'':'disabled'} aria-label="مجموعه ${esc(e.name)} در این شب">${groupOptions(rowGroup)}</select></td><td><input class="money-input att-amount" data-money inputmode="numeric" type="text" autocomplete="off" value="${esc(fmtMoneyInput(rate))}" ${checked?'':'disabled'} aria-label="مبلغ حقوق این شب برای ${esc(e.name)}"></td><td><input class="money-input att-advance" data-money inputmode="numeric" type="text" autocomplete="off" placeholder="اختیاری" value="${advanceAmount?esc(fmtMoneyInput(advanceAmount)):''}" ${checked?'':'disabled'} aria-label="مساعده این شب برای ${esc(e.name)}"></td><td><input class="note-input att-note" type="text" maxlength="160" placeholder="اختیاری" value="${esc(note)}" ${checked?'':'disabled'}></td></tr>`;
    }).join('');
    $('#attendanceRows').dataset.date=date;
    renderAttendancePresets();
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
  function applyPlanToAttendance(){ const date=$('#attendanceDate').dataset.iso||todayISO(); const pm=new Map(plannedOn(date).map(p=>[p.employeeId,p])); let n=0; $$('#attendanceRows tr[data-att-emp]').forEach(tr=>{ const p=pm.get(tr.dataset.attEmp); if(!p)return; const cb=tr.querySelector('.att-check'); if(!cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));} const gs=tr.querySelector('.att-group'); if(gs&&liveGroupOf(p.groupId))gs.value=p.groupId; else if(gs)gs.value=''; n++; }); updateAttendanceTotal(); toast(n?`${fa(n)} نفر طبق برنامه تیک خورد؛ بعد از بررسی ذخیره کنید.`:'کسی از برنامه‌ریزی‌شده‌ها در این لیست نیست.',n?'success':'info'); }  function updateAttendanceTotal() { const date=$('#attendanceDate')?.dataset.iso||todayISO();captureAttendanceDrafts();const chosen=new Map();attendanceDrafts.forEach((d,key)=>{if(key.startsWith(`${date}|`)&&d.selected)chosen.set(key,Number(d.payAmount)||0);});const count=chosen.size,sum=[...chosen.values()].reduce((a,b)=>a+b,0);$('#attendanceSelectedCount').textContent=`${fa(count)} نفر انتخاب شده`;$('#attendanceSelectedSum').textContent=money(sum); }
  function renderDateAttendanceSummary(){const date=$('#attendanceDate').dataset.iso||todayISO();const records=attList().filter(r=>r.date===date).sort((a,b)=>(getEmployee(a.employeeId)?.name||'').localeCompare(getEmployee(b.employeeId)?.name||'','fa'));const advMap=new Map(nightAdvances(date).map(a=>[a.employeeId,a])),bonMap=new Map(nightBonuses(date).map(a=>[a.employeeId,a]));$('#dateAttendanceSummary').innerHTML=records.length?`<div class="summary-list attendance-history-list">${records.map(r=>{const e=getEmployee(r.employeeId);return `<div class="summary-line attendance-history-item"><div class="summary-person"><div class="summary-avatar">${esc(safeInitial(e?.name))}</div><div><b>${esc(e?.name||'کارمند حذف‌شده')}</b><small>${esc(liveGroupOf(r.groupId)?.name||'بدون مجموعه')}${r.note?` · ${esc(r.note)}`:''}${advMap.get(r.employeeId)?` · مساعده ${money(advMap.get(r.employeeId).amount)}`:''}${bonMap.get(r.employeeId)?` · پاداش ${money(bonMap.get(r.employeeId).amount)}`:''}</small></div></div><div class="attendance-history-right"><strong class="summary-pay">${money(r.payAmount)}</strong><div class="card-action-group"><button type="button" class="icon-action" data-att-edit="${esc(r.employeeId)}" title="ویرایش حقوق، مجموعه، مساعده، پاداش و توضیحات" aria-label="ویرایش ${esc(e?.name||'کارمند')}">✎</button><button type="button" class="icon-action danger-action" data-att-cancel="${esc(r.employeeId)}" title="لغو ثبت این شب" aria-label="لغو ثبت ${esc(e?.name||'کارمند')}">↶</button></div></div></div>`}).join('')}</div><div class="attendance-history-foot">${fa(records.length)} نفر ثبت شده‌اند؛ برای ویرایش تاریخ‌های گذشته همین تاریخ را از بالای صفحه انتخاب کنید.</div>`:`<div class="empty-inline">برای این تاریخ هنوز حضوری ذخیره نشده است. کارکنان انتخاب‌شده پس از ذخیره به این بخش منتقل می‌شوند.</div>`;}
  function saveAttendance(){if(attEditing.size&&settings.askSensitive!==false&&!gateFresh()){gate('ویرایش حضورهای ثبت‌شده ذخیره شود؟',saveAttendance);return;}captureAttendanceDrafts();const date=$('#attendanceDate').dataset.iso||todayISO();const rowMap=new Map($$('#attendanceRows tr[data-att-emp]').map(row=>[row.dataset.attEmp,row]));const employeeIds=new Set(rowMap.keys());
    // Preserve selections made while searching: drafts hidden by the current filter are saved too.
    attendanceDrafts.forEach((draft,key)=>{if(key.startsWith(`${date}|`)&&draft.selected)employeeIds.add(key.slice(date.length+1));});
    attEditing.forEach(key=>{if(key.startsWith(`${date}|`))employeeIds.add(key.slice(date.length+1));});
    let saved=0,removed=0;
    employeeIds.forEach(employeeId=>{const row=rowMap.get(employeeId),draft=attendanceDrafts.get(`${date}|${employeeId}`);if(!row&&!draft&&!attEditing.has(`${date}|${employeeId}`))return;const checked=row?!!row.querySelector('.att-check')?.checked:!!draft?.selected;
      // Same employee + same night is ONE record, no matter which group it was entered under.
      const same=data.attendances.filter(x=>live(x)&&x.date===date&&x.employeeId===employeeId).sort((x,y)=>attTime(y)-attTime(x));
      const newId=`att_${date}_${employeeId}`;let item=same[0]||data.attendances.find(x=>x.id===newId);
      const groupId=row?.querySelector('.att-group')?.value??draft?.groupId??'', payAmount=Math.max(0,row?numeric(row.querySelector('.att-amount')?.value):Number(draft?.payAmount)||0), note=(row?.querySelector('.att-note')?.value??draft?.note??'').trim(), advanceAmount=row?numeric(row.querySelector('.att-advance')?.value):Number(draft?.advanceAmount)||0;
      if(checked){if(!item){item={id:newId,createdAt:nowISO()};data.attendances.push(item);}Object.assign(item,{date,groupId,employeeId,payAmount,note,updatedAt:nowISO(),deletedAt:null});same.slice(1).forEach(d=>{d.deletedAt=nowISO();d.updatedAt=d.deletedAt;});saved++;}
      else if(same.length){same.forEach(d=>{d.deletedAt=nowISO();d.updatedAt=d.deletedAt;});removed++;}
      syncNightAdvance(date,employeeId,checked?advanceAmount:0);attendanceDrafts.delete(`${date}|${employeeId}`);attEditing.delete(`${date}|${employeeId}`);attExpanded.delete(`${date}|${employeeId}`);
    }); activePresetIds.clear(); saveData();renderAttendance({capture:false});renderDashboard();renderPayroll();renderReports();renderGroups();renderEmployees();toast(`${fa(saved)} حضور ذخیره شد${removed?` و ${fa(removed)} مورد از این شب حذف شد`:''}.`);
  }

  function renderEmployees(){const q=$('#employeeSearch').value.trim().toLocaleLowerCase('fa'),sf=$('#employeeStatusFilter').value||'active';const myAtt=id=>attList().filter(a=>a.employeeId===id);let emps=liveEmployees().filter(e=>(sf==='all'||(sf==='active'&&e.active!==false)||(sf==='inactive'&&e.active===false))&&(!q||`${e.name} ${e.role||''} ${e.phone||''}`.toLocaleLowerCase('fa').includes(q))).sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'));$('#employeeCount').textContent=`${fa(emps.length)} کارمند`;
    $('#employeesGrid').innerHTML=emps.length?emps.map(e=>{const mine=myAtt(e.id), allNight=mine.reduce((s,a)=>s+Number(a.payAmount||0),0), employeeBonuses=data.bonuses.filter(b=>live(b)&&b.employeeId===e.id),bonusTotal=employeeBonuses.reduce((sum,b)=>sum+(Number(b.amount)||0),0);return `<article class="employee-card"><div class="employee-card-head"><div class="employee-avatar">${esc(safeInitial(e.name))}</div><div><h3>${esc(e.name)}</h3><p>${esc(e.role||'بدون سمت')}</p></div><span class="employee-status ${e.active===false?'inactive':''}">${e.active===false?'غیرفعال':'فعال'}</span></div><div class="employee-card-money"><div><small>حقوق تعریف‌شده</small><strong>${money(e.wageAmount)} <small>/${wagePeriodUnit(e.wagePeriod)}</small></strong></div><div class="night-total"><small>جمع حضورهای ثبت‌شده</small><strong>${money(allNight)}</strong></div></div><div class="employee-card-actions"><span class="soft-tag">${fa(mine.length)} شب ثبت‌شده</span><div class="card-action-group"><button class="icon-action" data-history-employee="${esc(e.id)}" title="سابقه">☰</button><button class="icon-action" data-edit-employee="${esc(e.id)}" title="ویرایش">✎</button><button class="icon-action" data-toggle-employee="${esc(e.id)}" title="فعال/غیرفعال">${e.active===false?'✓':'Ⅱ'}</button><button class="icon-action" data-delete-employee="${esc(e.id)}" title="حذف">⌫</button></div></div></article>`}).join(''):`<div class="empty-inline" style="grid-column:1/-1"><b>کارمندی پیدا نشد</b>برای شروع یک کارمند اضافه کنید و حقوق او را مشخص کنید.<br><button class="btn btn-primary btn-small" id="emptyAddEmployee" style="margin-top:12px">＋ افزودن کارمند</button></div>`;
    renderEmployeePresets();
  }
  const liveAttendancePresets=()=>data.attendancePresets.filter(live);
  function presetEmployeeChoices(selected=[]){
    const chosen=new Set(selected||[]);
    return liveEmployees().sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa')).map(e=>`<label class="preset-employee-choice"><input type="checkbox" name="employeeIds" value="${esc(e.id)}" ${chosen.has(e.id)?'checked':''}><span><b>${esc(e.name)}</b><small>${esc(e.role||'کارمند')}</small></span></label>`).join('')||'<div class="empty-inline">ابتدا کارکنان را اضافه کنید.</div>';
  }
  function presetModal(id){
    const p=id?data.attendancePresets.find(x=>x.id===id):null;
    if(!p&&!activeEmployees().length){toast('برای ساخت پریست ابتدا چند کارمند اضافه کنید.','error');return;}
    openModal(p?'ویرایش پریست کارکنان':'ساخت پریست کارکنان',p?'اعضا، حقوق هر شب و مجموعهٔ این گروه آماده را تنظیم کنید.':'یک نام، حقوق ثابت، مجموعه و اعضای گروه را انتخاب کنید.',
      `<form id="presetForm" data-id="${esc(id||'')}" class="modal-form preset-form"><label class="field full"><span>نام پریست *</span><input name="name" required maxlength="90" value="${esc(p?.name||'')}" placeholder="مثلاً کارکنان ثابت الماس"></label><label class="field"><span>حقوق هر نفر برای هر شب (تومان) *</span><input name="payAmount" data-money required inputmode="numeric" autocomplete="off" value="${esc(p?fmtMoneyInput(p.payAmount):'')}" placeholder="مثلاً ۱۵۰۰۰۰۰"></label><label class="field"><span>مجموعهٔ پیش‌فرض</span><select name="groupId">${groupOptions(p?.groupId||'')}</select></label><div class="field full"><span>اعضای این پریست <small class="muted">(می‌توانید بعداً هم تغییر دهید)</small></span><div class="preset-employee-choices">${presetEmployeeChoices(p?.employeeIds||[])}</div></div>${modalActions(p?'ذخیره تغییرات':'ساخت پریست')}</form>`);
  }
  function submitPreset(form){
    const fd=new FormData(form), id=form.dataset.id, name=String(fd.get('name')||'').trim(), employeeIds=[...new Set(fd.getAll('employeeIds').map(String))].filter(id=>live(getEmployee(id)));
    if(!name){toast('برای پریست یک نام وارد کنید.','error');return;}
    if(!employeeIds.length){toast('حداقل یک کارمند را برای پریست انتخاب کنید.','error');return;}
    const duplicate=liveAttendancePresets().some(p=>p.name.toLocaleLowerCase('fa')===name.toLocaleLowerCase('fa')&&p.id!==id);
    if(duplicate){toast('پریست دیگری با این نام وجود دارد.','error');return;}
    const p=id?data.attendancePresets.find(x=>x.id===id):{id:makeId('preset'),createdAt:nowISO()};
    Object.assign(p,{name,payAmount:Math.max(0,numeric(fd.get('payAmount'))),groupId:liveGroupOf(String(fd.get('groupId')||''))?String(fd.get('groupId')):'',employeeIds,updatedAt:nowISO(),deletedAt:null});
    if(!id)data.attendancePresets.push(p);saveData();closeModal();renderEmployees();renderAttendance({capture:false});toast(id?'پریست به‌روزرسانی شد.':'پریست جدید ساخته شد.');
  }
  function deleteAttendancePreset(id){const p=data.attendancePresets.find(x=>x.id===id);if(!p)return;confirmDelete('حذف پریست',`پریست «${esc(p.name)}» حذف می‌شود. سوابق حضورهای قبلی تغییر نمی‌کنند.`,()=>{p.deletedAt=nowISO();p.updatedAt=p.deletedAt;activePresetIds.delete(id);if(editingPresetId===id)editingPresetId=null;saveData();renderEmployees();renderAttendance({capture:false});toast('پریست حذف شد.');});}
  function presetQuickEditor(p){return `<form class="preset-inline-form" data-preset-inline-form="${esc(p.id)}"><div class="preset-edit-fields"><label class="field"><span>نام</span><input name="name" required maxlength="90" value="${esc(p.name)}"></label><label class="field"><span>حقوق هر شب (تومان)</span><input name="payAmount" data-money required inputmode="numeric" value="${esc(fmtMoneyInput(p.payAmount))}"></label><label class="field"><span>مجموعه</span><select name="groupId">${groupOptions(p.groupId||'')}</select></label></div><div class="field"><span>اعضای گروه</span><div class="preset-employee-choices">${presetEmployeeChoices(p.employeeIds||[])}</div></div><div class="button-row preset-edit-actions"><button type="submit" class="btn btn-primary btn-small">✓ ذخیرهٔ سریع</button><button type="button" class="btn btn-outline btn-small" data-preset-quick-cancel>انصراف</button></div></form>`;}
  function submitQuickPreset(form){
    const id=form.dataset.presetInlineForm||form.getAttribute('data-preset-inline-form'), p=data.attendancePresets.find(x=>x.id===id&&live(x));if(!p)return;
    const fd=new FormData(form),name=String(fd.get('name')||'').trim(),employeeIds=[...new Set(fd.getAll('employeeIds').map(String))].filter(eid=>live(getEmployee(eid)));
    if(!name){toast('نام پریست را وارد کنید.','error');return;}if(!employeeIds.length){toast('حداقل یک کارمند را انتخاب کنید.','error');return;}
    if(liveAttendancePresets().some(x=>x.id!==id&&x.name.toLocaleLowerCase('fa')===name.toLocaleLowerCase('fa'))){toast('این نام برای پریست دیگری استفاده شده است.','error');return;}
    Object.assign(p,{name,payAmount:Math.max(0,numeric(fd.get('payAmount'))),groupId:liveGroupOf(String(fd.get('groupId')||''))?String(fd.get('groupId')):'',employeeIds,updatedAt:nowISO()});editingPresetId=null;saveData();renderAttendance({capture:false});renderEmployees();toast('پریست همین‌جا ویرایش و ذخیره شد.');
  }
  function renderAttendancePresets(){
    const root=$('#attendancePresets');if(!root)return;const presets=liveAttendancePresets();
    root.innerHTML=`<div class="preset-section-head"><div><h3>⚡ پریست‌های آمادهٔ ثبت شبانه</h3><p class="muted">با انتخاب پریست، اعضا و حقوق/مجموعهٔ پیش‌فرض یک‌جا آماده می‌شوند.</p></div><div class="preset-header-actions"><button type="button" class="btn btn-primary btn-small" data-add-preset aria-label="ساخت پریست جدید"><span>＋</span> پریست جدید</button><button type="button" class="btn btn-outline btn-small" data-go="employees">مدیریت پریست‌ها</button></div></div>${presets.length?`<div class="attendance-presets-grid">${presets.map(p=>{const editing=editingPresetId===p.id;const names=(p.employeeIds||[]).map(id=>getEmployee(id)).filter(live).map(e=>e.name);return `<article class="attendance-preset-card${activePresetIds.has(p.id)?' selected':''}" data-preset-card="${esc(p.id)}"><div class="attendance-preset-top"><label class="preset-apply-check"><input type="checkbox" data-att-preset-apply="${esc(p.id)}" ${activePresetIds.has(p.id)?'checked':''}><span class="preset-checkmark">✓</span><span class="preset-title-wrap"><b>${esc(p.name)}</b><small>${fa(names.length)} نفر · ${esc(liveGroupOf(p.groupId)?.name||'بدون مجموعه')}</small></span></label><span class="preset-bolt">✦</span></div>${editing?presetQuickEditor(p):`<div class="preset-card-money"><span>حقوق هر شب</span><strong>${money(p.payAmount)}</strong></div><div class="preset-member-chips">${names.slice(0,7).map(n=>`<span>${esc(n)}</span>`).join('')}${names.length>7?`<span>+${fa(names.length-7)} نفر</span>`:''}</div><div class="preset-card-actions"><button type="button" class="btn btn-quiet btn-small" data-att-preset-edit="${esc(p.id)}">✎ ویرایش سریع همین‌جا</button></div>`}</article>`;}).join('')}</div>`:`<div class="preset-empty"><span>✦</span><div><b>هنوز پریستی ساخته نشده</b><p>برای شروع، دکمهٔ «＋ پریست جدید» را بزنید.</p></div></div>`}`;
    compactExplanations();
  }
  function renderEmployeePresets(){
    const root=$('#employeePresets');if(!root)return;const presets=liveAttendancePresets();
    root.innerHTML=`<div class="panel preset-manager"><div class="panel-head"><div><h3>✦ پریست‌های ثبت سریع</h3><p class="muted">گروه‌های آماده با حقوق و مجموعهٔ پیش‌فرض.</p></div><button type="button" class="btn btn-primary btn-small" data-add-preset>＋ ساخت پریست</button></div>${presets.length?`<div class="preset-manager-grid">${presets.map(p=>{const names=(p.employeeIds||[]).map(id=>getEmployee(id)).filter(live).map(e=>e.name);return `<article class="preset-manager-card"><div class="preset-manager-main"><span class="preset-manager-icon">✦</span><div><b>${esc(p.name)}</b><small>${fa(names.length)} عضو · ${esc(liveGroupOf(p.groupId)?.name||'بدون مجموعه')}</small><strong>${money(p.payAmount)} <small>برای هر نفر / هر شب</small></strong></div></div><div class="preset-member-chips">${names.slice(0,6).map(n=>`<span>${esc(n)}</span>`).join('')}${names.length>6?`<span>+${fa(names.length-6)}</span>`:''}</div><div class="card-action-group"><button type="button" class="icon-action" data-edit-preset="${esc(p.id)}" title="ویرایش پریست">✎</button><button type="button" class="icon-action danger-action" data-delete-preset="${esc(p.id)}" title="حذف پریست">⌫</button></div></article>`;}).join('')}</div>`:`<div class="preset-empty"><span>✦</span><div><b>گروه‌های آماده‌ات را اینجا بساز</b><p>برای ساخت گروه آماده، دکمهٔ «ساخت پریست» را بزنید.</p></div></div>`}</div>`;
    compactExplanations();
  }
  function applyAttendancePreset(id,checked,{silent=false}={}){
    if(!checked){activePresetIds.delete(id);const card=$$('[data-preset-card]').find(node=>node.dataset.presetCard===id);if(card)card.classList.remove('selected');return {applied:0,already:0,unavailable:0};}
    const p=data.attendancePresets.find(x=>x.id===id&&live(x));if(!p)return;captureAttendanceDrafts();activePresetIds.add(id);
    const date=$('#attendanceDate').dataset.iso||todayISO(), registered=new Set(attList().filter(a=>a.date===date).map(a=>a.employeeId));let applied=0,already=0,unavailable=0;
    $('#attendanceSearch').value='';
    (p.employeeIds||[]).forEach(employeeId=>{const e=getEmployee(employeeId);if(!e||!live(e)||e.active===false){unavailable++;return;}if(registered.has(employeeId)){already++;return;}attendanceDrafts.set(`${date}|${employeeId}`,{selected:true,groupId:liveGroupOf(p.groupId)?p.groupId:'',payAmount:Math.max(0,Number(p.payAmount)||0),advanceAmount:0,note:''});applied++;});
    renderAttendance({capture:false});
    if(!silent)toast(`${fa(applied)} نفر از پریست «${p.name}» آماده شد${already?`؛ ${fa(already)} نفر از قبل ثبت شده بودند`:''}${unavailable?`؛ ${fa(unavailable)} نفر غیرفعال/حذف‌شده نادیده گرفته شدند`:''}. ${applied?'برای نهایی‌شدن «ذخیره حضورها» را بزنید.':''}`,applied?'success':'info',5000);
    return {applied,already,unavailable};
  }
  function nightBonuses(date){ return data.bonuses.filter(b=>live(b)&&b.source==='attendance'&&b.date===date); }
  function syncNightBonus(date,employeeId,amount,note){
    const id=`bon_att_${date}_${employeeId}`; const cur=data.bonuses.find(b=>b.id===id&&b.source==='attendance'); const liveCur=cur&&live(cur)?cur:null; amount=Math.max(0,Number(amount)||0);
    if(amount>0){ const b=cur||{id,createdAt:nowISO()}; Object.assign(b,{employeeId,date,amount,source:'attendance',note:note||b.note||'ثبت شبانه',updatedAt:nowISO(),deletedAt:null}); if(!cur)data.bonuses.push(b); }
    else if(liveCur){ liveCur.deletedAt=nowISO(); liveCur.updatedAt=liveCur.deletedAt; }
  }
  function editAttendanceRecord(employeeId){
    const date=$('#attendanceDate').dataset.iso||todayISO(), rec=attList().find(a=>a.date===date&&a.employeeId===employeeId);if(!rec)return;
    const e=getEmployee(employeeId), adv=nightAdvances(date).find(a=>a.employeeId===employeeId), bon=nightBonuses(date).find(b=>b.employeeId===employeeId), cur=esc(settings.currency||'تومان');
    openModal(`ویرایش حضور ${esc(e?.name||'کارمند')}`,`${esc(jalaliShort(date))} — حقوق، مجموعه، مساعده، پاداش و یادداشت همین شب`,
      `<form id="attEditForm" data-emp="${esc(employeeId)}" data-date="${esc(date)}" class="modal-form">
        <label class="field"><span>مجموعه</span><select name="groupId">${groupOptions(liveGroupOf(rec.groupId)?rec.groupId:'')}</select></label>
        <label class="field"><span>حقوق این شب (${cur})</span><input name="payAmount" data-money type="text" inputmode="numeric" autocomplete="off" value="${esc(fmtMoneyInput(rec.payAmount||0))}"></label>
        <label class="field"><span>مساعده (اختیاری)</span><input name="advanceAmount" data-money type="text" inputmode="numeric" autocomplete="off" placeholder="اختیاری" value="${adv?.amount?esc(fmtMoneyInput(adv.amount)):''}"></label>
        <label class="field"><span>پاداش (اختیاری)</span><input name="bonusAmount" data-money type="text" inputmode="numeric" autocomplete="off" placeholder="اختیاری" value="${bon?.amount?esc(fmtMoneyInput(bon.amount)):''}"></label>
        <label class="field full"><span>یادداشت (اختیاری)</span><input name="note" maxlength="160" placeholder="اختیاری" value="${esc(rec.note||'')}"></label>
        ${modalActions('ذخیره تغییرات')}</form>`);
  }
  function submitAttendanceEdit(form){
    const fd=new FormData(form),employeeId=form.dataset.emp,date=form.dataset.date;
    const rec=attList().find(a=>a.date===date&&a.employeeId===employeeId);if(!rec){closeModal();return;}
    const gid=String(fd.get('groupId')||'');
    Object.assign(rec,{groupId:liveGroupOf(gid)?gid:'',payAmount:Math.max(0,numeric(fd.get('payAmount'))),note:String(fd.get('note')||'').trim(),updatedAt:nowISO()});
    syncNightAdvance(date,employeeId,numeric(fd.get('advanceAmount'))); syncNightBonus(date,employeeId,numeric(fd.get('bonusAmount')));
    saveData();closeModal();renderAttendance({capture:false});renderDashboard();renderPayroll();renderReports();renderGroups();renderEmployees();toast('تغییرات این شب ذخیره شد.');
  }
  function cancelAttendanceRecord(employeeId){
    const date=$('#attendanceDate').dataset.iso||todayISO(), recs=data.attendances.filter(a=>live(a)&&a.date===date&&a.employeeId===employeeId);if(!recs.length)return;
    const e=getEmployee(employeeId);confirmDelete('لغو ثبت حضور',`حضور «${esc(e?.name||'این کارمند')}» در تاریخ ${esc(jalaliShort(date))} لغو شود؟ بعد از لغو، نام او دوباره در فهرست ثبت‌نشده‌ها قرار می‌گیرد.`,()=>{
      const stamp=nowISO();recs.forEach(r=>{r.deletedAt=stamp;r.updatedAt=stamp;});nightAdvances(date).filter(a=>a.employeeId===employeeId).forEach(a=>{a.deletedAt=stamp;a.updatedAt=stamp;});attendanceDrafts.delete(`${date}|${employeeId}`);attEditing.delete(`${date}|${employeeId}`);attExpanded.delete(`${date}|${employeeId}`);saveData();renderAttendance({capture:false});renderDashboard();renderPayroll();renderReports();renderGroups();renderEmployees();toast('ثبت این شب لغو شد و کارمند به فهرست ثبت‌نشده‌ها برگشت.');
    });
  }
  function renderGroups(){const groups=liveGroups();$('#groupsGrid').innerHTML=groups.length?groups.map((g,i)=>{const attend=attList().filter(a=>a.groupId===g.id), people=new Set(attend.map(a=>a.employeeId));return `<article class="group-card"><div class="group-card-top"><div class="group-icon">${['▦','⌂','▤','⌘'][i%4]}</div><div><h3>${esc(g.name)}</h3><p>${esc(g.description||'برچسب محل کار')}</p></div></div><div class="group-card-stats"><div><span>نیروهای حاضر</span><b>${fa(people.size)}</b></div><div><span>شب‌های ثبت‌شده</span><b>${fa(attend.length)}</b></div></div><div class="group-card-actions"><button class="btn btn-outline btn-small" data-group-attendance="${esc(g.id)}">ثبت حضور</button><button class="icon-action" data-edit-group="${esc(g.id)}" title="ویرایش">✎</button><button class="icon-action" data-delete-group="${esc(g.id)}" title="حذف">⌫</button></div></article>`}).join(''):`<div class="empty-inline" style="grid-column:1/-1"><b>هنوز مجموعه‌ای اضافه نکرده‌اید</b>از همین‌جا باغ رویال، باغ ماد یا سالن‌های دیگر را اضافه کنید.<br><button class="btn btn-primary btn-small" id="emptyAddGroup" style="margin-top:12px">＋ افزودن مجموعه</button></div>`;}

  function renderPayroll(){const from=$('#payrollFrom').dataset.iso||todayISO(),to=$('#payrollTo').dataset.iso||todayISO(),calc=calcPayroll(from,to);renderPayments(from,to);$('#payrollKpis').innerHTML=`<div class="payroll-kpi"><span>جمع حقوق شب‌کاری</span><strong>${money(calc.gross)}</strong></div><div class="payroll-kpi bonus-kpi"><span>پاداش افزوده‌شده</span><strong>${money(calc.bonuses)}</strong></div><div class="payroll-kpi"><span>مساعده قابل کسر در بازه</span><strong>${money(calc.advances)}</strong></div><div class="payroll-kpi net"><span>خالص قابل پرداخت</span><strong>${money(calc.net)}</strong></div><div class="payroll-kpi"><span>پرداخت‌شده</span><strong style="color:var(--green)">${money(calc.paid)}</strong></div><div class="payroll-kpi"><span>مانده پرداخت</span><strong style="color:${calc.balance>0.5?'var(--orange)':'var(--green)'}">${money(Math.max(0,calc.balance))}</strong></div>`;
    const rows=calc.rows.filter(r=>r.gross||r.advance||r.bonus||r.paid||!r.employee.deletedAt);$('#payrollTable').innerHTML=rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>شب‌کاری</th><th>جمع حقوق</th><th>پاداش</th><th>مساعده</th><th>خالص پرداختی</th><th>پرداخت‌شده</th><th>مانده</th><th>مدیریت</th></tr></thead><tbody>${rows.map(r=>`<tr><td><div class="table-name"><span class="table-avatar">${esc(safeInitial(r.employee.name))}</span><b>${esc(r.employee.name||'کارمند حذف‌شده')}</b></div></td><td>${fa(r.nights)} شب</td><td>${money(r.gross)}</td><td>${r.bonus?`<span style="color:var(--green)">＋ ${money(r.bonus)}</span>`:money(0)}</td><td>${r.advance?`<span style="color:var(--orange)">− ${money(r.advance)}</span>`:money(0)}</td><td><b>${money(r.gross+r.bonus-r.advance)}</b></td><td>${money(r.paid)}</td><td>${payBadge(r)}</td><td><div class="card-action-group"><button type="button" class="btn btn-outline btn-small" data-pay-emp="${esc(r.employee.id)}">＋ پرداخت</button><button type="button" class="btn btn-outline btn-small" data-receipt-emp="${esc(r.employee.id)}">فیش</button></div></td></tr>`).join('')}</tbody><tfoot><tr><td><b>جمع کل</b></td><td>${fa(calc.nights)} شب</td><td><b>${money(calc.gross)}</b></td><td><b>${money(calc.bonuses)}</b></td><td><b>${money(calc.advances)}</b></td><td><b>${money(calc.net)}</b></td><td><b>${money(calc.paid)}</b></td><td><b>${money(Math.max(0,calc.balance))}</b></td><td></td></tr></tfoot></table></div>`:`<div class="empty-inline"><b>برای این بازه اطلاعاتی نیست</b>حضور، مساعده یا پاداشی در بازه انتخاب‌شده ثبت نشده است.</div>`;
    const advs=recordsInRange(data.advances,from,to).sort((a,b)=>b.date.localeCompare(a.date));$('#advancesTable').innerHTML=advs.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>تاریخ</th><th>مبلغ</th><th>کسر از حقوق</th><th>یادداشت</th><th>مدیریت</th></tr></thead><tbody>${advs.map(a=>{const e=getEmployee(a.employeeId);return `<tr><td><b>${esc(e?.name||'کارمند حذف‌شده')}</b></td><td>${esc(jalaliShort(a.date))}</td><td><b>${money(a.amount)}</b></td><td><span class="${a.deductFromPayroll===false?'soft-tag':'status-tag'}">${a.deductFromPayroll===false?'خیر':'بله'}</span></td><td>${a.source==='attendance'?'<span class="soft-tag">ثبت شبانه</span> ':''}${esc(a.note&&!(a.source==='attendance'&&a.note==='ثبت شبانه')?a.note:(a.source==='attendance'?'':'—'))}</td><td><div class="card-action-group"><button class="icon-action" data-edit-advance="${esc(a.id)}" title="ویرایش">✎</button><button class="icon-action" data-delete-advance="${esc(a.id)}" title="حذف">⌫</button></div></td></tr>`}).join('')}</tbody></table></div>`:`<div class="empty-inline">در این بازه مساعده‌ای ثبت نشده است.</div>`;
    const bonuses=recordsInRange(data.bonuses,from,to).sort((a,b)=>b.date.localeCompare(a.date));$('#bonusesTable').innerHTML=bonuses.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>تاریخ</th><th>مبلغ پاداش</th><th>یادداشت</th><th>مدیریت</th></tr></thead><tbody>${bonuses.map(b=>{const e=getEmployee(b.employeeId);return `<tr><td><b>${esc(e?.name||'کارمند حذف‌شده')}</b></td><td>${esc(jalaliShort(b.date))}</td><td><b>${money(b.amount)}</b></td><td>${esc(b.note||'—')}</td><td><div class="card-action-group"><button class="icon-action" data-edit-bonus="${esc(b.id)}" title="ویرایش پاداش">✎</button><button class="icon-action" data-delete-bonus="${esc(b.id)}" title="حذف پاداش">⌫</button></div></td></tr>`}).join('')}</tbody></table></div>`:`<div class="empty-inline">در این بازه پاداشی ثبت نشده است.</div>`;
  }
  function renderReports(){const today=todayISO(),start=new Date(parseISO(today));start.setDate(start.getDate()-9);const calc=calcPayroll(toISODate(start),today);$('#reportCards').innerHTML=`<div class="report-card"><span>کل شب‌های ثبت‌شده</span><strong>${fa(attList().length)}</strong></div><div class="report-card"><span>کل مبلغ حقوق شب‌کاری</span><strong>${money(attList().reduce((s,a)=>s+Number(a.payAmount||0),0))}</strong></div><div class="report-card"><span>کل پاداش‌های ثبت‌شده</span><strong>${money(data.bonuses.filter(live).reduce((s,b)=>s+Number(b.amount||0),0))}</strong></div><div class="report-card"><span>خالص حقوق ۱۰ روز اخیر</span><strong>${money(calc.net)}</strong></div>`;
    const emps=liveEmployees().map(e=>({e,recs:attList().filter(a=>a.employeeId===e.id),nights:attList().filter(a=>a.employeeId===e.id).length,gross:attList().filter(a=>a.employeeId===e.id).reduce((s,a)=>s+Number(a.payAmount||0),0)})).sort((a,b)=>b.nights-a.nights);$('#reportEmployeeTable').innerHTML=emps.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>کارمند</th><th>کل شب‌ها</th><th>جمع حقوق ثبت‌شده</th><th>محل شب‌ها (توضیحی)</th></tr></thead><tbody>${emps.map(x=>`<tr><td><div class="table-name"><span class="table-avatar">${esc(safeInitial(x.e.name))}</span><b>${esc(x.e.name)}</b></div></td><td>${fa(x.nights)}</td><td><b>${money(x.gross)}</b></td><td><small class="muted">${esc(groupBreakdown(x.recs))}</small></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty-inline">برای تهیه گزارش ابتدا کارمند اضافه کنید.</div>`;renderReportCharts();renderReportLog();}
  function renderSettings(){ renderSafety(); $('#ghOwner').value=settings.ghOwner||'';$('#ghRepo').value=settings.ghRepo||'';$('#ghBranch').value=settings.ghBranch||'main';$('#ghPath').value=settings.ghPath||'data/atelier-yar.json';$('#ghToken').value=settings.ghToken||'';$('#lastSyncLabel').textContent=settings.lastSync?`آخرین همگام‌سازی: ${new Date(settings.lastSync).toLocaleString('fa-IR')}`:'هنوز همگام‌سازی انجام نشده';updateStorageStats();updateSyncIndicators();renderLockPanel();renderExtraPanel(); }
  function updateStorageStats(){const node=$('#storageStats');if(node)node.textContent=`${fa(liveEmployees().length)} کارمند، ${fa(attList().length)} حضور، ${fa(data.advances.filter(live).length)} مساعده، ${fa(data.bonuses.filter(live).length)} پاداش`}
  function updateSyncIndicators(){const configured=Boolean(settings.ghOwner&&settings.ghRepo&&settings.ghToken),connected=configured&&settings.syncState==='connected',failed=configured&&settings.syncState==='error';const dot=$('#syncDot');if(dot)dot.classList.toggle('connected',connected);const title=$('#syncMiniTitle'),text=$('#syncMiniText');if(title)title.textContent=connected?'GitHub متصل است':failed?'خطای همگام‌سازی':configured?'آماده همگام‌سازی':'همگام‌سازی محلی';if(text)text.textContent=connected?'همگام‌سازی فعال':failed?'اتصال را بررسی کنید':settings.lastSync?'آخرین اتصال ثبت‌شده':'اطلاعات روی این دستگاه';const st=$('#syncStatusTitle'),ss=$('#syncStatusText');if(st)st.textContent=connected?'اتصال آماده است':failed?'خطا در آخرین اتصال':configured?'تنظیمات اتصال ذخیره شده':'اتصال تنظیم نشده';if(ss)ss.textContent=connected?`آخرین سینک: ${settings.lastSync?new Date(settings.lastSync).toLocaleString('fa-IR'):'هنوز انجام نشده'}`:failed?'«بررسی اتصال» را بزنید و مجوز مخزن و اعتبار توکن را بررسی کنید.':configured?'برای بررسی تنظیمات، «بررسی اتصال» را بزنید.':'ابتدا مخزن خصوصی و توکن دسترسی محدود بسازید.';}

  function openModal(title,subtitle,body,actions=''){$('#modalRoot').innerHTML=`<div class="modal-backdrop" data-backdrop><section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><div><h3>${title}</h3><p>${subtitle||''}</p></div><button class="modal-close" data-close-modal aria-label="بستن">×</button></div>${body}${actions}</section></div>`;openLayer('modal',()=>{$('#modalRoot').innerHTML='';});if(!IS_PHONE_LAYOUT()){const first=$('#modalRoot input:not([type=hidden]),#modalRoot select');if(first)first.focus();}}
  function closeModal(){if(!closeLayer('modal'))$('#modalRoot').innerHTML='';}
  function modalActions(label='ذخیره'){return `<div class="modal-actions"><button class="btn btn-primary" type="submit">${label}</button><button class="btn btn-outline" type="button" data-close-modal>انصراف</button></div>`}
  function employeeModal(id){
    const e=id?getEmployee(id):null;
    const currentBonuses=e?data.bonuses.filter(b=>live(b)&&b.employeeId===e.id):[];
    const totalBonus=currentBonuses.reduce((sum,b)=>sum+(Number(b.amount)||0),0);
    openModal(e?'ویرایش پروفایل کارمند':'افزودن کارمند',e?'اطلاعات و شرایط پرداخت را اصلاح کنید.':'اطلاعات اولیه و میزان حقوق را وارد کنید.',
      `<form id="employeeForm" data-id="${esc(id||'')}" class="modal-form">
        <label class="field"><span>نام و نام خانوادگی *</span><input name="name" required maxlength="90" value="${esc(e?.name||'')}" placeholder="مثلاً علی رضایی"></label>
        <label class="field"><span>سمت / توضیح کوتاه</span><input name="role" maxlength="70" value="${esc(e?.role||'')}" placeholder="مثلاً عکاس، نورپرداز"></label>
        <label class="field"><span>شماره تماس (اختیاری)</span><input name="phone" maxlength="30" value="${esc(e?.phone||'')}" inputmode="tel" placeholder="۰۹۱۲..."></label>
        <label class="field"><span>نوع حقوق</span><select name="wagePeriod"><option value="daily" ${(!e||e.wagePeriod==='daily')?'selected':''}>روزانه (هر شب کاری)</option><option value="weekly" ${e?.wagePeriod==='weekly'?'selected':''}>هفتگی (تقسیم بر ۷)</option><option value="monthly" ${e?.wagePeriod==='monthly'?'selected':''}>ماهانه (تقسیم بر ۳۰)</option></select></label>
        <label class="field"><span>مبلغ حقوق تعریف‌شده *</span><input name="wageAmount" data-money type="text" inputmode="numeric" autocomplete="off" required value="${esc(e?.wageAmount!=null&&e?.wageAmount!==''?fmtMoneyInput(e.wageAmount):'')}" placeholder="مثلاً ۱۲۰۰۰۰۰"></label>
        <label class="field"><span>مبلغ اختصاصی هر شب (اختیاری)</span><input name="nightRateOverride" data-money type="text" inputmode="numeric" autocomplete="off" value="${esc(e?.nightRateOverride?fmtMoneyInput(e.nightRateOverride):'')}" placeholder="در صورت تفاوت با نرخ پیش‌فرض"></label>
        <label class="field"><span>وضعیت</span><select name="active"><option value="true" ${e?.active!==false?'selected':''}>فعال</option><option value="false" ${e?.active===false?'selected':''}>غیرفعال</option></select></label>
        <label class="field full"><span>یادداشت</span><textarea name="note" maxlength="300" rows="2" placeholder="اطلاعات تکمیلی اختیاری">${esc(e?.note||'')}</textarea></label>
        
        ${modalActions(e?'ذخیره تغییرات':'ساخت پروفایل')}
      </form>`);
  }
  function groupModal(id){const g=id?getGroup(id):null;openModal(g?'ویرایش مجموعه':'افزودن مجموعه',g?'نام و توضیحات مجموعه را اصلاح کنید.':'فقط برچسبی برای اینکه هر شب بدانید نیرو کجا بوده؛ حقوق جدا حساب نمی‌شود.',`<form id="groupForm" data-id="${esc(id||'')}" class="modal-form"><label class="field full"><span>نام مجموعه *</span><input name="name" required maxlength="90" value="${esc(g?.name||'')}" placeholder="مثلاً باغ رویال"></label><label class="field full"><span>توضیحات (اختیاری)</span><input name="description" maxlength="150" value="${esc(g?.description||'')}" placeholder="باغ، سالن یا محل برگزاری"></label>${modalActions(g?'ذخیره تغییرات':'افزودن مجموعه')}</form>`);}
  function advanceModal(id){const a=id?data.advances.find(x=>x.id===id):null;const emps=liveEmployees().sort((x,y)=>(x.name||'').localeCompare(y.name||'','fa'));const employeeId=a?.employeeId||emps[0]?.id||'';const date=a?.date||todayISO();openModal(a?'ویرایش مساعده':'ثبت مساعده','مبلغ پیش‌پرداخت را برای یک کارمند ثبت کنید.',`<form id="advanceForm" data-id="${esc(id||'')}" class="modal-form"><label class="field full"><span>کارمند *</span><select name="employeeId" id="advanceEmployee" required>${emps.map(e=>`<option value="${esc(e.id)}" ${e.id===employeeId?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label><label class="field"><span>تاریخ مساعده (شمسی)</span><div class="date-input-wrap"><input class="date-text" name="dateLabel" id="advanceDate" readonly value="${esc(jalaliDate(date))}"><input type="hidden" name="date" value="${esc(date)}"><button class="date-open" id="advanceDateOpen" type="button">▦</button><div class="calendar-pop" id="advanceCalendar"></div></div></label><label class="field"><span>مبلغ (تومان) *</span><input name="amount" data-money type="text" inputmode="numeric" autocomplete="off" required value="${esc(a?.amount?fmtMoneyInput(a.amount):'')}" placeholder="مثلاً ۵۰۰۰۰۰"></label><label class="field full"><span>یادداشت</span><input name="note" maxlength="160" value="${esc(a?.note||'')}" placeholder="مثلاً مساعده نیمه دوره"></label><label class="field full"><span>نحوه محاسبه</span><select name="deductFromPayroll"><option value="true" ${a?.deductFromPayroll!==false?'selected':''}>از حقوق همین بازه کسر شود</option><option value="false" ${a?.deductFromPayroll===false?'selected':''}>فقط ثبت شود؛ در جمع خالص کسر نشود</option></select></label>${a?'':repeatFields()}${modalActions(a?'ذخیره تغییرات':'ثبت مساعده')}</form>`);}
  function bonusModal(id,employeeIdPreset=''){const b=id?data.bonuses.find(x=>x.id===id):null;const emps=liveEmployees().sort((x,y)=>(x.name||'').localeCompare(y.name||'','fa'));const employeeId=b?.employeeId||employeeIdPreset||emps[0]?.id||'';const date=b?.date||todayISO();openModal(b?'ویرایش پاداش':'ثبت پاداش','پاداش به جمع دریافتی کارمند اضافه می‌شود و از حقوق او کسر نمی‌شود.',`<form id="bonusForm" data-id="${esc(id||'')}" class="modal-form"><label class="field full"><span>کارمند *</span><select name="employeeId" required>${emps.map(e=>`<option value="${esc(e.id)}" ${e.id===employeeId?'selected':''}>${esc(e.name)}</option>`).join('')}</select></label><label class="field"><span>تاریخ پاداش (شمسی)</span><div class="date-input-wrap"><input class="date-text" name="dateLabel" id="bonusDate" readonly value="${esc(jalaliDate(date))}"><input type="hidden" name="date" value="${esc(date)}"><button class="date-open" id="bonusDateOpen" type="button">▦</button><div class="calendar-pop" id="bonusCalendar"></div></div></label><label class="field"><span>مبلغ پاداش (${esc(settings.currency||'تومان')}) *</span><input name="amount" data-money type="text" inputmode="numeric" autocomplete="off" required value="${esc(b?.amount?fmtMoneyInput(b.amount):'')}" placeholder="مثلاً ۱۰۰۰۰۰۰"></label><label class="field full"><span>یادداشت</span><input name="note" maxlength="160" value="${esc(b?.note||'')}" placeholder="مثلاً پاداش پروژه یا عملکرد"></label>${b?'':repeatFields()}${modalActions(b?'ذخیره تغییرات':'ثبت پاداش')}</form>`);}
  function submitBonus(form){if(!form.dataset.id&&submitBatch(form,'bonus'))return;const fd=new FormData(form),id=form.dataset.id,employeeId=String(fd.get('employeeId')||''),date=String(fd.get('date')||todayISO()),amount=numeric(fd.get('amount'));if(!employeeId||amount<=0){toast('کارمند و مبلغ پاداش معتبر را وارد کنید.','error');return;}const b=id?data.bonuses.find(x=>x.id===id):{id:makeId('bonus'),createdAt:nowISO()};Object.assign(b,{employeeId,date,amount,note:String(fd.get('note')||'').trim(),updatedAt:nowISO(),deletedAt:null});if(!id)data.bonuses.push(b);saveData();closeModal();renderAll();toast(id?'پاداش ویرایش شد.':'پاداش ثبت شد.');}
  function confirmDelete(title,body,onYes){openModal(title,'',`<p class="danger-copy">${body}</p><div class="modal-actions"><button class="btn btn-danger-outline" id="confirmDeleteBtn" type="button">حذف</button><button class="btn btn-outline" data-close-modal type="button">انصراف</button></div>`);$('#confirmDeleteBtn').addEventListener('click',()=>gatePin(()=>{const before=deletedMap();onYes();closeModal();offerUndo(before);}));}

  function bindEvents(){ bindSafetyEvents(); bindPaymentEvents();
    document.addEventListener('click',e=>{
      const helpBtn=e.target.closest('[data-help-tip]');
      if(helpBtn){
        e.preventDefault();const existing=helpBtn.parentElement.querySelector('.help-popover');
        closeHelpPopovers(existing||null);
        if(existing){existing.remove();helpBtn.setAttribute('aria-expanded','false');return;}
        const pop=document.createElement('span');pop.className='help-popover';pop.setAttribute('role','note');pop.textContent=helpBtn.dataset.helpTip||'';helpBtn.insertAdjacentElement('afterend',pop);helpBtn.setAttribute('aria-expanded','true');return;
      }
      if(!e.target.closest('.help-popover'))closeHelpPopovers();
      const savePresetNow=e.target.closest('[data-att-preset-save]');
      if(savePresetNow){e.preventDefault();applyAttendancePreset(savePresetNow.dataset.attPresetSave,true,{silent:true});saveAttendance();return;}
      if(plannerClick(e))return;
      const nav=e.target.closest('[data-page]');if(nav){setPage(nav.dataset.page);return;}
      const go=e.target.closest('[data-go]');if(go){setPage(go.dataset.go);return;}
      if(e.target.closest('#themeToggle')){settings.theme=settings.theme==='dark'?'light':'dark';settings.themeChosen=true;saveSettings();return;}
      if(e.target.closest('#mobileMenu')||e.target.closest('#bnMore')){toggleMenu();return;}
      if(e.target.closest('#scrim')){handleBack();return;}
      const attToggle=e.target.closest('[data-att-toggle]');if(attToggle){const id=attToggle.dataset.attToggle,date=$('#attendanceDate').dataset.iso||todayISO(),key=`${date}|${id}`,tr=attToggle.closest('tr'),open=!attExpanded.has(key);if(open)attExpanded.add(key);else attExpanded.delete(key);tr.classList.toggle('expanded',open);attToggle.textContent=open?'▴':'▾';attToggle.setAttribute('aria-expanded',open?'true':'false');return;}
      const editAttendance=e.target.closest('[data-att-edit]');if(editAttendance){editAttendanceRecord(editAttendance.dataset.attEdit);return;}
      const cancelAttendance=e.target.closest('[data-att-cancel]');if(cancelAttendance){cancelAttendanceRecord(cancelAttendance.dataset.attCancel);return;}
      const addPreset=e.target.closest('[data-add-preset]');if(addPreset){presetModal();return;}
      const editPreset=e.target.closest('[data-edit-preset]');if(editPreset){presetModal(editPreset.dataset.editPreset);return;}
      const deletePreset=e.target.closest('[data-delete-preset]');if(deletePreset){deleteAttendancePreset(deletePreset.dataset.deletePreset);return;}
      const quickEditPreset=e.target.closest('[data-att-preset-edit]');if(quickEditPreset){presetModal(quickEditPreset.dataset.attPresetEdit);return;}
      if(e.target.closest('[data-preset-quick-cancel]')){editingPresetId=null;renderAttendance({capture:false});return;}
      const nameCell=IS_PHONE_LAYOUT()&&e.target.closest('#attendanceRows td:nth-child(2)');if(nameCell){const cb=nameCell.closest('tr').querySelector('.att-check');if(cb){cb.checked=!cb.checked;cb.dispatchEvent(new Event('change',{bubbles:true}));}return;}
      if(e.target.matches('[data-close-modal]')||e.target.closest('[data-close-modal]')||e.target.matches('[data-backdrop]')){closeModal();return;}
      const histEmp=e.target.closest('[data-history-employee]');if(histEmp){historyModal(histEmp.dataset.historyEmployee);return;}
      const editEmp=e.target.closest('[data-edit-employee]');if(editEmp){employeeModal(editEmp.dataset.editEmployee);return;}
      const employeeBonus=e.target.closest('[data-add-employee-bonus]');if(employeeBonus){bonusModal('',employeeBonus.dataset.addEmployeeBonus);return;}
      const saveEmployeeBonus=e.target.closest('[data-employee-bonus-save]');if(saveEmployeeBonus){const form=$('#employeeForm');if(form&&form.reportValidity())submitEmployee(form,{openBonus:true});return;}
      const delEmp=e.target.closest('[data-delete-employee]');if(delEmp){const id=delEmp.dataset.deleteEmployee,e=getEmployee(id);confirmDelete('حذف کارمند',`پروفایل «${esc(e?.name)}» از فهرست حذف می‌شود. سابقه‌های قبلی برای محاسبات حفظ می‌شوند.`,()=>{const x=getEmployee(id);x.deletedAt=nowISO();x.updatedAt=x.deletedAt;saveData();renderAll();toast('پروفایل کارمند حذف شد.');});return;}
      const toggleEmp=e.target.closest('[data-toggle-employee]');if(toggleEmp){const x=getEmployee(toggleEmp.dataset.toggleEmployee);x.active=x.active===false?true:false;x.updatedAt=nowISO();saveData();renderEmployees();renderDashboard();toast(x.active?'کارمند فعال شد.':'کارمند غیرفعال شد.');return;}
      const editGroup=e.target.closest('[data-edit-group]');if(editGroup){groupModal(editGroup.dataset.editGroup);return;}
      const delGroup=e.target.closest('[data-delete-group]');if(delGroup){const id=delGroup.dataset.deleteGroup,g=getGroup(id);confirmDelete('حذف مجموعه',`مجموعه «${esc(g?.name)}» از فهرست حذف می‌شود. سوابق حضور و حقوق پاک نمی‌شوند؛ فقط برچسب مجموعه از آن شب‌ها نمایش داده نمی‌شود.`,()=>{const x=getGroup(id);x.deletedAt=nowISO();x.updatedAt=x.deletedAt;saveData();renderAll();toast('مجموعه حذف شد.');});return;}
      const groupAtt=e.target.closest('[data-group-attendance]');if(groupAtt){setPage('attendance');settings.lastAttGroup=groupAtt.dataset.groupAttendance;localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));renderAttendance();return;}
      const editAdv=e.target.closest('[data-edit-advance]');if(editAdv){advanceModal(editAdv.dataset.editAdvance);return;}
      const delAdv=e.target.closest('[data-delete-advance]');if(delAdv){const id=delAdv.dataset.deleteAdvance;confirmDelete('حذف مساعده','این مساعده از محاسبات بعدی حذف می‌شود. سوابق به‌صورت نرم حذف می‌شود تا همگام‌سازی درست بماند.',()=>{const a=data.advances.find(x=>x.id===id);a.deletedAt=nowISO();a.updatedAt=a.deletedAt;saveData();renderAll();toast('مساعده حذف شد.');});return;}
      const editBonus=e.target.closest('[data-edit-bonus]');if(editBonus){bonusModal(editBonus.dataset.editBonus);return;}
      const delBonus=e.target.closest('[data-delete-bonus]');if(delBonus){const id=delBonus.dataset.deleteBonus;confirmDelete('حذف پاداش','این پاداش از جمع دریافتی و حقوق خالص حذف می‌شود؛ سابقه برای همگام‌سازی حفظ خواهد شد.',()=>{const b=data.bonuses.find(x=>x.id===id);if(b){b.deletedAt=nowISO();b.updatedAt=b.deletedAt;saveData();renderAll();toast('پاداش حذف شد.');}});return;}
      const calBtn=e.target.closest('[data-calendar]');if(calBtn){showCalendar(calBtn.dataset.calendar,calBtn.nextElementSibling);return;}
      if(e.target.closest('#attendanceDateOpen')){showCalendar('attendanceDate',$('#attendanceCalendar'));return;}
      if(e.target.closest('#advanceDateOpen')){showCalendar('advanceDate',$('#advanceCalendar'),true);return;}
      if(e.target.closest('#addEmployee')||e.target.closest('#emptyAddEmployee')){employeeModal();return;}
      if(e.target.closest('#applyPlanBtn')){applyPlanToAttendance();return;}
      if(e.target.closest('#addGroup')||e.target.closest('#emptyAddGroup')){groupModal();return;}
      if(e.target.closest('[data-quick-advance]')){if(!liveEmployees().length){toast('برای ثبت مساعده ابتدا یک کارمند بسازید.','error');setPage('employees');return;}setPage('payroll');advanceModal();return;}
      if(e.target.closest('#addAdvance')){if(!liveEmployees().length){toast('برای ثبت مساعده ابتدا یک کارمند بسازید.','error');setPage('employees');return;}advanceModal();return;}
      if(e.target.closest('#addBonus')||e.target.closest('[data-quick-bonus]')){if(!liveEmployees().length){toast('برای ثبت پاداش ابتدا یک کارمند بسازید.','error');setPage('employees');return;}bonusModal();return;}
      if(e.target.closest('#bonusDateOpen')){showCalendar('bonusDate',$('#bonusCalendar'),true);return;}
      const theme=e.target.closest('#themeSegment [data-theme]');if(theme){settings.theme=theme.dataset.theme;settings.themeChosen=true;saveSettings();return;}
      const accent=e.target.closest('.swatches [data-accent]');if(accent){settings.accent=accent.dataset.accent;saveSettings();return;}
    });
    document.addEventListener('change',e=>{
      if(e.target.matches('[data-att-preset-apply]')){applyAttendancePreset(e.target.dataset.attPresetApply,e.target.checked);return;}
      if(e.target.matches('.att-check')){const tr=e.target.closest('tr'),employeeId=tr.dataset.attEmp,date=$('#attendanceDate').dataset.iso||todayISO(),key=`${date}|${employeeId}`;tr.classList.toggle('present-row',e.target.checked);if(e.target.checked){attExpanded.add(key);tr.classList.add('expanded');const toggle=tr.querySelector('.att-toggle');if(toggle){toggle.textContent='▴';toggle.setAttribute('aria-expanded','true');}}tr.querySelector('.att-amount').disabled=!e.target.checked;tr.querySelector('.att-note').disabled=!e.target.checked;tr.querySelector('.att-advance').disabled=!e.target.checked;const gs=tr.querySelector('.att-group');if(gs){gs.disabled=!e.target.checked;if(e.target.checked&&!gs.value)gs.value=(liveGroupOf(settings.lastAttGroup)?settings.lastAttGroup:'');}const draft=attendanceDrafts.get(key)||{};draft.selected=e.target.checked;draft.groupId=gs?.value||'';draft.payAmount=numeric(tr.querySelector('.att-amount')?.value);draft.advanceAmount=numeric(tr.querySelector('.att-advance')?.value);draft.note=tr.querySelector('.att-note')?.value||'';attendanceDrafts.set(key,draft);updateAttendanceTotal();}
      if(e.target.matches('.att-amount,.att-advance,.att-note,.att-group')){const tr=e.target.closest('tr[data-att-emp]');if(tr){const key=`${$('#attendanceDate').dataset.iso||todayISO()}|${tr.dataset.attEmp}`,d=attendanceDrafts.get(key)||{};Object.assign(d,{selected:!!tr.querySelector('.att-check')?.checked,groupId:tr.querySelector('.att-group')?.value||'',payAmount:numeric(tr.querySelector('.att-amount')?.value),advanceAmount:numeric(tr.querySelector('.att-advance')?.value),note:tr.querySelector('.att-note')?.value||''});attendanceDrafts.set(key,d);}}
      if(e.target.matches('.att-amount'))updateAttendanceTotal();
      if(e.target.matches('.att-group')){settings.lastAttGroup=e.target.value;localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}
      if(e.target.matches('#attendanceSearch'))renderAttendance();
      if(e.target.matches('#plApplyGroup'))planner.applyGroup=e.target.value;
      if(e.target.matches('#employeeSearch,#employeeStatusFilter'))renderEmployees();
      if(e.target.matches('#appFontSetting')){settings.appFont=e.target.value;saveSettings();return;}
      if(e.target.matches('#exportFontSetting')){settings.exportFont=e.target.value;saveSettings();toast('فونت فایل‌های خروجی تغییر کرد.');return;}
      if(e.target.matches('#currencySetting')){settings.currency=e.target.value;saveSettings();renderAll();}
      if(e.target.matches('#importBackupFile'))importBackup(e.target.files?.[0]);
    });
    document.addEventListener('input',e=>{if(e.target.matches('[data-money]'))formatMoneyField(e.target);if(e.target.matches('.att-amount'))updateAttendanceTotal();if(e.target.matches('#employeeSearch'))renderEmployees();if(e.target.matches('#attendanceSearch'))renderAttendance();});
    document.addEventListener('submit',e=>{const f=e.target;if(f.id==='employeeForm'){e.preventDefault();gateEdit(f,()=>submitEmployee(f),'کارمند');}if(f.id==='groupForm'){e.preventDefault();gateEdit(f,()=>submitGroup(f),'مجموعه');}if(f.id==='advanceForm'){e.preventDefault();gateEdit(f,()=>submitAdvance(f),'مساعده');}if(f.id==='bonusForm'){e.preventDefault();gateEdit(f,()=>submitBonus(f),'پاداش');}if(f.id==='paymentForm'){e.preventDefault();gateEdit(f,()=>submitPayment(f),'پرداخت');}if(f.id==='attEditForm'){e.preventDefault();gateEdit(f,()=>submitAttendanceEdit(f),'حضور');}if(f.id==='presetForm'){e.preventDefault();submitPreset(f);}if(f.matches('[data-preset-inline-form]')){e.preventDefault();submitQuickPreset(f);}});
    $('#saveAttendance').addEventListener('click',saveAttendance);
    $('#attendanceDate').addEventListener('click',()=>showCalendar('attendanceDate',$('#attendanceCalendar')));
    $('#applyPayroll').addEventListener('click',()=>{renderPayroll();toast('محاسبه حقوق برای بازه انتخاب‌شده به‌روزرسانی شد.');});
    $('#quickLast10').addEventListener('click',()=>{const s=parseISO(todayISO());s.setDate(s.getDate()-9);$('#payrollFrom').dataset.iso=toISODate(s);$('#payrollTo').dataset.iso=todayISO();$('#payrollFrom').value=jalaliDate($('#payrollFrom').dataset.iso);$('#payrollTo').value=jalaliDate($('#payrollTo').dataset.iso);renderPayroll();});
    $('#quickCurrentMonth').addEventListener('click',()=>{const p=jalaliTodayParts();$('#payrollFrom').dataset.iso=isoFromJalali(p.year,p.month,1);$('#payrollTo').dataset.iso=todayISO();$('#payrollFrom').value=jalaliDate($('#payrollFrom').dataset.iso);$('#payrollTo').value=jalaliDate($('#payrollTo').dataset.iso);renderPayroll();});
    $('#exportPayrollCsv').addEventListener('click',exportPayrollCsv);$('#exportBackup').addEventListener('click',exportBackup);$('#backupBtn').addEventListener('click',exportBackup);
    $('#testGitHub').addEventListener('click',async()=>{saveGitHubFields();await testGitHub();});$('#syncNow').addEventListener('click',async()=>{saveGitHubFields();await syncNow();});
    $('#toggleToken').addEventListener('click',()=>{const i=$('#ghToken');i.type=i.type==='password'?'text':'password';$('#toggleToken').textContent=i.type==='password'?'نمایش':'پنهان';});
    $('#clearToken').addEventListener('click',()=>{if(confirm('توکن فقط از این دستگاه پاک شود؟')){settings.ghToken='';settings.syncState='local';saveSettings();renderSettings();toast('توکن از این دستگاه پاک شد.');}});
    $('#resetData').addEventListener('click',()=>{if(!gateOk()){gatePin(()=>$('#resetData').click());return;}if(confirm('همه مجموعه‌ها، کارکنان، پریست‌ها، حضورها، مساعده‌ها و پاداش‌ها حذف شوند؟ اگر GitHub Sync فعال است، حذف‌ها در همگام‌سازی بعدی نیز منتقل می‌شوند. ابتدا از اطلاعات پشتیبان بگیرید.')){const stamp=nowISO();takeSnapshot('پیش از پاک‌کردن همه','safety');syncCollections.forEach(k=>data[k].forEach(item=>{if(!item.deletedAt){item.deletedAt=stamp;item.updatedAt=stamp;}}));data.meta={...(data.meta||{}),updatedAt:stamp};saveData();renderAll();toast('اطلاعات حذف شدند؛ در سینک بعدی حذف‌ها منتقل می‌شوند.');}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')handleBack();});
    document.addEventListener('focusin',e=>{if(IS_PHONE_LAYOUT()&&e.target.matches('input,select,textarea')){setTimeout(()=>{try{e.target.scrollIntoView({block:'center',behavior:'smooth'});}catch(_){}},320);}});
    document.addEventListener('click',e=>{if(layerOpen('calendar')&&!e.target.closest('.calendar-pop')&&!e.target.closest('.date-input-wrap')){e.stopPropagation();e.preventDefault();closeLayer('calendar');}},true);
  }
  function submitEmployee(form,{openBonus=false}={}){const fd=new FormData(form),id=form.dataset.id,name=String(fd.get('name')||'').trim();if(!name){toast('نام کارمند را وارد کنید.','error');return;}const e=id?getEmployee(id):{id:makeId('emp'),createdAt:nowISO()};Object.assign(e,{name,role:String(fd.get('role')||'').trim(),phone:String(fd.get('phone')||'').trim(),wagePeriod:String(fd.get('wagePeriod')||'daily'),wageAmount:Math.max(0,numeric(fd.get('wageAmount'))),nightRateOverride:Math.max(0,numeric(fd.get('nightRateOverride'))),active:fd.get('active')!=='false',note:String(fd.get('note')||'').trim(),updatedAt:nowISO(),deletedAt:null});if(!id)data.employees.push(e);saveData();closeModal();renderAll();toast(id?'تغییرات کارمند ذخیره شد.':'پروفایل کارمند ساخته شد.');if(openBonus)bonusModal('',e.id);}
  function submitGroup(form){const fd=new FormData(form),id=form.dataset.id,name=String(fd.get('name')||'').trim();if(!name){toast('نام مجموعه را وارد کنید.','error');return;}const duplicate=liveGroups().some(g=>g.name.toLocaleLowerCase('fa')===name.toLocaleLowerCase('fa')&&g.id!==id);if(duplicate){toast('مجموعه‌ای با این نام از قبل وجود دارد.','error');return;}const g=id?getGroup(id):{id:makeId('grp'),createdAt:nowISO()};Object.assign(g,{name,description:String(fd.get('description')||'').trim(),updatedAt:nowISO(),deletedAt:null});if(!id)data.groups.push(g);saveData();closeModal();renderAll();toast(id?'مجموعه ویرایش شد.':'مجموعه اضافه شد.');}
  function submitAdvance(form){if(!form.dataset.id&&submitBatch(form,'advance'))return;const fd=new FormData(form),id=form.dataset.id,employeeId=String(fd.get('employeeId')||''),date=String(fd.get('date')||todayISO()),amount=numeric(fd.get('amount'));if(!employeeId||amount<=0){toast('کارمند و مبلغ معتبر را وارد کنید.','error');return;}const a=id?data.advances.find(x=>x.id===id):{id:makeId('adv'),createdAt:nowISO()};Object.assign(a,{employeeId,date,amount,note:String(fd.get('note')||'').trim(),deductFromPayroll:fd.get('deductFromPayroll')!=='false',updatedAt:nowISO(),deletedAt:null});if(!id)data.advances.push(a);saveData();closeModal();renderAll();toast(id?'مساعده ویرایش شد.':'مساعده ثبت شد.');}

  let currentCalendar={inputId:null,monthYear:null,month:null,modal:false};
  function showCalendar(inputId,container,modal=false){if(!container){container=inputId==='attendanceDate'?$('#attendanceCalendar'):$(`#calendar-${inputId}`);}if(!container)return;const formId=inputId==='advanceDate'?'advanceForm':inputId==='bonusDate'?'bonusForm':inputId==='paymentDate'?'paymentForm':null,input=formId?$(`#${inputId}`):$('#'+inputId),iso=formId?$(`#${formId} input[name="date"]`)?.value:input?.dataset.iso;const p=jpISO(iso||todayISO());currentCalendar={inputId,container,year:p.year,month:p.month,modal};renderCalendar();$$('.calendar-pop.open').forEach(c=>{if(c!==container)c.classList.remove('open');});container.classList.add('open');openLayer('calendar',()=>$$('.calendar-pop.open').forEach(c=>c.classList.remove('open')));}
  function renderCalendar(){const {inputId,container,year,month}=currentCalendar;if(!container)return;const monthNames=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];const days=jalaliMonthDays(year,month),first=days[0],offset=first?.weekday||0,formId=inputId==='advanceDate'?'advanceForm':inputId==='bonusDate'?'bonusForm':inputId==='paymentDate'?'paymentForm':null,selectedIso=formId?$(`#${formId} input[name="date"]`)?.value:(inputId==='attendanceDate'?$('#attendanceDate').dataset.iso:$('#'+inputId)?.dataset.iso),today=todayISO();let cells='';for(let i=0;i<offset;i++)cells+='<span class="calendar-day blank"></span>';for(const d of days){cells+=`<button type="button" class="calendar-day ${d.iso===selectedIso?'chosen':''} ${d.iso===today?'today':''}" data-calendar-day="${d.iso}">${toFa(d.day)}</button>`;}container.innerHTML=`<div class="calendar-head"><button class="calendar-nav" type="button" data-month-step="-1">‹</button><strong>${monthNames[month-1]} ${toFa(year)}</strong><button class="calendar-nav" type="button" data-month-step="1">›</button></div><div class="calendar-grid"><span class="calendar-weekday">ش</span><span class="calendar-weekday">ی</span><span class="calendar-weekday">د</span><span class="calendar-weekday">س</span><span class="calendar-weekday">چ</span><span class="calendar-weekday">پ</span><span class="calendar-weekday">ج</span>${cells}</div>`;
    container.querySelectorAll('[data-month-step]').forEach(b=>b.addEventListener('click',()=>{let m=currentCalendar.month+Number(b.dataset.monthStep),y=currentCalendar.year;if(m<1){m=12;y--}if(m>12){m=1;y++}currentCalendar.month=m;currentCalendar.year=y;renderCalendar();}));
    container.querySelectorAll('[data-calendar-day]').forEach(b=>b.addEventListener('click',()=>{const chosen=b.dataset.calendarDay,formId=inputId==='advanceDate'?'advanceForm':inputId==='bonusDate'?'bonusForm':inputId==='paymentDate'?'paymentForm':null;if(formId){$(`#${formId} input[name="date"]`).value=chosen;$('#'+inputId).value=jalaliDate(chosen);}else{const input=$('#'+inputId);input.dataset.iso=chosen;input.value=jalaliDate(chosen);if(inputId==='attendanceDate'){renderAttendance();}else if(inputId==='payrollFrom'||inputId==='payrollTo'){renderPayroll();}else if(inputId==='rptFrom'||inputId==='rptTo'){renderReportLog();}else if(inputId==='plannerExportFrom'||inputId==='plannerExportTo'){refreshPlannerExportPreview();}}closeLayer('calendar');}));
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
    const actualByDate=new Map();attList().forEach(a=>{if(!actualByDate.has(a.date))actualByDate.set(a.date,[]);actualByDate.get(a.date).push(a);});
    const rangeBtn=(v,l)=>`<button type="button" data-pl-range="${v}" class="${planner.range===v?'active':''}">${l}</button>`;
    const modeBtn=(v,l)=>`<button type="button" data-pl-mode="${v}" class="${planner.mode===v?'active':''}">${l}</button>`;
    let html=`<div class="pl-toolbar"><div class="pl-month"><button type="button" class="calendar-nav" data-pl-month="-1" aria-label="ماه قبل">›</button><strong>${MONTHS[planner.month-1]} ${toFa(planner.year)}</strong><button type="button" class="calendar-nav" data-pl-month="1" aria-label="ماه بعد">‹</button><button type="button" class="btn btn-quiet btn-small" data-pl-today>این ماه</button></div><div class="segmented pl-seg">${rangeBtn('all','کل ماه')}${rangeBtn('1','۱ تا ۱۰')}${rangeBtn('2','۱۱ تا ۲۰')}${rangeBtn('3','۲۱ تا آخر')}</div><div class="segmented pl-seg">${modeBtn('emp','برنامهٔ نیروها')}${modeBtn('grp','مراسم مجموعه‌ها')}</div><div class="pl-export-actions"><button type="button" class="btn btn-primary btn-small" data-pl-export>خروجی جدولی برنامه</button></div></div>`;
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
    const rows=days.map(d=>{ const evs=ev.get(d.iso)||[], pls=plannedOn(d.iso), actual=actualByDate.get(d.iso)||[]; if(!evs.length&&!pls.length&&!actual.length)return ''; const people=pls.sort((a,b)=>(getEmployee(a.employeeId)?.name||'').localeCompare(getEmployee(b.employeeId)?.name||'','fa')).map(p=>chip(`${getEmployee(p.employeeId).name}${liveGroupOf(p.groupId)?` · ${liveGroupOf(p.groupId).name}`:''}`,p.groupId)).join(''); return `<div class="pl-row"><div class="pl-row-day"><b>${dayLabel(d)}</b><small>${pls.length?`${fa(pls.length)} نیرو برنامه‌ریزی‌شده`:'بدون برنامهٔ نیرو'}${actual.length?` · ${fa(actual.length)} حضور ثبت‌شده`:''}</small></div><div class="pl-row-body">${evs.length?`<div class="pl-row-ev">${evs.map(x=>`<span class="pl-chip ev" style="--gc:${groupColor(x.groupId)}">★ مراسم ${esc(liveGroupOf(x.groupId).name)}</span>`).join('')}</div>`:''}<div class="pl-row-people">${people||'<span class="muted">—</span>'}</div>${actual.length?`<div class="pl-row-attendance"><span>✓ ${fa(actual.length)} حضور واقعی ثبت شده</span><button type="button" class="btn btn-outline btn-small" data-pl-attendance="${d.iso}">مدیریت حقوق و حضورها ←</button></div>`:''}</div></div>`; }).join('');
    html+=`<div class="pl-summary"><div class="panel-head"><div><h3>خلاصهٔ برنامه</h3><p class="muted">روزهایی از بازهٔ انتخاب‌شده که نیرو یا مراسم دارند</p></div></div>${rows||'<div class="empty-inline">برای این بازه هنوز برنامه‌ای ثبت نشده است.</div>'}</div>`;
    root.innerHTML=html;
  }
  /* ---------- خروجی برنامهٔ مراسم مجموعه‌ها و نیروها (v1.5.12) ----------
     سه قالب: جدول روزبه‌روز / ماتریس مجموعه‌ها (هر مجموعه یک ستون رنگی) / تقویم ماهانه.
     انتخاب بازه، همهٔ مجموعه‌ها یا چند مجموعهٔ مشخص، و اینکه نیروها و حضور واقعی هم بیاید یا نه.
     فرمت‌ها: PNG، JPG، PDF، Excel، CSV، JSON، کپی متن و چاپ. تصویر و PDF روی Canvas ساخته می‌شوند تا فونت فارسی همه‌جا درست باشد. */
  const PX_DEF_INC={events:true,workers:false,actual:false,weekday:true,onlyActive:false,totals:true};
  const PX={scope:'all',sel:new Set(),layout:'table',preset:'month',from:'',to:'',year:0,month:0,busy:false,
    inc:Object.assign({},PX_DEF_INC,(settings.plannerExportOpts&&settings.plannerExportOpts.inc)||{})};
  if(settings.plannerExportOpts&&settings.plannerExportOpts.layout)PX.layout=settings.plannerExportOpts.layout;
  const PX_PRESETS=[['month','کل ماه'],['d1','۱ تا ۱۰'],['d2','۱۱ تا ۲۰'],['d3','۲۱ تا آخر'],['custom','بازهٔ دلخواه']];
  const PX_LAYOUTS=[['table','جدول روزبه‌روز'],['matrix','ماتریس مجموعه‌ها'],['calendar','تقویم ماهانه']];
  const PX_LAYOUT_NOTE={
    table:'هر روز یک ردیف؛ ستون‌ها بر اساس «اطلاعات داخل خروجی» ساخته می‌شود.',
    matrix:'هر مجموعه یک ستون رنگی دارد و روز مراسم با ★ مشخص می‌شود؛ جمع روزهای هر مجموعه پایین جدول می‌آید.',
    calendar:'تقویم ماهانه مثل صفحهٔ برنامه‌ریزی؛ هر ماه یک صفحهٔ افقی. فایل Excel / CSV / JSON همیشه به شکل جدول روزبه‌روز است.'
  };
  const pxJoinFa=a=>a.length<3?a.join(' و '):`${a.slice(0,-1).join('، ')} و ${a[a.length-1]}`;
  const pxHue=id=>{const i=Math.max(0,liveGroups().findIndex(g=>g.id===id));return (i*83+255)%360;};
  const pxCol=(id,l=42,a)=>a==null?`hsl(${pxHue(id)},62%,${l}%)`:`hsla(${pxHue(id)},62%,${l}%,${a})`;
  const pxNameSort=(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'fa');

  /* ----- بازه ----- */
  function pxRange(){
    let from,to;
    if(PX.preset==='custom'){
      from=$('#plannerExportFrom')?.dataset.iso||PX.from;to=$('#plannerExportTo')?.dataset.iso||PX.to;PX.from=from;PX.to=to;
      if(!from||!to)return {from,to,error:'تاریخ شروع و پایان را انتخاب کنید.'};
      if(from>to)return {from,to,error:'تاریخ شروع نباید بعد از تاریخ پایان باشد.'};
    }else{
      const all=jalaliMonthDays(PX.year,PX.month);if(!all.length)return {from:'',to:'',error:'ماه معتبر نیست.'};
      const pick=PX.preset==='d1'?all.filter(d=>d.day<=10):PX.preset==='d2'?all.filter(d=>d.day>10&&d.day<=20):PX.preset==='d3'?all.filter(d=>d.day>20):all;
      from=pick[0].iso;to=pick[pick.length-1].iso;PX.from=from;PX.to=to;
    }
    const n=sxDays(from,to).length;
    if(n>366)return {from,to,error:'هر خروجی حداکثر ۳۶۶ روز را پشتیبانی می‌کند؛ بازه را کوتاه‌تر کنید.'};
    return {from,to,days:n,error:''};
  }
  const pxGroupsSel=()=>PX.scope==='all'?liveGroups().slice():liveGroups().filter(g=>PX.sel.has(g.id));

  /* ----- مدل داده: همهٔ فرمت‌ها از همین ساخته می‌شوند ----- */
  function pxBuild(){
    const rg=pxRange();if(rg.error)return {error:rg.error};
    const inc=PX.inc,L=PX.layout,ev=L!=='table'||inc.events;
    if(!ev&&!inc.workers&&!inc.actual)return {error:'حداقل یکی از موارد «مراسم»، «نیروها» یا «حضور واقعی» را انتخاب کنید.'};
    const liveG=liveGroups(),gs=pxGroupsSel();
    if(!gs.length)return {error:liveG.length?'حداقل یک مجموعه را انتخاب کنید.':'ابتدا از بخش مجموعه‌ها یک مجموعه بسازید.'};
    const gids=new Set(gs.map(g=>g.id)),all=PX.scope==='all',multi=gs.length!==1;
    const order=new Map(liveG.map((g,i)=>[g.id,i]));
    const evBy=new Map();
    data.events.forEach(x=>{if(!live(x)||x.date<rg.from||x.date>rg.to||!gids.has(x.groupId)||!liveGroupOf(x.groupId))return;if(!evBy.has(x.date))evBy.set(x.date,new Set());evBy.get(x.date).add(x.groupId);});
    const plBy=new Map();
    data.plans.forEach(p=>{if(!live(p)||p.date<rg.from||p.date>rg.to)return;const e=getEmployee(p.employeeId);if(!e||!live(e))return;const g=liveGroupOf(p.groupId);if(!all&&!(g&&gids.has(g.id)))return;
      if(!plBy.has(p.date))plBy.set(p.date,[]);plBy.get(p.date).push({name:e.name||'کارمند',gid:g?.id||'',label:`${e.name||'کارمند'}${g&&multi?` (${g.name})`:''}`});});
    const acBy=new Map();
    attList().forEach(a=>{if(a.date<rg.from||a.date>rg.to)return;const g=liveGroupOf(a.groupId);if(!all&&!(g&&gids.has(g.id)))return;const e=getEmployee(a.employeeId);
      if(!acBy.has(a.date))acBy.set(a.date,[]);acBy.get(a.date).push({name:e?.name||'کارمند',gid:g?.id||'',label:`${e?.name||'کارمند'}${g&&multi?` (${g.name})`:''}`});});
    let rows=sxDays(rg.from,rg.to).map(iso=>({iso,date:jalaliShort(iso),weekday:WEEKDAYS[(parseISO(iso).getDay()+1)%7],jp:jpISO(iso),
      evGroups:[...(evBy.get(iso)||[])].sort((a,b)=>(order.get(a)??0)-(order.get(b)??0)),
      workers:(plBy.get(iso)||[]).sort(pxNameSort),actual:(acBy.get(iso)||[]).sort(pxNameSort)}));
    const stats={days:rows.length,ceremonyDays:rows.filter(r=>r.evGroups.length).length,workers:rows.reduce((a,r)=>a+r.workers.length,0),actual:rows.reduce((a,r)=>a+r.actual.length,0),perGroup:new Map(gs.map(g=>[g.id,rows.filter(r=>r.evGroups.includes(g.id)).length]))};
    if(L!=='calendar'&&inc.onlyActive)rows=rows.filter(r=>(ev&&r.evGroups.length)||(inc.workers&&r.workers.length)||(inc.actual&&r.actual.length));
    const parts=[];if(ev)parts.push('مراسم مجموعه‌ها');if(inc.workers)parts.push('نیروها');if(inc.actual)parts.push('حضور واقعی');
    const scopeLabel=all?'همهٔ مجموعه‌ها':gs.length===1?`مجموعه: ${gs[0].name}`:`مجموعه‌ها: ${gs.map(g=>g.name).join('، ')}`;
    const M={from:rg.from,to:rg.to,rows,gs,all,stats,ev,scopeLabel,title:`برنامهٔ ${pxJoinFa(parts)}`,
      subtitle:`${rg.from===rg.to?jalaliDate(rg.from):`${jalaliDate(rg.from)} تا ${jalaliDate(rg.to)}`}  |  ${scopeLabel}`};
    M.cols=pxCols(M);
    return M;
  }
  function pxCols(M){
    const inc=PX.inc,L=PX.layout,cols=[];
    cols.push({label:'تاریخ',w:1.3,align:'center',bold:true,get:r=>[{t:r.date}]});
    if(inc.weekday)cols.push({label:'روز',w:1.05,align:'center',get:r=>[{t:r.weekday}]});
    if(L==='matrix')M.gs.forEach(g=>cols.push({kind:'mark',gid:g.id,label:g.name,w:1.15,has:r=>r.evGroups.includes(g.id)}));
    else if(M.ev)cols.push({label:'مراسم / باغ‌ها',w:2.4,align:'right',get:r=>r.evGroups.map(gid=>({t:liveGroupOf(gid)?.name||'',gid}))});
    if(inc.workers)cols.push({label:'نیروهای برنامه‌ریزی‌شده',w:3,align:'right',get:r=>r.workers.map(w=>({t:w.label,gid:w.gid}))});
    if(inc.actual)cols.push({label:'حضور واقعی ثبت‌شده',w:3,align:'right',get:r=>r.actual.map(a=>({t:a.label,gid:a.gid}))});
    return cols;
  }
  function pxSummaryLines(M){
    const inc=PX.inc,s=M.stats,out=[];
    const a=[];if(M.ev)a.push(`روزهای دارای مراسم: ${fa(s.ceremonyDays)} از ${fa(s.days)} روز`);if(inc.workers)a.push(`نیروهای برنامه‌ریزی‌شده: ${fa(s.workers)} مورد`);if(inc.actual)a.push(`حضور ثبت‌شده: ${fa(s.actual)} مورد`);
    out.push(a.join('   |   '));
    if(M.ev&&M.gs.length>1&&PX.layout==='table')out.push(M.gs.map(g=>`${g.name}: ${fa(s.perGroup.get(g.id)||0)} روز`).join('   |   '));
    return out;
  }

  /* ----- داده‌ای (Excel / CSV / JSON / متن) ----- */
  function pxFlat(M){
    const inc=PX.inc,matrix=PX.layout==='matrix',head=['تاریخ ایزو','تاریخ شمسی'];
    if(inc.weekday)head.push('روز هفته');
    if(matrix)M.gs.forEach(g=>head.push(g.name));else if(M.ev)head.push('مراسم / باغ‌ها');
    if(inc.workers)head.push('نیروهای برنامه‌ریزی‌شده');if(inc.actual)head.push('حضور واقعی ثبت‌شده');
    const rows=M.rows.map(r=>{const o=[r.iso,r.date];if(inc.weekday)o.push(r.weekday);
      if(matrix)M.gs.forEach(g=>o.push(r.evGroups.includes(g.id)?'✓':''));else if(M.ev)o.push(r.evGroups.map(gid=>liveGroupOf(gid)?.name).filter(Boolean).join('، '));
      if(inc.workers)o.push(r.workers.map(w=>w.label).join('، '));if(inc.actual)o.push(r.actual.map(x=>x.label).join('، '));return o;});
    const out=[head,...rows];
    if(matrix&&inc.totals){const f=['جمع روزهای مراسم',''];if(inc.weekday)f.push('');M.gs.forEach(g=>f.push(String(M.stats.perGroup.get(g.id)||0)));if(inc.workers)f.push('');if(inc.actual)f.push('');out.push(f);}
    return out;
  }
  const pxCsvBlob=M=>{const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;return new Blob(['\ufeff'+pxFlat(M).map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});};
  function pxXlsx(M){
    const matrix=pxFlat(M),colLetter=n=>{let o='';for(n++;n>0;n=Math.floor((n-1)/26))o=String.fromCharCode(65+(n-1)%26)+o;return o;};
    const sheetRows=matrix.map((row,ri)=>`<row r="${ri+1}">${row.map((v,ci)=>`<c r="${colLetter(ci)}${ri+1}" t="inlineStr" s="${ri===0?1:0}"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`).join('')}</row>`).join('');
    const widths=matrix[0].map((_,ci)=>Math.max(11,Math.min(52,Math.round(matrix.reduce((m,r)=>Math.max(m,String(r[ci]??'').length),0)*1.25+3))));
    const cols=`<cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
    const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/>${cols}<sheetData>${sheetRows}</sheetData><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
    const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE1E8F4"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left style="thin"><color rgb="FFB8C0CC"/></left><right style="thin"><color rgb="FFB8C0CC"/></right><top style="thin"><color rgb="FFB8C0CC"/></top><bottom style="thin"><color rgb="FFB8C0CC"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    return zipStore([
      {name:'[Content_Types].xml',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
      {name:'_rels/.rels',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="برنامه" sheetId="1" r:id="rId1"/></sheets></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
      {name:'xl/styles.xml',text:styles},{name:'xl/worksheets/sheet1.xml',text:sheet}
    ]);
  }
  function pxJsonBlob(M){
    const inc=PX.inc,payload={app:'AtelierYar',type:'planner-export',exportedAt:nowISO(),from:M.from,to:M.to,layout:PX.layout,
      scope:{all:M.all,groups:M.gs.map(g=>({id:g.id,name:g.name}))},include:{ceremonies:M.ev,workers:!!inc.workers,actual:!!inc.actual},
      totals:{days:M.stats.days,ceremonyDays:M.stats.ceremonyDays,perGroup:M.gs.map(g=>({group:g.name,days:M.stats.perGroup.get(g.id)||0}))},
      records:M.rows.map(r=>({date:r.iso,jalali:r.date,weekday:r.weekday,
        ...(M.ev?{ceremonies:r.evGroups.map(gid=>liveGroupOf(gid)?.name).filter(Boolean)}:{}),
        ...(inc.workers?{workers:r.workers.map(w=>({name:w.name,group:liveGroupOf(w.gid)?.name||''}))}:{}),
        ...(inc.actual?{actual:r.actual.map(a=>({name:a.name,group:liveGroupOf(a.gid)?.name||''}))}:{})}))};
    return new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
  }

  /* ----- رسم روی Canvas ----- */
  function pxCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');if(!g)throw new Error('Canvas در این محیط در دسترس نیست.');g.direction='rtl';g.textBaseline='middle';return [c,g];}
  function pxWrap(g,text,maxW,font){
    g.font=font;const words=String(text??'').split(/\s+/).filter(Boolean),lines=[];let cur='';
    words.forEach(w=>{const t=cur?`${cur} ${w}`:w;if(!cur||g.measureText(t).width<=maxW)cur=t;else{lines.push(cur);cur=w;}});
    if(cur)lines.push(cur);return lines.length?lines:[''];
  }
  function pxRoundRect(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.lineTo(x+w-r,y);g.quadraticCurveTo(x+w,y,x+w,y+r);g.lineTo(x+w,y+h-r);g.quadraticCurveTo(x+w,y+h,x+w-r,y+h);g.lineTo(x+r,y+h);g.quadraticCurveTo(x,y+h,x,y+h-r);g.lineTo(x,y+r);g.quadraticCurveTo(x,y,x+r,y);g.closePath();}
  function pxFit(g,t,cx,cy,maxW,size,weight,color,align='center',x=cx){let s=size;g.font=`${weight} ${s}px ${exportFontStack()}`;while(s>9&&g.measureText(t).width>maxW){s--;g.font=`${weight} ${s}px ${exportFontStack()}`;}g.fillStyle=color;g.textAlign=align;g.fillText(t,x,cy);}
  function pxHeader(g,W,M,title,pi,pn){
    g.fillStyle='#fff';g.fillRect(0,0,W,g.canvas.height);
    g.fillStyle='#6d5dfc';g.fillRect(0,0,W,12);
    pxFit(g,title,W/2,86,W-120,42,'700','#151922');
    pxFit(g,M.subtitle,W/2,138,W-120,25,'400','#4b5565');
    g.strokeStyle='#d7dbe6';g.lineWidth=2;g.beginPath();g.moveTo(48,168);g.lineTo(W-48,168);g.stroke();
  }
  function pxFooter(g,W,H,pi,pn){
    pxFit(g,`تهیه‌شده با آتلیه‌یار  |  ${jalaliDate(todayISO())}`,W/2,H-34,W-300,18,'400','#7a8190');
    if(pn>1)pxFit(g,`صفحه ${fa(pi+1)} از ${fa(pn)}`,98,H-34,150,18,'400','#7a8190');
  }
  function pxTablePages(M,{single=false,maxPages=Infinity}={}){
    const cols=M.cols,landscape=cols.length>6,W=landscape?1754:1240,PH0=landscape?1240:1754,MG=48,TW=W-2*MG,TOP=190,FOOT=72;
    const [,mg]=pxCanvas(10,10),FONT=`400 20px ${exportFontStack()}`,HFONT=`700 19px ${exportFontStack()}`,LH=27,PAD=10,MAXL=6;
    const wsum=cols.reduce((a,c)=>a+c.w,0),widths=cols.map(c=>Math.floor(TW*c.w/wsum)),xs=[];let acc=W-MG;widths.forEach(w=>{acc-=w;xs.push(acc);});
    const hl=cols.map((c,i)=>pxWrap(mg,c.label,widths[i]-2*PAD,HFONT).slice(0,2)),headH=Math.max(58,Math.max(...hl.map(l=>l.length))*26+22);
    const items=M.rows.map(r=>{
      const lines=cols.map((c,i)=>{if(c.kind==='mark')return null;const hasDot=c.get(r).some(it=>it.gid),out=[];
        c.get(r).forEach(it=>pxWrap(mg,it.t,widths[i]-2*PAD-(hasDot?18:0),FONT).forEach((ln,k)=>out.push({t:ln,gid:k===0?it.gid:'',dot:hasDot})));
        if(out.length>MAXL){const extra=out.length-(MAXL-1);out.length=MAXL-1;out.push({t:`… و ${fa(extra)} مورد دیگر`,gid:'',dot:hasDot,muted:true});}return out;});
      return {kind:'row',r,lines,h:Math.max(50,Math.max(...lines.map(l=>l?l.length:1))*LH+2*PAD-2)};
    });
    if(M.rows.length&&PX.inc.totals&&PX.layout==='matrix')items.push({kind:'foot',h:54});
    const sum=PX.inc.totals?pxSummaryLines(M):[];if(sum.length&&M.rows.length)items.push({kind:'sum',lines:sum,h:sum.length*34+26});
    // صفحه‌بندی
    let singleH=TOP+headH+items.reduce((a,b)=>a+b.h,0)+FOOT+20;if(single&&singleH>9000)single=false;
    const pagesItems=[];
    if(single)pagesItems.push(items);
    else{const avail=PH0-TOP-headH-FOOT;let cur=[],used=0;items.forEach(it=>{if(used+it.h>avail&&cur.length){pagesItems.push(cur);cur=[];used=0;}cur.push(it);used+=it.h;});pagesItems.push(cur);}
    const pn=pagesItems.length,pages=[];
    pagesItems.slice(0,maxPages).forEach((list,pi)=>{
      const H=single?Math.max(singleH,600):PH0,[c,g]=pxCanvas(W,H);
      pxHeader(g,W,M,M.title,pi,pn);
      let y=TOP;
      cols.forEach((col,i)=>{g.fillStyle='#e7ebf5';g.strokeStyle='#9aa3b2';g.lineWidth=1.5;g.fillRect(xs[i],y,widths[i],headH);g.strokeRect(xs[i],y,widths[i],headH);
        if(col.kind==='mark'){g.fillStyle=pxCol(col.gid,42,.2);g.fillRect(xs[i],y,widths[i],headH);g.strokeRect(xs[i],y,widths[i],headH);}
        hl[i].forEach((ln,k)=>pxFit(g,ln,xs[i]+widths[i]/2,y+headH/2+(k-(hl[i].length-1)/2)*26,widths[i]-2*PAD+4,19,'700',col.kind==='mark'?pxCol(col.gid,32):'#111827'));
        if(col.kind==='mark'){g.fillStyle=pxCol(col.gid,42);g.fillRect(xs[i],y+headH-6,widths[i],6);}});
      y+=headH;let ri=0;
      list.forEach(it=>{
        if(it.kind==='sum'){g.fillStyle='#f3f4fb';g.strokeStyle='#c4cad3';pxRoundRect(g,MG,y+10,TW,it.h-14,12);g.fill();g.stroke();
          it.lines.forEach((ln,k)=>pxFit(g,ln,W/2,y+10+(it.h-14)/2+(k-(it.lines.length-1)/2)*34,TW-40,22,k?'400':'700',k?'#4b5565':'#151922'));y+=it.h;return;}
        if(it.kind==='foot'){cols.forEach((col,i)=>{g.fillStyle='#eef0f7';g.strokeStyle='#9aa3b2';g.lineWidth=1.5;g.fillRect(xs[i],y,widths[i],it.h);g.strokeRect(xs[i],y,widths[i],it.h);
            if(i===0)pxFit(g,'جمع روز مراسم',xs[i]+widths[i]/2,y+it.h/2,widths[i]-2*PAD,19,'700','#151922');
            if(col.kind==='mark')pxFit(g,fa(M.stats.perGroup.get(col.gid)||0),xs[i]+widths[i]/2,y+it.h/2,widths[i]-2*PAD,24,'700',pxCol(col.gid,34));});y+=it.h;return;}
        const fri=it.r.weekday==='جمعه';
        cols.forEach((col,i)=>{
          g.fillStyle=fri?'#fdf0f0':ri%2?'#f8fafc':'#fff';g.strokeStyle='#c4cad3';g.lineWidth=1;g.fillRect(xs[i],y,widths[i],it.h);g.strokeRect(xs[i],y,widths[i],it.h);
          if(col.kind==='mark'){if(col.has(it.r)){g.fillStyle=pxCol(col.gid,52,.22);g.fillRect(xs[i]+1,y+1,widths[i]-2,it.h-2);pxFit(g,'★',xs[i]+widths[i]/2,y+it.h/2,widths[i]-8,Math.min(34,it.h*.6),'700',pxCol(col.gid,40));}return;}
          const lines=it.lines[i];
          if(!lines.length||(lines.length===1&&!lines[0].t)){pxFit(g,'—',xs[i]+widths[i]/2,y+it.h/2,widths[i]-8,20,'400','#b6bcc8');return;}
          const y0=y+(it.h-lines.length*LH)/2+LH/2;
          lines.forEach((ln,k)=>{const ly=y0+k*LH;
            if(col.align==='right'){const rx=xs[i]+widths[i]-PAD;
              if(ln.gid){g.fillStyle=pxCol(ln.gid,48);g.beginPath();g.arc(rx-6,ly,6,0,Math.PI*2);g.fill();}
              pxFit(g,ln.t,0,ly,widths[i]-2*PAD-(ln.dot?18:0),20,ln.muted?'400':'400',ln.muted?'#7a8190':'#161b22','right',rx-(ln.dot?18:0));}
            else pxFit(g,ln.t,xs[i]+widths[i]/2,ly,widths[i]-2*PAD,20,col.bold?'700':'400',fri&&col.bold?'#b42318':'#161b22');});
        });
        y+=it.h;ri++;
      });
      if(!M.rows.length)pxFit(g,'برای این بازه موردی ثبت نشده است.',W/2,y+60,W-120,24,'400','#7a8190');
      pxFooter(g,W,H,pi,pn);pages.push(c);
    });
    return {pages,count:pn,landscape,single};
  }
  function pxCalendarPages(M,{maxPages=Infinity}={}){
    const inc=PX.inc,W=1754,H=1240,MG=48,keys=[],seen=new Set();
    M.rows.forEach(r=>{const k=r.jp.year*100+r.jp.month;if(!seen.has(k)){seen.add(k);keys.push([r.jp.year,r.jp.month]);}});
    const byIso=new Map(M.rows.map(r=>[r.iso,r])),pages=[],pn=keys.length;
    keys.slice(0,maxPages).forEach(([y,m],pi)=>{
      const days=jalaliMonthDays(y,m),offset=days[0]?.weekday||0,nRows=Math.ceil((offset+days.length)/7);
      const [c,g]=pxCanvas(W,H);pxHeader(g,W,M,`${M.title} — ${MONTHS[m-1]} ${toFa(y)}`,pi,pn);
      const gridTop=190,wdH=46,legendH=96,footH=64,cw=(W-2*MG)/7,ch=Math.floor((H-gridTop-wdH-legendH-footH)/nRows);
      ['ش','ی','د','س','چ','پ','ج'].forEach((w,i)=>{const x=W-MG-(i+1)*cw;g.fillStyle=i===6?'#fbe4e4':'#e7ebf5';g.strokeStyle='#9aa3b2';g.lineWidth=1.5;g.fillRect(x,gridTop,cw,wdH);g.strokeRect(x,gridTop,cw,wdH);pxFit(g,w,x+cw/2,gridTop+wdH/2,cw-10,22,'700',i===6?'#b42318':'#111827');});
      days.forEach((d,i)=>{
        const col=(offset+i)%7,row=Math.floor((offset+i)/7),x=W-MG-(col+1)*cw,yy=gridTop+wdH+row*ch,r=byIso.get(d.iso),inR=!!r,ceremony=inR&&r.evGroups.length;
        g.fillStyle=!inR?'#f1f2f6':ceremony?pxCol(r.evGroups[0],52,.1):'#fff';g.strokeStyle='#c4cad3';g.lineWidth=1;g.fillRect(x,yy,cw,ch);g.strokeRect(x,yy,cw,ch);
        pxFit(g,toFa(d.day),0,yy+22,50,26,'700',!inR?'#b0b6c3':col===6?'#b42318':'#151922','right',x+cw-12);
        if(!inR)return;
        const list=[];r.evGroups.forEach(gid=>list.push({k:'ev',gid,t:liveGroupOf(gid)?.name||''}));
        if(inc.workers)r.workers.forEach(w=>list.push({k:'w',gid:w.gid,t:w.name}));
        if(inc.actual)r.actual.forEach(a=>list.push({k:'a',gid:a.gid,t:`✓ ${a.name}`}));
        let ly=yy+48;const limit=yy+ch-6,hts=list.map(it=>it.k==='ev'?30:22);let shown=list.length;
        if(ly+hts.reduce((q,w)=>q+w,0)>limit){let acc=0;shown=0;while(shown<list.length&&ly+acc+hts[shown]+20<=limit){acc+=hts[shown];shown++;}}
        for(let k=0;k<shown;k++){
          const it=list[k];
          if(it.k==='ev'){g.fillStyle=pxCol(it.gid,42);pxRoundRect(g,x+7,ly,cw-14,25,7);g.fill();pxFit(g,it.t,x+cw/2,ly+13,cw-26,17,'700','#fff');}
          else{if(it.gid){g.fillStyle=pxCol(it.gid,48);g.beginPath();g.arc(x+cw-14,ly+11,5,0,Math.PI*2);g.fill();}
            pxFit(g,it.t,0,ly+11,cw-(it.gid?36:22),16,'400',it.k==='a'?'#1b7a3a':'#2b303a','right',x+cw-(it.gid?25:12));}
          ly+=hts[k];
        }
        if(shown<list.length)pxFit(g,`+${fa(list.length-shown)} مورد دیگر`,0,ly+10,cw-16,15,'700','#7a8190','right',x+cw-10);
      });
      // راهنمای رنگ‌ها
      let lx=W-MG,ly=gridTop+wdH+nRows*ch+34;pxFit(g,'راهنما:',0,ly,90,19,'700','#4b5565','right',lx);lx-=84;
      M.gs.forEach(gg=>{const n=days.filter(d=>byIso.get(d.iso)?.evGroups.includes(gg.id)).length,label=`${gg.name} (${fa(n)} روز)`;g.font=`400 18px ${exportFontStack()}`;const tw=Math.min(300,Math.ceil(g.measureText(label).width));
        if(lx-tw-44<MG){lx=W-MG-84;ly+=34;}
        g.fillStyle=pxCol(gg.id,42);pxRoundRect(g,lx-20,ly-10,20,20,6);g.fill();pxFit(g,label,0,ly,tw,18,'400','#151922','right',lx-28);lx-=tw+56;});
      pxFooter(g,W,H,pi,pn);pages.push(c);
    });
    return {pages,count:pn,landscape:true,single:false};
  }
  const pxPages=(M,o)=>PX.layout==='calendar'?pxCalendarPages(M,o):pxTablePages(M,o);
  function pxPagesToPdf(pages,landscape){
    const enc=new TextEncoder(),parts=[],offs=[];let len=0;const push=b=>{const u=typeof b==='string'?enc.encode(b):b;parts.push(u);len+=u.length;};
    const PW=landscape?842:595,PHh=landscape?595:842,n=pages.length;push('%PDF-1.4\n%âãÏÓ\n');
    const begin=id=>{offs[id]=len;push(`${id} 0 obj\n`);},end=()=>push('\nendobj\n');
    begin(1);push('<< /Type /Catalog /Pages 2 0 R >>');end();
    begin(2);push(`<< /Type /Pages /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] /Count ${n} >>`);end();
    pages.forEach((cv,i)=>{const pid=3+i*3,cid=pid+1,iid=pid+2,bin=atob(cv.toDataURL('image/jpeg',.92).split(',')[1]),jpg=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)jpg[k]=bin.charCodeAt(k);
      const content=`q ${PW} 0 0 ${PHh} 0 0 cm /Im0 Do Q`;
      begin(pid);push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PHh}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);end();
      begin(cid);push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);end();
      begin(iid);push(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);push(jpg);push('\nendstream');end();});
    const total=2+n*3,xref=len;push(`xref\n0 ${total+1}\n0000000000 65535 f \n`);for(let id=1;id<=total;id++)push(`${String(offs[id]).padStart(10,'0')} 00000 n \n`);
    push(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out=new Uint8Array(len);let p=0;parts.forEach(u=>{out.set(u,p);p+=u.length;});return new Blob([out],{type:'application/pdf'});
  }
  const pxToBlob=(cv,mime)=>new Promise((res,rej)=>{if(cv.toBlob)cv.toBlob(b=>b?res(b):rej(new Error('ساخت تصویر ناموفق بود.')),mime,.93);else{try{const bin=atob(cv.toDataURL(mime,.93).split(',')[1]),u=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)u[k]=bin.charCodeAt(k);res(new Blob([u],{type:mime}));}catch(e){rej(e);}}});

  /* ----- تحویل چند فایل: اندروید = یک برگهٔ اشتراک، ویندوز/مرورگر = چند دانلود ----- */
  async function deliverMany(list){
    if(list.length===1)return deliverFile(list[0].name,list[0].blob,list[0].mime);
    if(IS_NATIVE){const FS=nativePlugin('Filesystem'),SH=nativePlugin('Share');
      if(FS&&SH&&typeof FS.writeFile==='function'){
        try{const uris=[];for(const f of list){const w=await FS.writeFile({path:`exports/${f.name}`,data:await blobToB64(f.blob),directory:'CACHE',recursive:true});uris.push(w.uri);}await SH.share({title:list[0].name,files:uris,dialogTitle:'ذخیره یا ارسال فایل‌ها'});return 'shared';}
        catch(err){if(/cancel/i.test(String(err?.message||err)))return 'cancelled';console.warn('AtelierYar share:',err);}
      }}
    for(const f of list){downloadBlob(f.name,f.blob);await new Promise(r=>setTimeout(r,380));}
    return 'downloaded';
  }
  function pxFileBase(M){
    // نام فایل فقط ASCII: برخی مرورگرها/اندروید نام فارسی فایل را نمی‌پذیرند.
    const one=M.gs.length===1?String(M.gs[0].name||'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-+|-+$/g,''):'';
    const slug=M.all?'all-groups':M.gs.length===1?(one||`group-${liveGroups().findIndex(g=>g.id===M.gs[0].id)+1}`):`${M.gs.length}-groups`;
    return `AtelierYar-planner-${slug}-${M.from}_${M.to}${PX.layout==='table'?'':`-${PX.layout}`}`;
  }
  async function pxCopy(M){
    const t=pxFlat(M).map(r=>r.join('\t')).join('\n');
    try{await navigator.clipboard.writeText(t);}catch{const ta=document.createElement('textarea');ta.value=t;ta.style.cssText='position:fixed;opacity:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(_){}ta.remove();}
    toast('جدول برنامه کپی شد؛ می‌توانید آن را در Excel یا پیام‌رسان بچسبانید.');
  }
  function pxPrint(M){
    if(IS_NATIVE){toast('چاپ مستقیم در اندروید نیست؛ PDF ساخته می‌شود، بعد از باز کردن آن «چاپ» را بزنید.','info',4500);return plannerExportRun('pdf');}
    const res=pxPages(M),root=(()=>{let r=$('#planPrintRoot');if(!r){r=document.createElement('div');r.id='planPrintRoot';document.body.appendChild(r);}return r;})();
    let st=$('#sxPageStyle');if(!st){st=document.createElement('style');st.id='sxPageStyle';document.head.appendChild(st);}
    st.textContent=`@page{size:A4 ${res.landscape?'landscape':'portrait'};margin:6mm}`;
    root.innerHTML=res.pages.map(c=>`<img alt="" style="max-height:${res.landscape?'192mm':'279mm'}" src="${c.toDataURL('image/jpeg',.92)}">`).join('');
    document.body.classList.add('planner-printing');
    const done=()=>{document.body.classList.remove('planner-printing');root.innerHTML='';window.removeEventListener('afterprint',done);};
    window.addEventListener('afterprint',done);setTimeout(()=>{try{window.print();}catch(_){done();}},120);
  }
  async function plannerExportRun(kind){
    if(PX.busy)return; await ensureFonts();
    const M=pxBuild();if(M.error){toast(M.error,'error',5000);return;}
    if(!M.rows.length){toast('با این تنظیمات روزی برای خروجی پیدا نشد.','error');return;}
    if(kind==='copy')return pxCopy(M);
    if(kind==='print')return pxPrint(M);
    PX.busy=true;$$('[data-px-export]').forEach(b=>b.disabled=true);
    try{
      try{await document.fonts?.ready;}catch(_){}
      const base=pxFileBase(M);let files;
      if(kind==='xlsx'){const b=pxXlsx(M);files=[{name:`${base}.xlsx`,blob:b,mime:b.type}];}
      else if(kind==='csv')files=[{name:`${base}.csv`,blob:pxCsvBlob(M),mime:'text/csv'}];
      else if(kind==='json')files=[{name:`${base}.json`,blob:pxJsonBlob(M),mime:'application/json'}];
      else if(kind==='pdf'){const r=pxPages(M);files=[{name:`${base}.pdf`,blob:pxPagesToPdf(r.pages,r.landscape),mime:'application/pdf'}];}
      else{const mime=kind==='jpg'?'image/jpeg':'image/png',ext=kind==='jpg'?'jpg':'png',r=pxPages(M,{single:true});
        files=[];for(let i=0;i<r.pages.length;i++)files.push({name:`${base}${r.pages.length>1?`-${i+1}`:''}.${ext}`,blob:await pxToBlob(r.pages[i],mime),mime});}
      const res=await deliverMany(files);
      if(res==='downloaded')toast(files.length>1?`${fa(files.length)} فایل آماده و دانلود شد.`:'فایل آماده شد و دانلود شد.');
    }catch(err){console.error(err);toast(`ساخت خروجی ناموفق بود: ${err.message||err}`,'error',6000);}
    finally{PX.busy=false;$$('[data-px-export]').forEach(b=>b.disabled=false);pxRefresh();}
  }

  /* ----- پنجرهٔ تنظیم خروجی ----- */
  function pxSaveOpts(){settings.plannerExportOpts={layout:PX.layout,inc:{...PX.inc}};try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch(_){}}
  function pxRenderGroups(rg){
    const box=$('#pxGroups');if(!box)return;
    const groups=liveGroups();PX.sel=new Set([...PX.sel].filter(id=>groups.some(g=>g.id===id)));
    box.hidden=PX.scope==='all';
    $('#pxGroupCount').textContent=PX.scope==='all'?`(${fa(groups.length)} مجموعه)`:`(${fa(PX.sel.size)} از ${fa(groups.length)})`;
    $$('#pxScope [data-px-scope]').forEach(b=>b.classList.toggle('active',b.dataset.pxScope===PX.scope));
    $('#pxGroupTools').hidden=PX.scope==='all';
    if(PX.scope==='all')return;
    box.innerHTML=groups.length?groups.map(g=>{const n=rg&&!rg.error?data.events.filter(x=>live(x)&&x.groupId===g.id&&x.date>=rg.from&&x.date<=rg.to).length:0;
      return `<label class="sx-emp"><input type="checkbox" data-px-grp="${esc(g.id)}" ${PX.sel.has(g.id)?'checked':''}><span><b><i class="pl-dot" style="--gc:${groupColor(g.id)};display:inline-block;margin-inline-end:6px"></i>${esc(g.name)}</b><small>${n?`${fa(n)} روز مراسم در این بازه`:'مراسمی در این بازه نیست'}</small></span></label>`;}).join(''):'<div class="empty-inline">ابتدا از بخش مجموعه‌ها یک مجموعه بسازید.</div>';
  }
  function pxRefresh(){
    if(!$('#pxRoot'))return;
    const custom=PX.preset==='custom';
    $$('#pxPresets [data-px-preset]').forEach(b=>b.classList.toggle('active',b.dataset.pxPreset===PX.preset));
    $$('#pxLayouts [data-px-layout]').forEach(b=>b.classList.toggle('active',b.dataset.pxLayout===PX.layout));
    $('#pxLayoutNote').textContent=PX_LAYOUT_NOTE[PX.layout];
    $('#pxMonthBar').hidden=custom;$('#pxCustom').hidden=!custom;$('#pxMonthName').textContent=`${MONTHS[PX.month-1]} ${toFa(PX.year)}`;
    const L=PX.layout;
    ['events','workers','actual','weekday','onlyActive','totals'].forEach(k=>{const el=$(`#pxOpt-${k}`);if(!el)return;el.checked=k==='events'&&L!=='table'?true:!!PX.inc[k];el.disabled=(k==='events'&&L!=='table')||(L==='calendar'&&(k==='weekday'||k==='onlyActive'||k==='totals'));el.closest('.sx-check').style.opacity=el.disabled?.55:1;});
    const rg=pxRange();
    pxRenderGroups(rg);
    const M=rg.error?{error:rg.error}:pxBuild(),err=$('#pxError'),meta=$('#pxMeta'),prev=$('#pxPreview'),btns=$$('[data-px-export]');
    $('#pxRangeLabel').innerHTML=rg.error?'':`${esc(rg.from===rg.to?jalaliDate(rg.from):`${jalaliDate(rg.from)} تا ${jalaliDate(rg.to)}`)} <span class="muted">(${fa(rg.days)} روز)</span>`;
    if(M.error){err.hidden=false;err.textContent=M.error;meta.textContent='';prev.innerHTML='<div class="empty-inline">پیش‌نمایش پس از تکمیل تنظیمات نمایش داده می‌شود.</div>';btns.forEach(b=>b.disabled=true);return;}
    err.hidden=true;
    const s=M.stats,warn=[];
    if(M.ev&&!s.ceremonyDays)warn.push('در این بازه برای مجموعه‌های انتخابی مراسمی تیک نخورده است.');
    if(PX.inc.workers&&!s.workers)warn.push('هیچ نیرویی برای این مجموعه‌ها در این بازه برنامه‌ریزی نشده؛ ستون نیروها خالی می‌ماند.');
    if(PX.inc.actual&&!s.actual)warn.push('حضور واقعی ثبت‌شده‌ای در این بازه نیست.');
    meta.textContent=`${fa(s.days)} روز | ${fa(s.ceremonyDays)} روز مراسم${PX.inc.workers?` | ${fa(s.workers)} نیرو`:''}${PX.inc.actual?` | ${fa(s.actual)} حضور`:''}`;
    if(!M.rows.length){prev.innerHTML='<div class="empty-inline">با این تنظیمات روزی برای خروجی پیدا نشد.</div>';btns.forEach(b=>b.disabled=true);return;}
    try{const r=pxPages(M,{maxPages:1});prev.innerHTML=`<img alt="پیش‌نمایش خروجی" style="width:100%;display:block;background:#fff;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.12)" src="${r.pages[0].toDataURL('image/jpeg',.85)}">${r.count>1?`<p class="subtle-note" style="margin:8px 2px 0;text-align:center">پیش‌نمایش صفحهٔ ۱ از ${fa(r.count)}؛ فایل خروجی همهٔ صفحه‌ها را دارد.</p>`:''}${warn.length?`<p class="subtle-note px-warn" style="margin:8px 2px 0">${warn.map(esc).join(' ')}</p>`:''}`;}
    catch(e){console.error(e);prev.innerHTML=`<div class="empty-inline">پیش‌نمایش ساخته نشد: ${esc(e.message||e)}</div>`;}
    btns.forEach(b=>b.disabled=PX.busy);
  }
  const refreshPlannerExportPreview=pxRefresh;
  function openPlannerExportModal(){
    const t=jalaliTodayParts();PX.year=planner.year||t.year;PX.month=planner.month||t.month;
    PX.preset=({all:'month','1':'d1','2':'d2','3':'d3'})[planner.range]||'month';
    if(!(settings.plannerExportOpts&&settings.plannerExportOpts.inc)){PX.inc={...PX_DEF_INC,workers:planner.mode==='emp'};}
    if(planner.mode==='grp'&&planner.grpId!=='all'&&liveGroupOf(planner.grpId)){PX.scope='sel';PX.sel=new Set([planner.grpId]);}else{PX.scope='all';PX.sel=new Set();}
    const first=pxRange();
    const opt=(k,l)=>`<label class="sx-check"><input type="checkbox" id="pxOpt-${k}"><span>${l}</span></label>`;
    const exp=(k,i,l)=>`<button type="button" class="btn btn-outline sx-exp" data-px-export="${k}"><span class="sx-ico">${i}</span>${l}</button>`;
    const dateField=(id,label,iso)=>`<label class="field"><span>${label}</span><div class="date-input-wrap"><input class="date-text" id="${id}" readonly value="${esc(jalaliDate(iso))}" data-iso="${esc(iso)}"><button type="button" class="date-open" data-calendar="${id}" aria-label="${label}">▦</button><div class="calendar-pop" id="calendar-${id}"></div></div></label>`;
    openModal('خروجی برنامه و تقویم مجموعه‌ها','بازه، مجموعه‌ها، قالب و اطلاعات داخل خروجی را انتخاب کنید؛ پیش‌نمایش همان چیزی است که ذخیره می‌شود.',`<div class="sx" id="pxRoot">
      <div class="sx-block"><div class="sx-label">بازه</div><div class="segmented sx-seg" id="pxPresets">${PX_PRESETS.map(([k,l])=>`<button type="button" data-px-preset="${k}">${l}</button>`).join('')}</div>
        <div class="sx-monthbar" id="pxMonthBar"><button type="button" class="calendar-nav" data-px-month="-1" aria-label="ماه قبل">›</button><strong id="pxMonthName"></strong><button type="button" class="calendar-nav" data-px-month="1" aria-label="ماه بعد">‹</button></div>
        <div class="planner-export-range" id="pxCustom" hidden>${dateField('plannerExportFrom','از تاریخ شمسی',first.from||todayISO())}${dateField('plannerExportTo','تا تاریخ شمسی',first.to||todayISO())}</div>
        <div class="sx-range" id="pxRangeLabel"></div></div>
      <div class="sx-block"><div class="sx-label"><span>مجموعه‌ها <small id="pxGroupCount" class="muted"></small></span><span class="sx-mini" id="pxGroupTools" hidden><button type="button" class="btn btn-quiet btn-small" data-px-gsel="all">همه</button><button type="button" class="btn btn-quiet btn-small" data-px-gsel="none">هیچ‌کدام</button></span></div>
        <div class="segmented sx-seg" id="pxScope"><button type="button" data-px-scope="all">همهٔ مجموعه‌ها</button><button type="button" data-px-scope="sel">فقط مجموعه‌های انتخابی</button></div>
        <div class="sx-emps" id="pxGroups" hidden></div></div>
      <div class="sx-block"><div class="sx-label">قالب خروجی</div><div class="segmented sx-seg" id="pxLayouts">${PX_LAYOUTS.map(([k,l])=>`<button type="button" data-px-layout="${k}">${l}</button>`).join('')}</div><p class="subtle-note" id="pxLayoutNote" style="margin:0"></p></div>
      <div class="sx-block"><div class="sx-label">اطلاعات داخل خروجی</div><div class="sx-opts">${opt('events','مراسم / باغ‌ها')}${opt('workers','نیروهای برنامه‌ریزی‌شده')}${opt('actual','حضور واقعی ثبت‌شده')}${opt('weekday','نام روز هفته')}${opt('onlyActive','فقط روزهای دارای برنامه')}${opt('totals','جمع‌بندی در پایین')}</div></div>
      <div class="sx-block"><div class="sx-label"><span>پیش‌نمایش <small id="pxMeta" class="muted"></small></span></div><div id="pxError" class="planner-export-error" hidden></div><div class="sx-preview" id="pxPreview"></div></div>
      <div class="sx-exports"><div class="sx-grid">${exp('png','▣','عکس PNG')}${exp('jpg','▤','عکس JPG')}${exp('pdf','PDF','فایل PDF')}${exp('xlsx','XLS','اکسل (.xlsx)')}${exp('csv','CSV','فایل CSV')}${exp('json','{ }','فایل JSON')}${exp('copy','❐','کپی جدول')}${exp('print','⎙','چاپ')}</div><p class="subtle-note">${IS_NATIVE?'در اندروید، بعد از ساخت فایل، برگهٔ اشتراک‌گذاری باز می‌شود (ذخیره، تلگرام، واتساپ، چاپ…).':'فایل‌ها در پوشهٔ دانلودها ذخیره می‌شوند؛ «چاپ» پنجرهٔ چاپگر را باز می‌کند.'} PDF و عکس به صورت تصویر ساخته می‌شوند تا فونت فارسی همه‌جا درست دیده شود.</p></div>
    </div>`);
    const modal=$('#modalRoot .modal');if(modal)modal.classList.add('modal-wide');
    pxRefresh();
  }
  document.addEventListener('click',e=>{
    const t=e.target;if(!t.closest||!t.closest('#pxRoot'))return;let el;
    if((el=t.closest('[data-px-preset]'))){const k=el.dataset.pxPreset;if(k==='custom'&&PX.preset!=='custom'){const r=pxRange();const f=$('#plannerExportFrom'),to=$('#plannerExportTo');if(f&&r.from){f.dataset.iso=r.from;f.value=jalaliDate(r.from);}if(to&&r.to){to.dataset.iso=r.to;to.value=jalaliDate(r.to);}}PX.preset=k;pxRefresh();return;}
    if((el=t.closest('[data-px-month]'))){let m=PX.month+Number(el.dataset.pxMonth),y=PX.year;if(m<1){m=12;y--;}if(m>12){m=1;y++;}PX.month=m;PX.year=y;pxRefresh();return;}
    if((el=t.closest('[data-px-scope]'))){PX.scope=el.dataset.pxScope;if(PX.scope==='sel'&&!PX.sel.size){const f=liveGroups()[0];if(f)PX.sel.add(f.id);}pxRefresh();return;}
    if((el=t.closest('[data-px-gsel]'))){if(el.dataset.pxGsel==='all')liveGroups().forEach(g=>PX.sel.add(g.id));else PX.sel.clear();pxRefresh();return;}
    if((el=t.closest('[data-px-layout]'))){PX.layout=el.dataset.pxLayout;pxSaveOpts();pxRefresh();return;}
    if((el=t.closest('[data-px-export]'))){plannerExportRun(el.dataset.pxExport);return;}
  });
  document.addEventListener('change',e=>{
    const t=e.target;if(!t.closest||!t.closest('#pxRoot'))return;
    if(t.matches('[data-px-grp]')){t.checked?PX.sel.add(t.dataset.pxGrp):PX.sel.delete(t.dataset.pxGrp);pxRefresh();return;}
    const m=/^pxOpt-(\w+)$/.exec(t.id||'');if(m){PX.inc[m[1]]=t.checked;pxSaveOpts();pxRefresh();}
  });
  function plannerClick(e){
    const t=e.target; let el;
    if(t.closest('[data-pl-export]')){openPlannerExportModal();return true;}
    if((el=t.closest('[data-pl-attendance]'))){const iso=el.dataset.plAttendance;$('#attendanceDate').dataset.iso=iso;$('#attendanceDate').value=jalaliDate(iso);setPage('attendance');renderAttendance({capture:false});return true;}
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
  function exportBackup(){const blob=new Blob([JSON.stringify(backupObject(),null,2)],{type:'application/json;charset=utf-8'});downloadBlob(`AtelierYar-backup-${todayISO()}.json`,blob);settings.lastBackupExport=nowISO();localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));toast('نسخه پشتیبان آماده شد.');}
  async function importBackup(file){if(!file)return;if(!gateOk()){gatePin(()=>importBackup(file));return;}try{const parsed=JSON.parse(await file.text()),incoming=parsed.data||parsed;if(!incoming||!Array.isArray(incoming.groups)||!Array.isArray(incoming.employees)||!Array.isArray(incoming.attendances)||!Array.isArray(incoming.advances))throw new Error('ساختار فایل معتبر نیست');if(!confirm('اطلاعات فعلی با محتوای فایل پشتیبان جایگزین شود؟ قبل از ادامه می‌توانید از داده فعلی خروجی بگیرید.'))return;takeSnapshot('پیش از بازیابی فایل','safety');data={schemaVersion:1,groups:incoming.groups,employees:incoming.employees,attendances:incoming.attendances,advances:incoming.advances,bonuses:Array.isArray(incoming.bonuses)?incoming.bonuses:[],plans:Array.isArray(incoming.plans)?incoming.plans:[],events:Array.isArray(incoming.events)?incoming.events:[],attendancePresets:Array.isArray(incoming.attendancePresets)?incoming.attendancePresets:[],payments:Array.isArray(incoming.payments)?incoming.payments:[],meta:incoming.meta||{updatedAt:nowISO()}};saveData();renderAll();toast('بازیابی پشتیبان انجام شد.');}catch(err){toast(`فایل پشتیبان خوانده نشد: ${err.message}`,'error',6000);}finally{$('#importBackupFile').value='';}}
  function exportPayrollCsv(){const from=$('#payrollFrom').dataset.iso||todayISO(),to=$('#payrollTo').dataset.iso||todayISO(),c=calcPayroll(from,to);const lines=[['کارمند','تعداد شب','جمع حقوق','پاداش','مساعده','خالص پرداختی','پرداخت‌شده','مانده','محل شب‌ها'],...c.rows.map(r=>[r.employee.name||'کارمند حذف‌شده',r.nights,Math.round(r.gross),Math.round(r.bonus),Math.round(r.advance),Math.round(r.gross+r.bonus-r.advance),Math.round(r.paid),Math.round(r.gross+r.bonus-r.advance-r.paid),groupBreakdown(r.records)])];const csv='\ufeff'+lines.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');downloadBlob(`AtelierYar-payroll-${from}-${to}.csv`,new Blob([csv],{type:'text/csv;charset=utf-8'}));toast('خروجی CSV آماده شد.');}

  function saveGitHubFields(){settings.ghOwner=$('#ghOwner').value.trim();settings.ghRepo=$('#ghRepo').value.trim();settings.ghBranch=$('#ghBranch').value.trim()||'main';settings.ghPath=$('#ghPath').value.trim()||'data/atelier-yar.json';settings.ghToken=$('#ghToken').value.trim();settings.syncState='local';saveSettings();}
  function githubConfigValid(){return settings.ghOwner&&settings.ghRepo&&settings.ghBranch&&settings.ghPath&&settings.ghToken;}
  function ghHeaders(){return {'Accept':'application/vnd.github+json','Authorization':`Bearer ${settings.ghToken}`,'X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};}
  function ghUrl(path=''){return `https://api.github.com/repos/${encodeURIComponent(settings.ghOwner)}/${encodeURIComponent(settings.ghRepo)}/contents/${path?path.split('/').map(encodeURIComponent).join('/'):''}`;}
  async function ghRequest(url, options={}){const r=await fetch(url,{...options,headers:{...ghHeaders(),...(options.headers||{})}});let j={};try{j=await r.json();}catch{}if(!r.ok){const err=new Error(j.message||`GitHub API error ${r.status}`);err.status=r.status;throw err;}return j;}
  async function testGitHub(){if(!githubConfigValid()){toast('نام کاربری، مخزن و توکن را کامل کنید.','error');return;}$('#testGitHub').disabled=true;$('#testGitHub').textContent='در حال بررسی…';try{await ghRequest(`https://api.github.com/repos/${encodeURIComponent(settings.ghOwner)}/${encodeURIComponent(settings.ghRepo)}`);settings.syncState='connected';saveSettings();toast('اتصال GitHub موفق بود. دسترسی مخزن تأیید شد.');}catch(err){settings.syncState='error';saveSettings();toast(`اتصال ناموفق بود: ${friendlyGithubError(err)}`,'error',6500);}finally{$('#testGitHub').disabled=false;$('#testGitHub').textContent='بررسی اتصال';renderSettings();}}
  function friendlyGithubError(err){if(err.status===401)return'توکن معتبر نیست یا منقضی شده است.';if(err.status===403)return'دسترسی Contents یا محدودیت درخواست را بررسی کنید.';if(err.status===404)return'مخزن پیدا نشد؛ Owner، Repo و دسترسی خصوصی را بررسی کنید.';return err.message||'خطای ارتباط با GitHub.';}
  const syncCollections=['groups','employees','attendances','advances','bonuses','plans','events','attendancePresets','payments'];
  function syncPayload(){const o={app:'AtelierYar',schemaVersion:1,updatedAt:nowISO()};syncCollections.forEach(k=>o[k]=data[k]);o.meta=data.meta||{};o.audit=readAudit();return o;}
  function mergeCollections(local,remote){const out={schemaVersion:1,meta:{updatedAt:nowISO()}};syncCollections.forEach(k=>{const map=new Map();[...(remote[k]||[]),...(local[k]||[])].forEach(item=>{const old=map.get(item.id);if(!old){map.set(item.id,item);return;}const ta=Date.parse(old.updatedAt||old.deletedAt||old.createdAt||0)||0,tb=Date.parse(item.updatedAt||item.deletedAt||item.createdAt||0)||0;if(tb>ta||(tb===ta&&item.deletedAt&&!old.deletedAt))map.set(item.id,item);});out[k]=[...map.values()];});out.audit=mergeAudit(local.audit,remote.audit);return out;}
  function utf8ToB64(str){const bytes=new TextEncoder().encode(str);let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);}
  function decodeGitHubContent(content){const binary=atob(String(content||'').replace(/\n/g,''));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new TextDecoder('utf-8').decode(bytes);}
  async function getRemoteFile(){try{const j=await ghRequest(`${ghUrl(settings.ghPath)}?ref=${encodeURIComponent(settings.ghBranch)}`);if(j.type!=='file')throw new Error('مسیر انتخاب‌شده فایل نیست.');let raw=j.content;if(!raw&&j.download_url){const response=await fetch(j.download_url,{headers:ghHeaders(),cache:'no-store'});if(!response.ok)throw new Error(`دانلود فایل داده از GitHub ناموفق بود (${response.status}).`);return {data:JSON.parse(await response.text()),sha:j.sha};}return {data:JSON.parse(decodeGitHubContent(raw)),sha:j.sha};}catch(err){if(err.status===404)return {data:null,sha:null};throw err;}}
  async function putRemoteFile(payload,sha){const body={message:`AtelierYar sync ${new Date().toISOString()}`,content:utf8ToB64(JSON.stringify(payload,null,2)),branch:settings.ghBranch};if(sha)body.sha=sha;return ghRequest(ghUrl(settings.ghPath),{method:'PUT',body:JSON.stringify(body)});}
  async function syncNow({silent=false}={}){if(syncing)return;if(!githubConfigValid()){toast('ابتدا اطلاعات اتصال GitHub را در تنظیمات کامل کنید.','error');return;}syncing=true;clearTimeout(autoSyncTimer);const button=$('#syncNow');if(button){button.disabled=true;button.textContent='در حال همگام‌سازی…';}try{let remote=await getRemoteFile();let merged=mergeCollections(syncPayload(),remote.data||{});try{await putRemoteFile(merged,remote.sha);}catch(err){if(err.status!==409&&err.status!==422)throw err;remote=await getRemoteFile();merged=mergeCollections(merged,remote.data||{});await putRemoteFile(merged,remote.sha);}
      syncCollections.forEach(k=>data[k]=merged[k]);if(Array.isArray(merged.audit))writeAudit(merged.audit);data.meta={...(merged.meta||{}),updatedAt:nowISO()};saveData({triggerSync:false});settings.syncState='connected';settings.lastSync=nowISO();saveSettings();renderAll();if(!silent)toast('همگام‌سازی دوطرفه با GitHub انجام شد.');
    }catch(err){settings.syncState='error';saveSettings();if(!silent)toast(`همگام‌سازی ناموفق بود: ${friendlyGithubError(err)}`,'error',7000);else console.warn('AtelierYar sync:',err.message);}finally{syncing=false;if(button){button.disabled=false;button.innerHTML='همگام‌سازی';}renderSettings();if(pendingSync){pendingSync=false;queueAutoSync();}}}

  /* ---------- خروجی جدول حضور و حقوق: چاپ / عکس / PDF / Excel / CSV / کپی متن ----------
     یک جدول مثل برگهٔ دستی: ردیف = روز، ستون = کارمند، خانه = مبلغ همان شب (یا خط مورب برای غیبت)،
     و در پایین: تعداد شب، جمع حقوق، مساعده و خالص قابل پرداخت هر نفر. بدون هیچ کتابخانهٔ بیرونی. */
  const SX_COLS=8, SX_MAX_DAYS=35;
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
    const bonusBy=new Map(); data.bonuses.forEach(r=>{if(live(r)&&r.date>=from&&r.date<=to)bonusBy.set(r.employeeId,(bonusBy.get(r.employeeId)||0)+(Number(r.amount)||0));});
    const emps=[...SX.sel].map(getEmployee).filter(Boolean).sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa'));
    const cols=emps.map(e=>{let nights=0,gross=0;const cells=isoDays.map(iso=>{const k=`${e.id}|${iso}`;if(att.has(k)){nights++;gross+=att.get(k);return att.get(k);}return null;});const adv=advBy.get(e.id)||0,bonus=bonusBy.get(e.id)||0;return {id:e.id,name:e.name||'—',cells,nights,gross,bonus,adv,net:gross+bonus-adv};});
    const days=isoDays.map(iso=>{const p=jpISO(iso);return {iso,label:`${toFa(p.day)} ${MONTHS[p.month-1]}`,wd:WEEKDAYS[(parseISO(iso).getDay()+1)%7]};});
    const unit=o.thousands?`هزار ${settings.currency||'تومان'}`:(settings.currency||'تومان');
    const num=v=>fa(o.thousands?v/1000:v);
    const rangeLabel=(from===to?jalaliDate(from):`${jalaliDate(from)} تا ${jalaliDate(to)}`)+` — مبالغ به ${unit}`;
    const foot=[{key:'nights',label:'تعداد شب'},{key:'gross',label:'جمع حقوق'}];
    if(o.adv){foot.push({key:'bonus',label:'پاداش (افزوده)'});foot.push({key:'adv',label:'مساعده (کسر)'});}
    foot.push({key:'net',label:'خالص قابل پرداخت'});
    if(o.sign)foot.push({key:'sign',label:'امضا'});
    const val=(c,k)=>k==='nights'?fa(c.nights):k==='gross'?num(c.gross):k==='bonus'?(c.bonus?num(c.bonus):'—'):k==='adv'?(c.adv?num(c.adv):'—'):k==='net'?num(c.net):'';
    const tot={gross:cols.reduce((s,c)=>s+c.gross,0),bonus:cols.reduce((s,c)=>s+c.bonus,0),adv:cols.reduce((s,c)=>s+c.adv,0),nights:cols.reduce((s,c)=>s+c.nights,0)};tot.net=tot.gross+tot.bonus-tot.adv;
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
    const txt=(t,cx,cy,maxW,size,weight='400',color='#111')=>{let s=size;g.font=`${weight} ${s}px ${exportFontStack()}`;while(s>9&&g.measureText(t).width>maxW){s--;g.font=`${weight} ${s}px ${exportFontStack()}`;}g.fillStyle=color;g.fillText(t,cx,cy);};
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
      if(f.key==='bonus')return numc(ref,3,c.bonus);
      if(f.key==='adv')return numc(ref,3,c.adv);
      if(f.key==='net')return numc(ref,5,c.net,`${L}${rowOf.gross}+${S.opts.adv?`${L}${rowOf.bonus}`:c.bonus}-${S.opts.adv?`${L}${rowOf.adv}`:c.adv}`);
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
    S.foot.filter(f=>f.key!=='sign').forEach(f=>lines.push([f.label,...S.cols.map(c=>f.key==='nights'?c.nights:f.key==='gross'?Math.round(c.gross):f.key==='bonus'?Math.round(c.bonus):f.key==='adv'?Math.round(c.adv):Math.round(c.net))]));
    return new Blob(['\ufeff'+lines.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  }
  function sxText(S){
    const cur=settings.currency||'تومان', m=v=>`${fa(Math.round(v))} ${cur}`;
    const rows=S.cols.map(c=>`• ${c.name}: ${fa(c.nights)} شب — جمع ${m(c.gross)}${c.bonus?` — پاداش ${m(c.bonus)}`:''}${c.adv?` — مساعده ${m(c.adv)}`:''} — قابل پرداخت ${m(c.net)}`);
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
    if(SX.busy)return; await ensureFonts();
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
  function sxEmpStats(e,from,to){let n=0,g=0;attList().forEach(a=>{if(a.employeeId===e.id&&a.date>=from&&a.date<=to){n++;g+=Number(a.payAmount)||0;}});const hasAdv=data.advances.some(r=>live(r)&&r.employeeId===e.id&&r.date>=from&&r.date<=to&&r.deductFromPayroll!==false),hasBonus=data.bonuses.some(r=>live(r)&&r.employeeId===e.id&&r.date>=from&&r.date<=to);return {n,g,hasAdv,hasBonus};}
  function sxRenderEmps(){
    const {from,to}=sxRange(), q=SX.q.trim().toLocaleLowerCase('fa');
    const list=liveEmployees().sort((a,b)=>(a.name||'').localeCompare(b.name||'','fa')).filter(e=>!q||`${e.name} ${e.role||''}`.toLocaleLowerCase('fa').includes(q));
    $('#sxEmps').innerHTML=list.length?list.map(e=>{const s=sxEmpStats(e,from,to);return `<label class="sx-emp${e.active===false?' off':''}"><input type="checkbox" data-sx-emp="${esc(e.id)}" ${SX.sel.has(e.id)?'checked':''}><span><b>${esc(e.name)}</b><small>${s.n?`${fa(s.n)} شب · ${money(s.g)}`:'بدون حضور در این بازه'}${e.active===false?' · غیرفعال':''}</small></span></label>`;}).join(''):'<div class="empty-inline">کارمندی پیدا نشد.</div>';
    $('#sxCount').textContent=`${fa(SX.sel.size)} نفر انتخاب شده`;
  }
  function sxPreselect(){const {from,to}=sxRange();SX.sel=new Set(liveEmployees().filter(e=>{const s=sxEmpStats(e,from,to);return s.n||s.hasAdv||s.hasBonus;}).map(e=>e.id));if(!SX.sel.size)activeEmployees().forEach(e=>SX.sel.add(e.id));}
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
      <div class="sx-block"><div class="sx-label">گزینه‌ها</div><div class="sx-opts"><label class="field sx-modefield"><span>محتوای خانه‌ها</span><select id="sxMode"><option value="amount">مبلغ هر شب</option><option value="mark">فقط علامت حضور (X)</option></select></label>${opt('adv','ردیف پاداش، مساعده و خالص پرداختی')}${opt('slash','خط مورب برای روزهای غیبت')}${opt('sign','ردیف امضا (برای پرداخت)')}${opt('thousands','مبالغ به هزار (کوتاه‌تر)')}</div></div>
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
;
/* ===== v1.8.2 UI polish helpers (additive, no data/logic changes) ===== */
(function(){
  'use strict';
  const mq=window.matchMedia('(max-width:900px)');
  const body=document.body;
  let lastY=window.scrollY,ticking=false;
  const fab=document.createElement('button');
  fab.type='button';fab.className='ay-fab';fab.setAttribute('aria-hidden','true');fab.tabIndex=-1;
  fab.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span></span>';
  body.appendChild(fab);
  let target=null;
  function activeTarget(){
    const pg=document.querySelector('.page.active');
    if(!pg)return null;
    return pg.querySelector('.page-intro .btn-primary, .page-intro-actions .btn-primary, .welcome-row .btn-primary');
  }
  function update(){
    ticking=false;
    if(!mq.matches){body.classList.remove('ay-scrolled-down');fab.classList.remove('on');return;}
    const y=window.scrollY,dy=y-lastY;
    if(Math.abs(dy)>8){body.classList.toggle('ay-scrolled-down',dy>0&&y>90);lastY=y;}
    if(y<40)body.classList.remove('ay-scrolled-down');
    target=activeTarget();
    let show=false;
    if(target&&!target.disabled){
      const r=target.getBoundingClientRect();
      show=r.bottom<56&&!document.querySelector('#modalRoot .modal');
      if(show){const t=(target.textContent||'').trim();if(fab.lastChild.textContent!==t)fab.lastChild.textContent=t;}
    }
    fab.classList.toggle('on',show);
  }
  function req(){if(!ticking){ticking=true;requestAnimationFrame(update);}}
  fab.addEventListener('click',()=>{if(target)target.click();});
  window.addEventListener('scroll',req,{passive:true});
  mq.addEventListener&&mq.addEventListener('change',req);
  document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{body.classList.remove('ay-scrolled-down');setTimeout(req,60);}));
  const mr=document.getElementById('modalRoot');
  if(mr)new MutationObserver(()=>body.classList.toggle('ay-modal-open',!!mr.querySelector('.modal'))).observe(mr,{childList:true});
  // tap the title bar to jump back to top
  const tt=document.querySelector('.topbar-title');
  if(tt)tt.addEventListener('click',()=>{if(mq.matches)window.scrollTo({top:0,behavior:'smooth'});});
})();
