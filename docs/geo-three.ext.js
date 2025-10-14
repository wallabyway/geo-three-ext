import { MapView, LODRaycast } from './render.mjs';
import { ESRIMapsProvider, MapBoxProvider } from './loader.mjs';
import { HEIGHT_MAGNIFY } from './core.mjs';

export * from './loader.mjs';
export * from './core.mjs';
export * from './render.mjs';

export class GeoThreeExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this.map = null;
        this.lodUpdateInterval = null;
        this.updateFrequency = 60; // Very fast updates for debugging
        this.raycaster = new THREE.Raycaster();
        this.onMapClick = this.onMapClick.bind(this);
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
        
        // Add click handler for terrain pivot setting
        this.viewer.canvas.addEventListener('click', this.onMapClick);
        
        return true;
    }
    
    onMapClick(event) {
        // Get canvas position accounting for navbar and other UI elements
        const rect = this.viewer.canvas.getBoundingClientRect();
        
        // Calculate click position relative to canvas (not viewport)
        const canvasX = event.clientX - rect.left;
        const canvasY = event.clientY - rect.top;
        
        // Use Forge's utilities with corrected coordinates
        const pointerVector = this.viewer.impl.clientToViewport(canvasX, canvasY);
        const ray = this.viewer.impl.viewportToRay(pointerVector);
        
        // Set raycaster ray manually
        this.raycaster.ray.origin.copy(ray.origin);
        this.raycaster.ray.direction.copy(ray.direction);
        
        // Raycast against the map
        const intersects = this.raycaster.intersectObject(this.map, true);
        
        if (intersects.length > 0) {
            const point = intersects[0].point;            
            this.viewer.navigation.setPivotPoint(point);
        }
    }
    
    unload() {
        // Remove click handler
        if (this.viewer.canvas) {
            this.viewer.canvas.removeEventListener('click', this.onMapClick);
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

