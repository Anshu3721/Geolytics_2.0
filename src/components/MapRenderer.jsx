import React, {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef
} from "react";
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../Styles.css';



const addHighlightLayer = (map, feature) => {
  if (!map.isStyleLoaded()) {
    map.once("idle", () => addHighlightLayer(map, feature));
    return;
  }

  if (!map.getSource("highlight")) {
    map.addSource("highlight", {
      type: "geojson",
      data: feature
    });
  } else {
    map.getSource("highlight").setData(feature);
  }

  if (!map.getLayer("highlight")) {
    map.addLayer({
      id: "highlight",
      type: "line",
      source: "highlight",
      paint: {
        "line-color": "#FFD700",
        "line-width": 3
      }
    });
  }
};



// Use Vite's env for the token
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
const enrichGeoJSONWithKPIs = (geojson, kpiData, joinKey = 'cellname') => {
  return {
    ...geojson,
    features: geojson.features.map(f => {
      const joinValue = f.properties?.[joinKey];
      const matchingKpis = kpiData[joinValue] || {}; // Object with many KPI keys
      return {
        ...f,
        properties: {
          ...f.properties,
          ...matchingKpis
        }
      };
    })
  };
};
function generateSectorGeoJSON(data, selectedCellBand, colorRanges) {
  let firstColoredFeature = null;

  // 1️⃣ Filter to only selected cells
  let filteredData = data;
  if (Array.isArray(selectedCellBand) && selectedCellBand.length > 0) {
    filteredData = data.filter((props) =>
      selectedCellBand.includes(props.cellname)
    );
  }

  // 2️⃣ Sort highest → lowest band number
  filteredData.sort((a, b) => {
    const numA = parseInt((a.BAND || a.band || "").replace(/\D/g, "")) || 0;
    const numB = parseInt((b.BAND || b.band || "").replace(/\D/g, "")) || 0;
    return numB - numA;
  });

  // 3️⃣ Generate features with chosen color + concentric size
  const features = filteredData.map((props, idx) => {
    const { site_id, cellname, azimuth } = props;

    // Get user-selected color
    const fillColor =
      (colorRanges[cellname] &&
        Object.keys(colorRanges[cellname]).length > 0 &&
        Object.keys(colorRanges[cellname])[0]) || "#ccc"; // First color name key OR fallback

    // For concentric polygons: shrink radius per index
    const maxRadius = 500; // adjust to your scale
    const scaleFactor = 1 - idx * 0.15; // shrink each layer
    const geometry = generateSectorGeometry(azimuth, maxRadius * scaleFactor);

    const feature = {
      type: "Feature",
      geometry,
      properties: {
        site_id,
        cellname,
        band: props.BAND || props.band || props.Band || "default",
        azimuth,
        color: fillColor,
      },
    };

    if (!firstColoredFeature && fillColor !== "#ccc") {
      firstColoredFeature = feature;
    }

    return feature;
  });

  return {
    geojson: {
      type: "FeatureCollection",
      features,
    },
    firstColoredFeature,
  };
}


function getColorForValue(value, colorBands) {
  for (const { color, from, to } of colorBands) {
    if (value >= from && value <= to) return color;
  }
  return '#cccccc'; // Default gray
}



// === Sector Utility ===
const createSectorPolygon = (center, radiusKm, azimuth, beamWidth = 45) => {
  const points = [center];
  const startAngle = azimuth - beamWidth / 2;
  const endAngle = azimuth + beamWidth / 2;
  for (let angle = startAngle; angle <= endAngle; angle += 5) {
    const destination = turf.destination(center, radiusKm, angle, { units: 'kilometers' });
    points.push(destination.geometry.coordinates);
  }
  points.push(center);
  return turf.polygon([points]);
};

const getColorForBand = (band) => {
  const colors = {
    '1800': '#1d4ed8',
    '900': '#10b981',
    '2100': '#eab308',
    '2300': '#f97316',
    'default': '#6366f1'
  };
  return colors[band] || colors['default'];
};

const KPI_OPTIONS = [
  { value: 'SINR', label: 'SINR' },
  { value: 'RSRP', label: 'RSRP' },
  { value: 'Complaints', label: 'Complaints' }
];

const BAND_OPTIONS = [
  { value: '1800', label: '1800 MHz' },
  { value: '900', label: '900 MHz' },
  { value: '2100', label: '2100 MHz' },
  { value: '2300', label: '2300 MHz' }
];

// Simple info popup (used for both points and polygons)
const createPopupHtml = (properties) => {
  let html = `<div class="popup-table-bordered">
    <table>
      <thead>
        <tr><th>Property</th><th>Value</th></tr>
      </thead>
      <tbody>`;
  
  for (const key in properties) {
    const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
    const value = properties[key] ?? '';
    html += `<tr><td>${formattedKey}</td><td>${value}</td></tr>`;
  }

  html += `</tbody></table></div>`;
  return html;
};


const MapRenderer = ({
  geojsonData,
  driveTestGeoJSON,
  highlightedFeature: externalHighlight,
  gridGeoJSON,
  colorColumn,          
  colorBands,
  onSiteClick,
   selectedDriveKPI,
    colorRanges, 
    layerRange,
    gridData,
    driveLayerRange, 
}) => {
  const [hasZoomedToSectors, setHasZoomedToSectors] = useState(false);
  const [rulerActive, setRulerActive] = useState(false);
  const rulerGeoJSON = useRef({ type: 'FeatureCollection', features: [] });
  const rulerLinestring = useRef({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  const distanceRef = useRef(null);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [driveTestColumns, setDriveTestColumns] = useState([]);

  // --- Search State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [highlightedFeature, setHighlightedFeature] = useState(null);
  const [searchHistory, setSearchHistory] = useState([]);

  // --- KPI/Heatmap State ---
  const [selectedKPI, setSelectedKPI] = useState('null');
  const [threshold, setThreshold] = useState(17);
  


  // --- Panel Toggles ---
  const [showHeatmapPanel, setShowHeatmapPanel] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);

  // --- Legend Dynamic Selection ---
  const [showLegend, setShowLegend] = useState(false);
  const [legendType, setLegendType] = useState('kpi'); // 'kpi', 'band', 'sector', 'driveTest'
  const [siteCellOptions, setSiteCellOptions] = useState([]);
  const [selectedCellBand, setSelectedCellBand] = useState(null);
  const [perCellColorRanges, setPerCellColorRanges] = useState({});

// === Heatmap module states ===
const [gridHeatmapGeoJSON, setGridHeatmapGeoJSON] = useState(null);

const [availableGridKPIs, setAvailableGridKPIs] = useState([]);




  // --- External highlight sync ---
  useEffect(() => {
    if (externalHighlight !== undefined) {
      setHighlightedFeature(externalHighlight);
      if (externalHighlight) setSearchHistory((prev) => [...prev, externalHighlight]);
    }
  }, [externalHighlight]);
 
  // --- Ruler tool sync ---
  const rulerActiveRef = useRef(rulerActive);
  useEffect(() => {
    rulerActiveRef.current = rulerActive;
  }, [rulerActive]);

  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/outdoors-v12');



  // inside useEffect or map load callback in MapRenderer.jsx
useEffect(() => {
  if (!mapRef.current || !gridData) return;
  const map = mapRef.current;

  // Remove old layer/source if exists
  if (map.getSource("kpi-grid")) {
    map.removeLayer("kpi-grid-layer");
    map.removeSource("kpi-grid");
  }

  // Add new source
  map.addSource("kpi-grid", {
    type: "geojson",
    data: gridData,
  });

  // Add new layer
  map.addLayer({
    id: "kpi-grid-layer",
    type: "fill",
    source: "kpi-grid",
    paint: {
      "fill-color": [
        "interpolate",
        ["linear"],
        ["get", "value"], // assumes gridData features have "value"
        0, "#f7fbff",
        50, "#6baed6",
        100, "#08306b"
      ],
      "fill-opacity": 0.6,
    },
  });
}, [gridData]);





const generateSectorGeoJSON = (geojson) => {
  const grouped = new Map();
  let firstValid = null;

  geojson?.features?.forEach((feature) => {
    const coords = feature.geometry?.coordinates;
    const props = feature.properties || {};
    const azimuth = parseFloat(props.azimuth ?? props.Azimuth);
    const band = props.band ?? props.Band ?? 'default';

    if (!coords || isNaN(azimuth)) return;

    const key = JSON.stringify(coords) + '|' + band;
    if (!grouped.has(key)) grouped.set(key, []);
    if (grouped.get(key).length >= 3) return;

    const rawValue = props[colorColumn];
    const parsedValue =
      rawValue !== undefined &&
      rawValue !== null &&
      rawValue !== '' &&
      rawValue !== 'null' &&
      rawValue !== '--' &&
      !isNaN(Number(rawValue))
        ? Number(rawValue)
        : null;

    const fallbackColor = getColorForBand(band);
    let dynamicColor = fallbackColor;

    if (parsedValue !== null) {
      for (const { from, to, color } of colorBands || []) {
        if (parsedValue >= from && parsedValue <= to) {
          dynamicColor = color;
          break;
        }
      }
    } else {
     
    }

    const sectorPolygon = createSectorPolygon(coords, 0.3, azimuth);

    const sectorFeature = {
      type: 'Feature',
      geometry: sectorPolygon.geometry,
      properties: {
        ...props,
        band,
        [colorColumn]: parsedValue,
        color: dynamicColor,
      },
    };

    if (!firstValid && dynamicColor !== fallbackColor) {
      firstValid = sectorFeature;
    }

    grouped.get(key).push(sectorFeature);
  });

  return {
    type: 'FeatureCollection',
    features: Array.from(grouped.values()).flat(),
    firstValidFeature: firstValid,
    groupedCells: grouped
  };
};





const addThematicLayer = (map, data, colorColumn, colorBands) => {
  if (!map || !data || !colorColumn || !colorBands?.length) return;

  const sampleValue = Number(data.features[0]?.properties[colorColumn]);
  const allProps = data.features[0]?.properties;

  


  if (map.getLayer('thematic-layer')) map.removeLayer('thematic-layer');
  if (map.getSource('thematic')) map.removeSource('thematic');

  const filteredFeatures = data.features.filter(f =>
  typeof f.properties[colorColumn] === 'number' && !isNaN(f.properties[colorColumn])
);
const firstValid = filteredFeatures[0];



  

  const thematicGeoJSON = {
    type: 'FeatureCollection',
    features: filteredFeatures
  };
  map.addSource('thematic', { type: 'geojson', data: thematicGeoJSON });

  map.addLayer({
    id: 'thematic-layer',
    type: 'circle',
    source: 'thematic',
    paint: {
      'circle-radius': 6,
      'circle-opacity': 0.8,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#000',
      'circle-color': [
        'case',
        ...colorBands.flatMap(({ from, to, color }) => ([
          ['all',
            ['>=', ['to-number', ['get', colorColumn]], from],
            ['<=', ['to-number', ['get', colorColumn]], to]
          ],
          color
        ])),
        '#999'
      ]
    }
  });

  // Debug band match
  let matched = '#999';
  for (const { from, to, color } of colorBands) {
    if (sampleValue >= from && sampleValue <= to) {
      matched = color;
      break;
    }
  }

};






// === Add Sector Layer ===
const addSectorLayer = (map, data, selectedBandCells = [], bandColorMap = {}) => {
  const { features, firstValidFeature } = generateSectorGeoJSON(data);


  // Base GeoJSON for thematic coloring
  const sectorGeoJSON = {
    type: "FeatureCollection",
    features,
  };

  // --- Add/Update base sector layer ---
  if (!map.getSource("sectors")) {
    map.addSource("sectors", { type: "geojson", data: sectorGeoJSON });
  } else {
    map.getSource("sectors").setData(sectorGeoJSON);
  }

  if (!map.getLayer("sector-layer")) {
    map.addLayer({
      id: "sector-layer",
      type: "fill",
      source: "sectors",
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": 0.6,
        "fill-outline-color": "#000000",
      },
    });

    // Hover cursor
    map.on("mouseenter", "sector-layer", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "sector-layer", () => {
      map.getCanvas().style.cursor = "";
    });

    // Popup on click
    map.on("click", "sector-layer", (e) => {
      const props = e.features?.[0]?.properties || {};
      if (!props) return;
      const html = createPopupHtml(props);
      if (window.currentPopup) window.currentPopup.remove();
      window.currentPopup = new mapboxgl.Popup({ offset: 15 })
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    });
  }

  // --- Handle optional Band Overlay ---
  const haveSelection =
    (Array.isArray(selectedBandCells) && selectedBandCells.length > 0) ||
    (Object.keys(bandColorMap || {}).length > 0);

  if (haveSelection) {
    const selectedSet = new Set(
      selectedBandCells.map(v => String(v).trim().toLowerCase())
    );
    const bandColorKeys = Object.keys(bandColorMap).map(k => k.trim().toLowerCase());

    // group selected features by (site_id, azimuth)
    const groups = new Map();
    features.forEach((f) => {
      const p = f.properties || {};
      const cellname = (p.cellname || p.Cell_name || p.CELLNAME || "").toString();
      const bandName = (p.band || p.Band || p.BAND || "").toString();

      const matches =
        selectedSet.has(cellname.toLowerCase()) ||
        selectedSet.has(bandName.toLowerCase()) ||
        Array.from(selectedSet).some(sel => sel.includes(bandName.toLowerCase())) ||
        bandColorKeys.includes(bandName.toLowerCase()) ||
        bandColorKeys.includes(cellname.toLowerCase());

      if (!matches) return;

      const siteId = (p.site_id || p.Site_ID || p.SITEID || "").toString();
      const az = Number(p.azimuth || p.Azimuth || p.AZIMUTH || 0);
      const key = `${siteId}::${az}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    });

    // build concentric overlay features
    const overlayFeatures = [];
    const baseScale = 0.92;
    const ringStep = 0.10;
    const minScale = 0.2;

    groups.forEach((arr) => {
      arr.sort((a, b) => {
        const pa = a.properties || {};
        const pb = b.properties || {};
        const ba = (pa.band || pa.Band || pa.BAND || "").toString();
        const bb = (pb.band || pb.Band || pb.BAND || "").toString();
        const byBand = ba.localeCompare(bb);
        if (byBand !== 0) return byBand;
        const ca = (pa.cellname || pa.Cell_name || pa.CELLNAME || "").toString();
        const cb = (pb.cellname || pb.Cell_name || pb.CELLNAME || "").toString();
        return ca.localeCompare(cb);
      });

      arr.forEach((f, idx) => {
        const p = f.properties || {};
        const bandKey = (p.band || p.Band || p.BAND || "").toString();
        const cellKey = (p.cellname || p.Cell_name || p.CELLNAME || "").toString();

        const color =
          bandColorMap[bandKey] ||
          bandColorMap[cellKey] ||
          p.color ||
          "#ff0000";

        const scaleFactor = Math.max(minScale, baseScale - idx * ringStep);

        let geom = f.geometry;
        try {
          const scaled = turf.transformScale(f, scaleFactor, { origin: "centroid" });
          geom = scaled.geometry;
        } catch {
          geom = f.geometry;
        }

        overlayFeatures.push({
          type: "Feature",
          geometry: geom,
          properties: {
            ...p,
            color,
            outline: "#1f2937",
          },
        });
      });
    });

   

    const overlayGeoJSON = {
      type: "FeatureCollection",
      features: overlayFeatures,
    };

    if (!map.getSource("band-sectors")) {
      map.addSource("band-sectors", { type: "geojson", data: overlayGeoJSON });
    } else {
      map.getSource("band-sectors").setData(overlayGeoJSON);
    }

    ["band-sectors-outline", "band-sectors"].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });

    map.addLayer(
      {
        id: "band-sectors",
        type: "fill",
        source: "band-sectors",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.85,
        },
      },
      "sector-layer"
    );

    map.addLayer(
      {
        id: "band-sectors-outline",
        type: "line",
        source: "band-sectors",
        paint: {
          "line-color": ["get", "outline"],
          "line-width": 1.2,
          "line-opacity": 0.9,
        },
      },
      "band-sectors"
    );

    if (overlayFeatures.length > 0) {
      try {
        const bounds = turf.bbox(overlayGeoJSON);
        map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
   
      } catch (e) {
        console.warn("Auto-zoom failed:", e);
      }
    }
  } else {
   
    if (firstValidFeature) {
      try {
        const bounds = turf.bbox(firstValidFeature);
        map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
      } catch (e) {
        console.warn("Auto-zoom failed:", e);
      }
    }

    if (map.getLayer("band-sectors-outline")) map.removeLayer("band-sectors-outline");
    if (map.getLayer("band-sectors")) map.removeLayer("band-sectors");
    if (map.getSource("band-sectors")) map.removeSource("band-sectors");
  }
};






// === Add Drive Test Layer ===
const addDriveTestLayer = () => {
  const map = mapInstance.current;
  if (!map || !driveTestGeoJSON?.features?.length) return;

  // 🔄 Clear old layers/sources
  if (map.getLayer("driveTest-points")) map.removeLayer("driveTest-points");
  if (map.getLayer("driveTest-heatmap")) map.removeLayer("driveTest-heatmap");
  if (map.getSource("drive-test")) map.removeSource("drive-test");

  // ✅ Use actual selected KPI
  const selectedKPI =
    selectedDriveKPI && colorRanges[selectedDriveKPI]
      ? selectedDriveKPI
      : Object.keys(colorRanges)[0] || "RSRP";

  // Sort by time if available
  const sorted = [...driveTestGeoJSON.features].sort((a, b) => {
    const ta = a.properties.timestamp || a.properties.time || a.properties.date || 0;
    const tb = b.properties.timestamp || b.properties.time || b.properties.date || 0;
    return new Date(ta) - new Date(tb);
  });

  // ✅ Sanitize KPI values
  const pointGeoJSON = {
    type: "FeatureCollection",
    features: sorted.map((f) => {
      const raw = f.properties[selectedKPI];
      const value =
        raw === null || raw === undefined || raw === "" || isNaN(Number(raw))
          ? NaN
          : Number(raw);

      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          ...f.properties,
          __numericValue: value, // 👈 safe field for coloring
        },
      };
    }),
  };



   map.addSource("drive-test", { type: "geojson", data: pointGeoJSON });

  // === Build paint expression dynamically ===
  let colorExpression = ["case"];
  if (colorRanges[selectedKPI] && Object.keys(colorRanges[selectedKPI]).length > 0) {
    Object.entries(colorRanges[selectedKPI]).forEach(([color, [min, max]], idx, arr) => {
      const isLast = idx === arr.length - 1;
      colorExpression.push(
        [
          "all",
          [">=", ["to-number", ["get", "__numericValue"]], min],
          isLast
            ? ["<=", ["to-number", ["get", "__numericValue"]], max]
            : ["<", ["to-number", ["get", "__numericValue"]], max],
        ],
        color
      );
    });
  }
  colorExpression.push("gray"); // fallback

  // 🔵 Add points
  map.addLayer({
    id: "driveTest-points",
    type: "circle",
    source: "drive-test",
    paint: {
      "circle-radius": 4,
      "circle-color": colorExpression.length > 3 ? colorExpression : "gray",
    },
  });

  // 🔥 Optional Heatmap
  map.addLayer({
    id: "driveTest-heatmap",
    type: "heatmap",
    source: "drive-test",
    maxzoom: 15,
    paint: {
      "heatmap-weight": [
        "interpolate", ["linear"], ["to-number", ["get", "__numericValue"]],
        layerRange.min ?? -120, 0,
        layerRange.max ?? -60, 1
      ],
      "heatmap-intensity": 3.2,
      "heatmap-radius": 30,
      "heatmap-opacity": 0.6,
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(33,102,172,0)",
        0.2, "rgb(103,169,207)",
        0.4, "rgb(209,229,240)",
        0.6, "rgb(253,219,199)",
        0.8, "rgb(239,138,98)",
        1, "rgb(178,24,43)"
      ]
    }
  });

  // === ✅ Add hover popup for drive test points ===
  const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });

  map.on("mousemove", "driveTest-points", (e) => {
    if (!e.features?.length) return;
    const feature = e.features[0];
    const value = feature.properties[selectedKPI];
    if (value == null) return;

    // Find matching range
    let rangeLabel = "Uncategorized";
    if (colorRanges[selectedKPI]) {
      for (const [color, [min, max]] of Object.entries(colorRanges[selectedKPI])) {
        if (value >= min && value <= max) {
          rangeLabel = `${min} → ${max}`;
          break;
        }
      }
    }

    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-size: 12px; line-height: 1.4">
          <strong>${selectedKPI}</strong>: ${value}<br/>
          Range: ${rangeLabel}
        </div>
      `)
      .addTo(map);
  });

  map.on("mouseleave", "driveTest-points", () => popup.remove());
};






  // === Add Heatmap Layer ===
  const addHeatmapLayer = (map, data, kpi, thresholdValue) => {
    if (map.getLayer('kpi-heatmap')) map.removeLayer('kpi-heatmap');
    if (map.getSource('kpi-heat')) map.removeSource('kpi-heat');
    const features = (data?.features || []).filter(
      f => typeof f.properties[kpi] === 'number'
    );
    const geojson = { type: 'FeatureCollection', features };
    map.addSource('kpi-heat', { type: 'geojson', data: geojson });
    map.addLayer({
    id: "driveTest-heatmap",
    type: "heatmap",
    source: "drive-test",
    maxzoom: 15,
    paint: {
      "heatmap-weight": [
        "interpolate", ["linear"], ["to-number", ["get", selectedKPI]],
        layerRange.min ?? -120, 0,
        layerRange.max ?? -60, 1
      ],
      "heatmap-intensity": 1.2,
      "heatmap-radius": 22,
      "heatmap-opacity": 0.6,
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(33,102,172,0)",
        0.2, "rgb(103,169,207)",
        0.4, "rgb(209,229,240)",
        0.6, "rgb(253,219,199)",
        0.8, "rgb(239,138,98)",
        1, "rgb(178,24,43)"
      ]
    }
  });
  };

const addGridHeatmapLayer = () => {
  const map = mapInstance.current;
  if (!map || !gridHeatmapGeoJSON || !selectedKPI) return;

  // 🔄 Remove old layer/source if exists
  if (map.getLayer("grid-heatmap")) map.removeLayer("grid-heatmap");
  if (map.getSource("grid-kpi")) map.removeSource("grid-kpi");

  // ✅ Sanitize values
  const sanitized = {
    type: "FeatureCollection",
    features: gridHeatmapGeoJSON.features.map(f => {
      const raw = f.properties[selectedKPI];
      const value = Number(raw);
      return {
        ...f,
        properties: {
          ...f.properties,
          __value: isNaN(value) ? null : value
        }
      };
    })
  };

  map.addSource("grid-kpi", { type: "geojson", data: sanitized });

  // 🧠 Optional: threshold-based intensity
  const minVal = Math.min(...sanitized.features.map(f => f.properties.__value ?? Infinity));
  const maxVal = Math.max(...sanitized.features.map(f => f.properties.__value ?? -Infinity));

  map.addLayer({
    id: "grid-heatmap",
    type: "heatmap",
    source: "grid-kpi",
    maxzoom: 15,
    paint: {
      "heatmap-weight": [
        "interpolate",
        ["linear"],
        ["to-number", ["get", "__value"]],
        minVal, 0,
        threshold, 1 // 👈 threshold affects intensity
      ],
      "heatmap-intensity": 1,
      "heatmap-radius": 20,
      "heatmap-opacity": 0.7,
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(33,102,172,0)",
        0.2, "rgb(103,169,207)",
        0.4, "rgb(209,229,240)",
        0.6, "rgb(253,219,199)",
        0.8, "rgb(239,138,98)",
        1, "rgb(178,24,43)"
      ]
    }
  });
};



  // === Add Grid Layer ===
  const addGridLayer = (map, gridGeoJSON, threshold = 17, kpiField = 'kpi_avg') => {
    if (!gridGeoJSON || !gridGeoJSON.features || gridGeoJSON.features.length === 0) return;
    if (map.getLayer('grid-layer')) map.removeLayer('grid-layer');
    if (map.getSource('grid')) map.removeSource('grid');
    map.addSource('grid', { type: 'geojson', data: gridGeoJSON });
    map.addLayer({
      id: 'grid-layer',
      type: 'fill',
      source: 'grid',
      paint: {
        'fill-color': [
          'case',
          ['>=', ['get', kpiField], threshold], '#fee08b', // Yellow for SINR >= 17
          [
            'interpolate',
            ['linear'],
            ['get', kpiField],
            0, '#d73027',    // Red (problematic)
            threshold, '#fee08b', // Yellow (threshold)
            30, '#1a9850'    // Green (good)
          ]
        ],
        'fill-opacity': 0.7,
        'fill-outline-color': '#222'
      },
    });
    // Fit map to grid bounds
    try {
      const bounds = turf.bbox(gridGeoJSON);
      map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
    } catch (err) {
      // ignore
    }
    map.on('click', 'grid-layer', (e) => {
      const props = e.features[0].properties;
      const coordinates = e.lngLat;
      new mapboxgl.Popup()
        .setLngLat(coordinates)
        .setHTML(`<div><b>Avg KPI:</b> ${props[kpiField] !== undefined ? props[kpiField] : 'N/A'}</div>`)
        .addTo(map);
    });
    map.on('mouseenter', 'grid-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'grid-layer', () => {
      map.getCanvas().style.cursor = '';
    });
    map.addLayer({
  id: 'driveTest-heatmap',
  type: 'heatmap',
  source: 'driveTest',
  paint: {
    'heatmap-weight': ['get', selectedKPI],
    'heatmap-intensity': 1,
    'heatmap-radius': 20,
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'blue',
      0.5, 'yellow',
      1, 'red'
    ],
  }
});

  };

  useEffect(() => {
  const map = mapInstance.current;
  if (map && geojsonData && colorColumn && colorBands && colorBands.length > 0) {
   


    addThematicLayer(map, geojsonData, colorColumn, colorBands);
  }
}, [geojsonData, colorColumn, colorBands]);

 

  // === Map Init ===
  useEffect(() => {
    if (mapInstance.current) return;
    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: mapStyle,
      center: [78.9629, 20.5937],
      zoom: 4,
    });
    window._map = map;
    mapInstance.current = map;
    map.addControl(new mapboxgl.NavigationControl());
    map.on('load', () => {
      mapRef.current = map;
      map.addSource('ruler-geojson', {
        type: 'geojson',
        data: rulerGeoJSON.current,
      });
      map.addLayer({
        id: 'measure-points',
        type: 'circle',
        source: 'ruler-geojson',
        paint: {
          'circle-radius': 4,
          'circle-color': '#000',
        },
        filter: ['==', '$type', 'Point'],
      });
      map.addSource('highlighted-feature', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });


  map.addLayer({
  id: 'highlighted-feature-layer',
  type: 'circle',
  source: 'highlighted-feature',
  paint: {
    // Fill of the circle (slightly transparent)
    'circle-color': 'rgba(255,0,0,0.3)',
    // Radius of the circle
    'circle-radius': 9,
    // Border width
    'circle-stroke-width': 3,
    // Border color
    'circle-stroke-color': 'red',
    // Optional: make the edges smoother
    'circle-blur': 0.5
  },
});


      map.addLayer({
        id: 'measure-lines',
        type: 'line',
        source: 'ruler-geojson',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#000',
          'line-width': 2,
        },
        filter: ['==', '$type', 'LineString'],
      });
      // Ruler tool
      map.on('click', (e) => {
        if (!rulerActiveRef.current) return;
        const coords = [e.lngLat.lng, e.lngLat.lat];
        rulerGeoJSON.current.features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: coords }
        });
        rulerLinestring.current.geometry.coordinates.push(coords);
        const distance = turf.length(rulerLinestring.current);
        if (distanceRef.current) {
          distanceRef.current.innerText = `📏 ${distance.toFixed(2)} km`;
        }
        if (map.getSource('ruler-geojson')) {
          map.getSource('ruler-geojson').setData({
            type: 'FeatureCollection',
            features: [...rulerGeoJSON.current.features, rulerLinestring.current],
          });
        }
      });
      map.on('click', 'measure-points', (e) => {
        if (!rulerActiveRef.current) return;
        if (!e.features || e.features.length === 0) return;
        const clickedCoords = e.features[0].geometry.coordinates;
        const points = rulerGeoJSON.current.features;
        const idx = points.findIndex(
          (pt) =>
            pt.geometry.type === 'Point' &&
            pt.geometry.coordinates[0] === clickedCoords[0] &&
            pt.geometry.coordinates[1] === clickedCoords[1]
        );
        if (idx !== -1) {
          points.splice(idx, 1);
          rulerLinestring.current.geometry.coordinates.splice(idx, 1);
          const distance = turf.length(rulerLinestring.current);
          if (distanceRef.current) {
            distanceRef.current.innerText = points.length
              ? `📏 ${distance.toFixed(2)} km`
              : '';
          }
          if (map.getSource('ruler-geojson')) {
            map.getSource('ruler-geojson').setData({
              type: 'FeatureCollection',
              features: [...points, rulerLinestring.current],
            });
          }
        }
        e.originalEvent.cancelBubble = true;
      });
      map.on('mousemove', (e) => {
        if (!rulerActiveRef.current) return;
        map.getCanvas().style.cursor = 'crosshair';
      });
    });
  }, [mapStyle]);

  // === On GeoJSON Update (Cluster, Sector, etc) ===
 useEffect(() => {
  if (mapInstance.current && geojsonData?.features?.length > 0 && !hasZoomedToSectors) {
    const sectorGeoJSON = generateSectorGeoJSON(geojsonData);
    addSectorLayer(mapInstance.current, geojsonData);

    try {
      const valid = sectorGeoJSON.features.filter(f => f.properties?.color);
      if (valid.length > 0) {
        const bounds = turf.bbox({ type: 'FeatureCollection', features: valid });
        mapInstance.current.fitBounds(bounds, { padding: 40, maxZoom: 15, essential: true });
        setHasZoomedToSectors(true); // 🚀 Avoid future zooms
      }
    } catch (err) {
      // ignore
    }
  }
}, [geojsonData, colorColumn, colorBands]);


// === Drive Test Popup on Hover ===
useEffect(() => {
  if (!mapInstance.current) return;
  const map = mapInstance.current;

  if (!map.getLayer("driveTest-layer")) return; // ✅ ensure layer exists

  const popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
  });

  const handleMouseMove = (e) => {
    if (!e.features?.length || !selectedDriveKPI) return;

    const feature = e.features[0];
    const value = feature.properties[selectedDriveKPI];
    if (value == null) return;

    // Find matching color range
    let rangeLabel = "Uncategorized";
    let bandColor = "#999999";
    if (colorRanges[selectedDriveKPI]) {
      for (const [color, [min, max]] of Object.entries(colorRanges[selectedDriveKPI])) {
        if (value >= min && value <= max) {
          rangeLabel = `${min} → ${max}`;
          bandColor = color;
          break;
        }
      }
    }

    popup
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-size: 12px; line-height: 1.4">
          <strong>${selectedDriveKPI}</strong>: ${value}<br/>
          <span style="color:${bandColor}">Range: ${rangeLabel}</span>
        </div>
      `)
      .addTo(map);
  };

  const handleMouseLeave = () => popup.remove();

  // ✅ enable feature-state querying
  map.on("mousemove", "driveTest-layer", handleMouseMove);
  map.on("mouseleave", "driveTest-layer", handleMouseLeave);

  return () => {
    map.off("mousemove", "driveTest-layer", handleMouseMove);
    map.off("mouseleave", "driveTest-layer", handleMouseLeave);
    popup.remove();
  };
}, [selectedDriveKPI, colorRanges, driveTestGeoJSON]);


// === Handle Grid Heatmap Upload ===
const handleGridHeatmapUpload = async (file) => {
  if (!file) return;

  const ext = file.name.split(".").pop().toLowerCase();

  try {
    if (ext === "geojson" || ext === "json") {
      // ✅ Load GeoJSON/JSON directly
      const text = await file.text();
      const geojson = JSON.parse(text);

     

      // extract KPI columns
      const sampleProps = geojson.features?.[0]?.properties || {};
      const kpis = Object.keys(sampleProps).filter(
        (k) => typeof sampleProps[k] === "number"
      );
    
      setAvailableGridKPIs(kpis);
      setSelectedKPI(kpis[0] || null);

      // put data on map
      mapInstance.current.addSource("grid-heatmap", { type: "geojson", data: geojson });
    }

    if (ext === "csv") {
      // ✅ Parse CSV into GeoJSON
      const text = await file.text();
      const rows = text.split("\n").map((r) => r.split(","));
      const headers = rows[0];
      const latIdx = headers.findIndex((h) => h.toLowerCase().includes("lat"));
      const lonIdx = headers.findIndex((h) => h.toLowerCase().includes("lon"));
      
      if (latIdx === -1 || lonIdx === -1) {
        alert("❌ CSV must contain latitude and longitude columns!");
        return;
      }

      const features = rows.slice(1).filter(r => r.length > 1).map((r) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [parseFloat(r[lonIdx]), parseFloat(r[latIdx])],
        },
        properties: headers.reduce((acc, h, i) => {
          acc[h] = isNaN(r[i]) ? r[i] : Number(r[i]);
          return acc;
        }, {}),
      }));

      const geojson = { type: "FeatureCollection", features };

      console.log("📂 Converted CSV to GeoJSON:", geojson);

      const sampleProps = features[0]?.properties || {};
      const kpis = Object.keys(sampleProps).filter(
        (k) => typeof sampleProps[k] === "number"
      );

      setAvailableGridKPIs(kpis);
      setSelectedKPI(kpis[0] || null);

      mapInstance.current.addSource("grid-heatmap", { type: "geojson", data: geojson });
    }
  } catch (err) {
    console.error("❌ Upload failed:", err);
    alert("Upload failed: " + err.message);
  }
};


useEffect(() => {
  if (showHeatmapPanel) {
    addGridHeatmapLayer();
  }
}, [gridHeatmapGeoJSON, selectedKPI, threshold, showHeatmapPanel]);



  useEffect(() => {
    if (mapInstance.current && driveTestGeoJSON && driveTestGeoJSON.features?.length > 1) {
      addDriveTestLayer();
    }
  }, [driveTestGeoJSON]);


  useEffect(() => {
  setHasZoomedToSectors(false);
}, [geojsonData]);

// === Update Drive Test Layer styling dynamically ===
useEffect(() => {
  if (!mapInstance.current) return;
  if (!mapInstance.current.getLayer("driveTest-layer")) return;
  if (!selectedDriveKPI || !colorRanges[selectedDriveKPI]) return;

  const map = mapInstance.current;

  // Build Mapbox expression dynamically
  const bands = Object.entries(colorRanges[selectedDriveKPI]);
  bands.sort(([, [minA]], [, [minB]]) => minA - minB);

  const expression = ["step", ["get", selectedDriveKPI], "#999999"];
  bands.forEach(([color, [min]]) => {
    expression.push(min, color);
  });

  console.log("🎨 Applying Drive Test style:", expression);

  map.setPaintProperty("driveTest-layer", "circle-color", expression);
}, [selectedDriveKPI, colorRanges, driveLayerRange]);



  useEffect(() => {
    if (mapInstance.current && geojsonData?.features?.length > 0 && selectedKPI) {
      addHeatmapLayer(mapInstance.current, geojsonData, selectedKPI, threshold);
    }
  }, [geojsonData, selectedKPI, threshold]);

useEffect(() => {
  if (!mapInstance.current) return;

  const map = mapInstance.current;
  const source = map.getSource('highlighted-feature');

  if (source) {
    source.setData({
      type: 'FeatureCollection',
      features: highlightedFeature ? [highlightedFeature] : [],
    });
  }

  // Fly to feature if it exists
  if (highlightedFeature?.geometry?.coordinates) {
    map.flyTo({
      center: highlightedFeature.geometry.coordinates,
      zoom: 16,
      essential: true,
    });
  }
}, [highlightedFeature]);


  // === Grid Layer Effect ===
  useEffect(() => {
    if (mapInstance.current && gridGeoJSON && gridGeoJSON.features?.length > 0) {
      addGridLayer(mapInstance.current, gridGeoJSON, threshold, 'kpi_avg');
    }
  }, [gridGeoJSON, threshold]);

  // === Map Style toggles ===
  const handleStyleToggle = () => {
    const newStyle =
      mapStyle === 'mapbox://styles/mapbox/outdoors-v12'
        ? 'mapbox://styles/mapbox/satellite-streets-v12'
        : 'mapbox://styles/mapbox/outdoors-v12';
    setMapStyle(newStyle);
    if (mapInstance.current) {
      const center = mapInstance.current.getCenter();
      const zoom = mapInstance.current.getZoom();
      mapInstance.current.setStyle(newStyle);
      mapInstance.current.once('style.load', () => {
        mapInstance.current.setCenter(center);
        mapInstance.current.setZoom(zoom);
        if (geojsonData) addSectorLayer(mapInstance.current, geojsonData);
        addDriveTestLayer();
        if (highlightedFeature) addHighlightLayer(mapInstance.current, highlightedFeature);
        if (geojsonData && selectedKPI) addHeatmapLayer(mapInstance.current, geojsonData, selectedKPI, threshold);
        if (gridGeoJSON && gridGeoJSON.features?.length > 0)
          addGridLayer(mapInstance.current, gridGeoJSON, threshold, 'kpi_avg');
      });
    }
  };

   const handleLightStyleToggle = () => {
    const newStyle =
      mapStyle === 'mapbox://styles/mapbox/light-v10'
        ? 'mapbox://styles/mapbox/outdoors-v12'
        : 'mapbox://styles/mapbox/light-v10';
    setMapStyle(newStyle);
    if (mapInstance.current) {
      const center = mapInstance.current.getCenter();
      const zoom = mapInstance.current.getZoom();
      mapInstance.current.setStyle(newStyle);
      mapInstance.current.once('style.load', () => {
        mapInstance.current.setCenter(center);
        mapInstance.current.setZoom(zoom);
        if (geojsonData) addSectorLayer(mapInstance.current, geojsonData);
        addDriveTestLayer();
        if (highlightedFeature) addHighlightLayer(mapInstance.current, highlightedFeature);
        if (geojsonData && selectedKPI) addHeatmapLayer(mapInstance.current, geojsonData, selectedKPI, threshold);
        if (gridGeoJSON && gridGeoJSON.features?.length > 0)
          addGridLayer(mapInstance.current, gridGeoJSON, threshold, 'kpi_avg');
      });
    }
  };

  // === Local Search Handler (map search bar) ===
  const handleSearch = (e) => {
    e.preventDefault();
    if (!geojsonData || !geojsonData.features) return;

    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      setSearchResults([]);
      setHighlightedFeature(null);
      setSearchHistory([]);
      return;
    }

    // Search by Site_ID, Cell_name, or any KPI property
    const results = geojsonData.features.filter((f) => {
      const props = f.properties || {};
      return (
        (props.Site_ID && props.Site_ID.toString().toLowerCase().includes(term)) ||
        (props.Cell_name && props.Cell_name.toString().toLowerCase().includes(term)) ||
        Object.values(props).some(
          (v) => v && v.toString && v.toString().toLowerCase().includes(term)
        )
      );
    });

    setSearchResults(results);

    if (results.length > 0) {
      setHighlightedFeature(results[0]);
      setSearchHistory((prev) => [...prev, results[0]]);
    } else {
      setHighlightedFeature(null);
    }
  };

  // === Undo Search (local only) ===
  const handleUndoSearch = () => {
  setSearchHistory((prev) => {
    if (prev.length === 0) return prev; // nothing to undo

    // Remove the last search
    const newHistory = prev.slice(0, -1);

    // Update highlighted feature to the previous one or null
    const previousFeature = newHistory.length > 0 ? newHistory[newHistory.length - 1] : null;
    setHighlightedFeature(previousFeature);

    return newHistory;
  });
};

  // === PLMN Layer (for whole network) ===
  useEffect(() => {
    if (!mapInstance.current || !geojsonData) return;
    // Remove previous PLMN layer/source
    if (mapInstance.current.getLayer('plmn-layer')) mapInstance.current.removeLayer('plmn-layer');
    if (mapInstance.current.getSource('plmn')) mapInstance.current.removeSource('plmn');

    // Add PLMN layer (show all sites/cells)
    mapInstance.current.addSource('plmn', {
      type: 'geojson',
      data: geojsonData
    });

    // mapInstance.current.addLayer({
    //   id: 'plmn-layer',
    //   type: 'circle',
    //   source: 'plmn',
    //   paint: {
    //     'circle-radius': 6,
    //     'circle-color': '#6366f1',
    //     'circle-stroke-width': 2,
    //     'circle-stroke-color': '#fff'
    //   }
    // });
  }, [geojsonData]);


  

  // === Legend Dynamic Selection UI & Logic ===
  const toggleLegend = () => setShowLegend((prev) => !prev);

  // Dynamic legend rendering based on legendType
const renderLegend = () => {
  // === Grid KPI (special case) ===
  if (gridGeoJSON && gridGeoJSON.features?.length > 0) {
    return (
      <>
        <div className="legend-title">Grid KPI (SINR)</div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#fee08b' }}></span>
          SINR ≥ {threshold} (Yellow, Threshold)
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#d73027' }}></span>
          SINR &lt; {threshold} (Red, Problematic)
        </div>
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#1a9850' }}></span>
          SINR &gt; 30 (Green, Good)
        </div>
      </>
    );
  }

  // === Switch by legendType ===
  switch (legendType) {
    // KPI Heatmap
    case 'kpi':
      return (
        <>
          <div className="legend-title">{colorColumn || 'Selected KPI'} Color Ranges</div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#1a9850' }}></span>
            High Value
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#fee08b' }}></span>
            Moderate Value
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: '#d73027' }}></span>
            Low Value
          </div>
        </>
      );

    // Band Colors
    case 'band':
      return (
        <>
          <div className="legend-title">Band Colors</div>
          {BAND_OPTIONS.map(({ value, label }) => (
            <div className="legend-item" key={value}>
              <span
                className="legend-color"
                style={{ backgroundColor: getColorForBand(value) }}
              ></span>
              {label}
            </div>
          ))}
        </>
      );

case "driveTest":
  console.log("Legend Debug (driveTest):", {
    selectedDriveKPI,
    ranges: colorRanges[selectedDriveKPI],
  });

  if (!selectedDriveKPI) {
    return <div className="legend-title">⚠️ No Drive Test KPI selected</div>;
  }
  if (!colorRanges[selectedDriveKPI]) {
    return (
      <div className="legend-title">
        ⚠️ No color ranges defined for {selectedDriveKPI}
      </div>
    );
  }

  return (
    <>
      <div className="legend-title">
        Drive Test KPI: <strong>{selectedDriveKPI}</strong>
      </div>
      {Object.entries(colorRanges[selectedDriveKPI]).map(([color, [min, max]]) => (
        <div
          className="legend-item"
          key={color}
          style={{ display: "flex", alignItems: "center", gap: "6px" }}
        >
          <span
            className="legend-color"
            style={{
              backgroundColor: color,
              width: 16,
              height: 16,
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
          />
          <span>{min} – {max}</span>
        </div>
      ))}
    </>
  );


    default:
      return null;
  }
};


  return (
    <>
      {/* Panel toggles */}
      <div
        style={{
          position: 'fixed',
          top: 37, 
          right: 200, 
          zIndex: 10001,
          display: 'flex',
          gap: '6px',
        }}
      >
        <button
          className="icon-btn"
          title="Toggle Search Panel"
          style={{
            boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            background: showSearchPanel ? '#e6f5ec' : '#fff',
            fontSize: 15,
            transition: 'background 0.2s',
          }}
          onClick={() => setShowSearchPanel((v) => !v)}
        >
          🔍
        </button>
                <button
          className="icon-btn"
          title="Toggle Heatmap Panel"
          style={{
            boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            background: showHeatmapPanel ? '#e6f5ec' : '#fff',
            fontSize: 15,
            transition: 'background 0.2s',
          }}
          onClick={() => setShowHeatmapPanel((v) => !v)}
        >
          🔥
        </button>
      </div>

      {/* Heatmap Controls */}
{showHeatmapPanel && (
  <div
    className="kpi-controls"
    style={{
      display: "flex",
      alignItems: "center",
      gap: "10px",
      background: "#fff",
      padding: "2px 6px",
      borderRadius: "6px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
    }}
  >
    {/* File Upload */}
    <label className="kpi-label" style={{ fontSize: "13px", fontWeight: 500 }}>
      Upload Grid KPI File:
    </label>
    <input
      className="kpi-input"
      type="file"
      accept=".geojson,.json,.csv,.xml"
      onChange={(e) => handleGridHeatmapUpload(e.target.files[0])}
      style={{
        fontSize: "12px",
        maxWidth: "140px",
        padding: "2px",
        
      }}
      
    />
    

{/* KPI Dropdown (shown only after upload) */}
{availableGridKPIs?.length > 0 && (
  <>
    <label className="kpi-label">KPI:</label>
    <select
      className="kpi-select"
      value={selectedKPI || ""}
      onChange={(e) => setSelectedKPI(e.target.value)}
    >
      {availableGridKPIs.map((kpi) => (
        <option key={kpi} value={kpi}>
          {kpi}
        </option>
      ))}
    </select>
  </>
)}


    {/* Threshold Input */}
    <label className="kpi-label" style={{ fontSize: "13px", fontWeight: 500 }}>
      Threshold:
    </label>
    <input
      className="kpi-input"
      type="number"
      value={threshold}
      onChange={(e) => setThreshold(Number(e.target.value))}
      style={{
        width: "70px",
        padding: "4px 6px",
        fontSize: "13px",
        border: "1px solid #ccc",
        borderRadius: "4px",
      }}
    />
  </div>
)}

      {/* Search Bar */}
      {showSearchPanel && (
        <form
          style={{
            color: '#000',
            position: 'absolute',
            top: 18,
            left: 360,
            zIndex: 10,
            background: '#fff',
            padding: '2px 6px',
            borderRadius: '8px',
            boxShadow: '0 1px 5px rgba(0, 0, 0, 0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: '1px solid #e5e7eb',
            minHeight: 38,
          }}
          onSubmit={handleSearch}
        >
          <input
            type="text"
            placeholder="Search Site/Cell/KPI"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            style={{
              color: '#000',
              minWidth: 180,
              margin: 0,
              border: '1px solid #ccc',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 13,
              background: '#f9fafb',
            }}
          />
          <button type="submit"
            className="btn-outline"
            style={{
              padding: '4px 14px',
              borderRadius: 4,
              fontWeight: 500,
              fontSize: 13,
              margin: 0,
            }}>
            Search
          </button>
          <button
            type="button"
            className="btn-outline"
            style={{
              padding: '4px 10px',
              borderRadius: 4,
              fontWeight: 500,
              fontSize: 13,
              margin: 0,
              opacity: searchHistory.length === 0 ? 0.5 : 1,
              cursor: searchHistory.length === 0 ? 'not-allowed' : 'pointer',
            }}
            onClick={handleUndoSearch}
            disabled={searchHistory.length === 0}
            title="Undo search"
          >
            Undo
          </button>
          {searchResults.length > 1 && (
            <select
              className="input"
              style={{
                marginLeft: 8,
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 13,
                minWidth: 120,
                background: '#fff',
                border: '1px solid #ccc',
              }}
              onChange={e => setHighlightedFeature(searchResults[e.target.value])}
            >
              {searchResults.map((f, idx) => (
                <option key={idx} value={idx}>
                  {f.properties.Site_ID || f.properties.Cell_name || 'Sector ' + (idx + 1)}
                </option>
              ))}
            </select>
          )}
        </form>
      )}
      <div ref={mapRef} className="map-container" />
      <button onClick={handleStyleToggle} className="style-toggle-btn" title="Toggle Map Style">
        🛰️
      </button>
      <button
        onClick={handleLightStyleToggle}
        className="style-toggle-btn"
        title="Toggle Light Theme"
        style={{ top: '160px', right: '10px' }}
      >
        💡
      </button>
      <button
        onClick={toggleLegend}
        className="legend-toggle-btn"
        title="Toggle Legend"
        style={{ top: '60px', right: '10px' }}
      >
        📊
      </button>
      <button
        onClick={() => {
          setRulerActive((prev) => !prev);
          rulerGeoJSON.current = { type: 'FeatureCollection', features: [] };
          rulerLinestring.current = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } };
          const map = mapInstance.current;
          const source = map && map.getSource('ruler-geojson');
          if (source) source.setData({ type: 'FeatureCollection', features: [] });
          if (distanceRef.current) distanceRef.current.innerText = '';
        }}
        className="ruler-toggle-btn"
        title="Toggle Ruler Tool"
        style={{
          position: 'absolute',
          top: '160px',
          right: '10px',
          zIndex: 1,
          padding: '3px 3px',
          fontSize: '16px',
          borderRadius: '6px',
          backgroundColor: '#fff',
          boxShadow: '0 1px 5px rgba(0,0,0,0.3)',
          cursor: 'pointer'
        }}
      >
        🧭
      </button>
      <div
        ref={distanceRef}
        id="distance-box"
        style={{
          position: 'absolute',
          bottom: '40px',
          right: '10px',
          background: '#f7f5f550',
          padding: '1px 1px',
          borderRadius: '4px',
          fontWeight: 'bold',
          zIndex: 1,
          color: '#000',
        }}
      ></div>
      {showLegend && (
        <div className="map-legend-popup">
          <select
            value={legendType}
            onChange={e => setLegendType(e.target.value)}
            className="input"
            style={{ marginBottom: '10px', width: '100%' }}
          >
            <option value="kpi">KPI Heatmap</option>
            <option value="band">Band Colors</option>
            <option value="sector">Sector Colors</option>
            <option value="driveTest">Drive Test KPI</option>
          </select>
          {renderLegend()}
        </div>
      )}
    </>
  );
};

export default MapRenderer;