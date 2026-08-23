/**
 * Lighting model — the shape the app's ModelViewer takes (LightSettings) and
 * the same rig it builds from it, expressed against three directly.
 *
 * Two modes, as in the app: a portrait rig (key at the chosen azimuth /
 * elevation, plus a low fill and a rim) and "all angles", an even shadowless
 * flood from six axis lights and eight diagonal fills.
 */
import * as THREE from 'three';

export interface LightSettings {
    /** Passed to the renderer undivided, as in the app. */
    intensity: number;
    /** Degrees, horizontal angle of the key light. */
    azimuth: number;
    /** Degrees, vertical angle of the key light. */
    elevation: number;
    /** Even light from every direction — no shadows. */
    allAngles?: boolean;
    /** Camera field of view in degrees. */
    fov?: number;
    /** Matte study material, no texture (the panel calls it Clay). */
    wireframe?: boolean;
}

/** Same defaults as the app's studio page. */
export const DEFAULT_LIGHT: LightSettings = {
    intensity: 8,
    azimuth: 0,
    elevation: 0,
    allAngles: false,
    fov: 22,
};

export const LIGHT_PRESETS: { name: string; az: number; el: number }[] = [
    { name: 'Studio', az: 0, el: 0 },
    { name: 'Portrait', az: 35, el: 30 },
    { name: 'Butterfly', az: 0, el: 55 },
    { name: 'Split', az: -80, el: 5 },
    { name: 'Rim', az: 150, el: 20 },
    { name: 'Under', az: 0, el: -45 },
];

function sphericalToCartesian(azimuthDeg: number, elevationDeg: number, radius: number): [number, number, number] {
    const azimuth = (azimuthDeg * Math.PI) / 180;
    const elevation = (elevationDeg * Math.PI) / 180;
    return [
        radius * Math.cos(elevation) * Math.sin(azimuth),
        radius * Math.sin(elevation),
        radius * Math.cos(elevation) * Math.cos(azimuth),
    ];
}

/*
 * The app runs a three where lights are in physical units (useLegacyLights
 * false, r155+); this bundle is on 0.137, whose intensities are the legacy
 * convention — the same number reads about PI times brighter. The settings keep
 * the app's values (800% is 800% in both) and the rig divides that out, so the
 * exposure matches too.
 */
const LEGACY_LIGHT_SCALE = 1 / Math.PI;

/** Builds the lights for these settings; the caller owns adding/removing them. */
export function buildLights(settings: LightSettings): THREE.Light[] {
    const s = settings.intensity * LEGACY_LIGHT_SCALE;
    const lights: THREE.Light[] = [];
    const dir = (x: number, y: number, z: number, intensity: number) => {
        const light = new THREE.DirectionalLight(0xffffff, intensity);
        light.position.set(x, y, z);
        lights.push(light);
    };

    if (settings.allAngles) {
        lights.push(new THREE.AmbientLight(0xffffff, s * 1.5));
        // Six axis-aligned lights for uniform coverage...
        dir(0, 0, 5, s * 0.7);
        dir(0, 0, -5, s * 0.7);
        dir(5, 0, 0, s * 0.7);
        dir(-5, 0, 0, s * 0.7);
        dir(0, 5, 0, s * 0.7);
        dir(0, -5, 0, s * 0.7);
        // ...and eight diagonal fills for the corners.
        for (const x of [4, -4]) {
            for (const y of [4, -4]) {
                for (const z of [4, -4]) dir(x, y, z, s * 0.5);
            }
        }
        return lights;
    }

    lights.push(new THREE.AmbientLight(0xffffff, s * 0.7));
    const [kx, ky, kz] = sphericalToCartesian(settings.azimuth, settings.elevation, 4);
    dir(kx, ky, kz, s * 1.8);   // key
    dir(0, -2, 1, s * 0.4);     // fill, softening the shadow under chin and nose
    dir(-2, 1, -3, s * 0.35);   // rim, for depth separation
    return lights;
}
