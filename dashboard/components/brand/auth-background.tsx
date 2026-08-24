'use client';

import dynamic from 'next/dynamic';

/**
 * The animated dot-matrix backdrop used on the sign-in screen — extracted so the
 * public legal pages can share the exact same background. Three.js is client-only
 * (ssr:false) so it stays out of the server bundle.
 *
 * `className` controls the wrapper: the sign-in screen uses the default
 * (absolute, inside its fixed full-screen overlay); the scrolling legal pages
 * pass `fixed inset-0 z-0` so the backdrop stays put behind the content.
 */
const CanvasRevealEffect = dynamic(
  () => import('@/components/ui/sign-in-flow-1').then((m) => m.CanvasRevealEffect),
  { ssr: false },
);

export function AuthBackground({ className = 'absolute inset-0 z-0' }: { className?: string }) {
  return (
    <div className={className}>
      <CanvasRevealEffect
        animationSpeed={3}
        dotSize={6}
        reverse={false}
        showGradient={false}
        containerClassName="bg-white"
        colors={[[0, 153, 255]]}
        opacities={[0, 0, 0, 0, 0.35, 0.5, 0.65, 0.8, 1, 1]}
      />
      <div className="absolute inset-x-0 top-0 h-[25.5%] bg-gradient-to-b from-white to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[25.5%] bg-gradient-to-t from-white to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,1)_0%,_transparent_100%)]" />
    </div>
  );
}
