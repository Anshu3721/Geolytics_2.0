import React, { useState, useEffect } from "react";
import Navbar from './components/navbar';
import Sidebar from './components/Sidebar';
import MapRenderer from './components/MapRenderer';
import './App.css';
import './Styles.css';
import 'mapbox-gl/dist/mapbox-gl.css';
import KPIGridUploader from "./components/KPIGridUploader";


function normalizeBand(raw) {
  if (!raw && raw !== 0) return '';
  let s = String(raw).toUpperCase().trim();
  s = s.replace(/\s+/g, '');
  const m = s.match(/N?(\d{1,4})/);
  if (!m) return s;
  return 'N' + m[1];
}


const App = () => {
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/outdoors-v12');
  const [geojsonData, setGeojsonData] = useState(null);
  const [driveTestGeoJSON, setDriveTestGeoJSON] = useState(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bandCellOptions, setBandCellOptions] = useState([]);
  const [siteCellOptions, setSiteCellOptions] = useState([]);
  const [selectedCellBand, setSelectedCellBand] = useState([]);
  const [gridGeoJSON, setGridGeoJSON] = useState(null);

  const [selectedDriveKPI, setSelectedDriveKPI] = useState(null);
  const [gridData, setGridData] = useState(null);






  const [selectedLayerColumn, setSelectedLayerColumn] = useState(null); 
  const [selectedBandColumn, setSelectedBandColumn] = useState(null);   
  const [selectedBandCell, setSelectedBandCell] = useState(null);
  const [legendType, setLegendType] = useState('kpi');
  const [colorRanges, setColorRanges] = useState({});
  const [highlightedFeature, setHighlightedFeature] = useState(null);
  const [activeSubModule, setActiveSubModule] = useState("TPGA02");
  const [selectedProject, setSelectedProject] = useState("Project A");
  const [layerRange, setLayerRange] = useState({ min: null, max: null });
  const [driveLayerRange, setDriveLayerRange] = useState({ min: null, max: null }); // for Drive Test
  const [driveTestColumns, setDriveTestColumns] = useState([]);

  useEffect(() => {
  if (!selectedDriveKPI) return;

  const fetchRange = async () => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/drive-test/column-range?column=${encodeURIComponent(selectedDriveKPI)}`
      );
      if (res.ok) {
        const rangeData = await res.json();
       
        setDriveLayerRange({ min: rangeData.min, max: rangeData.max });
      }
    } catch (err) {
      console.error("❌ Failed to update drive test range:", err);
    }
  };

  fetchRange();
}, [selectedDriveKPI]); 



  // === Computed Color Bands ===
  const colorBands = selectedLayerColumn && colorRanges[selectedLayerColumn]
    ? Object.entries(colorRanges[selectedLayerColumn]).map(([color, [from, to]]) => ({
        color, from, to
      }))
    : [];

  const bandColorBands = selectedBandColumn && colorRanges[selectedBandColumn]
    ? Object.entries(colorRanges[selectedBandColumn]).map(([color, [from, to]]) => ({
        color, from, to
      }))
    : [];
const handleSiteClick = (siteId, allFeatures) => {
  

  const normalize = str => str?.toLowerCase()?.trim();
  const normalizedSiteId = normalize(siteId);

  const bandCells = [];

  for (const f of allFeatures) {
    const props = f?.properties || {};
    const fSiteId = normalize(props.site_id || props.Site_ID || props.SITEID);

    // Only process matching site
    if (fSiteId !== normalizedSiteId) continue;

    const band = props.BAND || props.band || props.Band || 'default';
    const cellname = props.cellname || props.Cell_name;

    if (cellname) {
      bandCells.push({ band, cellname });
    }
  }

  // Sort once — highest band number first
  bandCells.sort((a, b) => {
    const numA = parseInt(a.band.replace(/\D/g, ''), 10) || 0;
    const numB = parseInt(b.band.replace(/\D/g, ''), 10) || 0;
    return numB - numA;
  });

  

  setSelectedBandCell(null);
  setBandCellOptions(bandCells);
};





  // === PHDB Query Handler ===
const handleGenerateMap = async (payload) => {
  setLoading(true);
  try {
    const finalPayload = {
      ...payload,
      kpiColumn: selectedLayerColumn,
    };

    const res = await fetch(`${import.meta.env.VITE_API_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(finalPayload),
    });

    if (!res.ok) throw new Error('Failed to fetch PHDB data');
    const data = await res.json();

    console.log("✅ Fetched GeoJSON Sample:", data.features?.[0]?.properties);

    // Fallback to detect band from cellname if no column provided
    const getBandFromCellname = (name) => {
      if (!name) return 'default';
      const match = name.match(/([LN]\d{2}[A-Z]?)/i); // e.g. L18, L21, N07C, N36A
      return match ? match[0].toUpperCase() : 'default';
    };

    // Inject band into all features, preferring selectedBandColumn
    const parsedFeatures = data.features.map(f => {
      const props = f.properties || {};
      const bandValue = selectedBandColumn && props[selectedBandColumn]
        ? props[selectedBandColumn]
        : props.BAND || props.band || props.Band || getBandFromCellname(props.cellname || props.Cell_name);

      return {
        ...f,
        properties: {
          ...props,
          band: normalizeBand(bandValue) // ✅ Always normalize
        }
      };
    });

    // Auto-load all bands for dropdown (no site click needed)
    if (parsedFeatures && Array.isArray(parsedFeatures)) {
      const opts = parsedFeatures.map(f => {
        const props = f.properties || {};
        const bandRaw = selectedBandColumn && props[selectedBandColumn]
          ? props[selectedBandColumn]
          : props.BAND || props.band || props.Band;
        const band = normalizeBand(bandRaw);
        const cellname = props.cellname || props.Cell_name || props.CELLNAME || '';
        return { band, cellname };
      });

      setBandCellOptions(
        opts
          .filter(o => o.band && o.cellname)
          .sort((a, b) => {
            const numA = parseInt(a.band.replace(/\D/g, ''), 10) || 0;
            const numB = parseInt(b.band.replace(/\D/g, ''), 10) || 0;
            return numB - numA;
          })
      );
    }

    setGeojsonData({ ...data, features: parsedFeatures });
    setDriveTestGeoJSON(null);
    setHighlightedFeature(null);

  } catch (err) {
    console.error('Error generating map:', err);
    alert('❌ Failed to load PHDB map data.');
  } finally {
    setLoading(false);
  }
};




  // === Drive Test Upload Handler ===
const handleDriveTestUpload = async (file) => {
  if (!file) {
    alert('⚠️ Please upload a file.');
    return;
  }

  setLoading(true);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/upload-drive-test`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();

    // ✅ Save KPI columns for dropdown
    setDriveTestColumns(data.available_kpis || []);

    // ✅ Store only the GeoJSON
    setDriveTestGeoJSON(data.geojson);

    // ❌ Don’t pick KPI yet — let user select from dropdown

  } catch (err) {
    console.error('Upload error:', err);
    alert('❌ Drive test file upload failed.');
  } finally {
    setLoading(false);
  }
};


  // === Export Data Handler ===
  const onExportData = async (format) => {
    const exportData = geojsonData || driveTestGeoJSON;
    if (!exportData) {
      alert('⚠️ No data available to export.');
      return;
    }

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, data: exportData }),
      });

      if (!response.ok) throw new Error(`Export ${format} failed`);

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `geolytics-export.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export failed:', err);
      alert(`❌ Export ${format.toUpperCase()} failed.`);
    }
  };

  const handleSidebarSearch = (feature) => {
    setHighlightedFeature(feature);
  };

  return (
    <div className="app-container">
      {/* Top Navigation */}
      <Navbar
        activeSubModule={activeSubModule}
        setActiveSubModule={setActiveSubModule}
        selectedProject={selectedProject}
        setSelectedProject={setSelectedProject}
      />

      {/* Sidebar Hover Zone */}
      <div
        className="sidebar-hover-zone"
        onMouseEnter={() => setSidebarVisible(true)}
      />

      {/* Slide-out Sidebar */}
      <div
        className={`sidebar ${sidebarVisible ? 'show' : ''}`}
        onMouseLeave={() => setSidebarVisible(false)}
      >
<Sidebar
  driveTestColumns={driveTestColumns}
  setDriveTestColumns={setDriveTestColumns}
  geoJsonData={geojsonData}
  setDriveTestGeojson={setDriveTestGeoJSON}
  driveTestData={driveTestGeoJSON}
  onGenerateMap={handleGenerateMap}
  onExportData={onExportData}
  onDriveTestUpload={handleDriveTestUpload}
  onSearch={handleSidebarSearch}

  selectedLayerColumn={selectedLayerColumn}
  setSelectedLayerColumn={setSelectedLayerColumn}
  selectedBandColumn={selectedBandColumn}
  setSelectedBandColumn={setSelectedBandColumn}
  legendType={legendType}
  setLegendType={setLegendType}
  colorRanges={colorRanges}
  setColorRanges={setColorRanges}
  colorBands={colorBands}
  bandColorBands={bandColorBands}

  bandCellOptions={bandCellOptions}
  setBandCellOptions={setBandCellOptions}
  selectedBandCell={selectedBandCell}
  setSelectedBandCell={setSelectedBandCell}
  setSelectedCellBand={setSelectedCellBand}

  siteCellOptions={siteCellOptions}
  setSiteCellOptions={setSiteCellOptions}
  onGridData={setGridGeoJSON}
  layerRange={layerRange}
  setLayerRange={setLayerRange}
  driveLayerRange={driveLayerRange}
  setDriveLayerRange={setDriveLayerRange}
  setGridData={setGridData}
  selectedDriveKPI={selectedDriveKPI}
  setSelectedDriveKPI={setSelectedDriveKPI}
  
  
  
 
/>

      </div>

      {/* Map Display */}
      <div className="map-container">
        <MapRenderer
  mapStyle={mapStyle}
  geojsonData={geojsonData}
  driveTestGeoJSON={driveTestGeoJSON}
  highlightedFeature={highlightedFeature}
  selectedKPI={selectedLayerColumn}
  selectedBandColumn={selectedBandColumn}
  legendType={legendType}
  colorColumn={selectedLayerColumn}
  colorBands={colorBands}
  bandColorBands={bandColorBands} 
  colorRanges={colorRanges}
  selectedBandCell={selectedBandCell}
  selectedCellBand={selectedCellBand}
   gridGeoJSON={gridGeoJSON} 
   selectedDriveKPI={selectedDriveKPI}
   layerRange={layerRange}
  onSiteClick={handleSiteClick}
  driveLayerRange={driveLayerRange}
  gridData={gridData}

  
   
  

   />

      </div>

      {/* Loader Overlay */}
      {loading && <div className="map-loader-spinner" />}
    </div>
  );
};

export default App;
