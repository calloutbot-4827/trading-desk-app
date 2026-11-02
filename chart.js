/* Canvas charts: Home line, Coin candles, score ring. devicePixelRatio aware. No library. */
(function () {
  const C = { green: "#00d35a", red: "#ff453a", orange: "#ff9f0a", blue: "#0a84ff", cyan: "#64d2ff",
    sec: "rgba(235,235,245,0.6)", ter: "rgba(235,235,245,0.3)", sep: "rgba(84,84,88,0.55)", c1: "#1c1c1e", c2: "#2c2c2e" };
  const FONT = '-apple-system,"SF Pro Text",BlinkMacSystemFont,Helvetica,Arial,sans-serif';
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setup(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function anim(ms, step) {
    if (reduced() || ms <= 0) { step(1); return; }
    const t0 = performance.now();
    (function f(now) { const t = Math.min(1, (now - t0) / ms); step(1 - Math.pow(1 - t, 3)); if (t < 1) requestAnimationFrame(f); })(t0);
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }

  /* ---------- line chart ---------- */
  const lineState = new WeakMap();
  function line(cv, data) { // data: {points:[[ts,v]], marks:[{ts,label,color,row}], start:number|null, key:string}
    const prev = lineState.get(cv) || {};
    const pts = data.points || [], same = prev.key === data.key;
    const oldLast = same && prev.pts && prev.pts.length ? prev.pts[prev.pts.length - 1] : null;
    const isNewPoint = same && oldLast && pts.length && pts[pts.length - 1][0] > oldLast[0];
    const seen = same ? (prev.seen || new Set()) : new Set();
    const newMarks = (data.marks || []).filter(m => !seen.has(m.ts + m.label));
    lineState.set(cv, { key: data.key, pts, seen: new Set((data.marks || []).map(m => m.ts + m.label)) });
    const ms = Math.max(isNewPoint ? 250 : 0, newMarks.length && same ? 200 : 0);
    anim(ms, t => draw(t));
    function draw(t) {
      const { ctx, w, h } = setup(cv);
      const top = 64, bot = h - 16, padL = 16, padR = 16;
      const vals = pts.map(p => p[1]); if (data.start != null) vals.push(data.start);
      if (!vals.length) return;
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      const t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 1;
      const X = ts => padL + (t1 > t0 ? (ts - t0) / (t1 - t0) : 1) * (w - padL - padR);
      const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
      if (data.start != null) { // dashed start line
        ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, Y(data.start)); ctx.lineTo(w, Y(data.start)); ctx.stroke(); ctx.restore();
      }
      if (pts.length < 2) return;
      // new point slides in: last point interpolated from the previous last point
      const xy = pts.map(p => [X(p[0]), Y(p[1])]);
      if (isNewPoint && t < 1) {
        const a = xy[xy.length - 2], b = xy[xy.length - 1];
        xy[xy.length - 1] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      const grad = ctx.createLinearGradient(0, top, 0, bot);
      grad.addColorStop(0, "rgba(0,211,90,0.28)"); grad.addColorStop(1, "rgba(0,211,90,0)");
      ctx.beginPath(); xy.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.lineTo(xy[xy.length - 1][0], bot); ctx.lineTo(xy[0][0], bot); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); xy.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
      const last = xy[xy.length - 1];
      ctx.beginPath(); ctx.arc(last[0], last[1], 4, 0, 7); ctx.fillStyle = C.green; ctx.fill();
      // marks above the line, later overlapping one a row up (row from data); horizontal collision bumps further
      ctx.font = "600 12px " + FONT; ctx.textBaseline = "middle";
      const placed = [];
      (data.marks || []).forEach(m => {
        if (m.ts < t0 || m.ts > t1) return;
        const x = X(m.ts), v = valueAt(pts, m.ts), y0 = Y(v);
        const col = m.color === "blue" ? C.blue : m.color === "green" ? C.green : C.red;
        const tw = ctx.measureText(m.label).width + 16, bh = 22;
        let bx = Math.max(4, Math.min(w - tw - 4, x - tw / 2)), row = m.row || 0, by;
        for (;;) {
          by = Math.max(2, y0 - 14 - bh - row * (bh + 4));
          if (!placed.some(p => bx < p.x + p.w + 4 && p.x < bx + tw + 4 && by < p.y + bh + 2 && p.y < by + bh + 2)) break;
          row++; if (row > 8) break;
        }
        placed.push({ x: bx, y: by, w: tw });
        const isNew = newMarks.includes(m);
        ctx.globalAlpha = isNew && same ? t : 1;
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, by + bh); ctx.lineTo(x, y0 - 3); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y0, 3, 0, 7); ctx.fillStyle = col; ctx.fill();
        rr(ctx, bx, by, tw, bh, 11); ctx.fillStyle = col; ctx.fill();
        ctx.fillStyle = m.color === "blue" || m.color === "red" ? "#fff" : "#000"; ctx.fillText(m.label, bx + 8, by + bh / 2 + 0.5);
        ctx.globalAlpha = 1;
      });
    }
  }
  function valueAt(pts, ts) {
    if (!pts.length) return 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][0] >= ts) {
      const a = pts[i - 1], b = pts[i], f = b[0] > a[0] ? (ts - a[0]) / (b[0] - a[0]) : 1; return a[1] + (b[1] - a[1]) * f;
    }
    return pts[pts.length - 1][1];
  }

  /* ---------- candles ---------- */
  function candles(cv, data) { // {candles:[{t,o,h,l,c,v}], exit:number|null, exitLabel}
    const { ctx, w, h } = setup(cv);
    const cs = data.candles || [];
    if (!cs.length) { ctx.fillStyle = C.sec; ctx.font = "15px " + FONT; ctx.textAlign = "center"; ctx.fillText("No price data yet", w / 2, h / 2); return; }
    const padL = 16, padR = 64, volH = 44, top = 12, bot = h - volH - 14;
    const n = Math.min(cs.length, 90), view = cs.slice(-n);
    let lo = Math.min(...view.map(c => c.l)), hi = Math.max(...view.map(c => c.h));
    if (data.exit != null) { lo = Math.min(lo, data.exit); hi = Math.max(hi, data.exit); }
    if (hi - lo <= 0) { hi += Math.abs(hi) * 0.01 || 1; lo -= Math.abs(lo) * 0.01 || 1; }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const Y = v => bot - (v - lo) / (hi - lo) * (bot - top);
    const slot = (w - padL - padR) / Math.max(n, 20), bw = Math.max(2, slot * 0.66);
    const vmax = Math.max(...view.map(c => c.v), 0);
    ctx.strokeStyle = C.sep; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 3; i++) { const y = top + i * (bot - top) / 3; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR + 8, y); ctx.stroke(); }
    ctx.font = "11px " + FONT; ctx.fillStyle = C.sec; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    for (let i = 0; i <= 3; i++) { const v = hi - i * (hi - lo) / 3; ctx.fillText(fmtP(v), w - padR + 12, top + i * (bot - top) / 3); }
    view.forEach((c, i) => {
      const x = padL + i * slot + slot / 2, up = c.c >= c.o, col = up ? C.green : C.red;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      if (vmax > 0) { const vh = c.v / vmax * volH; ctx.globalAlpha = 0.45; ctx.fillRect(x - bw / 2, h - vh, bw, vh); ctx.globalAlpha = 1; }
    });
    if (data.exit != null) {
      const y = Y(data.exit);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR + 8, y); ctx.stroke(); ctx.restore();
      ctx.font = "600 11px " + FONT; ctx.textAlign = "left";
      const lab = data.exitLabel || "Risk trailing stop", lw = ctx.measureText(lab).width + 12;
      const ly = y - 20 < top ? y + 4 : y - 20;
      rr(ctx, padL, ly, lw, 16, 8); ctx.fillStyle = "#000"; ctx.fill();
      ctx.fillStyle = C.orange; ctx.fillText(lab, padL + 6, ly + 8.5);
    }
  }
  function fmtP(v) { if (v === 0) return "0"; const a = Math.abs(v); if (a >= 1) return v.toFixed(a >= 100 ? 0 : 2); return v.toPrecision(3); }

  /* ---------- score ring ---------- */
  function ring(cv, score, min) {
    const { ctx, w, h } = setup(cv);
    if (w < 24 || h < 24) return;
    const r = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2;
    ctx.lineWidth = 10; ctx.lineCap = "round";
    ctx.strokeStyle = C.c2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    if (score != null) {
      const ok = score >= (min == null ? 70 : min);
      ctx.strokeStyle = ok ? C.green : C.sec;
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, Math.min(1, score / 100)) * Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = '600 40px -apple-system,"SF Pro Display",BlinkMacSystemFont,Helvetica,sans-serif';
    ctx.fillText(score == null ? "–" : String(Math.round(score)), cx, cy - 4);
    ctx.font = "12px " + FONT; ctx.fillStyle = C.sec; ctx.fillText("of 100", cx, cy + 24);
  }

  window.Charts = { line, candles, ring };
})();
