/* Grok Bot desk: static read-only iPhone web app (plan B). Reads JSON the desk publishes; never writes anywhere. */
(function () {
  "use strict";
  const PUBLIC = "https://inuingicceojxdjfsnaa.supabase.co/storage/v1/object/public/desk-data/d/";
  const POLL_MS = 15000;
  const ORDER = ["scanner", "auditor", "analyst", "executor", "risk"];
  const COLOR = { scanner: "#64d2ff", auditor: "#0a84ff", analyst: "#ffd60a", executor: "#00d35a", risk: "#ff6b9a" };
  const GROUPS = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk", desk: "Desk" };
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- data path: #d=... once, then localStorage; fragment cleared ----------
  const hm = location.hash.match(/[#&]d=([^&]+)/);
  if (hm) {
    try { localStorage.setItem("desk.d", decodeURIComponent(hm[1])); } catch (e) {}
    history.replaceState(null, "", location.pathname + location.search);
  }
  const qs = new URLSearchParams(location.search);
  let BASE = null;
  const override = qs.get("base"); // testing only: accepted for localhost servers only
  if (override && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(override)) BASE = override;
  else { let d = null; try { d = localStorage.getItem("desk.d"); } catch (e) {} if (d) BASE = PUBLIC + encodeURIComponent(d) + "/"; }

  // ---------- state ----------
  const D = { state: null, chart: null, activity: null, agents: {}, coins: {}, coinMissing: {}, actPages: [] };
  const net = { ok: null, lastOk: 0, nextAt: 0, failing: false };
  const ui = { tab: "home", overlay: null, range: "LIVE", search: "", searchOpen: false };
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => (typeof u === "string" && /^https:\/\//.test(u)) ? u : null;
  const num = v => typeof v === "number" && isFinite(v);
  const money = v => num(v) ? (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "n/a";
  const big = v => !num(v) ? "n/a" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(0);
  const pct = (v, d = 2) => num(v) ? (v >= 0 ? "+" : "") + v.toFixed(d) + "%" : "n/a";
  const price = v => { if (!num(v)) return "n/a"; const a = Math.abs(v); if (a >= 1) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 4 }); if (a === 0) return "$0";
    const z = Math.floor(-Math.log10(a)); return "$" + v.toFixed(Math.min(z + 4, 12)); };
  const hhmm = ts => num(ts) ? new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  const dur = s => { if (!num(s)) return "n/a"; s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : `${m}m`; };
  const reasonOf = text => { const p = String(text || "").split(" · "); return p.length > 1 ? p.slice(1).join(" · ") : ""; };
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

  // ---------- network ----------
  async function getJSON(path) {
    const r = await fetch(BASE + path + "?t=" + Date.now(), { cache: "no-store", credentials: "omit" });
    if (r.status === 404 || r.status === 400) { const e = new Error("missing"); e.missing = true; throw e; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  async function poll() {
    clearTimeout(poll.t);
    if (!BASE) { render(); return; }
    try {
      const [st, ch, ac, ...ag] = await Promise.all([getJSON("state.json"), getJSON("chart.json"), getJSON("activity.json"),
        ...ORDER.map(n => getJSON("agents/" + n + ".json").catch(e => { if (e.missing) return null; throw e; }))]);
      D.state = st; D.chart = ch; D.activity = ac; D.actPages = D.actPages.length > 1 ? [ac, ...D.actPages.slice(1)] : [ac];
      ORDER.forEach((n, i) => { if (ag[i]) D.agents[n] = ag[i]; });
      const ov = ui.overlay;
      if (ov && ov.mint) await loadCoin(ov.mint, true);
      net.ok = true; net.failing = false; net.lastOk = Date.now();
    } catch (e) {
      net.ok = false; net.failing = true;
    }
    net.nextAt = Date.now() + POLL_MS;
    render();
    poll.t = setTimeout(poll, POLL_MS);
  }
  async function loadCoin(mint, quiet) {
    try { D.coins[mint] = await getJSON("coin/" + encodeURIComponent(mint) + ".json"); delete D.coinMissing[mint]; }
    catch (e) { if (e.missing) D.coinMissing[mint] = true; else if (!quiet) throw e; else throw e; }
  }
  setInterval(() => { if (net.failing) offlineRow(); }, 1000);
  function offlineRow() {
    const el = $("#offline");
    document.body.classList.toggle("off", net.failing);
    if (!net.failing) { el.hidden = true; return; }
    const n = Math.max(0, Math.ceil((net.nextAt - Date.now()) / 1000));
    const last = D.state && num(D.state.updated_at) ? hhmm(D.state.updated_at) : "never";
    el.textContent = `Desk offline · retrying in ${n}s · last update ${last}`;
    el.hidden = false;
  }

  // ---------- odometer ----------
  const odo = { el: null, text: "" };
  function odoSet(el, text) {
    const animate = !!el._text && !reduced() && el._text.length === text.length &&
      [...text].every((c, i) => /\d/.test(c) === /\d/.test(el._text[i]));
    if (!animate) {
      el.innerHTML = [...text].map(c => /\d/.test(c)
        ? `<span class="odo-d"><span class="odo-s" style="transform:translateY(-${c}em)">${[..."0123456789"].map(d => `<span>${d}</span>`).join("")}</span></span>`
        : `<span class="odo-c">${esc(c)}</span>`).join("");
    } else {
      const slots = el.children, L = text.length;
      let k = 0;
      for (let i = L - 1; i >= 0; i--) {
        const c = text[i];
        if (/\d/.test(c) && c !== el._text[i]) {
          const s = slots[i].firstChild;
          s.style.transition = `transform 600ms cubic-bezier(.17,.84,.44,1) ${k * 30}ms`;
          s.style.transform = `translateY(-${c}em)`;
          k++;
        } else if (!/\d/.test(c)) slots[i].textContent = c;
      }
    }
    el._text = text;
    el.setAttribute("aria-label", text);
  }

  // ---------- helpers ----------
  const agent = n => (D.state && D.state.agents || []).find(a => a.name === n) || null;
  const decisions = n => (D.agents[n] && D.agents[n].decisions) || [];
  function knownCoins() {
    const m = new Map();
    const add = (mint, name, url) => { if (mint && !m.has(mint)) m.set(mint, { mint, name: name || mint, url }); };
    (D.activity && D.activity.rows || []).forEach(r => add(r.mint, String(r.title || "").replace(/^(Bought|Sold|Stopped|Rejected) /, ""), r.coin_url));
    ORDER.forEach(n => decisions(n).forEach(d => add(d.mint, d.name, d.coin_url)));
    Object.values(D.coins).forEach(c => { add(c.mint, c.name, c.coin_url); const e = m.get(c.mint); if (e) e.symbol = c.symbol; });
    return [...m.values()];
  }
  function latestActId() { const r = D.activity && D.activity.rows || []; return r.length ? Math.max(...r.map(x => x.id)) : 0; }
  function unread() { const seen = +(store.get("desk.seen") || 0); return latestActId() > seen; }
  function sk(w, h, extra = "") { return `<div class="sk" style="width:${w};height:${h};${extra}"></div>`; }
  function backBar(title = "") { return `<div class="nav"><button class="back" data-back><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Back</button><div class="grow"></div>${title}</div>`; }
  const ICON = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="#00d35a"><path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z"/></svg>',
  };

  // ---------- render root ----------
  function render() {
    offlineRow();
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === ui.tab));
    const scr = $("#screen");
    if (!BASE) { scr.innerHTML = noPath(); $("#overlay").hidden = true; return; }
    const y = window.scrollY, carX = ($(".car") || {}).scrollLeft || 0;
    if (ui.tab === "home") renderHome(scr);
    else if (ui.tab === "agents") scr.innerHTML = agentsTab();
    else if (ui.tab === "activity") scr.innerHTML = activityTab();
    else scr.innerHTML = accountTab();
    const car = $(".car"); if (car) car.scrollLeft = carX;
    drawCards();
    window.scrollTo(0, y);
    renderOverlay();
  }
  function noPath() {
    return `<div class="nav"><div class="brand">Grok Bot</div></div><h1>Open your desk link</h1>
      <div class="list plain"><div class="row"><div class="tx"><div class="t">This app needs your private desk link</div>
      <div class="s">Ask Grok Bot on Telegram for the app link and open it once on this phone.</div></div></div></div>`;
  }

  // ---------- HOME ----------
  function renderHome(scr) {
    const st = D.state;
    const nav = `<div class="nav"><button class="iconbtn" data-go="account" aria-label="Account"><span class="avatar">G</span></button>
      <button class="brand" data-go="agents">Grok Bot<span>›</span></button><div class="grow"></div>
      <button class="iconbtn" data-search aria-label="Search">${ICON.search}</button>
      <button class="iconbtn" data-go="activity" aria-label="Activity">${ICON.bell}${st && unread() ? '<i class="dot"></i>' : ""}</button></div>`;
    const search = ui.searchOpen ? searchPanel() : "";
    if (!st) {
      scr.innerHTML = nav + `<div style="margin-top:6px">${sk("230px", "66px")}</div><div style="margin-top:10px">${sk("150px", "22px")}</div>
        <div style="margin:18px 0 0">${sk("100%", "240px")}</div><div style="margin-top:8px">${sk("100%", "44px")}</div>
        <h2>${sk("170px", "26px")}</h2><div class="car">${[0, 1].map(() => `<div class="acard sk"></div>`).join("")}</div>
        <h2>${sk("120px", "26px")}</h2><div>${sk("100%", "300px", "border-radius:14px")}</div>`;
      odo.el = null; return;
    }
    const running = (st.agents || []).filter(a => a.status === "running").length;
    const t = st.today_pct;
    scr.innerHTML = nav + search + `<div class="balrow"><div class="bal" id="odo-slot"></div>${st.paper ? '<span class="pill paper">PAPER</span>' : ""}</div>
      <div class="today"><span class="${t >= 0 ? "up" : "down"}">${pct(t)}</span><span class="sub">today</span>
        ${num(st.multiplier) ? `<span class="pill mult">${st.multiplier.toFixed(2)}×</span>` : ""}</div>
      <div class="chartbox" id="chartbox"></div>
      <div class="ranges">${["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(r => `<button data-range="${r}" class="${r === ui.range ? "on" : ""}">${r}</button>`).join("")}</div>
      <h2>Agents · ${running} running</h2>
      <div class="car">${ORDER.map(n => agentCard(agent(n), n)).join("")}</div>
      <h2>Activity<button class="see" data-go="activity">See all</button></h2>
      ${actList((D.activity && D.activity.rows || []).slice(0, 5))}`;
    if (!odo.el) { odo.el = document.createElement("div"); odo.el.className = "bal"; odo.el.style.display = "contents"; }
    $("#odo-slot").appendChild(odo.el);
    odoSet(odo.el, money(st.balance));
    homeChart();
  }
  let chartCanvas = null, chartMsg = null;
  function homeChart() {
    const box = $("#chartbox"); if (!box) return;
    if (!chartCanvas) { chartCanvas = document.createElement("canvas"); chartMsg = document.createElement("div"); chartMsg.className = "chartmsg"; }
    box.appendChild(chartCanvas); box.appendChild(chartMsg);
    const rg = D.chart && D.chart.ranges && D.chart.ranges[ui.range] || { points: [], marks: [] };
    const all = D.chart && D.chart.ranges && D.chart.ranges.ALL || { marks: [] };
    const st = D.state;
    const start = num(st.multiplier) && st.multiplier ? st.balance / st.multiplier : null; // balance at night start
    chartMsg.textContent = (all.marks || []).length ? "" : "Waiting for the first trade";
    requestAnimationFrame(() => Charts.line(chartCanvas, { points: rg.points || [], marks: rg.marks || [], start, key: ui.range }));
  }
  function searchPanel() {
    const q = ui.search.trim().toLowerCase();
    const res = q ? knownCoins().filter(c => [c.name, c.symbol, c.mint].some(x => x && String(x).toLowerCase().includes(q))).slice(0, 8) : [];
    return `<div class="search">${ICON.search.replace("<svg", '<svg style="width:18px;height:18px;stroke:rgba(235,235,245,.6);fill:none;stroke-width:2"')}
      <input id="q" placeholder="Name, symbol or mint" value="${esc(ui.search)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      ${q ? (res.length ? `<div class="list plain" style="margin-bottom:12px">${res.map(c => `<button class="row" data-coin="${esc(c.mint)}"><div class="tx"><div class="t">${esc(c.name)}${c.symbol ? ` <span class="mut">${esc(c.symbol)}</span>` : ""}</div><div class="s mono">${esc(c.mint)}</div></div><span class="chev">›</span></button>`).join("")}</div>`
        : `<div class="note" style="padding-bottom:12px">No coin from tonight matches</div>`) : ""}`;
  }

  // ---------- agent cards (carousel) ----------
  function head(a, n) {
    const status = !a ? "" : a.stale ? `<span class="sdot stale"></span>no heartbeat` : a.status === "paused" ? `<span class="sdot paused"></span>paused` : `<span class="sdot"></span>running`;
    return `<div class="ahead"><span style="color:${COLOR[n]}">${n[0].toUpperCase() + n.slice(1)}</span><span class="st">${status}</span></div>`;
  }
  function agentCard(a, n) {
    if (!a) return `<div class="acard sk"></div>`;
    let body = "";
    if (n === "scanner") {
      const feed = (a.feed || []).slice(0, 4);
      body = `<div class="abig">${esc(a.headline)}</div><div class="feed">${feed.length ? feed.map(f => f.verdict === "pass"
        ? `<div class="r"><span class="n">${esc(f.name)}</span><span class="w" style="color:#64d2ff">→ auditor</span></div>`
        : `<div class="r killed"><span class="n">${esc(f.name)}</span><span class="w">${esc(reasonOf(f.text))}</span></div>`).join("")
        : `<div class="mut" style="margin-top:8px">Listening for graduations</div>`}</div>`;
    } else if (n === "auditor") {
      const strips = (a.strips || []).slice(0, 3);
      body = `<div class="abig">${esc(a.headline)}</div><div class="strips">${strips.length ? strips.map(s => {
        const st = s.strip || [], fail = st.includes(false), all = st.length === 8 && st.every(x => x === true);
        const d = decisions("auditor").find(x => x.mint === s.mint);
        const w = fail ? (d ? reasonOf(d.text) : "rejected") : all ? "8/8 → Executor" : "taking apart...";
        return `<button class="strip" data-audit="${esc(s.mint)}" style="min-height:44px;text-align:left"><span class="grid8">${st.map(x => `<i class="${x === true ? "p" : x === false ? "f" : ""}"></i>`).join("")}</span>
          <span class="n">${esc(s.name)}</span><span class="w" style="${fail ? "color:#ff453a" : all ? "color:#00d35a" : ""}">${esc(w)}</span></button>`;
      }).join("") : `<div class="mut">No coin taken apart yet</div>`}</div><div class="afoot">${esc(a.rejected_text)}</div>`;
    } else if (n === "analyst") {
      body = `<div class="abig">${esc(a.headline)}</div><canvas class="ring" data-ring="${num(a.score) ? a.score : ""}" data-min="${num(a.min_score) ? a.min_score : ""}"></canvas>
        <div class="afoot">${num(a.score) ? `Green from ${esc(a.min_score)}` : "No coin scored yet"}</div>`;
    } else if (n === "executor") {
      const d = decisions("executor")[0];
      const filled = d && (d.verdict === "filled" || (D.activity && D.activity.rows || []).some(r => r.kind === "bought" && r.mint === d.mint && r.ts >= d.ts - 5));
      const failed = d && (d.verdict === "missed" || d.verdict === "push failed");
      body = `<div class="abig">${esc(a.headline)}</div>
        <div class="sub" style="font-size:17px">${num(a.size_usd) ? `${money(a.size_usd)} · ${esc(a.stack_pct)}% of stack` : `No trade yet · ${esc(a.stack_pct)}% of stack per trade`}</div>
        ${d ? `<div class="bar"><i style="width:${filled ? 100 : 0}%"></i></div>
          <div style="font-size:15px;${filled ? "color:#00d35a" : failed ? "color:#ff453a" : ""}">${filled ? "✓ Filled" : failed ? esc(d.verdict) : "Executing..."}</div>
          <div class="afoot">${esc(d.name)} · ${hhmm(d.ts)}</div>` : ""}`;
    } else if (n === "risk") {
      body = `<div class="abig">${esc(a.headline)}</div><div class="sub">${a.open === 1 ? "1 open position" : `${esc(a.open)} open positions`}</div>
        <div class="pills"><span class="mpill" style="color:#ff453a">${esc((a.pills || [])[0] || "")}</span><span class="mpill" style="color:#00d35a">${esc((a.pills || [])[1] || "")}</span></div>
        <div class="afoot">${(a.last || [])[0] ? esc(a.last[0]) : "No exits yet tonight"}</div>`;
    }
    return `<div class="acard">${head(a, n)}${body}</div>`;
  }
  function drawCards() {
    document.querySelectorAll("canvas[data-ring]").forEach(cv => {
      const s = cv.dataset.ring === "" ? null : +cv.dataset.ring, m = cv.dataset.min === "" ? null : +cv.dataset.min;
      requestAnimationFrame(() => Charts.ring(cv, s, m));
    });
  }

  // ---------- activity rows ----------
  function actRow(r) {
    const col = r.kind === "bought" ? "#0a84ff" : r.kind === "sold" ? "#00d35a" : r.kind === "stopped" ? "#ff453a" : "#3a3a3c";
    const sym = r.kind === "bought" ? "+" : r.kind === "sold" ? "$" : r.kind === "stopped" ? "−" : "×";
    const vcol = r.kind === "sold" ? (String(r.value).startsWith("-") ? "down" : "up") : r.kind === "stopped" ? "down" : r.kind === "rejected" ? "ter" : "";
    const v = String(r.value || "").split(" · ");
    const tap = r.kind === "rejected" ? `data-audit="${esc(r.mint)}"` : `data-coin="${esc(r.mint)}"`;
    return `<button class="row" ${r.mint ? tap : ""}><span class="ic" style="background:${col};${r.kind === "rejected" ? "color:#fff" : ""}">${sym}</span>
      <div class="tx"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.subtitle)}${r.kind !== "bought" ? ` · ${hhmm(r.ts)}` : ""}</div></div>
      <div class="v ${vcol}">${esc(v[0])}${v[1] ? `<div class="s" style="text-align:right">${esc(v.slice(1).join(" · "))}</div>` : ""}</div></button>`;
  }
  function actList(rows) {
    if (!D.activity) return sk("100%", "300px", "border-radius:14px");
    return rows.length ? `<div class="list">${rows.map(actRow).join("")}</div>` : `<div class="list"><div class="empty">Nothing yet tonight</div></div>`;
  }
  function activityTab() {
    const rows = D.actPages.flatMap(p => p.rows || []);
    const last = D.actPages[D.actPages.length - 1];
    return `<div class="nav"></div><h1>Activity</h1>${actList(rows)}
      ${last && last.page < last.pages ? `<button class="more" data-more>Show more</button>` : ""}`;
  }

  // ---------- AGENTS TAB ----------
  function agentsTab() {
    if (!D.state) return `<div class="nav"></div><h1>Agents</h1>${ORDER.map(() => `<div class="fcard sk" style="height:220px"></div>`).join("")}`;
    return `<div class="nav"></div><h1>Agents</h1>${ORDER.map(n => {
      const a = agent(n); if (!a) return "";
      const ds = decisions(n).slice(0, 20);
      return `<div class="fcard">${head(a, n)}
        <div style="display:flex;align-items:baseline;gap:8px;margin:8px 0 4px"><span class="abig" style="margin:0">${esc(a.today)}</span><span class="sub">today · ${esc(a.headline)}</span></div>
        <div class="sub" style="margin-bottom:10px">${a.status === "paused" ? "Paused" : "Not paused"} · Change by Telegram command: <span class="mono">${a.status === "paused" ? "resume" : "pause"} ${esc(a.title)}</span></div>
        ${ds.length ? ds.map(d => `<div class="dec"><span class="tm">${hhmm(d.ts)}</span>
          ${safeUrl(d.coin_url) ? `<a class="coin" href="${esc(safeUrl(d.coin_url))}" target="_blank" rel="noopener noreferrer">${esc(d.name)}</a>` : `<span>${esc(d.name)}</span>`}
          <span class="vd" style="color:${/^(pass|sent|filled|trail)$/.test(d.verdict) ? "#00d35a" : /^(kill|reject|stop|missed|push failed)$/.test(d.verdict) ? "#ff453a" : "rgba(235,235,245,.6)"}">${esc(d.verdict)}</span>
          <span class="why">${esc(d.text)}</span></div>`).join("") : `<div class="dec"><span></span><span class="mut">No decisions yet</span><span></span></div>`}</div>`;
    }).join("")}`;
  }

  // ---------- ACCOUNT TAB ----------
  function fmtSetting(v) { return typeof v === "boolean" ? (v ? "on" : "off") : typeof v === "number" ? String(v) : String(v); }
  function accountTab() {
    const st = D.state;
    if (!st) return `<div class="nav"></div><h1>Account</h1>${sk("100%", "320px", "border-radius:14px")}`;
    const ac = st.account || {}, tg = ac.telegram && ac.telegram.connected;
    const groups = {};
    Object.keys(st.settings || {}).sort().forEach(k => { const g = k.split(".")[0]; (groups[g] = groups[g] || []).push(k); });
    const prof = safeUrl(ac.profile_url);
    return `<div class="nav"></div><h1>Account</h1>
      <div class="list plain wrap">
        <div class="row"><div class="tx"><div class="t">Telegram</div></div><div class="v ${tg ? "up" : "down"}">${tg ? "Connected" : "Not connected"}</div></div>
        <div class="row"><div class="tx"><div class="t">Mode</div><div class="s">Change by Telegram command: <span class="mono">paper</span> or <span class="mono">live</span></div></div><div class="v">${st.paper ? '<span class="pill paper">PAPER</span>' : "LIVE"}</div></div>
        <div class="row"><div class="tx"><div class="t">Stack</div></div><div class="v">${money(ac.stack)}</div></div>
        ${prof ? `<a class="row" href="${esc(prof)}" target="_blank" rel="noopener noreferrer"><div class="tx"><div class="t">FOMO profile</div><div class="s">@${esc(st.settings && st.settings["desk.fomo_handle"])}</div></div><span class="chev">›</span></a>` : ""}
        <button class="row" data-invite><div class="tx"><div class="t">Invite a friend</div><div class="s">Share your FOMO invite link</div></div><span class="chev">›</span></button>
        <div class="row"><div class="tx"><div class="t">Enable notifications</div><div class="s">Plan B has no web push. Notifications come by Telegram only.</div></div></div>
      </div>
      <h2>Settings</h2><div class="note" style="padding:0 0 10px">Read-only here. Change by Telegram command, for example <span class="mono">set stop to -8%</span>, <span class="mono">set trail to 15%</span>, <span class="mono">set score to 75</span>, <span class="mono">pause Scanner</span>, <span class="mono">resume Scanner</span>.</div>
      ${Object.keys(GROUPS).filter(g => groups[g]).concat(Object.keys(groups).filter(g => !GROUPS[g])).map(g => `<div class="sub" style="margin:16px 0 6px 16px">${esc(GROUPS[g] || g)}</div>
        <div class="list plain">${groups[g].map(k => `<div class="row" style="min-height:44px"><div class="tx"><div class="t mono" style="font-size:14px">${esc(k.slice(g.length + 1))}</div></div><div class="v mut">${esc(fmtSetting(st.settings[k]))}</div></div>`).join("")}</div>`).join("")}`;
  }
  async function invite() {
    const url = safeUrl(D.state && D.state.account && D.state.account.signup_url); if (!url) return;
    if (navigator.share) { try { await navigator.share({ title: "Grok Bot", url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(url); } catch (e) {
      const t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e2) {} t.remove();
    }
    toast("Link copied");
  }
  function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 1800); }

  // ---------- OVERLAYS: coin + auditor ----------
  async function open(kind, mint) {
    ui.overlay = { kind, mint, sig: null, played: false };
    renderOverlay();
    if (!D.coins[mint] && !D.coinMissing[mint]) { try { await loadCoin(mint); } catch (e) {} renderOverlay(); }
  }
  function renderOverlay() {
    const ov = $("#overlay"), o = ui.overlay;
    if (!o) { ov.hidden = true; ov.innerHTML = ""; document.body.style.overflow = ""; return; }
    ov.hidden = false; document.body.style.overflow = "hidden";
    const c = D.coins[o.mint];
    const sig = JSON.stringify([o.kind, c || null, D.coinMissing[o.mint] || false, net.failing, o.kind === "auditor" ? decisions("auditor").find(d => d.mint === o.mint) : null, decisions("executor").find(d => d.mint === o.mint) || null]);
    if (sig === o.sig) return;
    const y = o.sig ? ov.scrollTop : 0;
    o.sig = sig;
    ov.innerHTML = o.kind === "coin" ? coinScreen(o.mint) : auditScreen(o.mint);
    ov.scrollTop = y;
    if (o.kind === "coin" && c) {
      const cv = ov.querySelector("canvas.cnd");
      const ex = c.exits;
      const exit = ex ? (ex.trail_active && num(ex.trail_price) ? Math.max(ex.trail_price, ex.stop_price || 0) : ex.stop_price) : null;
      requestAnimationFrame(() => Charts.candles(cv, { candles: c.candles, exit: num(exit) ? exit : null, exitLabel: ex && ex.trail_active ? "Risk trailing stop" : "Risk stop" }));
    }
    if (o.kind === "auditor") beam(ov, o);
  }
  function coinScreen(mint) {
    const c = D.coins[mint];
    if (!c) {
      if (D.coinMissing[mint]) return backBar() + `<h1>Coin</h1><div class="list plain"><div class="empty">No data published for this coin yet</div></div>`;
      return backBar() + `<div style="margin-top:6px">${sk("60%", "32px")}</div><div style="margin-top:8px">${sk("40%", "18px")}</div><div style="margin-top:14px">${sk("70%", "66px")}</div>
        <div style="margin:16px 0">${sk("100%", "280px")}</div>${sk("100%", "140px", "border-radius:14px")}`;
    }
    const st = D.state || {}, p = c.position, ex = c.exits, open_ = !!(p && p.open);
    const passed = (c.audit || []).filter(l => l.pass === true).length;
    const since = p && num(p.entry_price) && num(c.price) && p.entry_price ? (c.price / p.entry_price - 1) * 100 : null;
    const url = safeUrl(c.coin_url);
    const pr = price(c.price);
    return backBar(st.paper ? '<span class="pill paper">PAPER</span>' : "") + `
      <div class="ctitle">${esc(c.name || c.symbol || c.mint)}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="sub">${esc(c.symbol || "")}${c.symbol ? " · " : ""}Solana</span>
        <button class="chip" data-audit="${esc(c.mint)}" style="min-height:44px;background:none;padding:0">
          <span class="chip">${ICON.shield}${passed}/8</span></button></div>
      <div class="price ${pr.length > 9 ? "small" : ""}">${esc(pr)}</div>
      ${since != null ? `<div class="today"><span class="${since >= 0 ? "up" : "down"}">${since >= 0 ? "▲" : "▼"} ${Math.abs(since).toFixed(2)}%</span><span class="sub">since entry</span></div>` : ""}
      <div class="candles"><canvas class="cnd"></canvas></div><div class="note" style="padding:6px 0 0">1-minute candles · volume bars</div>
      <div class="stats"><div><span>Market cap</span><b>${big(c.stats && c.stats.market_cap)}</b></div><div><span>Liquidity</span><b>${big(c.stats && c.stats.liquidity_usd)}</b></div>
        <div><span>24h volume</span><b>${big(c.stats && c.stats.volume_24h)}</b></div><div><span>Holders</span><b>${num(c.stats && c.stats.holders) ? c.stats.holders.toLocaleString("en-US") : "n/a"}</b></div></div>
      ${p ? `<div class="card"><div class="t" style="font-weight:600">Your position · ${money(p.size_usd)} in · Executor</div>
        <div class="s mut" style="font-size:13px;margin-top:2px">${open_ ? `Opened ${hhmm(p.opened_at)} at ${price(p.entry_price)}` : `Closed ${hhmm(p.closed_at)} · ${esc(p.exit_reason || "")} · ${num(p.pnl_usd) ? (p.pnl_usd >= 0 ? "+" : "") + money(p.pnl_usd) : "n/a"}`}</div></div>` : ""}
      ${open_ && ex ? `<div class="card"><div class="t" style="font-weight:600;margin-bottom:4px">Exit</div>
        <div class="row"><div class="tx">Stop line</div><div class="v"><span class="mono down">-${esc(ex.stop_pct)}%</span> · ${price(ex.stop_price)}</div></div>
        <div class="row"><div class="tx">Trail line</div><div class="v">${ex.trail_active && num(ex.trail_price) ? `<span class="mono up">${esc(ex.trail_pct)}%</span> · ${price(ex.trail_price)}` : `<span class="mut">starts at ${price(ex.trail_start_price)}</span>`}</div></div>
        <div class="row"><div class="tx">Time left to timeout</div><div class="v">${dur(ex.time_left_s - (net.lastOk ? 0 : 0))}</div></div></div>` : ""}
      ${url ? `<a class="cta ${open_ ? "sell" : ""}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${open_ ? "Sell on FOMO" : "Buy on FOMO"}</a>` : ""}`;
  }
  function auditLayers(mint) {
    const c = D.coins[mint]; if (c && c.audit) return { layers: c.audit, name: c.name || c.symbol || mint, url: c.coin_url };
    const d = decisions("auditor").find(x => x.mint === mint);
    return d ? { layers: d.layers || [], name: d.name, url: d.coin_url } : null;
  }
  function auditScreen(mint) {
    const a = auditLayers(mint);
    if (!a) {
      if (D.coinMissing[mint] || D.agents.auditor) return backBar() + `<h1>Auditor</h1><div class="list plain"><div class="empty">No coin taken apart yet</div></div>`;
      return backBar() + `<div style="margin-top:6px">${sk("60%", "32px")}</div><div style="margin:16px auto;width:220px">${sk("220px", "340px", "border-radius:110px")}</div>${sk("100%", "300px", "border-radius:14px")}`;
    }
    const L = a.layers, fail = L.find(l => l.pass === false), all = L.length === 8 && L.every(l => l.pass === true);
    const sig = decisions("executor").find(d => d.mint === mint);
    const url = safeUrl(a.url);
    let verdict = "";
    if (fail) verdict = `<div class="verdict f">Rejected · ${esc(fail.value)}</div><div class="sub" style="margin-top:4px">Grok Bot won't buy ${esc(a.name)}</div>`;
    else if (all) verdict = `<div class="verdict p">Cleared · 8/8 parts</div><div class="sub" style="margin-top:4px">${sig && num(sig.size_usd) ? `Sent to Executor · ${money(sig.size_usd)}` : "Passed on toward Executor · no trade sent yet"}</div>`;
    else verdict = `<div class="verdict">Taking apart · ${L.filter(l => l.pass !== null).length}/8 checked</div>`;
    return backBar() + `<h1 style="margin-bottom:0">${esc(a.name)}</h1><div class="sub">Auditor · 8 layers</div>
      <div class="stack" id="stack">${L.map((l, i) => `<div class="disc" data-i="${i}" data-r="${l.pass === true ? "p" : l.pass === false ? "f" : "n"}" style="top:${i * 36}px;z-index:${10 - i}"><span class="mk">${l.pass === true ? "✓" : l.pass === false ? "✕" : "–"}</span></div>`).join("")}<div class="beam" id="beam"></div></div>
      <div class="verdict-wrap" id="verdict" style="opacity:0">${verdict}</div>
      <div class="list plain" style="margin-top:16px">${L.map(l => `<div class="row lrow" style="min-height:52px"><span class="ic" style="width:24px;height:24px;background:${l.pass === true ? "#00d35a" : l.pass === false ? "#ff453a" : "#3a3a3c"};${l.pass == null ? "color:rgba(235,235,245,.6)" : ""}">${l.pass === true ? "✓" : l.pass === false ? "✕" : "–"}</span>
        <div class="tx"><div class="t">${esc(l.n)}. ${esc(l.name)}</div>${l.source ? `<div class="s">${esc(l.source)}</div>` : ""}</div><div class="v ${l.pass === false ? "down" : l.pass == null ? "ter" : ""}">${esc(l.value)}</div></div>`).join("")}</div>
      ${url ? `<a class="cta gray" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ""}`;
  }
  function beam(ov, o) {
    const discs = [...ov.querySelectorAll(".disc")], bm = ov.querySelector("#beam"), vd = ov.querySelector("#verdict");
    if (!bm || !vd) return;
    const finish = () => { discs.forEach(d => d.classList.add(d.dataset.r)); vd.style.opacity = 1; };
    if (reduced() || o.played) { finish(); return; }
    o.played = true;
    let i = 0;
    bm.style.opacity = 1;
    (function next() {
      if (!document.body.contains(bm)) return;
      if (i >= discs.length) { bm.style.opacity = 0; vd.style.transition = "opacity .15s"; vd.style.opacity = 1; return; }
      const d = discs[i], top = d.offsetTop, h = d.offsetHeight, t0 = performance.now();
      (function f(now) {
        const t = Math.min(1, (now - t0) / 350);
        bm.style.top = (top + t * h) + "px";
        if (t < 1) return requestAnimationFrame(f);
        d.classList.add(d.dataset.r); // 150ms css transition to green/red/grey
        i++; setTimeout(next, 150);
      })(t0);
    })();
  }

  // ---------- events ----------
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-tab],[data-go],[data-range],[data-coin],[data-audit],[data-back],[data-more],[data-invite],[data-search]");
    if (!t) return;
    if (t.dataset.tab || t.dataset.go) {
      ui.tab = t.dataset.tab || t.dataset.go; ui.overlay = null;
      if (ui.tab === "activity") store.set("desk.seen", String(latestActId()));
      window.scrollTo(0, 0); render();
    } else if (t.dataset.range) { ui.range = t.dataset.range; render(); }
    else if (t.dataset.coin) open("coin", t.dataset.coin);
    else if (t.dataset.audit) open("auditor", t.dataset.audit);
    else if ("back" in t.dataset) { ui.overlay = null; renderOverlay(); }
    else if ("invite" in t.dataset) invite();
    else if ("search" in t.dataset) { ui.searchOpen = !ui.searchOpen; render(); const q = $("#q"); if (q) q.focus(); }
    else if ("more" in t.dataset) {
      const last = D.actPages[D.actPages.length - 1];
      try { D.actPages.push(await getJSON("activity/" + (last.page + 1) + ".json")); } catch (err) {}
      render();
    }
  });
  document.addEventListener("input", e => {
    if (e.target.id !== "q") return;
    ui.search = e.target.value; const pos = e.target.selectionStart; render();
    const q = $("#q"); if (q) { q.focus(); q.setSelectionRange(pos, pos); }
  });
  window.addEventListener("resize", () => { if (D.state) render(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  window.desk = { open, go: tab => { ui.tab = tab; ui.overlay = null; render(); } }; // used by local screenshot tests
  render();
  poll();
})();
