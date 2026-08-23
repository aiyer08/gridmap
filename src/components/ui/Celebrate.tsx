"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "./cn";

interface Particle {
  id: number;
  color: string;
  left: string;
  top: string;
  size: number;
  radius: string;
  dx: number;
  dy: number;
  scale: number;
  rotate: number;
  delay: number;
}

export interface CelebrateProps {
  /**
   * Change this value to fire a burst. `null`/`undefined` never fires.
   * Use a counter or the id of the thing that was just logged.
   */
  runKey?: number | string | null;
  /** Particle count. 18 reads as a flourish; 40+ reads as a party. */
  count?: number;
  /** `inline` fills the nearest positioned ancestor; `overlay` fills the screen. */
  mode?: "inline" | "overlay";
  /** Burst lifetime in ms. */
  duration?: number;
  /** CSS colours. Defaults to the clean end of the ramp plus the brand accent. */
  colors?: string[];
  /** Fraction of the box the burst starts from. Default dead centre. */
  origin?: { x: number; y: number };
  onDone?: () => void;
  className?: string;
}

const DEFAULT_COLORS = [
  "var(--gm-i1)",
  "var(--gm-i2)",
  "var(--gm-brand)",
  "var(--gm-fuel-solar)",
  "var(--gm-fuel-wind)",
];

/**
 * A cheap, tasteful burst for a logged win — pure CSS transforms on ~20 tiny
 * elements, no canvas, no dependency. Renders nothing on the server and
 * nothing at all when the reader prefers reduced motion.
 */
export function Celebrate({
  runKey,
  count = 20,
  mode = "inline",
  duration = 1100,
  colors = DEFAULT_COLORS,
  origin = { x: 0.5, y: 0.5 },
  onDone,
  className,
}: CelebrateProps) {
  const reduce = useReducedMotion();
  const [particles, setParticles] = React.useState<Particle[]>([]);
  const doneRef = React.useRef(onDone);
  doneRef.current = onDone;

  React.useEffect(() => {
    if (runKey === null || runKey === undefined) return;
    if (reduce) {
      doneRef.current?.();
      return;
    }

    const spread = mode === "overlay" ? 260 : 150;
    const next: Particle[] = Array.from({ length: count }, (_, i) => {
      // Fan upward and out: a fountain, not an explosion.
      const angle = (-Math.PI * 0.92 * (i + 0.5)) / count - Math.PI * 0.04;
      const power = 0.55 + Math.random() * 0.65;
      const size = 4 + Math.round(Math.random() * 5);
      return {
        id: i,
        color: colors[i % colors.length],
        left: `${origin.x * 100}%`,
        top: `${origin.y * 100}%`,
        size,
        radius: i % 3 === 0 ? "2px" : "999px",
        dx: Math.cos(angle) * spread * power,
        dy: Math.sin(angle) * spread * power - 18,
        scale: 0.5 + Math.random() * 0.7,
        rotate: Math.round((Math.random() - 0.5) * 420),
        delay: Math.random() * 90,
      };
    });

    setParticles(next);
    const timer = setTimeout(() => {
      setParticles([]);
      doneRef.current?.();
    }, duration + 140);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  if (!particles.length) return null;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none overflow-visible",
        mode === "overlay" ? "fixed inset-0 z-[90]" : "absolute inset-0 z-10",
        className,
      )}
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="gm-burst-particle absolute block"
          style={
            {
              left: p.left,
              top: p.top,
              width: p.size,
              height: p.size,
              borderRadius: p.radius,
              backgroundColor: p.color,
              "--gm-bx": `${p.dx}px`,
              "--gm-by": `${p.dy}px`,
              "--gm-bs": p.scale,
              "--gm-br": `${p.rotate}deg`,
              animation: `gm-burst ${duration}ms var(--gm-ease-out-soft) ${p.delay}ms both`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * Wraps a trigger and bursts from it. Handy for a "Log it" button:
 * `<CelebrateOn runKey={logCount}><Button …/></CelebrateOn>`
 */
export function CelebrateOn({
  runKey,
  children,
  className,
  ...rest
}: CelebrateProps & { children: React.ReactNode }) {
  return (
    <span className={cn("relative inline-flex", className)}>
      {children}
      <Celebrate runKey={runKey} mode="inline" {...rest} />
    </span>
  );
}
