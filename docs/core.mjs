const THREE = window.THREE;

export const HEIGHT_MAGNIFY = 10.0;

export class CanvasUtils {
    static createOffscreenCanvas(width, height) {
        if (typeof OffscreenCanvas !== 'undefined') {
            return new OffscreenCanvas(width, height);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
}

export class UnitsUtils {
    static EARTH_RADIUS = 2 * 63781.37;
    static EARTH_PERIMETER = 2 * Math.PI * UnitsUtils.EARTH_RADIUS;
    static EARTH_ORIGIN = UnitsUtils.EARTH_PERIMETER / 2.0;
    
    static getCurrentPosition() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                result => resolve({ coords: result.coords, timestamp: result.timestamp }),
                reject
            );
        });
    }
    
    static datumsToSpherical(latitude, longitude) {
        const x = longitude * UnitsUtils.EARTH_ORIGIN / 180.0;
        let y = Math.log(Math.tan((90 + latitude) * Math.PI / 360.0)) / (Math.PI / 180.0);
        y = y * UnitsUtils.EARTH_ORIGIN / 180.0;
        return new THREE.Vector2(x, y);
    }
    
    static sphericalToDatums(x, y) {
        const longitude = x / UnitsUtils.EARTH_ORIGIN * 180.0;
        let latitude = y / UnitsUtils.EARTH_ORIGIN * 180.0;
        latitude = 180.0 / Math.PI * (2 * Math.atan(Math.exp(latitude * Math.PI / 180.0)) - Math.PI / 2.0);
        return { latitude, longitude };
    }
    
    static quadtreeToDatums(zoom, x, y) {
        const n = Math.pow(2.0, zoom);
        const longitude = x / n * 360.0 - 180.0;
        const latitudeRad = Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * y / n)));
        const latitude = 180.0 * (latitudeRad / Math.PI);
        return { latitude, longitude };
    }
}

export class MapNodeGeometry extends THREE.BufferGeometry {
    constructor(width, height, widthSegments, heightSegments) {
        super();
        const widthHalf = width / 2;
        const heightHalf = height / 2;
        const gridX = widthSegments + 1;
        const gridZ = heightSegments + 1;
        const segmentWidth = width / widthSegments;
        const segmentHeight = height / heightSegments;
        const indices = [];
        const vertices = [];
        const normals = [];
        const uvs = [];
        
        for (let iz = 0; iz < gridZ; iz++) {
            const z = iz * segmentHeight - heightHalf;
            for (let ix = 0; ix < gridX; ix++) {
                const x = ix * segmentWidth - widthHalf;
                vertices.push(x, 0, z);
                normals.push(0, 1, 0);
                uvs.push(ix / widthSegments, 1 - iz / heightSegments);
            }
        }
        
        for (let iz = 0; iz < heightSegments; iz++) {
            for (let ix = 0; ix < widthSegments; ix++) {
                const a = ix + gridX * iz;
                const b = ix + gridX * (iz + 1);
                const c = ix + 1 + gridX * (iz + 1);
                const d = ix + 1 + gridX * iz;
                indices.push(a, b, d, b, c, d);
            }
        }
        
        this.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        this.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        this.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        this.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    }
}

export class MapNodeHeightGeometry extends THREE.BufferGeometry {
    constructor(width, height, widthSegments, heightSegments, imageData) {
        super();
        const widthHalf = width / 2;
        const heightHalf = height / 2;
        const gridX = widthSegments + 1;
        const gridZ = heightSegments + 1;
        const segmentWidth = width / widthSegments;
        const segmentHeight = height / heightSegments;
        const indices = [];
        const vertices = [];
        const normals = [];
        const uvs = [];
        
        for (let iz = 0; iz < gridZ; iz++) {
            const z = iz * segmentHeight - heightHalf;
            for (let ix = 0; ix < gridX; ix++) {
                const x = ix * segmentWidth - widthHalf;
                vertices.push(x, 0, z);
                normals.push(0, 1, 0);
                uvs.push(ix / widthSegments, 1 - iz / heightSegments);
            }
        }
        
        if (imageData) {
            const { data } = imageData;
            for (let i = 0, j = 0; i < data.length && j < vertices.length; i += 4, j += 3) {
                const height = (data[i] * 65536 + data[i + 1] * 256 + data[i + 2]) * 0.1 - 10000.0;
                vertices[j + 1] = height * HEIGHT_MAGNIFY;
            }
        }
        
        for (let iz = 0; iz < heightSegments; iz++) {
            for (let ix = 0; ix < widthSegments; ix++) {
                const a = ix + gridX * iz;
                const b = ix + gridX * (iz + 1);
                const c = ix + 1 + gridX * (iz + 1);
                const d = ix + 1 + gridX * iz;
                indices.push(a, b, d, b, c, d);
            }
        }
        
        this.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        this.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        this.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
        this.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
        this.computeVertexNormals();
    }
}

export class MapNode extends THREE.Mesh {
    static BASE_GEOMETRY = null;
    static BASE_SCALE = null;
    static CHILDRENS = 4;
    static ROOT = -1;
    static TOP_LEFT = 0;
    static TOP_RIGHT = 1;
    static BOTTOM_LEFT = 2;
    static BOTTOM_RIGHT = 3;
    
    constructor(parentNode = null, mapView = null, location = MapNode.ROOT, level = 0, x = 0, y = 0, geometry = null, material = null) {
        super(geometry, material);
        this.mapView = mapView;
        this.parentNode = parentNode;
        this.location = location;
        this.level = level;
        this.x = x;
        this.y = y;
        this.nodesLoaded = 0;
        this.subdivided = false;
        this.childrenCache = null;
        this.isMesh = true;
        this.initialize();
    }
    
    initialize() {}
    createChildNodes() {}
    
    subdivide() {
        const maxZoom = this.mapView.provider.maxZoom;
        if (this.children.length > 0 || this.level + 1 > maxZoom || (this.parentNode && this.parentNode.nodesLoaded < MapNode.CHILDRENS)) return;
        this.subdivided = true;
        if (this.childrenCache) {
            this.isMesh = false;
            this.children = this.childrenCache;
        } else {
            this.createChildNodes();
        }
    }
    
    simplify() {
        if (this.children.length > 0) this.childrenCache = this.children;
        this.subdivided = false;
        this.isMesh = true;
        this.children = [];
        if (this.material) {
            this.material.opacity = 1;
            this.material.transparent = false;
        }
        this.position.y = 0;
        this.updateMatrix();
        this.updateMatrixWorld(true);
    }
    
    async loadTexture() {
        const image = await this.mapView.provider.fetchTile(this.level, this.x, this.y);
        const texture = new THREE.Texture(image);
        texture.generateMipmaps = false;
        texture.format = THREE.RGBFormat;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        this.material.map = texture;
        this.nodeReady();
    }
    
    nodeReady() {
        if (this.parentNode) {
            this.parentNode.nodesLoaded++;
            if (this.parentNode.nodesLoaded >= MapNode.CHILDRENS) {
                if (this.parentNode.subdivided) {
                    this.parentNode.isMesh = false;
                    if (this.parentNode.material) {
                        this.parentNode.material.opacity = 0;
                        this.parentNode.material.transparent = true;
                    }
                }
                this.parentNode.children.forEach(child => child.visible = true);
            }
        } else {
            this.visible = true;
        }
    }
    
    raycast(raycaster, intersects) {
        if (this.isMesh) return super.raycast(raycaster, intersects);
        return false;
    }
}

export class MapPlaneNode extends MapNode {
    static GEOMETRY = new MapNodeGeometry(1, 1, 1, 1);
    static BASE_GEOMETRY = MapPlaneNode.GEOMETRY;
    static BASE_SCALE = new THREE.Vector3(UnitsUtils.EARTH_PERIMETER, 1, UnitsUtils.EARTH_PERIMETER);
    
    constructor(parentNode = null, mapView = null, location = MapNode.ROOT, level = 7, x = 20, y = 49) {
        super(parentNode, mapView, location, level, x, y, MapPlaneNode.GEOMETRY, 
            new THREE.MeshBasicMaterial({
                disableEnvMap: true,
                depthTest: true,
                depthWrite: false,
                side: THREE.FrontSide,
                transparent: false,
                wireframe: false
            })
        );
        this.matrixAutoUpdate = false;
        this.isMesh = true;
        this.visible = false;
    }
    
    initialize() {
        this.loadTexture();
    }
    
    createChildNodes() {
        const level = this.level + 1;
        const x = this.x * 2;
        const y = this.y * 2;
        this.position.y = -0.1;
        this.updateMatrix();
        this.updateMatrixWorld(true);
        
        [
            { loc: MapNode.TOP_LEFT, pos: [-0.25, 0, -0.25], tile: [x, y] },
            { loc: MapNode.TOP_RIGHT, pos: [0.25, 0, -0.25], tile: [x + 1, y] },
            { loc: MapNode.BOTTOM_LEFT, pos: [-0.25, 0, 0.25], tile: [x, y + 1] },
            { loc: MapNode.BOTTOM_RIGHT, pos: [0.25, 0, 0.25], tile: [x + 1, y + 1] }
        ].forEach(({ loc, pos, tile }) => {
            const node = new MapPlaneNode(this, this.mapView, loc, level, tile[0], tile[1]);
            node.scale.set(0.5, 1, 0.5);
            node.position.set(...pos);
            this.add(node);
            node.updateMatrix();
            node.updateMatrixWorld(true);
        });
    }
}

export class MapHeightNode extends MapPlaneNode {
    constructor(parentNode = null, mapView = null, location = MapNode.ROOT, level = 7, x = 20, y = 49) {
        super(parentNode, mapView, location, level, x, y);
        this.heightLoaded = false;
        this.textureLoaded = false;
        this.geometrySize = 32;
    }
    
    initialize() {
        this.loadTexture();
        if (this.mapView?.heightProvider) this.loadHeightGeometry();
    }
    
    async loadHeightGeometry() {
        if (!this.mapView.heightProvider) return;
        const image = await this.mapView.heightProvider.fetchTile(this.level, this.x, this.y);
        const canvas = CanvasUtils.createOffscreenCanvas(this.geometrySize + 1, this.geometrySize + 1);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, 0, 0, 256, 256, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        this.geometry = new MapNodeHeightGeometry(1, 1, this.geometrySize, this.geometrySize, imageData);
        this.heightLoaded = true;
        if (this.textureLoaded) this.nodeReady();
    }
    
    async loadTexture() {
        const image = await this.mapView.provider.fetchTile(this.level, this.x, this.y);
        const texture = new THREE.Texture(image);
        texture.generateMipmaps = false;
        texture.format = THREE.RGBFormat;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        this.material.map = texture;
        this.textureLoaded = true;
        if (this.heightLoaded || !this.mapView.heightProvider) this.nodeReady();
    }
    
    createChildNodes() {
        const level = this.level + 1;
        const x = this.x * 2;
        const y = this.y * 2;
        this.position.y = -0.1;
        this.updateMatrix();
        this.updateMatrixWorld(true);
        
        [
            { loc: MapNode.TOP_LEFT, pos: [-0.25, 0, -0.25], tile: [x, y] },
            { loc: MapNode.TOP_RIGHT, pos: [0.25, 0, -0.25], tile: [x + 1, y] },
            { loc: MapNode.BOTTOM_LEFT, pos: [-0.25, 0, 0.25], tile: [x, y + 1] },
            { loc: MapNode.BOTTOM_RIGHT, pos: [0.25, 0, 0.25], tile: [x + 1, y + 1] }
        ].forEach(({ loc, pos, tile }) => {
            const node = new MapHeightNode(this, this.mapView, loc, level, tile[0], tile[1]);
            node.scale.set(0.5, 1, 0.5);
            node.position.set(...pos);
            this.add(node);
            node.updateMatrix();
            node.updateMatrixWorld(true);
        });
    }
}
