"use client";

import { useEffect, useRef } from "react";

type Dot = { x: number; y: number };

export default function NeuralShadowBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0;
    let dots: Dot[] = [];
    let animationFrameId = 0;
    let time = 0;
    let lastFrameTime = 0;

    const GRID = 44;
    const TARGET_FPS = 15;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;
    const WAVE_SPEED = 0.004;
    const WAVE_WIDTH = 160;

    const initDots = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots = [];
      const cols = Math.ceil(W / GRID) + 1;
      const rows = Math.ceil(H / GRID) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots.push({ x: c * GRID, y: r * GRID });
        }
      }
    };

    const animate = (timestamp: number) => {
      animationFrameId = window.requestAnimationFrame(animate);
      if (document.hidden) return;
      if (timestamp - lastFrameTime < FRAME_INTERVAL) return;
      lastFrameTime = timestamp;

      time += WAVE_SPEED;

      // shadow-900 background
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, W, H);

      const cx = W / 2;
      const cy = H / 2;
      const maxDist = Math.hypot(cx, cy);
      const waveRadius = (time % 1) * maxDist * 1.5;

      for (const d of dots) {
        const dist = Math.hypot(d.x - cx, d.y - cy);
        const waveDelta = Math.abs(dist - waveRadius);
        const waveFactor = waveDelta < WAVE_WIDTH ? 1 - waveDelta / WAVE_WIDTH : 0;

        // Base: dim purple dot; wave peak blends purple → blue (accent palette)
        const opacity = 0.06 + waveFactor * 0.30;
        const size = 1.0 + waveFactor * 1.4;
        // hue 262 = accent-purple (#8b5cf6), 217 = accent-blue (#3b82f6)
        const hue = 262 - waveFactor * 45;
        const sat = 70 + waveFactor * 15;
        const lit = 62 + waveFactor * 12;

        ctx.beginPath();
        ctx.arc(d.x, d.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue},${sat}%,${lit}%,${opacity})`;
        ctx.fill();
      }
    };

    initDots();
    animationFrameId = window.requestAnimationFrame(animate);
    window.addEventListener("resize", initDots);

    return () => {
      window.removeEventListener("resize", initDots);
      window.cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="neural-bg-canvas fixed inset-0 z-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
