"use client";

import { useEffect, useRef } from "react";

export function HeroLoan() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.pause();
      return;
    }
    void el.play().catch(() => undefined);
  }, []);

  return (
    <div className="lx-hero-video">
      <video
        ref={video}
        src="/landing-hero-flow.mp4"
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        aria-label="A holder locks ANTHROPIC and receives USDC. Bidders have committed USDC to buy the token at their own discount."
      />
    </div>
  );
}
