const THREE = window.THREE;

import { MapPlaneNode, MapHeightNode } from './core.mjs';
import { OpenStreetMapsProvider } from './loader.mjs';

export class LODRaycast {
    constructor({
        subdivisionRays = 2,
        thresholdUp = 0.6,
        thresholdDown = 0.15,
        powerDistance = false,
        scaleDistance = true
    } = {}) {
        this.subdivisionRays = subdivisionRays;
        this.thresholdUp = thresholdUp;
        this.thresholdDown = thresholdDown;
        this.powerDistance = powerDistance;
        this.scaleDistance = scaleDistance;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
    }
    
    updateLOD(view, camera, renderer, scene, viewerImpl) {
        const intersects = this.gatherIntersections(view, camera, viewerImpl);
        if (intersects.length === 0) return;
        
        for (const intersect of intersects) {
            const node = intersect.object;
            const distance = this.calculateDistance(node, intersect.distance);
            
            if (distance > this.thresholdUp) {
                node.subdivide();
                return;
            } else if (distance < this.thresholdDown && node.parentNode) {
                node.parentNode.simplify();
                return;
            }
        }
    }
    
    gatherIntersections(view, camera, viewerImpl) {
        const intersects = [];
        for (let t = 0; t < this.subdivisionRays; t++) {
            const vpVec = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, 1);
            const ray = new THREE.Ray();
            viewerImpl.viewportToRay(vpVec, ray);
            this.raycaster.set(ray.origin, ray.direction);
            const hits = this.raycaster.intersectObjects(view.children, true);
            intersects.push(...hits);
        }
        return intersects;
    }
    
    calculateDistance(node, distance) {
        if (this.powerDistance) distance = Math.pow(distance * 2, node.level);
        if (this.scaleDistance) {
            const matrix = node.matrixWorld.elements;
            const scale = new THREE.Vector3(matrix[0], matrix[1], matrix[2]);
            distance = 1.3 * scale.length() / distance;
        }
        return distance;
    }
}

export class MapView extends THREE.Mesh {
    static PLANAR = 200;
    static SPHERICAL = 201;
    static HEIGHT = 202;
    static HEIGHT_SHADER = 203;
    
    constructor(rootMode = MapView.PLANAR, provider = new OpenStreetMapsProvider(), heightProvider = null) {
        super(undefined, undefined);
        this.lod = new LODRaycast();
        this.provider = provider;
        this.heightProvider = heightProvider;
        this.root = null;
        this.rootMode = rootMode;
        this.setRoot(rootMode);
    }
    
    setRoot(rootMode) {
        let root = rootMode === MapView.HEIGHT ? new MapHeightNode(null, this) : new MapPlaneNode(null, this);
        if (this.root) {
            this.remove(this.root);
            this.root = null;
        }
        this.root = root;
        if (this.root) {
            this.rotateX(Math.PI / 2);
            this.geometry = this.root.constructor.BASE_GEOMETRY;
            this.scale.copy(this.root.constructor.BASE_SCALE);
            this.root.mapView = this;
            this.add(this.root);
        }
    }
    
    setProvider(provider) {
        if (provider !== this.provider) {
            this.provider = provider;
            this.clear();
        }
    }
    
    setHeightProvider(heightProvider) {
        if (heightProvider !== this.heightProvider) {
            this.heightProvider = heightProvider;
            this.clear();
        }
    }
    
    clear() {
        this.traverse(node => {
            if (node.childrenCache) node.childrenCache = null;
            if (node.loadTexture) node.loadTexture();
        });
        return this;
    }
    
    async getMetaData() {
        return await this.provider.getMetaData();
    }
    
    raycast(raycaster, intersects) {
        return false;
    }
}
