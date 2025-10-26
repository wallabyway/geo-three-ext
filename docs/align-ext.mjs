import { AlignTool } from './align-tool.mjs';
import { SimpleAlignTool } from './simple-align-tool.mjs';
import { ModelTransformStorage, getModelURN } from './storage-utils.mjs';

export class AlignToolExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this.tool = null;
        this.simpleTool = null;
        this.snapper = null;
        this.toolbarGroup = null;
    }
    
    async load() {
        // Load snapping extension
        await this.viewer.loadExtension('Autodesk.Snapping');
        
        const SnapperClass = Autodesk.Viewing.Extensions.Snapping.Snapper;
        this.snapper = new SnapperClass(this.viewer, { 
            renderSnappedGeometry: true, 
            renderSnappedTopology: true
        });
        
        this.viewer.toolController.registerTool(this.snapper);
        this.viewer.toolController.activateTool(this.snapper.getName());
        
        // Create and register the full align tool
        this.tool = new AlignTool(this.viewer, this.snapper);
        this.viewer.toolController.registerTool(this.tool);
        
        // Create and register the simple align tool (translation only)
        this.simpleTool = new SimpleAlignTool(this.viewer, this.snapper);
        this.viewer.toolController.registerTool(this.simpleTool);
        
        // Listen for model loaded events to apply saved transforms
        this._onGeometryLoaded = this._onGeometryLoaded.bind(this);
        this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this._onGeometryLoaded);
        
        return true;
    }
    
    _onGeometryLoaded(event) {
        // Try to load saved transform for this model
        if (this.tool && event.model) {
            this.tool.loadTransform(event.model);
        }
    }
    
    onToolbarCreated() {
        // Toolbar is ready, safe to create buttons
        if (!this.subToolbar) {
            this.createToolbar();
        }
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
        
        this.simpleToggleButton = createButton(
            'simple-align-toggle-button',
            'Quick Move Tool - Translation Only (ESC to cancel)',
            'adsk-icon-measure-move', // Move icon for simple translation
            () => {
                const isActive = this.simpleToggleButton.getState() === avu.Button.State.ACTIVE;
                const newState = isActive ? avu.Button.State.INACTIVE : avu.Button.State.ACTIVE;
                const toolAction = isActive ? 'deactivateTool' : 'activateTool';
                
                this.simpleToggleButton.setState(newState);
                this.viewer.toolController[toolAction](this.simpleTool.getName());
            }
        );
        
        this.toggleButton = createButton(
            'align-toggle-button',
            'Full Align Tool - Translation, Rotation & Scale (ESC to cancel)',
            'adsk-icon-measure-distance', // Using distance icon as it suggests alignment
            () => {
                const isActive = this.toggleButton.getState() === avu.Button.State.ACTIVE;
                const newState = isActive ? avu.Button.State.INACTIVE : avu.Button.State.ACTIVE;
                const toolAction = isActive ? 'deactivateTool' : 'activateTool';
                
                this.toggleButton.setState(newState);
                this.viewer.toolController[toolAction](this.tool.getName());
            }
        );
        
        this.resetButton = createButton(
            'align-reset-button',
            'Reset Model Transform',
            'adsk-icon-measure-reset',
            () => {
                const model = this.viewer.model;
                if (model && this.tool) {
                    // Use the tool's animation to smoothly reset
                    this.tool.animateToTransform(new THREE.Matrix4(), () => {
                        // Clear saved transform after animation
                        const urn = getModelURN(model);
                        ModelTransformStorage.remove(urn);
                        console.log('Model transform reset');
                    });
                }
            }
        );
        
        this.subToolbar = new avu.ControlGroup('AlignToolbar');
        this.subToolbar.addControl(this.simpleToggleButton);
        this.subToolbar.addControl(this.toggleButton);
        this.subToolbar.addControl(this.resetButton);
        
        this.viewer.toolbar.addControl(this.subToolbar);
    }
    
    unload() {
        // Remove event listener
        if (this._onGeometryLoaded) {
            this.viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this._onGeometryLoaded);
        }
        
        // Deactivate and unregister full align tool
        if (this.tool) {
            if (this.viewer.toolController.isToolActivated(this.tool.getName())) {
                this.viewer.toolController.deactivateTool(this.tool.getName());
            }
            this.viewer.toolController.deregisterTool(this.tool);
            this.tool = null;
        }
        
        // Deactivate and unregister simple align tool
        if (this.simpleTool) {
            if (this.viewer.toolController.isToolActivated(this.simpleTool.getName())) {
                this.viewer.toolController.deactivateTool(this.simpleTool.getName());
            }
            this.viewer.toolController.deregisterTool(this.simpleTool);
            this.simpleTool = null;
        }
        
        // Remove toolbar
        if (this.subToolbar && this.viewer.toolbar) {
            this.viewer.toolbar.removeControl(this.subToolbar);
            this.subToolbar = null;
        }
        
        return true;
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension('AlignToolExtension', AlignToolExtension);

