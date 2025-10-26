import { MapView, LODRaycast } from './render.mjs';
import { ESRIMapsProvider, MapBoxProvider } from './providers.mjs';
import { UnitsUtils } from './utils.mjs';
import { MapLocationStorage } from './storage-utils.mjs';

export * from './utils.mjs';
export * from './providers.mjs';
export * from './render.mjs';
export * from './storage-utils.mjs';

export class GeoThreeExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this.map = null;
        this.provider = null;
        this.raycaster = new THREE.Raycaster();
        this.mousePosition = { x: 0, y: 0 };
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseWheel = this.onMouseWheel.bind(this);
        this.onCameraChange = this.onCameraChange.bind(this);
        this.onDoubleClick = this.onDoubleClick.bind(this);
        this.creditOverlay = null;
        
        // LOD update management
        this.lodUpdateInterval = null;
        this.lodStopTimeout = null;
        this.updateFrequency = 120; // Update frequency in ms
        this.lodContinueDuration = 3000; // Continue LOD updates for 3 seconds after camera stops
        
        // Initialize default tile location (will be loaded from localStorage in load())
        this.defaultTileLocation = {
            level: options?.tileLevel ?? 7,
            x: options?.tileX ?? 20,
            y: options?.tileY ?? 49
        };
    }
    
    load() {
        // Load tile location from localStorage if available
        const saved = MapLocationStorage.get();
        if (saved && saved.lat !== undefined && saved.lon !== undefined && saved.zoom !== undefined) {
            // Convert lat/lon to tile coordinates
            const tile = UnitsUtils.pointToTile(saved.lon, saved.lat, saved.zoom);
            this.defaultTileLocation = {
                level: saved.zoom,
                x: tile[0],
                y: tile[1]
            };
        }
        
        // Use ESRI as default provider (no API key required)
        this.provider = new ESRIMapsProvider(ESRIMapsProvider.IMAGERY);
        
        // Optional: Keep MapBox for terrain height data
        const token = "pk.eyJ1Ijoid2FsbGFieXdheSIsImEiOiJjbDV1MHF1MzkwZXAyM2tveXZjaDVlaXJpIn0.wyOgHkuGJ37Xrx1x_49gIw";
        const heightProvider = new MapBoxProvider(token, 'mapbox.terrain-rgb', MapBoxProvider.STYLE);
        
        this.map = new MapView(MapView.HEIGHT, this.provider, heightProvider, this.defaultTileLocation);
        this.map.position.set(14900, -27300, -85);
        
        this.viewer.overlays.addScene('map');
        this.viewer.overlays.addMesh(this.map, 'map');
        this.map.updateMatrixWorld(false);
        
        this.viewer.autocam.shotParams.destinationPercent = 3;
        this.viewer.autocam.shotParams.duration = 3;
        
        // Add camera change event listener
        this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChange);
        
        // Add mouse move handler to track mouse position
        this.viewer.canvas.addEventListener('mousemove', this.onMouseMove);
        
        // Add wheel handler for automatic pivot setting on zoom
        this.viewer.canvas.addEventListener('wheel', this.onMouseWheel, { passive: true });
        
        // Add double-click handler for flying to terrain point (capture phase to override other tools)
        this.viewer.canvas.addEventListener('dblclick', this.onDoubleClick, { capture: true });
        
        // Create Esri basemap credit overlay
        this.createCreditOverlay();
        
        return true;
    }
    
    async createCreditOverlay() {
        // Create the credit overlay element
        this.creditOverlay = document.createElement('div');
        this.creditOverlay.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            font-size: 7.5pt;
            color: rgba(0, 0, 0, 0.7);
            background-color: rgba(255, 255, 255, 0.8);
            padding: 4px 8px;
            border-radius: 3px;
            font-family: Arial, sans-serif;
            pointer-events: none;
            z-index: 1000;
        `;
        
        // Fetch copyright text from provider
        const copyrightText = await this.provider.getAttributionText();
        this.creditOverlay.innerHTML = copyrightText;
        
        // Append to viewer container
        this.viewer.container.appendChild(this.creditOverlay);
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
    
    onDoubleClick(event) {
        // Don't process if tools are active
        const activeTool = this.viewer.toolController.getActiveTool();
        if (activeTool && activeTool.getName && activeTool.getName().startsWith('Edit2D')) {
            return;
        }
        
        // Stop event propagation to prevent other tools from handling it
        event.stopPropagation();
        event.preventDefault();
        
        // Get the terrain point at mouse position
        const rect = this.viewer.canvas.getBoundingClientRect();
        const canvasX = event.clientX - rect.left;
        const canvasY = event.clientY - rect.top;
        
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
            
            // Set the pivot point
            this.viewer.navigation.setPivotPoint(point);
            this.viewer.navigation.setPivotSetFlag(true);
            
            // Calculate camera destination (90% of the way to the clicked point)
            const camera = this.viewer.getCamera();
            const currentPosition = camera.position.clone();
            
            // Move 90% of the way from current position to the clicked point
            const newPosition = currentPosition.clone().lerp(point, 0.9);
            
            // Create destination view with forced world up vector
            const destView = {
                position: newPosition,
                target: point,
                up: new THREE.Vector3(0, 1, 0)
            };
            
            // Fly to the view with smooth animation (world up aligned to prevent tilting)
            const worldUpAligned = true;
            if (Autodesk.Viewing.Private.flyToView) {
                Autodesk.Viewing.Private.flyToView(this.viewer, destView, 0.8, null, worldUpAligned);
            }
        }
    }
    
    onCameraChange() {
        // Start LOD updates if not already running
        if (!this.lodUpdateInterval) {
            this.startLODUpdates();
        }
        
        // Clear any existing stop timeout
        if (this.lodStopTimeout) {
            clearTimeout(this.lodStopTimeout);
        }
        
        // Schedule LOD updates to stop after 3 seconds of no camera changes
        this.lodStopTimeout = setTimeout(() => {
            this.stopLODUpdates();
        }, this.lodContinueDuration);
    }
    
    startLODUpdates() {
        if (this.lodUpdateInterval) return; // Already running
        
        const camera = this.viewer.getCamera();
        const updateLOD = () => {
            try {
                if (!this.map || !this.map.lod) return;
                
                this.viewer.autocam.toPerspective();
                this.map.lod.updateLOD(
                    this.map, 
                    camera, 
                    this.viewer.impl.glrenderer(), 
                    this.viewer.overlays.impl.overlayScenes.map.scene, 
                    this.viewer.impl
                );
                // Trigger viewer re-render
                this.viewer.impl.invalidate(false, false, true);
            } catch (error) {
                console.error('LOD update error:', error);
            }
        };
        
        // Start interval-based updates
        this.lodUpdateInterval = setInterval(updateLOD, this.updateFrequency);
    }
    
    stopLODUpdates() {
        if (this.lodUpdateInterval) {
            clearInterval(this.lodUpdateInterval);
            this.lodUpdateInterval = null;
        }
        if (this.lodStopTimeout) {
            clearTimeout(this.lodStopTimeout);
            this.lodStopTimeout = null;
        }
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
    
    /**
     * Set a new tile location and recreate the map
     * @param {number} level - Zoom level (0-20)
     * @param {number} x - Tile X coordinate
     * @param {number} y - Tile Y coordinate
     */
    setTileLocation(level, x, y) {
        this.defaultTileLocation = { level, x, y };
        
        if (this.map) {
            // Store the current position
            const position = this.map.position.clone();
            
            // Remove the old map
            this.viewer.overlays.removeMesh(this.map, 'map');
            
            // Create a new map with the new tile location
            this.map = new MapView(
                this.map.rootMode, 
                this.map.provider, 
                this.map.heightProvider, 
                this.defaultTileLocation
            );
            this.map.position.copy(position);
            
            // Re-add to the scene
            this.viewer.overlays.addMesh(this.map, 'map');
            this.map.updateMatrixWorld(false);
            
            // Trigger a re-render
            this.viewer.impl.invalidate(true);
        }
    }
    
    /**
     * Get the current tile location
     * @returns {{level: number, x: number, y: number}}
     */
    getTileLocation() {
        return { ...this.defaultTileLocation };
    }
    
    unload() {
        // Remove event handlers
        this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this.onCameraChange);
        
        if (this.viewer.canvas) {
            this.viewer.canvas.removeEventListener('mousemove', this.onMouseMove);
            this.viewer.canvas.removeEventListener('wheel', this.onMouseWheel);
            this.viewer.canvas.removeEventListener('dblclick', this.onDoubleClick, { capture: true });
        }
        
        // Stop LOD updates
        this.stopLODUpdates();
        
        // Remove credit overlay
        if (this.creditOverlay && this.creditOverlay.parentNode) {
            this.creditOverlay.parentNode.removeChild(this.creditOverlay);
            this.creditOverlay = null;
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

