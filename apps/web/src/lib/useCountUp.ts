import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Smoothly rolls a displayed number toward `target` instead of snapping, e.g. the balance ticker. */
export function useCountUp(target: number, duration = 550): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (prefersReducedMotion()) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const from = displayRef.current;
    if (from === target) return undefined;

    const start = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const value = Math.round(from + (target - from) * eased);
      displayRef.current = value;
      setDisplay(value);
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return (): void => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  return display;
}
