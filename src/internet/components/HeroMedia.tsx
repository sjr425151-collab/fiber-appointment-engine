import { useEffect, useRef, useState } from 'react';
import { afterLoadIdle, isConstrained, prefersReducedMotion } from '../../lib/motion';

const MOBILE_QUERY = '(max-width: 767px) and (orientation: portrait)';

/** Pick the smallest rendition that still looks sharp for this viewport. */
function chooseVideo(): string {
  if (window.matchMedia(MOBILE_QUERY).matches) return 'hero-mobile';
  const px = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
  return px > 1300 ? 'hero-1080' : 'hero-720';
}

function supportsAv1(): boolean {
  try {
    return document.createElement('video').canPlayType('video/mp4; codecs="av01.0.05M.08"') === 'probably';
  } catch {
    return false;
  }
}

/**
 * Hero background: an art-directed poster <picture> renders immediately and is
 * the LCP element. The looping video loads only after the page is idle, never
 * on reduced-motion or constrained devices, fades in once actually playing,
 * and pauses whenever it's off-screen or the tab is hidden. If the video fails
 * for any reason the poster simply stays — that's the static fallback.
 */
export default function HeroMedia() {
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (prefersReducedMotion() || isConstrained()) return;
    return afterLoadIdle(() => {
      const name = chooseVideo();
      setSrc(`/media/${name}${supportsAv1() ? '.av1' : ''}.mp4`);
    });
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    let inView = true;
    const sync = () => {
      if (inView && !document.hidden && !prefersReducedMotion()) v.play().catch(() => {});
      else v.pause();
    };
    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      sync();
    });
    io.observe(v);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    document.addEventListener('visibilitychange', sync);
    mq.addEventListener('change', sync);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      mq.removeEventListener('change', sync);
    };
  }, [src]);

  return (
    <>
      <picture>
        <source media={MOBILE_QUERY} type="image/avif" srcSet="/media/poster-mobile-480.avif 480w, /media/poster-mobile.avif 720w" sizes="100vw" />
        <source media={MOBILE_QUERY} type="image/webp" srcSet="/media/poster-mobile-480.webp 480w, /media/poster-mobile.webp 720w" sizes="100vw" />
        <source media={MOBILE_QUERY} srcSet="/media/poster-mobile-480.jpg 480w, /media/poster-mobile.jpg 720w" sizes="100vw" />
        <source type="image/avif" srcSet="/media/poster-768.avif 768w, /media/poster-1280.avif 1280w, /media/poster-1920.avif 1920w" sizes="100vw" />
        <source type="image/webp" srcSet="/media/poster-768.webp 768w, /media/poster-1280.webp 1280w, /media/poster-1920.webp 1920w" sizes="100vw" />
        <img
          src="/media/poster-1280.jpg"
          srcSet="/media/poster-768.jpg 768w, /media/poster-1280.jpg 1280w, /media/poster-1920.jpg 1920w"
          sizes="100vw"
          alt=""
          width={1920}
          height={1080}
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </picture>
      {src && (
        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${playing ? 'opacity-100' : 'opacity-0'}`}
          src={src}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
          onError={() => setSrc((s) => (s?.includes('.av1.') ? s.replace('.av1.', '.') : null))}
        />
      )}
    </>
  );
}
