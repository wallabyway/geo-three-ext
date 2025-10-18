import { MapView, LODRaycast } from './render.mjs';
import { ESRIMapsProvider, MapBoxProvider } from './providers.mjs';

export * from './utils.mjs';
export * from './providers.mjs';
export * from './render.mjs';

export class GeoThreeExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this.map = null;
        this.lodUpdateInterval = null;
        this.updateFrequency = 120; // Very fast updates for debugging
        this.raycaster = new THREE.Raycaster();
        this.mousePosition = { x: 0, y: 0 };
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseWheel = this.onMouseWheel.bind(this);
    }
    
    load() {
        // Use ESRI as default provider (no API key required)
        const provider = new ESRIMapsProvider(ESRIMapsProvider.IMAGERY);
        
        // Optional: Keep MapBox for terrain height data
        const token = "pk.eyJ1Ijoid2FsbGFieXdheSIsImEiOiJjbDV1MHF1MzkwZXAyM2tveXZjaDVlaXJpIn0.wyOgHkuGJ37Xrx1x_49gIw";
        const heightProvider = new MapBoxProvider(token, 'mapbox.terrain-rgb', MapBoxProvider.STYLE);
        
        this.map = new MapView(MapView.HEIGHT, provider, heightProvider);
        this.map.position.set(14900, -27300, -85);
        
        this.viewer.overlays.addScene('map');
        this.viewer.overlays.addMesh(this.map, 'map');
        this.map.updateMatrixWorld(false);
        
        this.viewer.autocam.shotParams.destinationPercent = 3;
        this.viewer.autocam.shotParams.duration = 3;
        
        const camera = this.viewer.getCamera();
        const updateLOD = () => {
            try {
                if (!this.map || !this.map.lod) return;
                this.viewer.autocam.toPerspective();
                this.map.lod.updateLOD(this.map, camera, this.viewer.impl.glrenderer(), this.viewer.overlays.impl.overlayScenes.map.scene, this.viewer.impl);
                // Trigger viewer re-render
                this.viewer.impl.invalidate(false, false, true);
            } catch (error) {
                console.error('LOD update error:', error);
            }
        };
        
        // Use interval-based updates for continuous raycasting LOD
        this.lodUpdateInterval = setInterval(updateLOD, this.updateFrequency);
        
        // Add mouse move handler to track mouse position
        this.viewer.canvas.addEventListener('mousemove', this.onMouseMove);
        
        // Add wheel handler for automatic pivot setting on zoom
        this.viewer.canvas.addEventListener('wheel', this.onMouseWheel, { passive: true });
        
        return true;
    }
    
    onMouseMove(event) {
        // Track mouse position for wheel zoom pivot
        const rect = this.viewer.canvas.getBoundingClientRect();
        this.mousePosition.x = event.clientX - rect.left;
        this.mousePosition.y = event.clientY - rect.top;
    }
    
    onMouseWheel(event) {
        // Set pivot point at mouse position when zooming
        this.setPivotAtMousePosition(this.mousePosition.x, this.mousePosition.y);
    }
    
    setPivotAtMousePosition(canvasX, canvasY) {
        // Don't process if tools are active
        const activeTool = this.viewer.toolController.getActiveTool();
        if (activeTool && activeTool.getName && activeTool.getName().startsWith('Edit2D')) {
            return;
        }
        
        // Use Forge's utilities with corrected coordinates
        const pointerVector = this.viewer.impl.clientToViewport(canvasX, canvasY);
        const ray = this.viewer.impl.viewportToRay(pointerVector);
        
        if (!ray) return;
        
        // Set raycaster ray manually
        this.raycaster.ray.origin.copy(ray.origin);
        this.raycaster.ray.direction.copy(ray.direction);
        
        // Raycast against the map
        const intersects = this.raycaster.intersectObject(this.map, true);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;            
            this.viewer.navigation.setPivotPoint(point);
            this.viewer.navigation.setPivotSetFlag(true);
        }
    }
    
    unload() {
        // Remove event handlers
        if (this.viewer.canvas) {
            this.viewer.canvas.removeEventListener('mousemove', this.onMouseMove);
            this.viewer.canvas.removeEventListener('wheel', this.onMouseWheel);
        }
        
        if (this.lodUpdateInterval) {
            clearInterval(this.lodUpdateInterval);
            this.lodUpdateInterval = null;
        }
        if (this.map) {
            this.viewer.overlays.removeMesh(this.map, 'map');
            this.viewer.overlays.removeScene('map');
            this.map = null;
        }
        return true;
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension('GeoThreeExtension', GeoThreeExtension);

