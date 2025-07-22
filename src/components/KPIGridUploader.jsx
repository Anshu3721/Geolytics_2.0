import React, { useState } from 'react';
import Papa from 'papaparse';

const KPIGridUploader = () => {
  const [file, setFile] = useState(null);
  const [kpiColumn, setKpiColumn] = useState('');
  const [columns, setColumns] = useState([]);
  const [geojson, setGeojson] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);

    // Parse CSV to get columns
    Papa.parse(selectedFile, {
      header: true,
      dynamicTyping: true,
      complete: (results) => {
        const headers = Object.keys(results.data[0] || {});
        setColumns(headers);
      },
    });
  };

  const convertToGeoJSON = (csvData) => {
    const features = csvData.map(row => {
      const lat = parseFloat(row.Lat) || parseFloat(row.latitude);
      const lon = parseFloat(row.Long) || parseFloat(row.longitude) || parseFloat(row.Lon);

      if (!lat || !lon) return null;

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lon, lat],
        },
        properties: row,
      };
    }).filter(Boolean);

    return {
      type: 'FeatureCollection',
      features,
    };
  };

  const handleSubmit = async () => {
    if (!file || !kpiColumn) {
      alert('Please select a file and KPI column');
      return;
    }

    // Parse CSV and convert to GeoJSON
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      complete: async (results) => {
        const geojsonData = convertToGeoJSON(results.data);

        setGeojson(geojsonData);

        // Send to backend as .geojson file in FormData
        const blob = new Blob([JSON.stringify(geojsonData)], { type: 'application/geo+json' });
        const formData = new FormData();
        formData.append('file', blob, 'converted.geojson');

        try {
          const response = await fetch(`http://localhost:8000/generate-grid?kpi=${kpiColumn}`, {
            method: 'POST',
            body: formData,
          });

          const result = await response.json();
          console.log('Grid GeoJSON Result:', result);
          alert('Grid generated successfully. Check console.');
        } catch (err) {
          console.error('Upload failed:', err);
          alert('Error generating grid.');
        }
      },
    });
  };

  return (
    <div style={{ padding: '1rem', backgroundColor: '#f4f4f4' }}>
      <h3>Upload Drive Test CSV for Grid KPI Heatmap</h3>
      <input type="file" accept=".csv" onChange={handleFileChange} />
      {columns.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <label>Select KPI Column:</label>
          <select onChange={(e) => setKpiColumn(e.target.value)}>
            <option value="">-- Select KPI --</option>
            {columns.map(col => (
              <option key={col} value={col}>{col}</option>
            ))}
          </select>
        </div>
      )}
      <button
        onClick={handleSubmit}
        style={{ marginTop: '1rem', padding: '8px 12px', backgroundColor: '#28a745', color: '#fff', border: 'none' }}
      >
        Generate Grid Map
      </button>
    </div>
  );
};

export default KPIGridUploader;
