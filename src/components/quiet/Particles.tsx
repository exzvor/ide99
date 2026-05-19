import { type JSX, useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  twk: number;
}

const LINK_DIST = 130;
const MAX_PARTICLES = 120;
const MIN_PARTICLES = 50;
const AREA_PER_PARTICLE = 16000;

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = Number.parseInt(h.length === 6 ? h : "38c5ff", 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Lightweight canvas node mesh: drift + links between nearby nodes + cursor
 * repulsion. Density adapts to area; capped at {@link MAX_PARTICLES} to
 * avoid CPU spikes on large windows. Color is read from `--brand-q`, so
 * light/dark themes are inherited automatically.
 *
 * The animation is paused under `prefers-reduced-motion`, on
 * `document.hidden`, and when the component unmounts (welcome → workspace)
 * so the rAF loop does not keep running in the background.
 */
export function Particles(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)") &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    let rafId = 0;
    let lineRgb: [number, number, number] = [56, 197, 255];
    let particleRgb: [number, number, number] = [56, 197, 255];

    const mouse = { x: -9999, y: -9999, active: false };

    const readColors = () => {
      const cs = getComputedStyle(document.documentElement);
      const brand = cs.getPropertyValue("--brand-q").trim() || "#38c5ff";
      lineRgb = hexToRgb(brand);
      particleRgb = lineRgb;
    };

    const seed = () => {
      const target = Math.round(
        Math.min(MAX_PARTICLES, Math.max(MIN_PARTICLES, (width * height) / AREA_PER_PARTICLE)),
      );
      particles = [];
      for (let i = 0; i < target; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
          r: Math.random() * 1.4 + 0.4,
          twk: Math.random() * Math.PI * 2,
        });
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const isLight = () => document.documentElement.dataset.theme !== "dark";

    const drawStatic = () => {
      ctx.clearRect(0, 0, width, height);
      const baseAlpha = isLight() ? 0.55 : 0.7;
      for (const p of particles) {
        ctx.fillStyle = `rgba(${particleRgb[0]},${particleRgb[1]},${particleRgb[2]},${baseAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = () => {
      ctx.clearRect(0, 0, width, height);
      const lineMaxAlpha = isLight() ? 0.18 : 0.26;
      const particleAlphaBase = isLight() ? 0.5 : 0.7;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (!p) continue;
        p.x += p.vx;
        p.y += p.vy;
        p.twk += 0.012;
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        if (mouse.active) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 140 * 140) {
            const d = Math.sqrt(d2) || 1;
            const force = ((140 - d) / 140) * 0.6;
            p.vx += (dx / d) * force * 0.05;
            p.vy += (dy / d) * force * 0.05;
          }
        }
        p.vx *= 0.992;
        p.vy *= 0.992;
        p.vx += (Math.random() - 0.5) * 0.004;
        p.vy += (Math.random() - 0.5) * 0.004;

        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j];
          if (!q) continue;
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST * LINK_DIST) {
            const d = Math.sqrt(d2);
            const a = (1 - d / LINK_DIST) * lineMaxAlpha;
            ctx.strokeStyle = `rgba(${lineRgb[0]},${lineRgb[1]},${lineRgb[2]},${a})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        const pulse = 0.6 + 0.4 * Math.sin(p.twk);
        const alpha = particleAlphaBase * (0.6 + 0.4 * pulse);
        ctx.fillStyle = `rgba(${particleRgb[0]},${particleRgb[1]},${particleRgb[2]},${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(step);
    };

    readColors();
    resize();

    if (reduceMotion) {
      // Single frame — static nodes without links or animation.
      drawStatic();
    } else {
      rafId = requestAnimationFrame(step);
    }

    const onResize = () => {
      resize();
      if (reduceMotion) drawStatic();
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = mouse.x > 0 && mouse.x < width && mouse.y > 0 && mouse.y < height;
    };

    const onMouseLeave = () => {
      mouse.active = false;
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (!reduceMotion && !rafId) {
        rafId = requestAnimationFrame(step);
      }
    };

    const onThemeChange = () => {
      readColors();
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("visibilitychange", onVisibility);
    // useTheme only writes to data-theme, so we observe that attribute.
    const observer = new MutationObserver(onThemeChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      tabIndex={-1}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
