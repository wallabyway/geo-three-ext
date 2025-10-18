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
}

