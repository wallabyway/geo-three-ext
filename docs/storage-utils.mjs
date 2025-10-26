/**
 * LocalStorage utility class for managing persistent data across geo extensions
 * Provides safe, typed access to localStorage with error handling
 */
export class StorageManager {
    /**
     * Storage keys used across the application
     */
    static KEYS = {
        MAP_LOCATION: 'map-location-dialog',
        POLYLINE_DATA: 'polyline-tool-data',
        MODEL_TRANSFORMS: 'align-tool-transforms'
    };
    
    /**
     * Safely get an item from localStorage
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if key doesn't exist or parsing fails
     * @returns {*} Parsed value or default
     */
    static get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            if (item === null) return defaultValue;
            return JSON.parse(item);
        } catch (error) {
            console.warn(`StorageManager: Failed to get '${key}':`, error);
            return defaultValue;
        }
    }
    
    /**
     * Safely set an item in localStorage
     * @param {string} key - Storage key
     * @param {*} value - Value to store (will be JSON.stringify'd)
     * @returns {boolean} Success status
     */
    static set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error(`StorageManager: Failed to set '${key}':`, error);
            return false;
        }
    }
    
    /**
     * Remove an item from localStorage
     * @param {string} key - Storage key
     * @returns {boolean} Success status
     */
    static remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error(`StorageManager: Failed to remove '${key}':`, error);
            return false;
        }
    }
    
    /**
     * Check if a key exists in localStorage
     * @param {string} key - Storage key
     * @returns {boolean} True if key exists
     */
    static has(key) {
        return localStorage.getItem(key) !== null;
    }
    
    /**
     * Clear all storage (use with caution!)
     */
    static clear() {
        try {
            localStorage.clear();
            return true;
        } catch (error) {
            console.error('StorageManager: Failed to clear storage:', error);
            return false;
        }
    }
}

/**
 * Map location storage helper
 */
export class MapLocationStorage {
    /**
     * Get saved map location (lat, lon, zoom)
     * @returns {{lat: number, lon: number, zoom: number} | null}
     */
    static get() {
        return StorageManager.get(StorageManager.KEYS.MAP_LOCATION);
    }
    
    /**
     * Save map location
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @param {number} zoom - Zoom level
     * @returns {boolean} Success status
     */
    static set(lat, lon, zoom) {
        return StorageManager.set(StorageManager.KEYS.MAP_LOCATION, { lat, lon, zoom });
    }
    
    /**
     * Get default location or saved location
     * @param {number} defaultLat - Default latitude
     * @param {number} defaultLon - Default longitude
     * @param {number} defaultZoom - Default zoom
     * @returns {{lat: number, lon: number, zoom: number}}
     */
    static getOrDefault(defaultLat = 37.8, defaultLon = -122.4, defaultZoom = 7) {
        const saved = this.get();
        return saved || { lat: defaultLat, lon: defaultLon, zoom: defaultZoom };
    }
}

/**
 * Polyline data storage helper
 */
export class PolylineStorage {
    /**
     * Get polyline data
     * @returns {{currentPolyline: Object, completedPolylines: Array} | null}
     */
    static get() {
        return StorageManager.get(StorageManager.KEYS.POLYLINE_DATA);
    }
    
    /**
     * Save polyline data
     * @param {Object} currentPolyline - Current polyline in progress
     * @param {Array} completedPolylines - Array of completed polylines
     * @returns {boolean} Success status
     */
    static set(currentPolyline, completedPolylines) {
        return StorageManager.set(StorageManager.KEYS.POLYLINE_DATA, {
            currentPolyline,
            completedPolylines
        });
    }
    
    /**
     * Clear all polyline data
     * @returns {boolean} Success status
     */
    static clear() {
        return StorageManager.remove(StorageManager.KEYS.POLYLINE_DATA);
    }
}

/**
 * Model transform storage helper
 */
export class ModelTransformStorage {
    /**
     * Get all model transforms
     * @returns {Object} Dictionary of URN -> transform data
     */
    static getAll() {
        return StorageManager.get(StorageManager.KEYS.MODEL_TRANSFORMS, {});
    }
    
    /**
     * Get transform for a specific model URN
     * @param {string} urn - Model URN
     * @returns {Object | null} Transform data or null
     */
    static get(urn) {
        const transforms = this.getAll();
        return transforms[urn] || null;
    }
    
    /**
     * Save transform for a specific model
     * @param {string} urn - Model URN
     * @param {Object} transformData - Transform data {position, rotation, scale, tileLocation, timestamp}
     * @returns {boolean} Success status
     */
    static set(urn, transformData) {
        const transforms = this.getAll();
        transforms[urn] = {
            ...transformData,
            timestamp: Date.now()
        };
        return StorageManager.set(StorageManager.KEYS.MODEL_TRANSFORMS, transforms);
    }
    
    /**
     * Remove transform for a specific model
     * @param {string} urn - Model URN
     * @returns {boolean} Success status
     */
    static remove(urn) {
        const transforms = this.getAll();
        delete transforms[urn];
        return StorageManager.set(StorageManager.KEYS.MODEL_TRANSFORMS, transforms);
    }
    
    /**
     * Clear all model transforms
     * @returns {boolean} Success status
     */
    static clear() {
        return StorageManager.remove(StorageManager.KEYS.MODEL_TRANSFORMS);
    }
    
    /**
     * Convert stored transform data to THREE.Matrix4
     * @param {Object} transformData - Stored transform data
     * @returns {THREE.Matrix4} Composed matrix
     */
    static toMatrix4(transformData) {
        if (!transformData) return new THREE.Matrix4();
        
        const pos = new THREE.Vector3(
            transformData.position.x,
            transformData.position.y,
            transformData.position.z
        );
        const quat = new THREE.Quaternion(
            transformData.rotation.x,
            transformData.rotation.y,
            transformData.rotation.z,
            transformData.rotation.w
        );
        const scale = new THREE.Vector3(
            transformData.scale.x,
            transformData.scale.y,
            transformData.scale.z
        );
        
        const matrix = new THREE.Matrix4();
        matrix.compose(pos, quat, scale);
        return matrix;
    }
    
    /**
     * Convert THREE.Matrix4 to storable data
     * @param {THREE.Matrix4} matrix - Transform matrix
     * @param {Object} tileLocation - Optional tile location data
     * @returns {Object} Storable transform data
     */
    static fromMatrix4(matrix, tileLocation = null) {
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(pos, quat, scale);
        
        return {
            position: { x: pos.x, y: pos.y, z: pos.z },
            rotation: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
            scale: { x: scale.x, y: scale.y, z: scale.z },
            tileLocation: tileLocation,
            timestamp: Date.now()
        };
    }
}

/**
 * Helper to get model URN from Viewer model
 * @param {Object} model - Viewer model object
 * @returns {string} Model URN or 'default-model'
 */
export function getModelURN(model) {
    if (!model) return 'default-model';
    const modelData = model.getData();
    return modelData?.urn || 'default-model';
}

