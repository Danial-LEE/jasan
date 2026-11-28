/* 자산관리 계기판 — 앱 동작 (app.js)
   숫자·목록은 settings.js, 구글 키는 config.js 에서 고치세요. 이 파일은 보통 고칠 필요가 없습니다. */
(() => {
"use strict";
/* ---------- 설정 읽기 (settings.js 가 깨졌을 때를 대비한 기본값 포함) ---------- */
const FALLBACK = { DEFAULT_PRESET: "50공격", ROLES: [{k:"cash",n:"유동성",d:"현금·CMA·MMF",c:"#8a9099"},{k:"kr",n:"국내주식",d:"성장",c:"#2f5fe0"},{k:"gl",n:"해외주식",d:"성장",c:"#5fa0ff"},{k:"bond",n:"채권",d:"방어",c:"#0f9d8a"},{k:"inc",n:"인컴",d:"현금흐름",c:"#7b5cf0"},{k:"gold",n:"금·원자재",d:"물가 방어",c:"#d4a000"},{k:"alt",n:"대체투자",d:"IMA·리츠",c:"#9a6a3a"},{k:"sat",n:"위성",d:"고위험",c:"#e0457b"}],
  PRESETS: {"50공격":[8,10,30,20,12,6,8,6]}, BAND:{type:"abs",value:5}, INSTITUTIONS:["기타"], ACCOUNTS:["일반(위탁)","ISA","연금저축","IRP","DC/DB","CMA","예적금","기타"], RISK_LIMIT:70, RISKY_ROLES:["kr","gl","sat","gold","alt"], HOME_ACCOUNT:{}, ROLE_HINTS:[], COLUMN_HINTS:{} };
// 설정 합치기: 앱 기본값(defaults.js) 위에 내 설정(settings.js)을 덮어씀. PRESETS 같은 묶음은 항목별로 합침
const SET = (() => { const out = Object.assign({}, FALLBACK, window.JASAN_DEFAULTS || {}), u = window.JASAN_SETTINGS || {};
  for (const k in u) { const a = out[k], b = u[k]; out[k] = a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b) ? Object.assign({}, a, b) : b; }
  return out; })();
const CONFIG = window.JASAN_CONFIG || {};
const ROLES = SET.ROLES, RK = ROLES.map(r => r.k), RM = Object.fromEntries(ROLES.map(r => [r.k, r]));
const ACCTS = SET.ACCOUNTS, TAXADV = ["ISA", "연금저축", "IRP", "DC/DB"];
const DEF = SET.PRESETS[SET.DEFAULT_PRESET] ? SET.DEFAULT_PRESET : Object.keys(SET.PRESETS)[0];
const APP_VERSION = "v20"; // 화면 위에 표시되는 앱 버전. 업데이트가 반영됐는지 확인용
const LS = "jasan-v1", FILE = "자산관리_데이터.json";
const DRIVE = "https://www.googleapis.com/drive/v3", UPLOAD = "https://www.googleapis.com/upload/drive/v3", SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const REFRESH_MIN = Math.max(3, +SET.PRICE_REFRESH_MINUTES || 10);
const CRYPTO = SET.CRYPTO || ["BTC", "ETH", "XRP", "SOL", "DOGE", "ADA"];
const FXS = ["USD", "JPY", "EUR", "CNY", "HKD", "GBP"];

/* ---------- 도우미 ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const won = n => Math.round(n).toLocaleString("ko-KR") + "원";
const short = n => { const a = Math.abs(n), s = n < 0 ? "−" : ""; return a >= 1e8 ? s + (a / 1e8).toFixed(2) + "억" : a >= 1e4 ? s + Math.round(a / 1e4).toLocaleString("ko-KR") + "만" : s + Math.round(a).toLocaleString("ko-KR"); };
const pct = (x, d = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x * 100).toFixed(d) + "%";
const cls = x => x > 0 ? "up" : x < 0 ? "dn" : "";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const toT = a => Object.fromEntries(RK.map((k, i) => [k, +(a && a[i]) || 0]));
const ret = h => h.cost ? (h.value - h.cost) / h.cost : 0;
// 종목코드 정리: 6자리 숫자 → KRX:069500, BTC → CURRENCY:BTCUSD, 나머지는 대문자 그대로(QQQ, NASDAQ:AAPL)
function normCode(c){ c = String(c || "").trim().toUpperCase().replace(/\s+/g, ""); if (!c) return "";
  let m = /^(\w+):(KRX|KOSPI|KOSDAQ)$/.exec(c); if (m) c = (m[2] === "KOSDAQ" ? "KOSDAQ:" : "KRX:") + m[1]; // 구글 표기 376270:KOSDAQ
  c = c.replace(/^KOSPI:/, "KRX:").replace(/\.(US|O|OQ|N|K)$/, ""); // AAPL.US, AAPL.O 같은 표기는 AAPL로
  if (/^A?\d[0-9A-Z]{5}$/.test(c) && /\d{3}/.test(c)) return "KRX:" + c.replace(/^A(?=\d)/, ""); // 국내 6자리(신규 영문 섞인 코드 포함). 코스닥 여부는 시세 받을 때 자동 확인
  if (/^(CASH:)?USD(현금|예수금)?$|^달러(현금|예수금)?$/.test(c) && c !== "USD") return "CASH:USD"; if (c === "CASH:USD") return c;
  if (CRYPTO.includes(c)) return "CURRENCY:" + c + "USD"; return c; }
// 시세 함수로 찾아볼 후보: 국내는 코스피(KRX)·코스닥(KOSDAQ) 둘 다, 거래소 없는 해외 티커는 주요 미국 거래소 모두
const US_EX = SET.US_EXCHANGES || ["NASDAQ", "NYSE", "NYSEARCA", "NYSEAMERICAN", "BATS"];
function candidates(code){
  const m = /^(KRX|KOSDAQ):(.+)$/.exec(code); if (m) return [code, (m[1] === "KRX" ? "KOSDAQ:" : "KRX:") + m[2]];
  if (code.includes(":")) return [code];
  return [code, ...US_EX.map(x => x + ":" + code)];
}
const isCash = h => /^CASH:/.test(h.code || "");
/* 종목 로고: 설정(defaults.js LOGO_URLS)의 주소를 차례로 시도하고, 모두 실패하면 글자 아이콘 */
function logoUrls(code){ const L = SET.LOGO_URLS || {}; if (!code) return [];
  let m = /^(?:KRX|KOSDAQ):(\w{6})$/.exec(code); if (m) return (L.KR || []).map(u => u.replace("{code}", m[1]));
  if (/^(CASH|CURRENCY):/.test(code)) return [];
  const t = code.replace(/^[A-Z]+:/, ""); return (L.US || []).map(u => u.replace("{ticker}", t)); }
function logo(code, name, role){
  const ch = /^CASH:/.test(code || "") ? "$" : /^CURRENCY:BTC/.test(code || "") ? "₿" : (String(name || code || "?").replace(/^(KODEX|TIGER|ACE|RISE|KBSTAR|SOL|HANARO|ARIRANG|KOSEF|PLUS)\s*/i, "").trim()[0] || "?").toUpperCase();
  const u = logoUrls(code), c = (RM[role] || ROLES[0]).c;
  return `<span class="lg" style="--lc:${c}"><b>${esc(ch)}</b>${u.length ? `<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${esc(u[0])}" data-alt="${esc(u.slice(1).join(" "))}" onerror="lgErr(this)" onload="this.parentNode.classList.add('ok')">` : ""}</span>`; }
window.lgErr = img => { const alt = (img.dataset.alt || "").split(" ").filter(Boolean); if (alt.length) { img.dataset.alt = alt.slice(1).join(" "); img.src = alt[0]; } else img.remove(); };
const isAuto = h => !!(h.code && h.qty > 0 && (h.price > 0 || isCash(h)));
/* 같은 종목 묶기: 종목코드(거래소 표기는 무시) → 없으면 상품명(띄어쓰기·기호 무시)으로 같은 종목을 판단 */
const codeBase = c => !c ? "" : /^(CURRENCY|CASH):/.test(c) ? c : c.replace(/^[A-Z]+:/, "");
const nameKey = n => String(n || "").toUpperCase().replace(/[\s·.\-_()\[\]]/g, "");
function secMap(){ const byName = {}; S.holdings.forEach(h => { if (h.code && h.name) byName[nameKey(h.name)] = codeBase(h.code); }); return byName; }
function secKey(h, byName){ if (h.code) return "C:" + codeBase(h.code); const k = nameKey(h.name); return byName && byName[k] ? "C:" + byName[k] : k ? "N:" + k : "R:" + h.id; }
function securities(list){ const byName = secMap(), m = new Map();
  (list || A()).forEach(h => { const k = secKey(h, byName); let g = m.get(k);
    if (!g) { g = { key: k, name: h.name, code: h.code, role: h.role, rows: [], qty: 0, cost: 0, value: 0, price: 0, cur: "" }; m.set(k, g); }
    g.rows.push(h); g.qty += +h.qty || 0; g.cost += h.cost; g.value += h.value;
    if (!g.code && h.code) g.code = h.code; if (h.price > 0 && !g.price) { g.price = h.price; g.cur = h.cur; } if (h.name && h.name.length > (g.name || "").length && !g.name) g.name = h.name; });
  return [...m.values()].sort((a, b) => b.value - a.value); }
// 같은 종목의 다른 줄에서 코드·이름·역할을 가져옴
function sameSec(h){ const byName = secMap(), k = secKey(h, byName); return S.holdings.filter(x => x !== h && secKey(x, byName) === k); }
let toastT = 0;
function toast(m){ const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3500); }
function presetParts(name){ const m = /^(\d+)(.+)$/.exec(name) || []; return { age: m[1] || "50", style: m[2] || "공격" }; }

/* ---------- 상태 ---------- */
function blank(){ const p = presetParts(DEF); return { sample: false, age: p.age, style: p.style, targets: toT(SET.PRESETS[DEF]), band: { type: SET.BAND.type, v: SET.BAND.value }, mode: "full", newCash: 0, holdings: [], snaps: [], divs: [], tx: [], off: [], priceSheet: "", pricedAt: 0, fx: {}, savedAt: 0 }; }
function sample(){
  const h = [["한국투자증권","ISA","국내 상장 S&P500 ETF","gl",28e6,35.4e6],["한국투자증권","ISA","국내 상장 나스닥100 ETF","gl",12e6,15.9e6],["미래에셋증권","연금저축","전세계주식 ETF","gl",10e6,11.8e6],["미래에셋증권","연금저축","코스피200 ETF","kr",9e6,11.7e6],["삼성증권","IRP","국고채 10년 ETF","bond",15e6,15.3e6],["삼성증권","IRP","미국채 단기 ETF(환노출)","bond",8e6,8.15e6],["키움증권","일반(위탁)","미국 투자등급 회사채(달러)","inc",9e6,9.25e6],["NH투자증권","일반(위탁)","KRX 금현물","gold",6e6,8.4e6],["한국투자증권","일반(위탁)","IMA 상품","alt",7e6,7.21e6],["업비트","기타","비트코인","sat",4e6,6.9e6],["토스증권","일반(위탁)","AI 반도체 개별주","sat",5e6,6.3e6],["한국투자증권","CMA","CMA(발행어음형)","cash",9e6,9e6]]
    .map(r => ({ id: uid(), inst: r[0], acct: r[1], name: r[2], role: r[3], cost: r[4], value: r[5] }));
  // 예시: 몇 개 상품에 종목코드·수량을 넣어 자동 평가 모양을 보여 줌
  [[0, "KRX:360750", 1700], [3, "KRX:069500", 300], [9, "CURRENCY:BTCUSD", 0.05]].forEach(([i, code, q]) => { const x = h[i]; x.code = code; x.qty = q; x.cur = code.startsWith("CURRENCY") ? "USD" : "KRW"; x.price = code.startsWith("CURRENCY") ? x.value / q / 1380 : x.value / q; });
  const divs = [["2026-07-15", 2, 85000, "dep"], ["2026-08-14", 1, 62000, "dep"], ["2026-09-30", 6, 118000, "wd"], ["2026-10-15", 2, 91000, "dep"], ["2026-10-31", 4, 132000, "wd"]].map(d => ({ id: uid(), d: d[0], hid: h[d[1]].id, name: h[d[1]].name, amt: d[2], how: d[3], cashId: "" }));
  return norm(Object.assign(blank(), { sample: true, mode: "full", holdings: h, divs, fx: { USD: 1380 },
    snaps: [["2026-06-01",110e6,112e6],["2026-07-01",113e6,118.5e6],["2026-08-01",116e6,121e6],["2026-09-01",118e6,126e6],["2026-10-01",120e6,133e6],["2026-11-01",122e6,139.5e6]].map(s => ({ d: s[0], c: s[1], v: s[2] })) }));
}
function sampleMix(S0){ // 예시 기록에 역할별 금액을 채움(목표 비율에서 현재 비율로 서서히 이동)
  const T = {}; RK.forEach(k => T[k] = 0); S0.holdings.forEach(h => T[h.role] += h.value); const tv = Object.values(T).reduce((a, b) => a + b, 0) || 1;
  S0.snaps.forEach((x, i, arr) => { const t = arr.length > 1 ? i / (arr.length - 1) : 1; x.r = Object.fromEntries(RK.map(k => [k, Math.round(x.v * ((1 - t) * (S0.targets[k] / 100) + t * (T[k] / tv)))])); });
  const AR = {}, AC = {}, tc = S0.holdings.reduce((a, h) => a + h.cost, 0) || 1; S0.holdings.forEach(h => { const k = (h.inst || "기관 미입력") + "|" + h.acct; (AR[k] = AR[k] || {})[h.role] = (AR[k][h.role] || 0) + h.value; AC[k] = (AC[k] || 0) + h.cost; });
  S0.snaps.forEach(x => { x.a = {}; for (const k in AR) { const r = {}; let v = 0; for (const q in AR[k]) { r[q] = Math.round(x.r[q] * AR[k][q] / (T[q] || 1)); v += r[q]; } x.a[k] = { v, c: Math.round(x.c * AC[k] / tc), r }; } });
  return S0; }
function norm(s){
  const b = blank(); s = Object.assign(b, s || {});
  s.targets = Object.assign(toT([]), s.targets); s.band = Object.assign({ type: "abs", v: 5 }, s.band);
  s.holdings = (Array.isArray(s.holdings) ? s.holdings : []).map(h => ({ id: h.id || uid(), inst: String(h.inst || ""), acct: ACCTS.includes(h.acct) ? h.acct : "기타", name: String(h.name || ""), role: RK.includes(h.role) ? h.role : RK[0], cost: +h.cost || 0, value: +h.value || 0,
    code: normCode(h.code), qty: +h.qty || 0, price: +h.price || 0, cur: String(h.cur || ""), perr: !!h.perr, fxerr: !!h.fxerr, autoName: !!h.autoName })).map(h => /^CASH:/.test(h.code) ? Object.assign(h, { price: 1, cur: h.code.slice(5), perr: false }) : h);
  s.divs = (Array.isArray(s.divs) ? s.divs : []).filter(d => d && d.d && +d.amt).map(d => ({ id: d.id || uid(), d: String(d.d), hid: String(d.hid || ""), name: String(d.name || ""), inst: String(d.inst || ""), acct: String(d.acct || ""), amt: +d.amt, cur: d.cur === "USD" ? "USD" : "KRW", amtCur: +d.amtCur || +d.amt, fx: +d.fx || 1, how: d.how === "wd" ? "wd" : "dep", cashId: String(d.cashId || "") }));
  s.mom = s.mom && typeof s.mom === "object" && s.mom.d ? s.mom : null; s.tx = (Array.isArray(s.tx) ? s.tx : []).filter(t => t && t.t && t.key); s.off = Array.isArray(s.off) ? s.off.map(String) : []; s.fx = s.fx && typeof s.fx === "object" ? s.fx : {}; s.fxManual = s.fxManual && typeof s.fxManual === "object" ? s.fxManual : {}; s.priceSheet = String(s.priceSheet || ""); s.pricedAt = +s.pricedAt || 0;
  s.snaps = (Array.isArray(s.snaps) ? s.snaps : []).filter(x => x && x.d).map(x => { const o = { d: String(x.d), c: +x.c || 0, v: +x.v || 0 }; if (x.r && typeof x.r === "object") o.r = x.r; if (x.a && typeof x.a === "object") o.a = x.a; if (x.pp) o.pp = 1; return o; });
  s.savedAt = +s.savedAt || 0; return s;
}
let S = null, firstRun = false;
try { const raw = JSON.parse(localStorage.getItem(LS)); if (raw && typeof raw === "object") S = norm(raw); } catch (e) {}
if (!S) { S = blank(); firstRun = true; }

let pend = false;
function saveLocal(){ try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} }
function persist(){ S.savedAt = Date.now(); saveLocal(); pend = true; setSync(); scheduleSync(); }

/* ---------- 계산 ---------- */
// 배당 합계: upto = 'YYYY-MM-DD' 이하만(없으면 전체)
/* 계좌 켜기·끄기: 꺼진 계좌는 모든 분석에서 제외 */
const offSet = () => new Set(S.off || []);
const isOff = (h, o) => (o || offSet()).has(acctKey(h));
const A = () => { const o = offSet(); return o.size ? S.holdings.filter(h => !o.has(acctKey(h))) : S.holdings; };
function divKey(d){ const h = S.holdings.find(x => x.id === d.hid); return d.inst || d.acct ? (d.inst || "기관 미입력") + "|" + (d.acct || (h ? h.acct : "")) : h ? acctKey(h) : ""; }
const AD = () => { const o = offSet(); return o.size ? S.divs.filter(d => !o.has(divKey(d))) : S.divs; };
function adjSnap(x, o){ if (!o.size) return x; if (!x.a) return null; let v = x.v, c = x.c; const r = x.r ? Object.assign({}, x.r) : null;
  o.forEach(k => { const y = x.a[k]; if (!y) return; v -= y.v; c -= y.c; if (r) for (const q in y.r) r[q] = (r[q] || 0) - y.r[q]; });
  return Object.assign({}, x, { v, c, r }); }
const SN = () => { const o = offSet(); return S.snaps.map(x => adjSnap(x, o)).filter(Boolean); };
const swHTML = (keys, on, label, ind) => `<label class="tgl" title="${on ? "분석에 포함됨 · 누르면 제외" : "분석에서 제외됨 · 누르면 포함"}"><input type="checkbox" data-sw="${esc(JSON.stringify(keys))}" ${on ? "checked" : ""} ${ind ? 'data-ind="1"' : ""} aria-label="${esc(label)} 분석 포함"><i></i></label>`;
function acctTree(){ const m = new Map(); S.holdings.forEach(h => { const i = h.inst || "기관 미입력", k = acctKey(h); if (!m.has(i)) m.set(i, new Map()); const a = m.get(i); a.set(k, (a.get(k) || 0) + h.value); }); return m; }
function renderOff(){ const o = offSet(), tree = acctTree(), all = [...tree.values()].flatMap(a => [...a.keys()]), nOff = all.filter(k => o.has(k)).length;
  $("acctBtnTxt").textContent = nOff ? `분석 계좌 ${all.length - nOff}/${all.length}` : "분석 계좌 전체"; $("acctBtn").classList.toggle("part", !!nOff); $("acctBtn").hidden = !all.length;
  $("acctPop").innerHTML = `<div class="ah"><span>끈 계좌는 총 평가액·비중·리밸런싱·수익률·배당·차트에서 모두 빠집니다</span></div>` + [...tree].map(([i, a]) => { const ks = [...a.keys()], on = ks.filter(k => !o.has(k)).length;
      return `<div class="ib"><div class="ir${on ? "" : " off"}">${swHTML(ks, on > 0, i, on > 0 && on < ks.length)}<span>${esc(i)}</span><em>${short([...a].filter(([k]) => !o.has(k)).reduce((s, [, v]) => s + v, 0))}</em></div>${ks.map(k => `<div class="ar${o.has(k) ? " off" : ""}">${swHTML([k], !o.has(k), k.replace("|", " "))}<span>${esc(k.split("|")[1])}</span><em>${short(a.get(k))}</em></div>`).join("")}</div>`; }).join("")
    + `<div class="af"><button class="g" data-allon ${nOff ? "" : "disabled"}>모두 켜기</button><button class="x" data-popclose>닫기</button></div>`;
  document.querySelectorAll('input[data-ind="1"]').forEach(x => x.indeterminate = true);
  const bar = $("offBar"); bar.hidden = !nOff; if (!nOff) return;
  const offs = all.filter(k => o.has(k)), ov = S.holdings.filter(h => o.has(acctKey(h))).reduce((s, h) => s + h.value, 0), lost = S.snaps.filter(x => !x.a).length;
  bar.innerHTML = `<div><b>계좌 ${offs.length}개를 끄고 분석 중</b> · ${offs.map(k => esc(k.replace("|", " "))).join(", ")} · 제외된 평가액 ${won(ov)}${lost ? `<span class="note">계좌별 금액이 없는 이전 기록 ${lost}개는 수익률·비중 변화 계산에서 빠집니다. 오늘부터 기록에는 계좌별 금액이 함께 저장됩니다.</span>` : ""}</div><span class="row"><button class="g" data-popopen>계좌 선택</button><button class="a" data-allon>모두 켜기</button></span>`; }
document.addEventListener("change", e => { const t = e.target.closest("input[data-sw]"); if (!t) return; let keys; try { keys = JSON.parse(t.dataset.sw); } catch (er) { return; }
  const o = offSet(), wasOn = keys.some(k => !o.has(k)), off = t.closest(".ir") ? wasOn : !t.checked, popOpen = !$("acctPop").hidden;
  setOff(keys, off); if (popOpen) $("acctPop").hidden = false;
  const nm = keys.length > 1 ? `${esc(t.closest(".ir").querySelector("span").textContent)} 계좌 ${keys.length}개를` : `‘${keys[0].replace("|", " ")}’ 계좌를`;
  toast(off ? `${nm} 분석에서 뺐습니다` : `${nm} 다시 분석에 넣었습니다`); });
document.addEventListener("click", e => {
  if (e.target.closest("[data-allon]")) { S.off = []; touch(); renderAll(); toast("모든 계좌를 다시 분석에 넣었습니다"); return; }
  if (e.target.closest("#acctBtn,[data-popopen]")) { const p = $("acctPop"); p.hidden = !p.hidden; $("acctBtn").setAttribute("aria-expanded", !p.hidden); if (!p.hidden) window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (e.target.closest("[data-popclose]") || (!e.target.closest("#acctPop") && !$("acctPop").hidden)) { $("acctPop").hidden = true; $("acctBtn").setAttribute("aria-expanded", false); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("acctPop").hidden) { $("acctPop").hidden = true; $("acctBtn").focus(); } });
function setOff(keys, off){ const o = offSet(); keys.forEach(k => off ? o.add(k) : o.delete(k)); S.off = [...o]; touch(); renderAll(); }
function divSum(upto, how){ return AD().filter(d => (!upto || d.d <= upto) && (!how || d.how === how)).reduce((a, d) => a + d.amt, 0); }
/* ---------- 거래 장부: 입금·출금·매수·매도 ----------
   순수 투자원금 = 입금 − 출금. 매수·매도·배당은 계좌 예수금으로 오갈 뿐 원금을 바꾸지 않는다.
   계산: 계좌 원금 = 그 계좌 원가 합계 − 매도로 확정된 손익 − 예수금으로 들어온 배당
   (직접 고친 원가·예수금은 원금 보정으로 본다) */
const isKcash = h => !h.code && h.role === "cash" && /예수금/.test(h.name);
const hCur = code => !code ? "" : /^(KRX|KOSDAQ):/.test(code) ? "KRW" : /^CURRENCY:BTC/.test(code) ? "USD" : /^CASH:/.test(code) ? code.slice(5) : "USD";
const divIn = d => d.how === "dep" && !!d.cashId; // 예수금으로 들어와 평가액에 포함된 배당
function prinMap(){ const m = {}, add = (k, v) => m[k] = (m[k] || 0) + v;
  S.holdings.forEach(h => add(acctKey(h), h.cost)); (S.tx || []).forEach(t => { if (t.rz) add(t.key, -t.rz); }); S.divs.forEach(d => { if (divIn(d)) add(divKey(d), -d.amt); }); return m; }
function cashRow(key, cur, make){ const [i0, acct] = key.split("|"), inst = i0 === "기관 미입력" ? "" : i0;
  let r = cur === "USD" ? S.holdings.find(x => x.code === "CASH:USD" && acctKey(x) === key) : (S.holdings.find(x => isKcash(x) && acctKey(x) === key && x.name === "예수금") || S.holdings.find(x => isKcash(x) && acctKey(x) === key));
  if (!r && make) { r = cur === "USD" ? { id: uid(), inst, acct, name: "예수금(USD)", role: "cash", cost: 0, value: 0, code: "CASH:USD", qty: 0, price: 1, cur: "USD", perr: false }
      : { id: uid(), inst, acct, name: "예수금", role: "cash", cost: 0, value: 0, code: "", qty: 0, price: 0, cur: "", perr: false }; S.holdings.push(r); }
  return r; }
const cashBal = (key, cur) => { const r = cashRow(key, cur, false); return r ? (cur === "USD" ? r.qty : r.value) : 0; };
function cashMove(key, cur, amtC, amtK){ const r = cashRow(key, cur, true);
  if (cur === "USD") { r.qty = +(r.qty + amtC).toFixed(2); r.value = Math.round(r.qty * fxOf("USD")); r.cost = Math.round(r.cost + amtK); }
  else { r.value = Math.round(r.value + amtK); r.cost = r.value; } }
const reval = h => { if (isAuto(h)) h.value = Math.round(h.qty * h.price * fxOf(h.cur)); };
function txApply(t, sg){
  if (t.t === "in" || t.t === "out") { const d = (t.t === "in" ? 1 : -1) * sg; cashMove(t.key, t.cur, d * t.amtC, d * t.amt); return; }
  let h = S.holdings.find(x => x.id === t.hid);
  if (t.t === "buy") {
    if (sg > 0) { if (!h) { h = Object.assign({}, t.snap); S.holdings.push(h); } h.qty = +(h.qty + t.q).toFixed(6); h.cost = Math.round(h.cost + t.amt); if (h.code && !h.price && t.px) { h.price = t.px; h.cur = hCur(h.code); } if (isAuto(h)) reval(h); else h.value = Math.round(h.value + t.amt); cashMove(t.key, t.cur, -t.amtC, -t.amt); }
    else { if (h) { h.qty = Math.max(0, +(h.qty - t.q).toFixed(6)); h.cost = Math.max(0, Math.round(h.cost - t.amt)); if (isAuto(h)) reval(h); else h.value = Math.max(0, Math.round(h.value - t.amt)); if (t.created && !h.qty && !h.cost) S.holdings = S.holdings.filter(x => x !== h); } cashMove(t.key, t.cur, t.amtC, t.amt); }
    return; }
  if (t.t === "sell") {
    if (sg > 0) { if (!h) return; h.qty = Math.max(0, +(h.qty - t.q).toFixed(6)); h.cost = Math.max(0, Math.round(h.cost - t.costOut)); if (isAuto(h)) reval(h); else h.value = Math.max(0, Math.round(h.value - t.valOut)); if (t.removed) S.holdings = S.holdings.filter(x => x !== h); cashMove(t.key, t.cur, t.amtC, t.amt); }
    else { if (!h) { h = Object.assign({}, t.snap, { qty: 0, cost: 0, value: 0 }); S.holdings.push(h); } h.qty = +(h.qty + t.q).toFixed(6); h.cost = Math.round(h.cost + t.costOut); if (isAuto(h)) reval(h); else h.value = Math.round(h.value + t.valOut); cashMove(t.key, t.cur, -t.amtC, -t.amt); } }
}
function calc(){
  const T = { v: 0, c: 0 }, R = {}; RK.forEach(k => R[k] = { v: 0, c: 0 });
  A().forEach(h => { T.v += h.value; T.c += h.cost; R[h.role].v += h.value; R[h.role].c += h.cost; });
  const nc = Math.max(0, +S.newCash || 0), T2 = T.v + nc;
  const rows = ROLES.map(r => { const cur = R[r.k].v, t = (+S.targets[r.k] || 0) / 100, w = T.v ? cur / T.v : 0, d = (w - t) * 100, lim = S.band.type === "abs" ? +S.band.v : t * S.band.v;
    return { r, cur, t, w, d, lim, out: T.v > 0 && Math.abs(d) > lim + 1e-9, trade: 0 }; });
  if (S.mode === "full") rows.forEach(x => x.trade = x.t * T2 - x.cur);
  else { const def = rows.map(x => Math.max(0, x.t * T2 - x.cur)), sd = def.reduce((a, b) => a + b, 0);
    rows.forEach((x, i) => x.trade = sd > 0 ? def[i] * Math.min(1, nc / sd) : 0);
    const left = nc - rows.reduce((a, x) => a + x.trade, 0); if (left > 1) rows.forEach(x => x.trade += left * x.t); }
  rows.forEach(x => { x.trade = Math.round(x.trade / 1e4) * 1e4; x.after = T2 ? (x.cur + x.trade) / T2 : 0; });
  const o = offSet(), pm = prinMap(); T.p = Object.keys(pm).filter(k => !o.has(k)).reduce((a, k) => a + pm[k], 0);
  T.U = T.v - T.c; T.Rz = (S.tx || []).filter(t => t.t === "sell" && !o.has(t.key)).reduce((a, t) => a + (t.rz || 0), 0);
  const ad = AD(); T.D = ad.reduce((a, d) => a + d.amt, 0); T.Dx = ad.filter(d => !divIn(d)).reduce((a, d) => a + d.amt, 0);
  T.P = T.v - T.p + T.Dx; // 총손익 = 미실현 + 실현 + 배당
  return { T, R, rows, nc, T2 };
}
function where(role, sell){
  const hs = A().filter(h => h.role === role).sort((a, b) => b.value - a.value);
  if (!hs.length) return "보유 없음 → 추천 계좌: " + esc(SET.HOME_ACCOUNT[role] || "일반(위탁)");
  const p = sell ? (hs.find(h => TAXADV.includes(h.acct)) || hs[0]) : hs[0];
  return esc(p.inst) + " · " + esc(p.acct) + " · " + esc(p.name || "이름 없음");
}

/* ---------- 화면: 상단 ---------- */
function renderTop(c){
  const out = c.rows.filter(x => x.out).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  let h;
  if (!S.holdings.length) h = "자산을 불러오면 리밸런싱 계산이 시작됩니다";
  else if (!out.length) h = "모든 자산이 허용 밴드 안에 있습니다 — 이번에는 그대로 두세요";
  else { const x = out[0]; h = `${x.r.n}이 목표보다 ${Math.abs(x.d).toFixed(1)}%p ${x.d > 0 ? "높습니다" : "낮습니다"} — 리밸런싱이 필요합니다` + (out.length > 1 ? ` (외 ${out.length - 1}개)` : ""); }
  if (S.holdings.length) { const tr = c.T.p ? c.T.P / c.T.p : 0, ym = today().slice(0, 7), dm = AD().filter(d => d.d.startsWith(ym)).reduce((a, d) => a + d.amt, 0);
    h += ` · 총수익률 ${pct(tr)}` + (dm ? ` · 이번 달 배당·이자 ${short(dm)}` : ""); }
  $("head").textContent = h;
  const mx = c.rows.reduce((a, x) => Math.abs(x.d) > Math.abs(a.d) ? x : a, c.rows[0]);
  const nb = c.rows.filter(x => x.trade > 0).length, ns = c.rows.filter(x => x.trade < 0).length, has = c.T.v > 0;
  const D = divSum(), y1 = new Date(); y1.setFullYear(y1.getFullYear() - 1); const f12 = y1.toISOString().slice(0, 10), d12 = AD().filter(d => d.d > f12).reduce((a, d) => a + d.amt, 0);
  $("hero").innerHTML = `<div class="hv"><span>총 평가액${offSet().size ? " · 켜진 계좌" : ""}</span><b>${won(c.T.v)}</b><em>${A().length}개 자산 · ${new Set(A().map(h => h.inst)).size}개 기관${offSet().size ? ` · 전체 ${short(S.holdings.reduce((a, h) => a + h.value, 0))} 중` : ""}</em></div>
    <div class="hv"><span>순수 투자원금</span><b>${won(c.T.p)}</b><em>입금 − 출금 · 재투자·매매로는 변하지 않음</em></div>
    <div class="hv"><span>총손익</span><b class="${cls(c.T.P)}">${c.T.P >= 0 ? "+" : "−"}${won(Math.abs(c.T.P))}</b><em><span class="${cls(c.T.P)}" style="font-weight:700">${pct(c.T.p ? c.T.P / c.T.p : 0)}</span> · 미실현 ${short(c.T.U)} · 실현 ${short(c.T.Rz)} · 배당 ${short(c.T.D)}</em></div>`;
  $("kpis").innerHTML = `<div class="kpi"><span>12개월 배당·이자</span><b>${short(d12)}</b><span>배당수익률 ${c.T.v ? (d12 / c.T.v * 100).toFixed(2) : "0.00"}% · 누적 ${short(D)}</span></div>
  <div class="kpi"><span>실현손익(매도 확정)</span><b class="${cls(c.T.Rz)}">${short(c.T.Rz)}</b><span>매도 ${(S.tx || []).filter(t => t.t === "sell" && !offSet().has(t.key)).length}건 · 예수금으로 적립</span></div>
  <div class="kpi"><span>최대 이탈</span><b>${has ? (mx.d > 0 ? "+" : "−") + Math.abs(mx.d).toFixed(1) + "%p" : "—"}</b><span>${has ? esc(mx.r.n) + " · " : ""}밴드 ${S.band.type === "abs" ? "±" + S.band.v + "%p" : "±" + S.band.v + "%"}</span></div>
  <div class="kpi"><span>다음 할 일</span><b>${!has ? "자산 입력" : out.length ? "리밸런싱" : "유지"}</b><span>${out.length ? `매수 ${nb}건 · 매도 ${ns}건` : has ? "다음 점검까지 대기" : "파일 불러오기 또는 직접 입력"}</span></div>`;
  $("sampleBar").hidden = !S.sample;
  $("welcome").hidden = !!S.holdings.length; document.body.classList.toggle("empty", !S.holdings.length);
}

/* ---------- 화면: 리밸런싱 ---------- */
function renderGauge(c){
  const M = Math.max(20, Math.ceil(Math.max(...c.rows.map(x => Math.max(x.w * 100, x.t * 100 + x.lim))) * 1.1 / 10) * 10);
  const P = v => Math.max(0, Math.min(100, v / M * 100));
  let tk = ""; for (let v = 0; v <= M; v += M > 60 ? 20 : 10) tk += `<i style="left:${P(v)}%">${v}%</i>`; $("ticks").innerHTML = tk;
  const seg = f => c.rows.filter(x => f(x) > 0).map(x => `<i style="width:${f(x) * 100}%;background:${x.r.c}" title="${esc(x.r.n)} ${(f(x) * 100).toFixed(1)}%"></i>`).join("");
  $("mixcmp").innerHTML = `<span>현재</span><div class="sb">${seg(x => x.w)}</div><span>목표</span><div class="sb">${seg(x => x.t)}</div>`;
  const nOut = c.rows.filter(x => x.out).length;
  $("gSum").innerHTML = nOut ? `<span class="tag o">밴드 이탈 ${nOut}개</span>` : `<span class="badge">모두 허용 범위 안</span>`;
  $("gauge").innerHTML = c.rows.map(x => { const w = x.w * 100, t = x.t * 100, d = w - t, tr = x.trade, none = Math.abs(tr) < 1e4;
    return `<div class="gr${x.out ? " out" : ""}"><div class="nm"><i class="dot" style="background:${x.r.c}"></i><div>${esc(x.r.n)}<small>${esc(x.r.d)}</small></div></div>
    <div class="trk" title="목표 ${t.toFixed(1)}% (허용 ${Math.max(0, t - x.lim).toFixed(1)}~${(t + x.lim).toFixed(1)}%) · 현재 ${w.toFixed(1)}%"><div class="bd" style="left:${P(t - x.lim)}%;width:${P(t + x.lim) - P(t - x.lim)}%"></div><div class="fl" style="width:${P(w)}%;background:${x.r.c}"></div><div class="tg" style="left:${P(t)}%"></div><div class="pt" style="left:${P(w)}%;border-color:${x.r.c}"></div></div>
    <div class="ro"><b>${w.toFixed(1)}%</b><small>목표 ${t.toFixed(1)}%</small><span class="dv">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%p${x.out ? " 이탈" : ""}</span></div>
    <div class="tp ${none ? "" : tr > 0 ? "buy" : "sell"}">${none ? "조정 없음" : `${tr > 0 ? "매수" : "매도"}<small>${short(Math.abs(tr))}</small>`}</div></div>`; }).join("");
}
function renderPlan(c){
  if (!S.holdings.length) { $("plan").innerHTML = '<p class="note">보유자산을 불러오거나 입력하세요.</p>'; return; }
  const rows = c.rows.filter(x => Math.abs(x.trade) >= 1e4), tsum = RK.reduce((a, k) => a + (+S.targets[k] || 0), 0);
  $("plan").innerHTML = (Math.abs(tsum - 100) > .01 ? `<div class="warn">목표 비율 합계가 ${tsum}%입니다. 100%로 맞춰야 계산이 정확합니다.</div>` : "")
   + (S.mode === "cash" && !c.nc ? '<div class="warn">‘추가 납입금으로만’ 방식은 이번 추가 납입금을 입력해야 매수 계획이 나옵니다.</div>' : "")
   + (rows.length ? `<table class="stack"><thead><tr><th>역할</th><th class="n">현재</th><th class="n">목표</th><th class="n">조정 후</th><th class="n">매매</th><th>어디서</th></tr></thead><tbody>${rows.sort((a, b) => a.trade - b.trade).map(x => `<tr><td>${esc(x.r.n)} ${x.out ? '<span class="tag o">이탈</span>' : ""}</td><td class="n">${(x.w * 100).toFixed(1)}%</td><td class="n">${(x.t * 100).toFixed(1)}%</td><td class="n">${(x.after * 100).toFixed(1)}%</td><td class="n ${x.trade > 0 ? "buy" : "sell"}"><b>${x.trade > 0 ? "매수" : "매도"} ${won(Math.abs(x.trade))}</b></td><td>${where(x.r.k, x.trade < 0)}</td></tr>`).join("")}</tbody></table><p class="note">매매 금액은 1만원 단위로 반올림했습니다. 매도 위치는 과세이연 계좌(ISA·연금·IRP)를 먼저 제안합니다.</p>` : '<p class="note">조정할 금액이 없습니다.</p>');
}
function renderChecks(c){
  const o = [], rh = A().filter(h => h.acct === "IRP" || h.acct === "DC/DB");
  if (rh.length) { const tv = rh.reduce((a, h) => a + h.value, 0), rv = rh.filter(h => SET.RISKY_ROLES.includes(h.role)).reduce((a, h) => a + h.value, 0), r = tv ? rv / tv : 0, L = SET.RISK_LIMIT / 100;
    o.push(`<div class="${r > L ? "warn" : ""}" style="margin:8px 0"><b>IRP·DC 위험자산 한도</b>: 위험자산 ${(r * 100).toFixed(0)}% / 한도 ${SET.RISK_LIMIT}% ${r > L ? "— 초과" : "— 정상"}<div class="note">settings.js의 RISKY_ROLES 역할을 위험자산으로 본 근사 판정입니다. 실제 분류는 상품마다 다릅니다.</div></div>`); }
  const sat = +S.targets.sat || 0;
  o.push(`<div style="margin:8px 0"><b>코어 · 위성</b>: 목표 코어 ${100 - sat}% · 위성 ${sat}% / 현재 위성 ${(c.T.v ? (c.R.sat ? c.R.sat.v : 0) / c.T.v * 100 : 0).toFixed(1)}%${sat > 30 ? ' <span class="tag o">위성 30% 초과</span>' : ""}</div>`);
  securities().filter(g => c.T.v && g.value / c.T.v > .25).forEach(g => o.push(`<div class="warn">단일 종목 쏠림: ${esc(g.name)}이 전체의 ${(g.value / c.T.v * 100).toFixed(0)}%입니다${g.rows.length > 1 ? ` (${g.rows.length}개 계좌 합계)` : ""}.</div>`));
  const cv = c.R.cash ? c.R.cash.v : 0;
  o.push(`<div style="margin:8px 0"><b>유동성</b>: ${short(cv)} (${(c.T.v ? cv / c.T.v * 100 : 0).toFixed(1)}%) — 가까운 지출(통상 3~6개월 생활비)을 덮는지 확인하세요.</div>`);
  $("checks").innerHTML = o.join("");
}

/* ---------- 화면: 보유자산 ---------- */
function group(fn, list){ const m = {}; (list || A()).forEach(h => { const k = fn(h) || "(미입력)"; (m[k] = m[k] || { v: 0, c: 0 }); m[k].v += h.value; m[k].c += h.cost; }); return Object.entries(m).sort((a, b) => b[1].v - a[1].v); }
function gtable(entries, T, role){
  if (!entries.length) return '<p class="note">자산이 없습니다.</p>';
  return `<table class="stack"><thead><tr><th>구분</th><th class="n">평가액</th><th>비중</th><th class="n">수익률</th></tr></thead><tbody>${entries.map(([k, x]) => { const w = T ? x.v / T : 0, r = x.c ? (x.v - x.c) / x.c : 0;
    return `<tr><td>${esc(role ? RM[k].n : k)}</td><td class="n">${short(x.v)}</td><td><div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${w * 100}%;background:${role ? RM[k].c : "var(--ink)"}"></i></div><span class="note" style="width:3.5em;text-align:right">${(w * 100).toFixed(1)}%</span></div></td><td class="n ${cls(r)}">${pct(r)}</td></tr>`; }).join("")}</tbody></table>`;
}
function renderHoldings(){
  const f = fval();
  const order = [], gm = new Map(); S.holdings.forEach((h, i) => { const k = acctKey(h); if (!gm.has(k)) { gm.set(k, []); order.push(k); } gm.get(k).push(i); });
  const vis = order.filter(k => gm.get(k).some(i => inFilter(S.holdings[i], f))), fold = vis.length > 1, o = offSet(), pm = prinMap();
  const row = (h, i, hid) => { const au = isAuto(h);
    const px = isCash(h) ? `<div class="px">외화 현금 ${esc(h.cur)} · 1달러 ${Math.round(fxOf(h.cur)).toLocaleString("ko-KR") || "?"}원</div>` : h.code ? (h.perr ? '<div class="px err">시세 없음 · 직접 입력</div>' : h.fxerr ? `<div class="px err">${esc(h.cur)} 환율 없음 · 위에서 직접 입력</div>` : h.price && !(h.qty > 0) ? '<div class="px err">수량을 넣어 주세요</div>' : h.price ? `<div class="px">현재가 ${h.price.toLocaleString("ko-KR", { maximumFractionDigits: h.cur === "KRW" ? 0 : 2 })} ${esc(h.cur)}</div>` : '<div class="px">시세 갱신 대기</div>') : "";
    return `<tr data-i="${i}" data-g="${esc(acctKey(h))}" class="${isOff(h, o) ? "off" : ""}" ${hid ? "hidden" : ""}><td><input data-k="inst" list="insts" value="${esc(h.inst)}" aria-label="증권사"></td><td><select data-k="acct" aria-label="계좌">${ACCTS.map(a => `<option${a === h.acct ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></td><td><div class="nmc">${logo(h.code, h.name, h.role)}<input data-k="name" list="secs" value="${esc(h.name)}" aria-label="상품명" placeholder="${h.code ? "시세 갱신 때 자동 입력" : "종목명 또는 종목코드 입력"}"></div></td><td><input data-k="code" value="${esc(h.code)}" placeholder="없음" aria-label="종목코드" autocapitalize="characters"></td><td><select data-k="role" aria-label="역할">${ROLES.map(x => `<option value="${x.k}"${x.k === h.role ? " selected" : ""}>${esc(x.n)}</option>`).join("")}</select></td><td><input class="n" data-k="qty" type="number" min="0" step="any" value="${h.qty || ""}" aria-label="수량"></td><td><input class="n" data-k="cost" type="number" min="0" step="10000" value="${h.cost}" aria-label="투자원금"></td><td><input class="n" data-k="value" type="number" min="0" step="10000" value="${Math.round(h.value)}" aria-label="평가금액" ${au ? 'readonly title="수량 × 현재가로 자동 계산"' : ""}>${px}</td><td class="n ${cls(ret(h))}" id="r-${h.id}">${pct(ret(h))}</td><td><button class="x" data-del="${i}" aria-label="삭제">✕</button></td></tr>`; };
  $("hbody").innerHTML = order.map(k => { const ix = gm.get(k).filter(i => inFilter(S.holdings[i], f)); if (!ix.length) return ""; const shut = fold && grpClosed.has(k), [gi, ga] = k.split("|");
    return (fold ? `<tr class="grp${shut ? "" : " open"}${o.has(k) ? " isoff" : ""}" data-gk="${esc(k)}"><td colspan="6"><button class="x tog" aria-expanded="${!shut}">${shut ? "▸" : "▾"}</button>${swHTML([k], !o.has(k), gi + " " + ga)}<b>${esc(gi)}</b> <span class="gacct">${esc(ga)}</span> <span class="note">${ix.length}개 자산 · 원금 ${short(pm[k] || 0)} · 예수금 ${short(cashBal(k, "KRW"))}${cashBal(k, "USD") ? " + $" + cashBal(k, "USD").toLocaleString() : ""}</span>${o.has(k) ? '<span class="tag o offtag">분석 제외</span>' : ""}</td><td class="n gc"></td><td class="n gv"></td><td class="n gr2"></td><td></td></tr>` : "")
      + ix.map(i => row(S.holdings[i], i, shut)).join(""); }).join("")
    || '<tr><td colspan="10" class="note">아직 자산이 없습니다. ‘Numbers·엑셀 불러오기’ 또는 ‘+ 자산 추가’로 시작하세요.</td></tr>';
  renderHFoot(); updFold(); if (hView === "sec") renderSecView();
}
let hView = "acct", secOpen = new Set();
/* 접기·펼치기: 계좌 묶음(저장), 긴 표(더 보기) */
let grpClosed = new Set(); try { grpClosed = new Set(JSON.parse(localStorage.getItem("jasan_fold") || "[]")); } catch (e) {}
const saveFold = () => { try { localStorage.setItem("jasan_fold", JSON.stringify([...grpClosed])); } catch (e) {} };
function updFold(){ const b = $("foldAll"); if (!b) return;
  if (hView === "sec") { const multi = securities(A().filter(h => inFilter(h))).filter(g => g.rows.length > 1); b.hidden = !multi.length; b.textContent = secOpen.size ? "모두 접기" : "모두 펼치기"; return; }
  const gs = [...document.querySelectorAll("#hbody tr.grp")]; b.hidden = gs.length < 2; b.textContent = gs.some(g => g.classList.contains("open")) ? "모두 접기" : "모두 펼치기"; }
const clipOpen = new Set();
function clip(id, n = 8){ const host = $(id), tb = host && host.querySelector("tbody"); if (!tb) return; host.querySelector(":scope > .more")?.remove();
  const rows = [...tb.rows]; if (rows.length <= n + 2) return; const open = clipOpen.has(id);
  rows.forEach((r, i) => { if (i >= n) r.hidden = !open; });
  const b = document.createElement("button"); b.className = "more"; b.type = "button"; b.setAttribute("aria-expanded", open);
  b.innerHTML = open ? "접기 <span>▴</span>" : `나머지 ${rows.length - n}개 펼치기 <span>▾</span>`;
  b.onclick = () => { open ? clipOpen.delete(id) : clipOpen.add(id); clip(id, n); }; host.appendChild(b); }
/* 보기 범위: 전체 / 증권사(i:) / 계좌(a:증권사|계좌유형) / 계좌 유형(t:) */
const fval = () => $("instFilter").value;
const acctKey = h => (h.inst || "기관 미입력") + "|" + h.acct;
function inFilter(h, f){ f = f == null ? fval() : f; if (!f) return true; const [t, v] = [f.slice(0, 2), f.slice(2)];
  return t === "i:" ? (h.inst || "기관 미입력") === v : t === "a:" ? acctKey(h) === v : t === "t:" ? h.acct === v : true; }
function filterLabel(f){ f = f == null ? fval() : f; if (!f) return "전체"; const v = f.slice(2); return f.startsWith("a:") ? v.replace("|", " · ") : f.startsWith("t:") ? v + " 전체" : v; }
function renderSecView(){
  const list = securities(A().filter(h => inFilter(h))), T = list.reduce((a, g) => a + g.value, 0);
  $("secBody").innerHTML = list.map(g => { const r = g.cost ? (g.value - g.cost) / g.cost : 0, avg = g.qty > 0 ? g.cost / g.qty : 0, open = secOpen.has(g.key), multi = g.rows.length > 1;
    const accts = g.rows.map(h => `${esc(h.inst || "기관 미입력")} ${esc(h.acct)}`).join(" · ");
    return `<tr class="srow${open ? " open" : ""}" data-key="${esc(g.key)}"><td><button class="x tog" aria-expanded="${open}" title="계좌별 내역">${multi ? (open ? "▾" : "▸") : "·"}</button></td><td><div class="nmc">${logo(g.code, g.name, g.role)}<div><b>${esc(g.name || "(이름 없음)")}</b><div class="note">${g.rows.length}개 계좌 · ${accts}</div></div></div></td><td>${esc(g.code ? g.code.replace(/^[A-Z]+:/, "") : "")}</td><td>${esc(RM[g.role].n)}</td><td class="n">${g.qty ? (+g.qty.toFixed(4)).toLocaleString("ko-KR") : ""}</td><td class="n">${avg ? Math.round(avg).toLocaleString("ko-KR") : ""}</td><td class="n">${g.price ? g.price.toLocaleString("ko-KR", { maximumFractionDigits: g.cur === "KRW" ? 0 : 2 }) + " " + esc(g.cur) : ""}</td><td class="n">${won(g.cost)}</td><td class="n"><b>${won(g.value)}</b></td><td class="n">${T ? (g.value / T * 100).toFixed(1) + "%" : ""}</td><td class="n ${cls(r)}">${pct(r)}</td><td><button class="x" data-addsec="${esc(g.key)}" title="이 종목을 다른 증권사·계좌에 추가" style="white-space:nowrap">+ 계좌</button></td></tr>`
      + (open ? g.rows.map(h => `<tr class="sub"><td></td><td colspan="3">${esc(h.inst || "기관 미입력")} · ${esc(h.acct)}</td><td class="n">${h.qty ? (+h.qty).toLocaleString("ko-KR") : ""}</td><td class="n">${h.qty > 0 ? Math.round(h.cost / h.qty).toLocaleString("ko-KR") : ""}</td><td></td><td class="n">${won(h.cost)}</td><td class="n">${won(h.value)}</td><td class="n">${g.value ? (h.value / g.value * 100).toFixed(0) + "%" : ""}</td><td class="n ${cls(ret(h))}">${pct(ret(h))}</td><td></td></tr>`).join("") : ""); }).join("")
    || '<tr><td colspan="12" class="note">자산이 없습니다.</td></tr>';
  const C = list.reduce((a, g) => a + g.cost, 0);
  $("secFoot").innerHTML = `<tr><th></th><th colspan="6">${list.length}개 종목 합계</th><th class="n">${won(C)}</th><th class="n">${won(T)}</th><th class="n">100%</th><th class="n ${cls(T - C)}">${pct(C ? (T - C) / C : 0)}</th><th></th></tr>`;
}
function setHView(v){ hView = v; segSet("hView", v); $("acctPanel").hidden = v !== "acct"; $("secPanel").hidden = v !== "sec"; if (v === "sec") renderSecView(); updFold(); }
$("hView").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setHView(b.dataset.v); });
$("secBody").addEventListener("click", e => {
  const add = e.target.closest("[data-addsec]");
  if (add) { const g = securities().find(x => x.key === add.dataset.addsec); if (!g) return; const o = g.rows[0];
    S.holdings.push({ id: uid(), inst: "", acct: ACCTS[0], name: o.name, role: o.role, cost: 0, value: 0, code: g.code || "", qty: 0, price: g.price || 0, cur: g.cur || "", perr: false });
    touch(); setHView("acct"); renderHoldings(); renderLive(); focusRow(S.holdings.length - 1); toast(`‘${o.name}’ 줄을 추가했습니다. 증권사·계좌와 수량, 원금을 넣으세요`); return; }
  const tr = e.target.closest("tr.srow"); if (!tr) return; const k = tr.dataset.key; secOpen.has(k) ? secOpen.delete(k) : secOpen.add(k); renderSecView(); updFold();
});
function renderGrpSums(){ document.querySelectorAll("#hbody tr.grp").forEach(tr => { const L = S.holdings.filter(h => acctKey(h) === tr.dataset.gk && inFilter(h)), v = L.reduce((a, h) => a + h.value, 0), c = L.reduce((a, h) => a + h.cost, 0);
  tr.querySelector(".gc").textContent = won(c); tr.querySelector(".gv").innerHTML = `<b>${won(v)}</b>`; const r = tr.querySelector(".gr2"); r.textContent = pct(c ? (v - c) / c : 0); r.className = "n gr2 " + cls(v - c); }); }
function renderHFoot(){ renderGrpSums(); const L = A().filter(h => inFilter(h)), v = L.reduce((a, h) => a + h.value, 0), c = L.reduce((a, h) => a + h.cost, 0); $("hfoot").innerHTML = `<tr><th colspan="6">${fval() ? esc(filterLabel()) + " 합계 (" + L.length + "개)" : "합계"}${offSet().size ? " · 꺼진 계좌 제외" : ""}</th><th class="n">${won(c)}</th><th class="n">${won(v)}</th><th class="n ${cls(v - c)}">${pct(c ? (v - c) / c : 0)}</th><th></th></tr>`; }
function renderInstFilter(){
  const cur = fval(), list = [...new Set(S.holdings.map(h => h.inst).filter(Boolean))];
  const opt = (v, t) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(t)}</option>`;
  const insts = [...new Set(S.holdings.map(h => h.inst || "기관 미입력"))], types = ACCTS.filter(a => S.holdings.some(h => h.acct === a));
  $("instFilter").innerHTML = opt("", "전체 계좌") + insts.map(i => { const accts = [...new Set(S.holdings.filter(h => (h.inst || "기관 미입력") === i).map(h => h.acct))];
      return `<optgroup label="${esc(i)}">${opt("i:" + i, i + " 전체")}${accts.map(a => opt("a:" + i + "|" + a, i + " · " + a)).join("")}</optgroup>`; }).join("")
    + (types.length > 1 ? `<optgroup label="계좌 유형">${types.map(t => opt("t:" + t, t + " 전체")).join("")}</optgroup>` : "");
  if (cur && ![...$("instFilter").options].some(o => o.value === cur)) $("instFilter").value = "";
  $("insts").innerHTML = [...new Set([...SET.INSTITUTIONS, ...list])].map(x => `<option value="${esc(x)}">`).join("");
  $("secs").innerHTML = securities().filter(g => g.name && !/^예수금\(/.test(g.name)).map(g => `<option value="${esc(g.name)}">${esc(g.code ? g.code.replace(/^[A-Z]+:/, "") : "")} · ${esc(RM[g.role].n)} · ${g.rows.length}개 계좌</option>`).join("");
}

/* ---------- 화면: 수익 분석 ---------- */
// 시간가중수익률(수정 디츠): 계좌에 남긴 배당은 외부 입금이 아니므로 입금액에서 빼고, 인출한 배당은 수익에 더함
function twr(p){ let g = 1; const ds = (x, f) => AD().filter(d => (x.now || d.d <= x.d) && f(d)).reduce((a, d) => a + d.amt, 0);
  const pe = x => x.pp || x.now ? x.c : x.c - ds(x, divIn), dx = x => ds(x, d => !divIn(d)); // pe: 시점별 순수 원금(예전 기록은 원가에서 배당을 뺌)
  for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], cf = pe(b) - pe(a), den = a.v + cf / 2; if (den > 0) g *= 1 + (b.v - a.v - cf + dx(b) - dx(a)) / den; } return g - 1; }
function renderReturns(c){
  const pts = SN().sort((a, b) => a.d.localeCompare(b.d)); if (A().length) pts.push({ d: "지금", v: c.T.v, c: c.T.p, now: 1 });
  const g = c.T.U, tw = pts.length > 1 ? twr(pts) : null; let ann = null;
  if (tw != null && pts.length > 1) { const days = (Date.parse(today()) - Date.parse(pts[0].d)) / 864e5; if (days >= 180) ann = Math.pow(1 + tw, 365 / days) - 1; }
  const best = securities().filter(g => g.cost).map(g => ({ name: g.name, cost: g.cost, value: g.value })).sort((a, b) => ret(b) - ret(a))[0];
  const D = divSum();
  $("rkpis").innerHTML = `<div class="kpi"><span>총수익률(원금 대비)</span><b class="${cls(c.T.P)}">${pct(c.T.p ? c.T.P / c.T.p : 0)}</b><span>미실현 ${short(g)} · 실현 ${short(c.T.Rz)} · 배당 ${short(D)}</span></div>
  <div class="kpi"><span>기간 시간가중수익률</span><b class="${cls(tw || 0)}">${tw == null ? "—" : pct(tw)}</b><span>${pts.length > 1 ? pts[0].d + " 이후" : "기록이 2개 이상 필요"}</span></div>
  <div class="kpi"><span>연환산</span><b class="${cls(ann || 0)}">${ann == null ? "—" : pct(ann)}</b><span>${ann == null ? "180일 이상 기록 시 표시" : "시간가중 기준"}</span></div>
  <div class="kpi"><span>최고 수익 상품</span><b class="${best ? cls(ret(best)) : ""}">${best && best.cost ? pct(ret(best)) : "—"}</b><span>${best ? esc(best.name) : ""}</span></div>`;
  lineDraw.pts = pts; lineDraw(); renderDivs(c);
  $("snapList").innerHTML = S.snaps.length ? '<span class="note">기록:</span>' + [...S.snaps].sort((a, b) => a.d.localeCompare(b.d)).map(s => `<span class="tag" style="padding:4px 4px 4px 8px">${s.d} ${short(s.v)} <button class="x" data-snapdel="${s.d}" aria-label="${s.d} 기록 삭제" style="min-height:24px;padding:0 6px">✕</button></span>`).join("") : "";
  const T = c.T.v, C = 2 * Math.PI * 70; let a = 0, arcs = "";
  ROLES.forEach(r => { const w = T ? c.R[r.k].v / T : 0; if (w > 0) { arcs += `<circle r="70" cx="100" cy="100" fill="none" stroke="${r.c}" stroke-width="34" stroke-dasharray="${w * C} ${C}" stroke-dashoffset="${-a * C}" transform="rotate(-90 100 100)"/>`; a += w; } });
  $("donut").innerHTML = `<circle r="70" cx="100" cy="100" fill="none" stroke="var(--band)" stroke-width="34"/>${arcs}<text x="100" y="96" text-anchor="middle" font-size="13" fill="var(--mute)">총 평가액</text><text x="100" y="117" text-anchor="middle" font-size="20" font-weight="700" fill="var(--ink)">${short(T)}</text>`;
  $("donutLeg").innerHTML = ROLES.map(r => `<div><span class="sw" style="background:${r.c}"></span><span style="flex:1">${esc(r.n)}</span><b>${(T ? c.R[r.k].v / T * 100 : 0).toFixed(1)}%</b></div>`).join("");
  $("byRoleRet").innerHTML = gtable(group(h => h.role), T, true);
  $("byItem").innerHTML = S.holdings.length ? `<table class="stack"><thead><tr><th>종목</th><th>보유 계좌</th><th class="n">원금</th><th class="n">평가액</th><th class="n">손익</th><th class="n">수익률</th></tr></thead><tbody>${securities().sort((x, y) => (y.cost ? (y.value - y.cost) / y.cost : 0) - (x.cost ? (x.value - x.cost) / x.cost : 0)).map(g => { const d = g.value - g.cost; return `<tr><td><div class="nmc">${logo(g.code, g.name, g.role)}<span>${esc(g.name)}</span></div></td><td>${g.rows.length > 1 ? g.rows.length + "개 계좌 · " : ""}${esc([...new Set(g.rows.map(h => h.inst))].join(", "))}</td><td class="n">${short(g.cost)}</td><td class="n">${short(g.value)}</td><td class="n ${cls(d)}">${short(d)}</td><td class="n ${cls(d)}">${pct(g.cost ? d / g.cost : 0)}</td></tr>`; }).join("")}</tbody></table>` : '<p class="note">자산이 없습니다.</p>'; clip("byItem");
}
function renderDivs(c){
  const t = today(), y = t.slice(0, 4), y1 = new Date(); y1.setFullYear(y1.getFullYear() - 1);
  const from12 = y1.getFullYear() + "-" + String(y1.getMonth() + 1).padStart(2, "0") + "-" + String(y1.getDate()).padStart(2, "0");
  const ytd = AD().filter(d => d.d.startsWith(y)).reduce((a, d) => a + d.amt, 0), d12 = AD().filter(d => d.d > from12).reduce((a, d) => a + d.amt, 0), all = divSum();
  $("divKpis").innerHTML = `<div class="kpi"><span>올해 받은 배당·이자</span><b>${short(ytd)}</b><span>${y}년</span></div><div class="kpi"><span>최근 12개월</span><b>${short(d12)}</b><span>월평균 ${short(d12 / 12)}</span></div><div class="kpi"><span>12개월 배당수익률</span><b>${c.T.v ? (d12 / c.T.v * 100).toFixed(2) + "%" : "—"}</b><span>최근 12개월 ÷ 현재 평가액</span></div><div class="kpi"><span>누적 배당·이자</span><b>${short(all)}</b><span>${S.divs.length}건 기록</span></div>`;
  drawDivChart();
  $("divList").innerHTML = S.divs.length ? `<table class="stack dtab"><thead><tr><th>받은 날</th><th>자산</th><th class="n">금액</th><th class="n">원화 환산</th><th>처리</th><th></th></tr></thead><tbody>${S.divs.slice().sort((a, b) => b.d.localeCompare(a.d)).map(d => `<tr class="${divEdit === d.id ? "editing" : ""}"><td>${d.d}</td><td>${esc(d.name)}</td><td class="n">${d.cur === "USD" ? "$" + (+d.amtCur).toLocaleString("en-US", { maximumFractionDigits: 2 }) : won(d.amt)}</td><td class="n">${d.cur === "USD" ? won(d.amt) + `<div class="note">@${(+d.fx).toLocaleString("ko-KR")}</div>` : ""}</td><td>${d.how === "dep" ? "계좌 현금으로" : "인출"}</td><td class="acts"><button class="x" data-divact="edit" data-id="${d.id}">수정</button><button class="x" data-divact="copy" data-id="${d.id}" title="같은 내용으로 새로 기록">복사</button><button class="x" data-divact="del" data-id="${d.id}" aria-label="삭제">삭제</button></td></tr>`).join("")}</tbody></table>` : '<p class="note">아직 기록이 없습니다.</p>'; clip("divList", 6);
  const sel = $("dvHold"), cur = sel.value; sel.innerHTML = S.holdings.filter(h => !/^예수금\(/.test(h.name)).map(h => `<option value="${h.id}"${h.id === cur ? " selected" : ""}>${esc(h.name || "이름 없음")} · ${esc(h.inst)} ${esc(h.acct)}</option>`).join("") || '<option value="">자산을 먼저 입력하세요</option>';
  if (!$("dvDate").value) $("dvDate").value = t; if (!divEdit) dvHint();
}
/* 최근 12개월 월별 배당·이자: 막대 + 3개월 평균선 + 전월 대비 */
function chgChip(cur, prev){ if (!prev && !cur) return '<span class="chg eq">—</span>'; if (!prev) return '<span class="chg nw">신규</span>';
  const r = (cur - prev) / prev * 100, t = Math.abs(r) >= 999 ? "999+" : Math.abs(r) >= 100 ? Math.round(Math.abs(r)) : Math.abs(r).toFixed(Math.abs(r) < 10 ? 1 : 0);
  return Math.abs(r) < 0.5 ? '<span class="chg eq">0<em class="pc">%</em></span>' : `<span class="chg ${r > 0 ? "up" : "dn"}">${r > 0 ? "▲" : "▼"}${t}<em class="pc">%</em></span>`; }
function niceMax(v){ if (v <= 0) return 40000; const st = v / 4, e = Math.pow(10, Math.floor(Math.log10(st))), f = st / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e * 4; } // 4칸 눈금이 1·2·5 단위로 떨어지게
function drawDivChart(){
  const now = new Date(), ms = []; for (let k = 12; k >= 0; k--) { const m = new Date(now.getFullYear(), now.getMonth() - k, 1); ms.push(m.getFullYear() + "-" + String(m.getMonth() + 1).padStart(2, "0")); }
  const D = AD(), v13 = ms.map(m => D.filter(d => d.d.startsWith(m)).reduce((a, d) => a + d.amt, 0)), mv = v13.slice(1), months = ms.slice(1);
  const ma = mv.map((_, i) => { const a = v13.slice(Math.max(0, i - 1), i + 2); return a.reduce((x, y) => x + y, 0) / a.length; }); // 이번 달 포함 직전 3개월(창 앞 1개월 포함)
  if (!mv.some(Boolean)) { $("divBars").innerHTML = '<p class="note" style="padding:24px 0;text-align:center">최근 12개월에 기록된 배당·이자가 없습니다. 위에서 받은 배당·이자를 기록하면 월별 그래프가 그려집니다.</p>'; return; }
  const top = niceMax(Math.max(...mv, ...ma) * 1.05), P = v => v / top * 100, pk = mv.indexOf(Math.max(...mv));
  const s3 = mv.slice(9).reduce((a, b) => a + b, 0), p3 = mv.slice(6, 9).reduce((a, b) => a + b, 0);
  const card = (l, v, c, n) => `<div><span class="dl">${l}</span><div class="dval"><b>${v}</b>${c}</div><span class="dn">${n}</span></div>`;
  const sum = `<div class="dsum">${card(`이번 달 · ${+months[11].slice(5)}월 (진행 중)`, won(mv[11]), chgChip(mv[11], mv[10]), `지난달 ${won(mv[10])} 대비`)}${card("최근 3개월 합계", won(s3), chgChip(s3, p3), `직전 3개월 ${won(p3)} 대비`)}${card("전년 같은 달 대비", won(mv[11]), chgChip(mv[11], v13[0]), `${ms[0].slice(0, 4)}년 ${+ms[0].slice(5)}월 ${won(v13[0])}`)}</div>`;
  let grid = ""; for (let k = 0; k <= 4; k++) { const v = top * k / 4; grid += `<div class="dgrid${k ? "" : " z"}" style="bottom:${k * 25}%"><span>${k ? short(v) : "0"}</span></div>`; }
  const cols = mv.map((v, i) => `<div class="dcol${v ? "" : " zero"}${i === 11 ? " cur" : ""}${i === pk ? " peak" : ""}" title="${months[i]} · ${won(v)}${i ? " · 전월 대비 " + (mv[i - 1] ? ((v - mv[i - 1]) / mv[i - 1] * 100).toFixed(1) + "%" : "—") : ""} · 3개월 평균 ${won(Math.round(ma[i]))}"><i style="height:${P(v)}%"></i></div>`).join("");
  const pts = ma.map((v, i) => `${(i + .5) / 12 * 100},${100 - P(v)}`).join(" ");
  const dots = ma.map((v, i) => `<i class="dmadot" style="left:${(i + .5) / 12 * 100}%;top:${100 - P(v)}%"></i>`).join("");
  const xs = months.map((m, i) => `<div class="${i === 11 ? "cur" : ""}${i === pk ? " pk" : ""}" title="${m}"><span class="mo">${+m.slice(5)}<i>월</i></span><b>${v13[i + 1] ? short(mv[i]) : "—"}</b>${chgChip(mv[i], v13[i])}</div>`).join("");
  $("divBars").innerHTML = sum + `<div class="dplot">${grid}<div class="dcols">${cols}</div><svg class="dma" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>${dots}</div><div class="dx">${xs}</div>
    <div class="dleg"><span><i class="l1"></i>월 배당·이자</span><span><i class="l3"></i>이번 달(진행 중)</span><span><i class="l2"></i>3개월 평균 추세</span><span><span class="chg up">▲</span><span class="chg dn">▼</span>전월 대비 증감</span><span>막대에 마우스를 올리면 자세한 금액</span></div>`; }
const lineSvg = $("line");
function lineDraw(){
  const s = lineSvg, W = s.clientWidth, H = s.clientHeight, p = lineDraw.pts || []; if (!W || !H) return;
  if (p.length < 2) { s.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--mute)" font-size="14">‘오늘 상태 기록’을 눌러 추이를 쌓아 가세요</text>`; return; }
  const sm = W < 520, L = sm ? 8 : 62, R = sm ? 8 : 16, Tp = 16, B = 30, vals = p.flatMap(x => [x.v, x.c]), lo = Math.min(...vals) * .97, hi = Math.max(...vals) * 1.02;
  const X = i => L + (W - L - R) * i / (p.length - 1), Y = v => Tp + (H - Tp - B) * (1 - (v - lo) / (hi - lo || 1));
  let g = ""; if (!sm) for (let k = 0; k <= 3; k++) { const v = lo + (hi - lo) * k / 3; g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="var(--mute)">${short(v)}</text>`; }
  const step = Math.ceil(p.length / (sm ? 4 : 8));
  p.forEach((x, i) => { if (i % step === 0 || i === p.length - 1) g += `<text x="${X(i)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === p.length - 1 ? "end" : "middle"}" font-size="12" fill="var(--mute)">${x.now ? "지금" : x.d.slice(2).replace(/-/g, ".")}</text>`; });
  const path = k => p.map((x, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(x[k]).toFixed(1)).join(""), last = p[p.length - 1];
  const area = path("v") + `L${X(p.length - 1).toFixed(1)},${H - B}L${X(0).toFixed(1)},${H - B}Z`, ret = last.c ? (last.v - last.c) / last.c : 0, lx = X(p.length - 1), ly = Y(last.v);
  const pill = (ret >= 0 ? "+" : "−") + Math.abs(ret * 100).toFixed(1) + "%", pw = pill.length * 7.5 + 18;
  s.innerHTML = `<defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2f9e6e" stop-opacity=".22"/><stop offset="1" stop-color="#2f9e6e" stop-opacity="0"/></linearGradient></defs>` + g
    + `<path d="${area}" fill="url(#ga)"/><path d="${path("c")}" fill="none" stroke="var(--faint)" stroke-width="1.4" stroke-dasharray="4 4"/><path d="${path("v")}" fill="none" stroke="#2f9e6e" stroke-width="2.2" stroke-linejoin="round"/>`
    + `<circle cx="${lx}" cy="${ly}" r="4.5" fill="#2f9e6e" stroke="var(--panel)" stroke-width="2"/>`
    + `<rect x="${lx - pw}" y="${Math.max(2, ly - 34)}" width="${pw}" height="22" rx="6" fill="var(--ink)" opacity=".85"/><text x="${lx - pw / 2}" y="${Math.max(2, ly - 34) + 15}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--panel)">${pill}</text>`
    + (sm ? "" : `<text x="${L}" y="${Tp - 2}" font-size="11" fill="var(--faint)">— 평가액   - - 투자원금</text>`);
}
const lineRO = new ResizeObserver(() => lineDraw()); lineRO.observe(lineSvg);

/* ---------- 화면: 목표 비율 ---------- */
function renderTargets(){
  $("tgts").innerHTML = ROLES.map(r => `<div class="tgt"><div><span class="sw" style="background:${r.c};margin-right:8px"></span><b>${esc(r.n)}</b><div class="note">${esc(r.d)}</div></div><input type="number" min="0" max="100" step="0.5" data-t="${r.k}" value="${+S.targets[r.k] || 0}" aria-label="${esc(r.n)} 목표 비율"></div>`).join("");
  const p = presetParts(DEF); $("defName").textContent = p.age + "대 " + p.style + "형"; renderTSum();
}
function renderTSum(){
  const s = RK.reduce((a, k) => a + (+S.targets[k] || 0), 0), sat = +S.targets.sat || 0;
  $("tsum").innerHTML = `<span style="color:${Math.abs(s - 100) < .01 ? "var(--ink)" : "var(--acc)"}">${+s.toFixed(1)}%</span>`;
  $("coreSat").textContent = `코어 ${100 - sat}% · 위성 ${sat}% ` + (sat > 30 ? "— 책은 위성을 20~30% 안에서 제한할 것을 권합니다" : "(권장: 코어 70~80%, 위성 20~30% 이내)");
  segSet("age", S.age); segSet("style", S.style);
}
function segSet(id, v){ document.querySelectorAll("#" + id + " button").forEach(b => b.classList.toggle("on", b.dataset.v === String(v))); }

/* ---------- 전체 그리기 ---------- */
function renderAttr(c){
  const T = c.T.p || c.T.c || 1, rows = ROLES.filter(r => c.R[r.k].v || c.R[r.k].c).map(r => ({ n: r.n, v: (c.R[r.k].v - c.R[r.k].c) / T * 100 }));
  if (c.T.Rz) rows.push({ n: "실현손익(매도)", v: c.T.Rz / T * 100 }); const D = c.T.D; if (D) rows.push({ n: "배당·이자", v: D / T * 100 });
  if (!rows.length) { $("attr").innerHTML = '<p class="note">자산을 입력하면 보입니다.</p>'; return; }
  const mx = Math.max(0.5, ...rows.map(x => Math.abs(x.v)));
  $("attr").innerHTML = rows.sort((a, b) => b.v - a.v).map(x => { const w = Math.abs(x.v) / mx * 50;
    return `<div class="ar"><span>${esc(x.n)}</span><div class="tr"><i style="${x.v >= 0 ? "left:50%" : "right:50%"};width:${w}%;background:${x.v >= 0 ? "var(--up)" : "var(--down)"};opacity:.75"></i></div><b class="${cls(x.v)}">${x.v >= 0 ? "+" : "−"}${Math.abs(x.v).toFixed(1)}</b></div>`; }).join("");
}
function renderSide(c){
  const f = fval(), o = offSet(), ent = group(h => h.inst || "기관 미입력", S.holdings), T = c.T.v || 1, selInst = f.startsWith("i:") ? f.slice(2) : f.startsWith("a:") ? f.slice(2).split("|")[0] : "";
  $("sideInst").innerHTML = `<li><button data-inst="" class="${f ? "" : "on"}"><i></i><span>전체</span><em>${short(c.T.v)}</em></button></li>` + ent.map(([k, x]) => {
    const accts = selInst === k ? group(h => (h.inst || "기관 미입력") === k ? h.acct : null, S.holdings).filter(([a]) => a !== "(미입력)") : [], ks = [...new Set(S.holdings.filter(h => (h.inst || "기관 미입력") === k).map(acctKey))], allOff = ks.every(x => o.has(x)), onV = A().filter(h => (h.inst || "기관 미입력") === k).reduce((a, h) => a + h.value, 0);
    return `<li class="${allOff ? "isoff" : ""}"><button data-inst="i:${esc(k)}" class="${f === "i:" + k ? "on" : ""}"><i></i><span>${esc(k)}</span><em>${allOff ? "꺼짐" : (onV / T * 100).toFixed(0) + "%"}</em></button>${accts.length ? `<ul class="ilist sub">${accts.map(([a, y]) => `<li class="${o.has(k + "|" + a) ? "isoff" : ""}"><button data-inst="a:${esc(k)}|${esc(a)}" class="${f === "a:" + k + "|" + a ? "on" : ""}"><span>${esc(a)}</span><em>${short(y.v)}</em></button></li>`).join("")}</ul>` : ""}</li>`; }).join("");
  const at = S.pricedAt ? new Date(S.pricedAt) : new Date(); $("asOf").textContent = "기준 " + at.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: S.pricedAt ? "2-digit" : undefined, minute: S.pricedAt ? "2-digit" : undefined });
  const live = !!(token && S.pricedAt && Date.now() - S.pricedAt < REFRESH_MIN * 2 * 60e3); $("live").classList.toggle("on", live); $("liveTxt").textContent = live ? "Live" : token ? "연결됨" : "오프라인";
}
$("sideInst").addEventListener("click", e => { const b = e.target.closest("[data-inst]"); if (!b) return; const v = b.dataset.inst; renderInstFilter(); $("instFilter").value = v; renderHoldings(); renderLive(); if (v) location.hash = "holdings"; });
// 계좌별 합계 표(보유자산 탭 아래): 줄을 누르면 그 계좌만 보기
document.addEventListener("click", e => { if (e.target.closest(".tgl")) return; const r = e.target.closest("#byAcctFull tr[data-f]"); if (!r) return; renderInstFilter(); $("instFilter").value = r.dataset.f; renderHoldings(); renderLive(); window.scrollTo({ top: 0, behavior: "smooth" }); });
/* ---------- 분석 차트 ---------- */
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const UPC = "#e0484b", DNC = "#2f6fe4", ACC = "#2f9e6e";
const heat = (r, cap) => { const a = Math.min(1, Math.abs(r) / cap); return { bg: r > 0 ? rgba(UPC, .12 + .78 * a) : r < 0 ? rgba(DNC, .12 + .78 * a) : "var(--soft)", fg: a > .55 ? "#fff" : "var(--ink)" }; };
function mixPoints(c){ const pts = SN().filter(x => x.r).sort((a, b) => a.d.localeCompare(b.d)).map(x => ({ d: x.d, r: x.r }));
  if (A().length) { const now = { d: "지금", now: 1, r: Object.fromEntries(RK.map(k => [k, c.R[k].v])) }; if (pts.length && pts[pts.length - 1].d === today()) pts.pop(); pts.push(now); } return pts; }
function drawMix(){ const sv = $("chMix"), W = sv.clientWidth, H = sv.clientHeight, c = drawMix.c; if (!W || !c) return; const p = mixPoints(c);
  if (p.length < 2) { sv.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--mute)" font-size="13">기록이 2개 이상 쌓이면 비중 변화가 보입니다 (시세 갱신 때 자동 기록)</text>`; $("chMixLeg").innerHTML = ""; return; }
  const sm = W < 520, L = sm ? 30 : 40, R = 10, Tp = 8, B = 24, X = i => L + (W - L - R) * i / (p.length - 1), Y = f => Tp + (H - Tp - B) * (1 - f);
  const share = p.map(x => { const t = RK.reduce((a, k) => a + (+x.r[k] || 0), 0) || 1; return RK.map(k => (+x.r[k] || 0) / t); });
  let g = ""; [0, .25, .5, .75, 1].forEach(f => g += `<line x1="${L}" x2="${W - R}" y1="${Y(f)}" y2="${Y(f)}" stroke="var(--line)"/><text x="${L - 6}" y="${Y(f) + 4}" text-anchor="end" font-size="11" fill="var(--faint)">${f * 100}%</text>`);
  const base = p.map(() => 0); let polys = "";
  RK.forEach((k, j) => { const lo = base.slice(), hi = base.map((b, i) => b + share[i][j]); hi.forEach((v, i) => base[i] = v);
    if (hi.every((v, i) => v - lo[i] < 1e-6)) return;
    const top = hi.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`), bot = lo.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).reverse();
    polys += `<polygon points="${top.concat(bot).join(" ")}" fill="${RM[k].c}" fill-opacity=".88" stroke="var(--panel)" stroke-width=".8"><title>${esc(RM[k].n)} ${(share[share.length - 1][j] * 100).toFixed(1)}%</title></polygon>`; });
  const step = Math.ceil(p.length / (sm ? 4 : 7)); p.forEach((x, i) => { if (i % step === 0 || i === p.length - 1) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === p.length - 1 ? "end" : "middle"}" font-size="11" fill="var(--faint)">${x.now ? "지금" : x.d.slice(2).replace(/-/g, ".")}</text>`; });
  sv.innerHTML = g + polys;
  const a = share[0], z = share[share.length - 1];
  $("chMixLeg").innerHTML = RK.map((k, j) => !(a[j] || z[j]) ? "" : `<div><span class="sw" style="background:${RM[k].c}"></span><span style="flex:1">${esc(RM[k].n)}</span><b>${(z[j] * 100).toFixed(1)}%</b><em class="${cls(z[j] - a[j])}">${z[j] - a[j] >= 0 ? "+" : "−"}${Math.abs((z[j] - a[j]) * 100).toFixed(1)}%p</em></div>`).join(""); }
function squarify(items, x, y, w, h){ const out = []; let rest = items.slice();
  while (rest.length && w > 0 && h > 0) { const sh = Math.min(w, h), worst = row => { const s = row.reduce((a, b) => a + b.a, 0), mx = Math.max(...row.map(r => r.a)), mn = Math.min(...row.map(r => r.a)); return Math.max(sh * sh * mx / (s * s), (s * s) / (sh * sh * mn)); };
    let row = [rest[0]], i = 1; while (i < rest.length && worst(row.concat(rest[i])) <= worst(row)) { row.push(rest[i]); i++; }
    const s = row.reduce((a, b) => a + b.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; row.forEach(r => { const rh = r.a / cw; out.push(Object.assign({}, r, { x, y: cy, w: cw, h: rh })); cy += rh; }); x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; row.forEach(r => { const rw = r.a / rh; out.push(Object.assign({}, r, { x: cx, y, w: rw, h: rh })); cx += rw; }); y += rh; h -= rh; }
    rest = rest.slice(i); } return out; }
function drawTree(){ const el = $("chTree"), W = el.clientWidth, H = el.clientHeight; if (!W) return;
  const list = securities().filter(g => g.value > 0), T = list.reduce((a, g) => a + g.value, 0);
  if (!list.length) { el.innerHTML = '<p class="note" style="padding:20px">자산이 없습니다.</p>'; return; }
  const rects = squarify(list.map(g => ({ g, a: g.value / T * W * H })), 0, 0, W, H);
  el.innerHTML = rects.map(({ g, x, y, w, h }) => { const r = g.cost ? (g.value - g.cost) / g.cost : 0, c = heat(r, .3), big = w > 90 && h > 46, mid = w > 54 && h > 30;
    return `<div class="tm" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${c.bg};color:${c.fg}" title="${esc(g.name)} · ${won(g.value)} · ${pct(r)} · 비중 ${(g.value / T * 100).toFixed(1)}%">${mid ? `<b>${esc(g.name)}</b><span>${pct(r)}</span>${big ? `<em>${short(g.value)} · ${(g.value / T * 100).toFixed(1)}%</em>` : ""}` : ""}</div>`; }).join(""); }
function drawMatrix(c){ const T = c.T.v || 1, accts = group(h => acctKey(h)), roles = ROLES.filter(r => c.R[r.k].v > 0);
  if (!accts.length) { $("chMatrix").innerHTML = '<p class="note">자산이 없습니다.</p>'; return; }
  const cell = {}; A().forEach(h => { const k = acctKey(h) + "§" + h.role; cell[k] = (cell[k] || 0) + h.value; });
  const mx = Math.max(...Object.values(cell)) / T || 1;
  $("chMatrix").innerHTML = `<table class="hm"><thead><tr><th>계좌</th>${roles.map(r => `<th><span class="sw" style="background:${r.c}"></span>${esc(r.n)}</th>`).join("")}<th class="n">합계</th></tr></thead><tbody>${accts.map(([k, x]) => `<tr><td>${esc(k.replace("|", " · "))}</td>${roles.map(r => { const v = cell[k + "§" + r.k] || 0, f = v / T, a = f / mx; return `<td style="background:${v ? rgba(ACC, .1 + .8 * a) : "transparent"};color:${a > .55 ? "#fff" : "var(--ink)"}" title="${won(v)}">${v ? (f * 100).toFixed(1) : ""}</td>`; }).join("")}<td class="n"><b>${(x.v / T * 100).toFixed(1)}%</b></td></tr>`).join("")}</tbody><tfoot><tr><th>합계</th>${roles.map(r => `<th>${(c.R[r.k].v / T * 100).toFixed(1)}</th>`).join("")}<th class="n">100%</th></tr></tfoot></table>`; }
function drawMonths(){ const p = SN().sort((a, b) => a.d.localeCompare(b.d)), c = calc(); if (A().length) p.push({ d: today(), v: c.T.v, c: c.T.c, now: 1 });
  const me = {}; p.forEach(x => { me[x.d.slice(0, 7)] = x; }); const ks = Object.keys(me).sort();
  if (ks.length < 2) { $("chMonth").innerHTML = '<p class="note">두 달 이상 기록이 쌓이면 월별 수익률이 보입니다.</p>'; return; }
  const mr = {}; for (let i = 1; i < ks.length; i++) mr[ks[i]] = twr([me[ks[i - 1]], me[ks[i]]]);
  const years = [...new Set(ks.map(k => k.slice(0, 4)))];
  $("chMonth").innerHTML = `<table class="hm mh"><thead><tr><th></th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}월</th>`).join("")}<th class="n">연간</th></tr></thead><tbody>${years.map(y => { let g = 1, any = false;
    const tds = Array.from({ length: 12 }, (_, i) => { const k = y + "-" + String(i + 1).padStart(2, "0"), r = mr[k]; if (r == null) return "<td></td>"; any = true; g *= 1 + r; const h = heat(r, .08); return `<td style="background:${h.bg};color:${h.fg}" title="${k} ${pct(r, 2)}">${(r * 100).toFixed(1)}</td>`; }).join("");
    const yr = g - 1, yh = heat(yr, .2); return `<tr><td><b>${y}</b></td>${tds}<td class="n" style="background:${any ? yh.bg : "transparent"};color:${any ? yh.fg : "inherit"}"><b>${any ? (yr * 100).toFixed(1) : ""}</b></td></tr>`; }).join("")}</tbody></table>`; }
function drawRing(c){ const T = c.T.v || 1, C1 = 2 * Math.PI * 92, C2 = 2 * Math.PI * 64; let a1 = 0, a2 = 0, s1 = "", s2 = "";
  ROLES.forEach(r => { const w = c.R[r.k].v / T, t = (+S.targets[r.k] || 0) / 100;
    if (w > 0) { s1 += `<circle r="92" cx="120" cy="120" fill="none" stroke="${r.c}" stroke-width="24" stroke-dasharray="${w * C1} ${C1}" stroke-dashoffset="${-a1 * C1}" transform="rotate(-90 120 120)"><title>${esc(r.n)} 현재 ${(w * 100).toFixed(1)}%</title></circle>`; a1 += w; }
    if (t > 0) { s2 += `<circle r="64" cx="120" cy="120" fill="none" stroke="${r.c}" stroke-opacity=".55" stroke-width="18" stroke-dasharray="${t * C2} ${C2}" stroke-dashoffset="${-a2 * C2}" transform="rotate(-90 120 120)"><title>${esc(r.n)} 목표 ${(t * 100).toFixed(1)}%</title></circle>`; a2 += t; } });
  $("chRing").innerHTML = s1 + s2 + `<text x="120" y="114" text-anchor="middle" font-size="11" fill="var(--faint)">바깥 현재</text><text x="120" y="132" text-anchor="middle" font-size="11" fill="var(--faint)">안쪽 목표</text>`;
  $("chRingLeg").innerHTML = `<div class="rl h"><span></span><span>현재</span><span>목표</span><span>차이</span></div>` + c.rows.map(x => `<div class="rl"><span><span class="sw" style="background:${x.r.c}"></span> ${esc(x.r.n)}</span><span>${(x.w * 100).toFixed(1)}%</span><span>${(x.t * 100).toFixed(1)}%</span><b class="${x.out ? "o" : ""}">${x.d >= 0 ? "+" : "−"}${Math.abs(x.d).toFixed(1)}</b></div>`).join(""); }
function renderCharts(c){ if (!$("v-charts").classList.contains("on")) return; drawMix.c = c; drawMix(); drawTree(); drawMatrix(c); drawMonths(); drawRing(c); }
const chRO = new ResizeObserver(() => { if ($("v-charts").classList.contains("on")) { drawMix(); drawTree(); } }); chRO.observe($("chMix")); chRO.observe($("chTree"));
function renderLive(){ const c = calc(); renderTop(c); priceStatus(); renderAttr(c); renderSide(c); renderCharts(c); renderGauge(c); renderPlan(c); renderChecks(c); $("byInst").innerHTML = gtable(group(h => h.inst), c.T.v); $("byAcct").innerHTML = gtable(group(h => h.acct), c.T.v);
  const ag = group(h => acctKey(h), S.holdings), T = c.T.v, o = offSet();
  $("byAcctFull").innerHTML = ag.length ? `<table class="stack"><thead><tr><th>분석</th><th>증권사</th><th>계좌</th><th class="n">종목 수</th><th class="n">투자원금</th><th class="n">평가금액</th><th>비중</th><th class="n">수익률</th></tr></thead><tbody>${ag.map(([k, x]) => { const [i, a] = k.split("|"), n = S.holdings.filter(h => acctKey(h) === k).length, off = o.has(k), w = T && !off ? x.v / T : 0, r = x.c ? (x.v - x.c) / x.c : 0;
    return `<tr data-f="a:${esc(k)}" style="cursor:pointer" class="${fval() === "a:" + k ? "editing" : ""}${off ? " isoff" : ""}"><td>${swHTML([k], !off, i + " " + a)}</td><td>${esc(i)}</td><td>${esc(a)}</td><td class="n">${n}</td><td class="n">${short(x.c)}</td><td class="n">${short(x.v)}</td><td><div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar" style="flex:1"><i style="width:${w * 100}%;background:var(--acc)"></i></div><span class="note" style="width:3.5em;text-align:right">${off ? "제외" : (w * 100).toFixed(1) + "%"}</span></div></td><td class="n ${cls(r)}">${pct(r)}</td></tr>`; }).join("")}</tbody></table>` : '<p class="note">자산이 없습니다.</p>'; renderReturns(c); renderHFoot(); clip("byAcctFull"); renderOff(); }
/* ---------- 거래 입력 화면 ---------- */
let txT = "buy";
const txKeys = () => [...new Set(S.holdings.map(acctKey))].filter(k => !k.startsWith("기관 미입력|") || S.holdings.some(h => acctKey(h) === k && (h.value || h.cost)));
function txFind(key, txt){ const v = String(txt || "").trim(); if (!v) return { h: null, probe: null };
  const byName = secMap(), asCode = /^[0-9A-Z]{6}$/.test(v) || /^[A-Z]{1,5}([.\-][A-Z])?$/.test(v) || /:/.test(v);
  const probe = { id: "probe", name: asCode ? "" : v, code: asCode ? normCode(v) : (byName[nameKey(v)] ? (S.holdings.find(x => x.code && codeBase(x.code) === byName[nameKey(v)]) || {}).code || "" : "") };
  const k = secKey(probe, byName), h = S.holdings.find(x => acctKey(x) === key && !isKcash(x) && x.code !== "CASH:USD" && secKey(x, byName) === k), any = S.holdings.find(x => secKey(x, byName) === k && !isKcash(x));
  return { h, any, probe }; }
function txCalc(){ // 입력값으로 이번 거래를 계산(기록 전 미리보기와 기록에 같이 씀)
  const key = $("txAcct").value, q = +$("txQty").value || 0, px = +$("txPrice").value || 0, fee = +$("txFee").value || 0, amtIn = +$("txAmt").value || 0, payCur = $("txCur").value, fxU = fxOf("USD") || 0;
  const r = { key, ok: false, msg: "", t: txT, payCur };
  if (!key) { r.msg = "계좌를 고르세요"; return r; }
  if (txT === "in" || txT === "out") { if (!amtIn) { r.msg = "금액을 넣으세요"; return r; }
    if (payCur === "USD" && !fxU) { r.msg = "환율이 없어 달러 입출금을 계산할 수 없습니다"; return r; }
    r.amtC = amtIn; r.amt = payCur === "USD" ? Math.round(amtIn * fxU) : amtIn; r.bal = cashBal(key, payCur);
    if (txT === "out" && amtIn > r.bal + 1e-6) { r.msg = `예수금(${payCur === "USD" ? "$" + r.bal.toLocaleString() : won(r.bal)})보다 많이 출금할 수 없습니다`; return r; }
    r.ok = true; return r; }
  if (txT === "buy") { const f = txFind(key, $("txSec").value); r.h = f.h; r.any = f.any; r.probe = f.probe; if (!f.probe) { r.msg = "종목을 넣으세요"; return r; }
    const code = (f.h || f.any || f.probe).code, cur = hCur(code), fx = fxOf(cur) || 0; r.code = code; r.cur = cur; r.mode = code ? "qty" : "amt";
    if (r.mode === "qty") { if (!q || !px) { r.msg = "수량과 단가를 넣으세요"; return r; } if (cur && cur !== "KRW" && !fx) { r.msg = "환율이 없어 계산할 수 없습니다"; return r; } r.q = q; r.px = px; r.gross = Math.round(q * px * (fx || 1)); }
    else { if (!amtIn) { r.msg = "금액을 넣으세요"; return r; } r.q = 0; r.gross = Math.round(amtIn); }
    r.amt = r.gross + fee; r.amtC = payCur === "USD" ? +(r.amt / fxU).toFixed(2) : r.amt; if (payCur === "USD" && !fxU) { r.msg = "환율이 없어 달러 예수금을 쓸 수 없습니다"; return r; }
    r.bal = cashBal(key, payCur); r.short = Math.max(0, r.amtC - r.bal); r.ok = true; return r; }
  const h = S.holdings.find(x => x.id === $("txHold").value); r.h = h; if (!h) { r.msg = "팔 종목을 고르세요"; return r; }
  const fx = fxOf(h.cur) || 1; r.mode = h.qty > 0 ? "qty" : "amt";
  if (r.mode === "qty") { if (!q || !px) { r.msg = "수량과 단가를 넣으세요"; return r; } if (q > h.qty + 1e-9) { r.msg = `보유 수량(${h.qty})보다 많이 팔 수 없습니다`; return r; }
    r.q = q; r.px = px; r.gross = Math.round(q * px * fx); r.costOut = Math.round(h.cost * q / h.qty); r.valOut = Math.round(h.value * q / h.qty); r.removed = q >= h.qty - 1e-9; }
  else { if (!amtIn) { r.msg = "매도 금액을 넣으세요"; return r; } if (amtIn > h.value + 1) { r.msg = `평가금액(${won(h.value)})보다 많이 팔 수 없습니다`; return r; }
    r.q = 0; r.gross = Math.round(amtIn); const fr = Math.min(1, amtIn / (h.value || 1)); r.costOut = Math.round(h.cost * fr); r.valOut = r.gross; r.removed = fr >= 0.9999; }
  r.amt = r.gross - fee; r.amtC = payCur === "USD" ? +(r.amt / (fxOf("USD") || 1)).toFixed(2) : r.amt; r.rz = r.amt - r.costOut; r.ok = true; return r; }
function txShow(){ const sh = (sel, on) => document.querySelectorAll(`#txPanel [data-tx="${sel}"]`).forEach(x => x.hidden = !on);
  const key = $("txAcct").value, trade = txT === "buy" || txT === "sell";
  let mode = "qty", usd = false, isNew = false;
  if (txT === "buy") { const f = txFind(key, $("txSec").value), c = f.probe ? (f.h || f.any || f.probe).code : ""; mode = !f.probe || c ? "qty" : "amt"; usd = hCur(c) === "USD"; isNew = !!f.probe && !f.h && !f.any; }
  if (txT === "sell") { const h = S.holdings.find(x => x.id === $("txHold").value); mode = h && h.qty > 0 ? "qty" : "amt"; usd = h && h.cur === "USD"; }
  sh("buy", txT === "buy"); sh("sell", txT === "sell"); sh("role", txT === "buy" && isNew); sh("qty", trade && mode === "qty"); sh("amt", !trade || mode === "amt"); sh("fee", trade);
  const curOn = !trade || usd || !!cashBal(key, "USD"); sh("cur", curOn); if (!curOn) $("txCur").value = "KRW";
  $("txAmtL").textContent = txT === "in" ? "입금액" : txT === "out" ? "출금액" : txT === "sell" ? "매도 금액(원)" : "매수 금액(원)";
  $("txCurL").textContent = trade ? (txT === "buy" ? "결제할 예수금" : "받을 예수금") : "통화"; $("txPxCur").textContent = usd ? "($)" : "(원)";
  $("txGo").textContent = { buy: "매수 기록", sell: "매도 기록", in: "입금 기록", out: "출금 기록" }[txT];
  const r = txCalc(), cs = r.payCur === "USD" ? v => "$" + (+v).toLocaleString(undefined, { maximumFractionDigits: 2 }) : won; let info = "";
  if (!r.ok) info = r.msg ? `<span>${esc(r.msg)}</span>` : "";
  else if (txT === "buy") { info = `<span>매수 금액 <b>${won(r.amt)}</b>${r.amt !== r.gross ? ` (수수료 포함)` : ""}</span><span>예수금 <b>${cs(r.bal)}</b> → <b>${cs(Math.max(0, r.bal - r.amtC))}</b></span><span>순수 원금 변화 <b>없음</b></span>`;
    if (r.short > 0.005) { info += `<span class="bad">예수금이 ${cs(r.short)} 부족합니다 · 기록하면 부족분을 입금으로 함께 기록합니다</span>`; $("txGo").textContent = "부족분 입금 + 매수"; } }
  else if (txT === "sell") info = `<span>받는 금액 <b>${won(r.amt)}</b></span><span>확정 손익 <b class="${cls(r.rz)}">${r.rz >= 0 ? "+" : "−"}${won(Math.abs(r.rz))}</b> (${pct(r.costOut ? r.rz / r.costOut : 0)})</span><span>예수금으로 적립 · 순수 원금 변화 <b>없음</b></span>`;
  else info = `<span>예수금 <b>${cs(r.bal)}</b> → <b>${cs(r.bal + (txT === "in" ? 1 : -1) * r.amtC)}</b></span><span>순수 원금 <b>${txT === "in" ? "+" : "−"}${won(r.amt)}</b></span>`;
  $("txInfo").innerHTML = info; }
function renderTx(){ const keys = txKeys(), cur = $("txAcct").value;
  $("txAcct").innerHTML = keys.map(k => `<option value="${esc(k)}">${esc(k.replace("|", " · "))}</option>`).join("") || '<option value="">계좌 없음 · 먼저 자산을 추가하세요</option>';
  if (keys.includes(cur)) $("txAcct").value = cur; else if (fval().startsWith("a:") && keys.includes(fval().slice(2))) $("txAcct").value = fval().slice(2);
  const key = $("txAcct").value, hs = S.holdings.filter(h => acctKey(h) === key && !isKcash(h) && h.code !== "CASH:USD" && (h.qty > 0 || h.value > 0)), hv = $("txHold").value;
  $("txHold").innerHTML = hs.map(h => `<option value="${h.id}">${esc(h.name || h.code)}${h.qty ? ` · ${h.qty}주` : ` · ${short(h.value)}`}</option>`).join("") || '<option value="">이 계좌에 팔 종목이 없습니다</option>'; if (hs.some(h => h.id === hv)) $("txHold").value = hv;
  if (!$("txRole").options.length) $("txRole").innerHTML = ROLES.map(r => `<option value="${r.k}">${esc(r.n)}</option>`).join("");
  if (!$("txDate").value) $("txDate").value = today(); segSet("txType", txT);
  const L = (S.tx || []).slice().sort((a, b) => b.d.localeCompare(a.d) || b.at - a.at); $("txCount").textContent = L.length ? `${L.length}건` : "";
  const nm = { buy: "매수", sell: "매도", in: "입금", out: "출금" }, cs = t => t.cur === "USD" ? " ($" + t.amtC.toLocaleString() + ")" : "";
  $("txList").innerHTML = L.length ? `<table class="txt"><thead><tr><th>날짜</th><th>구분</th><th>계좌</th><th>내용</th><th class="n">금액</th><th class="n">확정 손익</th><th></th></tr></thead><tbody>${L.map(t => `<tr><td>${t.d}</td><td><span class="tt ${t.t}">${nm[t.t]}</span></td><td>${esc(t.key.replace("|", " · "))}</td><td>${t.t === "buy" || t.t === "sell" ? esc(t.name) + (t.q ? ` ${t.q}주 × ${(+t.px).toLocaleString()}${t.hcur === "USD" ? "$" : "원"}` : "") : t.t === "in" ? "예수금 입금" : "예수금 출금"}</td><td class="n">${won(t.amt)}${cs(t)}</td><td class="n ${cls(t.rz || 0)}">${t.t === "sell" ? (t.rz >= 0 ? "+" : "−") + won(Math.abs(t.rz)) : ""}</td><td><button class="x" data-txdel="${t.id}" aria-label="거래 취소">✕</button></td></tr>`).join("")}</tbody></table>`
    : '<p class="note" style="margin:8px 0">아직 기록한 거래가 없습니다.</p>';
  clip("txList", 8); txShow(); }
$("txType").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; txT = b.dataset.v; segSet("txType", txT); $("txCur").value = "KRW"; renderTx(); });
["txAcct", "txHold"].forEach(id => $(id).addEventListener("change", () => renderTx()));
["txSec", "txQty", "txPrice", "txFee", "txAmt", "txCur", "txDate"].forEach(id => $(id).addEventListener("input", txShow));
$("txSec").addEventListener("change", () => { const f = txFind($("txAcct").value, $("txSec").value), o = f.h || f.any; if (o && o.price && !$("txPrice").value) $("txPrice").value = o.price; if (!o && f.probe) $("txRole").value = guessRole(f.probe.name, f.probe.code) || "gl"; txShow(); });
$("txHold").addEventListener("change", () => { const h = S.holdings.find(x => x.id === $("txHold").value); if (h && h.price) $("txPrice").value = h.price; });
$("txGo").onclick = () => { const r = txCalc(); if (!r.ok) { toast(r.msg || "입력을 확인하세요"); return; }
  const d = $("txDate").value || today(), base = { id: uid(), d, at: Date.now(), key: r.key, cur: r.payCur };
  if (r.t === "in" || r.t === "out") { const t = Object.assign(base, { t: r.t, amt: r.amt, amtC: r.amtC }); S.tx.push(t); txApply(t, 1); }
  else if (r.t === "buy") {
    if (r.short > 0.005) { const fxU = fxOf("USD") || 1, sC = r.payCur === "USD" ? +r.short.toFixed(2) : Math.round(r.short), t0 = { id: uid(), d, at: Date.now() - 1, key: r.key, cur: r.payCur, t: "in", amtC: sC, amt: r.payCur === "USD" ? Math.round(sC * fxU) : sC }; S.tx.push(t0); txApply(t0, 1); }
    let h = r.h, created = false, snap = null;
    if (!h) { const [i0, acct] = r.key.split("|"), o = r.any; snap = { id: uid(), inst: i0 === "기관 미입력" ? "" : i0, acct, name: o ? o.name : r.probe.name || r.probe.code, role: o ? o.role : $("txRole").value, cost: 0, value: 0, code: r.code || "", qty: 0, price: o && o.price ? o.price : 0, cur: o ? o.cur : hCur(r.code), perr: false, autoName: !o && !r.probe.name }; created = true; }
    const t = Object.assign(base, { t: "buy", hid: h ? h.id : snap.id, name: h ? h.name || h.code : snap.name || snap.code, q: r.q, px: r.px || 0, hcur: r.cur, amt: r.amt, amtC: r.amtC, created, snap }); S.tx.push(t); txApply(t, 1); }
  else { const h = r.h, t = Object.assign(base, { t: "sell", hid: h.id, name: h.name || h.code, q: r.q, px: r.px || 0, hcur: h.cur, amt: r.amt, amtC: r.amtC, costOut: r.costOut, valOut: r.valOut, rz: r.rz, removed: r.removed, snap: Object.assign({}, h) }); S.tx.push(t); txApply(t, 1); }
  ["txQty", "txPrice", "txFee", "txAmt", "txSec"].forEach(id => $(id).value = ""); touch(); renderAll();
  toast(r.t === "sell" ? `매도 기록 · 확정 손익 ${r.rz >= 0 ? "+" : "−"}${won(Math.abs(r.rz))}이 예수금으로 들어갔습니다` : r.t === "buy" ? "매수 기록 · 예수금에서 빠지고 보유 수량이 늘었습니다 (원금 변화 없음)" : r.t === "in" ? "입금 기록 · 순수 원금이 늘었습니다" : "출금 기록 · 순수 원금이 줄었습니다");
  if (r.t === "buy" && token) schedulePrices(1500); };
$("txList").addEventListener("click", e => { const b = e.target.closest("[data-txdel]"); if (!b) return; const t = S.tx.find(x => x.id === b.dataset.txdel); if (!t) return;
  if (!confirmDel(b)) return; txApply(t, -1); S.tx = S.tx.filter(x => x !== t); touch(); renderAll(); toast("거래를 취소하고 예수금·보유 수량을 되돌렸습니다"); });
function confirmDel(b){ if (b.dataset.sure) return true; b.dataset.sure = "1"; b.textContent = "취소?"; b.style.color = "var(--warn)"; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = "✕"; b.style.color = ""; } }, 3000); return false; }
function renderAll(){ segSet("bandType", S.band.type); segSet("mode", S.mode); $("bandV").value = S.band.v; $("newCash").value = S.newCash || ""; renderInstFilter(); renderHoldings(); renderTx(); renderTargets(); renderLive(); }
function touch(){ if (S.sample) S.sample = false; persist(); }

/* ---------- 이벤트 ---------- */
let liveT = 0; const soon = () => { clearTimeout(liveT); liveT = setTimeout(renderLive, 120); };
$("hbody").addEventListener("input", e => {
  const t = e.target, tr = t.closest("tr"); if (!tr || !t.dataset.k) return;
  const h = S.holdings[+tr.dataset.i], k = t.dataset.k;
  if (k === "code") { h.code = normCode(t.value); h.price = 0; h.perr = false; t.dataset.dirty = "1"; }
  else if (k === "qty") { h.qty = Math.max(0, +t.value || 0); if (isAuto(h)) { h.value = Math.round(h.qty * h.price * fxOf(h.cur)); const vi = tr.querySelector('[data-k="value"]'); if (vi) vi.value = h.value; } }
  else { h[k] = (k === "cost" || k === "value") ? Math.max(0, +t.value || 0) : t.value; if (k === "name") h.autoName = false; }
  if (k === "value" && isKcash(h)) { h.cost = h.value; const ci = tr.querySelector('[data-k="cost"]'); if (ci) ci.value = h.cost; } // 예수금은 원가 = 잔액
  const r = $("r-" + h.id); if (r) { r.textContent = pct(ret(h)); r.className = "n " + cls(ret(h)); }
  touch(); soon();
});
$("hbody").addEventListener("change", e => { const k = e.target.dataset.k, tr = e.target.closest("tr"); if (!tr) return; const h = S.holdings[+tr.dataset.i]; if (k === "inst" || k === "acct") { renderInstFilter(); renderLive(); if (h) { grpClosed.delete(acctKey(h)); saveFold(); }
    setTimeout(() => { const a = document.activeElement, ai = a && a.closest && a.closest("#hbody tr[data-i]") ? a.closest("tr").dataset.i : null, ak = a && a.dataset ? a.dataset.k : null;
      renderHoldings(); if (ai != null && ak) $("hbody").querySelector(`tr[data-i="${ai}"] [data-k="${ak}"]`)?.focus(); }, 0); }
  if ((k === "name" || k === "code") && h) { // 이미 있는 종목이면 코드·이름·역할·현재가를 맞춰 줌
    const o = sameSec(h)[0];
    if (o) { let ch = [];
      if (!h.code && o.code) { h.code = o.code; ch.push("종목코드"); }
      if (!h.name && o.name) { h.name = o.name; ch.push("상품명"); }
      if (h.role !== o.role) { h.role = o.role; ch.push("역할"); }
      if (h.code && o.price > 0 && !h.price) { h.price = o.price; h.cur = o.cur; h.perr = false; if (isAuto(h)) h.value = Math.round(h.qty * h.price * fxOf(h.cur)); }
      if (ch.length) { touch(); toast(`이미 있는 종목 ‘${o.name || o.code}’과 같은 종목으로 묶었습니다 (${ch.join("·")} 채움)`); } }
    if (k === "code" && h.code && !h.name.trim() && !isCash(h)) { if (token) { toast("종목명을 불러오는 중입니다…"); schedulePrices(300); } else toast("구글 로그인하면 종목코드로 종목명과 시세를 불러옵니다"); }
    else if (k === "code" && token) schedulePrices(1500);
    renderHoldings(); renderLive(); return; }
  if (k === "role" && h) { const others = sameSec(h); if (others.length) { others.forEach(x => x.role = h.role); touch(); renderHoldings(); renderLive(); toast(`같은 종목 ${others.length}개 줄의 역할도 ‘${RM[h.role].n}’로 바꿨습니다`); } }
  if (k === "qty") { renderHoldings(); if (token) schedulePrices(1500); } });
$("hbody").addEventListener("click", e => {
  const g = e.target.closest("tr.grp"); if (g && e.target.closest(".tgl")) return; if (g) { const k = g.dataset.gk; grpClosed.has(k) ? grpClosed.delete(k) : grpClosed.add(k); saveFold(); renderHoldings(); return; }
  const d = e.target.closest("[data-del]"); if (!d) return;
  const i = +d.dataset.del, h = S.holdings[i]; S.holdings.splice(i, 1); touch(); renderInstFilter(); renderHoldings(); renderLive();
  const bar = document.createElement("div"); bar.className = "warn"; bar.innerHTML = `‘${esc(h.name || "자산")}’ 삭제됨 <button class="x" style="color:var(--acc)">되돌리기</button>`;
  $("undoHost").replaceChildren(bar);
  bar.querySelector("button").onclick = () => { S.holdings.splice(i, 0, h); touch(); renderInstFilter(); renderHoldings(); renderLive(); bar.remove(); };
  setTimeout(() => bar.remove(), 8000);
});
$("foldAll").onclick = () => {
  if (hView === "sec") { if (secOpen.size) secOpen.clear(); else securities(A().filter(h => inFilter(h))).filter(g => g.rows.length > 1).forEach(g => secOpen.add(g.key)); renderSecView(); updFold(); return; }
  const gs = [...document.querySelectorAll("#hbody tr.grp")].map(t => t.dataset.gk), any = gs.some(k => !grpClosed.has(k));
  gs.forEach(k => any ? grpClosed.add(k) : grpClosed.delete(k)); saveFold(); renderHoldings(); };
const focusRow = i => { const h = S.holdings[i]; if (h) { grpClosed.delete(acctKey(h)); saveFold(); renderHoldings(); } const ins = $("hbody").querySelectorAll(`tr[data-i="${i}"] input`); if (ins[0]) ins[0].focus(); };
$("addRow").onclick = () => { const f = fval(), fi = f.startsWith("i:") ? f.slice(2) : f.startsWith("a:") ? f.slice(2).split("|")[0] : "", fa = f.startsWith("a:") ? f.split("|")[1] : f.startsWith("t:") ? f.slice(2) : ACCTS[0];
  S.holdings.push({ id: uid(), inst: fi === "기관 미입력" ? "" : fi, acct: fa, name: "", role: "gl", cost: 0, value: 0, code: "", qty: 0, price: 0, cur: "", perr: false }); touch(); renderHoldings(); renderLive(); focusRow(S.holdings.length - 1); };
$("sortRows").onclick = () => { S.holdings.sort((a, b) => RK.indexOf(a.role) - RK.indexOf(b.role) || b.value - a.value); touch(); renderHoldings(); };
$("instFilter").onchange = () => { renderHoldings(); renderLive(); };
document.querySelectorAll("#bandType,#mode,#age,#style").forEach(sg => sg.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return; const v = b.dataset.v;
  if (sg.id === "bandType") { S.band.type = v; S.band.v = v === "abs" ? 5 : 25; $("bandV").value = S.band.v; }
  else if (sg.id === "mode") S.mode = v; else if (sg.id === "age") S.age = v; else S.style = v;
  segSet(sg.id, v); persist(); renderLive();
}));
$("bandV").oninput = e => { S.band.v = Math.max(.5, +e.target.value || 5); persist(); soon(); };
$("newCash").oninput = e => { S.newCash = Math.max(0, +e.target.value || 0); persist(); soon(); };
$("applyPreset").onclick = () => { const k = S.age + S.style; if (!SET.PRESETS[k]) { toast(k + " 프리셋이 settings.js에 없습니다"); return; } S.targets = toT(SET.PRESETS[k]); touch(); renderTargets(); renderLive(); toast(S.age + "대 " + S.style + "형 비율을 적용했습니다"); };
$("tgts").addEventListener("input", e => { const k = e.target.dataset.t; if (!k) return; S.targets[k] = Math.max(0, +e.target.value || 0); touch(); renderTSum(); soon(); });
function makeSnap(c, d){ // 꺼진 계좌와 무관하게 전체를 기록하고, 계좌별 금액도 함께 저장(계좌를 끄고 볼 때 과거 기록에서 빼기 위해)
  const a = {}, r = Object.fromEntries(RK.map(k => [k, 0])); let v = 0, cc = 0;
  S.holdings.forEach(h => { const k = acctKey(h), y = a[k] || (a[k] = { v: 0, c: 0, r: {} }); y.v += h.value; y.c += h.cost; y.r[h.role] = (y.r[h.role] || 0) + h.value; v += h.value; cc += h.cost; r[h.role] += h.value; });
  for (const k in a) { a[k].v = Math.round(a[k].v); a[k].c = Math.round(a[k].c); for (const q in a[k].r) a[k].r[q] = Math.round(a[k].r[q]); }
  const pm = prinMap(); for (const k in a) a[k].c = Math.round(pm[k] || 0);
  for (const q in r) r[q] = Math.round(r[q]); return { d, v: Math.round(v), c: Math.round(Object.values(pm).reduce((x, y) => x + y, 0)), r, a, pp: 1 }; } // c = 순수 원금
$("snap").onclick = () => { const c = calc(), d = today(); S.snaps = S.snaps.filter(s => s.d !== d); S.snaps.push(makeSnap(c, d)); touch(); renderLive(); toast(d + " 상태를 기록했습니다"); };
$("snapList").addEventListener("click", e => { const b = e.target.closest("[data-snapdel]"); if (!b) return; S.snaps = S.snaps.filter(s => s.d !== b.dataset.snapdel); touch(); renderLive(); });
/* 배당·이자: 원화/달러, 수정·복사 */
let divEdit = null; // 수정 중인 기록 id
function dvSyncCur(){ const usd = $("dvCur").value === "USD"; $("dvFxWrap").hidden = !usd; if (usd && !$("dvFx").value) $("dvFx").value = Math.round(fxOf("USD")) || ""; dvHint(); }
function dvHint(){ const usd = $("dvCur").value === "USD", a = +$("dvAmt").value || 0, fx = +$("dvFx").value || 0;
  $("dvHint").textContent = usd ? (a && fx ? `≈ ${won(a * fx)} (1달러 = ${fx.toLocaleString("ko-KR")}원)` : "달러 금액과 적용 환율을 넣으세요") : ""; }
["dvCur"].forEach(id => $(id).addEventListener("change", dvSyncCur)); ["dvAmt", "dvFx"].forEach(id => $(id).addEventListener("input", dvHint));
// 계좌 현금(예수금)에 넣기/빼기. 원화는 '예수금(배당·이자)', 달러는 시세로 평가되는 '예수금(USD)'(종목코드 CASH:USD)
function divApply(rec, sign){
  if (rec.how !== "dep") return;
  const h = S.holdings.find(x => x.id === rec.hid) || { inst: rec.inst || "", acct: rec.acct || ACCTS[0] };
  let cash = S.holdings.find(x => x.id === rec.cashId);
  if (!cash && sign > 0) {
    cash = rec.cur === "USD" ? S.holdings.find(x => x.code === "CASH:USD" && x.inst === h.inst && x.acct === h.acct) : cashRow(acctKey(h), "KRW", false);
    if (!cash) { cash = rec.cur === "USD" ? { id: uid(), inst: h.inst, acct: h.acct, name: "예수금(USD)", role: "cash", cost: 0, value: 0, code: "CASH:USD", qty: 0, price: 1, cur: "USD", perr: false }
        : { id: uid(), inst: h.inst, acct: h.acct, name: "예수금", role: "cash", cost: 0, value: 0, code: "", qty: 0, price: 0, cur: "", perr: false };
      S.holdings.push(cash); }
  }
  if (!cash) return; rec.cashId = cash.id;
  cash.cost = Math.max(0, cash.cost + sign * rec.amt);
  if (cash.code === "CASH:USD") { cash.qty = Math.max(0, +(cash.qty + sign * (rec.amtCur || 0)).toFixed(2)); const fx = fxOf("USD") || rec.fx || 0; cash.value = Math.round(cash.qty * fx); }
  else cash.value = Math.max(0, cash.value + sign * rec.amt);
  if (sign < 0 && !cash.cost && !cash.value && /^예수금\((배당·이자|USD)\)$/.test(cash.name) && !S.divs.some(x => x.id !== rec.id && x.cashId === cash.id)) S.holdings = S.holdings.filter(x => x !== cash);
}
function divForm(rec, copy){
  $("dvDate").value = copy ? today() : rec.d; $("dvHold").value = rec.hid; $("dvCur").value = rec.cur || "KRW";
  $("dvAmt").value = rec.cur === "USD" ? rec.amtCur : rec.amt; $("dvFx").value = rec.cur === "USD" ? (copy ? Math.round(fxOf("USD")) || rec.fx : rec.fx) : ""; $("dvWhere").value = rec.how;
  divEdit = copy ? null : rec.id; $("dvAdd").textContent = copy ? "새로 기록" : "수정 저장"; $("dvCancel").hidden = false; dvSyncCur();
  $("divPanel").scrollIntoView({ behavior: "smooth", block: "start" }); $("dvAmt").focus();
}
function divReset(){ divEdit = null; $("dvAmt").value = ""; $("dvAdd").textContent = "기록"; $("dvCancel").hidden = true; $("dvDate").value = today(); dvHint(); }
$("dvCancel").onclick = divReset;
$("dvAdd").onclick = () => {
  const h = S.holdings.find(x => x.id === $("dvHold").value), cur = $("dvCur").value, raw = +$("dvAmt").value || 0, fx = +$("dvFx").value || 0, d = $("dvDate").value || today(), how = $("dvWhere").value;
  if (!h) { toast("배당을 받은 자산을 고르세요"); return; } if (!(raw > 0)) { toast("받은 금액을 입력하세요"); $("dvAmt").focus(); return; }
  if (cur === "USD" && !(fx > 0)) { toast("달러는 적용 환율을 넣어야 원화로 계산됩니다"); $("dvFx").focus(); return; }
  const rec = { id: divEdit || uid(), d, hid: h.id, name: h.name, inst: h.inst, acct: h.acct, cur, amtCur: cur === "USD" ? +raw.toFixed(2) : Math.round(raw), fx: cur === "USD" ? fx : 1, amt: Math.round(cur === "USD" ? raw * fx : raw), how, cashId: "" };
  if (divEdit) { const old = S.divs.find(x => x.id === divEdit); if (old) { divApply(old, -1); S.divs = S.divs.filter(x => x !== old); } }
  divApply(rec, +1); S.divs.push(rec);
  const msg = `${h.name || "자산"} ${cur === "USD" ? "$" + rec.amtCur.toLocaleString("en-US") + " (" + won(rec.amt) + ")" : won(rec.amt)} ${divEdit ? "기록을 수정했습니다" : "을 기록했습니다"}`;
  divReset(); touch(); renderHoldings(); renderLive(); toast(msg);
};
$("divList").addEventListener("click", e => {
  const b = e.target.closest("[data-divact]"); if (!b) return; const d = S.divs.find(x => x.id === b.dataset.id); if (!d) return;
  if (b.dataset.divact === "edit") return divForm(d, false);
  if (b.dataset.divact === "copy") return divForm(d, true);
  if (divEdit === d.id) divReset();
  divApply(d, -1); S.divs = S.divs.filter(x => x !== d); touch(); renderHoldings(); renderLive(); toast("배당 기록을 지웠습니다");
});
function startBlank(){ const keep = S.savedAt; S = blank(); S.savedAt = keep; persist(); renderAll(); }
$("startMine").onclick = () => { startBlank(); location.hash = "holdings"; };
$("loadSample").onclick = $("loadSample2").onclick = () => { S = sampleMix(sample()); persist(); renderAll(); location.hash = "rebalance"; };
$("goManual").onclick = () => { location.hash = "holdings"; $("addRow").click(); };
let armed = 0;
$("clearAll").onclick = e => { if (!armed) { armed = 1; e.target.textContent = "한 번 더 누르면 모두 삭제"; setTimeout(() => { armed = 0; e.target.textContent = "전부 비우기"; }, 4000); return; } armed = 0; e.target.textContent = "전부 비우기"; startBlank(); toast("모두 비웠습니다"); };

/* ---------- 내보내기 ---------- */
function saveFile(name, data, type){ const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
$("dlJson").onclick = () => saveFile("자산관리_백업_" + today() + ".json", JSON.stringify(Object.assign({ app: "jasan", v: 1 }, S), null, 1), "application/json");
$("dlCsv").onclick = () => saveFile("보유자산_" + today() + ".csv", "﻿기관,계좌,상품명,종목코드,수량,역할,투자원금,평가금액,수익률\n" + S.holdings.map(h => [h.inst, h.acct, h.name, h.code, h.qty || "", RM[h.role].n, h.cost, Math.round(h.value), (ret(h) * 100).toFixed(2) + "%"].map(x => '"' + String(x).replace(/"/g, '""') + '"').join(",")).join("\n"), "text/csv");
$("dlTpl").onclick = async () => {
  try { await loadXLSX(); } catch (e) { toast("엑셀 도구를 불러오지 못했습니다"); return; }
  const rows = [["증권사", "계좌", "종목명", "종목코드", "수량", "분류", "매입금액", "평가금액"], ...(S.holdings.length ? S.holdings.map(h => [h.inst, h.acct, h.name, (h.code || "").replace(/^KRX:/, ""), h.qty || "", RM[h.role].n, h.cost, Math.round(h.value)]) : [["미래에셋증권", "연금저축", "TIGER 미국S&P500", "360750", 500, "해외주식", 10000000, 11800000], ["한국투자증권", "CMA", "CMA", "", "", "유동성", 5000000, 5000000]])];
  const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "자산"); XLSX.writeFile(wb, "자산입력_양식.xlsx");
};
$("importJson").onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { const o = JSON.parse(t); S = norm(o); S.sample = false; persist(); renderAll(); $("ioMsg").textContent = `가져왔습니다: 자산 ${S.holdings.length}개, 기록 ${S.snaps.length}개`; } catch (er) { $("ioMsg").textContent = "백업 파일 형식이 올바르지 않습니다."; } e.target.value = ""; }); };

/* ---------- Numbers·엑셀 불러오기 ---------- */
let xlsxP = null;
function loadXLSX(){ if (window.XLSX) return Promise.resolve(); if (!xlsxP) xlsxP = new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "xlsx.full.min.js"; sc.onload = res; sc.onerror = () => { xlsxP = null; rej(); }; document.head.append(sc); }); return xlsxP; }
const IM = { wb: null, aoa: [], hdr: 0, map: {}, rows: [], mode: "replace" };
const FIELDS = [["inst", "증권사·기관"], ["acct", "계좌"], ["name", "상품명 *"], ["code", "종목코드"], ["role", "역할·분류"], ["cost", "투자원금"], ["value", "평가금액"], ["qty", "수량"], ["avg", "매입단가"], ["price", "현재가"]];
const clean = s => String(s ?? "").replace(/\s+/g, "").toLowerCase();
const toNum = v => { if (typeof v === "number") return v; const s = String(v ?? "").replace(/[,\s원₩]/g, "").replace(/^\((.*)\)$/, "-$1"); const n = parseFloat(s); return isFinite(n) ? n : 0; };
function guessRole(...texts){ const t = texts.map(x => String(x || "")).join(" ").toUpperCase(); if (!t.trim()) return "";
  for (const r of ROLES) if (t.replace(/\s/g, "") === r.n.replace(/\s/g, "").toUpperCase()) return r.k;
  for (const [k, words] of SET.ROLE_HINTS) if (RK.includes(k) && words.some(w => t.includes(String(w).toUpperCase()))) return k;
  return ""; }
function guessAcct(t){ t = String(t || "").toUpperCase(); if (!t) return ""; if (t.includes("ISA")) return "ISA"; if (t.includes("IRP")) return "IRP"; if (t.includes("연금")) return "연금저축"; if (/DC|DB|퇴직/.test(t)) return "DC/DB"; if (t.includes("CMA")) return "CMA"; if (/예금|적금/.test(t)) return "예적금"; if (/위탁|일반|종합|주식/.test(t)) return ACCTS[0]; return ACCTS.find(a => a.toUpperCase() === t) || "기타"; }
function findHeader(aoa){
  const words = Object.values(SET.COLUMN_HINTS).flat().map(clean); let best = 0, bi = 0;
  aoa.slice(0, 30).forEach((r, i) => { const sc = (r || []).filter(c => { const s = clean(c); return s && words.some(w => s.includes(w)); }).length; if (sc > best) { best = sc; bi = i; } });
  if (!best) bi = Math.max(0, aoa.findIndex(r => (r || []).filter(c => String(c ?? "").trim()).length >= 2));
  return bi;
}
function autoMap(){
  const head = (IM.aoa[IM.hdr] || []).map(clean), used = new Set(); IM.map = {};
  const order = ["code", "cost", "value", "qty", "avg", "price", "name", "inst", "acct", "role"];
  order.forEach(f => { const words = (SET.COLUMN_HINTS[f] || []).map(clean); let hit = -1;
    words.some(w => { const i = head.findIndex((h, j) => !used.has(j) && h === w); if (i >= 0) { hit = i; return true; } });
    if (hit < 0) words.some(w => { const i = head.findIndex((h, j) => !used.has(j) && h && h.includes(w)); if (i >= 0) { hit = i; return true; } });
    if (hit >= 0) { IM.map[f] = hit; used.add(hit); } });
}
function openImport(){ $("imp").showModal(); }
document.querySelectorAll("[data-open-import]").forEach(b => b.onclick = openImport); $("sampleImport").onclick = openImport;
$("impClose").onclick = () => $("imp").close();
$("impFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return; $("impMsg").textContent = "파일을 읽는 중…"; $("impStep2").hidden = true;
  try { await loadXLSX(); } catch (er) { $("impMsg").textContent = "엑셀 도구(xlsx.full.min.js)를 불러오지 못했습니다. 깃허브에 이 파일이 올라갔는지 확인하세요."; return; }
  try {
    const buf = await f.arrayBuffer(); IM.wb = XLSX.read(buf, { type: "array", cellDates: true });
    const names = IM.wb.SheetNames.filter(n => { const ws = IM.wb.Sheets[n]; return ws && ws["!ref"]; });
    if (!names.length) throw new Error("빈 파일");
    $("impSheet").innerHTML = names.map(n => `<option>${esc(n)}</option>`).join(""); $("sheetWrap").hidden = names.length < 2;
    loadSheet(names[0]); if (!$("impInstDef").value && !IM.map.inst) $("impInstDef").value = "";
    $("impMsg").textContent = `‘${f.name}’을 읽었습니다. 아래에서 확인 후 불러오세요.`;
  } catch (er) { $("impMsg").innerHTML = "이 파일을 읽지 못했습니다. Numbers에서 <b>파일 → 내보내기 → Excel</b>로 저장한 뒤 그 파일을 올려 주세요. 그래도 안 되면 ‘입력 양식(엑셀) 받기’ 양식에 옮겨 적어 올리세요."; }
  e.target.value = "";
};
function loadSheet(n){
  IM.aoa = XLSX.utils.sheet_to_json(IM.wb.Sheets[n], { header: 1, raw: true, defval: "" }).filter(r => r.some(c => String(c).trim() !== ""));
  IM.hdr = findHeader(IM.aoa); autoMap();
  $("impHdr").innerHTML = IM.aoa.slice(0, 30).map((r, i) => `<option value="${i}"${i === IM.hdr ? " selected" : ""}>${i + 1}행: ${esc(r.filter(c => String(c).trim()).slice(0, 4).join(" · ").slice(0, 40))}</option>`).join("");
  $("hdrWrap").hidden = $("unitWrap").hidden = false; renderMaps(); buildRows();
}
$("impSheet").onchange = e => loadSheet(e.target.value);
$("impHdr").onchange = e => { IM.hdr = +e.target.value; autoMap(); renderMaps(); buildRows(); };
$("impUnit").onchange = buildRows; $("impInstDef").oninput = () => { if (IM.map.inst == null) buildRows(); };
function renderMaps(){
  const head = IM.aoa[IM.hdr] || [], opts = i => '<option value="">(없음)</option>' + head.map((h, j) => `<option value="${j}"${i === j ? " selected" : ""}>${esc(String(h).trim() || "열 " + (j + 1))}</option>`).join("");
  $("impMaps").innerHTML = FIELDS.map(([f, n]) => `<label class="f">${n}<select data-map="${f}">${opts(IM.map[f])}</select></label>`).join("");
  $("impStep2").hidden = false;
}
$("impMaps").addEventListener("change", e => { const f = e.target.dataset.map; if (!f) return; if (e.target.value === "") delete IM.map[f]; else IM.map[f] = +e.target.value; buildRows(); });
function buildRows(){
  const m = IM.map, u = +$("impUnit").value || 1, g = (r, f) => m[f] == null ? "" : r[m[f]];
  IM.rows = IM.aoa.slice(IM.hdr + 1).map(r => {
    const name = String(g(r, "name") ?? "").trim(), qty = toNum(g(r, "qty"));
    let cost = m.cost != null ? toNum(g(r, "cost")) * u : (qty && m.avg != null ? qty * toNum(g(r, "avg")) * u : 0);
    let value = m.value != null ? toNum(g(r, "value")) * u : (qty && m.price != null ? qty * toNum(g(r, "price")) * u : 0);
    if (!value && cost && m.value == null && m.price == null) value = cost;
    const roleTxt = g(r, "role"), role = guessRole(roleTxt) || guessRole(name, g(r, "acct"));
    const total = /^(합계|총계|소계|total|계)$/i.test(name.replace(/\s/g, "")) || /합계|총계|소계/.test(name);
    const code = normCode(g(r, "code")), cp = m.price != null ? toNum(g(r, "price")) : 0;
    return { code, qty: qty || 0, cp, inc: (!!name || !!code) && !total && (value > 0 || cost > 0 || qty > 0), inst: String(g(r, "inst") || $("impInstDef").value || "").trim(), acct: guessAcct(g(r, "acct")) || (/업비트|빗썸|코인원|코빗/.test(String(g(r, "inst") || "")) ? "기타" : ACCTS[0]), name, role: role || "", cost: Math.round(cost), value: Math.round(value) };
  }).filter(x => x.name || x.code || x.value || x.cost);
  renderPreview();
}
function renderPreview(){
  $("impBody").innerHTML = IM.rows.map((x, i) => `<tr data-i="${i}" class="${x.inc ? "" : "off"}"><td><input type="checkbox" data-f="inc" ${x.inc ? "checked" : ""} aria-label="포함" style="min-height:22px;width:22px"></td><td><input data-f="inst" list="insts" value="${esc(x.inst)}"></td><td><select data-f="acct">${ACCTS.map(a => `<option${a === x.acct ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></td><td><input data-f="name" value="${esc(x.name)}"></td><td><input data-f="code" value="${esc(x.code)}" style="width:7.5em"></td><td><input data-f="qty" type="number" step="any" value="${x.qty || ""}" style="width:6em"></td><td><select data-f="role" style="${x.role ? "" : "border-color:var(--acc)"}"><option value="">확인 필요</option>${ROLES.map(r => `<option value="${r.k}"${r.k === x.role ? " selected" : ""}>${esc(r.n)}</option>`).join("")}</select></td><td class="n">${won(x.cost)}</td><td class="n">${won(x.value)}</td></tr>`).join("") || '<tr><td colspan="9" class="note">불러올 행이 없습니다. 머리글 행과 열 연결을 확인하세요.</td></tr>';
  impSum();
}
function impSum(){ const on = IM.rows.filter(x => x.inc), miss = on.filter(x => !x.role).length;
  $("impCount").textContent = `${IM.rows.length}행 중 ${on.length}행 포함`;
  $("impSum").innerHTML = `평가액 합계 <b>${won(on.reduce((a, x) => a + x.value, 0))}</b>` + (miss ? ` · <span style="color:var(--acc)">역할 확인 필요 ${miss}건</span>` : ""); }
$("impBody").addEventListener("input", e => { const tr = e.target.closest("tr"), f = e.target.dataset.f; if (!tr || !f) return; const x = IM.rows[+tr.dataset.i];
  if (f === "inc") { x.inc = e.target.checked; tr.className = x.inc ? "" : "off"; } else if (f === "qty") x.qty = +e.target.value || 0; else if (f === "code") x.code = normCode(e.target.value); else { x[f] = e.target.value; if (f === "role") e.target.style.borderColor = x.role ? "" : "var(--acc)"; }
  impSum(); });
$("impMode").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; IM.mode = b.dataset.v; segSet("impMode", IM.mode); });
$("impGo").onclick = () => {
  const on = IM.rows.filter(x => x.inc); if (!on.length) { toast("포함된 행이 없습니다"); return; }
  const miss = on.filter(x => !x.role).length;
  if (miss && $("impGo").dataset.ok !== "1") { $("impGo").dataset.ok = "1"; $("impGo").textContent = `역할 미지정 ${miss}건은 ‘유동성’으로 넣고 불러오기`; return; }
  $("impGo").dataset.ok = ""; $("impGo").textContent = "이 내용으로 불러오기";
  const list = on.map(x => ({ id: uid(), inst: x.inst, acct: x.acct, name: x.name, role: x.role || RK[0], cost: x.cost, value: x.value, code: x.code, qty: x.code ? x.qty : 0, price: x.code && x.qty && x.cp ? x.cp : 0, cur: x.code && /^KRX|^KOSDAQ/.test(x.code) ? "KRW" : "", perr: false }));
  if (S.sample) { const keep = S.savedAt; S = blank(); S.savedAt = keep; }
  S.holdings = IM.mode === "add" ? S.holdings.concat(list) : list; if (IM.mode !== "add") S.tx = []; S.sample = false;
  persist(); renderAll(); $("imp").close(); location.hash = "rebalance";
  toast(`${list.length}개 자산을 불러왔습니다. 목표 비율: ${S.age}대 ${S.style}형`); if (token) schedulePrices(800);
};

/* ---------- 구글 드라이브 자동 저장 (매물대장과 같은 방식, drive.file 권한) ---------- */
let token = null, tokenExp = 0, tokenClient = null, fileId = localStorage.getItem("jasan-fileid") || null, syncTimer = 0, syncing = false, lastSync = 0;
function setSync(msg, tone){
  let txt, t, btn = "";
  if (!CONFIG.GOOGLE_CLIENT_ID) { txt = "이 기기에 저장"; t = ""; }
  else if (token) { txt = pend ? "드라이브에 저장 대기 중" : "드라이브에 저장됨" + (lastSync ? " " + new Date(lastSync).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""); t = pend ? "warn" : "ok"; btn = "지금 동기화"; }
  else { const signed = localStorage.getItem("jasan-signed"); txt = pend ? "이 기기에만 저장됨" : "이 기기에 저장"; t = "warn"; btn = signed ? "드라이브 연결" : "구글 로그인"; }
  if (msg) { txt = msg; t = tone || "warn"; }
  $("syncTxt").textContent = txt; $("syncDot").className = "dot " + t; $("authBtn").hidden = !btn; $("authBtn").textContent = btn;
}
function scheduleSync(){ clearTimeout(syncTimer); if (token) syncTimer = setTimeout(sync, 1500); }
function initGoogle(){
  if (!CONFIG.GOOGLE_CLIENT_ID) { setSync(); return; }
  if (!(window.google && google.accounts && google.accounts.oauth2)) { setTimeout(initGoogle, 400); return; }
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CONFIG.GOOGLE_CLIENT_ID, scope: "https://www.googleapis.com/auth/drive.file",
    callback: r => { if (r.error) { setSync("로그인하지 못했습니다"); return; } token = r.access_token; tokenExp = Date.now() + (r.expires_in - 60) * 1000; localStorage.setItem("jasan-signed", "1"); sync().then(() => schedulePrices(500)); } });
  setSync();
}
function login(){
  if (!tokenClient) { toast("구글 로그인을 준비하고 있습니다. 잠시 후 다시 누르세요"); return; }
  if (token && Date.now() < tokenExp) { sync(); return; }
  tokenClient.requestAccessToken({ prompt: localStorage.getItem("jasan-signed") ? "" : "consent" });
}
$("authBtn").onclick = login;
async function gfetch(url, opt = {}){
  if (!token || Date.now() > tokenExp) { token = null; throw { auth: true }; }
  const r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: "Bearer " + token }, opt.headers || {}) }));
  if (r.status === 401) { token = null; throw { auth: true }; }
  if (r.status === 404) throw { notFound: true };
  if (!r.ok) { let m = ""; try { m = (await r.json()).error.message || ""; } catch (e) {} throw { status: r.status, message: m }; }
  return r;
}
async function findFile(){ const q = encodeURIComponent(`name='${FILE}' and trashed=false and 'me' in owners`); const j = await (await gfetch(`${DRIVE}/files?q=${q}&spaces=drive&fields=files(id)&orderBy=modifiedTime desc`)).json(); return (j.files && j.files[0] && j.files[0].id) || null; }
async function upload(){
  const body = JSON.stringify({ app: "jasan", version: 1, savedAt: S.savedAt, state: S });
  if (fileId) { await gfetch(`${UPLOAD}/files/${fileId}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body }); return; }
  const bd = "jasan" + Date.now(), meta = { name: FILE, mimeType: "application/json", description: "자산관리 계기판 앱 데이터입니다. 직접 수정하거나 이름을 바꾸지 마세요." };
  const mp = `--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${bd}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${bd}--`;
  const j = await (await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + bd }, body: mp })).json();
  fileId = j.id; localStorage.setItem("jasan-fileid", fileId);
}
async function sync(){
  if (!token || syncing) return; syncing = true; setSync("드라이브와 맞추는 중…", "warn");
  try {
    if (!fileId) fileId = await findFile();
    if (fileId) {
      let remote = null;
      try { remote = await (await gfetch(`${DRIVE}/files/${fileId}?alt=media`)).json(); } catch (e) { if (e.notFound) { fileId = null; localStorage.removeItem("jasan-fileid"); } else throw e; }
      const rAt = remote ? (+remote.savedAt || 0) : 0;
      if (remote && remote.state && (S.sample || rAt > (S.savedAt || 0))) {
        // 드라이브 쪽이 더 최신이거나, 지금 화면이 예시 데이터면 드라이브 자료를 씁니다(예시가 내 자료를 덮어쓰지 않게)
        S = norm(remote.state); S.savedAt = rAt; saveLocal(); pend = false; renderAll(); toast("드라이브에 저장된 내 자료를 불러왔습니다");
      } else if (!S.sample && (!remote || (S.savedAt || 0) > rAt)) await upload();
    } else if (!S.sample && (S.holdings.length || S.snaps.length)) await upload();
    pend = false; lastSync = Date.now(); setSync();
  } catch (e) { setSync(e && e.auth ? "다시 로그인해 주세요" : "드라이브 저장 실패 · 이 기기에는 저장됨"); }
  finally { syncing = false; }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && token) { sync(); if (Date.now() - (S.pricedAt || 0) > REFRESH_MIN * 60e3) schedulePrices(1000); } });

/* ---------- 시세 자동 반영 (내 드라이브의 구글 시트 '자산관리_시세'에서 GOOGLEFINANCE로 현재가를 받아 옴) ---------- */
let priceTimer = 0, pricing = false;
// 환율: 구글에서 받은 값 → 예전에 받은 값 → 직접 입력한 값 순서로 씀
const fxRaw = c => +S.fx[c] || +(S.fxManual || {})[c] || 0;
const fxOf = cur => !cur || cur === "KRW" ? 1 : cur === "GBX" ? fxRaw("GBP") / 100 : fxRaw(cur);
function schedulePrices(ms){ clearTimeout(priceTimer); priceTimer = setTimeout(() => refreshPrices(false), ms); }
setInterval(() => { if (token && !document.hidden && Date.now() - (S.pricedAt || 0) > REFRESH_MIN * 60e3) refreshPrices(false); }, 60e3);
function setPriceTxt(t){ $("priceTxt").textContent = t; }
function priceStatus(){
  const n = S.holdings.filter(h => h.code).length;
  if (!n) return setPriceTxt("종목코드와 수량을 넣은 자산은 시세로 평가금액이 자동 계산됩니다.");
  const at = S.pricedAt ? new Date(S.pricedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const bad = S.holdings.filter(h => h.code && h.perr).length;
  const usd = fxOf("USD"), src = (S.fxLive || {}).USD ? "구글" : S.fx.USD ? "지난번 값" : (S.fxManual || {}).USD ? "직접 입력" : "";
  $("fxTxt").textContent = usd ? `원/달러 ${Math.round(usd).toLocaleString("ko-KR")}원 (${src})` : "원/달러 환율 없음";
  $("fxBox").hidden = !S.holdings.some(h => h.code && h.cur && h.cur !== "KRW") && !usd;
  if (document.activeElement !== $("fxIn")) $("fxIn").value = (S.fxManual || {}).USD || "";
  $("sheetLink").hidden = !S.priceSheet; if (S.priceSheet) $("sheetLink").href = "https://docs.google.com/spreadsheets/d/" + S.priceSheet;
  setPriceTxt(at ? `시세 ${at} 기준 · 종목코드 ${n}개${bad ? ` 중 ${bad}개 시세 없음` : ""} · 최대 20분 지연 · 로그인 중 ${REFRESH_MIN}분마다 자동 갱신` : `종목코드가 있는 자산 ${n}개 · 구글 로그인하면 시세를 받아 옵니다`);
}
/* ---------- 보조지표: 모멘텀(3개월·12개월 상대강도)과 추천 종목·담을 계좌 ---------- */
const REC = SET.REC || {}, MB = Object.assign({ KRW: "KRX:069500", USD: "NYSEARCA:SPY" }, SET.MOMENTUM_BENCH || {});
// ISA·연금저축·IRP는 모두 '절세계좌'로 같은 쪽으로 봄 (pen은 연금을 먼저 쓰라는 뜻일 뿐 ISA도 맞음)
const TAXA = ["ISA", "연금저축", "IRP", "DC/DB"];
const PLACE = { tax: { n: "절세계좌", s: "ISA·연금저축·IRP", a: TAXA }, pen: { n: "절세계좌", s: "연금저축·IRP 우선, ISA도 가능", a: TAXA }, isa: { n: "절세계좌", s: "ISA 우선", a: TAXA }, broker: { n: "위탁계좌", s: "일반(위탁)", a: ["일반(위탁)"] }, cma: { n: "CMA·위탁", s: "CMA·일반(위탁)", a: ["CMA", "일반(위탁)"] } };
const recCode = c => c ? normCode(c) : "";
function momCodes(){ const set = new Set(Object.values(MB)); S.holdings.forEach(h => { if (h.code && !/^CASH:/.test(h.code)) set.add(h.code); }); Object.values(REC).forEach(bs => bs.forEach(b => b.items.forEach(it => { if (it[0]) set.add(recCode(it[0])); }))); return [...set]; }
let momBusy = false, momSet = "hold";
async function refreshMomentum(manual){
  if (momBusy) return; if (!token) { if (manual) login(); else renderSignals(); return; }
  momBusy = true; $("momBtn").disabled = true; $("momNote").textContent = "모멘텀을 계산하는 중… (과거 시세를 받아 오느라 10~20초 걸립니다)";
  try {
    const id = await ensureSheet(), codes = momCodes(), n = codes.length;
    try { await gfetch(`${SHEETS}/${id}:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: "M" } } }] }) }); } catch (e) { /* 이미 있음 */ }
    const ago = d => `IFERROR(INDEX(GOOGLEFINANCE(A{r},"close",TODAY()-${d},10),2,2),"")`;
    const vals = codes.map((c, i) => { const r = i + 1; return [c, `=IFERROR(GOOGLEFINANCE(A${r},"price"),"")`, "=" + ago(91).replace("{r}", r), "=" + ago(365).replace("{r}", r), `=IFERROR(GOOGLEFINANCE(A${r},"name"),"")`]; });
    await gfetch(`${SHEETS}/${id}/values/M!A1:E1000:clear`, { method: "POST" });
    await gfetch(`${SHEETS}/${id}/values/M!A1:E${n}?valueInputOption=USER_ENTERED`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: vals }) });
    let got = [], last = "", same = 0;
    for (let k = 0; k < 16; k++) { await new Promise(r => setTimeout(r, k ? 1500 : 1500));
      got = ((await (await gfetch(`${SHEETS}/${id}/values/M!A1:E${n}?valueRenderOption=UNFORMATTED_VALUE`)).json()).values) || [];
      const sig = JSON.stringify(got), filled = got.filter(r => typeof r[1] === "number").length;
      same = sig === last ? same + 1 : 0; last = sig; $("momNote").textContent = `모멘텀을 계산하는 중… ${filled}/${n}`;
      if (got.length >= n && k >= 3 && same >= 2) break; }
    const d = {}; got.forEach(r => { const num = v => typeof v === "number" && v > 0 ? v : 0; d[r[0]] = { p: num(r[1]), p3: num(r[2]), p12: num(r[3]), name: String(r[4] || "").trim() }; });
    S.mom = { at: Date.now(), d }; persist(); if (manual) toast(`모멘텀을 계산했습니다 (${Object.values(d).filter(x => x.p && x.p3).length}/${n}개 종목)`);
  } catch (e) { $("momNote").textContent = "모멘텀을 받지 못했습니다: " + (e.message || e.status || e); if (manual) toast("모멘텀 계산에 실패했습니다"); }
  finally { momBusy = false; $("momBtn").disabled = false; renderSignals(); }
}
function mom(code){ const d = S.mom && S.mom.d, x = d && d[code]; if (!x || !x.p) return null;
  const b = d[/^(KRX|KOSDAQ):/.test(code) ? MB.KRW : MB.USD] || {}, r3 = x.p3 ? x.p / x.p3 - 1 : null, r12 = x.p12 ? x.p / x.p12 - 1 : null;
  const rel = (r, bp, bpast) => r == null ? null : bp && bpast ? (1 + r) / (bp / bpast) - 1 : r;
  const rs3 = rel(r3, b.p, b.p3), rs12 = rel(r12, b.p, b.p12), q = rs3 == null || rs12 == null ? (rs3 == null ? "na" : rs3 >= 0 ? "imp" : "lag") : rs12 >= 0 ? (rs3 >= 0 ? "lead" : "weak") : (rs3 >= 0 ? "imp" : "lag");
  const sc = rs3 == null ? null : rs12 == null ? rs3 : (rs3 + rs12) / 2; return { r3, r12, rs3, rs12, q, sc, name: x.name }; }
const QN = { lead: "주도", weak: "약화", lag: "소외", imp: "개선", na: "시세 없음" };
const qchip = m => m ? `<span class="qc ${m.q}" title="${{ lead: "12개월·3개월 모두 기준보다 강함", weak: "12개월은 강하지만 최근 3개월 약해짐", lag: "12개월·3개월 모두 약함", imp: "12개월은 약했지만 최근 3개월 강해짐", na: "" }[m.q]}">${QN[m.q]}</span>` : '<span class="qc na">—</span>';
const pp = v => v == null ? "—" : `<span class="${cls(v)}">${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%</span>`;
function myAccts(pk){ const pl = PLACE[pk] || PLACE.tax; return [...new Set(S.holdings.filter(h => pl.a.includes(h.acct)).map(h => (h.inst || "기관 미입력") + " " + h.acct))]; }
function drawMomMap(){ const el = $("momMap"); if (!el) return;
  if (!S.mom) { el.innerHTML = `<div class="mempty">${token ? "‘모멘텀 갱신’을 누르면 보유 종목과 추천 후보의 3개월·12개월 상대강도를 계산합니다." : "구글 로그인 후 ‘모멘텀 갱신’을 누르면 구글 시트에서 과거 시세를 받아 모멘텀을 계산합니다."}</div>`; return; }
  const secs = securities(A().filter(h => h.code && !/^CASH:/.test(h.code))), held = new Set();
  const pts = secs.map(g => { const c = g.rows[0].code; held.add(c); const m = mom(c); return m && m.rs3 != null && m.rs12 != null ? { x: m.rs12, y: m.rs3, n: g.name || c, v: g.value, col: (ROLES.find(r => r.k === g.rows[0].role) || {}).c || "#888", h: 1 } : null; }).filter(Boolean);
  if (momSet === "all") Object.values(REC).forEach(bs => bs.forEach(b => b.items.forEach(it => { const c = recCode(it[0]); if (!c || held.has(c)) return; held.add(c); const m = mom(c); if (m && m.rs3 != null && m.rs12 != null) pts.push({ x: m.rs12, y: m.rs3, n: it[1], v: 0, h: 0 }); })));
  if (!pts.length) { el.innerHTML = '<div class="mempty">계산된 종목이 없습니다. 종목코드가 있는 보유 자산이 필요하고, 일부 종목은 구글 금융에서 과거 시세를 주지 않습니다.</div>'; return; }
  const W = Math.max(300, el.clientWidth || 800), H = Math.round(Math.max(300, Math.min(520, W * .56))), pl = W < 500 ? 34 : 46, pr = 14, pt = 18, pb = 30;
  const ex = Math.min(1.2, Math.max(.1, ...pts.map(p => Math.abs(p.x))) * 1.15), ey = Math.min(1, Math.max(.06, ...pts.map(p => Math.abs(p.y))) * 1.15);
  const X = v => pl + (Math.max(-ex, Math.min(ex, v)) + ex) / (2 * ex) * (W - pl - pr), Y = v => pt + (ey - Math.max(-ey, Math.min(ey, v))) / (2 * ey) * (H - pt - pb);
  const vmax = Math.max(1, ...pts.map(p => p.v)), R = p => p.h ? 5 + Math.sqrt(p.v / vmax) * (W < 500 ? 11 : 16) : 4.5;
  const tick = (e, f) => [-e, -e / 2, 0, e / 2, e].map(f).join("");
  let g = `<rect x="${X(0)}" y="${pt}" width="${W - pr - X(0)}" height="${Y(0) - pt}" fill="var(--up)" opacity=".035"/><rect x="${pl}" y="${Y(0)}" width="${X(0) - pl}" height="${H - pb - Y(0)}" fill="var(--down)" opacity=".035"/>`;
  g += `<line class="ax" x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}"/><line class="ax" x1="${X(0)}" x2="${X(0)}" y1="${pt}" y2="${H - pb}"/>`;
  g += tick(ex, v => `<text class="tk" x="${X(v)}" y="${H - 10}" text-anchor="middle">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(0)}%</text>`);
  g += tick(ey, v => v ? `<text class="tk" x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${v > 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}%</text>` : "");
  const q = (x, y, a, t, s2) => `<text class="qd" x="${x}" y="${y}" text-anchor="${a}">${t}</text><text class="qs" x="${x}" y="${y + 15}" text-anchor="${a}">${s2}</text>`;
  g += q(W - pr - 6, pt + 18, "end", "주도", "12개월·3개월 강함") + q(W - pr - 6, H - pb - 22, "end", "약화", "강했다가 식는 중") + q(pl + 6, H - pb - 22, "start", "소외", "모두 약함") + q(pl + 6, pt + 18, "start", "개선", "최근 힘이 붙음");
  pts.sort((a, b) => (a.h - b.h) || (b.v - a.v)).forEach(p => { const x = X(p.x), y = Y(p.y), r = R(p), lab = p.n.length > 12 ? p.n.slice(0, 11) + "…" : p.n, right = x < W - 120;
    g += p.h ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.col}" fill-opacity=".85" stroke="#fff" stroke-width="1.5"><title>${esc(p.n)} · 12개월 ${(p.x * 100).toFixed(1)}% · 3개월 ${(p.y * 100).toFixed(1)}%</title></circle>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--panel)" stroke="var(--mute)" stroke-width="1.5"><title>추천 후보 · ${esc(p.n)} · 12개월 ${(p.x * 100).toFixed(1)}% · 3개월 ${(p.y * 100).toFixed(1)}%</title></circle>`;
    g += `<text class="lb${p.h ? "" : " c"}" x="${right ? x + r + 4 : x - r - 4}" y="${y + 4}" text-anchor="${right ? "start" : "end"}">${esc(lab)}</text>`; });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="모멘텀 지도">${g}</svg>`; }
let sigOpen = new Set(); try { sigOpen = new Set(JSON.parse(localStorage.getItem("jasan_sig") || "[]")); } catch (e) {}
const saveSig = () => { try { localStorage.setItem("jasan_sig", JSON.stringify([...sigOpen])); } catch (e) {} };
const whereOf = it => it[3] || (!it[0] ? "증권사 문의" : /^[0-9][0-9A-Z]{5}$/.test(it[0]) ? "어느 증권사든 (국내 ETF)" : "해외주식 거래 증권사");
function renderSignals(){ if (!$("recWrap")) return; segSet("momSet", momSet);
  $("momNote").textContent = S.mom ? `${new Date(S.mom.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 계산 · 국내 종목은 KODEX 200, 해외 종목은 S&P500 대비` : "아직 계산하지 않았습니다";
  drawMomMap(); const c = calc(), held = A();
  // 위쪽 카드: 보유 종목이 네 칸에 얼마나 있는지
  const hs = securities(held.filter(h => h.code && !/^CASH:/.test(h.code))).map(g => ({ g, m: mom(g.rows[0].code) })), tv = hs.reduce((a, x) => a + (x.m && x.m.q !== "na" ? x.g.value : 0), 0) || 1;
  const card = (q, d) => { const L = hs.filter(x => x.m && x.m.q === q), v = L.reduce((a, x) => a + x.g.value, 0);
    return `<div class="kpi"><span>${QN[q]} <em class="qc ${q}" style="margin-left:4px">${d}</em></span><b>${L.length}<small style="font-size:14px;font-weight:600;color:var(--mute)"> 종목</small></b><span>${S.mom ? `보유 금액의 ${(v / tv * 100).toFixed(0)}%` : "모멘텀 계산 전"}${L.length ? " · " + L.slice(0, 2).map(x => esc(x.g.name)).join(", ") + (L.length > 2 ? " 외" : "") : ""}</span></div>`; };
  $("sigKpis").innerHTML = card("lead", "12개월↑ 3개월↑") + card("weak", "12개월↑ 3개월↓") + card("imp", "12개월↓ 3개월↑") + card("lag", "12개월↓ 3개월↓");
  $("recWrap").innerHTML = ROLES.map(r => { const bs = REC[r.k] || [], mine = securities(held.filter(h => h.role === r.k && !isCash(h) && !isKcash(h))), row = c.rows.find(x => x.r.k === r.k);
    if (!bs.length && !mine.length) return "";
    const rec = new Set(), open = sigOpen.has(r.k); let best = null;
    const body = bs.map(b => { const pl = PLACE[b.p] || PLACE.tax, my = myAccts(b.p);
      const items = b.items.map(it => { const code = recCode(it[0]); if (code) rec.add(code); const m = code ? mom(code) : null, hh = code ? held.filter(h => h.code && codeBase(h.code) === codeBase(code)) : held.filter(h => !h.code && nameKey(h.name) === nameKey(it[1]));
          return { it, code, m, hh }; }).sort((x, y) => (y.m && y.m.sc != null ? y.m.sc : -9) - (x.m && x.m.sc != null ? x.m.sc : -9));
      const ti = items.findIndex(x => x.m && x.m.sc != null); if (ti >= 0 && (!best || items[ti].m.sc > best.m.sc)) best = items[ti];
      return `<tr class="bk"><td colspan="7"><div class="bkh"><b>${esc(b.b)}</b>${(b.tags || []).map(t => `<span class="tg2">${esc(t)}</span>`).join("")}<span class="pl ${b.p === "broker" || b.p === "cma" ? b.p : "tax"}">${pl.n}</span><span class="bkw">${esc(b.why || "")}</span></div><div class="bka">${my.length ? "내 " + pl.n + ": " + my.map(esc).join(" · ") : `내 계좌 중 ${pl.n}가 없습니다`}</div></td></tr>`
        + items.map((x, i) => { const top = i === ti && items.filter(y => y.m && y.m.sc != null).length > 1;
          const hold = x.hh.length ? x.hh.map(h => { const ok = pl.a.includes(h.acct); return `<div class="hold${ok ? "" : " bad"}" title="${ok ? "권장 계좌 종류에 담겨 있음" : `${pl.n}에 두면 세금 면에서 더 유리 (지금: ${h.acct})`}">${ok ? "✓" : "↔"} ${esc(h.acct)} ${short(h.value)}</div>`; }).join("") : '<span class="dim">—</span>';
          return `<tr class="${top ? "rtop" : ""}"><td class="rk">${x.m && x.m.sc != null ? i + 1 : ""}</td><td><div class="nm">${x.code ? logo(x.code, x.it[1], r.k) : '<span class="lg0">채</span>'}<div>${esc(x.it[1])}${top ? '<span class="best">모멘텀 1위</span>' : ""}<small>${[x.code ? codeBase(x.code) : "", x.it[2] || ""].filter(Boolean).map(esc).join(" · ")}</small></div></div></td><td class="wh">${esc(whereOf(x.it))}</td><td class="n">${x.m ? pp(x.m.rs3) : "—"}</td><td class="n">${x.m ? pp(x.m.rs12) : "—"}</td><td>${x.code ? qchip(x.m) : '<span class="qc na">시세 없음</span>'}</td><td class="hl">${hold}</td></tr>`; }).join(""); }).join("");
    const others = mine.filter(g => !g.rows.some(h => h.code && rec.has(h.code)) && !bs.some(b => b.items.some(it => !it[0] && nameKey(it[1]) === nameKey(g.name))));
    const oBody = others.length ? `<tr class="bk"><td colspan="7"><div class="bkh"><b>내가 보유한 다른 종목</b><span class="bkw">추천 목록에 없는 보유 종목의 모멘텀</span></div></td></tr>` + others.map(g => { const code = g.rows[0].code, m = code ? mom(code) : null;
        return `<tr><td class="rk"></td><td><div class="nm">${logo(code, g.name, r.k)}<div>${esc(g.name || code)}<small>${code ? esc(codeBase(code)) : "종목코드 없음"}</small></div></div></td><td class="wh">—</td><td class="n">${m ? pp(m.rs3) : "—"}</td><td class="n">${m ? pp(m.rs12) : "—"}</td><td>${code ? qchip(m) : '<span class="qc na">코드 없음</span>'}</td><td class="hl">${g.rows.map(h => `<div class="hold">${esc(h.acct)} ${short(h.value)}</div>`).join("")}</td></tr>`; }).join("") : "";
    const tr = Math.abs(row.trade) >= 1e4 ? `<span class="tp ${row.trade > 0 ? "buy" : "sell"}" style="min-width:0">${row.trade > 0 ? "매수" : "매도"} ${short(Math.abs(row.trade))}</span>` : '<span class="tp" style="min-width:0">조정 없음</span>';
    return `<div class="sgrp${open ? " open" : ""}" data-r="${r.k}"><button class="sgh" aria-expanded="${open}"><span class="tw">${open ? "▾" : "▸"}</span><i style="background:${r.c}"></i><b>${esc(r.n)}</b><span class="sgm">현재 ${(row.w * 100).toFixed(1)}% · 목표 ${(row.t * 100).toFixed(1)}%</span>${tr}<span class="sgb2">${best ? `모멘텀 1위 <b>${esc(best.it[1])}</b> ${qchip(best.m)}` : `<span class="dim">${bs.reduce((a, b) => a + b.items.length, 0)}개 후보</span>`}</span></button>
      <div class="sgbody"${open ? "" : " hidden"}><table class="rt"><thead><tr><th>순위</th><th>종목</th><th>사는 곳</th><th class="n">3개월</th><th class="n">12개월</th><th>모멘텀</th><th>보유</th></tr></thead><tbody>${body}${oBody}</tbody></table></div></div>`; }).join("");
  const n = $("recWrap").querySelectorAll(".sgrp").length, no = $("recWrap").querySelectorAll(".sgrp.open").length; $("sigFold").textContent = no ? "모두 접기" : "모두 펼치기"; $("sigFold").hidden = !n; }
$("recWrap").addEventListener("click", e => { const b = e.target.closest(".sgh"); if (!b) return; const k = b.closest(".sgrp").dataset.r; sigOpen.has(k) ? sigOpen.delete(k) : sigOpen.add(k); saveSig(); renderSignals(); });
$("sigFold").onclick = () => { const ks = [...$("recWrap").querySelectorAll(".sgrp")].map(x => x.dataset.r), any = ks.some(k => sigOpen.has(k)); ks.forEach(k => any ? sigOpen.delete(k) : sigOpen.add(k)); saveSig(); renderSignals(); };
$("momSet").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; momSet = b.dataset.v; renderSignals(); });
$("momBtn").onclick = () => refreshMomentum(true);
if (window.ResizeObserver) new ResizeObserver(() => { if ($("v-signals").classList.contains("on")) drawMomMap(); }).observe($("momMap"));
async function ensureSheet(){
  if (S.priceSheet) { try { await gfetch(`${SHEETS}/${S.priceSheet}?fields=spreadsheetId`); return S.priceSheet; } catch (e) { if (!e.notFound) throw e; } }
  const j = await (await gfetch(SHEETS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ properties: { title: "자산관리_시세", locale: "en_US" }, sheets: [{ properties: { title: "P" } }] }) })).json();
  S.priceSheet = j.spreadsheetId; return S.priceSheet;
}
async function refreshPrices(manual){
  if (pricing) return; const codes = [...new Set(S.holdings.map(h => h.code).filter(c => c && !/^CASH:/.test(c)))], hasCash = S.holdings.some(isCash);
  if (!codes.length && !hasCash) { if (manual) toast("종목코드가 있는 자산이 없습니다. 보유자산 탭에서 종목코드와 수량을 넣으세요"); priceStatus(); return; }
  if (!token) { if (manual) login(); else priceStatus(); return; }
  pricing = true; setPriceTxt("시세를 받아 오는 중…"); $("priceBtn").disabled = true;
  try {
    const id = await ensureSheet(), rows = [...new Set(codes.flatMap(candidates))];
    // 환율은 세 가지 식으로 받아 보고 먼저 나오는 값을 씀 (구글이 한 방식에서 값을 안 주는 경우가 있음)
    const fxRows = FXS.flatMap(c => [[`FX1:${c}`, `=GOOGLEFINANCE("CURRENCY:${c}KRW")`], [`FX2:${c}`, `=GOOGLEFINANCE("CURRENCY:${c}KRW","price")`], [`FX3:${c}`, `=1/GOOGLEFINANCE("CURRENCY:KRW${c}")`]]);
    // 시세는 오류를 감추지 않고 그대로 받아 와서, 아직 계산 중인지 끝났는지 구분합니다
    const vals = [...rows.map((c, i) => [c, `=GOOGLEFINANCE(A${i + 1},"price")`, `=IFERROR(GOOGLEFINANCE(A${i + 1},"currency"),"")`, `=IFERROR(GOOGLEFINANCE(A${i + 1},"name"),"")`]), ...fxRows.map(r => [r[0], r[1], "", ""])], total = vals.length;
    if (!S.sheetKo) { try { await gfetch(`${SHEETS}/${id}:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: [{ updateSpreadsheetProperties: { properties: { locale: "ko_KR" }, fields: "locale" } }] }) }); S.sheetKo = true; } catch (e) {} }
    await gfetch(`${SHEETS}/${id}/values/P!A1:D1000:clear`, { method: "POST" });
    await gfetch(`${SHEETS}/${id}/values/P!A1:D${total}?valueInputOption=USER_ENTERED`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: vals }) });
    const parse = got => { const P = {}; got.forEach(r => { const p = typeof r[1] === "number" ? r[1] : NaN; P[r[0]] = { p, cur: String(r[2] || "").toUpperCase(), raw: r[1], name: String(r[3] || "").trim() }; }); return P; };
    const curOf = (code, x) => x.cur || (code.startsWith("CURRENCY:") ? code.slice(-3) : /^(KRX|KOSDAQ):/.test(code) ? "KRW" : "USD");
    const fxIn = (P, c) => { for (const k of ["FX1:", "FX2:", "FX3:"]) { const x = P[k + c]; if (x && x.p > 0) return x.p; } return 0; };
    const fxReady = (P, cur) => cur === "KRW" || fxIn(P, cur === "GBX" ? "GBP" : cur) > 0;
    const allDone = P => (!hasCash || fxReady(P, "USD")) && codes.every(c => { const hit = candidates(c).find(x => P[x] && P[x].p > 0); return hit && fxReady(P, curOf(hit, P[hit])); });
    let got = [], P = {};
    for (let k = 0; k < 14; k++) { // 시트가 계산을 마칠 때까지 기다림(해외 종목·환율은 몇 초 더 걸릴 수 있음, 최대 약 20초)
      await new Promise(r => setTimeout(r, k ? 1500 : 1000));
      got = ((await (await gfetch(`${SHEETS}/${id}/values/P!A1:D${total}?valueRenderOption=UNFORMATTED_VALUE`)).json()).values) || [];
      P = parse(got); if (got.length >= total && allDone(P)) break;
      setPriceTxt(`시세를 받아 오는 중… (${k + 1})`);
    }
    S.fxLive = {}; FXS.forEach(c => { const v = fxIn(P, c); if (v > 0) { S.fx[c] = v; S.fxLive[c] = 1; } });
    let ok = 0, bad = 0, fxbad = 0, named = 0;
    S.holdings.forEach(h => { if (!h.code) return;
      if (isCash(h)) { const fx = fxOf(h.cur); h.price = 1; h.perr = false; h.fxerr = !(fx > 0); if (h.fxerr) fxbad++; else { h.value = Math.round(h.qty * fx); ok++; } return; }
      const hit = candidates(h.code).find(c => P[c] && P[c].p > 0), x = hit && P[hit];
      if (!x) { h.perr = true; h.fxerr = false; bad++; return; }
      if (hit !== h.code) h.code = hit; // 찾은 거래소로 종목코드를 고쳐 둠(다음부터 바로 조회)
      if (x.name && (!h.name.trim() || h.autoName || nameKey(h.name) === nameKey(codeBase(h.code)))) { if (h.name !== x.name) named++; h.name = x.name; h.autoName = true; } // 상품명이 비어 있으면 종목명 자동 입력
      const cur = curOf(h.code, x); h.price = x.p; h.cur = cur; h.perr = false; const fx = fxOf(cur);
      h.fxerr = !(fx > 0); if (h.fxerr) fxbad++;
      if (h.qty > 0 && fx > 0) { h.value = Math.round(h.qty * x.p * fx); ok++; } });
    S.priceDebug = got.slice(0, 80).map(r => r[0] + " → " + (typeof r[1] === "number" ? r[1] : String(r[1] || "(빈칸)")) + (r[2] ? " " + r[2] : ""));
    S.pricedAt = Date.now();
    if (SET.AUTO_SNAPSHOT !== false && ok) { const c = calc(), d = today(); S.snaps = S.snaps.filter(x => x.d !== d); S.snaps.push(makeSnap(c, d)); }
    if (S.sample) S.sample = false;
    persist(); renderHoldings(); renderLive();
    const noQty = S.holdings.filter(h => h.code && h.price > 0 && !(h.qty > 0)).length;
    if (named) renderInstFilter();
    if (manual || named) toast(`${named ? `종목명 ${named}개를 불러왔습니다. ` : ""}시세를 반영했습니다: ${ok}개 갱신${bad ? `, ${bad}개는 시세를 찾지 못함` : ""}${fxbad ? `, ${fxbad}개는 환율을 받지 못함` : ""}${noQty ? `, ${noQty}개는 수량이 비어 있음` : ""}`);
  } catch (e) {
    const msg = e && e.auth ? "다시 로그인해 주세요" : e && e.status === 403 ? "구글 콘솔에서 Google Sheets API를 켜 주세요(설치안내 5-2)" : "시세를 받아 오지 못했습니다";
    if (manual || !(e && e.auth)) toast(msg);
  } finally { pricing = false; $("priceBtn").disabled = false; priceStatus(); }
}
$("priceBtn").onclick = () => refreshPrices(true);
$("fxSet").onclick = () => { const v = +$("fxIn").value; if (!(v > 100)) { toast("원/달러 환율을 숫자로 넣으세요 (예: 1380)"); return; }
  S.fxManual = Object.assign({}, S.fxManual, { USD: v }); if (!(S.fxLive || {}).USD) delete S.fx.USD; // 구글 값이 없을 때는 직접 입력값을 씀
  S.holdings.forEach(h => { if (h.code && (h.price > 0 || isCash(h)) && h.qty > 0 && h.cur === "USD") { h.value = Math.round(h.qty * h.price * fxOf("USD")); h.fxerr = false; } });
  touch(); renderHoldings(); renderLive(); toast(`원/달러 ${v.toLocaleString("ko-KR")}원을 적용했습니다`); };
$("debugBtn").onclick = () => { const d = $("priceDebug"); d.hidden = !d.hidden; d.textContent = (S.priceDebug && S.priceDebug.length) ? "구글 시트가 돌려준 값 (종목코드 → 현재가 통화)\n" + S.priceDebug.join("\n") : "아직 받아 온 기록이 없습니다. ‘시세 갱신’을 먼저 누르세요."; };

/* ---------- 탭 ---------- */
const VIEWS = ["rebalance", "holdings", "returns", "charts", "signals", "targets"];
function route(){ const h = location.hash.slice(1), v = VIEWS.includes(h) ? h : "rebalance"; VIEWS.forEach(x => $("v-" + x).classList.toggle("on", x === v)); document.querySelectorAll("#nav a, #tabs a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + v)); window.scrollTo({ top: 0 }); if (v === "returns") requestAnimationFrame(lineDraw); if (v === "charts") requestAnimationFrame(() => renderCharts(calc())); if (v === "signals") { requestAnimationFrame(renderSignals); if (token && (!S.mom || Date.now() - S.mom.at > 12 * 3600e3)) refreshMomentum(false); } }
addEventListener("hashchange", route);

$("appVer").textContent = "앱 " + APP_VERSION;
route(); renderAll(); initGoogle();
if ((window.__cfgErr || []).length) toast([...new Set(window.__cfgErr)].join(", ") + "에 오타가 있어 그 파일의 설정을 쓰지 못했습니다. 따옴표·쉼표를 확인하세요");
else if (!window.JASAN_DEFAULTS) toast("defaults.js를 읽지 못해 최소 기본값으로 실행 중입니다. 깃허브에 defaults.js가 올라갔는지 확인하세요");
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
