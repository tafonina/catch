"use client";

import { useEffect, useRef } from "react";

export function FlowFilm() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      el.pause();
      return;
    }
    void el.play().catch(() => undefined);
  }, []);

  return (
    <video
      ref={video}
      className="aspect-video w-full bg-black"
      src="/interest-flow.mp4"
      poster="/interest-flow-poster.jpg"
      muted
      loop
      playsInline
      autoPlay
      controls
      preload="metadata"
      aria-label="Interest flows to the scarcer side. A kinked borrow rate, then a split between lenders, bidders, and the reserve."
    />
  );
}
