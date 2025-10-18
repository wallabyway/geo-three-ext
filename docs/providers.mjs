import { FetchUtils, ImageLoader } from './utils.mjs';

export class MapProvider {
    constructor() {
        this.name = '';
        this.minZoom = 0;
        this.maxZoom = 20;
        this.bounds = [];
        this.center = [];
    }
    async fetchTile(zoom, x, y) {}
    async getMetaData() {}
}

export class ESRIMapsProvider extends MapProvider {
    static IMAGERY = 'imagery';
    static TOPO = 'topo';
    static STREETS = 'streets';
    static GRAY_CANVAS = 'gray';
    static OCEANS = 'oceans';
    static NATIONAL_GEOGRAPHIC = 'natgeo';
    static TERRAIN = 'terrain';
    static SHADED_RELIEF = 'shaded_relief';
    
    static BASEMAPS = {
        imagery: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        streets: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        gray: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        oceans: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
        natgeo: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
        terrain: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
        shaded_relief: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}'
    };
    
    constructor(mapType = ESRIMapsProvider.IMAGERY) {
        super();
        this.mapType = mapType;
        this.maxZoom = 19;
    }
    
    setMapType(mapType) {
        if (ESRIMapsProvider.BASEMAPS[mapType]) {
            this.mapType = mapType;
        }
    }
    
    async fetchTile(zoom, x, y) {
        const url = ESRIMapsProvider.BASEMAPS[this.mapType]
            .replace('{z}', zoom)
            .replace('{y}', y)
            .replace('{x}', x);
        return ImageLoader.loadImage(url);
    }
}

export class OpenStreetMapsProvider extends MapProvider {
    constructor(address = 'https://a.tile.openstreetmap.org/') {
        super();
        this.address = address;
        this.format = 'png';
    }
    async fetchTile(zoom, x, y) {
        return ImageLoader.loadImage(`${this.address}/${zoom}/${x}/${y}.${this.format}`);
    }
}

export class BingMapsProvider extends MapProvider {
    static AERIAL = 'a';
    static ROAD = 'r';
    static AERIAL_LABELS = 'h';
    static OBLIQUE = 'o';
    static OBLIQUE_LABELS = 'b';
    
    constructor(apiKey = '', type = BingMapsProvider.AERIAL) {
        super();
        this.maxZoom = 19;
        this.apiKey = apiKey;
        this.type = type;
        this.subdomain = 't1';
    }
    
    async getMetaData() {
        const data = await FetchUtils.get(`http://dev.virtualearth.net/REST/V1/Imagery/Metadata/RoadOnDemand?output=json&include=ImageryProviders&key=${this.apiKey}`);
        return JSON.parse(data);
    }
    
    static quadKey(zoom, x, y) {
        let quad = '';
        for (let i = zoom; i > 0; i--) {
            const mask = 1 << (i - 1);
            let cell = 0;
            if ((x & mask) !== 0) cell++;
            if ((y & mask) !== 0) cell += 2;
            quad += cell;
        }
        return quad || "0";
    }
    
    async fetchTile(zoom, x, y) {
        return ImageLoader.loadImage(`http://ecn.${this.subdomain}.tiles.virtualearth.net/tiles/${this.type}${BingMapsProvider.quadKey(zoom, x, y)}.jpeg?g=1173`);
    }
}

export class GoogleMapsProvider extends MapProvider {
    constructor(apiToken) {
        super();
        this.apiToken = apiToken || '';
        this.sessionToken = null;
        this.orientation = 0;
        this.createSession();
    }
    
    async createSession() {
        const data = JSON.stringify({
            mapType: 'roadmap',
            language: 'en-EN',
            region: 'en',
            layerTypes: ['layerRoadmap', 'layerStreetview'],
            overlay: false,
            scale: 'scaleFactor1x'
        });
        const response = await FetchUtils.request(`https://www.googleapis.com/tile/v1/createSession?key=${this.apiToken}`, {
            method: 'GET',
            headers: { 'Content-Type': 'text/json' },
            body: data
        });
        this.sessionToken = response.session;
    }
    
    async fetchTile(zoom, x, y) {
        return ImageLoader.loadImage(`https://www.googleapis.com/tile/v1/tiles/${zoom}/${x}/${y}?session=${this.sessionToken}&orientation=${this.orientation}&key=${this.apiToken}`);
    }
}

export class HereMapsProvider extends MapProvider {
    constructor(appId, appCode, style = 'base', scheme = 'normal.day', format = 'png', size = 512) {
        super();
        this.appId = appId || '';
        this.appCode = appCode || '';
        this.style = style;
        this.scheme = scheme;
        this.format = format;
        this.size = size;
        this.version = 'newest';
        this.server = 1;
    }
    
    nextServer() {
        this.server = this.server % 4 === 0 ? 1 : this.server + 1;
    }
    
    async fetchTile(zoom, x, y) {
        this.nextServer();
        return ImageLoader.loadImage(`https://${this.server}.${this.style}.maps.api.here.com/maptile/2.1/maptile/${this.version}/${this.scheme}/${zoom}/${x}/${y}/${this.size}/${this.format}?app_id=${this.appId}&app_code=${this.appCode}`);
    }
}

export class MapBoxProvider extends MapProvider {
    static ADDRESS = 'https://api.mapbox.com/';
    static STYLE = 100;
    static MAP_ID = 101;
    
    constructor(apiToken = '', id = '', mode = MapBoxProvider.STYLE, format = 'png', useHDPI = false, version = 'v4') {
        super();
        this.apiToken = apiToken;
        this.format = format;
        this.useHDPI = useHDPI;
        this.mode = mode;
        this.mapId = id;
        this.style = id;
        this.version = version;
    }
    
    async getMetaData() {
        const data = await FetchUtils.get(`${MapBoxProvider.ADDRESS}${this.version}/${this.mapId}.json?access_token=${this.apiToken}`);
        const meta = JSON.parse(data);
        Object.assign(this, {
            name: meta.name,
            minZoom: meta.minZoom,
            maxZoom: meta.maxZoom,
            bounds: meta.bounds,
            center: meta.center
        });
        return meta;
    }
    
    async fetchTile(zoom, x, y) {
        const hdpi = this.useHDPI ? '@2x' : '';
        const token = `access_token=${this.apiToken}`;
        
        let url;
        if (this.style === 'mapbox.terrain-rgb' || this.mapId === 'mapbox.terrain-rgb') {
            url = `${MapBoxProvider.ADDRESS}v4/mapbox.terrain-rgb/${zoom}/${x}/${y}${this.useHDPI ? '@2x.pngraw' : '.pngraw'}?${token}`;
        } else if (this.mode === MapBoxProvider.STYLE) {
            url = `${MapBoxProvider.ADDRESS}styles/v1/${this.style}/tiles/${zoom}/${x}/${y}${hdpi}?${token}`;
        } else {
            url = `${MapBoxProvider.ADDRESS}v4/${this.mapId}/${zoom}/${x}/${y}${hdpi}.${this.format}?${token}`;
        }
        
        return ImageLoader.loadImage(url);
    }
}

export class MapTilerProvider extends MapProvider {
    constructor(apiKey = '', category = 'maps', style = 'satellite', format = 'png') {
        super();
        this.apiKey = apiKey;
        this.format = format;
        this.category = category;
        this.style = style;
        this.resolution = 512;
    }
    
    async fetchTile(zoom, x, y) {
        return ImageLoader.loadImage(`https://api.maptiler.com/${this.category}/${this.style}/${zoom}/${x}/${y}.${this.format}?key=${this.apiKey}`);
    }
}

export class OpenMapTilesProvider extends MapProvider {
    constructor(address, format = 'png', theme = 'klokantech-basic') {
        super();
        this.address = address;
        this.format = format;
        this.theme = theme;
    }
    
    async getMetaData() {
        const data = await FetchUtils.get(`${this.address}styles/${this.theme}.json`);
        const meta = JSON.parse(data);
        Object.assign(this, {
            name: meta.name,
            format: meta.format,
            minZoom: meta.minZoom,
            maxZoom: meta.maxZoom,
            bounds: meta.bounds,
            center: meta.center
        });
        return meta;
    }
    
    async fetchTile(zoom, x, y) {
        return ImageLoader.loadImage(`${this.address}styles/${this.theme}/${zoom}/${x}/${y}.${this.format}`);
    }
}

export class DebugProvider extends MapProvider {
    constructor() {
        super();
        this.resolution = 256;
    }
    
    async fetchTile(zoom, x, y) {
        const canvas = new OffscreenCanvas(this.resolution, this.resolution);
        const ctx = canvas.getContext('2d');
        const t = (zoom - this.minZoom) / (this.maxZoom - this.minZoom);
        ctx.fillStyle = `rgb(${Math.floor(255 * t)},${Math.floor(255 * (1 - t))},0)`;
        ctx.fillRect(0, 0, this.resolution, this.resolution);
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${this.resolution * 0.1}px arial`;
        ctx.fillText(`(${zoom})`, this.resolution / 2, this.resolution * 0.4);
        ctx.fillText(`(${x}, ${y})`, this.resolution / 2, this.resolution * 0.6);
        return canvas;
    }
}

export class HeightDebugProvider extends MapProvider {
    constructor(provider) {
        super();
        this.provider = provider;
    }
    
    async fetchTile(zoom, x, y) {
        const image = await this.provider.fetchTile(zoom, x, y);
        const resolution = 256;
        const canvas = new OffscreenCanvas(resolution, resolution);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, resolution, resolution);
        const imageData = ctx.getImageData(0, 0, resolution, resolution);
        const { data } = imageData;
        
        for (let i = 0; i < data.length; i += 4) {
            const height = (data[i] * 65536 + data[i + 1] * 256 + data[i + 2]) * 0.1 - 10000;
            const normalized = (height + 10000) / 17000;
            const hue = normalized * 120;
            const rgb = this.hslToRgb(hue / 360, 1, 0.5);
            data[i] = rgb[0];
            data[i + 1] = rgb[1];
            data[i + 2] = rgb[2];
        }
        
        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }
    
    hslToRgb(h, s, l) {
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h * 6) % 2 - 1));
        const m = l - c / 2;
        let rgb;
        if (h < 1/6) rgb = [c, x, 0];
        else if (h < 2/6) rgb = [x, c, 0];
        else if (h < 3/6) rgb = [0, c, x];
        else if (h < 4/6) rgb = [0, x, c];
        else if (h < 5/6) rgb = [x, 0, c];
        else rgb = [c, 0, x];
        return rgb.map(v => Math.round((v + m) * 255));
    }
}
