// src/App.jsx
import React, { useState } from 'react';
import Navbar from './components/navbar';
import Sidebar from './components/Sidebar';
import MapRenderer from './components/MapRenderer';
import './App.css';
import './Styles.css';
import 'mapbox-gl/dist/mapbox-gl.css';

const App = () => {
  const [geojsonData, setGeojsonData] = useState(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [loading, setLoading] = useState(false); // 🌀 Loader state

  const handleGenerateMap = async (payload) => {
    setLoading(true); // Show loader

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to fetch map data');
      const data = await res.json();
      setGeojsonData(data);
    } catch (err) {
      console.error('Error generating map:', err);
      alert('Failed to load map data. Check console for error.');
    } finally {
      setLoading(false); // Hide loader
    }

    console.log("Received payload from Sidebar:", payload);
  };

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <Navbar />

      {/* Hover zone to trigger sidebar */}
      <div
        className="sidebar-hover-zone"
        onMouseEnter={() => setSidebarVisible(true)}
      ></div>

      {/* Sidebar that slides in/out */}
      <div
        className={`sidebar ${sidebarVisible ? 'show' : ''}`}
        onMouseLeave={() => setSidebarVisible(false)}
      >
        <Sidebar onGenerateMap={handleGenerateMap} />
      </div>

      {/* Map always full screen */}
      <div className="map-container">
        <MapRenderer geojsonData={geojsonData} />
      </div>

      {/* Loader */}
      {loading && (
        <div className="map-loader-spinner" />
      )}
    </div>
  );
};

export default App;
