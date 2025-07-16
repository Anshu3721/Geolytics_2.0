import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import '../Styles.css';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// Utility: Create a sector (arc) polygon using Turf.js
const createSectorPolygon = (center, radiusKm, azimuth, beamWidth = 120) => {
  const points = [center];
  const startAngle = azimuth - beamWidth / 2;
  const endAngle = azimuth + beamWidth / 2;

  for (let angle = startAngle; angle <= endAngle; angle += 5) {
    const destination = turf.destination(center, radiusKm, angle, { units: 'kilometers' });
    points.push(destination.geometry.coordinates);
  }

  points.push(center); // close the polygon
  return turf.polygon([points]);
};

const MapRenderer = ({ geojsonData }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/outdoors-v12');

  // Convert points to sector polygons
  const generateSectorGeoJSON = (geojson) => {
    const features = [];

    geojson?.features?.forEach((feature) => {
      const coords = feature.geometry.coordinates;
      const props = feature.properties;
      const azimuth = parseFloat(props?.azimuth ?? props?.Azimuth);

      if (!coords || isNaN(azimuth)) return;

      const sector = createSectorPolygon(coords, 0.3, azimuth);

      features.push({
        type: 'Feature',
        geometry: sector.geometry,
        properties: props,
      });
    });

    return {
      type: 'FeatureCollection',
      features,
    };
  };

  // Add or update the sector layer
  const addSectorLayer = (map, data) => {
    const sectorGeoJSON = generateSectorGeoJSON(data);

    if (!map.getSource('sectors')) {
      map.addSource('sectors', {
        type: 'geojson',
        data: sectorGeoJSON,
      });
    }

    if (!map.getLayer('sector-layer')) {
      map.addLayer({
        id: 'sector-layer',
        type: 'fill',
        source: 'sectors',
        paint: {
          'fill-color': '#1d4ed8',
          'fill-opacity': 0.5,
          'fill-outline-color': '#000000',
        },
      });

      map.on('click', 'sector-layer', (e) => {
        const props = e.features[0].properties;
        const coordinates = e.lngLat;
        const popupHtml = `
  <div class="popup-table-bordered">
    <table>
      <thead>
        <tr>
          <th>Field</th>
          <th>Value</th>
        </tr>
      </thead>
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
    } else {
      map.getSource('sectors').setData(sectorGeoJSON);
    }
  };

  // Map initialization
  useEffect(() => {
    if (mapInstance.current) return;

    mapInstance.current = new mapboxgl.Map({
      container: mapRef.current,
      style: mapStyle,
      center: [78.9629, 20.5937],
      zoom: 4,
    });

    mapInstance.current.addControl(new mapboxgl.NavigationControl());

    mapInstance.current.on('load', () => {
      mapInstance.current.resize();
      if (geojsonData) {
        addSectorLayer(mapInstance.current, geojsonData);
      }
    });
  }, []);

  // When geojson changes
  useEffect(() => {
    if (
      mapInstance.current &&
      geojsonData?.features?.length > 0
    ) {
      addSectorLayer(mapInstance.current, geojsonData);

      try {
        const bounds = turf.bbox(generateSectorGeoJSON(geojsonData));
        mapInstance.current.fitBounds(bounds, { padding: 40, maxZoom: 15 });
      } catch (err) {
        console.warn('Bounding error:', err);
      }
    }
  }, [geojsonData]);

  // Toggle map style
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
      });
    }
  };

  return (
    <>
      <div ref={mapRef} className="map-container" />
      <button
        onClick={handleStyleToggle}
        className="style-toggle-btn"
        title="Toggle Map Style"
      >
        🛰️
      </button>
    </>
  );
};

export default MapRenderer;
