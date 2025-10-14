# geo-three-ext

UPDATE: Now with Terrain:

https://github.com/user-attachments/assets/9488c2ba-544a-4218-95fc-421350ba24e7

Add maps to your Forge Viewer 3D scene, like ESRI ArcGIS, Mapbox, Bing Maps, Google Maps, and more. Expert-level refactored with ES6 modules, modern async/await patterns, and optimized LOD system. **Now defaults to ESRI basemaps (no API key required!)**


Inspired by the [geo-three library](https://github.com/tentone/geo-three), optimized for 'Planar' and 'HEIGHT' modes with dynamic level-of-detail.

### 🎯 DEMO: https://wallabyway.github.io/geo-three-ext/

![geothree-ext](https://user-images.githubusercontent.com/440241/122155016-f92ed680-ce1a-11eb-8e92-f797e043f66e.gif)


## 📦 Module Structure

```
docs/
├── geo-three.ext.js    # Main extension entry point
├── loader.mjs          # Tile providers & async loading
├── core.mjs            # Map nodes, geometries & utilities
└── render.mjs          # LOD system & rendering
```

## 🚀 GETTING STARTED

### 1. Add as ES6 Module

```html
<!-- Load Forge Viewer -->
<script src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.js"></script>

<!-- Load extension as ES6 module -->
<script type="module">
import './geo-three.ext.js';

// Extension automatically registers with Forge Viewer
const viewer = new Autodesk.Viewing.Private.GuiViewer3D(div, { 
    extensions: ["GeoThreeExtension"] 
});
</script>
```

### 2. Or Import Directly

```javascript
import { MapView, ESRIMapsProvider } from './geo-three.ext.js';

// Create provider (no API key required!)
const provider = new ESRIMapsProvider(ESRIMapsProvider.IMAGERY);

// Create 3D map
const map = new MapView(MapView.PLANAR, provider);
map.position.set(14900, -27300, -85);

// Or with MapBox for terrain height data
import { MapBoxProvider } from './geo-three.ext.js';
const heightProvider = new MapBoxProvider(token, 'mapbox.terrain-rgb', MapBoxProvider.STYLE);
const terrainMap = new MapView(MapView.HEIGHT, provider, heightProvider);
```

## ⚙️ CONFIGURATION

### Position Your Map

Adjust the map's position to align with your model:

```javascript
map.position.set(14900, -27300, -85);
```

### Change Starting Location

Modify the root node coordinates (in `core.mjs`):

```javascript
// San Francisco: level = 7, x = 20, y = 49
new MapHeightNode(null, this, MapNode.ROOT, level = 7, x = 20, y = 49);
```

### Earth Scale Mode

For true Earth scale rendering:

```javascript
import { UnitsUtils } from './core.mjs';

// Set Earth radius
UnitsUtils.EARTH_RADIUS = 6378137;

// Position camera at specific lat/long
const coords = UnitsUtils.datumsToSpherical(40.7128, -74.0060); // NYC
camera.target.set(coords.x, 0, -coords.y);
camera.position.set(0, 1000, 0);
```

### LOD Update Frequency & Thresholds

The extension uses interval-based raycasting for continuous LOD updates, independent of camera movement.

**Update Frequency** (in `geo-three.ext.js`):
```javascript
this.updateFrequency = 50; // Update every 50ms (default) - faster for responsive LOD
```

**LOD Thresholds** (in `render.mjs`):
```javascript
thresholdUp = 0.6      // Distance threshold to subdivide (zoom in)
thresholdDown = 0.4    // Distance threshold to simplify (zoom out)
```

Higher `thresholdDown` values make tiles disappear faster when zooming out. Lower values keep detail longer but may impact performance.

### Triangle Edge Outlines

To visualize the triangle mesh structure, you can enable edge outlines in `core.mjs`:

```javascript
import { MapPlaneNode } from './core.mjs';

// Enable triangle edge outlines globally
MapPlaneNode.SHOW_EDGES = true;
```

Or in your extension's `load()` method:

```javascript
load() {
    // Enable edges before creating the map
    MapPlaneNode.SHOW_EDGES = true;
    
    const provider = new ESRIMapsProvider(ESRIMapsProvider.IMAGERY);
    this.map = new MapView(MapView.HEIGHT, provider, heightProvider);
    // ...
}
```

This will add black semi-transparent edge lines to all tile quads, making the mesh subdivision visible. The edge rendering automatically detects and uses the correct THREE.js API version (both older `addAttribute` and newer `setAttribute` are supported).

## 🎨 Available Providers

```javascript
import { 
    ESRIMapsProvider,
    MapBoxProvider,
    BingMapsProvider,
    GoogleMapsProvider,
    HereMapsProvider,
    OpenStreetMapsProvider,
    MapTilerProvider
} from './loader.mjs';

// Mapbox
const provider = new MapBoxProvider(token, 'mapbox/satellite-v9', MapBoxProvider.STYLE);

// Bing Maps
const provider = new BingMapsProvider(apiKey, BingMapsProvider.AERIAL);

// Google Maps
const provider = new GoogleMapsProvider(apiKey);

// OpenStreetMap (no key needed)
const provider = new OpenStreetMapsProvider();

// ESRI ArcGIS Online (no key needed)
const provider = new ESRIMapsProvider(ESRIMapsProvider.IMAGERY);
```

### ESRI Basemap Types

ESRI provides multiple free basemap options:

```javascript
import { ESRIMapsProvider, MapView } from './geo-three.ext.js';

// Available basemap types
ESRIMapsProvider.IMAGERY          // Satellite imagery
ESRIMapsProvider.TOPO             // Topographic map
ESRIMapsProvider.STREETS          // Street map
ESRIMapsProvider.GRAY_CANVAS      // Light gray canvas
ESRIMapsProvider.OCEANS           // Ocean basemap
ESRIMapsProvider.NATIONAL_GEOGRAPHIC  // National Geographic style
ESRIMapsProvider.TERRAIN          // Terrain with labels
ESRIMapsProvider.SHADED_RELIEF    // Shaded relief

// Create provider with imagery
const provider = new ESRIMapsProvider(ESRIMapsProvider.IMAGERY);
const map = new MapView(MapView.PLANAR, provider);

// Switch basemap type dynamically
function setBasemap(type) {
    provider.setMapType(type);
    map.clear(); // Reload tiles with new basemap
}

// Usage
setBasemap(ESRIMapsProvider.TOPO);
```

## 🏗️ Architecture

### Expert-Level Patterns

- **Async/Await**: All tile loading uses clean async/await
- **Functional Programming**: Array methods, pure functions where possible
- **Modular Design**: Each module has a single responsibility
- **ES6+**: Template literals, destructuring, arrow functions, optional chaining

### Module Responsibilities

- **`loader.mjs`** - Async tile fetching, image loading, all map providers
- **`core.mjs`** - Quadtree nodes, terrain geometry, coordinate utilities
- **`render.mjs`** - LOD raycasting system, MapView container

### Performance Features

- **Interval-based LOD** - Reliable 100ms update cycle with continuous raycasting (no camera event dependencies)
- **Material transparency** - Parent tiles fade when children load (no z-fighting)
- **Geometry caching** - Reuse geometries when simplifying
- **Efficient raycasting** - Only raycast visible mesh nodes

## 📚 RELATED RESOURCES

### Forge + Maps Integration
- [Simple Mapbox Tiles Extension](https://gist.github.com/wallabyway/4503609e84a2b612b27138abba8aa3b7) - Minimal example
- [Mapbox + Revit via glTF](https://github.com/wallabyway/mapboxRevit) - Using Mapbox Viewer
- [Mini-Map Geolocation Extension](https://forge.autodesk.com/blog/mini-map-geolocation-extension) - Retrieve geo data in browser
- [Decode AEC Model Data](https://forge.autodesk.com/blog/consume-aec-data-which-are-model-derivative-api) - Extract Revit/AutoCAD geo info
- [Navisworks Integration](https://forge.autodesk.com/author/eason-kang) - Latest techniques

### Original Library
- [geo-three](https://github.com/tentone/geo-three) - Original THREE.js geo-spatial library

## 🎓 Code Quality

This project demonstrates expert-level JavaScript:
- ✅ Zero callbacks - pure async/await
- ✅ Functional patterns throughout
- ✅ Self-documenting code
- ✅ Proper separation of concerns
- ✅ Modern ES6+ features
- ✅ Ready for TypeScript conversion

## 📝 Notes

- **THREE.js**: Uses Forge Viewer's bundled THREE.js (`window.THREE`), compatible with R71+
- **Forge Viewer Version**: Tested with Viewer v7.x
- **Browser Support**: Modern browsers with ES6 module support
- **Performance**: Interval-based LOD ensures smooth subdivision regardless of camera events
- **Edge Rendering**: Automatically adapts to different THREE.js API versions

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details

---

**Refactored with ❤️ using expert-level ES6 patterns**
