/**
 * ModelStage — the 3D half of the Studio.
 *
 * The app renders this through react-three-fiber + drei (components/3d-viewer/
 * ModelViewer.tsx). This bundle has neither, so the same scene is built against
 * three directly: the same lighting rig (see lighting.ts), ACES filmic tone
 * mapping, orbit-without-pan, and the same morph mapping — influence = slider
 * value / 100, every target zeroed first, so a stage handed no values shows the
 * unmodified face.
 *
 * Two of these run side by side in the compare views, so the camera lives in a
 * shared object: whichever stage the viewer drags publishes its pose, and the
 * other picks it up on its next frame.
 */
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// The head ships meshopt-compressed + quantized (EXT_meshopt_compression,
// KHR_mesh_quantization), so the loader needs the decoder or the parse fails.
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildLights, type LightSettings } from './lighting';

const MODEL_URL = 'guide-model.glb';

/** Same defaults as the production editor. */
const CAMERA_Z = 3.5;
/** World height the head+shoulders are normalised to (visible height at z 3.5 / fov 22 is ~1.36). */
const BUST_HEIGHT = 1.35;

/** Camera pose shared by every stage on screen, so compare views orbit as one. */
export interface SharedCamera {
    position: THREE.Vector3;
    target: THREE.Vector3;
    /** Bumped by whichever stage last moved the camera. */
    version: number;
}

export function createSharedCamera(): SharedCamera {
    return { position: new THREE.Vector3(0, 0, CAMERA_Z), target: new THREE.Vector3(0, 0, 0), version: 0 };
}

export interface ModelStageProps {
    /** Morph-target keyed values, -100..100. Empty renders the original. */
    values: Record<string, number>;
    light: LightSettings;
    shared: SharedCamera;
    /** Reports the target names found on the mesh, once. */
    onTargets?: (names: string[]) => void;
    onReady?: () => void;
    className?: string;
    style?: React.CSSProperties;
}

export default function ModelStage({
    values,
    light,
    shared,
    onTargets,
    onReady,
    className,
    style,
}: ModelStageProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    // The head is split across four primitives, all carrying the same targets.
    const meshesRef = useRef<THREE.Mesh[]>([]);
    // Read inside the rAF loop so slider drags never rebuild the scene.
    const valuesRef = useRef(values);
    valuesRef.current = values;
    const lightRef = useRef(light);
    lightRef.current = light;
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const litRef = useRef<THREE.Light[]>([]);
    const originalMaterials = useRef(new Map<THREE.Mesh, THREE.Material | THREE.Material[]>());
    const clayRef = useRef<THREE.MeshStandardMaterial | null>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        let disposed = false;
        let raf = 0;

        const width = () => Math.max(host.clientWidth, 1);
        const height = () => Math.max(host.clientHeight, 1);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width(), height());
        renderer.setClearColor(0x000000, 0);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputEncoding = THREE.sRGBEncoding;
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        sceneRef.current = scene;
        const camera = new THREE.PerspectiveCamera(light.fov ?? 22, width() / height(), 0.1, 100);
        cameraRef.current = camera;
        camera.position.copy(shared.position);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 1.6;
        controls.maxDistance = 6;
        controls.target.copy(shared.target);

        // Publish this stage's pose whenever the viewer moves it; the other
        // stage adopts it on its next frame.
        let seenVersion = shared.version;
        controls.addEventListener('change', () => {
            shared.position.copy(camera.position);
            shared.target.copy(controls.target);
            seenVersion = ++shared.version;
        });

        const clay = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.6, metalness: 0 });
        clayRef.current = clay;

        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        loader.load(
            MODEL_URL,
            (gltf) => {
                if (disposed) return;
                const root = gltf.scene;

                const meshes: THREE.Mesh[] = [];
                root.traverse((child) => {
                    const m = child as THREE.Mesh;
                    if (m.isMesh) {
                        originalMaterials.current.set(m, m.material);
                        if (m.morphTargetDictionary) meshes.push(m);
                    }
                });
                // Frame to match the app's composition: the bust fills the
                // height, shoulders running off the bottom edge. Clearing the
                // tool panel is the stage's job — it slides left when the panel
                // opens, as in the app — so the subject itself stays centred.
                const box = new THREE.Box3().setFromObject(root);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const scale = BUST_HEIGHT / Math.max(size.y, 1e-4);
                root.scale.setScalar(scale);
                root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

                scene.add(root);
                meshesRef.current = meshes;
                if (meshes.length && onTargets) {
                    const dict = meshes[0].morphTargetDictionary;
                    if (dict) onTargets(Object.keys(dict));
                }
                if (onReady) onReady();
            },
            undefined,
            (error) => {
                // Surface the reason rather than leaving a silently empty stage.
                // eslint-disable-next-line no-console
                console.error('[studio] model failed to load', error);
                if (!disposed && onReady) onReady();
            },
        );

        const applyMorphs = () => {
            const vals = valuesRef.current;
            for (const mesh of meshesRef.current) {
                const dict = mesh.morphTargetDictionary;
                const influences = mesh.morphTargetInfluences;
                if (!dict || !influences) continue;
                // Reset ALL morph targets to 0 first, then apply slider values.
                for (let i = 0; i < influences.length; i++) influences[i] = 0;
                for (const name of Object.keys(vals)) {
                    const index = dict[name];
                    const value = vals[name];
                    if (index !== undefined && value) influences[index] = value / 100;
                }
            }
        };

        const frame = () => {
            raf = requestAnimationFrame(frame);
            applyMorphs();
            if (shared.version !== seenVersion) {
                camera.position.copy(shared.position);
                controls.target.copy(shared.target);
                seenVersion = shared.version;
            }
            controls.update();
            renderer.render(scene, camera);
        };
        frame();

        const ro = new ResizeObserver(() => {
            camera.aspect = width() / height();
            camera.updateProjectionMatrix();
            renderer.setSize(width(), height());
        });
        ro.observe(host);

        return () => {
            disposed = true;
            cancelAnimationFrame(raf);
            ro.disconnect();
            controls.dispose();
            scene.traverse((obj) => {
                const m = obj as THREE.Mesh;
                if (m.geometry) m.geometry.dispose();
                const mat = m.material as THREE.Material | THREE.Material[] | undefined;
                if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
                else if (mat) mat.dispose();
            });
            clay.dispose();
            renderer.dispose();
            renderer.domElement.parentNode?.removeChild(renderer.domElement);
        };
        // Built once; slider values and lighting reach the loop through refs.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Lighting rebuilds only when the settings change — cheap, and it keeps the
    // rig declarative rather than mutating a fixed set of lights.
    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;
        for (const old of litRef.current) scene.remove(old);
        const next = buildLights(light);
        for (const l of next) scene.add(l);
        litRef.current = next;
    }, [light.intensity, light.azimuth, light.elevation, light.allAngles]);

    useEffect(() => {
        const camera = cameraRef.current;
        if (!camera) return;
        camera.fov = light.fov ?? 22;
        camera.updateProjectionMatrix();
    }, [light.fov]);

    // Clay swaps the textured materials for one shared matte study material.
    useEffect(() => {
        const clay = clayRef.current;
        if (!clay) return;
        originalMaterials.current.forEach((original, mesh) => {
            mesh.material = light.wireframe ? clay : original;
        });
    }, [light.wireframe]);

    return <div ref={hostRef} className={className ?? 'st-stage'} style={style} />;
}
