import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

/* ---------------------------------------------------------------------------
 * SculptLoader — the "forming face" particle animation, ported verbatim from
 * the standalone forming-face-loader.html into React + the app's npm `three`.
 *
 * Differences from the standalone (intentional, per spec):
 *  - Locked tuning: speed 0.7x, point size 0.9, drift 1.0x, repel 1.0x (the dev
 *    panel is removed; these are hardcoded).
 *  - Assembly (uProgress) tracks the displayed progress, remapped so the face
 *    forms evenly as the percentage climbs and is fully formed by FORM_FULLY_AT
 *    (~80%); it holds formed through 80→100% and gets a ring/glint finale when
 *    `complete` flips. (It does NOT self-complete; the real pipeline owns that.)
 *  - The wordmark, settings gear, dev panel, caption pill and completion card
 *    are omitted; the app renders its own chrome + the LOADING & STEPS bars.
 *  - Sizes to its container (sidebar stays visible) and cleans up fully on
 *    unmount.
 * ------------------------------------------------------------------------- */

interface HeadData {
  count: number;
  min: number[];
  max: number[];
  pos: string;
  fw: string;
  profY: number[];
  profX: number[];
  profZ: number[];
}

interface SculptLoaderProps {
  /** Assembly target, 0..1 (typically synthetic progress / 100). */
  progress: number;
  /** When true, drive the face to fully resolved + a glint/ring finale. */
  complete?: boolean;
  className?: string;
}

const DATA_URL = 'forming-face-data.json';
const DENSITY = 17000; // standalone default ("17k")
// Locked tuning (standalone dev-panel values the owner chose):
const SPEED = 0.7;
const SIZE_SCALE = 0.9;
const NOISE_AMP = 1.0;
const REPEL = 1.0;
// The face reaches full formation by this fraction of the displayed progress,
// so the in-transit dots keep flying in until ~90% (then it holds). The formed
// points are unaffected — this only changes how long the strays keep arriving.
const FORM_FULLY_AT = 0.9;
// Extra decorative "flying" dots — a SEPARATE layer, not part of the face:
// how many, and the progress fraction they stay at full strength before fading.
const AMBIENT_DOTS = 6000;
const AMBIENT_TAPER_FROM = 0.85;

function b64bytes(b: string): Uint8Array {
  const s = atob(b);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

export function SculptLoader({ progress, complete = false, className }: SculptLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef(0);
  const completeRef = useRef(false);

  useEffect(() => {
    targetRef.current = Math.max(0, Math.min(1, progress));
  }, [progress]);
  useEffect(() => {
    completeRef.current = complete;
  }, [complete]);

  useEffect(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;

    let disposed = false;
    let raf = 0;
    const removers: Array<() => void> = [];
    let renderer: THREE.WebGLRenderer | null = null;
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.ShaderMaterial | null = null;
    let ringGeo: THREE.RingGeometry | null = null;
    let ringMat: THREE.ShaderMaterial | null = null;
    let ambientGeo: THREE.BufferGeometry | null = null;
    let ambientMat: THREE.ShaderMaterial | null = null;

    fetch(DATA_URL)
      .then((r) => r.json())
      .then((HD: HeadData) => {
        if (!disposed) init(HD);
      })
      .catch(() => {
        /* leave the ambient background; the bars still convey progress */
      });

    function init(HD: HeadData) {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

      let W = Math.max(container!.clientWidth, 1);
      let H = Math.max(container!.clientHeight, 1);
      const DPR = Math.min(window.devicePixelRatio || 1, 2);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(DPR);
      renderer.setSize(W, H);
      renderer.setClearColor(0x000000, 0);
      stage!.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 20);
      camera.position.set(0, 0.02, 2.62);
      const group = new THREE.Group();
      group.position.y = -0.02;
      scene.add(group);

      const uniforms = {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uPointer: { value: new THREE.Vector2(10, 10) },
        uPointerStrength: { value: 0 },
        uAspect: { value: W / H },
        uDpr: { value: DPR },
        uRingY: { value: -2 },
        uRingOn: { value: 0 },
        uGlint: { value: 0 },
        uNoiseAmp: { value: NOISE_AMP },
        uSizeScale: { value: SIZE_SCALE },
        uRepel: { value: REPEL },
      };

      const vert = [
        'attribute vec3 aScatter;',
        'attribute float aRand;',
        'attribute float aShade;',
        'attribute float aFeat;',
        'attribute float aSize;',
        'uniform float uTime,uProgress,uPointerStrength,uAspect,uDpr,uRingY,uRingOn,uGlint,uNoiseAmp,uSizeScale,uRepel;',
        'uniform vec2 uPointer;',
        'varying float vAlpha;varying float vRing;varying vec3 vColor;',
        'vec3 drift(vec3 p,float t){',
        ' return vec3(',
        '  sin(p.y*2.1+t*0.7)+sin(p.z*1.7+t*0.93)*0.8,',
        '  sin(p.x*1.9+t*0.81)+sin(p.z*2.3+t*0.62)*0.8,',
        '  sin(p.x*2.2+t*0.54)+sin(p.y*1.8+t*0.74)*0.8)*0.5;}',
        'void main(){',
        ' float th=aRand*0.85;',
        ' float tt=smoothstep(th,th+0.15,uProgress);',
        ' vec3 pos=mix(aScatter,position,tt);',
        ' float amp=uNoiseAmp*(0.22*(1.0-tt))+0.009*tt;',
        ' pos+=drift(pos*1.6+aRand*17.0,uTime)*amp;',
        ' float ring=uRingOn*smoothstep(0.10,0.0,abs(pos.y-uRingY));',
        ' pos=mix(pos,position,ring*0.55*(1.0-tt));',
        ' vRing=ring;',
        ' vec4 mv=modelViewMatrix*vec4(pos,1.0);',
        ' vec4 clip=projectionMatrix*mv;',
        ' vec2 ndc=clip.xy/clip.w;',
        ' vec2 diff=(ndc-uPointer)*vec2(uAspect,1.0);',
        ' float dist=length(diff);',
        ' float force=exp(-dist*dist*22.0)*uPointerStrength*uRepel;',
        ' mv.xy+=normalize(diff+vec2(1e-5))*force*0.22;',
        ' gl_Position=projectionMatrix*mv;',
        ' float pulse=1.0+ring*0.8+uGlint*0.6;',
        ' gl_PointSize=aSize*uDpr*uSizeScale*pulse*(2.45/-mv.z);',
        ' vAlpha=(0.40+0.42*tt)*(0.85+0.15*aShade);',
        ' vec3 c1=vec3(0.624,0.765,0.933);',
        ' vec3 c2=vec3(0.435,0.647,0.902);',
        ' vec3 c3=vec3(0.239,0.498,0.839);',
        ' vec3 c4=vec3(0.173,0.400,0.722);',
        ' vec3 col=mix(c1,c2,smoothstep(0.0,0.55,aShade));',
        ' col=mix(col,c3,smoothstep(0.55,1.0,aShade));',
        ' col=mix(col,c4,aFeat*0.55);',
        ' vColor=col;}',
      ].join('\n');

      const frag = [
        'uniform float uGlint;',
        'varying float vAlpha;varying float vRing;varying vec3 vColor;',
        'void main(){',
        ' vec2 uv=gl_PointCoord-0.5;',
        ' float r=length(uv);',
        ' float a=smoothstep(0.5,0.14,r)*vAlpha;',
        ' vec3 col=mix(vColor,vec3(0.18,0.48,0.90),vRing*0.65+uGlint*0.35);',
        ' a*=1.0+vRing*0.55+uGlint*0.4;',
        ' gl_FragColor=vec4(col,min(a,0.95));}',
      ].join('\n');

      const Q = new Uint16Array(b64bytes(HD.pos).buffer);
      const FQ = b64bytes(HD.fw);

      function samplePoints(n: number) {
        n = Math.min(n, HD.count);
        const home = new Float32Array(n * 3);
        const scat = new Float32Array(n * 3);
        const rand = new Float32Array(n);
        const shade = new Float32Array(n);
        const feat = new Float32Array(n);
        const size = new Float32Array(n);
        const rx = HD.max[0] - HD.min[0];
        const ry = HD.max[1] - HD.min[1];
        const rz = HD.max[2] - HD.min[2];
        for (let i = 0; i < n; i++) {
          const i3 = i * 3;
          home[i3] = HD.min[0] + (Q[i3] / 65535) * rx;
          home[i3 + 1] = HD.min[1] + (Q[i3 + 1] / 65535) * ry;
          home[i3 + 2] = HD.min[2] + (Q[i3 + 2] / 65535) * rz;
          const fw = (FQ[i] / 255) * 0.9;
          const az = Math.random() * 2 * Math.PI;
          const el = Math.acos(2 * Math.random() - 1);
          const u1 = Math.random() || 1e-6;
          const rr = 0.92 + Math.sqrt(-2 * Math.log(u1)) * 0.5;
          scat[i3] = Math.sin(el) * Math.cos(az) * rr;
          scat[i3 + 1] = Math.cos(el) * rr * 0.8;
          scat[i3 + 2] = Math.sin(el) * Math.sin(az) * rr * 0.85;
          rand[i] = Math.random() * 0.7 + (1 - fw) * 0.3;
          shade[i] = Math.random();
          feat[i] = fw;
          size[i] = 2.2 + Math.random() * 2.4 + fw * 0.9;
        }
        return { home, scat, rand, shade, feat, size, count: n };
      }

      let points: THREE.Points | null = null;
      function buildCloud(n: number) {
        const d = samplePoints(n);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(d.home, 3));
        g.setAttribute('aScatter', new THREE.BufferAttribute(d.scat, 3));
        g.setAttribute('aRand', new THREE.BufferAttribute(d.rand, 1));
        g.setAttribute('aShade', new THREE.BufferAttribute(d.shade, 1));
        g.setAttribute('aFeat', new THREE.BufferAttribute(d.feat, 1));
        g.setAttribute('aSize', new THREE.BufferAttribute(d.size, 1));
        if (points) {
          group.remove(points);
          geometry?.dispose();
        }
        geometry = g;
        if (!points) {
          material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: vert,
            fragmentShader: frag,
            transparent: true,
            depthWrite: false,
            depthTest: false,
          });
          points = new THREE.Points(g, material);
          points.frustumCulled = false;
        } else {
          points.geometry = g;
        }
        group.add(points);
      }
      buildCloud(reduced ? 9000 : DENSITY);

      /* scan ring: layered soft glow that traces the bust silhouette */
      const ringUni = { uOp: { value: 0 }, uScaleAvg: { value: 1 } };
      const ringVert = [
        'varying vec2 vP;varying float vMvz;varying float vCz;',
        'void main(){',
        ' vP=position.xy;',
        ' vec4 mv=modelViewMatrix*vec4(position,1.0);',
        ' vMvz=mv.z;',
        ' vCz=(modelViewMatrix*vec4(0.0,0.0,0.0,1.0)).z;',
        ' gl_Position=projectionMatrix*mv;}',
      ].join('\n');
      const ringFrag = [
        'uniform float uOp;uniform float uScaleAvg;',
        'varying vec2 vP;varying float vMvz;varying float vCz;',
        'void main(){',
        ' float d=(length(vP)-1.0)*uScaleAvg;',
        ' float core=exp(-d*d*24000.0);',
        ' float mid=exp(-d*d*1250.0);',
        ' float glow=exp(-d*d*90.0);',
        ' float front=0.30+0.70*smoothstep(-0.10,0.30,vMvz-vCz);',
        ' vec3 deep=vec3(0.145,0.40,0.78);',
        ' vec3 sky=vec3(0.50,0.71,0.95);',
        ' vec3 col=mix(sky,deep,clamp(core+mid*0.6,0.0,1.0));',
        ' float a=(core*0.85+mid*0.40+glow*0.18)*uOp*front;',
        ' if(a<0.003)discard;',
        ' gl_FragColor=vec4(col,a);}',
      ].join('\n');
      ringMat = new THREE.ShaderMaterial({
        uniforms: ringUni,
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      ringGeo = new THREE.RingGeometry(0.45, 1.5, 128, 1);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 3;
      ring.visible = false;
      group.add(ring);

      /* ambient "flying dots" — a SEPARATE decorative layer that does NOT touch
         the face cloud. A halo of points drifting around the bust, held at full
         strength until AMBIENT_TAPER_FROM of progress, then faded out. */
      const ambientUni = {
        uTime: { value: 0 },
        uAmbient: { value: 1 },
        uDpr: { value: DPR },
        uSizeScale: { value: SIZE_SCALE },
      };
      const ambN = reduced ? 0 : AMBIENT_DOTS;
      if (ambN > 0) {
        const apos = new Float32Array(ambN * 3);
        const arnd = new Float32Array(ambN);
        const asz = new Float32Array(ambN);
        const ashd = new Float32Array(ambN);
        for (let i = 0; i < ambN; i++) {
          const i3 = i * 3;
          const az = Math.random() * 2 * Math.PI;
          const el = Math.acos(2 * Math.random() - 1);
          const u1 = Math.random() || 1e-6;
          const rr = 0.95 + Math.sqrt(-2 * Math.log(u1)) * 0.55;
          apos[i3] = Math.sin(el) * Math.cos(az) * rr;
          apos[i3 + 1] = Math.cos(el) * rr * 0.85;
          apos[i3 + 2] = Math.sin(el) * Math.sin(az) * rr * 0.9;
          arnd[i] = Math.random();
          asz[i] = 1.8 + Math.random() * 2.2;
          ashd[i] = Math.random();
        }
        const ag = new THREE.BufferGeometry();
        ag.setAttribute('position', new THREE.BufferAttribute(apos, 3));
        ag.setAttribute('aRand', new THREE.BufferAttribute(arnd, 1));
        ag.setAttribute('aSize', new THREE.BufferAttribute(asz, 1));
        ag.setAttribute('aShade', new THREE.BufferAttribute(ashd, 1));
        ambientGeo = ag;
        const aVert = [
          'attribute float aRand;attribute float aSize;attribute float aShade;',
          'uniform float uTime,uAmbient,uDpr,uSizeScale;',
          'varying float vA;varying vec3 vCol;',
          'vec3 drift(vec3 p,float t){',
          ' return vec3(',
          '  sin(p.y*2.1+t*0.7)+sin(p.z*1.7+t*0.93)*0.8,',
          '  sin(p.x*1.9+t*0.81)+sin(p.z*2.3+t*0.62)*0.8,',
          '  sin(p.x*2.2+t*0.54)+sin(p.y*1.8+t*0.74)*0.8)*0.5;}',
          'void main(){',
          ' vec3 pos=position;',
          ' pos+=drift(pos*1.5+aRand*19.0,uTime*0.9)*0.24;',
          ' vec4 mv=modelViewMatrix*vec4(pos,1.0);',
          ' gl_Position=projectionMatrix*mv;',
          ' gl_PointSize=aSize*uDpr*uSizeScale*(2.45/-mv.z);',
          ' vA=(0.30+0.28*aShade)*uAmbient;',
          ' vCol=mix(vec3(0.624,0.765,0.933),vec3(0.435,0.647,0.902),aShade);}',
        ].join('\n');
        const aFrag = [
          'varying float vA;varying vec3 vCol;',
          'void main(){',
          ' vec2 uv=gl_PointCoord-0.5;float r=length(uv);',
          ' float a=smoothstep(0.5,0.14,r)*vA;',
          ' if(a<0.003)discard;',
          ' gl_FragColor=vec4(vCol,min(a,0.9));}',
        ].join('\n');
        ambientMat = new THREE.ShaderMaterial({
          uniforms: ambientUni,
          vertexShader: aVert,
          fragmentShader: aFrag,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        });
        const ambientPoints = new THREE.Points(ag, ambientMat);
        ambientPoints.frustumCulled = false;
        group.add(ambientPoints);
      }

      function profAt(y: number): [number, number] {
        const y0 = HD.profY[0];
        const y1 = HD.profY[1];
        const n = HD.profX.length;
        let t = ((y - y0) / (y1 - y0)) * (n - 1);
        t = Math.max(0, Math.min(n - 1, t));
        const i = Math.floor(t);
        const f = t - i;
        const j = Math.min(i + 1, n - 1);
        return [HD.profX[i] * (1 - f) + HD.profX[j] * f, HD.profZ[i] * (1 - f) + HD.profZ[j] * f];
      }

      /* ---------------- state ---------------- */
      const S = {
        time: 0,
        progress: 0,
        speed: SPEED,
        yaw: 0,
        yawOff: 0,
        pitchOff: 0,
        yawVel: 0,
        dragging: false,
        dragMove: 0,
        lastInteract: -10,
        ringT: -1,
        ringFast: false,
        glint: 0,
        ambient: 1,
        completedOnce: false,
      };

      /* ---------------- pointer ---------------- */
      const ptrTarget = new THREE.Vector2(10, 10);
      let ptrStrTarget = 0;
      let tapBoost = 0;
      const cnv = renderer.domElement;
      let lastPX: number | null = null;
      let lastPY: number | null = null;

      const onPointerMove = (e: PointerEvent) => {
        const r = container!.getBoundingClientRect();
        ptrTarget.set(((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1, -(((e.clientY - r.top) / Math.max(r.height, 1)) * 2 - 1));
        ptrStrTarget = 1;
        const mx = lastPX === null ? 0 : e.clientX - lastPX;
        const my = lastPY === null ? 0 : e.clientY - lastPY;
        lastPX = e.clientX;
        lastPY = e.clientY;
        if (S.dragging) {
          S.yawVel = mx * 0.0035;
          S.yawOff = Math.max(-0.55, Math.min(0.55, S.yawOff + mx * 0.0035));
          S.pitchOff = Math.max(-0.18, Math.min(0.18, S.pitchOff + my * 0.0022));
          S.dragMove = S.dragMove + Math.abs(mx) + Math.abs(my);
          S.lastInteract = S.time;
        }
      };
      const onPointerOut = (e: PointerEvent) => {
        if (!e.relatedTarget) ptrStrTarget = 0;
      };
      const onBlur = () => {
        ptrStrTarget = 0;
      };
      const onPointerDown = (e: PointerEvent) => {
        S.dragging = true;
        S.dragMove = 0;
        lastPX = e.clientX;
        lastPY = e.clientY;
        S.lastInteract = S.time;
      };
      const onPointerUp = (e: PointerEvent) => {
        if (S.dragging && S.dragMove < 6 && e.pointerType !== 'mouse') tapBoost = 1.8;
        S.dragging = false;
      };
      window.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerout', onPointerOut);
      window.addEventListener('blur', onBlur);
      cnv.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointerup', onPointerUp);
      removers.push(
        () => window.removeEventListener('pointermove', onPointerMove),
        () => document.removeEventListener('pointerout', onPointerOut),
        () => window.removeEventListener('blur', onBlur),
        () => cnv.removeEventListener('pointerdown', onPointerDown),
        () => window.removeEventListener('pointerup', onPointerUp),
      );

      /* ---------------- ring sweep ---------------- */
      const RING_INTERVAL = 6.5;
      const RING_DUR = 2.2;
      const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      let nextRing = 2.0;
      function updateRing(dt: number) {
        if (reduced) {
          uniforms.uRingOn.value = 0;
          ring.visible = false;
          return;
        }
        if (S.ringT < 0) {
          if (S.time >= nextRing && !completeRef.current) {
            S.ringT = 0;
          } else {
            uniforms.uRingOn.value *= 0.9;
            ringUni.uOp.value *= 0.85;
            if (ringUni.uOp.value < 0.01) ring.visible = false;
            return;
          }
        }
        const dur = S.ringFast ? 0.7 : RING_DUR;
        S.ringT += dt;
        const t = S.ringT / dur;
        if (t >= 1) {
          S.ringT = -1;
          S.ringFast = false;
          nextRing = S.time + RING_INTERVAL - dur;
          return;
        }
        const y0 = HD.profY[0] - 0.06;
        const y1 = HD.profY[1] + 0.06;
        const y = y0 + (y1 - y0) * easeIO(t);
        const amp = Math.pow(Math.sin(Math.PI * t), 1.25);
        uniforms.uRingY.value = y;
        uniforms.uRingOn.value = amp;
        const pr = profAt(y);
        const sx = pr[0] * 1.14 + 0.03;
        const sz = pr[1] * 1.14 + 0.03;
        ring.visible = true;
        ring.position.y = y;
        ring.scale.set(sx, sz, 1);
        ringUni.uScaleAvg.value = (sx + sz) * 0.5;
        ringUni.uOp.value = amp;
      }

      /* ---------------- main loop ---------------- */
      const clock = new THREE.Clock();
      const BASE_YAW = (2 * Math.PI) / 14;

      function frame() {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(clock.getDelta(), 0.05);
        S.time += dt;
        uniforms.uTime.value = S.time;

        // Assembly tracks the displayed progress, remapped so the face forms
        // evenly as the % climbs and is fully formed by FORM_FULLY_AT (~80%),
        // then holds. Completion forces a full resolve + finale.
        const target = completeRef.current ? 1 : Math.min(1, targetRef.current / FORM_FULLY_AT);
        S.progress += (target - S.progress) * Math.min(dt * 3, 1);
        if (reduced) S.progress = Math.max(S.progress, target);
        uniforms.uProgress.value = S.progress;

        // Ambient flying-dot layer: full strength until AMBIENT_TAPER_FROM of
        // the displayed progress, then fade out by 100% (and on completion).
        ambientUni.uTime.value = S.time;
        const ambTarget = completeRef.current
          ? 0
          : 1 - Math.min(1, Math.max(0, (targetRef.current - AMBIENT_TAPER_FROM) / (1 - AMBIENT_TAPER_FROM)));
        S.ambient += (ambTarget - S.ambient) * Math.min(dt * 2, 1);
        ambientUni.uAmbient.value = S.ambient;

        // One-time finale when completion lands: fast ring sweep + glint.
        if (completeRef.current && !S.completedOnce) {
          S.completedOnce = true;
          if (S.ringT < 0) {
            S.ringT = 0;
            S.ringFast = true;
          }
        }
        const glintTarget = completeRef.current ? 0.6 : 0;
        S.glint += (glintTarget - S.glint) * Math.min(dt * 2.5, 1);
        uniforms.uGlint.value = S.glint;

        // rotation + float
        if (!reduced) {
          S.yaw += BASE_YAW * S.speed * dt * (completeRef.current ? 0.4 : 1);
          if (!S.dragging) {
            S.yawOff += S.yawVel;
            S.yawVel *= 0.93;
            if (S.time - S.lastInteract > 2) {
              S.yawOff *= 1 - Math.min(dt * 1.5, 1);
              S.pitchOff *= 1 - Math.min(dt * 1.5, 1);
            }
          }
          group.rotation.y = S.yaw + S.yawOff;
          group.rotation.x = S.pitchOff;
          group.position.y = -0.02 + Math.sin(S.time * 1.5) * 0.012 * (0.3 + 0.7 * S.progress);
        }

        // pointer uniforms
        tapBoost *= 0.94;
        uniforms.uPointer.value.lerp(ptrTarget, Math.min(dt * 7, 1));
        const str = Math.min(ptrStrTarget + tapBoost, 1.9);
        uniforms.uPointerStrength.value += (str - uniforms.uPointerStrength.value) * Math.min(dt * 5, 1);
        uniforms.uAspect.value = W / H;

        updateRing(dt);
        renderer!.render(scene, camera);
      }
      frame();

      /* ---------------- resize ---------------- */
      const ro = new ResizeObserver(() => {
        W = Math.max(container!.clientWidth, 1);
        H = Math.max(container!.clientHeight, 1);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        renderer!.setSize(W, H);
      });
      ro.observe(container!);
      removers.push(() => ro.disconnect());

      const onVis = () => {
        if (document.hidden) clock.stop();
        else clock.start();
      };
      document.addEventListener('visibilitychange', onVis);
      removers.push(() => document.removeEventListener('visibilitychange', onVis));
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      removers.forEach((f) => f());
      geometry?.dispose();
      material?.dispose();
      ringGeo?.dispose();
      ringMat?.dispose();
      ambientGeo?.dispose();
      ambientMat?.dispose();
      if (renderer) {
        renderer.dispose();
        const el = renderer.domElement;
        el.parentNode?.removeChild(el);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className={`sl-root ${className ?? ''}`}>
      <div className="sl-wash sl-washA" />
      <div className="sl-wash sl-washB" />
      <div className="sl-rings">
        <div />
        <div />
        <div />
        <div />
        <div />
      </div>
      <div ref={stageRef} className="sl-stage" />
    </div>
  );
}

export default SculptLoader;
