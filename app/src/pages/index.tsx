import { useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";

function detectLightTheme(): boolean {
  if (typeof document !== "undefined") {
    return document.documentElement.classList.contains("light");
  }
  return false;
}

export default function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorGlowRef = useRef<HTMLDivElement>(null);
  const orb1Ref = useRef<HTMLDivElement>(null);
  const orb2Ref = useRef<HTMLDivElement>(null);
  const orb3Ref = useRef<HTMLDivElement>(null);
  const orb4Ref = useRef<HTMLDivElement>(null);
  const decryptRef = useRef<HTMLSpanElement>(null);
  const [isLight, setIsLight] = useState<boolean>(detectLightTheme);

  // -- Theme init ------------------------------------------------
  useEffect(() => {
    const saved = localStorage.getItem("shadow-theme");
    const light = saved === "light";
    document.documentElement.classList.toggle("light", light);
    if (!saved) localStorage.setItem("shadow-theme", "dark");
    setIsLight(light);
  }, []);

  useEffect(() => {
    localStorage.setItem("shadow-theme", isLight ? "light" : "dark");
    document.documentElement.classList.toggle("light", isLight);
  }, [isLight]);

  const toggleTheme = () => {
    setIsLight((current) => !current);
  };

  // -- Particle canvas ------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, rafId = 0, lastFrame = 0;
    type P = { x: number; y: number; vx: number; vy: number; r: number; alpha: number; color: string };
    const COLORS = ["139,92,246", "59,130,246", "16,185,129"];
    let particles: P[] = [];

    function resize() {
      W = canvas!.width = window.innerWidth;
      H = canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 100; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        r: Math.random() * 2.2 + 0.8,
        alpha: Math.random() * 0.4 + 0.15,
        color: COLORS[Math.floor(Math.random() * 3)],
      });
    }

    function draw(ts: number) {
      if (ts - lastFrame < 33) { rafId = requestAnimationFrame(draw); return; }
      lastFrame = ts;
      ctx!.clearRect(0, 0, W, H);
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${p.color},${p.alpha})`;
        ctx!.fill();
      });
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 160) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(99,92,246,${0.15 * (1 - dist / 160)})`;
            ctx!.lineWidth = 0.8;
            ctx!.stroke();
          }
        }
      }
      rafId = requestAnimationFrame(draw);
    }
    rafId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", resize); };
  }, []);

  // -- Decryption text animation --------------------------------
  useEffect(() => {
    const target = decryptRef.current;
    if (!target) return;
    const chars = "¦¦¦¦++++¦¦--+¦-+ABCDEFGHabcdefgh0123456789$#@!&";
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

  const dark = isLight === false;

  // -- Scroll reveal --------------------------------------------
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

  // -- Mouse motion effects -------------------------------------
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
        <title>Shadow | Private Perpetual Exchange</title>
        <meta name="description" content="A fully confidential perpetual exchange on Solana, powered by Arcium." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

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
          .lp-nav-logo { display:flex;align-items:center;gap:10px;text-decoration:none;transition:transform .15s ease,filter .15s ease;user-select:none }
          .lp-nav-logo:active { transform:scale(0.88);filter:drop-shadow(0 0 14px rgba(139,92,246,.8)) }
          .lp-nav-logo-svg { width:28px;height:28px;animation:lp-logo-pulse 4s ease-in-out infinite }
          @keyframes lp-logo-pulse {
            0%,100% { filter: drop-shadow(0 0 10px rgba(109,82,255,.4)) }
            50%      { filter: drop-shadow(0 0 20px rgba(56,189,248,.35)) }
          }
          .lp-nav-name {
            font-size:15px;font-weight:800;letter-spacing:.02em;
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
          .lp-features-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:48px }
          .lp-feat-card {
            background:${dark ? "rgba(255,255,255,.02)" : "#ffffff"};
            border:1px solid ${dark ? "rgba(255,255,255,.06)" : "#dde2ee"};
            border-radius:14px;padding:28px 24px;transition:border-color .25s,box-shadow .25s;
            cursor:default;position:relative;overflow:hidden;
            transform-style:preserve-3d;will-change:transform;
          }
          .lp-feat-card::before {
            content:'';position:absolute;inset:0;border-radius:14px;
            background:linear-gradient(135deg,rgba(139,92,246,.06),transparent);opacity:0;transition:opacity .25s;
          }
          .lp-feat-card:hover { border-color:rgba(139,92,246,.3);box-shadow:0 4px 20px rgba(139,92,246,.08) }
          .lp-feat-card:hover::before { opacity:1 }
          .lp-feat-title { font-size:16px;font-weight:700;color:${dark ? "#e2e8f0" : "#0f172a"};margin-bottom:8px }
          .lp-feat-desc { font-size:13px;color:${dark ? "#94a3b8" : "#475569"};font-weight:500;line-height:1.7 }
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
            background:${dark ? "rgba(139,92,246,.04)" : "linear-gradient(135deg,rgba(124,58,237,.05),rgba(37,99,235,.04))"};
            border:1px solid ${dark ? "rgba(139,92,246,.18)" : "rgba(124,58,237,.2)"};
            border-radius:16px;padding:36px 40px;display:grid;grid-template-columns:1fr auto;gap:32px;align-items:center;
          }
          .lp-session-label { font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8b5cf6;margin-bottom:8px }
          .lp-session-title { font-size:22px;font-weight:800;color:${dark ? "#e2e8f0" : "#0f172a"};margin-bottom:10px;letter-spacing:-.02em }
          .lp-session-desc { font-size:14px;color:${dark ? "#94a3b8" : "#475569"};font-weight:500;line-height:1.7;max-width:520px }
          .lp-session-stats { display:flex;gap:24px }
          .lp-session-stat { text-align:center;padding:16px 24px;background:${dark ? "rgba(255,255,255,.03)" : "#ffffff"};border:1px solid ${dark ? "rgba(255,255,255,.06)" : "#dde2ee"};border-radius:12px }
          .lp-session-stat-val { font-size:22px;font-weight:800;color:#a78bfa;letter-spacing:-.02em }
          .lp-session-stat-lbl { font-size:10px;color:${dark ? "#6b7280" : "#64748b"};font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-top:4px }
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
            border-top:1px solid ${dark ? "rgba(255,255,255,.04)" : "#e8ebf4"};
            background: ${dark ? "transparent" : "#ffffff"};
            padding:32px 40px;display:flex;align-items:center;justify-content:space-between;
            font-size:12px;color:${dark ? "#374151" : "#64748b"};
          }
          .lp-footer a { color:${dark ? "#6b7280" : "#94a3b8"};text-decoration:none;transition:color .15s }
          .lp-footer a:hover { color:#a78bfa }
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
            .lp-footer{flex-direction:column;gap:16px;text-align:center}
            .lp-session-card{grid-template-columns:1fr}
            .lp-session-stats{flex-wrap:wrap}
            .lp-theme-toggle-btn { width: 44px; height: 22px; right: 0.75rem; bottom: 0.75rem; }
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
            <a href="#session" className="lp-nav-link">Session Trading</a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Link href="/app" className="lp-nav-cta">Launch App &rarr;</Link>
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
            A fully confidential perpetual exchange on Solana.<br />
            Your size, leverage and liquidation price are encrypted end-to-end.
          </p>
          <div className="lp-hero-ctas">
            <Link href="/app" className="lp-btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
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
          <p className="lp-section-sub">Three steps. Your trade data never touches a public ledger unencrypted.</p>
          <div className="lp-steps">
            <div className="lp-step lp-reveal lp-delay-1 lp-tilt">
              <div className="lp-step-num">01</div>
              <div className="lp-step-title">Encrypt &amp; Delegate</div>
              <p className="lp-step-desc">Your position inputs (size, leverage, direction) are encrypted in your browser. Approve a delegated trading session once with no wallet popup for every trade.</p>
            </div>
            <div className="lp-step lp-reveal lp-delay-2 lp-tilt">
              <div className="lp-step-num">02</div>
              <div className="lp-step-title">MPC Validation</div>
              <p className="lp-step-desc">Arcium&apos;s multi party computation nodes validate your trade and check liquidation thresholds without ever seeing the plaintext.</p>
            </div>
            <div className="lp-step lp-reveal lp-delay-3 lp-tilt">
              <div className="lp-step-num">03</div>
              <div className="lp-step-title">On Chain Settlement</div>
              <p className="lp-step-desc">Results settle on Solana. Only your PnL is ever revealed. Position size, entry price and leverage stay encrypted forever.</p>
            </div>
          </div>
        </div>

        {/* PRIVACY VISUAL */}
        <div id="privacy" className="lp-privacy-section">
          <div className="lp-privacy-inner">
            <div className="lp-reveal">
              <p className="lp-section-tag">Privacy by default</p>
              <div className="lp-section-title" style={{ fontSize: "clamp(24px,3.5vw,38px)" }}>
                What others see vs.<br />what you see
              </div>
              <p style={{ fontSize: "14px", color: dark ? "#94a3b8" : "#475569", fontWeight: 500, lineHeight: 1.7, marginTop: "12px" }}>
                On Shadow, sensitive fields are encrypted on chain. Hover the blurred values to see what a watcher would observe. Nothing.
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
                <div className="lp-pv-row"><span className="lp-pv-label">Session Key</span><span className="lp-pv-enc">0xa12f...d44e</span><span className="lp-pv-lock-blue">delegated</span></div>
                <div className="lp-pv-row"><span className="lp-pv-label">PnL</span><span className="lp-pv-plain">+$142.30</span><span className="lp-pv-lock-green">revealed on close</span></div>
                <div className="lp-pv-hint">hover blur to reveal &rarr;</div>
              </div>
            </div>
          </div>
        </div>

        {/* SESSION TRADING CALLOUT */}
        <div id="session" className="lp-session-callout lp-reveal" style={{ paddingTop: "80px" }}>
          <div className="lp-session-card">
            <div>
              <p className="lp-session-label">Session Trading</p>
              <h3 className="lp-session-title">One approval. Unlimited trades.</h3>
              <p className="lp-session-desc">
                Create a delegated trading session and sign once. A relayer executes your encrypted orders on-chain with no wallet popup interrupting every position. Set a per-trade margin cap and revoke the session at any time.
              </p>
            </div>
            <div className="lp-session-stats">
              <div className="lp-session-stat">
                <div className="lp-session-stat-val">1x</div>
                <div className="lp-session-stat-lbl">Wallet sign</div>
              </div>
              <div className="lp-session-stat">
                <div className="lp-session-stat-val">50</div>
                <div className="lp-session-stat-lbl">Trades max</div>
              </div>
            </div>
          </div>
        </div>

        {/* FEATURES */}
        <div id="features" className="lp-section lp-reveal">
          <p className="lp-section-tag">Features</p>
          <div className="lp-section-title">Built for serious traders</div>
          <div className="lp-features-grid">
            <div className="lp-feat-card lp-reveal lp-delay-1 lp-tilt"><div className="lp-feat-title">Dark Limit Orders</div><p className="lp-feat-desc">Place large orders without telegraphing your intent. No MEV bot can front run an order it can&apos;t see.</p></div>
            <div className="lp-feat-card lp-reveal lp-delay-2 lp-tilt"><div className="lp-feat-title">Confidential Liquidations</div><p className="lp-feat-desc">Your liquidation price is known only to the protocol. No hunter can target it, because it&apos;s encrypted.</p></div>
            <div className="lp-feat-card lp-reveal lp-delay-3 lp-tilt"><div className="lp-feat-title">Session Trading</div><p className="lp-feat-desc">Approve once, trade freely. A delegated session lets a relayer execute on your behalf with zero wallet popups between trades. Set caps per trade and revoke anytime.</p></div>
            <div className="lp-feat-card lp-reveal lp-delay-1 lp-tilt"><div className="lp-feat-title">MEV Resistant</div><p className="lp-feat-desc">Encrypted order flow eliminates exploitable signal. No sandwich attacks. No front running.</p></div>
            <div className="lp-feat-card lp-reveal lp-delay-2 lp-tilt"><div className="lp-feat-title">MPC Powered</div><p className="lp-feat-desc">Arcium&apos;s multi-party computation validates every trade with replay-hardened callbacks. Every computation consumed exactly once. Zero knowledge of your inputs. Just the outcome.</p></div>
            <div className="lp-feat-card lp-reveal lp-delay-3 lp-tilt"><div className="lp-feat-title">Verified Oracle Feeds</div><p className="lp-feat-desc">Prices sourced from CoinGecko, Binance and Coinbase. Median aggregation and circuit breakers prevent manipulation from reaching your trades.</p></div>
          </div>
        </div>

        {/* CTA */}
        <div className="lp-cta-section lp-reveal">
          <div className="lp-cta-glow" />
          <p className="lp-section-tag" style={{ textAlign: "center" }}>Ready?</p>
          <h2 className="lp-cta-title">Trade like no one<br />is watching.</h2>
          <p className="lp-cta-sub">Connect your wallet. Approve one session. Stay encrypted.</p>
          <Link href="/app" className="lp-btn-primary" style={{ display: "inline-flex", fontSize: "16px", padding: "16px 40px" }}>
            Launch App
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </Link>
        </div>

        {/* FOOTER */}
        <footer className="lp-footer">
          <span>&copy; 2026 Shadow. Built on Solana &amp; Arcium.</span>
          <span style={{ display: "flex", gap: "20px" }}>
            <a href="https://x.com/emperoar007" target="_blank" rel="noopener noreferrer">built by 0xb</a>
            <a href="https://github.com/Emperoar07/shadow" target="_blank" rel="noopener noreferrer">Docs</a>
          </span>
        </footer>

        {/* Theme toggle — fixed bottom-right */}
        <button
          className="lp-theme-toggle-btn"
          onClick={toggleTheme}
          data-light={isLight ? "true" : "false"}
          title={isLight ? "Switch to dark mode" : "Switch to light mode"}
          aria-label="Toggle theme"
          style={{ position: "fixed", right: "1.25rem", bottom: "1.25rem", zIndex: 9999 }}
        >
          <span className="lp-toggle-sun" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="4" /><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6l1.4 1.4M15 15l1.4 1.4M3.6 16.4 5 15M15 5l1.4-1.4" /></svg>
          </span>
          <span className="lp-toggle-moon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.8 2.1a7.2 7.2 0 1 0 4.1 11.7 8 8 0 1 1-4.1-11.7Z" /></svg>
          </span>
          <span className="lp-toggle-knob" />
        </button>

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
      <circle cx="50" cy="50" r="40" fill="url(#lp-logo-grad)" />
      <circle cx="62" cy="38" r="41" fill={dark ? "#05081a" : "#f8f9fc"} />
    </svg>
  );
}

