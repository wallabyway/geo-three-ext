# BIM Model Alignment Tool

## Overview
A visual alignment tool for positioning BIM models on terrain. The tool allows users to align a 3D model (like a building) to terrain by selecting corresponding points on both the model and the terrain, then smoothly animating the model into the correct position, rotation, and scale.

## Use Case
When a BIM model is loaded into the scene on top of terrain, it's typically not positioned correctly. This tool provides an intuitive way to align it by:
1. Selecting reference points on the model
2. Selecting corresponding points on the terrain
3. Automatically calculating and applying the correct transformation

## Implementation Phases

### Phase 1: Single Point Alignment (Translation Only) ✅ IMPLEMENTED
**Goal**: Move the model to align one point

**Status**: Complete - Ready for testing

**Workflow**:
1. User activates the alignment tool
2. User clicks on a corner/point on the 3D BIM model (e.g., building corner)
3. User clicks on the corresponding point on the terrain
4. Tool draws a visual line between the two points
5. Tool calculates the translation needed to move model point to terrain point
6. Smooth ease-in-out animation moves the model into place

**Visual Feedback**:
- Line drawn between source and target points
- Line updates dynamically as user moves mouse (before confirming second point)
- Line color indicates state (picking, valid, animating)

### Phase 2: Two Point Alignment (Translation + Rotation + Scale) ✅ IMPLEMENTED
**Goal**: Fully align the model using two reference points

**Status**: Complete - Ready for testing

**Workflow**:
1. After Phase 1 is complete (or as part of extended workflow):
2. User selects a second point on the building wall
3. User selects the corresponding second point on the terrain
4. Tool draws a second line between these points
5. Tool calculates full TRS (Translation, Rotation, Scale) transformation:
   - **Translation**: Moves first point to match
   - **Rotation**: Rotates model so the line between points aligns
   - **Scale**: Optional - scales model so distances match (may not always be desired)
6. Smooth ease-in-out animation applies the full transformation

**Mathematical Approach**:
- Calculate vector from point 1 to point 2 on the model
- Calculate vector from point 1 to point 2 on the terrain
- Compute rotation needed to align these vectors
- Compute scale factor (ratio of vector lengths) if scaling is enabled
- Apply transformation in correct order: Scale → Rotate → Translate

## Technical Implementation Details

### Coordinate Systems
- **Terrain**: The map object positioned at `map.position.set(14900, -27300, -85)` in geo-three.ext.js
- **BIM Model**: Loaded separately with its own transform
- **Approach**: Reposition the BIM model (not the terrain) using placement transform

### Model Transformation
Based on `blog-adam-placement.html` example:
```javascript
// Get current placement transform
let tr = model.getPlacementTransform();

// Modify transform matrix elements (4x4 matrix in column-major order)
// elements[12], [13], [14] are translation (x, y, z)
tr.elements[12] = newX;
tr.elements[13] = newY;
tr.elements[14] = newZ;

// Apply transform
model.setPlacementTransform(tr);
viewer.impl.invalidate(true, true, true);
```

### Animation Strategy
- Use requestAnimationFrame or GSAP/tween library for smooth animations
- Ease-in-out timing function (cubic or quartic easing)
- Duration: ~1-2 seconds for good UX
- Interpolate matrix values during animation
- Continuously call `viewer.impl.invalidate()` during animation

### Point Selection
- Use raycaster for picking points:
  - On BIM model: Use `viewer.impl.hitTest()` with model filter
  - On terrain: Use raycaster against map object (similar to existing double-click implementation)
- Store selected points in world coordinates

### Visual Line Drawing
- Use THREE.Line or viewer.overlays to draw lines
- Update line geometry dynamically as user moves mouse
- Draw in overlay scene for consistent visibility
- Clean up lines after transformation is complete or tool is cancelled

## UI/UX Considerations

### Tool Activation
- Button in toolbar or keyboard shortcut
- Clear instructions/prompts for each step
- Cursor changes to indicate current mode

### User Feedback
- Status text showing current step: "Select first point on model", "Select point on terrain", etc.
- Visual highlighting of selected points
- Preview of transformation before applying (optional)
- Undo/reset functionality

### Tool States
1. **Inactive**: Tool not selected
2. **PickingModelPoint1**: Waiting for first model point
3. **PickingTerrainPoint1**: Waiting for first terrain point
4. **Animating1**: Animation in progress
5. **PickingModelPoint2**: Waiting for second model point (Phase 2)
6. **PickingTerrainPoint2**: Waiting for second terrain point (Phase 2)
7. **Animating2**: Final transformation animation in progress

### Controls
- **Left Click**: Select point
- **Escape**: Cancel tool / reset state
- **Enter**: Confirm and apply (if using preview mode)
- **Right Click**: Go back one step

## File Structure

### New Files
- `docs/align-tool.js` - Main alignment tool implementation
- `docs/align-tool.css` - Styling for tool UI elements

### Modified Files
- `docs/index.html` - Include new align tool script
- `docs/geo-three.ext.js` - Integration with extension (if needed)

## Dependencies
- THREE.js (already available via Viewer)
- Autodesk Viewer API
- Raycaster (for point picking)
- Animation library (built-in or simple custom implementation)

## Future Enhancements
- Support for 3+ point alignment for more complex scenarios
- Ground plane snapping
- Height offset control
- Save/load alignment presets
- Visual preview before applying transformation
- Support for multiple models
- Alignment to reference lines/planes instead of just points

## Testing Checklist
- [ ] Point selection works on both model and terrain
- [ ] Line visualization renders correctly
- [ ] Translation animation is smooth
- [ ] Two-point alignment calculates correct rotation
- [ ] Scale calculation works when enabled
- [ ] Tool properly cleans up on unload
- [ ] Works with different model types (Revit, DWG, etc.)
- [ ] Doesn't interfere with other tools
- [ ] Edge cases: clicking empty space, clicking same point twice, etc.

## References
- `ref/blog-adam-placement.html` - Model placement example
- `docs/geo-three.ext.js` - Terrain map implementation
- Autodesk Viewer API - Model transform methods
- [APS Blog - Vertical Explode](https://aps.autodesk.com/blog/view-each-floor-using-vertical-explode) - Animation code reference

## Implementation Summary (Phase 1)

### Files Created
1. **`docs/align-tool.mjs`** - Main alignment tool implementation
   - AlignTool class extending Autodesk.Viewing.ToolInterface
   - Point picking on both model and terrain
   - Visual line and marker drawing (blue color matching polyline tool)
   - Smooth ease-in-out animation (2 seconds)
   - Transform persistence to localStorage
   - ESC key to cancel

2. **`docs/align-ext.mjs`** - Extension wrapper
   - AlignToolExtension class
   - Toolbar integration with toggle and reset buttons
   - Auto-loads saved transforms when model loads
   - Manages tool lifecycle

### Files Modified
1. **`docs/index.html`**
   - Import align-ext.mjs
   - Add 'AlignToolExtension' to extensions list

### How to Use
1. Load the viewer with a BIM model and terrain
2. Click the alignment tool button in the toolbar (distance icon)
3. Click on a point on the BIM model
4. Click on the corresponding point on the terrain
5. Watch the model smoothly animate into position
6. Transform is automatically saved to localStorage
7. Press ESC to cancel at any time
8. Use Reset button to clear transform and return to original position

### Features Implemented (Phase 1 + Phase 2)
- ✅ Point picking with raycasting on model and terrain
- ✅ Visual feedback: blue lines and circle markers
- ✅ Preview line during point selection (rubber band effect)
- ✅ Smooth ease-in-out animation (2 seconds)
- ✅ Transform calculation using THREE.Matrix4
- ✅ Persistence to localStorage with model URN
- ✅ Auto-restore transform on model load
- ✅ ESC key to cancel
- ✅ Reset button to clear transform
- ✅ Status messages showing current step (4 steps total)
- ✅ Screen-space consistent marker and line sizes
- ✅ Integration with existing GeoThreeExtension (tile location anchor)
- ✅ **Two-point alignment with full TRS transformation**
- ✅ **Second line drawing for rotation reference**
- ✅ **Vector alignment using quaternion rotation**
- ✅ **Scale calculation from vector length ratios**
- ✅ **Rotation pivot around first terrain point**

### Phase 2 Technical Details
**Two-Point Alignment Algorithm**:
1. Calculate model vector: `v_model = modelPoint2 - modelPoint1`
2. Calculate terrain vector: `v_terrain = terrainPoint2 - terrainPoint1`
3. **Project both vectors to XY plane** (set z=0) for planar rotation only
4. Calculate rotation angle: `angle = atan2(v_terrain.y, v_terrain.x) - atan2(v_model.y, v_model.x)`
5. Create rotation quaternion **around Z-axis only**: `q = setFromAxisAngle(Z_AXIS, angle)`
6. Calculate scale factor: `s = |v_terrain| / |v_model|`
7. Apply transformation accounting for click point offset:
   - Calculate where modelPoint1 will be after rotation around model origin
   - Scale that offset by scale factor
   - Position model so rotated modelPoint1 ends up at terrainPoint1
   - Rotation: Z-axis only (no flipping!)
   - Scale: Apply scale factor to match distances
8. Smooth interpolation of position, rotation (slerp), and scale

**Key Improvements**:
- ✅ **Planar rotation only**: Building spins on ground, never flips upside down
- ✅ **Proper point alignment**: Accounts for model origin offset from clicked points
- ✅ **Accurate pivot**: Rotation happens such that clicked points align exactly

### Next Steps (Phase 3)
- ⬜ Optional: Disable scale if not desired (add toggle)
- ⬜ Optional: Save transforms to localStorage (skipped for now per user request)
- ⬜ Optional: Support for multiple models with JSON array of URNs + TRS
- ⬜ Optional: Lat/long anchor persistence

