"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
};

export default function NeuralShadowBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let particles: Particle[] = [];
    let animationFrameId = 0;

    const particleCount = 35;
    const connectionDistance = 120;
    const speed = 0.4;
    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;
    let lastFrameTime = 0;

    const isDark = () => !document.documentElement.classList.contains("light");

    const initParticles = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      particles = Array.from({ length: particleCount }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
        size: Math.random() * 2 + 1,
      }));
    };

    const animate = (timestamp: number) => {
      animationFrameId = window.requestAnimationFrame(animate);

      // Throttle to TARGET_FPS; skip frame if tab hidden
      if (document.hidden) return;
      if (timestamp - lastFrameTime < FRAME_INTERVAL) return;
      lastFrameTime = timestamp;

      const dark = isDark();
      if (dark) {
        ctx.fillStyle = "#020617";
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.clearRect(0, 0, width, height);
      }

      const nodeRgb = dark ? "6, 182, 212" : "139, 92, 246";
      const linkRgb = dark ? "79, 70, 229" : "139, 92, 246";
      const nodeOpacity = dark ? 0.6 : 0.18;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${nodeRgb}, ${nodeOpacity})`;
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const distance = Math.hypot(dx, dy);

          if (distance < connectionDistance) {
            ctx.beginPath();
            const alpha = (1 - distance / connectionDistance) * (dark ? 1 : 0.2);
            ctx.strokeStyle = `rgba(${linkRgb}, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }

    };

    initParticles();
    animationFrameId = window.requestAnimationFrame(animate);
    window.addEventListener("resize", initParticles);

    return () => {
      window.removeEventListener("resize", initParticles);
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
