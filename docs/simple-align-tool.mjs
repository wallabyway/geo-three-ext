// Custom target cursor for simple alignment tool
const SIMPLE_ALIGN_CURSOR = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="none" stroke="black" stroke-width="2"/><circle cx="16" cy="16" r="14" fill="none" stroke="white" stroke-width="1"/><path d="M 16 4 L 16 28 M 4 16 L 28 16" stroke="black" stroke-width="2.5"/><path d="M 16 4 L 16 28 M 4 16 L 28 16" stroke="white" stroke-width="1.5"/><circle cx="16" cy="16" r="3" fill="white" stroke="black" stroke-width="1.5"/></svg>') 16 16, crosshair`;

const SIMPLE_ALIGN_COLOR = 0xFF8800; // Orange color to differentiate from full alignment tool

// Animation helper functions from APS blog
function makeEaseOut(timing) { 
    return function(timeFraction) {
        return 1 - timing(1 - timeFraction);
    };
}

function circ(timeFraction) { 
    return 1 - Math.sin(Math.acos(timeFraction)); 
}

function animate({timing, draw, duration}) {
    let start = performance.now();
    requestAnimationFrame(function animateFrame(time) {
        let timeFraction = (time - start) / duration;
        if (timeFraction > 1) timeFraction = 1;
        let progress = timing(timeFraction);
        draw(progress);
        if (timeFraction < 1) {
            requestAnimationFrame(animateFrame);
        }
    });
}

// Tool states
const ToolState = {
    INACTIVE: 'inactive',
    PICKING_MODEL_POINT: 'picking_model_point',
    PICKING_TERRAIN_POINT: 'picking_terrain_point',
    ANIMATING: 'animating'
};

export class SimpleAlignTool extends Autodesk.Viewing.ToolInterface {
    constructor(viewer, snapper) {
        super();
        this.viewer = viewer;
        this.snapper = snapper;
        this.names = ['simple-align-tool'];
        this.active = false;
        this.state = ToolState.INACTIVE;
        this.raycaster = new THREE.Raycaster();
        
        // Current alignment data
        this.modelPoint = null;
        this.terrainPoint = null;
        
        // Visual elements
        this.pointMarkers = [];
        this.line = null;
        this.previewLine = null;
        this.overlayName = 'simple-align-tool-overlay';
        
        // Status message element
        this.statusElement = null;
        
        delete this.register;
        delete this.deregister;
        delete this.activate;
        delete this.deactivate;
        delete this.getPriority;
        delete this.handleSingleClick;
        delete this.handleMouseMove;
    }
    
    getName() {
        return this.names[0];
    }
    
    getCursor() {
        return SIMPLE_ALIGN_CURSOR;
    }
    
    activate(name, viewer) {
        if (!this.active) {
            // Add overlay scene if it doesn't exist
            if (!this.viewer.overlays.hasScene(this.overlayName)) {
                this.viewer.overlays.addScene(this.overlayName);
            }
            
            // Create status message element
            this.createStatusElement();
            
            this.active = true;
            this.state = ToolState.PICKING_MODEL_POINT;
            this.viewer.canvas.style.cursor = SIMPLE_ALIGN_CURSOR;
            
            this.updateStatusMessage();
            
            // Add keyboard event listener for Escape key
            this._onKeyDown = this._onKeyDown.bind(this);
            document.addEventListener('keydown', this._onKeyDown);
            
            // Listen to camera changes to update scales
            this._onCameraChange = this._onCameraChange.bind(this);
            this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
        }
    }
    
    deactivate(name) {
        if (this.active) {
            this.cleanup();
            this.active = false;
            this.state = ToolState.INACTIVE;
            this.viewer.canvas.style.cursor = 'auto';
            
            // Remove status element
            if (this.statusElement && this.statusElement.parentNode) {
                this.statusElement.parentNode.removeChild(this.statusElement);
                this.statusElement = null;
            }
            
            // Remove event listeners
            if (this._onKeyDown) {
                document.removeEventListener('keydown', this._onKeyDown);
            }
            if (this._onCameraChange) {
                this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
            }
        }
    }
    
    createStatusElement() {
        this.statusElement = document.createElement('div');
        this.statusElement.style.cssText = `
            position: absolute;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(255, 136, 0, 0.95);
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            font-size: 14px;
            font-family: "ArtifaktElement", sans-serif;
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        this.viewer.container.appendChild(this.statusElement);
    }
    
    updateStatusMessage() {
        if (!this.statusElement) return;
        
        switch (this.state) {
            case ToolState.PICKING_MODEL_POINT:
                this.statusElement.textContent = 'Quick Move: Click point on BIM model';
                break;
            case ToolState.PICKING_TERRAIN_POINT:
                this.statusElement.textContent = 'Quick Move: Click target point on terrain';
                break;
            case ToolState.ANIMATING:
                this.statusElement.textContent = 'Moving model...';
                break;
        }
    }
    
    _onKeyDown(event) {
        // Cancel on Escape key
        if (event.key === 'Escape' && this.active) {
            this.cancel();
            event.preventDefault();
            event.stopPropagation();
        }
    }
    
    _onCameraChange() {
        this._updateVisualScales();
    }
    
    getPriority() {
        return 50;
    }
    
    handleMouseMove(event) {
        if (!this.active || this.state === ToolState.ANIMATING) return false;
        
        // Show preview line when we have first point
        if (this.state === ToolState.PICKING_TERRAIN_POINT && this.modelPoint) {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this._updatePreview(this.modelPoint, terrainHit);
            }
        }
        
        // Update visual scales
        this._updateVisualScales();
        
        return false;
    }
    
    handleSingleClick(event, button) {
        if (!this.active || button !== 0 || this.state === ToolState.ANIMATING) return false;
        
        if (this.state === ToolState.PICKING_MODEL_POINT) {
            // Pick point on BIM model
            const modelHit = this.getModelHitAtMouse(event);
            if (modelHit) {
                this.modelPoint = modelHit;
                this._drawPoint(modelHit);
                this.state = ToolState.PICKING_TERRAIN_POINT;
                this.updateStatusMessage();
                return true;
            }
        } else if (this.state === ToolState.PICKING_TERRAIN_POINT) {
            // Pick point on terrain
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this.terrainPoint = terrainHit;
                this._removePreview();
                this._drawPoint(terrainHit);
                this._drawLine(this.modelPoint, terrainHit);
                
                // Start animation - translation only
                this.state = ToolState.ANIMATING;
                this.updateStatusMessage();
                this.performSimpleAlignment();
                return true;
            }
        }
        
        return false;
    }
    
    getModelHitAtMouse(event) {
        // Use viewer's built-in hit test to get model intersection
        const result = this.viewer.impl.hitTest(event.canvasX, event.canvasY, false);
        if (result && result.intersectPoint) {
            return result.intersectPoint.clone();
        }
        return null;
    }
    
    getTerrainHitAtMouse(event) {
        const geoExt = this.viewer.getExtension('GeoThreeExtension');
        if (!geoExt || !geoExt.map) return null;
        
        const vpVec = this.viewer.impl.clientToViewport(event.canvasX, event.canvasY);
        const ray = this.viewer.impl.viewportToRay(vpVec);
        if (!ray) return null;
        
        this.raycaster.ray.origin.copy(ray.origin);
        this.raycaster.ray.direction.copy(ray.direction);
        
        const intersects = this.raycaster.intersectObject(geoExt.map, true);
        return intersects.length > 0 ? intersects[0].point : null;
    }
    
    _drawPoint(point) {
        // Create outer circle (white ring)
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
        
        const camera = this.viewer.navigation.getCamera();
        outerCircle.lookAt(camera.position);
        
        // Create inner circle (orange fill)
        const innerGeometry = new THREE.CircleGeometry(0.7, 32);
        const innerMaterial = new THREE.MeshBasicMaterial({ 
            color: SIMPLE_ALIGN_COLOR,
            depthTest: false,
            depthWrite: false,
            side: THREE.FrontSide
        });
        const innerCircle = new THREE.Mesh(innerGeometry, innerMaterial);
        innerCircle.position.copy(point);
        innerCircle.position.z += 0.01;
        innerCircle.userData.point = point.clone();
        innerCircle.lookAt(camera.position);
        
        // Set initial scale
        const scale = this._setScale(point) * 1.5; // 1.5 pixel radius
        outerCircle.scale.set(scale, scale, 1);
        innerCircle.scale.set(scale, scale, 1);
        
        this.viewer.overlays.addMesh(outerCircle, this.overlayName);
        this.viewer.overlays.addMesh(innerCircle, this.overlayName);
        
        this.pointMarkers.push(outerCircle, innerCircle);
        
        this.viewer.impl.invalidate(true);
    }
    
    _drawLine(start, end) {
        const line = this._createLine(start, end, SIMPLE_ALIGN_COLOR, 0.8);
        this.line = line;
        this.viewer.overlays.addMesh(line, this.overlayName);
        this.viewer.impl.invalidate(true);
    }
    
    _updatePreview(start, end) {
        this._removePreview();
        
        const previewLine = this._createLine(start, end, SIMPLE_ALIGN_COLOR, 0.6, true);
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
    
    _createLine(start, end, color, linewidth, dashed = false) {
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
        
        mesh.userData.p1 = start.clone();
        mesh.userData.p2 = end.clone();
        
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
    
    _updateVisualScales() {
        // Update line scale
        if (this.line && this.line.userData.p1 && this.line.userData.p2) {
            this._setCylinderScale(this.line, this.line.userData.p1, this.line.userData.p2);
        }
        
        // Update preview line scale
        if (this.previewLine && this.previewLine.userData.p1 && this.previewLine.userData.p2) {
            this._setCylinderScale(this.previewLine, this.previewLine.userData.p1, this.previewLine.userData.p2);
        }
        
        // Update point marker scales
        this.pointMarkers.forEach(marker => {
            if (marker.userData.point) {
                const scale = this._setScale(marker.userData.point) * 1.5;
                marker.scale.set(scale, scale, 1);
                
                const camera = this.viewer.navigation.getCamera();
                marker.lookAt(camera.position);
            }
        });
    }
    
    performSimpleAlignment() {
        // Get the main model (first loaded model)
        const model = this.viewer.model;
        if (!model) {
            console.error('No model found to align');
            this.reset();
            return;
        }
        
        // Get current placement transform
        const currentTransform = model.getPlacementTransform() || new THREE.Matrix4();
        
        // Decompose current transform
        const currentPos = new THREE.Vector3();
        const currentQuat = new THREE.Quaternion();
        const currentScale = new THREE.Vector3();
        currentTransform.decompose(currentPos, currentQuat, currentScale);
        
        // Calculate translation - simple offset from model origin
        // Vector from model origin to modelPoint (in world space)
        const mpRelativeToOrigin = new THREE.Vector3().subVectors(this.modelPoint, currentPos);
        
        // Calculate new model position so that modelPoint ends up at terrainPoint
        // We want: newModelPos + mpRelativeToOrigin = terrainPoint
        const targetPos = new THREE.Vector3().subVectors(this.terrainPoint, mpRelativeToOrigin);
        
        // Compose target transform (keep rotation and scale unchanged)
        const targetTransform = new THREE.Matrix4();
        targetTransform.compose(targetPos, currentQuat, currentScale);
        
        // Animate the transformation
        const easeOut = makeEaseOut(circ);
        const startTransform = currentTransform.clone();
        
        animate({
            timing: easeOut,
            draw: (progress) => {
                // Interpolate between start and target transform
                const interpolatedTransform = new THREE.Matrix4();
                
                // Extract components from both matrices
                const startPos = new THREE.Vector3();
                const startQuat = new THREE.Quaternion();
                const startScale = new THREE.Vector3();
                startTransform.decompose(startPos, startQuat, startScale);
                
                const targPos = new THREE.Vector3();
                const targQuat = new THREE.Quaternion();
                const targScale = new THREE.Vector3();
                targetTransform.decompose(targPos, targQuat, targScale);
                
                // Interpolate position only (rotation and scale stay the same)
                const interpPos = startPos.clone().lerp(targPos, progress);
                
                // Compose the interpolated transform
                interpolatedTransform.compose(interpPos, targQuat, targScale);
                
                // Apply to model
                model.setPlacementTransform(interpolatedTransform);
                this.viewer.impl.invalidate(true, true, true);
            },
            duration: 1500 // 1.5 seconds (faster than full alignment)
        });
        
        // After animation completes, cleanup and reset
        setTimeout(() => {
            this.cleanup();
            this.reset();
        }, 1600);
    }
    
    cleanup() {
        // Remove all visual elements
        this._removePreview();
        
        if (this.line) {
            this.viewer.overlays.removeMesh(this.line, this.overlayName);
            this.line = null;
        }
        
        this.pointMarkers.forEach(marker => {
            this.viewer.overlays.removeMesh(marker, this.overlayName);
        });
        this.pointMarkers = [];
        
        this.viewer.impl.invalidate(true);
    }
    
    cancel() {
        this.cleanup();
        this.reset();
    }
    
    reset() {
        this.modelPoint = null;
        this.terrainPoint = null;
        this.state = ToolState.PICKING_MODEL_POINT;
        this.updateStatusMessage();
    }
}

