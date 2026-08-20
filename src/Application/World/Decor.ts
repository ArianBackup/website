import * as THREE from 'three';
import Application from '../Application';
import BakedModel from '../Utils/BakedModel';
import Resources from '../Utils/Resources';

export default class Decor {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;
    bakedModel: BakedModel;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;

        this.bakeModel();
        this.setModel();
    }

    bakeModel() {
        this.bakedModel = new BakedModel(
            this.resources.items.gltfModel.decorModel,
            this.resources.items.texture.decorTexture,
            900
        );
    }

    setModel() {
        const model = this.bakedModel.getModel();

        // The loose sheet on the desk is the upstream credits page, baked into
        // the decor texture. Drop the mesh rather than reprint someone else's
        // credits under a different name.
        const paper = model.getObjectByName('paper');
        if (paper) paper.parent?.remove(paper);

        this.scene.add(model);
    }
}
