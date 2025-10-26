import { PolylineStorage } from './storage-utils.mjs';

// Custom large 'X' target cursor using SVG
const POLYLINE_CURSOR = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="none" stroke="black" stroke-width="2"/><circle cx="16" cy="16" r="14" fill="none" stroke="white" stroke-width="1"/><line x1="6" y1="6" x2="26" y2="26" stroke="black" stroke-width="2.5"/><line x1="6" y1="6" x2="26" y2="26" stroke="white" stroke-width="1.5"/><line x1="26" y1="6" x2="6" y2="26" stroke="black" stroke-width="2.5"/><line x1="26" y1="6" x2="6" y2="26" stroke="white" stroke-width="1.5"/><circle cx="16" cy="16" r="2" fill="white" stroke="black" stroke-width="1"/></svg>') 16 16, crosshair`;

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
        this.polylines = []; // Array of completed polylines
        this.isDataLoaded = false; // Track if storage data has been loaded
        
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
                this.labelContainer.classList.add('property-panel'); 
                this.labelContainer.style.position = 'absolute';
                this.labelContainer.style.top = '0';
                this.labelContainer.style.left = '0';
                this.labelContainer.style.width = '100%';
                this.labelContainer.style.height = '100%';
                this.labelContainer.style.pointerEvents = 'none';
                this.labelContainer.style.zIndex = '999';
                this.viewer.container.appendChild(this.labelContainer);
            }
            
            // Show labels when tool is active
            if (this.labelContainer) {
                this.labelContainer.style.display = 'block';
            }
            
            this.active = true;
            this.viewer.canvas.style.cursor = POLYLINE_CURSOR;
            
            // Listen to camera changes to update scales and orientations
            this._onCameraChange = this._onCameraChange.bind(this);
            this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
            
            // Add keyboard event listener for Escape key to finish drawing
            this._onKeyDown = this._onKeyDown.bind(this);
            document.addEventListener('keydown', this._onKeyDown);
            
            // Load and restore saved polylines (only once)
            if (!this.isDataLoaded) {
                this._loadFromStorage();
                this.isDataLoaded = true;
            }
        }
    }
    
    deactivate(name) {
        if (this.active) {
            // Remove any preview line
            this._removePreview();
            
            // Hide labels when tool is inactive
            if (this.labelContainer) {
                this.labelContainer.style.display = 'none';
            }
            
            // Keep the overlay scene and drawings, just deactivate interaction
            this.active = false;
            this.viewer.canvas.style.cursor = 'auto';
            
            // Remove camera change listener
            if (this._onCameraChange) {
                this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
            }
            
            // Remove keyboard event listener
            if (this._onKeyDown) {
                document.removeEventListener('keydown', this._onKeyDown);
            }
        }
    }
    
    _onCameraChange() {
        this._updateLineScales();
        this._updateLabelPositions();
    }
    
    _onKeyDown(event) {
        // Finish drawing on Escape key
        if (event.key === 'Escape' && this.active && this.points.length > 1) {
            this._finish();
            event.preventDefault();
            event.stopPropagation();
        }
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
        // Double-click no longer finishes the polyline (use Escape key instead)
        // Just return false to allow the event to be handled by other tools
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
        const previewLine = this._createLine(lastPoint, point, POLYLINE_COLOR, 0.6, true);
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
        const line = this._createLine(start, end, POLYLINE_COLOR, 0.8);
        this.lines.push(line);
        this.viewer.overlays.addMesh(line, this.overlayName);
        this.viewer.impl.invalidate(true);
    }
    
    _createLabel(p1, p2, distance) {
        const label = document.createElement('div');
        label.className = 'measure-length visible'; // Add 'visible' class to show the label
        
        const text = document.createElement('div');
        text.className = 'measure-length-text';
        // Scale factor for terrain coordinate system: empirically determined as ~134.29
        // This converts from terrain units to real-world meters
        const distanceInMeters = distance * 0.13429 * 2;
        
        // Display in km if >= 1000m, otherwise in meters
        if (distanceInMeters >= 1000) {
            text.textContent = `${(distanceInMeters / 1000).toFixed(2)} km`;
        } else {
            text.textContent = `${distanceInMeters.toFixed(2)} m`;
        }
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
        // Create box geometry (rectangle shape - fewer triangles than cylinder)
        const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
        
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
        
        const mesh = new THREE.Mesh(boxGeometry, material);
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
        
        // Check for duplicate last point (zero-length segment)
        if (this.points.length > 1) {
            const lastPoint = this.points[this.points.length - 1];
            const prevPoint = this.points[this.points.length - 2];
            const distance = lastPoint.distanceTo(prevPoint);
            
            if (distance < 0.001) { // Nearly zero distance
                // Remove the duplicate point
                this.points.pop();
                
                // Remove the last line and label
                if (this.lines.length > 0) {
                    const lastLine = this.lines.pop();
                    this.viewer.overlays.removeMesh(lastLine, this.overlayName);
                }
                
                if (this.labels.length > 0) {
                    const lastLabel = this.labels.pop();
                    if (lastLabel.parentNode) {
                        lastLabel.parentNode.removeChild(lastLabel);
                    }
                }
                
                // Remove the last point markers (outer and inner circle)
                if (this.pointMarkers.length >= 2) {
                    const innerMarker = this.pointMarkers.pop();
                    const outerMarker = this.pointMarkers.pop();
                    this.viewer.overlays.removeMesh(innerMarker, this.overlayName);
                    this.viewer.overlays.removeMesh(outerMarker, this.overlayName);
                }
            }
        }
        
        // Save completed polyline with tile location for accurate coordinate export
        // Points are stored in world space for 3D rendering
        // They will be converted to lat/lng during export using the stored tile location
        if (this.points.length > 1) {
            const geoExt = this.viewer.getExtension('GeoThreeExtension');
            const tileLocation = geoExt ? geoExt.getTileLocation() : null;
            
            this.polylines.push({
                points: this.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
                totalDistance: this.totalDistance,
                tileLocation: tileLocation
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
        const currentPolyline = {
            points: this.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
            totalDistance: this.totalDistance
        };
        PolylineStorage.set(currentPolyline, this.polylines);
    }
    
    _loadFromStorage() {
        const data = PolylineStorage.get();
        if (!data) return;
        
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

