import { UnitsUtils, PolylineExporter } from './utils.mjs';
import { MapLocationStorage } from './storage-utils.mjs';

// Location Dialog Panel
class LocationPanel extends Autodesk.Viewing.UI.DockingPanel {
    constructor(viewer, id, title, onClose) {
        super(viewer.container, id, title, { addFooter: true });
        this.viewer = viewer;
        this.onCloseCallback = onClose;
        this.container.style.width = '520px'; // 25% wider than 420px
        this.container.style.height = 'auto';
        this.container.style.right = '150px';
        this.container.style.bottom = '50px';
        this.container.style.minWidth = '400px';
        this.container.style.minHeight = '200px';
    }
    
    setVisible(show) {
        super.setVisible(show);
        // Trigger callback when panel is hidden
        if (!show && this.onCloseCallback) {
            this.onCloseCallback();
        }
    }
    
    initialize() {
        this.title = this.createTitleBar(this.titleLabel || this.container.id);
        this.container.appendChild(this.title);
        this.initializeMoveHandlers(this.title);
        
        this.closer = this.createCloseButton();
        this.container.appendChild(this.closer);
        
        const geoExt = this.viewer ? this.viewer.getExtension('GeoThreeExtension') : null;
        const currentLocation = geoExt ? geoExt.getTileLocation() : null;
        
        // Load saved location or use defaults
        const defaultZoom = currentLocation ? currentLocation.level : 7;
        const saved = MapLocationStorage.getOrDefault(37.8, -122.4, defaultZoom);
        const defaultLat = saved.lat;
        const defaultLon = saved.lon;
        
        // Create content with styles
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('docking-panel-container-solid-color-a');
        contentDiv.style.padding = '20px';
        contentDiv.innerHTML = `
            <style>
                .loc-preset-btn {
                    padding: 4px 10px;
                    border: 1px solid #ddd;
                    border-radius: 3px;
                    background: #f8f8f8;
                    cursor: pointer;
                    font-size: 11px;
                    color: #555;
                }
                .loc-preset-btn:hover { background: #e8e8e8; }
                .loc-input-label {
                    display: block;
                    margin-bottom: 4px;
                    color: #666;
                    font-size: 12px;
                }
                .loc-input {
                    width: 100%;
                    padding: 6px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    box-sizing: border-box;
                    font-size: 13px;
                }
                .loc-go-btn {
                    padding: 6px 14px;
                    border: none;
                    border-radius: 4px;
                    background: #0696D7;
                    color: white;
                    cursor: pointer;
                    font-size: 13px;
                }
                .loc-go-btn:hover { background: #0580b8; }
            </style>
            <div style="display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
                <button class="loc-preset-btn" data-lat="40.7128" data-lon="-74.0060">NYC</button>
                <button class="loc-preset-btn" data-lat="50.1163" data-lon="-122.9574">Whistler</button>
                <button class="loc-preset-btn" data-lat="37.7749" data-lon="-122.4194">SF</button>
                <button class="loc-preset-btn" data-lat="35.3606" data-lon="138.7274">Mt Fuji</button>
                <button class="loc-preset-btn" data-lat="-49.3000" data-lon="-73.1000">Patagonia</button>
                <button class="loc-preset-btn" data-lat="46.4100" data-lon="11.8500">Dolomites</button>
            </div>
            <div style="display: flex; gap: 12px; align-items: flex-end;">
                <div style="flex: 1;">
                    <label class="loc-input-label">Latitude</label>
                    <input type="number" id="location-lat" class="loc-input" step="any" value="${defaultLat}">
                </div>
                <div style="flex: 1;">
                    <label class="loc-input-label">Longitude</label>
                    <input type="number" id="location-lon" class="loc-input" step="any" value="${defaultLon}">
                </div>
                <div style="flex: 0 0 80px;">
                    <label class="loc-input-label">Zoom</label>
                    <input type="number" id="location-zoom" class="loc-input" step="1" min="0" max="20" value="${defaultZoom}">
                </div>
                <div>
                    <button id="location-apply" class="loc-go-btn">Go</button>
                </div>
            </div>
        `;
        
        this.container.appendChild(contentDiv);
        
        // Handle preset buttons - apply immediately
        contentDiv.querySelectorAll('.loc-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const lat = parseFloat(e.target.dataset.lat);
                const lon = parseFloat(e.target.dataset.lon);
                const zoom = parseInt(document.getElementById('location-zoom').value);
                
                this.applyLocation(lat, lon, zoom);
                this.setVisible(false);
            });
        });
        
        // Handle apply button
        contentDiv.querySelector('#location-apply').addEventListener('click', () => {
            const lat = parseFloat(document.getElementById('location-lat').value);
            const lon = parseFloat(document.getElementById('location-lon').value);
            const zoom = parseInt(document.getElementById('location-zoom').value);
            
            if (isNaN(lat) || isNaN(lon) || isNaN(zoom)) {
                alert('Please enter valid numbers');
                return;
            }
            
            if (lat < -85 || lat > 85) {
                alert('Latitude must be between -85 and 85');
                return;
            }
            
            if (lon < -180 || lon > 180) {
                alert('Longitude must be between -180 and 180');
                return;
            }
            
            if (zoom < 0 || zoom > 20) {
                alert('Zoom level must be between 0 and 20');
                return;
            }
            
            this.applyLocation(lat, lon, zoom);
            this.setVisible(false);
        });
        
        // Handle Enter key
        const handleEnter = (e) => {
            if (e.key === 'Enter') {
                contentDiv.querySelector('#location-apply').click();
            }
        };
        contentDiv.querySelector('#location-lat').addEventListener('keypress', handleEnter);
        contentDiv.querySelector('#location-lon').addEventListener('keypress', handleEnter);
        contentDiv.querySelector('#location-zoom').addEventListener('keypress', handleEnter);
    }
    
    applyLocation(lat, lon, zoom) {
        // Save to localStorage using storage utility
        MapLocationStorage.set(lat, lon, zoom);
        
        // Convert lat/lon to tile coordinates
        const tile = UnitsUtils.pointToTile(lon, lat, zoom);
        const tileX = tile[0];
        const tileY = tile[1];
        
        // Apply the new tile location
        const geoExt = this.viewer.getExtension('GeoThreeExtension');
        if (geoExt) {
            geoExt.setTileLocation(zoom, tileX, tileY);
        }
    }
}

export class PolylineToolExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this.tool = null;
        this.snapper = null;
        this.toolbarGroup = null;
        this.raycaster = new THREE.Raycaster();
        this.locationPanel = null;
    }
    
    async load() {
            await this.viewer.loadExtension('Autodesk.Snapping');
            
            const SnapperClass = Autodesk.Viewing.Extensions.Snapping.Snapper;
            this.snapper = new SnapperClass(this.viewer, { 
                renderSnappedGeometry: true, 
                renderSnappedTopology: true
            });
            
            this.viewer.toolController.registerTool(this.snapper);
            this.viewer.toolController.activateTool(this.snapper.getName());
            
            // Import PolylineMeasureTool from polyline-tool.js
            const { PolylineMeasureTool } = await import('./polyline-tool.js');
            this.tool = new PolylineMeasureTool(this.viewer, this.snapper);
            this.viewer.toolController.registerTool(this.tool);
            
            return true;
    }
    
    onToolbarCreated() {
        // Toolbar is ready, safe to create buttons
        if (!this.subToolbar) {
            this.createToolbar();
        }
    }
    
    raycastTerrain(canvasX, canvasY) {
        const geoExt = this.viewer.getExtension('GeoThreeExtension');
        if (!geoExt || !geoExt.map) return null;
        
        const vpVec = this.viewer.impl.clientToViewport(canvasX, canvasY);
        const ray = this.viewer.impl.viewportToRay(vpVec);
        if (!ray) return null;
        
        this.raycaster.ray.origin.copy(ray.origin);
        this.raycaster.ray.direction.copy(ray.direction);
        
        const intersects = this.raycaster.intersectObject(geoExt.map, true);
        // Return world space coordinates - needed for 3D rendering
        return intersects.length > 0 ? intersects[0].point : null;
    }
    
    createToolbar() {
        if (!this.viewer.toolbar) return;
        
        const avu = Autodesk.Viewing.UI;
        
        const createButton = (id, tooltip, icon, onClick) => {
            const button = new avu.Button(id);
            button.setToolTip(tooltip);
            button.setIcon(icon);
            button.onClick = onClick;
            return button;
        };
        
        this.toggleButton = createButton(
            'polyline-toggle-button',
            'Tape Measure (ESC to finish)',
            'adsk-icon-measure-area-new',
            () => {
                const isActive = this.toggleButton.getState() === avu.Button.State.ACTIVE;
                const newState = isActive ? avu.Button.State.INACTIVE : avu.Button.State.ACTIVE;
                const toolAction = isActive ? 'deactivateTool' : 'activateTool';
                
                this.toggleButton.setState(newState);
                this.viewer.toolController[toolAction](this.tool.getName());
            }
        );
        
        this.clearButton = createButton(
            'polyline-clear-button',
            'Clear All Polylines',
            'adsk-icon-measure-trash',
            () => this.tool.clearAll()
        );
        
        this.setTileButton = createButton(
            'polyline-set-tile-button',
            'Set Map Location (Lat/Long)',
            'adsk-icon-measure-location',
            () => {
                if (!this.locationPanel) {
                    this.locationPanel = new LocationPanel(
                        this.viewer, 
                        'location-panel', 
                        'Set Map Location',
                        () => {
                            // Callback when panel closes - reset button to inactive
                            this.setTileButton.setState(avu.Button.State.INACTIVE);
                        }
                    );
                }
                
                const isVisible = this.locationPanel.isVisible();
                const newState = isVisible ? avu.Button.State.INACTIVE : avu.Button.State.ACTIVE;
                
                this.setTileButton.setState(newState);
                this.locationPanel.setVisible(!isVisible);
            }
        );
        
        this.exportButton = createButton(
            'polyline-export-button',
            'Export to GeoJSON',
            'adsk-icon-measure-calibration',
            () => {
                const exporter = new PolylineExporter(this.viewer);
                const result = exporter.export();
                
                if (result.success) {
                    console.log(`Exported ${result.featureCount} features to GeoJSON`);
                    // Could add a toast notification here in the future
                } else {
                    alert(`Export failed: ${result.error}`);
                }
            }
        );
        
        this.subToolbar = new avu.ControlGroup('PolylineToolbar');
        this.subToolbar.addControl(this.toggleButton);
        this.subToolbar.addControl(this.clearButton);
        this.subToolbar.addControl(this.setTileButton);
        this.subToolbar.addControl(this.exportButton);
        
        this.viewer.toolbar.addControl(this.subToolbar);
    }
    

}

Autodesk.Viewing.theExtensionManager.registerExtension('PolylineToolExtension', PolylineToolExtension);

