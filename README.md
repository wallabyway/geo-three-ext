# geo-three-ext: Add maps to your APS Viewer

Add interactive terrain maps and BIM alignment tools to Autodesk APS Viewer. Features terrain height mapping, polyline measurements, model alignment, and GeoJSON export. Built with expert-level ES6 patterns and optimized LOD system. **No API key required** - defaults to ESRI basemaps!

## ✨ New Features
- 🔧 **BIM Model Alignment** - Quick Move and Full Align tools
- 📏 **Terrain Measurement Tool** - Multi-point polyline distances
- 📤 **Export to GeoJSON** - Download measurements with coordinates
- 🗺️ **Lat/Long Navigation** - Jump to any location with presets
- 🖱️ **Double-click zoom** - Focus on terrain points
- 🔍 **Wheel-mouse zoom** - Set pivot on terrain for natural navigation

**Video Demo:**

<a href="https://public-blogs.s3.us-west-2.amazonaws.com/geo-three-w-geojson.mp4"><img width="640px" src="https://github.com/user-attachments/assets/4d8e889e-c01d-4d21-9818-df83909ab21d"></img></a>

Inspired by the [geo-three library](https://github.com/tentone/geo-three), optimized for 'Planar' and 'HEIGHT' modes with dynamic level-of-detail.

### 🎯 DEMO: https://wallabyway.github.io/geo-three-ext/

https://github.com/user-attachments/assets/9488c2ba-544a-4218-95fc-421350ba24e7

![geothree-ext](https://user-images.githubusercontent.com/440241/122155016-f92ed680-ce1a-11eb-8e92-f797e043f66e.gif)

## 🎨 Features

### Geo.Terrain Extension
- **Height-mapped terrain** with real elevation data (via MapBox terrain-rgb)
- **Multiple map providers**: ESRI (no key!), MapBox, Bing, Google, OpenStreetMap
- **Dynamic LOD system** with interval-based raycasting for smooth tile loading
- **Configurable basemaps**: Imagery, Topo, Streets, Oceans, and more

### Geo.Tools Extension - Interactive Toolbar

**Tool Modes** (mutually exclusive, radio button behavior):
- 🟠 **Quick Move** - Fast 2-step translation (model point → terrain point)
- 🔵 **Full Align** - Precise 4-step alignment with rotation & scale (2 model + 2 terrain points)
- 📏 **Tape Measure** - Multi-point polyline distance measurement with GeoJSON export
- 🌍 **Set Location** - Configure map tile location (lat/lon/zoom with presets)

**Action Buttons** (contextual, shown only when relevant):
- 🗑️ **Clear** - Remove all polylines (shown when Tape Measure active)
- 🔄 **Reset** - Animate model back to original position (shown when alignment tools active)
- 📤 **Export GeoJSON** - Download polylines as GeoJSON with coordinates (shown when Tape Measure active)

**Smart UX**: Default shows only 4 mode buttons. Action buttons appear contextually to minimize screen clutter.

## 📦 Module Structure

```
docs/
├── geo-three.ext.js    # Geo.Terrain - Map rendering with LOD system
├── geo.tools.mjs       # Geo.Tools - Alignment & measurement tools + toolbar
├── storage-utils.mjs   # localStorage helpers (transforms, polylines, locations)
├── utils.mjs           # Utilities (FetchUtils, ImageLoader, CanvasUtils, UnitsUtils)
├── providers.mjs       # Tile providers & async loading
└── render.mjs          # MapView, nodes, geometries, LOD raycasting
```

## 🚀 Quick Start

```html
<!-- Load Forge Viewer -->
<script src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.js"></script>

<!-- Load extensions -->
<script type="module">
import './docs/geo-three.ext.js';
import './docs/geo.tools.mjs';

const viewer = new Autodesk.Viewing.GuiViewer3D(container, {
    extensions: ['Geo.Terrain', 'Geo.Tools']
});
</script>
```

**That's it!** The toolbar appears automatically with all tools ready to use.

### Usage

**Quick Move Tool** (Fast positioning):
1. Click 🟠 Quick Move button
2. Click point on BIM model
3. Click target point on terrain → Model moves smoothly

**Full Align Tool** (Precise alignment):
1. Click 🔵 Full Align button
2. Click first point on model → Click corresponding terrain point
3. Click second point on model → Click corresponding terrain point
4. Model rotates, scales, and aligns automatically (saved to localStorage)

**Tape Measure Tool** (Distance measurement):
1. Click 📏 Tape Measure button
2. Click points on terrain to measure distances
3. Press ESC to finish
4. Use 📤 Export to save as GeoJSON

**Set Location** (Configure map):
1. Click 🌍 Set Location button
2. Choose preset (NYC, SF, Munich, etc.) or enter custom lat/lon/zoom
3. Map tiles reload at new location

## ⚙️ Configuration

### Map Position
```javascript
// Adjust map position to align with your model (in geo-three.ext.js)
map.position.set(14900, -27300, -85);
```

### Starting Location
Use the 🌍 Set Location tool in the UI, or modify in `render.mjs`:
```javascript
// San Francisco: level = 7, x = 20, y = 49
new MapHeightNode(null, this, MapNode.ROOT, level = 7, x = 20, y = 49);
```

### LOD Tuning
```javascript
// Update frequency (geo-three.ext.js)
this.updateFrequency = 50; // ms between LOD updates (default: 50)

// Thresholds (render.mjs)
thresholdUp = 0.6      // Subdivide when closer
thresholdDown = 0.4    // Simplify when farther
```

### Debug: Show Triangle Edges
```javascript
import { MapPlaneNode } from './render.mjs';
MapPlaneNode.SHOW_EDGES = true; // Shows tile mesh structure
```

## 🗺️ Map Providers

```javascript
import { ESRIMapsProvider, MapBoxProvider, BingMapsProvider, 
         GoogleMapsProvider, OpenStreetMapsProvider } from './providers.mjs';

// ESRI (no API key required) - Default
const provider = new ESRIMapsProvider(ESRIMapsProvider.IMAGERY);
// Types: IMAGERY, TOPO, STREETS, GRAY_CANVAS, OCEANS, TERRAIN, SHADED_RELIEF

// MapBox (token required for terrain height)
const provider = new MapBoxProvider(token, 'mapbox/satellite-v9', MapBoxProvider.STYLE);

// Others (API key required)
const provider = new BingMapsProvider(apiKey, BingMapsProvider.AERIAL);
const provider = new GoogleMapsProvider(apiKey);

// OpenStreetMap (no key needed)
const provider = new OpenStreetMapsProvider();
```

## 🏗️ Architecture

**Geo.Terrain** (`geo-three.ext.js`, `render.mjs`, `providers.mjs`, `utils.mjs`):
- Quadtree LOD system with interval-based raycasting (50ms updates)
- Material transparency for smooth parent→child transitions
- Geometry caching for efficient simplification
- Async/await tile loading, functional patterns

**Geo.Tools** (`geo.tools.mjs`, `storage-utils.mjs`):
- BaseGeoTool class eliminates code duplication across tools
- Unified toolbar manager with radio button behavior
- Contextual action buttons (show/hide based on mode)
- localStorage persistence for transforms, polylines, locations
- Screen-space consistent visual elements (markers, lines, labels)

**Code Quality**:
- ✅ Expert-level ES6+ patterns throughout
- ✅ Zero callbacks - pure async/await
- ✅ Functional programming, self-documenting code
- ✅ Proper separation of concerns
- ✅ Modular, extensible architecture

## 📚 Resources

- [geo-three](https://github.com/tentone/geo-three) - Original THREE.js geo-spatial library
- [Simple Mapbox Tiles Extension](https://gist.github.com/wallabyway/4503609e84a2b612b27138abba8aa3b7) - Minimal example
- [Mini-Map Geolocation Extension](https://forge.autodesk.com/blog/mini-map-geolocation-extension)
- [Decode AEC Model Data](https://forge.autodesk.com/blog/consume-aec-data-which-are-model-derivative-api)

## 📝 Technical Notes

- Uses APS Viewer's bundled THREE.js (R71+), tested with Viewer v7.x
- Requires modern browsers with ES6 module support
- Low CPU during camera idle
- Tools automatically save state to localStorage with model URN

## 📄 License

MIT License - See [LICENSE](LICENSE) file

---

Built with ❤️ using expert-level ES6 patterns | Inspired by [geo-three](https://github.com/tentone/geo-three)
