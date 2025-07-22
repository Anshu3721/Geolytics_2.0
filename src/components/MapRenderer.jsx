import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../Styles.css';
import KPIGridUploader from './KPIGridUploader';


mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

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

// === Color by Band ===
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

const MapRenderer = ({ geojsonData, driveTestGeoJSON, highlightedFeature: externalHighlight }) => {
  const [rulerActive, setRulerActive] = useState(false);
  const rulerGeoJSON = useRef({ type: 'FeatureCollection', features: [] });
  const rulerLinestring = useRef({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  const distanceRef = useRef(null);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);

  // --- Search State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [highlightedFeature, setHighlightedFeature] = useState(null);
  const [searchHistory, setSearchHistory] = useState([]);

  // --- KPI Heatmap State ---
  const [selectedKPI, setSelectedKPI] = useState('SINR');
  const [threshold, setThreshold] = useState(17);

  // --- Panel Toggles ---
  const [showHeatmapPanel, setShowHeatmapPanel] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);

  // --- Sync with external highlight (from Sidebar search) ---
  useEffect(() => {
    if (externalHighlight !== undefined) {
      setHighlightedFeature(externalHighlight);
      if (externalHighlight) setSearchHistory((prev) => [...prev, externalHighlight]);
    }
  }, [externalHighlight]);

  // --- Fix: Use ref to always have latest rulerActive in map handlers ---
  const rulerActiveRef = useRef(rulerActive);
  useEffect(() => {
    rulerActiveRef.current = rulerActive;
  }, [rulerActive]);

  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/outdoors-v12');

  // === Generate Sectors ===
  const generateSectorGeoJSON = (geojson) => {
    const grouped = new Map();

    geojson?.features?.forEach((feature) => {
      const coords = feature.geometry.coordinates;
      const props = feature.properties;
      const azimuth = parseFloat(props?.azimuth ?? props?.Azimuth);
      const band = props?.band ?? props?.Band ?? 'default';

      if (!coords || isNaN(azimuth)) return;

      const siteBandKey = JSON.stringify(coords) + '|' + band;

      if (!grouped.has(siteBandKey)) grouped.set(siteBandKey, []);

      if (grouped.get(siteBandKey).length < 3) {
        const sector = createSectorPolygon(coords, 0.3, azimuth);
        grouped.get(siteBandKey).push({
          type: 'Feature',
          geometry: sector.geometry,
          properties: {
            ...props,
            band,
            color: getColorForBand(band),
          },
        });
      }
    });

    return {
      type: 'FeatureCollection',
      features: Array.from(grouped.values()).flat(),
    };
  };

  // === Add Sector Layer ===
  const addSectorLayer = (map, data) => {
    const sectorGeoJSON = generateSectorGeoJSON(data);

    if (!map.getSource('sectors')) {
      map.addSource('sectors', {
        type: 'geojson',
        data: sectorGeoJSON,
      });
    } else {
      map.getSource('sectors').setData(sectorGeoJSON);
    }

    if (!map.getLayer('sector-layer')) {
      map.addLayer({
        id: 'sector-layer',
        type: 'fill',
        source: 'sectors',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.6,
          'fill-outline-color': '#000000',
        },
      });

      map.on('click', 'sector-layer', (e) => {
        const props = e.features[0].properties;
        const coordinates = e.lngLat;
        const popupHtml = `
          <div class="popup-table-bordered">
            <table>
              <thead><tr><th>Field</th><th>Value</th></tr></thead>
              <tbody>
                ${Object.entries(props)
                  .map(([key, val]) => `<tr><td>${key}</td><td>${val}</td></tr>`)
                  .join('')}
              </tbody>
            </table>
          </div>
        `;
        new mapboxgl.Popup()
          .setLngLat(coordinates)
          .setHTML(popupHtml)
          .addTo(map);
      });

      map.on('mouseenter', 'sector-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'sector-layer', () => {
        map.getCanvas().style.cursor = '';
      });
    }
  };

  // === Add Highlight Layer for Search ===
  const addHighlightLayer = (map, feature) => {
    if (!feature) {
      if (map.getLayer('highlight-layer')) map.removeLayer('highlight-layer');
      if (map.getSource('highlight')) map.removeSource('highlight');
      return;
    }
    // Remove previous highlight
    if (map.getLayer('highlight-layer')) map.removeLayer('highlight-layer');
    if (map.getSource('highlight')) map.removeSource('highlight');

    map.addSource('highlight', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [feature]
      }
    });

    map.addLayer({
      id: 'highlight-layer',
      type: 'circle',
      source: 'highlight',
      paint: {
        'circle-radius': 14,
        'circle-color': '#ff0000',
        'circle-opacity': 0.7,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#fff'
      }
    });

    // Center and zoom to the feature
    if (feature.geometry.type === 'Point') {
      map.flyTo({ center: feature.geometry.coordinates, zoom: 16 });
    } else if (feature.geometry.type === 'Polygon') {
      const bbox = turf.bbox(feature);
      map.fitBounds(bbox, { padding: 80, maxZoom: 16 });
    }
  };

  // === Add Drive Test Layer ===
  const addDriveTestLayer = () => {
    const map = mapInstance.current;
    if (!map || !driveTestGeoJSON || !driveTestGeoJSON.features || driveTestGeoJSON.features.length < 2) return;

    // Remove previous drive test layers/sources if exist
    if (map.getLayer('drive-test-line')) map.removeLayer('drive-test-line');
    if (map.getSource('drive-test')) map.removeSource('drive-test');

    // Get selected KPI from driveTestGeoJSON (backend returns available_kpis and features)
    // We'll use the first available KPI or fallback to 'RSRP'
    const availableKPIs = driveTestGeoJSON.available_kpis || [];
    const selectedKPI = availableKPIs.length > 0 ? availableKPIs[0] : 'RSRP';

    // Sort by timestamp if available
    const sorted = [...driveTestGeoJSON.features].sort((a, b) => {
      const ta = a.properties.timestamp || a.properties.time || a.properties.date || 0;
      const tb = b.properties.timestamp || b.properties.time || b.properties.date || 0;
      return new Date(ta) - new Date(tb);
    });

    // Extract coordinates and KPI values
    const coordinates = sorted.map(f => f.geometry.coordinates);
    const kpiValues = sorted.map(f => f.properties[selectedKPI]);

    // Create a LineString with KPI values as property
    const avgKPI = kpiValues.reduce((a, b) => a + b, 0) / kpiValues.length;

    const lineGeoJSON = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates
        },
        properties: {
          [selectedKPI]: avgKPI
        }
      }]
    };

    map.addSource('drive-test', {
      type: 'geojson',
      data: lineGeoJSON
    });

    map.addLayer({
      id: 'drive-test-line',
      type: 'line',
      source: 'drive-test',
      paint: {
        'line-width': 4,
        'line-color': [
          'interpolate',
          ['linear'],
          ['get', selectedKPI],
          -130, '#d73027',
          -100, '#fc8d59',
          -85, '#fee08b',
          -70, '#d9ef8b',
          -60, '#91cf60',
          -50, '#1a9850'
        ],
        'line-opacity': 0.9
      }
    });
  };

  // === Add Heatmap Layer ===
  const addHeatmapLayer = (map, data, kpi, thresholdValue) => {
    // Remove previous heatmap if exists
    if (map.getLayer('kpi-heatmap')) map.removeLayer('kpi-heatmap');
    if (map.getSource('kpi-heat')) map.removeSource('kpi-heat');

    // Filter features with valid KPI value
    const features = (data?.features || []).filter(
      f => typeof f.properties[kpi] === 'number'
    );

    const geojson = {
      type: 'FeatureCollection',
      features
    };

    map.addSource('kpi-heat', {
      type: 'geojson',
      data: geojson
    });

    map.addLayer({
      id: 'kpi-heatmap',
      type: 'heatmap',
      source: 'kpi-heat',
      maxzoom: 15,
      paint: {
        // Weight by KPI value and threshold
        'heatmap-weight': [
          'interpolate',
          ['linear'],
          ['get', kpi],
          thresholdValue, 1,
          thresholdValue + 10, 0
        ],
        'heatmap-intensity': 1.2,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(33,102,172,0)',
          0.2, 'rgb(103,169,207)',
          0.4, 'rgb(209,229,240)',
          0.6, 'rgb(253,219,199)',
          0.8, 'rgb(239,138,98)',
          1, 'rgb(178,24,43)'
        ],
        'heatmap-radius': 22,
        'heatmap-opacity': 0.7
      }
    });
  };

  // === Map Init ===
  useEffect(() => {
    if (mapInstance.current) return;

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: mapStyle,
      center: [78.9629, 20.5937],
      zoom: 4,
    });

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

      // Add point (circle) on map click if ruler is active
      map.on('click', (e) => {
        if (!rulerActiveRef.current) return;

        const coords = [e.lngLat.lng, e.lngLat.lat];

        rulerGeoJSON.current.features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: coords,
          },
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

      // Remove any point when its circle is clicked
      map.on('click', 'measure-points', (e) => {
        if (!rulerActiveRef.current) return;
        if (!e.features || e.features.length === 0) return;

        // Get the clicked point's coordinates
        const clickedCoords = e.features[0].geometry.coordinates;
        const points = rulerGeoJSON.current.features;

        // Find the index of the clicked point
        const idx = points.findIndex(
          (pt) =>
            pt.geometry.type === 'Point' &&
            pt.geometry.coordinates[0] === clickedCoords[0] &&
            pt.geometry.coordinates[1] === clickedCoords[1]
        );

        if (idx !== -1) {
          // Remove the point
          points.splice(idx, 1);
          // Remove the corresponding coordinate from the linestring
          rulerLinestring.current.geometry.coordinates.splice(idx, 1);

          // Update distance
          const distance = turf.length(rulerLinestring.current);
          if (distanceRef.current) {
            distanceRef.current.innerText = points.length
              ? `📏 ${distance.toFixed(2)} km`
              : '';
          }

          // Update source
          if (map.getSource('ruler-geojson')) {
            map.getSource('ruler-geojson').setData({
              type: 'FeatureCollection',
              features: [...points, rulerLinestring.current],
            });
          }
        }

        // Prevent map click event from firing
        e.originalEvent.cancelBubble = true;
      });

      map.on('mousemove', (e) => {
        if (!rulerActiveRef.current) return;
        map.getCanvas().style.cursor = 'crosshair';
      });
    });
  }, [mapStyle]);

  // === On GeoJSON Update (Sector) ===
  useEffect(() => {
    if (mapInstance.current && geojsonData?.features?.length > 0) {
      addSectorLayer(mapInstance.current, geojsonData);

      try {
        const bounds = turf.bbox(generateSectorGeoJSON(geojsonData));
        mapInstance.current.fitBounds(bounds, { padding: 40, maxZoom: 15 });
      } catch (err) {
        console.warn('Bounding error:', err);
      }
    }
  }, [geojsonData]);

  // === On Drive Test Update ===
  useEffect(() => {
    if (mapInstance.current && driveTestGeoJSON && driveTestGeoJSON.features?.length > 1) {
      addDriveTestLayer();
    }
  }, [driveTestGeoJSON]);

  // === On Heatmap Update ===
  useEffect(() => {
    if (mapInstance.current && geojsonData?.features?.length > 0 && selectedKPI) {
      addHeatmapLayer(mapInstance.current, geojsonData, selectedKPI, threshold);
    }
    // eslint-disable-next-line
  }, [geojsonData, selectedKPI, threshold]);

  // === Highlight on Search (local or external) ===
  useEffect(() => {
    if (mapInstance.current) {
      addHighlightLayer(mapInstance.current, highlightedFeature);
    }
  }, [highlightedFeature]);

  // === Toggle Map Style ===
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
      const newHistory = prev.slice(0, -1);
      setHighlightedFeature(newHistory.length > 0 ? newHistory[newHistory.length - 1] : null);
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

    mapInstance.current.addLayer({
      id: 'plmn-layer',
      type: 'circle',
      source: 'plmn',
      paint: {
        'circle-radius': 6,
        'circle-color': '#6366f1',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff'
      }
    });
  }, [geojsonData]);

  const [showLegend, setShowLegend] = useState(false);

  const toggleLegend = () => {
    setShowLegend((prev) => !prev);
  };

  return (
    <>
      
      <div
        style={{
          position: 'fixed',
          top: 60, 
          right: 104, 
          zIndex: 10001,
          display: 'flex',
          gap: '6px',
        }}
      >
        <button
          className=" icon-btn"
          title="Toggle Search Panel"
          style={{

            boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            background: showSearchPanel ? '#e6f5ec' : '#fff',
            // border: '1.5px solid #1c4532',
            fontSize: 15,
            transition: 'background 0.2s',
          }}
          onClick={() => setShowSearchPanel((v) => !v)}
        >
          🔍
        </button>
        <button
          className=" icon-btn"
          title="Toggle Heatmap Panel"
          style={{
            boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
            background: showHeatmapPanel ? '#e6f5ec' : '#fff',
            // border: '1.5px solid #1c4532',
            fontSize: 15,
            transition: 'background 0.2s',
          }}
          onClick={() => setShowHeatmapPanel((v) => !v)}
        >
          🔥
        </button>
      </div>

      {/* KPI/Threshold Controls */}
      {showHeatmapPanel && (
        <div className="kpi-controls">
          <label className="kpi-label">KPI:</label>
          <select
            className="kpi-select"
            value={selectedKPI}
            onChange={e => setSelectedKPI(e.target.value)}
          >
            {KPI_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <label className="kpi-label">Threshold:</label>
          <input
            className="kpi-input"
            type="number"
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
          />
        </div>
      )}

      {/* Search Bar */}
      {showSearchPanel && (
        <form
          style={{
            color: '#000',
            position: 'absolute',
            top: 30,
            left: 600,
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
          <div className="legend-title">{selectedKPI} Heatmap Legend</div>
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
         </div>
       )}
    </>
  );
};

export default MapRenderer;