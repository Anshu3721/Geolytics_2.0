import React, { useState } from "react";
import Navbar from './components/navbar';
import Sidebar from './components/Sidebar';
import MapRenderer from './components/MapRenderer';
import './App.css';
import './Styles.css';
import 'mapbox-gl/dist/mapbox-gl.css';

const App = () => {
  const [geojsonData, setGeojsonData] = useState(null);             // PHDB data
  const [driveTestGeoJSON, setDriveTestGeoJSON] = useState(null);   // Drive Test data
  const [sidebarVisible, setSidebarVisible] = useState(false);      // Hover-sidebar
  const [loading, setLoading] = useState(false);                    // Loading spinner

  // === Search Highlight State ===
  const [highlightedFeature, setHighlightedFeature] = useState(null);

  // === PHDB Query Handler ===
  const handleGenerateMap = async (payload) => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to fetch PHDB data');
      const data = await res.json();
      setGeojsonData(data);               // Update state
      setDriveTestGeoJSON(null);         // Clear drive test overlay if needed
      setHighlightedFeature(null);       // Clear search highlight on new map
    } catch (err) {
      console.error('Error generating map:', err);
      alert('❌ Failed to load PHDB map data.');
    } finally {
      setLoading(false);
    }
  };

  // === Drive Test Upload Handler ===
  // --- UPDATED: Do NOT clear PHDB data when uploading drive test log ---
  const handleDriveTestUpload = async (file, selectedKPI) => {
    if (!file || !selectedKPI) {
      alert('⚠️ Please upload a file and select a KPI.');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('kpi', selectedKPI);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/upload-drive-test`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setDriveTestGeoJSON(data);        
      
    } catch (err) {
      console.error('Upload error:', err);
      alert('❌ Drive test file upload failed.');
    } finally {
      setLoading(false);
    }
  };

  // === Export Data as CSV or KML ===
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

  // === Search Handler for Sidebar ===
  
  const handleSidebarSearch = (feature) => {
    setHighlightedFeature(feature);
  };

  return (
    <div className="app-container">
      {/* Top Navigation Bar */}
      <Navbar />

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
          geoJsonData={geojsonData}
          setDriveTestGeojson={setDriveTestGeoJSON}
          driveTestData={driveTestGeoJSON}
          onGenerateMap={handleGenerateMap}
          onExportData={onExportData}
          onDriveTestUpload={handleDriveTestUpload}
          onSearch={handleSidebarSearch}
        />
      </div>

      {/* Main Map Renderer */}
      <div className="map-container">
        <MapRenderer 
          geojsonData={geojsonData}
          driveTestGeoJSON={driveTestGeoJSON}
          driveTestData={driveTestGeoJSON}
          highlightedFeature={highlightedFeature}
        />
      </div>

      {/* Loading Spinner Overlay */}
      {loading && <div className="map-loader-spinner" />}
    </div>
  );
};

export default App;