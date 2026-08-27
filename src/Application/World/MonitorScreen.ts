import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import GUI from 'lil-gui';
import Application from '../Application';
import Debug from '../Utils/Debug';
import Resources from '../Utils/Resources';
import Sizes from '../Utils/Sizes';
import Camera from '../Camera/Camera';
import EventEmitter from '../Utils/EventEmitter';

const SCREEN_SIZE = { w: 1280, h: 1024 };
// The desktop on the screen has a CRT treatment of its own, so this one is off
// unless the viewer asks for it from the start menu.
const CRT_EFFECT_KEY = 'arian-portfolio:crt-effect';
// The desktop ships with this site (static/os -> public/os), so it is
// same-origin and needs no separate deployment.
const SCREEN_URL = '/os/index.html';
/**
 * How long after reaching the computer the desktop starts. Mounting a bundled
 * desktop is enough main-thread work to stutter an animation, so the boot waits
 * for the camera's move into the monitor. That move is nominally 2000ms, but on
 * a (0.13, 0.99, 0, 1) curve it covers 99% of the distance in the first 13% —
 * everything after ~260ms is an imperceptible settle — so it waits out the part
 * that shows.
 */
const SCREEN_BOOT_DELAY = 1500;
const IFRAME_PADDING = 32;
const IFRAME_SIZE = {
    w: SCREEN_SIZE.w - IFRAME_PADDING,
    h: SCREEN_SIZE.h - IFRAME_PADDING,
};

export default class MonitorScreen extends EventEmitter {
    application: Application;
    scene: THREE.Scene;
    cssScene: THREE.Scene;
    resources: Resources;
    debug: Debug;
    sizes: Sizes;
    debugFolder: GUI;
    screenSize: THREE.Vector2;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    camera: Camera;
    prevInComputer: boolean;
    shouldLeaveMonitor: boolean;
    inComputer: boolean;
    mouseClickInProgress: boolean;
    dimmingPlane: THREE.Mesh;
    videoTextures: { [key in string]: THREE.VideoTexture };
    iframe: HTMLIFrameElement;
    crtEffectMeshes: THREE.Mesh[];
    screenBooted: boolean;
    bootTimer: number;

    constructor() {
        super();
        this.application = new Application();
        this.scene = this.application.scene;
        this.cssScene = this.application.cssScene;
        this.sizes = this.application.sizes;
        this.resources = this.application.resources;
        this.screenSize = new THREE.Vector2(SCREEN_SIZE.w, SCREEN_SIZE.h);
        this.camera = this.application.camera;
        this.position = new THREE.Vector3(0, 950, 255);
        this.rotation = new THREE.Euler(-3 * THREE.MathUtils.DEG2RAD, 0, 0);
        this.videoTextures = {};
        this.crtEffectMeshes = [];
        this.mouseClickInProgress = false;
        this.shouldLeaveMonitor = false;
        this.screenBooted = false;
        this.bootTimer = 0;

        // Create screen
        this.initializeScreenEvents();
        this.createIframe();
        this.prefetchScreen();
        const maxOffset = this.createTextureLayers();
        this.createEnclosingPlanes(maxOffset);
        this.createPerspectiveDimmer(maxOffset);
        this.setCrtEffect(MonitorScreen.crtEffectPreference());
    }

    /**
     * Reads the viewer's saved choice. Defaults to off.
     */
    static crtEffectPreference(): boolean {
        try {
            return window.localStorage.getItem(CRT_EFFECT_KEY) === '1';
        } catch (error) {
            return false;
        }
    }

    /**
     * Shows or hides the grime, static and jitter that sit over the screen.
     * The static videos are paused while hidden so they are not decoded for
     * nothing.
     */
    setCrtEffect(enabled: boolean) {
        this.crtEffectMeshes.forEach((mesh) => {
            mesh.visible = enabled;
        });

        if (this.iframe) {
            this.iframe.classList.toggle('jitter', enabled);
        }

        Object.values(this.videoTextures).forEach((texture) => {
            const video = texture.image as HTMLVideoElement;
            if (!video) return;
            if (enabled) {
                const played = video.play();
                if (played) played.catch(() => {});
            } else {
                video.pause();
            }
        });

        try {
            window.localStorage.setItem(CRT_EFFECT_KEY, enabled ? '1' : '0');
        } catch (error) {
            // storage unavailable (private mode); the setting just won't persist
        }
    }

    initializeScreenEvents() {
        document.addEventListener(
            'mousemove',
            (event) => {
                // @ts-ignore
                const id = event.target.id;
                if (id === 'computer-screen') {
                    // @ts-ignore
                    event.inComputer = true;
                }

                // @ts-ignore
                this.inComputer = event.inComputer;

                if (this.inComputer && !this.prevInComputer) {
                    this.bootScreen();
                    this.camera.trigger('enterMonitor');
                }

                if (
                    !this.inComputer &&
                    this.prevInComputer &&
                    !this.mouseClickInProgress
                ) {
                    this.cancelBoot();
                    this.camera.trigger('leftMonitor');
                }

                if (
                    !this.inComputer &&
                    this.mouseClickInProgress &&
                    this.prevInComputer
                ) {
                    this.shouldLeaveMonitor = true;
                } else {
                    this.shouldLeaveMonitor = false;
                }

                this.application.mouse.trigger('mousemove', [event]);

                this.prevInComputer = this.inComputer;
            },
            false
        );
        document.addEventListener(
            'mousedown',
            (event) => {
                // @ts-ignore
                this.inComputer = event.inComputer;
                // Belt and braces for anything that reaches the screen without
                // a hover first.
                if (this.inComputer) this.bootScreen();
                this.application.mouse.trigger('mousedown', [event]);

                this.mouseClickInProgress = true;
                this.prevInComputer = this.inComputer;
            },
            false
        );
        document.addEventListener(
            'mouseup',
            (event) => {
                // @ts-ignore
                this.inComputer = event.inComputer;
                this.application.mouse.trigger('mouseup', [event]);

                if (this.shouldLeaveMonitor) {
                    this.cancelBoot();
                    this.camera.trigger('leftMonitor');
                    this.shouldLeaveMonitor = false;
                }

                this.mouseClickInProgress = false;
                this.prevInComputer = this.inComputer;
            },
            false
        );
    }

    /**
     * Boots the desktop on the screen, once, when a viewer first goes to the
     * computer. Loading it with the page would have the machine running — a
     * bundled desktop, its videos and the studio's WebGL — behind a scene
     * nobody has reached yet; this way the monitor sits dark until it is
     * approached, and then starts up as a computer would.
     *
     * The document is prefetched (see prefetchScreen), so the boot is not
     * waiting on the network by the time it is asked for.
     */
    bootScreen() {
        if (this.screenBooted || this.bootTimer || !this.iframe) return;
        this.bootTimer = window.setTimeout(() => {
            this.bootTimer = 0;
            this.screenBooted = true;
            this.iframe.src = SCREEN_URL;
        }, SCREEN_BOOT_DELAY);
    }

    /** Turned away before the machine started; it starts on the next approach. */
    cancelBoot() {
        if (!this.bootTimer) return;
        window.clearTimeout(this.bootTimer);
        this.bootTimer = 0;
    }

    /**
     * Warms the browser cache for the desktop without running it, so the boot
     * above is instant. Deliberately low priority: the 3D scene the viewer is
     * actually looking at comes first.
     */
    prefetchScreen() {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.as = 'document';
        link.href = SCREEN_URL;
        document.head.appendChild(link);
    }

    /**
     * Creates the iframe for the computer screen
     */
    createIframe() {
        // Create container
        const container = document.createElement('div');
        container.style.width = this.screenSize.width + 'px';
        container.style.height = this.screenSize.height + 'px';
        container.style.opacity = '1';
        container.style.background = '#1d2e2f';

        // Create iframe
        const iframe = document.createElement('iframe');

        /**
         * Replays an interaction that happened inside the screen as an event on
         * the iframe element, so the camera and audio (which listen on document
         * and check `inComputer`) can react to it.
         */
        const dispatchFromScreen = (data: {
            type: string;
            clientX?: number;
            clientY?: number;
            key?: string;
        }) => {
            const evt = new CustomEvent(data.type, {
                bubbles: true,
                cancelable: false,
            });

            // @ts-ignore
            evt.inComputer = true;
            if (data.type === 'mousemove') {
                const clRect = iframe.getBoundingClientRect();
                const { top, left, width, height } = clRect;
                const widthRatio = width / IFRAME_SIZE.w;
                const heightRatio = height / IFRAME_SIZE.h;

                // @ts-ignore
                evt.clientX = Math.round((data.clientX ?? 0) * widthRatio + left);
                //@ts-ignore
                evt.clientY = Math.round((data.clientY ?? 0) * heightRatio + top);
            } else if (data.type === 'keydown' || data.type === 'keyup') {
                // @ts-ignore
                evt.key = data.key;
            }

            iframe.dispatchEvent(evt);
        };

        // The app posts synthetic keystrokes to itself (the typing sounds on the
        // info overlay), so this listener stays regardless of what the screen is.
        window.addEventListener('message', (event) => {
            if (!event.data || typeof event.data.type !== 'string') return;
            // The start menu on the screen toggles the CRT overlay.
            if (event.data.type === 'crt-effect') {
                this.setCrtEffect(!!event.data.enabled);
                return;
            }
            dispatchFromScreen(event.data);
        });

        // The screen is served from this same origin, so its events can be read
        // directly rather than relying on the page inside to post them out.
        iframe.onload = () => {
            const screenDocument = iframe.contentDocument;
            if (!screenDocument) return;

            screenDocument.addEventListener('mousemove', (event) => {
                dispatchFromScreen({
                    type: 'mousemove',
                    clientX: event.clientX,
                    clientY: event.clientY,
                });
            });
            (['mousedown', 'mouseup'] as const).forEach((type) => {
                screenDocument.addEventListener(type, () => {
                    dispatchFromScreen({ type });
                });
            });
            (['keydown', 'keyup'] as const).forEach((type) => {
                screenDocument.addEventListener(type, (event) => {
                    dispatchFromScreen({ type, key: event.key });
                });
            });
        };

        // Set iframe attributes. The src is left off until someone actually
        // goes to the computer — see bootScreen().
        iframe.style.width = this.screenSize.width + 'px';
        iframe.style.height = this.screenSize.height + 'px';
        iframe.style.padding = IFRAME_PADDING + 'px';
        iframe.style.boxSizing = 'border-box';
        iframe.style.opacity = '1';
        iframe.className = 'screen';
        iframe.id = 'computer-screen';
        iframe.frameBorder = '0';
        iframe.title = 'FarhadiOS';

        this.iframe = iframe;

        // Add iframe to container
        container.appendChild(iframe);

        // Create CSS plane
        this.createCssPlane(container);
    }

    /**
     * Creates a CSS plane and GL plane to properly occlude the CSS plane
     * @param element the element to create the css plane for
     */
    createCssPlane(element: HTMLElement) {
        // Create CSS3D object
        const object = new CSS3DObject(element);

        // copy monitor position and rotation
        object.position.copy(this.position);
        object.rotation.copy(this.rotation);

        // Add to CSS scene
        this.cssScene.add(object);

        // Create GL plane
        const material = new THREE.MeshLambertMaterial();
        material.side = THREE.DoubleSide;
        material.opacity = 0;
        material.transparent = true;
        // NoBlending allows the GL plane to occlude the CSS plane
        material.blending = THREE.NoBlending;

        // Create plane geometry
        const geometry = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height
        );

        // Create the GL plane mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Copy the position, rotation and scale of the CSS plane to the GL plane
        mesh.position.copy(object.position);
        mesh.rotation.copy(object.rotation);
        mesh.scale.copy(object.scale);

        // Add to gl scene
        this.scene.add(mesh);
    }

    /**
     * Creates the texture layers for the computer screen
     * @returns the maximum offset of the texture layers
     */
    createTextureLayers() {
        const textures = this.resources.items.texture;

        this.getVideoTextures('video-1');
        this.getVideoTextures('video-2');

        // Scale factor to multiply depth offset by
        const scaleFactor = 4;

        // Construct the texture layers. `effect` marks the ones that make up the
        // CRT treatment; the inner shadow is left on always, since it is what
        // seats the screen into the bezel rather than a stylistic overlay.
        const layers = {
            smudge: {
                texture: textures.monitorSmudgeTexture,
                blending: THREE.AdditiveBlending,
                opacity: 0.12,
                offset: 24,
                effect: true,
            },
            innerShadow: {
                texture: textures.monitorShadowTexture,
                blending: THREE.NormalBlending,
                opacity: 1,
                offset: 5,
                effect: false,
            },
            video: {
                texture: this.videoTextures['video-1'],
                blending: THREE.AdditiveBlending,
                opacity: 0.5,
                offset: 10,
                effect: true,
            },
            video2: {
                texture: this.videoTextures['video-2'],
                blending: THREE.AdditiveBlending,
                opacity: 0.1,
                offset: 15,
                effect: true,
            },
        };

        // Declare max offset
        let maxOffset = -1;

        // Add the texture layers to the screen
        for (const [_, layer] of Object.entries(layers)) {
            const offset = layer.offset * scaleFactor;
            const mesh = this.addTextureLayer(
                layer.texture,
                layer.blending,
                layer.opacity,
                offset
            );
            if (layer.effect) this.crtEffectMeshes.push(mesh);
            // Calculate the max offset
            if (offset > maxOffset) maxOffset = offset;
        }

        // Return the max offset
        return maxOffset;
    }

    getVideoTextures(videoId: string) {
        const video = document.getElementById(videoId);
        if (!video) {
            setTimeout(() => {
                this.getVideoTextures(videoId);
            }, 100);
        } else {
            this.videoTextures[videoId] = new THREE.VideoTexture(
                video as HTMLVideoElement
            );
        }
    }

    /**
     * Adds a texture layer to the screen
     * @param texture the texture to add
     * @param blending the blending mode
     * @param opacity the opacity of the texture
     * @param offset the offset of the texture, higher values are further from the screen
     */
    addTextureLayer(
        texture: THREE.Texture,
        blendingMode: THREE.Blending,
        opacity: number,
        offset: number
    ): THREE.Mesh {
        // Create material
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            blending: blendingMode,
            side: THREE.DoubleSide,
            opacity,
            transparent: true,
        });

        // Create geometry
        const geometry = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height
        );

        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Copy position and apply the depth offset
        mesh.position.copy(
            this.offsetPosition(this.position, new THREE.Vector3(0, 0, offset))
        );

        // Copy rotation
        mesh.rotation.copy(this.rotation);

        this.scene.add(mesh);

        return mesh;
    }

    /**
     * Creates enclosing planes for the computer screen
     * @param maxOffset the maximum offset of the texture layers
     */
    createEnclosingPlanes(maxOffset: number) {
        // Create planes, lots of boiler plate code here because I'm lazy
        const planes = {
            left: {
                size: new THREE.Vector2(maxOffset, this.screenSize.height),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        -this.screenSize.width / 2,
                        0,
                        maxOffset / 2
                    )
                ),
                rotation: new THREE.Euler(0, 90 * THREE.MathUtils.DEG2RAD, 0),
            },
            right: {
                size: new THREE.Vector2(maxOffset, this.screenSize.height),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        this.screenSize.width / 2,
                        0,
                        maxOffset / 2
                    )
                ),
                rotation: new THREE.Euler(0, 90 * THREE.MathUtils.DEG2RAD, 0),
            },
            top: {
                size: new THREE.Vector2(this.screenSize.width, maxOffset),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        0,
                        this.screenSize.height / 2,
                        maxOffset / 2
                    )
                ),
                rotation: new THREE.Euler(90 * THREE.MathUtils.DEG2RAD, 0, 0),
            },
            bottom: {
                size: new THREE.Vector2(this.screenSize.width, maxOffset),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        0,
                        -this.screenSize.height / 2,
                        maxOffset / 2
                    )
                ),
                rotation: new THREE.Euler(90 * THREE.MathUtils.DEG2RAD, 0, 0),
            },
        };

        // Add each of the planes
        for (const [_, plane] of Object.entries(planes)) {
            this.createEnclosingPlane(plane);
        }
    }

    /**
     * Creates a plane for the enclosing planes
     * @param plane the plane to create
     */
    createEnclosingPlane(plane: EnclosingPlane) {
        const material = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            color: 0x48493f,
        });

        const geometry = new THREE.PlaneGeometry(plane.size.x, plane.size.y);
        const mesh = new THREE.Mesh(geometry, material);

        mesh.position.copy(plane.position);
        mesh.rotation.copy(plane.rotation);

        this.scene.add(mesh);
    }

    createPerspectiveDimmer(maxOffset: number) {
        const material = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            color: 0x000000,
            transparent: true,
            blending: THREE.AdditiveBlending,
        });

        const plane = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height
        );

        const mesh = new THREE.Mesh(plane, material);

        mesh.position.copy(
            this.offsetPosition(
                this.position,
                new THREE.Vector3(0, 0, maxOffset - 5)
            )
        );

        mesh.rotation.copy(this.rotation);

        this.dimmingPlane = mesh;

        this.scene.add(mesh);
    }

    /**
     * Offsets a position vector by another vector
     * @param position the position to offset
     * @param offset the offset to apply
     * @returns the new offset position
     */
    offsetPosition(position: THREE.Vector3, offset: THREE.Vector3) {
        const newPosition = new THREE.Vector3();
        newPosition.copy(position);
        newPosition.add(offset);
        return newPosition;
    }

    update() {
        if (this.dimmingPlane) {
            const planeNormal = new THREE.Vector3(0, 0, 1);
            const viewVector = new THREE.Vector3();
            viewVector.copy(this.camera.instance.position);
            viewVector.sub(this.position);
            viewVector.normalize();

            const dot = viewVector.dot(planeNormal);

            // calculate the distance from the camera vector to the plane vector
            const dimPos = this.dimmingPlane.position;
            const camPos = this.camera.instance.position;

            const distance = Math.sqrt(
                (camPos.x - dimPos.x) ** 2 +
                    (camPos.y - dimPos.y) ** 2 +
                    (camPos.z - dimPos.z) ** 2
            );

            const opacity = 1 / (distance / 10000);

            const DIM_FACTOR = 0.7;

            // @ts-ignore
            this.dimmingPlane.material.opacity =
                (1 - opacity) * DIM_FACTOR + (1 - dot) * DIM_FACTOR;
        }
    }
}
