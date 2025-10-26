// Custom target cursor for alignment tool
const ALIGN_CURSOR = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="none" stroke="black" stroke-width="2"/><circle cx="16" cy="16" r="14" fill="none" stroke="white" stroke-width="1"/><path d="M 16 4 L 16 28 M 4 16 L 28 16" stroke="black" stroke-width="2.5"/><path d="M 16 4 L 16 28 M 4 16 L 28 16" stroke="white" stroke-width="1.5"/><circle cx="16" cy="16" r="3" fill="white" stroke="black" stroke-width="1.5"/></svg>') 16 16, crosshair`;

const ALIGN_COLOR = 0x125CCC; // Blue color matching polyline tool

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
    PICKING_MODEL_POINT_1: 'picking_model_point_1',
    PICKING_TERRAIN_POINT_1: 'picking_terrain_point_1',
    PICKING_MODEL_POINT_2: 'picking_model_point_2',
    PICKING_TERRAIN_POINT_2: 'picking_terrain_point_2',
    ANIMATING: 'animating'
};

export class AlignTool extends Autodesk.Viewing.ToolInterface {
    constructor(viewer, snapper) {
        super();
        this.viewer = viewer;
        this.snapper = snapper;
        this.names = ['align-tool'];
        this.active = false;
        this.state = ToolState.INACTIVE;
        this.raycaster = new THREE.Raycaster();
        
        // Current alignment data - two pairs of points
        this.modelPoint1 = null;
        this.terrainPoint1 = null;
        this.modelPoint2 = null;
        this.terrainPoint2 = null;
        
        // Visual elements
        this.pointMarkers = [];
        this.lines = [];
        this.previewLine = null;
        this.overlayName = 'align-tool-overlay';
        
        // Storage
        this.storageKey = 'align-tool-transforms';
        
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
        return ALIGN_CURSOR;
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
            this.state = ToolState.PICKING_MODEL_POINT_1;
            this.viewer.canvas.style.cursor = ALIGN_CURSOR;
            
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
            background: rgba(18, 92, 204, 0.95);
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
            case ToolState.PICKING_MODEL_POINT_1:
                this.statusElement.textContent = 'Step 1/4: Click on first point on the BIM model';
                break;
            case ToolState.PICKING_TERRAIN_POINT_1:
                this.statusElement.textContent = 'Step 2/4: Click on corresponding point on terrain';
                break;
            case ToolState.PICKING_MODEL_POINT_2:
                this.statusElement.textContent = 'Step 3/4: Click on second point on the BIM model';
                break;
            case ToolState.PICKING_TERRAIN_POINT_2:
                this.statusElement.textContent = 'Step 4/4: Click on second corresponding point on terrain';
                break;
            case ToolState.ANIMATING:
                this.statusElement.textContent = 'Aligning model with rotation...';
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
        
        // Show preview line when picking terrain points
        if (this.state === ToolState.PICKING_TERRAIN_POINT_1 && this.modelPoint1) {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this._updatePreview(this.modelPoint1, terrainHit);
            }
        } else if (this.state === ToolState.PICKING_TERRAIN_POINT_2 && this.modelPoint2) {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this._updatePreview(this.modelPoint2, terrainHit);
            }
        }
        
        // Update visual scales
        this._updateVisualScales();
        
        return false;
    }
    
    handleSingleClick(event, button) {
        if (!this.active || button !== 0 || this.state === ToolState.ANIMATING) return false;
        
        if (this.state === ToolState.PICKING_MODEL_POINT_1) {
            // Pick first point on BIM model
            const modelHit = this.getModelHitAtMouse(event);
            if (modelHit) {
                this.modelPoint1 = modelHit;
                this._drawPoint(modelHit);
                this.state = ToolState.PICKING_TERRAIN_POINT_1;
                this.updateStatusMessage();
                return true;
            }
        } else if (this.state === ToolState.PICKING_TERRAIN_POINT_1) {
            // Pick first point on terrain
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this.terrainPoint1 = terrainHit;
                this._removePreview();
                this._drawPoint(terrainHit);
                this._drawLine(this.modelPoint1, terrainHit);
                
                // Move to second point picking
                this.state = ToolState.PICKING_MODEL_POINT_2;
                this.updateStatusMessage();
                return true;
            }
        } else if (this.state === ToolState.PICKING_MODEL_POINT_2) {
            // Pick second point on BIM model
            const modelHit = this.getModelHitAtMouse(event);
            if (modelHit) {
                this.modelPoint2 = modelHit;
                this._drawPoint(modelHit);
                this.state = ToolState.PICKING_TERRAIN_POINT_2;
                this.updateStatusMessage();
                return true;
            }
        } else if (this.state === ToolState.PICKING_TERRAIN_POINT_2) {
            // Pick second point on terrain
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this.terrainPoint2 = terrainHit;
                this._removePreview();
                this._drawPoint(terrainHit);
                this._drawLine(this.modelPoint2, terrainHit);
                
                // Start animation with full TRS
                this.state = ToolState.ANIMATING;
                this.updateStatusMessage();
                this.performAlignment();
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
        
        // Create inner circle (blue fill)
        const innerGeometry = new THREE.CircleGeometry(0.7, 32);
        const innerMaterial = new THREE.MeshBasicMaterial({ 
            color: ALIGN_COLOR,
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
        const line = this._createLine(start, end, ALIGN_COLOR, 0.8);
        this.lines.push(line);
        this.viewer.overlays.addMesh(line, this.overlayName);
        this.viewer.impl.invalidate(true);
    }
    
    _updatePreview(start, end) {
        this._removePreview();
        
        const previewLine = this._createLine(start, end, ALIGN_COLOR, 0.6, true);
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
                const scale = this._setScale(marker.userData.point) * 1.5;
                marker.scale.set(scale, scale, 1);
                
                const camera = this.viewer.navigation.getCamera();
                marker.lookAt(camera.position);
            }
        });
    }
    
    performAlignment() {
        // Get the main model (first loaded model)
        const model = this.viewer.model;
        if (!model) {
            console.error('No model found to align');
            this.reset();
            return;
        }
        
        // Get current placement transform
        const currentTransform = model.getPlacementTransform() || new THREE.Matrix4();
        const startTransform = currentTransform.clone();
        
        // Decompose current transform
        const currentPos = new THREE.Vector3();
        const currentQuat = new THREE.Quaternion();
        const currentScale = new THREE.Vector3();
        currentTransform.decompose(currentPos, currentQuat, currentScale);
        
        // Calculate model vector - PROJECT TO XY PLANE for planar rotation only
        const modelVector = new THREE.Vector3().subVectors(this.modelPoint2, this.modelPoint1);
        modelVector.z = 0; // Project to ground plane
        const modelLength = modelVector.length();
        
        // Calculate terrain vector - PROJECT TO XY PLANE
        const terrainVector = new THREE.Vector3().subVectors(this.terrainPoint2, this.terrainPoint1);
        terrainVector.z = 0; // Project to ground plane
        const terrainLength = terrainVector.length();
        
        // Calculate planar rotation angle (around Z-axis only)
        const modelAngle = Math.atan2(modelVector.y, modelVector.x);
        const terrainAngle = Math.atan2(terrainVector.y, terrainVector.x);
        const rotationAngle = terrainAngle - modelAngle;
        
        // Create rotation quaternion around Z-axis only
        const rotationQuat = new THREE.Quaternion();
        rotationQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotationAngle);
        
        // Calculate scale factor (optional - can disable if not wanted)
        const scaleFactor = terrainLength / modelLength;
        
        // Calculate the transformation:
        // We need to rotate the model around modelPoint1, then move modelPoint1 to terrainPoint1
        
        // Step 1: Calculate where modelPoint1 would be after rotation around the model origin
        // Vector from model origin to modelPoint1 (in world space, relative to current position)
        const mp1RelativeToOrigin = new THREE.Vector3().subVectors(this.modelPoint1, currentPos);
        
        // Rotate this vector
        const mp1AfterRotation = mp1RelativeToOrigin.clone().applyQuaternion(rotationQuat);
        
        // Step 2: Scale the offset (if scaling)
        mp1AfterRotation.multiplyScalar(scaleFactor);
        
        // Step 3: Calculate new model position
        // We want: newModelPos + mp1AfterRotation = terrainPoint1
        const targetPos = new THREE.Vector3().subVectors(this.terrainPoint1, mp1AfterRotation);
        
        // Step 4: Apply rotation to current quaternion
        const targetQuat = rotationQuat.multiply(currentQuat.clone());
        
        // Step 5: Apply scale
        const targetScale = currentScale.clone().multiplyScalar(scaleFactor);
        
        // Compose target transform
        const targetTransform = new THREE.Matrix4();
        targetTransform.compose(targetPos, targetQuat, targetScale);
        
        // Animate the transformation
        const easeOut = makeEaseOut(circ);
        
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
                
                // Interpolate position
                const interpPos = startPos.clone().lerp(targPos, progress);
                
                // Interpolate rotation
                const interpQuat = startQuat.clone().slerp(targQuat, progress);
                
                // Interpolate scale
                const interpScale = startScale.clone().lerp(targScale, progress);
                
                // Compose the interpolated transform
                interpolatedTransform.compose(interpPos, interpQuat, interpScale);
                
                // Apply to model
                model.setPlacementTransform(interpolatedTransform);
                this.viewer.impl.invalidate(true, true, true);
            },
            duration: 2000 // 2 seconds
        });
        
        // After animation completes, save and reset
        setTimeout(() => {
            this.saveTransform(targetTransform);
            this.cleanup();
            this.reset();
        }, 2100);
    }
    
    saveTransform(transform) {
        try {
            const model = this.viewer.model;
            if (!model) return;
            
            // Get model URN or identifier
            const modelData = model.getData();
            const urn = modelData?.urn || 'default-model';
            
            // Extract transform components
            const pos = new THREE.Vector3();
            const quat = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            transform.decompose(pos, quat, scale);
            
            // Get lat/lon anchor from GeoThreeExtension
            const geoExt = this.viewer.getExtension('GeoThreeExtension');
            const tileLocation = geoExt ? geoExt.getTileLocation() : null;
            
            // Save to localStorage
            const stored = localStorage.getItem(this.storageKey);
            const transforms = stored ? JSON.parse(stored) : {};
            
            transforms[urn] = {
                position: { x: pos.x, y: pos.y, z: pos.z },
                rotation: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
                scale: { x: scale.x, y: scale.y, z: scale.z },
                tileLocation: tileLocation,
                timestamp: Date.now()
            };
            
            localStorage.setItem(this.storageKey, JSON.stringify(transforms));
            console.log('Transform saved for model:', urn);
        } catch (error) {
            console.error('Failed to save transform:', error);
        }
    }
    
    loadTransform(model) {
        try {
            const modelData = model.getData();
            const urn = modelData?.urn || 'default-model';
            
            const stored = localStorage.getItem(this.storageKey);
            if (!stored) return false;
            
            const transforms = JSON.parse(stored);
            const savedTransform = transforms[urn];
            
            if (savedTransform) {
                const pos = new THREE.Vector3(
                    savedTransform.position.x,
                    savedTransform.position.y,
                    savedTransform.position.z
                );
                const quat = new THREE.Quaternion(
                    savedTransform.rotation.x,
                    savedTransform.rotation.y,
                    savedTransform.rotation.z,
                    savedTransform.rotation.w
                );
                const scale = new THREE.Vector3(
                    savedTransform.scale.x,
                    savedTransform.scale.y,
                    savedTransform.scale.z
                );
                
                const transform = new THREE.Matrix4();
                transform.compose(pos, quat, scale);
                
                model.setPlacementTransform(transform);
                this.viewer.impl.invalidate(true, true, true);
                
                console.log('Transform loaded for model:', urn);
                return true;
            }
        } catch (error) {
            console.error('Failed to load transform:', error);
        }
        return false;
    }
    
    cleanup() {
        // Remove all visual elements
        this._removePreview();
        
        this.lines.forEach(line => {
            this.viewer.overlays.removeMesh(line, this.overlayName);
        });
        this.lines = [];
        
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
        this.modelPoint1 = null;
        this.terrainPoint1 = null;
        this.modelPoint2 = null;
        this.terrainPoint2 = null;
        this.state = ToolState.PICKING_MODEL_POINT_1;
        this.updateStatusMessage();
    }
}

