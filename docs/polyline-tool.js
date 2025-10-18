// Simple crosshair/target cursor
const POLYLINE_CURSOR = "crosshair";

const POLYLINE_COLOR = 0x125CCC; // Pre-calculated gamma corrected from 0x4499E4

export class PolylineMeasureTool extends Autodesk.Viewing.ToolInterface {
    constructor(viewer, snapper) {
        super();
        this.viewer = viewer;
        this.snapper = snapper;
        this.names = ['polyline-measure-tool'];
        this.active = false;
        this.points = [];
        this.pointMarkers = [];
        this.lines = [];
        this.labels = [];
        this.totalDistance = 0;
        this.overlayName = 'polyline-measure-overlay';
        this.storageKey = 'polyline-tool-data';
        this.polylines = []; // Array of completed polylines
        
        delete this.register;
        delete this.deregister;
        delete this.activate;
        delete this.deactivate;
        delete this.getPriority;
        delete this.handleSingleClick;
        delete this.handleDoubleClick;
        delete this.handleMouseMove;
    }
    
    getName() {
        return this.names[0];
    }
    
    getCursor() {
        return POLYLINE_CURSOR;
    }
    
    activate(name, viewer) {
        if (!this.active) {
            // Add overlay scene if it doesn't exist
            if (!this.viewer.overlays.hasScene(this.overlayName)) {
                this.viewer.overlays.addScene(this.overlayName);
            }
            
            // Create label container if it doesn't exist
            if (!this.labelContainer) {
                this.labelContainer = document.createElement('div');
                this.labelContainer.id = 'polyline-label-container';
                this.labelContainer.style.position = 'absolute';
                this.labelContainer.style.top = '0';
                this.labelContainer.style.left = '0';
                this.labelContainer.style.width = '100%';
                this.labelContainer.style.height = '100%';
                this.labelContainer.style.pointerEvents = 'none';
                this.labelContainer.style.zIndex = '999';
                this.viewer.container.appendChild(this.labelContainer);
            }
            
            this.active = true;
            this.viewer.canvas.style.cursor = POLYLINE_CURSOR;
            
            // Listen to camera changes to update scales and orientations
            this._onCameraChange = this._onCameraChange.bind(this);
            this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
            
            // Load and restore saved polylines
            this._loadFromStorage();
        }
    }
    
    deactivate(name) {
        if (this.active) {
            // Remove any preview line
            this._removePreview();
            
            // Keep the overlay scene and drawings, just deactivate interaction
            this.active = false;
            this.viewer.canvas.style.cursor = 'auto';
            
            // Remove camera change listener
            if (this._onCameraChange) {
                this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
            }
        }
    }
    
    _onCameraChange() {
        this._updateLineScales();
        this._updateLabelPositions();
    }
    
    getPriority() {
        return 50;
    }
    
    handleMouseMove(event) {
        if (!this.active || this.points.length === 0) return false;
        
        this.snapper.indicator.clearOverlays();
        if (this.snapper.isSnapped()) {
            const result = this.snapper.getSnapResult();
            if (result.geomVertex) {
                this.snapper.indicator.render();
                this._updatePreview(result.geomVertex);
            }
        } else {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this._updatePreview(terrainHit);
            }
        }
        
        // Update line scales for constant screen-space thickness
        this._updateLineScales();
        
        return false;
    }
    
    handleSingleClick(event, button) {
        if (!this.active || button !== 0) return false;
        
        if (this.snapper.isSnapped()) {
            const result = this.snapper.getSnapResult();
            if (result.geomVertex) {
                this._addPoint(result.geomVertex.clone());
                return true;
            }
        } else {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this._addPoint(terrainHit);
                return true;
            }
        }
        return false;
    }
    
    handleDoubleClick(event, button) {
        if (!this.active || button !== 0) return false;
        
        if (this.points.length > 1) {
            this._finish();
            return true;
        }
        return false;
    }
    
    _addPoint(point) {
        this.points.push(point);
        
        if (this.points.length > 1) {
            const prevPoint = this.points[this.points.length - 2];
            const segmentDistance = prevPoint.distanceTo(point);
            this.totalDistance += segmentDistance;
            this._drawLine(prevPoint, point);
            this._createLabel(prevPoint, point, segmentDistance);
        }
        
        this._drawPoint(point);
        this._saveToStorage();
    }
    
    _updatePreview(point) {
        if (this.points.length === 0) return;
        
        this._removePreview();
        
        const lastPoint = this.points[this.points.length - 1];
        const previewLine = this._createLine(lastPoint, point, POLYLINE_COLOR, 3, true);
        this.viewer.overlays.addMesh(previewLine, this.overlayName);
        this.previewLine = previewLine;
        
        this.viewer.impl.invalidate(true);
    }
    
    _removePreview() {
        if (this.previewLine) {
            this.viewer.overlays.removeMesh(this.previewLine, this.overlayName);
            this.previewLine = null;
        }
    }
    
    _drawPoint(point) {
        // Create outer circle (white ring) with screen-space sizing
        const outerGeometry = new THREE.CircleGeometry(1, 32);
        const outerMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            depthTest: false,
            depthWrite: false,
            side: THREE.FrontSide
        });
        const outerCircle = new THREE.Mesh(outerGeometry, outerMaterial);
        outerCircle.position.copy(point);
        outerCircle.userData.point = point.clone();
        outerCircle.userData.isOuterCircle = true;
        
        // Orient circle to face camera
        const camera = this.viewer.navigation.getCamera();
        outerCircle.lookAt(camera.position);
        
        // Create inner circle (blue fill)
        const innerGeometry = new THREE.CircleGeometry(0.7, 32);
        const innerMaterial = new THREE.MeshBasicMaterial({ 
            color: POLYLINE_COLOR,
            depthTest: false,
            depthWrite: false,
            side: THREE.FrontSide
        });
        const innerCircle = new THREE.Mesh(innerGeometry, innerMaterial);
        innerCircle.position.copy(point);
        innerCircle.position.z += 0.01;
        innerCircle.userData.point = point.clone();
        innerCircle.userData.isInnerCircle = true;
        innerCircle.lookAt(camera.position);
        
        // Set initial scale
        const scale = this._setScale(point) * 1.1; // 1 pixel radius
        outerCircle.scale.set(scale, scale, 1);
        innerCircle.scale.set(scale, scale, 1);
        
        this.viewer.overlays.addMesh(outerCircle, this.overlayName);
        this.viewer.overlays.addMesh(innerCircle, this.overlayName);
        
        this.pointMarkers.push(outerCircle, innerCircle);
        
        this.viewer.impl.invalidate(true);
    }
    
    _drawLine(start, end) {
        const line = this._createLine(start, end, POLYLINE_COLOR, 4);
        this.lines.push(line);
        this.viewer.overlays.addMesh(line, this.overlayName);
        this.viewer.impl.invalidate(true);
    }
    
    _createLabel(p1, p2, distance) {
        const label = document.createElement('div');
        label.className = 'measure-length visible'; // Add 'visible' class to show the label
        
        const text = document.createElement('div');
        text.className = 'measure-length-text';
        text.textContent = `${(distance / 1000).toFixed(2)} m`; // Convert mm to m
        label.appendChild(text);
        
        // Store the midpoint for positioning
        label.userData = {
            p1: p1.clone(),
            p2: p2.clone(),
            midpoint: new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5)
        };
        
        // Append to label container instead of viewer container
        if (this.labelContainer) {
            this.labelContainer.appendChild(label);
        } else {
            this.viewer.container.appendChild(label);
        }
        this.labels.push(label);
        
        // Update position after DOM has calculated dimensions
        setTimeout(() => {
            this._positionLabel(label);
        }, 0);
    }
    
    _positionLabel(label) {
        if (!label.userData || !label.userData.midpoint) return;
        
        const midpoint = label.userData.midpoint;
        const camera = this.viewer.navigation.getCamera();
        const containerBounds = this.viewer.navigation.getScreenViewport();
        
        // Project 3D point to 2D screen coordinates
        const p = midpoint.clone().project(camera);
        const x = Math.round((p.x + 1) / 2 * containerBounds.width);
        const y = Math.round((-p.y + 1) / 2 * containerBounds.height);
        
        // Center the label on the midpoint
        label.style.left = (x - label.clientWidth / 2) + 'px';
        label.style.top = (y - label.clientHeight / 2) + 'px';
    }
    
    _updateLabelPositions() {
        this.labels.forEach(label => {
            this._positionLabel(label);
        });
    }
    
    _createLine(start, end, color, linewidth, dashed = false) {
        // Create cylinder mesh following measure tool pattern
        const cylinderGeometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 8, 1, true);
        
        const direction = new THREE.Vector3().subVectors(end, start);
        const orientation = new THREE.Matrix4();
        orientation.lookAt(start, end, new THREE.Object3D().up);
        orientation.multiply(new THREE.Matrix4().set(
            linewidth, 0, 0, 0,
            0, 0, linewidth, 0,
            0, -direction.length(), 0, 0,
            0, 0, 0, 1
        ));
        
        const material = new THREE.MeshBasicMaterial({
            color: color,
            depthTest: false,
            depthWrite: false
        });
        
        const mesh = new THREE.Mesh(cylinderGeometry, material);
        mesh.applyMatrix4(orientation);
        mesh.lmv_line_width = linewidth;
        mesh.position.x = (end.x + start.x) / 2;
        mesh.position.y = (end.y + start.y) / 2;
        mesh.position.z = (end.z + start.z) / 2;
        
        // Store endpoints for scale calculation
        mesh.userData.p1 = start.clone();
        mesh.userData.p2 = end.clone();
        
        // Set initial scale
        this._setCylinderScale(mesh, start, end);
        
        return mesh;
    }
    
    _setScale(point) {
        const pixelSize = 5;
        const navapi = this.viewer.navigation;
        const camera = navapi.getCamera();
        const position = navapi.getPosition();
        
        const p = point.clone();
        const distance = camera.isPerspective ? p.sub(position).length() : navapi.getEyeVector().length();
        const fov = navapi.getVerticalFov();
        const worldHeight = 2.0 * distance * Math.tan(THREE.Math.degToRad(fov * 0.5));
        const viewport = navapi.getScreenViewport();
        const scale = pixelSize * worldHeight / viewport.height;
        
        return scale;
    }
    
    _setCylinderScale(cylinderMesh, p1, p2) {
        let scale;
        
        if (p1 && p2) {
            const point = this._nearestPointInSegment(this.viewer.navigation.getPosition(), p1, p2);
            scale = this._setScale(point);
        } else {
            scale = this._setScale(cylinderMesh.position);
        }
        
        if (cylinderMesh.lmv_line_width) {
            scale *= cylinderMesh.lmv_line_width;
        }
        
        cylinderMesh.scale.x = scale;
        cylinderMesh.scale.z = scale;
    }
    
    _nearestPointInSegment(viewerPos, p1, p2) {
        const line = new THREE.Vector3().subVectors(p2, p1);
        const lineLength = line.length();
        line.normalize();
        
        const viewerToP1 = new THREE.Vector3().subVectors(viewerPos, p1);
        const projection = viewerToP1.dot(line);
        const t = Math.max(0, Math.min(lineLength, projection));
        
        return new THREE.Vector3().addVectors(p1, line.multiplyScalar(t));
    }
    
    _updateLineScales() {
        // Update all line scales
        this.lines.forEach(line => {
            if (line.userData.p1 && line.userData.p2) {
                this._setCylinderScale(line, line.userData.p1, line.userData.p2);
            }
        });
        
        // Update preview line scale
        if (this.previewLine && this.previewLine.userData.p1 && this.previewLine.userData.p2) {
            this._setCylinderScale(this.previewLine, this.previewLine.userData.p1, this.previewLine.userData.p2);
        }
        
        // Update point marker scales
        this.pointMarkers.forEach(marker => {
            if (marker.userData.point) {
                const scale = this._setScale(marker.userData.point) * 1.1; // 1 pixel radius
                marker.scale.set(scale, scale, 1);
                
                // Re-orient to face camera
                const camera = this.viewer.navigation.getCamera();
                marker.lookAt(camera.position);
            }
        });
    }
    
    getTerrainHitAtMouse(event) {
        const polylineExt = this.viewer.getExtension('PolylineToolExtension');
        if (!polylineExt) return null;
        return polylineExt.raycastTerrain(event.canvasX, event.canvasY);
    }
    
    _finish() {
        this._removePreview();
        
        // Save completed polyline
        if (this.points.length > 1) {
            this.polylines.push({
                points: this.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
                totalDistance: this.totalDistance
            });
            this._saveToStorage();
        }
        
        this.viewer.dispatchEvent({
            type: 'polyline-completed',
            data: {
                points: this.points,
                totalDistance: this.totalDistance
            }
        });
        
        this.points = [];
        this.totalDistance = 0;
    }
    
    clearAll() {
        this._removePreview();
        
        this.lines.forEach(line => {
            this.viewer.overlays.removeMesh(line, this.overlayName);
        });
        
        this.pointMarkers.forEach(marker => {
            this.viewer.overlays.removeMesh(marker, this.overlayName);
        });
        
        this.labels.forEach(label => {
            if (label.parentNode) {
                label.parentNode.removeChild(label);
            }
        });
        
        this.points = [];
        this.pointMarkers = [];
        this.lines = [];
        this.labels = [];
        this.totalDistance = 0;
        this.polylines = [];
        
        this._saveToStorage();
        this.viewer.impl.invalidate(true);
    }
    
    _saveToStorage() {
        try {
            const data = {
                currentPolyline: {
                    points: this.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
                    totalDistance: this.totalDistance
                },
                completedPolylines: this.polylines
            };
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (error) {
            console.error('Failed to save polyline data to localStorage:', error);
        }
    }
    
    _loadFromStorage() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) return;
            
            const data = JSON.parse(stored);
            
            // Restore completed polylines
            if (data.completedPolylines && Array.isArray(data.completedPolylines)) {
                this.polylines = data.completedPolylines;
                
                data.completedPolylines.forEach(polyline => {
                    if (polyline.points && polyline.points.length > 1) {
                        this._restorePolyline(polyline.points);
                    }
                });
            }
            
            // Restore current polyline in progress
            if (data.currentPolyline && data.currentPolyline.points && data.currentPolyline.points.length > 0) {
                this.totalDistance = data.currentPolyline.totalDistance || 0;
                
                data.currentPolyline.points.forEach(p => {
                    const point = new THREE.Vector3(p.x, p.y, p.z);
                    this.points.push(point);
                    
                    if (this.points.length > 1) {
                        const prevPoint = this.points[this.points.length - 2];
                        const segmentDistance = prevPoint.distanceTo(point);
                        this._drawLine(prevPoint, point);
                        this._createLabel(prevPoint, point, segmentDistance);
                    }
                    
                    this._drawPoint(point);
                });
            }
            
            this.viewer.impl.invalidate(true);
        } catch (error) {
            console.error('Failed to load polyline data from localStorage:', error);
        }
    }
    
    _restorePolyline(pointsData) {
        const restoredPoints = pointsData.map(p => new THREE.Vector3(p.x, p.y, p.z));
        
        for (let i = 0; i < restoredPoints.length; i++) {
            const point = restoredPoints[i];
            
            if (i > 0) {
                const prevPoint = restoredPoints[i - 1];
                const segmentDistance = prevPoint.distanceTo(point);
                this._drawLine(prevPoint, point);
                this._createLabel(prevPoint, point, segmentDistance);
            }
            
            this._drawPoint(point);
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
    }
    
    async load() {
        try {
            await this.viewer.loadExtension('Autodesk.Snapping');
            
            const SnapperClass = Autodesk.Viewing.Extensions.Snapping.Snapper;
            this.snapper = new SnapperClass(this.viewer, { 
                renderSnappedGeometry: true, 
                renderSnappedTopology: true
            });
            
            this.viewer.toolController.registerTool(this.snapper);
            this.viewer.toolController.activateTool(this.snapper.getName());
            
            this.tool = new PolylineMeasureTool(this.viewer, this.snapper);
            this.viewer.toolController.registerTool(this.tool);
            
            if (this.viewer.toolbar) {
                this.createToolbar();
            } else {
                this.onToolbarCreated = this.onToolbarCreated.bind(this);
                this.viewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, this.onToolbarCreated);
            }
            
            return true;
        } catch (error) {
            console.error('PolylineToolExtension: Load failed', error);
            return false;
        }
    }
    
    onToolbarCreated() {
        this.createToolbar();
        this.viewer.removeEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, this.onToolbarCreated);
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
        return intersects.length > 0 ? intersects[0].point : null;
    }
    
    createToolbar() {
        if (!this.viewer.toolbar) return;
        
        const avu = Autodesk.Viewing.UI;
        const self = this;
        
        // Create toggle button
        this.toggleButton = new avu.Button('polyline-toggle-button');
        this.toggleButton.setToolTip('Polyline Tool');
        this.toggleButton.setIcon("adsk-icon-measure-area-new");
        this.toggleButton.setState(avu.Button.State.INACTIVE);
        
        this.toggleButton.onClick = (e) => {
            const state = this.toggleButton.getState();
            if (state === avu.Button.State.INACTIVE) {
                this.activatePolylineTool();
            } else {
                this.deactivatePolylineTool();
            }
        };
        
        // Create clear/trash button
        this.clearButton = new avu.Button('polyline-clear-button');
        this.clearButton.setToolTip('Clear All Polylines');
        this.clearButton.setIcon("adsk-icon-measure-trash");
        
        this.clearButton.onClick = (e) => {
            if (this.tool) {
                this.tool.clearAll();
            }
        };
        
        // Create control group
        this.subToolbar = new avu.ControlGroup('PolylineToolbar');
        this.subToolbar.addControl(this.toggleButton);
        this.subToolbar.addControl(this.clearButton);
        
        // Add to main toolbar
        this.viewer.toolbar.addControl(this.subToolbar);
    }
    
    unload() {
        if (this.onToolbarCreated) {
            this.viewer.removeEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, this.onToolbarCreated);
        }
        
        if (this.subToolbar && this.viewer.toolbar) {
            this.viewer.toolbar.removeControl(this.subToolbar);
            this.subToolbar = null;
        }
        
        if (this.tool) {
            this.deactivatePolylineTool();
            this.viewer.toolController.deregisterTool(this.tool);
            this.tool = null;
        }
        
        if (this.snapper) {
            this.viewer.toolController.deactivateTool(this.snapper.getName());
            this.viewer.toolController.deregisterTool(this.snapper);
            this.snapper = null;
        }
        
        return true;
    }
    
    activatePolylineTool() {
        if (this.tool) {
            this.viewer.toolController.activateTool(this.tool.getName());
            if (this.toggleButton) {
                const avu = Autodesk.Viewing.UI;
                this.toggleButton.setState(avu.Button.State.ACTIVE);
            }
        }
    }
    
    deactivatePolylineTool() {
        if (this.tool) {
            this.viewer.toolController.deactivateTool(this.tool.getName());
            if (this.toggleButton) {
                const avu = Autodesk.Viewing.UI;
                this.toggleButton.setState(avu.Button.State.INACTIVE);
            }
        }
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension('PolylineToolExtension', PolylineToolExtension);

