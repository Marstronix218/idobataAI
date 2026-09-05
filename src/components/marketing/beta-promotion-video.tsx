"use client";

import { useEffect, useRef } from "react";

export function BetaPromotionVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          void video.play().catch(() => {
            // Browser autoplay policies can still block programmatic playback.
          });
          return;
        }

        video.pause();
      },
      { threshold: [0, 0.5] },
    );

    observer.observe(video);

    return () => {
      observer.disconnect();
      video.pause();
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-[380px]">
      <div className="card relative overflow-hidden p-2 sm:p-3">
        <video
          ref={videoRef}
          aria-label="idobataAI beta product preview"
          className="aspect-[9/16] w-full rounded-[1.4rem] bg-black object-cover"
          controls
          loop
          muted
          playsInline
          preload="metadata"
        >
          <source src="/brand/videos/beta-promotion.mp4" type="video/mp4" />
          Your browser does not support embedded videos.
        </video>
      </div>
    </div>
  );
}
