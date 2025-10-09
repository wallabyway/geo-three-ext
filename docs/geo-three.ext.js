import { MapView, LODRaycast } from './render.mjs';
import { MapBoxProvider } from './loader.mjs';
import { HEIGHT_MAGNIFY } from './core.mjs';

export * from './loader.mjs';
export * from './core.mjs';
export * from './render.mjs';

export class GeoThreeExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this.map = null;
        this.lodUpdateInterval = null;
        this.updateFrequency = 100;
    }
    
    load() {
        const token = "pk.eyJ1Ijoid2FsbGFieXdheSIsImEiOiJjbDV1MHF1MzkwZXAyM2tveXZjaDVlaXJpIn0.wyOgHkuGJ37Xrx1x_49gIw";
        const provider = new MapBoxProvider(token, 'mapbox/satellite-v9', MapBoxProvider.STYLE);
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
            this.viewer.autocam.toPerspective();
            this.map.lod.updateLOD(this.map, camera, this.viewer.impl.glrenderer(), 
                this.viewer.overlays.impl.overlayScenes.map.scene, this.viewer.impl);
        };
        
        this.lodUpdateInterval = setInterval(updateLOD, this.updateFrequency);
        this.cameraChangeHandler = updateLOD;
        this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.cameraChangeHandler);
        
        return true;
    }
    
    unload() {
        if (this.lodUpdateInterval) {
            clearInterval(this.lodUpdateInterval);
            this.lodUpdateInterval = null;
        }
        if (this.cameraChangeHandler) {
            this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.cameraChangeHandler);
            this.cameraChangeHandler = null;
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

