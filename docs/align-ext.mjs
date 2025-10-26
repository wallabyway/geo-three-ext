import { AlignTool } from './align-tool.mjs';

export class AlignToolExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this.tool = null;
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
        
        // Create and register the align tool
        this.tool = new AlignTool(this.viewer, this.snapper);
        this.viewer.toolController.registerTool(this.tool);
        
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
        
        this.toggleButton = createButton(
            'align-toggle-button',
            'Align Model to Terrain (ESC to cancel)',
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
                if (model) {
                    // Reset to identity transform
                    model.setPlacementTransform(new THREE.Matrix4());
                    this.viewer.impl.invalidate(true, true, true);
                    
                    // Clear saved transform
                    const modelData = model.getData();
                    const urn = modelData?.urn || 'default-model';
                    
                    try {
                        const stored = localStorage.getItem(this.tool.storageKey);
                        if (stored) {
                            const transforms = JSON.parse(stored);
                            delete transforms[urn];
                            localStorage.setItem(this.tool.storageKey, JSON.stringify(transforms));
                        }
                    } catch (error) {
                        console.error('Failed to clear transform:', error);
                    }
                    
                    console.log('Model transform reset');
                }
            }
        );
        
        this.subToolbar = new avu.ControlGroup('AlignToolbar');
        this.subToolbar.addControl(this.toggleButton);
        this.subToolbar.addControl(this.resetButton);
        
        this.viewer.toolbar.addControl(this.subToolbar);
    }
    
    unload() {
        // Remove event listener
        if (this._onGeometryLoaded) {
            this.viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this._onGeometryLoaded);
        }
        
        // Deactivate and unregister tool
        if (this.tool) {
            if (this.viewer.toolController.isToolActivated(this.tool.getName())) {
                this.viewer.toolController.deactivateTool(this.tool.getName());
            }
            this.viewer.toolController.deregisterTool(this.tool);
            this.tool = null;
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

