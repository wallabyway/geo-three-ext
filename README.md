# geo-three-ext

Add maps to your Forge Viewer 3D scene, like mapbox, bing maps, google maps, etc.  This uses [geo-three library](https://github.com/tentone/geo-three), but is hard coded for 'Planar' and 'RaycastingLOD' options, to minimize the library size.

### DEMO: https://wallabyway.github.io/geo-three-ext/

![geothree-ext](https://user-images.githubusercontent.com/440241/122155016-f92ed680-ce1a-11eb-8e92-f797e043f66e.gif)


### GETTING STARTED

Add the "GeoThreeExtension" extension to viewer, like this:

```code
viewer = new Autodesk.Viewing.Private.GuiViewer3D(div, { extensions: ["GeoThreeExtension"] });
```
and make sure to add the library, like this:

```html
<script type="text/javascript" src="./geo-three.ext.js"></script>
```

### CONFIGURATION

Set the center location of your model, by adjusting the map's position and tile starting point, like this:

```code
map.position.set(14900,-27300,-45);

class MapPlaneNode extends MapNode {
	    constructor(parentNode = null, mapView = null, location = MapNode.ROOT, level = 7, x = 20, y = 49)
      
```

> Note: To get Earth scale, you must set the level=0, and set..
```code
UnitsUtils.EARTH_RADIUS = 6378137;

// move the camera into position:
var coords = Geo.UnitsUtils.datumsToSpherical(LAT, LONG);
cam.target.set(coords.x, 0, -coords.y);
cam.position.set(0, 1000, 0);
```

This will move the Forge-Viewer camera to the (LAT, LONG) position on Earth.
> Note: You will also need to re-position the Forge Viewer's global-offset

> Also, the camera navigation is not good at navigating a map.  Consider adding THREE.MAPControl


### RELATED WORK

- Simple mapbox Tiles extension https://gist.github.com/wallabyway/4503609e84a2b612b27138abba8aa3b7
- Using Mapbox VIewer with Revit files (via glTF)  https://github.com/wallabyway/mapboxRevit
- How to retrieve Geo data inside Revit (browser): https://forge.autodesk.com/blog/mini-map-geolocation-extension
- How to decode aecModelData.json to retrieve Revit/Autocad Geo info: https://forge.autodesk.com/blog/consume-aec-data-which-are-model-derivative-api
- For Navisworks: see latest blog https://forge.autodesk.com/author/eason-kang
