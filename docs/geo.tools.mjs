/**
 * Geo.Tools Extension - Unified measurement and alignment toolset
 * Namespace pattern for clean organization
 * 
 * Architecture:
 * - BaseGeoTool: Shared functionality (picking, drawing, animation)
 * - Three tool implementations: QuickMove, FullAlign, Polyline
 * - Integrated toolbar with contextual button visibility
 * - Single extension manages everything
 */

import { ModelTransformStorage, PolylineStorage, MapLocationStorage, getModelURN } from './storage-utils.mjs';
import { UnitsUtils, PolylineExporter } from './utils.mjs';

// ============================================================================
// SHARED CONSTANTS & UTILITIES
// ============================================================================

const COLORS = {
    BLUE: 0x125CCC,    // Alignment tools and polyline
    ORANGE: 0xFF8800   // Quick move tool
};

const CURSORS = {
    ALIGN: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="none" stroke="black" stroke-width="2"/><circle cx="16" cy="16" r="14" fill="none" stroke="white" stroke-width="1"/><path d="M 16 4 L 16 28 M 4 16 L 28 16" stroke="black" stroke-width="2.5"/><path d="M 16 4 L 16 28 M 4 16 L 28 16" stroke="white" stroke-width="1.5"/><circle cx="16" cy="16" r="3" fill="white" stroke="black" stroke-width="1.5"/></svg>') 16 16, crosshair`,
    POLYLINE: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="none" stroke="black" stroke-width="2"/><circle cx="16" cy="16" r="14" fill="none" stroke="white" stroke-width="1"/><line x1="6" y1="6" x2="26" y2="26" stroke="black" stroke-width="2.5"/><line x1="6" y1="6" x2="26" y2="26" stroke="white" stroke-width="1.5"/><line x1="26" y1="6" x2="6" y2="26" stroke="black" stroke-width="2.5"/><line x1="26" y1="6" x2="6" y2="26" stroke="white" stroke-width="1.5"/><circle cx="16" cy="16" r="2" fill="white" stroke="black" stroke-width="1"/></svg>') 16 16, crosshair`
};

// Animation helpers from APS blog
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

// ============================================================================
// BASE GEO TOOL - Shared functionality for all tools
// ============================================================================

class BaseGeoTool extends Autodesk.Viewing.ToolInterface {
    constructor(viewer, snapper, name, color, cursor) {
        super();
        this.viewer = viewer;
        this.snapper = snapper;
        this.names = [name];
        this.color = color;
        this.cursor = cursor;
        this.active = false;
        this.raycaster = new THREE.Raycaster();
        
        // Visual elements
        this.pointMarkers = [];
        this.lines = [];
        this.previewLine = null;
        this.overlayName = `${name}-overlay`;
        
        // Status message
        this.statusElement = null;
        
        // Remove inherited methods to use our own
        delete this.register;
        delete this.deregister;
        delete this.activate;
        delete this.deactivate;
        delete this.getPriority;
        delete this.handleSingleClick;
        delete this.handleMouseMove;
        delete this.handleButtonDown;
        delete this.handleButtonUp;
    }
    
    getName() {
        return this.names[0];
    }
    
    getCursor() {
        return this.cursor;
    }
    
    getPriority() {
        return 50;
    }
    
    // ========================================================================
    // POINT PICKING (Shared by all tools)
    // ========================================================================
    
    getModelHitAtMouse(event) {
        const result = this.viewer.impl.hitTest(event.canvasX, event.canvasY, false);
        if (result && result.intersectPoint) {
            return {
                point: result.intersectPoint.clone(),
                model: result.model || this.viewer.model
            };
        }
        return null;
    }
    
    getTerrainHitAtMouse(event) {
        const geoExt = this.viewer.getExtension('Geo.Terrain');
        if (!geoExt || !geoExt.map) return null;
        
        const vpVec = this.viewer.impl.clientToViewport(event.canvasX, event.canvasY);
        const ray = this.viewer.impl.viewportToRay(vpVec);
        if (!ray) return null;
        
        this.raycaster.ray.origin.copy(ray.origin);
        this.raycaster.ray.direction.copy(ray.direction);
        
        const intersects = this.raycaster.intersectObject(geoExt.map, true);
        return intersects.length > 0 ? intersects[0].point : null;
    }
    
    // ========================================================================
    // VISUAL DRAWING (Shared by all tools)
    // ========================================================================
    
    _drawPoint(point) {
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
        
        const innerGeometry = new THREE.CircleGeometry(0.7, 32);
        const innerMaterial = new THREE.MeshBasicMaterial({ 
            color: this.color,
            depthTest: false,
            depthWrite: false,
            side: THREE.FrontSide
        });
        const innerCircle = new THREE.Mesh(innerGeometry, innerMaterial);
        innerCircle.position.copy(point);
        innerCircle.position.z += 0.01;
        innerCircle.userData.point = point.clone();
        innerCircle.lookAt(camera.position);
        
        const scale = this._setScale(point) * 1.5;
        outerCircle.scale.set(scale, scale, 1);
        innerCircle.scale.set(scale, scale, 1);
        
        this.viewer.overlays.addMesh(outerCircle, this.overlayName);
        this.viewer.overlays.addMesh(innerCircle, this.overlayName);
        
        this.pointMarkers.push(outerCircle, innerCircle);
        this.viewer.impl.invalidate(true);
    }
    
    _drawLine(start, end) {
        const line = this._createLine(start, end, this.color, 0.8);
        this.lines.push(line);
        this.viewer.overlays.addMesh(line, this.overlayName);
        this.viewer.impl.invalidate(true);
    }
    
    _updatePreview(start, end) {
        this._removePreview();
        const previewLine = this._createLine(start, end, this.color, 0.6, true);
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
        return pixelSize * worldHeight / viewport.height;
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
        this.lines.forEach(line => {
            if (line.userData.p1 && line.userData.p2) {
                this._setCylinderScale(line, line.userData.p1, line.userData.p2);
            }
        });
        
        if (this.previewLine && this.previewLine.userData.p1 && this.previewLine.userData.p2) {
            this._setCylinderScale(this.previewLine, this.previewLine.userData.p1, this.previewLine.userData.p2);
        }
        
        this.pointMarkers.forEach(marker => {
            if (marker.userData.point) {
                const scale = this._setScale(marker.userData.point) * 1.5;
                marker.scale.set(scale, scale, 1);
                const camera = this.viewer.navigation.getCamera();
                marker.lookAt(camera.position);
            }
        });
    }
    
    // ========================================================================
    // STATUS MESSAGES (Shared)
    // ========================================================================
    
    createStatusElement(bgColor = 'rgba(18, 92, 204, 0.95)') {
        this.statusElement = document.createElement('div');
        this.statusElement.style.cssText = `
            position: absolute;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: ${bgColor};
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
    
    updateStatusMessage(message) {
        if (this.statusElement) {
            this.statusElement.textContent = message;
        }
    }
    
    removeStatusElement() {
        if (this.statusElement && this.statusElement.parentNode) {
            this.statusElement.parentNode.removeChild(this.statusElement);
            this.statusElement = null;
        }
    }
    
    // ========================================================================
    // ANIMATION (Shared)
    // ========================================================================
    
    animateToTransform(targetTransform, onComplete, model = null) {
        const targetModel = model || this.viewer.model;
        if (!targetModel) {
            console.error('No model found to animate');
            return;
        }
        
        const currentTransform = targetModel.getPlacementTransform() || new THREE.Matrix4();
        const startTransform = currentTransform.clone();
        const easeOut = makeEaseOut(circ);
        
        animate({
            timing: easeOut,
            draw: (progress) => {
                const interpolatedTransform = new THREE.Matrix4();
                const startPos = new THREE.Vector3();
                const startQuat = new THREE.Quaternion();
                const startScale = new THREE.Vector3();
                startTransform.decompose(startPos, startQuat, startScale);
                
                const targPos = new THREE.Vector3();
                const targQuat = new THREE.Quaternion();
                const targScale = new THREE.Vector3();
                targetTransform.decompose(targPos, targQuat, targScale);
                
                const interpPos = startPos.clone().lerp(targPos, progress);
                const interpQuat = startQuat.clone().slerp(targQuat, progress);
                const interpScale = startScale.clone().lerp(targScale, progress);
                
                interpolatedTransform.compose(interpPos, interpQuat, interpScale);
                targetModel.setPlacementTransform(interpolatedTransform);
                this.viewer.impl.invalidate(true, true, true);
            },
            duration: 2000
        });
        
        if (onComplete) {
            setTimeout(onComplete, 2100);
        }
    }
    
    // ========================================================================
    // CLEANUP (Shared)
    // ========================================================================
    
    cleanup() {
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
    }
}

// ============================================================================
// QUICK MOVE TOOL - Simple translation (1 line, 2 points)
// ============================================================================

class QuickMoveTool extends BaseGeoTool {
    constructor(viewer, snapper) {
        super(viewer, snapper, 'quick-move-tool', COLORS.ORANGE, CURSORS.ALIGN);
        this.state = 'inactive';
        this.modelPoint = null;
        this.terrainPoint = null;
        this.targetModel = null; // Store which model to move
    }
    
    activate(name, viewer) {
        if (!this.active) {
            if (!this.viewer.overlays.hasScene(this.overlayName)) {
                this.viewer.overlays.addScene(this.overlayName);
            }
            this.createStatusElement('rgba(255, 136, 0, 0.95)');
            this.active = true;
            this.state = 'picking_model';
            this.viewer.canvas.style.cursor = this.cursor;
            this.updateStatusMessage('Quick Move: Click point on BIM model');
            
            this._onKeyDown = (e) => {
                if (e.key === 'Escape' && this.active) {
                    this.cancel();
                    e.preventDefault();
                }
            };
            document.addEventListener('keydown', this._onKeyDown);
            
            this._onCameraChange = () => this._updateVisualScales();
            this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
        }
    }
    
    deactivate(name) {
        if (this.active) {
            this.cleanup();
            this.active = false;
            this.state = 'inactive';
            this.viewer.canvas.style.cursor = 'auto';
            this.removeStatusElement();
            if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown);
            if (this._onCameraChange) this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
        }
    }
    
    handleMouseMove(event) {
        if (!this.active || this.state === 'animating') return false;
        if (this.state === 'picking_terrain' && this.modelPoint) {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) this._updatePreview(this.modelPoint, terrainHit);
        }
        this._updateVisualScales();
        return false;
    }
    
    handleSingleClick(event, button) {
        if (!this.active || button !== 0 || this.state === 'animating') return false;
        
        if (this.state === 'picking_model') {
            const modelHit = this.getModelHitAtMouse(event);
            if (modelHit) {
                this.modelPoint = modelHit.point;
                this.targetModel = modelHit.model;
                this._drawPoint(modelHit.point);
                this.state = 'picking_terrain';
                this.updateStatusMessage('Quick Move: Click target point on terrain');
                return true;
            }
        } else if (this.state === 'picking_terrain') {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this.terrainPoint = terrainHit;
                this._removePreview();
                this._drawPoint(terrainHit);
                this._drawLine(this.modelPoint, terrainHit);
                this.state = 'animating';
                this.updateStatusMessage('Moving model...');
                this.performAlignment();
                return true;
            }
        }
        return false;
    }
    
    performAlignment() {
        const model = this.targetModel || this.viewer.model;
        if (!model) return;
        
        const currentTransform = model.getPlacementTransform() || new THREE.Matrix4();
        const currentPos = new THREE.Vector3();
        const currentQuat = new THREE.Quaternion();
        const currentScale = new THREE.Vector3();
        currentTransform.decompose(currentPos, currentQuat, currentScale);
        
        const mpRelativeToOrigin = new THREE.Vector3().subVectors(this.modelPoint, currentPos);
        const targetPos = new THREE.Vector3().subVectors(this.terrainPoint, mpRelativeToOrigin);
        
        const targetTransform = new THREE.Matrix4();
        targetTransform.compose(targetPos, currentQuat, currentScale);
        
        const easeOut = makeEaseOut(circ);
        animate({
            timing: easeOut,
            draw: (progress) => {
                const interpolatedTransform = new THREE.Matrix4();
                const startPos = currentPos.clone().lerp(targetPos, progress);
                interpolatedTransform.compose(startPos, currentQuat, currentScale);
                model.setPlacementTransform(interpolatedTransform);
                this.viewer.impl.invalidate(true, true, true);
            },
            duration: 1500
        });
        
        setTimeout(() => {
            this.cleanup();
            this.reset();
        }, 1600);
    }
    
    reset() {
        this.modelPoint = null;
        this.terrainPoint = null;
        this.targetModel = null;
        this.state = 'picking_model';
        this.updateStatusMessage('Quick Move: Click point on BIM model');
    }
    
    cancel() {
        this.cleanup();
        this.reset();
    }
}

// ============================================================================
// FULL ALIGN TOOL - Complete TRS alignment (2 lines, 4 points)
// ============================================================================

class FullAlignTool extends BaseGeoTool {
    constructor(viewer, snapper) {
        super(viewer, snapper, 'full-align-tool', COLORS.BLUE, CURSORS.ALIGN);
        this.state = 'inactive';
        this.modelPoint1 = null;
        this.terrainPoint1 = null;
        this.modelPoint2 = null;
        this.terrainPoint2 = null;
        this.targetModel = null; // Store which model to move
    }
    
    activate(name, viewer) {
        if (!this.active) {
            if (!this.viewer.overlays.hasScene(this.overlayName)) {
                this.viewer.overlays.addScene(this.overlayName);
            }
            this.createStatusElement();
            this.active = true;
            this.state = 'picking_model_1';
            this.viewer.canvas.style.cursor = this.cursor;
            this.updateStatusMessage('Step 1/4: Click first point on BIM model');
            
            this._onKeyDown = (e) => {
                if (e.key === 'Escape' && this.active) {
                    this.cancel();
                    e.preventDefault();
                }
            };
            document.addEventListener('keydown', this._onKeyDown);
            
            this._onCameraChange = () => this._updateVisualScales();
            this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
        }
    }
    
    deactivate(name) {
        if (this.active) {
            this.cleanup();
            this.active = false;
            this.state = 'inactive';
            this.viewer.canvas.style.cursor = 'auto';
            this.removeStatusElement();
            if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown);
            if (this._onCameraChange) this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
        }
    }
    
    handleMouseMove(event) {
        if (!this.active || this.state === 'animating') return false;
        
        if (this.state === 'picking_terrain_1' && this.modelPoint1) {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) this._updatePreview(this.modelPoint1, terrainHit);
        } else if (this.state === 'picking_terrain_2' && this.modelPoint2) {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) this._updatePreview(this.modelPoint2, terrainHit);
        }
        
        this._updateVisualScales();
        return false;
    }
    
    handleSingleClick(event, button) {
        if (!this.active || button !== 0 || this.state === 'animating') return false;
        
        if (this.state === 'picking_model_1') {
            const modelHit = this.getModelHitAtMouse(event);
            if (modelHit) {
                this.modelPoint1 = modelHit.point;
                this.targetModel = modelHit.model;
                this._drawPoint(modelHit.point);
                this.state = 'picking_terrain_1';
                this.updateStatusMessage('Step 2/4: Click corresponding point on terrain');
                return true;
            }
        } else if (this.state === 'picking_terrain_1') {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this.terrainPoint1 = terrainHit;
                this._removePreview();
                this._drawPoint(terrainHit);
                this._drawLine(this.modelPoint1, terrainHit);
                this.state = 'picking_model_2';
                this.updateStatusMessage('Step 3/4: Click second point on BIM model');
                return true;
            }
        } else if (this.state === 'picking_model_2') {
            const modelHit = this.getModelHitAtMouse(event);
            if (modelHit) {
                this.modelPoint2 = modelHit.point;
                this._drawPoint(modelHit.point);
                this.state = 'picking_terrain_2';
                this.updateStatusMessage('Step 4/4: Click second corresponding point on terrain');
                return true;
            }
        } else if (this.state === 'picking_terrain_2') {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) {
                this.terrainPoint2 = terrainHit;
                this._removePreview();
                this._drawPoint(terrainHit);
                this._drawLine(this.modelPoint2, terrainHit);
                this.state = 'animating';
                this.updateStatusMessage('Aligning model with rotation...');
                this.performAlignment();
                return true;
            }
        }
        return false;
    }
    
    performAlignment() {
        const model = this.targetModel || this.viewer.model;
        if (!model) return;
        
        const currentTransform = model.getPlacementTransform() || new THREE.Matrix4();
        const currentPos = new THREE.Vector3();
        const currentQuat = new THREE.Quaternion();
        const currentScale = new THREE.Vector3();
        currentTransform.decompose(currentPos, currentQuat, currentScale);
        
        // Calculate planar rotation (Z-axis only)
        const modelVector = new THREE.Vector3().subVectors(this.modelPoint2, this.modelPoint1);
        modelVector.z = 0;
        const modelLength = modelVector.length();
        
        const terrainVector = new THREE.Vector3().subVectors(this.terrainPoint2, this.terrainPoint1);
        terrainVector.z = 0;
        const terrainLength = terrainVector.length();
        
        const modelAngle = Math.atan2(modelVector.y, modelVector.x);
        const terrainAngle = Math.atan2(terrainVector.y, terrainVector.x);
        const rotationAngle = terrainAngle - modelAngle;
        
        const rotationQuat = new THREE.Quaternion();
        rotationQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotationAngle);
        
        const scaleFactor = terrainLength / modelLength;
        
        const mp1RelativeToOrigin = new THREE.Vector3().subVectors(this.modelPoint1, currentPos);
        const mp1AfterRotation = mp1RelativeToOrigin.clone().applyQuaternion(rotationQuat);
        mp1AfterRotation.multiplyScalar(scaleFactor);
        
        const targetPos = new THREE.Vector3().subVectors(this.terrainPoint1, mp1AfterRotation);
        const targetQuat = rotationQuat.multiply(currentQuat.clone());
        const targetScale = currentScale.clone().multiplyScalar(scaleFactor);
        
        const targetTransform = new THREE.Matrix4();
        targetTransform.compose(targetPos, targetQuat, targetScale);
        
        this.animateToTransform(targetTransform, () => {
            this.saveTransform(targetTransform, model);
            this.cleanup();
            this.reset();
        }, model);
    }
    
    saveTransform(transform, model = null) {
        const targetModel = model || this.viewer.model;
        if (!targetModel) return;
        
        const urn = getModelURN(targetModel);
        const geoExt = this.viewer.getExtension('Geo.Terrain');
        const tileLocation = geoExt ? geoExt.getTileLocation() : null;
        const transformData = ModelTransformStorage.fromMatrix4(transform, tileLocation);
        ModelTransformStorage.set(urn, transformData);
    }
    
    loadTransform(model) {
        const urn = getModelURN(model);
        const transformData = ModelTransformStorage.get(urn);
        if (transformData) {
            const transform = ModelTransformStorage.toMatrix4(transformData);
            model.setPlacementTransform(transform);
            this.viewer.impl.invalidate(true, true, true);
            return true;
        }
        return false;
    }
    
    reset() {
        this.modelPoint1 = null;
        this.terrainPoint1 = null;
        this.modelPoint2 = null;
        this.terrainPoint2 = null;
        this.targetModel = null;
        this.state = 'picking_model_1';
        this.updateStatusMessage('Step 1/4: Click first point on BIM model');
    }
    
    cancel() {
        this.cleanup();
        this.reset();
    }
}

// ============================================================================
// POLYLINE MEASURE TOOL - Distance measurement on terrain
// ============================================================================

class PolylineTool extends BaseGeoTool {
    constructor(viewer, snapper) {
        super(viewer, snapper, 'polyline-measure-tool', COLORS.BLUE, CURSORS.POLYLINE);
        this.points = [];
        this.labels = [];
        this.totalDistance = 0;
        this.polylines = [];
        this.isDataLoaded = false;
        this.labelContainer = null;
    }
    
    activate(name, viewer) {
        if (!this.active) {
            if (!this.viewer.overlays.hasScene(this.overlayName)) {
                this.viewer.overlays.addScene(this.overlayName);
            }
            
            // Create label container if it doesn't exist
            if (!this.labelContainer) {
                this.labelContainer = document.createElement('div');
                this.labelContainer.id = 'polyline-labels';
                this.viewer.container.appendChild(this.labelContainer);
            }
            
            // Show label container when tool is activated
            this.labelContainer.style.display = 'block';
            
            this.createStatusElement();
            this.active = true;
            this.viewer.canvas.style.cursor = this.cursor;
            this.updateStatusMessage('Click to start measuring (ESC to finish)');
            
            this._onKeyDown = (e) => {
                if (e.key === 'Escape' && this.active) {
                    this._finish();
                    e.preventDefault();
                }
            };
            document.addEventListener('keydown', this._onKeyDown);
            
            this._onCameraChange = () => {
                this._updateVisualScales();
                this._updateLabelPositions();
            };
            this.viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
            
            if (!this.isDataLoaded) {
                this._loadFromStorage();
                this.isDataLoaded = true;
            }
            
            // Update visuals and force re-render to ensure labels and markers are correctly positioned
            this._updateVisualScales();
            this._updateLabelPositions();
            this.viewer.impl.invalidate(true);
        }
    }
    
    deactivate(name) {
        if (this.active) {
            this._finish();
            this.active = false;
            this.viewer.canvas.style.cursor = 'auto';
            this.removeStatusElement();
            
            // Hide all labels when tool is deactivated
            if (this.labelContainer) {
                this.labelContainer.style.display = 'none';
            }
            
            if (this._onKeyDown) document.removeEventListener('keydown', this._onKeyDown);
            if (this._onCameraChange) this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
        }
    }
    
    handleMouseMove(event) {
        if (!this.active) return false;
        if (this.points.length > 0) {
            const terrainHit = this.getTerrainHitAtMouse(event);
            if (terrainHit) this._updatePreview(this.points[this.points.length - 1], terrainHit);
        }
        this._updateVisualScales();
        this._updateLabelPositions();
        return false;
    }
    
    handleSingleClick(event, button) {
        if (!this.active || button !== 0) return false;
        
        const terrainHit = this.getTerrainHitAtMouse(event);
        if (terrainHit) {
            this.points.push(terrainHit);
            this._drawPoint(terrainHit);
            
            if (this.points.length > 1) {
                const prevPoint = this.points[this.points.length - 2];
                const distance = prevPoint.distanceTo(terrainHit);
                this.totalDistance += distance;
                this._drawLine(prevPoint, terrainHit);
                this._createLabel(prevPoint, terrainHit, distance);
            }
            
            // Update visuals and force re-render to ensure labels and markers are correctly positioned
            this._updateVisualScales();
            this._updateLabelPositions();
            this.viewer.impl.invalidate(true);
            
            this._saveToStorage();
            this.updateStatusMessage(`Distance: ${(this.totalDistance * 0.13429 * 2).toFixed(2)}m (ESC to finish)`);
            return true;
        }
        return false;
    }
    
    _createLabel(p1, p2, distance) {
        const label = document.createElement('div');
        label.className = 'measure-length visible';
        
        const text = document.createElement('div');
        text.className = 'measure-length-text';
        const distanceInMeters = distance * 0.13429 * 2;
        
        if (distanceInMeters >= 1000) {
            text.textContent = `${(distanceInMeters / 1000).toFixed(2)} km`;
        } else {
            text.textContent = `${distanceInMeters.toFixed(2)} m`;
        }
        label.appendChild(text);
        
        label.userData = {
            p1: p1.clone(),
            p2: p2.clone(),
            midpoint: new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5)
        };
        
        if (this.labelContainer) {
            this.labelContainer.appendChild(label);
        } else {
            this.viewer.container.appendChild(label);
        }
        this.labels.push(label);
        
        setTimeout(() => this._positionLabel(label), 0);
    }
    
    _positionLabel(label) {
        if (!label.userData || !label.userData.midpoint) return;
        
        const midpoint = label.userData.midpoint;
        const camera = this.viewer.navigation.getCamera();
        const containerBounds = this.viewer.navigation.getScreenViewport();
        
        const p = midpoint.clone().project(camera);
        const x = Math.round((p.x + 1) / 2 * containerBounds.width);
        const y = Math.round((-p.y + 1) / 2 * containerBounds.height);
        
        label.style.left = (x - label.clientWidth / 2) + 'px';
        label.style.top = (y - label.clientHeight / 2) + 'px';
    }
    
    _updateLabelPositions() {
        this.labels.forEach(label => this._positionLabel(label));
    }
    
    _finish() {
        this._removePreview();
        
        if (this.points.length > 1) {
            const lastPoint = this.points[this.points.length - 1];
            const prevPoint = this.points[this.points.length - 2];
            const distance = lastPoint.distanceTo(prevPoint);
            
            if (distance < 0.001) {
                this.points.pop();
                if (this.lines.length > 0) {
                    const lastLine = this.lines.pop();
                    this.viewer.overlays.removeMesh(lastLine, this.overlayName);
                }
                if (this.labels.length > 0) {
                    const lastLabel = this.labels.pop();
                    if (lastLabel.parentNode) lastLabel.parentNode.removeChild(lastLabel);
                }
                if (this.pointMarkers.length >= 2) {
                    const innerMarker = this.pointMarkers.pop();
                    const outerMarker = this.pointMarkers.pop();
                    this.viewer.overlays.removeMesh(innerMarker, this.overlayName);
                    this.viewer.overlays.removeMesh(outerMarker, this.overlayName);
                }
            }
        }
        
        if (this.points.length > 1) {
            const geoExt = this.viewer.getExtension('Geo.Terrain');
            const tileLocation = geoExt ? geoExt.getTileLocation() : null;
            
            this.polylines.push({
                points: this.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
                totalDistance: this.totalDistance,
                tileLocation: tileLocation
            });
            this._saveToStorage();
        }
        
        this.points = [];
        this.totalDistance = 0;
    }
    
    clearAll() {
        this._removePreview();
        
        this.lines.forEach(line => this.viewer.overlays.removeMesh(line, this.overlayName));
        this.pointMarkers.forEach(marker => this.viewer.overlays.removeMesh(marker, this.overlayName));
        this.labels.forEach(label => {
            if (label.parentNode) label.parentNode.removeChild(label);
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
        
        if (data.completedPolylines && Array.isArray(data.completedPolylines)) {
            this.polylines = data.completedPolylines;
            data.completedPolylines.forEach(polyline => {
                if (polyline.points && polyline.points.length > 1) {
                    this._restorePolyline(polyline.points);
                }
            });
        }
        
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
    
    cancel() {
        this._finish();
    }
}

// ============================================================================
// LOCATION PANEL - Helper UI for setting map location
// ============================================================================

class LocationPanel extends Autodesk.Viewing.UI.DockingPanel {
    constructor(viewer, id, title, onClose) {
        super(viewer.container, id, title);
        this.viewer = viewer;
        this.onClose = onClose;
    }
    
    initialize() {
        // Call parent's initialize
        this.title = this.createTitleBar(this.titleLabel || this.container.id);
        this.closer = this.createCloseButton();
        this.container.appendChild(this.title);
        this.container.appendChild(this.closer);
        this.initializeMoveHandlers(this.title);
        
        // Create content container
        this.scrollContainer = document.createElement('div');
        this.scrollContainer.className = 'docking-panel-scroll';
        this.container.appendChild(this.scrollContainer);
        
        // Style the panel
        this.container.classList.add('geo-location-panel');
        this.container.style.width = '600px';
        this.container.style.height = 'auto';
        this.container.style.resize = 'none';
        this.container.style.bottom = '100px';
        this.container.style.right = '100px';
        this.container.style.backgroundColor = '#ffffff';
        
        // Create the UI content
        this.createUI();
    }
    
    createUI() {
        const saved = MapLocationStorage.get();
        const defaultLat = saved?.lat ?? 50.1163;
        const defaultLon = saved?.lon ?? -122.9574;
        const defaultZoom = saved?.zoom ?? 12;
        
        const contentDiv = document.createElement('div');
        contentDiv.style.padding = '20px';
        contentDiv.innerHTML = `
            <style>
                .geo-location-panel { font-family: "ArtifaktElement", sans-serif; }
                .geo-location-panel .docking-panel-scroll { 
                    max-height: 300px; 
                    overflow-y: auto;
                }
                .loc-preset-container { display: flex; gap: 8px; margin-bottom: 16px; }
                .loc-preset-btn {
                    flex: 1; padding: 8px 12px; border: 1px solid #ccc;
                    border-radius: 4px; background: white; cursor: pointer;
                    font-size: 13px; transition: all 0.2s;
                }
                .loc-preset-btn:hover { background: #f0f0f0; border-color: #125CCC; }
                .loc-input-label {
                    display: block; margin-bottom: 4px; font-size: 12px;
                    color: #666; font-weight: 500;
                }
                .loc-input {
                    width: 100%; padding: 8px; border: 1px solid #ccc;
                    border-radius: 4px; font-size: 13px;
                }
                .loc-go-btn {
                    padding: 8px 16px; background: #125CCC; color: white;
                    border: none; border-radius: 4px; cursor: pointer;
                    font-size: 13px; font-weight: 500;
                }
                .loc-go-btn:hover { background: #0e4a9d; }
            </style>
            <div class="loc-preset-container">
                <button class="loc-preset-btn" data-lat="50.1163" data-lon="-122.9574">Whistler</button>
                <button class="loc-preset-btn" data-lat="35.3606" data-lon="138.7278">Mt Fuji</button>
                <button class="loc-preset-btn" data-lat="37.7749" data-lon="-122.4194">SF</button>
                <button class="loc-preset-btn" data-lat="40.7128" data-lon="-74.0060">NYC</button>
                <button class="loc-preset-btn" data-lat="46.4100" data-lon="11.8500">Dolomites</button>
                <button class="loc-preset-btn" data-lat="-49.3314" data-lon="-72.8864">Patagonia</button>
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
        
        // Append to scroll container instead of main container
        this.scrollContainer.appendChild(contentDiv);
        
        contentDiv.querySelectorAll('.loc-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const lat = parseFloat(e.target.dataset.lat);
                const lon = parseFloat(e.target.dataset.lon);
                const zoom = parseInt(document.getElementById('location-zoom').value);
                this.applyLocation(lat, lon, zoom);
                this.setVisible(false);
            });
        });
        
        contentDiv.querySelector('#location-apply').addEventListener('click', () => {
            const lat = parseFloat(document.getElementById('location-lat').value);
            const lon = parseFloat(document.getElementById('location-lon').value);
            const zoom = parseInt(document.getElementById('location-zoom').value);
            
            if (isNaN(lat) || isNaN(lon) || isNaN(zoom)) {
                alert('Please enter valid numbers');
                return;
            }
            
            if (lat < -85 || lat > 85 || lon < -180 || lon > 180 || zoom < 0 || zoom > 20) {
                alert('Invalid values');
                return;
            }
            
            this.applyLocation(lat, lon, zoom);
            this.setVisible(false);
        });
        
        const handleEnter = (e) => {
            if (e.key === 'Enter') contentDiv.querySelector('#location-apply').click();
        };
        contentDiv.querySelector('#location-lat').addEventListener('keypress', handleEnter);
        contentDiv.querySelector('#location-lon').addEventListener('keypress', handleEnter);
        contentDiv.querySelector('#location-zoom').addEventListener('keypress', handleEnter);
    }
    
    applyLocation(lat, lon, zoom) {
        MapLocationStorage.set(lat, lon, zoom);
        const tile = UnitsUtils.pointToTile(lon, lat, zoom);
        const geoExt = this.viewer.getExtension('Geo.Terrain');
        if (geoExt) {
            geoExt.setTileLocation(zoom, tile[0], tile[1]);
        }
    }
    
    setVisible(show) {
        // Use the parent's setVisible method
        super.setVisible(show);
    }
}

// ============================================================================
// TOOLBAR MANAGER - Unified toolbar with contextual buttons
// ============================================================================

class ToolbarManager {
    constructor(viewer, extension) {
        this.viewer = viewer;
        this.extension = extension;
        this.toolbar = null;
        this.settingsToolbar = null;
        this.currentMode = 'none';
        
        this.quickMoveTool = null;
        this.fullAlignTool = null;
        this.polylineTool = null;
    }
    
    createToolbar() {
        if (!this.viewer.toolbar) return;
        
        const avu = Autodesk.Viewing.UI;
        
        // Main toolbar: tool mode radio buttons only
        this.toolbar = new avu.ControlGroup('GeoToolsToolbar');
        this.createModeButtons(avu);
        this.viewer.toolbar.addControl(this.toolbar);
        
        // Settings toolbar: location button + action buttons (separate group)
        this.settingsToolbar = new avu.ControlGroup('GeoSettingsToolbar');
        this.createSettingsButtons(avu);
        this.createActionButtons(avu);
        this.updateActionButtonsVisibility();
        this.viewer.toolbar.addControl(this.settingsToolbar);
    }
    
    createModeButtons(avu) {
        // Quick Move
        this.quickMoveButton = this.createButton(
            avu,
            'geo-quick-move-button',
            'Quick Move - Translation Only (ESC to cancel)',
            'adsk-icon-pan',
            () => this.toggleMode('quickMove')
        );
        this.toolbar.addControl(this.quickMoveButton);
        
        // Full Align
        this.fullAlignButton = this.createButton(
            avu,
            'geo-full-align-button',
            'Full Align - Translate, Rotate & Scale (ESC to cancel)',
            'adsk-icon-measure-distance',
            () => this.toggleMode('fullAlign')
        );
        this.toolbar.addControl(this.fullAlignButton);
        
        // Polyline
        this.polylineButton = this.createButton(
            avu,
            'geo-polyline-button',
            'Tape Measure (ESC to finish)',
            'adsk-icon-measure-area-new',
            () => this.toggleMode('polyline')
        );
        this.toolbar.addControl(this.polylineButton);
    }
    
    createSettingsButtons(avu) {
        // Set Location (in separate control group)
        this.locationButton = this.createButton(
            avu,
            'geo-location-button',
            'Set Map Location (Lat/Long)',
            'adsk-icon-measure-location',
            () => this.showLocationPanel()
        );
        this.settingsToolbar.addControl(this.locationButton);
    }
    
    createActionButtons(avu) {
        // Reset Transform
        this.resetButton = this.createButton(
            avu,
            'geo-reset-button',
            'Reset Model Transform',
            'adsk-icon-home',
            () => {
                // Use the currently selected model from the active tool
                let model = this.viewer.model;
                if (this.currentMode === 'quickMove' && this.quickMoveTool?.targetModel) {
                    model = this.quickMoveTool.targetModel;
                } else if (this.currentMode === 'fullAlign' && this.fullAlignTool?.targetModel) {
                    model = this.fullAlignTool.targetModel;
                }
                
                if (model && this.fullAlignTool) {
                    this.fullAlignTool.animateToTransform(new THREE.Matrix4(), () => {
                        const urn = getModelURN(model);
                        ModelTransformStorage.remove(urn);
                        console.log('Model transform reset');
                    }, model);
                }
            }
        );
        this.settingsToolbar.addControl(this.resetButton);
        
        // Clear Polylines
        this.clearButton = this.createButton(
            avu,
            'geo-clear-button',
            'Clear All Polylines',
            'adsk-icon-measure-trash',
            () => {
                if (this.polylineTool) this.polylineTool.clearAll();
            }
        );
        this.settingsToolbar.addControl(this.clearButton);
        
        // Export GeoJSON
        this.exportButton = this.createButton(
            avu,
            'geo-export-button',
            'Export to GeoJSON',
            'adsk-icon-measure-calibration',
            () => {
                if (this.polylineTool && this.polylineTool.polylines.length > 0) {
                    try {
                        const exporter = new PolylineExporter(this.viewer);
                        const result = exporter.export();
                        if (result.success) {
                            console.log(`Exported ${result.featureCount} features to GeoJSON`);
                        } else {
                            console.error('Export failed:', result.error);
                            alert('Export failed: ' + result.error);
                        }
                    } catch (error) {
                        console.error('Export error:', error);
                        alert('Export error: ' + error.message);
                    }
                }
            }
        );
        this.settingsToolbar.addControl(this.exportButton);
    }
    
    createButton(avu, id, tooltip, icon, onClick) {
        const button = new avu.Button(id);
        button.setToolTip(tooltip);
        button.setIcon(icon);
        button.onClick = onClick;
        return button;
    }
    
    toggleMode(mode) {
        if (this.currentMode === mode) {
            this.deactivateCurrentMode();
        } else {
            this.activateMode(mode);
        }
    }
    
    activateMode(mode) {
        const avu = Autodesk.Viewing.UI;
        
        // Deactivate current mode first
        this.deactivateCurrentMode();
        
        // Activate new mode
        this.currentMode = mode;
        
        if (mode === 'quickMove') {
            this.viewer.toolController.activateTool(this.quickMoveTool.getName());
            this.quickMoveButton.setState(avu.Button.State.ACTIVE);
        } else if (mode === 'fullAlign') {
            this.viewer.toolController.activateTool(this.fullAlignTool.getName());
            this.fullAlignButton.setState(avu.Button.State.ACTIVE);
        } else if (mode === 'polyline') {
            this.viewer.toolController.activateTool(this.polylineTool.getName());
            this.polylineButton.setState(avu.Button.State.ACTIVE);
        }
        
        this.updateActionButtonsVisibility();
    }
    
    deactivateCurrentMode() {
        const avu = Autodesk.Viewing.UI;
        
        if (this.currentMode === 'quickMove' && this.quickMoveTool) {
            this.viewer.toolController.deactivateTool(this.quickMoveTool.getName());
            this.quickMoveButton.setState(avu.Button.State.INACTIVE);
        } else if (this.currentMode === 'fullAlign' && this.fullAlignTool) {
            this.viewer.toolController.deactivateTool(this.fullAlignTool.getName());
            this.fullAlignButton.setState(avu.Button.State.INACTIVE);
        } else if (this.currentMode === 'polyline' && this.polylineTool) {
            this.viewer.toolController.deactivateTool(this.polylineTool.getName());
            this.polylineButton.setState(avu.Button.State.INACTIVE);
        }
        
        this.currentMode = 'none';
        this.updateActionButtonsVisibility();
    }
    
    updateActionButtonsVisibility() {
        // Reset - show when alignment tools are active
        const showReset = this.currentMode === 'quickMove' || this.currentMode === 'fullAlign';
        this.resetButton.container.style.display = showReset ? '' : 'none';
        
        // Clear and Export - show when polyline tool is active
        const showPolylineActions = this.currentMode === 'polyline';
        this.clearButton.container.style.display = showPolylineActions ? '' : 'none';
        this.exportButton.container.style.display = showPolylineActions ? '' : 'none';
    }
    
    showLocationPanel() {
        const avu = Autodesk.Viewing.UI;
        
        if (!this.locationPanel) {
            this.locationPanel = new LocationPanel(this.viewer, 'location-panel', 'Set Map Location');
        }
        
        const isVisible = this.locationPanel.isVisible();
        const newState = isVisible ? avu.Button.State.INACTIVE : avu.Button.State.ACTIVE;
        
        this.locationButton.setState(newState);
        this.locationPanel.setVisible(!isVisible);
    }
    
    destroyToolbar() {
        if (this.toolbar) {
            this.viewer.toolbar.removeControl(this.toolbar);
            this.toolbar = null;
        }
        if (this.settingsToolbar) {
            this.viewer.toolbar.removeControl(this.settingsToolbar);
            this.settingsToolbar = null;
        }
    }
}

// ============================================================================
// MAIN EXTENSION - Geo.Tools
// ============================================================================

class GeoToolsExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this.quickMoveTool = null;
        this.fullAlignTool = null;
        this.polylineTool = null;
        this.snapper = null;
        this.toolbarManager = null;
    }
    
    async load() {
        // Load snapper
        await this.viewer.loadExtension('Autodesk.Snapping');
        const SnapperClass = Autodesk.Viewing.Extensions.Snapping.Snapper;
        this.snapper = new SnapperClass(this.viewer, { 
            renderSnappedGeometry: true, 
            renderSnappedTopology: true
        });
        this.viewer.toolController.registerTool(this.snapper);
        this.viewer.toolController.activateTool(this.snapper.getName());
        
        // Create and register all tools
        this.quickMoveTool = new QuickMoveTool(this.viewer, this.snapper);
        this.viewer.toolController.registerTool(this.quickMoveTool);
        
        this.fullAlignTool = new FullAlignTool(this.viewer, this.snapper);
        this.viewer.toolController.registerTool(this.fullAlignTool);
        
        this.polylineTool = new PolylineTool(this.viewer, this.snapper);
        this.viewer.toolController.registerTool(this.polylineTool);
        
        // Initialize toolbar manager (but don't create toolbar yet)
        this.toolbarManager = new ToolbarManager(this.viewer, this);
        this.toolbarManager.quickMoveTool = this.quickMoveTool;
        this.toolbarManager.fullAlignTool = this.fullAlignTool;
        this.toolbarManager.polylineTool = this.polylineTool;
        
        // Load saved model transform
        this._onGeometryLoaded = this._onGeometryLoaded.bind(this);
        this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this._onGeometryLoaded);
        
        console.log('Geo.Tools extension loaded');
        return true;
    }
    
    onToolbarCreated() {
        // This is called when the viewer's toolbar is ready
        // Safe to create UI elements now
        if (this.toolbarManager && !this.toolbarManager.toolbar) {
            this.toolbarManager.createToolbar();
            console.log('Geo.Tools toolbar created');
        }
    }
    
    _onGeometryLoaded(event) {
        const model = event.model;
        if (model && this.fullAlignTool) {
            this.fullAlignTool.loadTransform(model);
        }
    }
    
    unload() {
        // Unregister tools
        if (this.quickMoveTool) {
            if (this.viewer.toolController.isToolActivated(this.quickMoveTool.getName())) {
                this.viewer.toolController.deactivateTool(this.quickMoveTool.getName());
            }
            this.viewer.toolController.deregisterTool(this.quickMoveTool);
            this.quickMoveTool = null;
        }
        
        if (this.fullAlignTool) {
            if (this.viewer.toolController.isToolActivated(this.fullAlignTool.getName())) {
                this.viewer.toolController.deactivateTool(this.fullAlignTool.getName());
            }
            this.viewer.toolController.deregisterTool(this.fullAlignTool);
            this.fullAlignTool = null;
        }
        
        if (this.polylineTool) {
            if (this.viewer.toolController.isToolActivated(this.polylineTool.getName())) {
                this.viewer.toolController.deactivateTool(this.polylineTool.getName());
            }
            this.viewer.toolController.deregisterTool(this.polylineTool);
            this.polylineTool = null;
        }
        
        if (this.snapper) {
            if (this.viewer.toolController.isToolActivated(this.snapper.getName())) {
                this.viewer.toolController.deactivateTool(this.snapper.getName());
            }
            this.viewer.toolController.deregisterTool(this.snapper);
            this.snapper = null;
        }
        
        // Destroy toolbar
        if (this.toolbarManager) {
            this.toolbarManager.destroyToolbar();
            this.toolbarManager = null;
        }
        
        // Remove event listener
        if (this._onGeometryLoaded) {
            this.viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this._onGeometryLoaded);
        }
        
        console.log('Geo.Tools extension unloaded');
        return true;
    }
}

// Register with namespace pattern
Autodesk.Viewing.theExtensionManager.registerExtension('Geo.Tools', GeoToolsExtension);

