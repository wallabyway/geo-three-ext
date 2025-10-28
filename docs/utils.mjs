const THREE = window.THREE;

export class FetchUtils {
    static async get(url) {
        return (await fetch(url)).text();
    }
    
    static async request(url, { method = 'GET', headers = {}, body = null } = {}) {
        const options = { method, headers };
        if (body) options.body = body;
        const text = await (await fetch(url, options)).text();
        try { return JSON.parse(text); } catch { return text; }
    }
}

export class ImageLoader {
    static loadImage(url, crossOrigin = 'Anonymous') {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = crossOrigin;
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
    }
}

export class CanvasUtils {
    static createOffscreenCanvas(width, height) {
        if (typeof OffscreenCanvas !== 'undefined') {
            return new OffscreenCanvas(width, height);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
}

export class UnitsUtils {
    static EARTH_RADIUS = 2 * 63781.37;
    static EARTH_PERIMETER = 2 * Math.PI * UnitsUtils.EARTH_RADIUS;
    static EARTH_ORIGIN = UnitsUtils.EARTH_PERIMETER / 2.0;
    
    static getCurrentPosition() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                result => resolve({ coords: result.coords, timestamp: result.timestamp }),
                reject
            );
        });
    }
    
    static datumsToSpherical(latitude, longitude) {
        const x = longitude * UnitsUtils.EARTH_ORIGIN / 180.0;
        let y = Math.log(Math.tan((90 + latitude) * Math.PI / 360.0)) / (Math.PI / 180.0);
        y = y * UnitsUtils.EARTH_ORIGIN / 180.0;
        return new THREE.Vector2(x, y);
    }
    
    static sphericalToDatums(x, y) {
        const longitude = x / UnitsUtils.EARTH_ORIGIN * 180.0;
        let latitude = y / UnitsUtils.EARTH_ORIGIN * 180.0;
        latitude = 180.0 / Math.PI * (2 * Math.atan(Math.exp(latitude * Math.PI / 180.0)) - Math.PI / 2.0);
        return { latitude, longitude };
    }
    
    static quadtreeToDatums(zoom, x, y) {
        const n = Math.pow(2.0, zoom);
        const longitude = x / n * 360.0 - 180.0;
        const latitudeRad = Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * y / n)));
        const latitude = 180.0 * (latitudeRad / Math.PI);
        return { latitude, longitude };
    }
    
    /**
     * REF: https://github.com/mapbox/tilebelt/blob/main/src/index.ts#L59
     * Get the tile for a point at a zoom level
     * @param {number} lon - Longitude
     * @param {number} lat - Latitude
     * @param {number} z - Zoom level
     * @returns {Array} [x, y, z] tile coordinates
     */
    static pointToTile(lon, lat, z) {
        const tile = UnitsUtils.pointToTileFraction(lon, lat, z);
        tile[0] = Math.floor(tile[0]);
        tile[1] = Math.floor(tile[1]);
        return tile;
    }
    
    /**
     * Get the precise fractional tile location for a point at a zoom level
     * @param {number} lon - Longitude
     * @param {number} lat - Latitude
     * @param {number} z - Zoom level
     * @returns {Array} [x, y, z] fractional tile coordinates
     */
    static pointToTileFraction(lon, lat, z) {
        const d2r = Math.PI / 180;
        const sin = Math.sin(lat * d2r);
        const z2 = Math.pow(2, z);
        let x = z2 * (lon / 360 + 0.5);
        const y = z2 * (0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI);
        
        // Wrap Tile X
        x = x % z2;
        if (x < 0) x = x + z2;
        return [x, y, z];
    }

    /**
     * Transform a terrain coordinate to latitude/longitude
     * @param {Object} point - Point with x, y, z properties (in world space)
     * @param {Object} map - The THREE.js map object for worldToLocal transformation
     * @param {Object} tileLocation - Tile location with level, x, y properties
     * @param {number} tileSizeMeters - Size of tile in meters
     * @returns {Array} [longitude, latitude]
     */
    static transformTerrainToLatLng(point, map, tileLocation, tileSizeMeters) {
        // Convert world space point to map-local space
        // This accounts for map's position, rotation (90° around X), and scale
        const worldPoint = new THREE.Vector3(point.x, point.y, point.z);
        const localPoint = map.worldToLocal(worldPoint);
        
        // After worldToLocal and 90° X rotation:
        // X = east-west, Z = north-south, Y = elevation
        // The local coordinates are in normalized space (-0.5 to 0.5 for the displayed tile)
        // So we just need to add 0.5 to get tile-relative coordinates (0 to 1)
        const relativeX = localPoint.x + 0.5;
        const relativeY = localPoint.z + 0.5;
        
        // Convert to global tile coordinates
        const globalX = tileLocation.x + relativeX;
        const globalY = tileLocation.y + relativeY;
        
        // Convert to lat/long
        const latLng = UnitsUtils.quadtreeToDatums(tileLocation.level, globalX, globalY);
        return [latLng.longitude, latLng.latitude];
    }
}

/**
 * Handles exporting polyline data to GeoJSON format
 */
export class PolylineExporter {
    constructor(viewer) {
        this.viewer = viewer;
    }
    
    /**
     * Get polyline data from localStorage
     * @returns {Object} Parsed polyline data
     * @throws {Error} If no data found
     */
    getPolylineData() {
        const data = localStorage.getItem('polyline-tool-data');
        if (!data) throw new Error('No polyline data found to export');
        return JSON.parse(data);
    }
    
    /**
     * Get geo extension context information
     * @returns {Object} Context with map, tileLocation, tileSizeMeters, tileCenterLatLng
     * @throws {Error} If GeoThree extension not available
     */
    getGeoContext() {
        const geoExt = this.viewer.getExtension('Geo.Terrain');
        if (!geoExt) throw new Error('Geo.Terrain extension not available');
        
        const map = geoExt.map;
        const tileLocation = geoExt.getTileLocation();
        const tileSizeMeters = UnitsUtils.EARTH_PERIMETER / Math.pow(2, tileLocation.level);
        const tileCenterLatLng = UnitsUtils.quadtreeToDatums(
            tileLocation.level, 
            tileLocation.x + 0.5, 
            tileLocation.y + 0.5
        );
        
        return { map, tileLocation, tileSizeMeters, tileCenterLatLng };
    }
    
    /**
     * Transform a polyline to a GeoJSON feature
     * @param {Object} polyline - Polyline with points array (world space), optionally tileLocation
     * @param {Object} currentContext - Current geo context from getGeoContext() (fallback)
     * @param {string} id - Feature ID
     * @param {boolean} isInProgress - Whether this is an in-progress polyline
     * @returns {Object|null} GeoJSON feature or null if invalid
     */
    polylineToFeature(polyline, currentContext, id, isInProgress = false) {
        if (!polyline.points || polyline.points.length < 2) return null;
        
        // Use stored tile location if available, otherwise use current context
        const tileLocation = polyline.tileLocation || currentContext.tileLocation;
        const tileSizeMeters = UnitsUtils.EARTH_PERIMETER / Math.pow(2, tileLocation.level);
        const map = currentContext.map;
        
        const coordinates = polyline.points.map(point => 
            UnitsUtils.transformTerrainToLatLng(
                point, 
                map, // Pass map object for world-to-local transformation
                tileLocation, 
                tileSizeMeters
            )
        );
        
        const properties = {
            id,
            totalDistance: polyline.totalDistance,
            pointCount: polyline.points.length
        };
        
        if (isInProgress) properties.status = 'in_progress';
        
        return {
            type: "Feature",
            geometry: { type: "LineString", coordinates },
            properties
        };
    }
    
    /**
     * Check if two polylines are identical
     * @param {Object} polyline1 
     * @param {Object} polyline2 
     * @returns {boolean} True if polylines have the same points
     */
    polylinesAreIdentical(polyline1, polyline2) {
        if (!polyline1?.points || !polyline2?.points) return false;
        if (polyline1.points.length !== polyline2.points.length) return false;
        
        return polyline1.points.every((p1, index) => {
            const p2 = polyline2.points[index];
            return p1.x === p2.x && p1.y === p2.y && p1.z === p2.z;
        });
    }
    
    /**
     * Build complete GeoJSON FeatureCollection
     * @returns {Object} GeoJSON FeatureCollection
     */
    buildGeoJSON() {
        const data = this.getPolylineData();
        const context = this.getGeoContext();
        const features = [];
        
        // Process completed polylines (deduplicate as we go)
        const processedPolylines = [];
        if (data.completedPolylines?.length) {
            data.completedPolylines.forEach((polyline, index) => {
                // Check if this polyline is a duplicate of any previously processed one
                const isDuplicate = processedPolylines.some(processed => 
                    this.polylinesAreIdentical(polyline, processed)
                );
                
                if (!isDuplicate) {
                    const feature = this.polylineToFeature(polyline, context, `polyline_${processedPolylines.length}`);
                    if (feature) {
                        features.push(feature);
                        processedPolylines.push(polyline);
                    }
                }
            });
        }
        
        // Process current polyline only if it's different from all completed ones
        // (avoid duplicates when a polyline was just completed)
        if (data.currentPolyline?.points?.length >= 2) {
            const isDuplicate = processedPolylines.some(processed => 
                this.polylinesAreIdentical(data.currentPolyline, processed)
            );
            
            if (!isDuplicate) {
                const feature = this.polylineToFeature(data.currentPolyline, context, 'current_polyline', true);
                if (feature) features.push(feature);
            }
        }
        
        // Add current location point with export metadata
        features.push({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [context.tileCenterLatLng.longitude, context.tileCenterLatLng.latitude]
            },
            properties: {
                id: "current_location",
                zoom: context.tileLocation.level,
                tileX: context.tileLocation.x,
                tileY: context.tileLocation.y,
                exportedAt: new Date().toISOString(),
                source: "Geo-Three Extension Polyline Tool"
            }
        });
        
        return {
            type: "FeatureCollection",
            features
        };
    }
    
    /**
     * Download GeoJSON to file
     * @param {Object} geojson - GeoJSON object
     * @param {string} filename - Optional custom filename
     */
    downloadGeoJSON(geojson, filename = null) {
        const dataStr = JSON.stringify(geojson, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
        const defaultName = filename || `polylines_${new Date().toISOString().slice(0, 10)}.geojson`;
        
        const link = document.createElement('a');
        link.setAttribute('href', dataUri);
        link.setAttribute('download', defaultName);
        link.click();
    }
    
    /**
     * Main export method
     * @returns {Object} Result with success status and featureCount or error
     */
    export() {
        try {
            const geojson = this.buildGeoJSON();
            this.downloadGeoJSON(geojson);
            return { success: true, featureCount: geojson.features.length };
        } catch (error) {
            console.error('Export failed:', error);
            return { success: false, error: error.message };
        }
    }
}