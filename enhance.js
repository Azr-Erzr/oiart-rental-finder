/* ============================================================================
   enhance.js — motion & polish layer (progressive enhancement only)
   ----------------------------------------------------------------------------
   Patterns follow motion.dev (inView scroll reveals, eased count-ups) and the
   library itself is pulled from its CDN when reachable for spring micro-
   interactions. Everything here is optional: if this file fails to load or
   the CDN is blocked, the site renders fully visible and fully functional —
   the CSS only hides [data-reveal] elements AFTER <html> gets .js-anim below.
   Respects prefers-reduced-motion throughout.
   ========================================================================== */
(function(){
  "use strict";
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- scroll reveals (motion.dev inView pattern, dependency-free) ------- */
  document.documentElement.classList.add("js-anim");
  const reveals = [].slice.call(document.querySelectorAll("[data-reveal]"));
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach(el => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.07, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(el => io.observe(el));
    // anything already above the fold reveals immediately on load
    requestAnimationFrame(() => reveals.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight * 0.9) el.classList.add("in");
    }));
  }

  /* ---- optional motion.dev spring for KPI pulse (graceful if offline) ---- */
  let springPulse = null;
  if (!reduce) {
    import("https://cdn.jsdelivr.net/npm/motion@11.13.5/+esm").then(M => {
      if (M && M.animate) springPulse = el =>
        M.animate(el, { scale: [0.86, 1] }, { type: "spring", stiffness: 320, damping: 18 });
    }).catch(() => { /* CDN unreachable — count-up still runs without the pulse */ });
  }

  /* ---- KPI number count-up (first paint only; 60s refreshes stay calm) -- */
  const armedUntil = Date.now() + 5000;
  function countUp(el){
    if (el.dataset.counted) return;
    el.dataset.counted = "1";
    const target = parseInt(String(el.textContent).replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(target) || target === 0 || reduce || Date.now() > armedUntil) return;
    if (springPulse) springPulse(el);
    const t0 = performance.now(), dur = 950;
    (function tick(t){
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 4);            // easeOutQuart
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(tick); else el.textContent = String(target);
    })(t0);
  }
  const kpis = document.getElementById("kpis");
  if (kpis && "MutationObserver" in window) {
    const scan = () => kpis.querySelectorAll(".kpi .num").forEach(countUp);
    new MutationObserver(scan).observe(kpis, { childList: true, subtree: true });
    scan();
  }
})();
