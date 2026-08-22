/**
 * ModelStage — the 3D half of the Studio.
 *
 * The app renders this through react-three-fiber + drei (components/3d-viewer/
 * ModelViewer.tsx). This bundle has neither, so the same scene is built against
 * three directly: identical lighting rig (ambient + six axis-aligned
 * directionals), ACES filmic tone mapping, orbit-without-pan, and the same
 * morph mapping — influence = slider value / 100, every target zeroed first.
 */
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// The sample head ships meshopt-compressed + quantized (EXT_meshopt_compression,
// KHR_mesh_quantization), so the loader needs the decoder or the parse fails.
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const MODEL_URL = 'guide-model.glb';

/** Same defaults as the production editor. */
const FOV = 22;
const CAMERA_Z = 3.5;
const LIGHT_INTENSITY = 8;
/** World height the head+shoulders are normalised to (visible height at z 3.5 / fov 22 is ~1.36). */
const BUST_HEIGHT = 1.35;
/** Push the subject left of centre, clear of the tool panel. */
const SUBJECT_OFFSET_X = 0.18;

export interface ModelStageProps {
    /** Morph-target keyed values, -100..100. */
    values: Record<string, number>;
    /** Reports the target names found on the mesh, once. */
    onTargets: (names: string[]) => void;
    onReady: () => void;
}

export default function ModelStage({ values, onTargets, onReady }: ModelStageProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const meshRef = useRef<THREE.Mesh | null>(null);
    // Read inside the rAF loop so slider drags never rebuild the scene.
    const valuesRef = useRef(values);
    valuesRef.current = values;

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
        const camera = new THREE.PerspectiveCamera(FOV, width() / height(), 0.1, 100);
        camera.position.set(SUBJECT_OFFSET_X, 0, CAMERA_Z);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 1.6;
        controls.maxDistance = 6;
        controls.target.set(SUBJECT_OFFSET_X, 0, 0);

        // Lighting rig, matching ModelViewer's default (non-"all angles") mode.
        const s = LIGHT_INTENSITY;
        scene.add(new THREE.AmbientLight(0xffffff, s * 1.5));
        const dirs: [number, number, number][] = [
            [0, 0, 5],
            [0, 0, -5],
            [5, 0, 0],
            [-5, 0, 0],
            [0, 5, 0],
            [0, -5, 0],
        ];
        for (const [x, y, z] of dirs) {
            const light = new THREE.DirectionalLight(0xffffff, s * 0.7);
            light.position.set(x, y, z);
            scene.add(light);
        }

        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        loader.load(
            MODEL_URL,
            (gltf) => {
                if (disposed) return;
                const root = gltf.scene;

                let mesh: THREE.Mesh | null = null;
                root.traverse((child) => {
                    const m = child as THREE.Mesh;
                    if (m.isMesh && m.morphTargetDictionary && !mesh) mesh = m;
                });
                // Frame to match the app's composition: the bust fills the height
                // (shoulders running off the bottom edge) and sits left of centre
                // so the floating tool panel doesn't cover the face.
                const box = new THREE.Box3().setFromObject(root);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const scale = BUST_HEIGHT / Math.max(size.y, 1e-4);
                root.scale.setScalar(scale);
                root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

                scene.add(root);
                meshRef.current = mesh;
                if (mesh) {
                    const dict = (mesh as THREE.Mesh).morphTargetDictionary;
                    if (dict) onTargets(Object.keys(dict));
                }
                onReady();
            },
            undefined,
            (error) => {
                // Surface the reason rather than leaving a silently empty stage.
                // eslint-disable-next-line no-console
                console.error('[studio] model failed to load', error);
                if (!disposed) onReady();
            },
        );

        const applyMorphs = () => {
            const mesh = meshRef.current;
            if (!mesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
            // Reset ALL morph targets to 0 first, then apply slider values.
            for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
                mesh.morphTargetInfluences[i] = 0;
            }
            const dict = mesh.morphTargetDictionary;
            const vals = valuesRef.current;
            for (const name of Object.keys(vals)) {
                const index = dict[name];
                const value = vals[name];
                if (index !== undefined && value) mesh.morphTargetInfluences[index] = value / 100;
            }
        };

        const frame = () => {
            raf = requestAnimationFrame(frame);
            applyMorphs();
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
            renderer.dispose();
            renderer.domElement.parentNode?.removeChild(renderer.domElement);
        };
        // Built once; slider values reach the loop through valuesRef.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div ref={hostRef} className="st-stage" />;
}
