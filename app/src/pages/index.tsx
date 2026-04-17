import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import ShadowLoader from "../components/ShadowLoader";

function detectLightTheme(): boolean {
  if (typeof window === "undefined") return false;
  const saved = window.localStorage.getItem("shadow-theme");
  if (saved === "light") return true;
  if (saved === "dark") return false;
  return document.documentElement.classList.contains("light");
}

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorGlowRef = useRef<HTMLDivElement>(null);
  const orb1Ref = useRef<HTMLDivElement>(null);
  const orb2Ref = useRef<HTMLDivElement>(null);
  const orb3Ref = useRef<HTMLDivElement>(null);
  const orb4Ref = useRef<HTMLDivElement>(null);
  const decryptRef = useRef<HTMLSpanElement>(null);
  const [isLight, setIsLight] = useState(false);
  const [ready, setReady] = useState(false);

  // ── Intro loader ─────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // ── Theme init ────────────────────────────────────────────────
  useEffect(() => {
    setIsLight(detectLightTheme());
  }, []);

  useEffect(() => {
    localStorage.setItem("shadow-theme", isLight ? "light" : "dark");
    document.documentElement.classList.toggle("light", isLight);
  }, [isLight]);

  const toggleTheme = () => {
    setIsLight((current) => !current);
  };

  // ── Dot grid pulse canvas ────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, rafId = 0, lastFrame = 0, time = 0;
    const GRID = 44;
    const FRAME_INTERVAL = 1000 / 15;
    const WAVE_SPEED = 0.004;
    const WAVE_WIDTH = 160;
    type Dot = { x: number; y: number };
    let dots: Dot[] = [];

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
      dots = [];
      const cols = Math.ceil(W / GRID) + 1;
      const rows = Math.ceil(H / GRID) + 1;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          dots.push({ x: c * GRID, y: r * GRID });
    }
    resize();
    window.addEventListener("resize", resize);

    function draw(ts: number) {
      rafId = requestAnimationFrame(draw);
      if (document.hidden) return;
      if (ts - lastFrame < FRAME_INTERVAL) return;
      lastFrame = ts;
      time += WAVE_SPEED;

      ctx!.clearRect(0, 0, W, H);

      const cx = W / 2, cy = H / 2;
      const maxDist = Math.hypot(cx, cy);
      const waveRadius = (time % 1) * maxDist * 1.5;

      for (const d of dots) {
        const dist = Math.hypot(d.x - cx, d.y - cy);
        const waveDelta = Math.abs(dist - waveRadius);
        const waveFactor = waveDelta < WAVE_WIDTH ? 1 - waveDelta / WAVE_WIDTH : 0;
        const opacity = 0.06 + waveFactor * 0.30;
        const size = 1.0 + waveFactor * 1.4;
        // accent-purple (#8b5cf6) → accent-blue (#3b82f6) at wave peak
        const hue = 262 - waveFactor * 45;
        const sat = 70 + waveFactor * 15;
        const lit = 62 + waveFactor * 12;
        ctx!.beginPath();
        ctx!.arc(d.x, d.y, size, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${hue},${sat}%,${lit}%,${opacity})`;
        ctx!.fill();
      }
    }
    rafId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", resize); };
  }, []);

  // ── Decryption text animation ────────────────────────────────
  useEffect(() => {
    const target = decryptRef.current;
    if (!target) return;
    const chars = "▓█▒░╔╗╚╝╠╣╦╩╬│─┼ABCDEFGHabcdefgh0123456789$#@!&";
    const finalText = "the Dark.";
    let frame = 0, rafId = 0;

    function scramble() {
      frame++;
      const progress = Math.min(frame / 40, 1);
      let out = "";
      for (let i = 0; i < finalText.length; i++) {
        if (finalText[i] === " ") { out += " "; continue; }
        out += i < progress * finalText.length
          ? finalText[i]
          : chars[Math.floor(Math.random() * chars.length)];
      }
      target!.textContent = out;
      if (frame < 50) { rafId = requestAnimationFrame(scramble); }
      else { target!.textContent = finalText; }
    }

    const t = setTimeout(() => { rafId = requestAnimationFrame(scramble); }, 600);
    const iv = setInterval(() => { frame = 0; rafId = requestAnimationFrame(scramble); }, 6000);
    return () => { clearTimeout(t); clearInterval(iv); cancelAnimationFrame(rafId); };
  }, []);

  const dark = !isLight;

  // ── Scroll reveal ────────────────────────────────────────────
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add("lp-visible"); obs.unobserve(e.target); }
        });
      },
      { threshold: 0.12 }
    );
    const rafId = requestAnimationFrame(() => {
      document.querySelectorAll(".lp-reveal").forEach((el) => obs.observe(el));
    });
    return () => {
      cancelAnimationFrame(rafId);
      obs.disconnect();
    };
  }, [isLight]);

  // ── Features accordion ───────────────────────────────────────
  useEffect(() => {
    const headers = document.querySelectorAll<HTMLElement>(".lp-ac-header");
    const onClick = (h: HTMLElement) => () => {
      const item = h.closest<HTMLElement>(".lp-ac-item");
      if (!item) return;
      const isOpen = item.classList.contains("open");
      document.querySelectorAll(".lp-ac-item").forEach((i) => i.classList.remove("open"));
      if (!isOpen) item.classList.add("open");
    };
    const handlers: Array<{ h: HTMLElement; fn: () => void }> = [];
    headers.forEach((h) => {
      const fn = onClick(h);
      h.addEventListener("click", fn);
      handlers.push({ h, fn });
    });
    return () => { handlers.forEach(({ h, fn }) => h.removeEventListener("click", fn)); };
  }, []);

  // ── Mouse motion effects ─────────────────────────────────────
  useEffect(() => {
    const glow = cursorGlowRef.current;
    const o1 = orb1Ref.current;
    const o2 = orb2Ref.current;
    const o3 = orb3Ref.current;
    const o4 = orb4Ref.current;
    let mx = 0, my = 0, tx = 0, ty = 0, rafId = 0;

    function onMove(e: MouseEvent) {
      mx = e.clientX; my = e.clientY;
      if (glow) { glow.style.left = mx + "px"; glow.style.top = my + "px"; }
    }

    function orbLoop() {
      tx += (mx - tx) * 0.06; ty += (my - ty) * 0.06;
      const nx = tx / window.innerWidth - 0.5;
      const ny = ty / window.innerHeight - 0.5;
      if (o1) o1.style.transform = `translate(${nx * -100}px, ${ny * -70}px)`;
      if (o2) o2.style.transform = `translate(${nx * 70}px, ${ny * 50}px)`;
      if (o3) o3.style.transform = `translate(${nx * 120}px, ${ny * 85}px)`;
      if (o4) o4.style.transform = `translate(${nx * -80}px, ${ny * 60}px)`;
      rafId = requestAnimationFrame(orbLoop);
    }

    document.addEventListener("mousemove", onMove);
    rafId = requestAnimationFrame(orbLoop);

    type L = { card: HTMLElement; move: (e: MouseEvent) => void; leave: () => void };
    const listeners: L[] = [];
    document.querySelectorAll<HTMLElement>(".lp-tilt").forEach((card) => {
      const move = (e: MouseEvent) => {
        const r = card.getBoundingClientRect();
        const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
        const dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
        card.style.transform = `perspective(700px) rotateX(${-dy * 6}deg) rotateY(${dx * 6}deg) translateY(-4px)`;
      };
      const leave = () => { card.style.transform = ""; };
      card.addEventListener("mousemove", move);
      card.addEventListener("mouseleave", leave);
      listeners.push({ card, move, leave });
    });

    return () => {
      document.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(rafId);
      listeners.forEach(({ card, move, leave }) => {
        card.removeEventListener("mousemove", move);
        card.removeEventListener("mouseleave", leave);
      });
    };
  }, []);

  return (
    <>
      <Head>
        <title>ShadowPerp | Private Perps on Solana</title>
        <meta name="description" content="ShadowPerp is a private perpetual trading app on Solana. Trade with encrypted positions, direct wallet signing, and Arcium MPC protection on devnet." />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </Head>

      {/* Intro loader overlay — fades out after 1.8s */}
      {!ready && <ShadowLoader fullScreen size="lg" message="" />}

      <div
        className="relative min-h-screen overflow-x-hidden"
        style={{
          background: dark ? "#05081a" : "#f8f9fc",
          color: dark ? "#e2e8f0" : "#0f172a",
        }}
      >
        <style jsx global>{`
          .lp-grid-bg {
            position: fixed; inset: 0; z-index: 0; pointer-events: none;
            background-image:
              linear-gradient(${dark ? "rgba(36,56,114,0.18)" : "rgba(124,58,237,0.07)"} 1px, transparent 1px),
              linear-gradient(90deg, ${dark ? "rgba(36,56,114,0.18)" : "rgba(124,58,237,0.07)"} 1px, transparent 1px);
            background-size: 52px 52px;
            mask-image: radial-gradient(ellipse 100% 80% at 50% 0%, black 50%, transparent 100%);
          }
          .lp-orb {
            position: fixed; border-radius: 50%; filter: blur(55px);
            pointer-events: none; animation: lp-drift 12s ease-in-out infinite;
          }
          .lp-orb1 { width:700px;height:700px;background:${dark ? "rgba(109,40,217,.22)" : "rgba(124,58,237,.1)"};top:-150px;left:-150px;animation-duration:14s }
          .lp-orb2 { width:560px;height:560px;background:${dark ? "rgba(37,99,235,.16)" : "rgba(37,99,235,.08)"};top:80px;right:-120px;animation-duration:10s;animation-delay:-4s }
          .lp-orb3 { width:420px;height:420px;background:${dark ? "rgba(16,185,129,.10)" : "rgba(16,185,129,.06)"};top:40%;left:28%;animation-duration:16s;animation-delay:-7s }
          .lp-orb4 { width:360px;height:360px;background:${dark ? "rgba(217,70,160,.12)" : "rgba(217,70,160,.06)"};bottom:10%;right:10%;animation-duration:18s;animation-delay:-10s }
          @keyframes lp-drift {
            0%,100% { transform: translate(0,0) scale(1) }
            33%      { transform: translate(50px,-35px) scale(1.08) }
            66%      { transform: translate(-35px,50px) scale(.95) }
          }
          .lp-cursor-glow {
            position: fixed; width: 600px; height: 600px; border-radius: 50%; z-index: 1;
            background: radial-gradient(circle, rgba(139,92,246,${dark ? ".18" : ".10"}) 0%, rgba(59,130,246,${dark ? ".09" : ".05"}) 40%, transparent 70%);
            pointer-events: none; transform: translate(-50%,-50%); transition: opacity .4s;
          }
          /* NAV */
          .lp-nav {
            position: fixed; top: 0; left: 0; right: 0; z-index: 100;
            padding: 0 40px; height: 64px;
            display: flex; align-items: center; justify-content: space-between;
            background: transparent;
            backdrop-filter: none;
            border-bottom: none;
          }
          .lp-nav-logo { display:flex;align-items:center;gap:2px;text-decoration:none;transition:transform .15s ease,filter .15s ease;user-select:none }
          .lp-nav-logo:active { transform:scale(0.88);filter:drop-shadow(0 0 14px rgba(139,92,246,.8)) }
          .lp-nav-logo-svg { width:56px;height:56px;animation:lp-logo-pulse 4s ease-in-out infinite }
          @keyframes lp-logo-pulse {
            0%,100% { filter: drop-shadow(0 0 10px rgba(109,82,255,.4)) }
            50%      { filter: drop-shadow(0 0 20px rgba(56,189,248,.35)) }
          }
          .lp-nav-name {
            font-size:18px;font-weight:800;letter-spacing:.04em;
            background:linear-gradient(90deg,#a78bfa,#60a5fa);
            -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
          }
          .lp-nav-links { display:flex;align-items:center;gap:28px }
          .lp-nav-link { font-size:13px;font-weight:500;color:${dark ? "#6b7280" : "#475569"};text-decoration:none;transition:color .15s }
          .lp-nav-link:hover { color:${dark ? "#e2e8f0" : "#7c3aed"} }
          .lp-nav-cta {
            padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;
            background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:#fff;text-decoration:none;
            box-shadow:0 0 20px rgba(139,92,246,.25);transition:all .15s;
          }
          .lp-nav-cta:hover { box-shadow:0 0 28px rgba(139,92,246,.45);transform:translateY(-1px) }
          /* THEME TOGGLE pill */
          .lp-theme-toggle-btn {
            position: relative; width: 52px; height: 26px; border-radius: 13px;
            background: #1a1a25; border: 1.5px solid #35354a;
            cursor: pointer; display: flex; align-items: center; justify-content: space-between;
            padding: 0 6px; transition: background .25s, border-color .25s;
            outline: none; flex-shrink: 0;
          }
          .lp-theme-toggle-btn[data-light="true"] { background: #e2e8f0; border-color: #c8d0e0; }
          .lp-theme-toggle-btn:active { transform: scale(.94); }
          .lp-toggle-sun, .lp-toggle-moon { width: 11px; height: 11px; line-height: 1; z-index: 1; transition: opacity .2s; }
          .lp-toggle-sun { color: #f59e0b; opacity: .35; }
          .lp-toggle-moon { color: #8b5cf6; opacity: 1; }
          .lp-theme-toggle-btn[data-light="true"] .lp-toggle-sun { opacity: 1; }
          .lp-theme-toggle-btn[data-light="true"] .lp-toggle-moon { opacity: .3; }
          .lp-toggle-knob {
            position: absolute; top: 3px; left: 3px;
            width: 18px; height: 18px; border-radius: 50%;
            background: #8b5cf6; box-shadow: 0 1px 4px rgba(0,0,0,.4);
            transform: translateX(26px);
            transition: transform .22s cubic-bezier(.4,0,.2,1), background .22s;
          }
          .lp-theme-toggle-btn[data-light="true"] .lp-toggle-knob { transform: translateX(0); background: #fff; }
          /* HERO */
          .lp-hero {
            position:relative;min-height:100vh;z-index:1;
            display:flex;flex-direction:column;align-items:center;justify-content:center;
            padding:100px 24px 60px;text-align:center;overflow:hidden;
            background: ${dark ? "transparent" : "linear-gradient(180deg,#f0eeff 0%,#f8f9fc 55%,#f8f9fc 100%)"};
          }
          .lp-badge {
            display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;
            background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.25);
            font-size:11px;font-weight:600;color:#a78bfa;letter-spacing:.08em;text-transform:uppercase;
            margin-bottom:32px;animation:lp-fade-up .6s ease both;
          }
          .lp-badge-dot {
            width:6px;height:6px;border-radius:50%;background:#10b981;
            box-shadow:0 0 6px #10b981;animation:lp-blink 2s infinite;
          }
          @keyframes lp-blink { 0%,100%{opacity:1}50%{opacity:.3} }
          .lp-hero-title {
            font-size:clamp(44px,7vw,88px);font-weight:900;line-height:1.05;letter-spacing:-.03em;
            margin-bottom:24px;animation:lp-fade-up .7s .1s ease both;
          }
          .lp-plain { color: ${dark ? "#e2e8f0" : "#0f172a"} }
          .lp-accent {
            background:linear-gradient(135deg,#a78bfa 0%,#60a5fa 50%,#34d399 100%);
            -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
          }
          .lp-hero-sub {
            max-width:560px;font-size:18px;font-weight:500;color:${dark ? "#94a3b8" : "#475569"};line-height:1.7;
            margin-bottom:40px;animation:lp-fade-up .7s .2s ease both;
          }
          .lp-hero-ctas { display:flex;gap:12px;justify-content:center;flex-wrap:wrap;animation:lp-fade-up .7s .3s ease both }
          .lp-btn-primary {
            padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;
            background:linear-gradient(135deg,#8b5cf6,#3b82f6);color:#fff;text-decoration:none;
            box-shadow:0 0 30px rgba(139,92,246,.3);transition:all .2s;
            display:inline-flex;align-items:center;gap:8px;
          }
          .lp-btn-primary:hover { transform:translateY(-2px);box-shadow:0 0 45px rgba(139,92,246,.5) }
          .lp-powered {
            display:flex;align-items:center;justify-content:center;gap:20px;margin-top:48px;width:100%;
            font-size:11px;font-weight:600;color:${dark ? "#374151" : "#94a3b8"};letter-spacing:.1em;text-transform:uppercase;
            animation:lp-fade-up .7s .6s ease both;
          }
          .lp-powered-badge {
            padding:5px 12px;border-radius:6px;
            background:${dark ? "rgba(255,255,255,.03)" : "rgba(0,0,0,.04)"};
            border:1px solid ${dark ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.08)"};
            font-size:12px;font-weight:600;color:${dark ? "#6b7280" : "#64748b"};
          }
          .lp-arc { color:#a78bfa } .lp-sol { color:#9945ff }
          .lp-scroll-hint {
            position:absolute;bottom:32px;left:0;right:0;
            display:flex;flex-direction:column;align-items:center;gap:8px;
            font-size:13px;color:${dark ? "#94a3b8" : "#64748b"};letter-spacing:.1em;text-transform:uppercase;
            animation:lp-fade-up .7s .8s ease both;
          }
          .lp-scroll-arrow { color:#a78bfa;animation:lp-arrow-bounce 1.6s ease-in-out infinite; }
          @keyframes lp-arrow-bounce {
            0%,100% { transform:translateY(0);opacity:1 }
            50%     { transform:translateY(7px);opacity:.6 }
          }
          /* SECTIONS */
          .lp-section { padding:100px 24px;max-width:1100px;margin:0 auto;position:relative;z-index:1 }
          .lp-section-tag { font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8b5cf6;margin-bottom:12px }
          .lp-section-title { font-size:clamp(28px,4vw,44px);font-weight:800;letter-spacing:-.02em;color:${dark ? "#e2e8f0" : "#0f172a"};margin-bottom:16px }
          .lp-section-sub { font-size:16px;color:${dark ? "#94a3b8" : "#475569"};font-weight:500;max-width:500px;line-height:1.7 }
          /* HOW IT WORKS */
          .lp-steps { display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-top:56px;position:relative }
          .lp-steps::before {
            content:'';position:absolute;top:28px;left:calc(16% + 20px);right:calc(16% + 20px);
            height:1px;background:linear-gradient(90deg,transparent,rgba(139,92,246,.4),transparent);
          }
          .lp-step { display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 20px }
          .lp-step-num {
            width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;
            font-size:18px;font-weight:800;border:1px solid rgba(139,92,246,.3);
            background:rgba(139,92,246,.08);color:#a78bfa;margin-bottom:20px;
            position:relative;z-index:1;transition:all .3s;
          }
          .lp-step:hover .lp-step-num { background:rgba(139,92,246,.18);box-shadow:0 0 24px rgba(139,92,246,.25);transform:scale(1.08) }
          .lp-step-title { font-size:16px;font-weight:700;color:${dark ? "#e2e8f0" : "#0f172a"};margin-bottom:8px }
          .lp-step-desc { font-size:13px;color:${dark ? "#94a3b8" : "#475569"};font-weight:500;line-height:1.7 }
          /* FEATURES */
          .lp-features-accordion { display:flex;flex-direction:column;gap:2px;margin-top:40px;max-width:680px }
          .lp-ac-item {
            border:1px solid ${dark ? "rgba(255,255,255,.06)" : "#dde2ee"};
            border-radius:10px;overflow:hidden;
            background:${dark ? "rgba(255,255,255,.02)" : "#ffffff"};
            transition:border-color .2s,background .2s;
          }
          .lp-ac-item.open {
            border-color:rgba(139,92,246,.35);
            background:${dark ? "rgba(139,92,246,.05)" : "rgba(139,92,246,.04)"};
          }
          .lp-ac-header {
            display:flex;align-items:center;justify-content:space-between;
            padding:14px 18px;cursor:pointer;user-select:none;gap:14px;
          }
          .lp-ac-left { display:flex;align-items:center;gap:13px }
          .lp-ac-icon {
            width:34px;height:34px;border-radius:9px;flex-shrink:0;
            background:linear-gradient(135deg,rgba(139,92,246,.18),rgba(59,130,246,.10));
            box-shadow:inset 0 0 0 1px rgba(139,92,246,.25);
            display:flex;align-items:center;justify-content:center;
            transition:box-shadow .2s,background .2s;
          }
          .lp-ac-item.open .lp-ac-icon {
            background:linear-gradient(135deg,rgba(139,92,246,.28),rgba(59,130,246,.16));
            box-shadow:inset 0 0 0 1px rgba(139,92,246,.5),0 0 12px rgba(139,92,246,.18);
          }
          .lp-ac-icon svg { width:15px;height:15px;fill:none;stroke:#a78bfa;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;transition:stroke .2s }
          .lp-ac-item.open .lp-ac-icon svg { stroke:#c4b5fd }
          .lp-ac-title { font-size:13px;font-weight:700;color:${dark ? "#e2e8f0" : "#0f172a"} }
          .lp-ac-chevron { width:14px;height:14px;flex-shrink:0;stroke:#475569;fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;transition:transform .22s ease,stroke .2s }
          .lp-ac-item.open .lp-ac-chevron { transform:rotate(180deg);stroke:#8b5cf6 }
          .lp-ac-body { max-height:0;overflow:hidden;transition:max-height .28s ease }
          .lp-ac-item.open .lp-ac-body { max-height:120px }
          .lp-ac-desc { padding:0 18px 15px 65px;font-size:12.5px;color:${dark ? "#94a3b8" : "#475569"};line-height:1.7 }
          /* PRIVACY */
          .lp-privacy-section {
            position:relative;z-index:1;padding:80px 24px;
            border-top:1px solid ${dark ? "rgba(255,255,255,.04)" : "#e8ebf4"};
            border-bottom:1px solid ${dark ? "rgba(255,255,255,.04)" : "#e8ebf4"};
            background:${dark ? "rgba(139,92,246,.02)" : "#f6f8fc"};
          }
          .lp-privacy-inner { max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center }
          .lp-privacy-visual {
            background:${dark ? "rgba(255,255,255,.02)" : "#ffffff"};
            border:1px solid ${dark ? "rgba(139,92,246,.15)" : "#dde2ee"};
            border-radius:14px;padding:24px;font-family:'Courier New',monospace;font-size:12px;
          }
          .lp-pv-header { font-size:10px;color:${dark ? "#374151" : "#94a3b8"};letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid ${dark ? "rgba(255,255,255,.06)" : "#e8ebf4"} }
          .lp-pv-row { display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid ${dark ? "rgba(255,255,255,.04)" : "#f0f2f7"} }
          .lp-pv-row:last-of-type { border-bottom:none }
          .lp-pv-label { color:${dark ? "#4b5563" : "#94a3b8"};min-width:100px;font-size:11px }
          .lp-pv-enc { color:#8b5cf6;letter-spacing:.05em;filter:blur(3.5px);transition:filter .3s }
          .lp-pv-enc:hover { filter:blur(0) }
          .lp-pv-plain { color:#10b981 }
          .lp-pv-lock { font-size:10px;color:#8b5cf6;background:rgba(139,92,246,.1);padding:1px 5px;border-radius:4px;white-space:nowrap }
          .lp-pv-lock-green { font-size:10px;color:#10b981;background:rgba(16,185,129,.1);padding:1px 5px;border-radius:4px;white-space:nowrap }
          .lp-pv-lock-blue { font-size:10px;color:#60a5fa;background:rgba(96,165,250,.1);padding:1px 5px;border-radius:4px;white-space:nowrap }
          .lp-pv-hint { font-size:10px;color:${dark ? "#374151" : "#94a3b8"};margin-top:10px;text-align:right }
          /* SESSION CALLOUT */
          .lp-session-callout { max-width:1100px;margin:0 auto 80px;position:relative;z-index:1;padding:0 24px }
          .lp-session-card {
            background:${dark ? "linear-gradient(135deg,rgba(109,40,217,.08),rgba(37,99,235,.06))" : "linear-gradient(135deg,rgba(124,58,237,.06),rgba(37,99,235,.04))"};
            border:1px solid ${dark ? "rgba(139,92,246,.25)" : "rgba(124,58,237,.22)"};
            border-radius:20px;padding:44px 48px;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(360px,420px);gap:32px;align-items:center;
            position:relative;overflow:hidden;
          }
          .lp-session-card::after {
            content:'';position:absolute;top:-60px;right:-60px;width:280px;height:280px;border-radius:50%;
            background:radial-gradient(circle,rgba(139,92,246,${dark ? ".12" : ".07"}) 0%,transparent 70%);pointer-events:none;
          }
          .lp-session-copy { max-width:560px }
          .lp-session-label {
            display:inline-flex;align-items:center;gap:6px;
            font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#a78bfa;
            background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.2);
            padding:4px 10px;border-radius:6px;margin-bottom:14px;
          }
          .lp-session-title { font-size:28px;font-weight:900;color:${dark ? "#e2e8f0" : "#0f172a"};margin-bottom:14px;letter-spacing:-.03em;line-height:1.15 }
          .lp-session-desc { font-size:15px;color:${dark ? "#94a3b8" : "#475569"};font-weight:500;line-height:1.8;max-width:520px }
          .lp-session-stats {
            display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;flex-shrink:0;
            width:100%;max-width:420px;justify-self:end;
          }
          .lp-session-stat {
            text-align:center;padding:26px 18px;
            background:${dark ? "linear-gradient(180deg,rgba(24,24,48,.88),rgba(20,20,40,.72))" : "linear-gradient(180deg,rgba(255,255,255,.96),rgba(245,247,255,.88))"};
            border:1px solid ${dark ? "rgba(255,255,255,.08)" : "#dde2ee"};
            box-shadow:${dark ? "0 20px 44px rgba(10,10,18,.26)" : "0 18px 36px rgba(99,102,241,.08)"};
            border-radius:18px;backdrop-filter:blur(10px);min-width:0;
          }
          .lp-session-stat-val { font-size:34px;font-weight:900;color:#a78bfa;letter-spacing:-.04em;line-height:1 }
          .lp-session-stat-lbl { font-size:11px;color:${dark ? "#6b7280" : "#64748b"};font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-top:8px }
          /* CTA */
          .lp-cta-section {
            position:relative;z-index:1;padding:120px 24px;text-align:center;overflow:hidden;
            background: ${dark ? "transparent" : "linear-gradient(180deg,#f8f9fc 0%,#f0eeff 60%,#f8f9fc 100%)"};
          }
          .lp-cta-glow {
            position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
            width:600px;height:400px;border-radius:50%;pointer-events:none;
            background:radial-gradient(ellipse,rgba(109,40,217,${dark ? ".15" : ".08"}) 0%,transparent 70%);
          }
          .lp-cta-title {
            font-size:clamp(32px,5vw,56px);font-weight:900;letter-spacing:-.03em;
            background:${dark ? "linear-gradient(135deg,#e2e8f0 0%,#a78bfa 50%,#60a5fa 100%)" : "linear-gradient(135deg,#0f172a 0%,#7c3aed 50%,#2563eb 100%)"};
            -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:16px;
          }
          .lp-cta-sub { font-size:17px;color:${dark ? "#94a3b8" : "#475569"};font-weight:500;max-width:440px;margin:0 auto 40px;line-height:1.7 }
          /* FOOTER */
          .lp-footer {
            position:relative;z-index:1;
            border-top:1px solid ${dark ? "rgba(255,255,255,.06)" : "#e8ebf4"};
            background: ${dark ? "rgba(10,10,18,0.8)" : "#ffffff"};
            padding:24px 40px 15px;
            font-size:13px;color:${dark ? "#6b7280" : "#64748b"};
          }
          .lp-footer-inner {
            max-width:1200px;margin:0 auto;
            display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:28px;
          }
          .lp-footer-brand { display:flex;flex-direction:column;gap:8px }
          .lp-footer-brand-name { font-size:18px;font-weight:800;display:flex;align-items:center;gap:2px;background:linear-gradient(90deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text }
          .lp-footer-brand-desc { font-size:13px;line-height:1.6;color:${dark ? "#6b7280" : "#94a3b8"};max-width:360px }
          .lp-footer-col h4 { font-size:14px;font-weight:600;color:${dark ? "#e2e8f0" : "#1e293b"};margin-bottom:12px }
          .lp-footer-col a { display:block;color:${dark ? "#6b7280" : "#94a3b8"};text-decoration:none;transition:color .15s;padding:3px 0;font-size:13px }
          .lp-footer-col a:hover { color:#a78bfa }
          .lp-footer-bottom {
            max-width:1200px;margin:22px auto 0;padding-top:14px;
            border-top:1px solid ${dark ? "rgba(255,255,255,.04)" : "#e8ebf4"};
            display:flex;align-items:center;justify-content:space-between;font-size:12px;
            color:${dark ? "#374151" : "#94a3b8"};
          }
          .lp-footer-bottom a { color:${dark ? "#6b7280" : "#94a3b8"};text-decoration:none;transition:color .15s }
          .lp-footer-bottom a:hover { color:#a78bfa }
          .lp-footer-social { display:flex;gap:12px;align-items:center }
          .lp-footer-social a { color:${dark ? "#4b5563" : "#94a3b8"};transition:color .15s }
          .lp-footer-social a:hover { color:#a78bfa }
          /* REVEAL */
          .lp-reveal { opacity:0;transform:translateY(24px);transition:opacity .6s ease,transform .6s ease }
          .lp-reveal.lp-visible { opacity:1;transform:translateY(0) }
          .lp-delay-1 { transition-delay:.1s } .lp-delay-2 { transition-delay:.2s } .lp-delay-3 { transition-delay:.3s }
          @keyframes lp-fade-up { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)} }
          @media(max-width:768px){
            .lp-steps{grid-template-columns:1fr}
            .lp-steps::before{display:none}
            .lp-features-grid{grid-template-columns:1fr}
            .lp-privacy-inner{grid-template-columns:1fr}
            .lp-nav-links{display:none}
            .lp-footer-inner{grid-template-columns:1fr;gap:24px;text-align:center}
            .lp-footer-brand-desc{margin:0 auto}
            .lp-footer-bottom{flex-direction:column;gap:12px;text-align:center}
            .lp-session-card{grid-template-columns:1fr;padding:28px 24px}
            .lp-session-copy{max-width:none}
            .lp-session-title{font-size:24px}
            .lp-session-desc{font-size:14px;line-height:1.7}
            .lp-session-stats{grid-template-columns:repeat(3,minmax(0,1fr));justify-self:stretch;max-width:none}
            .lp-session-stat{padding:18px 14px}
            .lp-session-stat-val{font-size:28px}
            .lp-session-stat-lbl{font-size:10px}
            .lp-theme-toggle-btn { width: 44px; height: 22px; right: 0.75rem; bottom: 0.75rem; }
          }
          @media(max-width:560px){
            .lp-session-stats{grid-template-columns:1fr}
          }
        `}</style>

        {/* Cursor glow */}
        <div ref={cursorGlowRef} className="lp-cursor-glow" />

        {/* Particle canvas */}
        <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" style={{ opacity: dark ? 0.4 : 0.25 }} aria-hidden="true" />

        {/* Grid + orbs */}
        <div className="lp-grid-bg" />
        <div ref={orb1Ref} className="lp-orb lp-orb1" />
        <div ref={orb2Ref} className="lp-orb lp-orb2" />
        <div ref={orb3Ref} className="lp-orb lp-orb3" />
        <div ref={orb4Ref} className="lp-orb lp-orb4" />

        {/* NAV */}
        <nav className="lp-nav">
          <Link href="/" className="lp-nav-logo">
            <ShadowLogo className="lp-nav-logo-svg" dark={dark} />
            <span className="lp-nav-name">SHADOW</span>
          </Link>
          <div className="lp-nav-links">
            <a href="#privacy" className="lp-nav-link">Privacy</a>
            <a href="#features" className="lp-nav-link">Features</a>
            <a href="#wallets" className="lp-nav-link">Wallets</a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              className="lp-theme-toggle-btn"
              onClick={toggleTheme}
              data-light={isLight ? "true" : "false"}
              title={isLight ? "Switch to dark mode" : "Switch to light mode"}
              aria-label="Toggle theme"
              style={{ position: "relative", right: "auto", bottom: "auto", zIndex: "auto" }}
            >
              <span className="lp-toggle-sun" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="4" /><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6l1.4 1.4M15 15l1.4 1.4M3.6 16.4 5 15M15 5l1.4-1.4" /></svg>
              </span>
              <span className="lp-toggle-moon" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.8 2.1a7.2 7.2 0 1 0 4.1 11.7 8 8 0 1 1-4.1-11.7Z" /></svg>
              </span>
              <span className="lp-toggle-knob" />
            </button>
            <Link href="/app" className="lp-nav-cta">Launch App</Link>
          </div>
        </nav>

        {/* HERO */}
        <section className="lp-hero">
          <div className="lp-badge">
            <span className="lp-badge-dot" />
            Live on Solana Devnet
          </div>
          <h1 className="lp-hero-title">
            <span className="lp-plain">Trade in</span><br />
            <span className="lp-accent"><span ref={decryptRef}>the Dark.</span></span>
          </h1>
          <p className="lp-hero-sub">
            Private perpetual trading on Solana.<br />
            Shadow keeps your trade size, direction, leverage, and margin encrypted. Solana handles settlement. Arcium handles the confidential compute.
          </p>
          <div className="lp-hero-ctas">
            <Link href="/app" className="lp-btn-primary">
              Start Trading
            </Link>
          </div>
          <div className="lp-powered">
            <span className="lp-powered-badge">Built on <span className="lp-sol">Solana</span></span>
            <span style={{ color: dark ? "#1e293b" : "#c8d0e0" }}>&middot;</span>
            <span className="lp-powered-badge">Powered by <span className="lp-arc">Arcium</span></span>
          </div>
          <div className="lp-scroll-hint">
            <span>Scroll</span>
            <svg className="lp-scroll-arrow" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <div id="how" />
        <div className="lp-section lp-reveal">
          <div className="lp-section-title">Privacy without compromise</div>
          <p className="lp-section-sub">Three steps. Sensitive trade logic stays private and the chain only sees what it actually needs to settle.</p>
          <div className="lp-steps">
            <div className="lp-step lp-reveal lp-delay-1 lp-tilt">
              <div className="lp-step-num">01</div>
              <div className="lp-step-title">Encrypt in the Browser</div>
              <p className="lp-step-desc">Size, direction, leverage, and margin are encrypted before the trade leaves your browser. Shadow keeps the sensitive parts private from the start.</p>
            </div>
            <div className="lp-step lp-reveal lp-delay-2 lp-tilt">
              <div className="lp-step-num">02</div>
              <div className="lp-step-title">MPC Validation</div>
              <p className="lp-step-desc">Arcium's MPC network checks the trade, margin requirements, and liquidation conditions without any single node ever seeing your plaintext position data.</p>
            </div>
            <div className="lp-step lp-reveal lp-delay-3 lp-tilt">
              <div className="lp-step-num">03</div>
              <div className="lp-step-title">On Chain Settlement</div>
              <p className="lp-step-desc">Verified results settle on Solana. The chain gets the minimum state it needs while sensitive trade fields stay encrypted for the entire life of the position.</p>
            </div>
          </div>
        </div>

        {/* PRIVACY VISUAL */}
        <div id="privacy" className="lp-privacy-section">
          <div className="lp-privacy-inner">
            <div className="lp-reveal">
              <p className="lp-section-tag">Privacy by default</p>
              <div className="lp-section-title" style={{ fontSize: "clamp(24px,3.5vw,38px)" }}>
                What others see<br />versus what you see
              </div>
              <p style={{ fontSize: "14px", color: dark ? "#94a3b8" : "#475569", fontWeight: 500, lineHeight: 1.7, marginTop: "12px" }}>
                On Shadow, the chain can see that a position exists but not the sensitive details traders usually leak by default. Hover the blurred values to see how little an outside observer can actually learn.
              </p>
            </div>
            <div className="lp-reveal lp-delay-1">
              <div className="lp-privacy-visual">
                <div className="lp-pv-header">On-chain position data</div>
                <div className="lp-pv-row"><span className="lp-pv-label">Owner</span><span className="lp-pv-plain">7xKm...3fPq</span><span className="lp-pv-lock">public</span></div>
                <div className="lp-pv-row"><span className="lp-pv-label">Direction</span><span className="lp-pv-enc">0x8f3a...c92b</span><span className="lp-pv-lock">encrypted</span></div>
                <div className="lp-pv-row"><span className="lp-pv-label">Size</span><span className="lp-pv-enc">0x4d1c...8e47</span><span className="lp-pv-lock">encrypted</span></div>
                <div className="lp-pv-row"><span className="lp-pv-label">Entry Price</span><span className="lp-pv-enc">0xb29f...11da</span><span className="lp-pv-lock">encrypted</span></div>
                <div className="lp-pv-row"><span className="lp-pv-label">Leverage</span><span className="lp-pv-enc">0x7a5e...0c83</span><span className="lp-pv-lock">encrypted</span></div>
                <div className="lp-pv-row"><span className="lp-pv-label">Liq. Price</span><span className="lp-pv-enc">0xe3c1...9f62</span><span className="lp-pv-lock">encrypted</span></div>
                <div className="lp-pv-row"><span className="lp-pv-label">Wallet Signer</span><span className="lp-pv-plain">direct</span><span className="lp-pv-lock-blue">wallet</span></div>
                <div className="lp-pv-row"><span className="lp-pv-label">PnL</span><span className="lp-pv-plain">+$142.30</span><span className="lp-pv-lock-green">revealed on close</span></div>
                <div className="lp-pv-hint">hover blur to reveal &uarr;</div>
              </div>
            </div>
          </div>
        </div>

        {/* FEATURES */}
        <div id="features" className="lp-section lp-reveal">
          <p className="lp-section-tag">Features</p>
          <div className="lp-section-title">Built for private trading</div>
          <div className="lp-features-accordion" id="lpAcc">
            <div className="lp-ac-item">
              <div className="lp-ac-header">
                <div className="lp-ac-left">
                  <div className="lp-ac-icon"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg></div>
                  <span className="lp-ac-title">Confidential Order Flow</span>
                </div>
                <svg className="lp-ac-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div className="lp-ac-body"><p className="lp-ac-desc">Orders do not broadcast the usual signals before execution. Size, direction, leverage, and liquidation details stay off the public ledger entirely.</p></div>
            </div>
            <div className="lp-ac-item">
              <div className="lp-ac-header">
                <div className="lp-ac-left">
                  <div className="lp-ac-icon"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><line x1="12" y1="15" x2="12" y2="17"/></svg></div>
                  <span className="lp-ac-title">Confidential Liquidations</span>
                </div>
                <svg className="lp-ac-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div className="lp-ac-body"><p className="lp-ac-desc">Liquidation thresholds are hidden from observers. Traders are not forced to reveal one of the most exploitable parts of any open position.</p></div>
            </div>
            <div className="lp-ac-item">
              <div className="lp-ac-header">
                <div className="lp-ac-left">
                  <div className="lp-ac-icon"><svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg></div>
                  <span className="lp-ac-title">Human Wallet UX</span>
                </div>
                <svg className="lp-ac-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div className="lp-ac-body"><p className="lp-ac-desc">Email and social users get an embedded wallet. Existing Solana users connect the wallet they already trust.</p></div>
            </div>
            <div className="lp-ac-item">
              <div className="lp-ac-header">
                <div className="lp-ac-left">
                  <div className="lp-ac-icon"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1"/><path d="M9 7V4M12 7V4M15 7V4M9 17v3M12 17v3M15 17v3M7 9H4M7 12H4M7 15H4M17 9h3M17 12h3M17 15h3"/></svg></div>
                  <span className="lp-ac-title">Arcium MPC</span>
                </div>
                <svg className="lp-ac-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div className="lp-ac-body"><p className="lp-ac-desc">Trade validation runs through Arcium&apos;s MPC network with replay hardened callbacks. The chain receives a verified outcome rather than a plaintext view into your position.</p></div>
            </div>
            <div className="lp-ac-item">
              <div className="lp-ac-header">
                <div className="lp-ac-left">
                  <div className="lp-ac-icon"><svg viewBox="0 0 24 24"><polyline points="2 12 6 12 9 4 13 20 16 12 18 12 22 12"/></svg></div>
                  <span className="lp-ac-title">Safer Oracle Handling</span>
                </div>
                <svg className="lp-ac-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div className="lp-ac-body"><p className="lp-ac-desc">Staleness checks, fallback handling, and circuit breakers are designed to fail loudly rather than pretend everything is fine when price freshness drifts.</p></div>
            </div>
            <div className="lp-ac-item">
              <div className="lp-ac-header">
                <div className="lp-ac-left">
                  <div className="lp-ac-icon"><svg viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/></svg></div>
                  <span className="lp-ac-title">Shared Collateral</span>
                </div>
                <svg className="lp-ac-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div className="lp-ac-body"><p className="lp-ac-desc">On adopted devnet markets, one owner scoped balance can fund multiple pairs. Free and locked collateral stay visible separately so the numbers always make sense.</p></div>
            </div>
            <div className="lp-ac-item">
              <div className="lp-ac-header">
                <div className="lp-ac-left">
                  <div className="lp-ac-icon"><svg viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="8" cy="6" r="2" fill="rgba(167,139,250,.2)"/><circle cx="15" cy="12" r="2" fill="rgba(167,139,250,.2)"/><circle cx="10" cy="18" r="2" fill="rgba(167,139,250,.2)"/></svg></div>
                  <span className="lp-ac-title">Trader First UX</span>
                </div>
                <svg className="lp-ac-chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div className="lp-ac-body"><p className="lp-ac-desc">Faster repeated actions, cleaner state handling, and privacy that stays in the background until you want to look at it.</p></div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="lp-cta-section lp-reveal">
          <div className="lp-cta-glow" />
          <p className="lp-section-tag" style={{ textAlign: "center" }}>Ready?</p>
          <h2 className="lp-cta-title">Trade with less<br />information leakage.</h2>
          <p className="lp-cta-sub">Connect your wallet and explore the current devnet build. The privacy model is live, the product signs directly from the connected wallet, and the open-lane callback diagnostics remain the main blocker being worked through.</p>
          <Link href="/app" className="lp-btn-primary" style={{ display: "inline-flex", fontSize: "16px", padding: "16px 40px" }}>
            Launch App
          </Link>
        </div>

        {/* FOOTER */}
        <footer className="lp-footer">
          <div className="lp-footer-inner">
            <div className="lp-footer-brand">
              <div className="lp-footer-brand-name">
                <ShadowLogo className="lp-nav-logo-svg" dark={dark} />
                SHADOW
              </div>
              <p className="lp-footer-brand-desc">
                Private perpetual trading on Solana.
                Built for honest privacy boundaries, direct wallet trading, and confidential compute powered by Arcium.
              </p>
              <div className="lp-footer-social">
                <a href="https://x.com/emperoar007" target="_blank" rel="noopener noreferrer" aria-label="Twitter">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                <a href="https://github.com/Emperoar07/shadow" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                </a>
              </div>
            </div>

            <div className="lp-footer-col">
              <h4>Products</h4>
              <Link href="/app">Exchange</Link>
              <a href="#features">Features</a>
              <a href="#privacy">Privacy</a>
            </div>

            <div className="lp-footer-col">
              <h4>Resources</h4>
              <Link href="/docs">Documentation</Link>
              <a href="https://github.com/Emperoar07/shadow" target="_blank" rel="noopener noreferrer">GitHub</a>
              <a href="https://docs.arcium.com/" target="_blank" rel="noopener noreferrer">Arcium Docs</a>
            </div>

            <div className="lp-footer-col">
              <h4>Legal</h4>
              <Link href="/docs#privacy-policy">Privacy Policy</Link>
              <Link href="/docs#terms">Terms of Use</Link>
              <Link href="/docs#cookies">Cookie Policy</Link>
            </div>
          </div>

          <div className="lp-footer-bottom">
            <span>&copy; 2026 ShadowPerp. All rights reserved.</span>
            <a href="https://x.com/emperoar007" target="_blank" rel="noopener noreferrer">Built by 0xb for the decentralized world.</a>
          </div>
        </footer>


      </div>
    </>
  );
}

function ShadowLogo({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="lp-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#8b5cf6", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "#3b82f6", stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <path d="M50 15 L85 35 L50 55 L15 35 Z" fill="url(#lp-logo-grad)" opacity={0.4} />
      <path d="M50 25 L85 45 L50 65 L15 45 Z" fill="url(#lp-logo-grad)" opacity={0.65} />
      <path d="M50 35 L85 55 L50 75 L15 55 Z" fill="url(#lp-logo-grad)" />
    </svg>
  );
}





