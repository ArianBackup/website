/**
 * @types/three doesn't declare the bundled meshopt decoder, but three ships it
 * and GLTFLoader.setMeshoptDecoder takes it as-is.
 */
declare module 'three/examples/jsm/libs/meshopt_decoder.module.js' {
    export const MeshoptDecoder: unknown;
}
