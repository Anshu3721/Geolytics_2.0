import React, { useState, useEffect, useRef } from 'react';
import './Styles.css';


const Sidebar = ({ onGenerateMap, geoJsonData, onDriveTestUpload }) => {
  const [tables, setTables] = useState([]);
  const [columns, setColumns] = useState([]);
  const [targetColumns, setTargetColumns] = useState([]);
  const [driveTestFile, setDriveTestFile] = useState(null);
  const [availableDriveKPIs, setAvailableDriveKPIs] = useState([]);
  const [selectedDriveKPI, setSelectedDriveKPI] = useState('RSRP');

  const [phdbTable, setPhdbTable] = useState('');
  const [targetTable, setTargetTable] = useState('');
  const [requiredCols, setRequiredCols] = useState({
    site_id: 'Site_ID',
    cellname: 'Cell_name',
    lat: 'Lat',
    lon: 'Long',
    azimuth: 'Azimuth'
  });

  const [popupColumns, setPopupColumns] = useState([]);
  const [targetColsSelected, setTargetColsSelected] = useState([]);
  const [joinOn, setJoinOn] = useState({ physical: '', target: '' });

  const [loadFilterTemplate, setLoadFilterTemplate] = useState('');
  const [layerColumn, setLayerColumn] = useState('');
  const [bandColumn, setBandColumn] = useState('');
  const [kpiColumn, setKpiColumn] = useState('');
  const [templateName, setTemplateName] = useState('');

  const [showDropdowns, setShowDropdowns] = useState({});
  const dropdownRefs = useRef({});
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [colorRanges, setColorRanges] = useState({});
  const [layerRange, setLayerRange] = useState({ min: null, max: null });
  const [validJoinOptions, setValidJoinOptions] = useState({ physical: [], target: [] });

  // --- Export Handlers ---
  const handleExportCSV = () => {
    if (!geoJsonData || !geoJsonData.features) {
      alert("No GeoJSON data available.");
      return;
    }
    const headers = Object.keys(geoJsonData.features[0].properties);
    const csvRows = [
      headers.join(","),
      ...geoJsonData.features.map((f) =>
        headers.map((h) => JSON.stringify(f.properties[h] ?? "")).join(",")
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "data.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportKML = () => {
    if (!geoJsonData || !geoJsonData.features) {
      alert("No GeoJSON data available.");
      return;
    }
    const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>`;
    const kmlFooter = `</Document></kml>`;
    const placemarks = geoJsonData.features
      .map((f) => {
        const { geometry, properties } = f;
        if (geometry.type !== "Point") return "";
        const [lon, lat] = geometry.coordinates;
        const name = properties["Site_ID"] || "Point";
        return `<Placemark><name>${name}</name><Point><coordinates>${lon},${lat},0</coordinates></Point></Placemark>`;
      })
      .join("");
    const kmlContent = `${kmlHeader}${placemarks}${kmlFooter}`;
    const blob = new Blob([kmlContent], {
      type: "application/vnd.google-earth.kml+xml",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "data.kml";
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (columns.length && targetColumns.length) {
      const intersection = columns.filter((col) => targetColumns.includes(col));
      setValidJoinOptions({ physical: intersection, target: intersection });
      if (!joinOn.physical || !intersection.includes(joinOn.physical)) {
        setJoinOn((prev) => ({ ...prev, physical: intersection[0] || '' }));
      }
      if (!joinOn.target || !intersection.includes(joinOn.target)) {
        setJoinOn((prev) => ({ ...prev, target: intersection[0] || '' }));
      }
    }
  }, [columns, targetColumns]);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/templates`)
      .then((res) => res.json())
      .then(setSavedTemplates)
      .catch(console.error);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      Object.keys(dropdownRefs.current).forEach((key) => {
        if (dropdownRefs.current[key] && !dropdownRefs.current[key].contains(e.target)) {
          setShowDropdowns((prev) => ({ ...prev, [key]: false }));
        }
      });
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/tables`)
      .then((res) => res.json())
      .then(setTables)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!phdbTable) return;
    fetch(`${import.meta.env.VITE_API_URL}/columns/${phdbTable}`)
      .then((res) => res.json())
      .then((fetchedCols) => {
        setColumns(fetchedCols);
        setRequiredCols((prev) => ({
          site_id: fetchedCols.includes('Site_ID')
            ? 'Site_ID'
            : fetchedCols.includes('D2EL02')
            ? 'D2EL02'
            : '',
          cellname: fetchedCols.includes('Cell_name')
            ? 'Cell_name'
            : fetchedCols.includes('D2EL01')
            ? 'D2EL01'
            : '',
          lat: fetchedCols.includes('Lat') ? 'Lat' : '',
          lon: fetchedCols.includes('Long') ? 'Long' : '',
          azimuth: fetchedCols.includes('Azimuth') ? 'Azimuth' : '',
        }));
      })
      .catch(console.error);
  }, [phdbTable]);

  useEffect(() => {
    if (!targetTable) return;
    fetch(`${import.meta.env.VITE_API_URL}/columns/${targetTable}`)
      .then((res) => res.json())
      .then(setTargetColumns)
      .catch(console.error);
  }, [targetTable]);

  // --- Drive Test Upload Handler (calls parent handler and fetches KPIs) ---
  const handleDriveTestFileChange = async (e) => {
    const file = e.target.files[0];
    setDriveTestFile(file);
    if (file) {
      // Upload file to backend to get available KPIs
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kpi", selectedDriveKPI);
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/upload-drive-test`, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) throw new Error(`Error: ${response.status}`);
        const result = await response.json();
        setAvailableDriveKPIs(result.available_kpis || []);
        if (result.available_kpis && result.available_kpis.length > 0) {
          setSelectedDriveKPI(result.available_kpis[0]);
        }
        if (onDriveTestUpload) {
          onDriveTestUpload(file, result.available_kpis && result.available_kpis.length > 0 ? result.available_kpis[0] : selectedDriveKPI);
        }
      } catch (err) {
        console.error("Upload failed:", err.message);
      }
    }
  };

  // When user changes KPI after upload, re-upload with new KPI
  const handleDriveKPIChange = async (e) => {
    const kpi = e.target.value;
    setSelectedDriveKPI(kpi);
    if (driveTestFile && onDriveTestUpload) {
      onDriveTestUpload(driveTestFile, kpi);
    }
  };

  const handleSaveTemplate = () => {
    const template = {
      name: templateName,
      config: {
        phdbTable,
        requiredCols,
        popupColumns,
        targetTable,
        targetColsSelected,
        joinOn,
        layerColumn,
        bandColumn,
        kpiColumn,
      },
    };
    fetch(`${import.meta.env.VITE_API_URL}/save-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to save template');
        return res.json();
      })
      .then(() => {
        alert('✅ Template saved successfully!');
        setTemplateName('');
        return fetch(`${import.meta.env.VITE_API_URL}/templates`);
      })
      .then((res) => res.json())
      .then(setSavedTemplates)
      .catch((err) => {
        console.error(err);
        alert('❌ Failed to save template.');
      });
  };

  const handleLoadTemplate = () => {
    if (!loadFilterTemplate) return;
    fetch(`${import.meta.env.VITE_API_URL}/template/${loadFilterTemplate}`)
      .then((res) => res.json())
      .then((data) => {
        const config = data.config;
        setPhdbTable(config.phdbTable);
        setRequiredCols(config.requiredCols);
        setPopupColumns(config.popupColumns || []);
        setTargetTable(config.targetTable || '');
        setTargetColsSelected(config.targetColsSelected || []);
        setJoinOn(config.joinOn || { physical: '', target: '' });
        setLayerColumn(config.layerColumn || '');
        setBandColumn(config.bandColumn || '');
        setKpiColumn(config.kpiColumn || '');
      })
      .catch(console.error);
  };

  const handleGenerate = () => {
    const payload = {
      physical_table: phdbTable,
      physical_columns: requiredCols,
      physical_extra_cols: popupColumns,
    };
    if (targetTable) {
      payload.target_table = targetTable;
      payload.target_columns = targetColsSelected;
      payload.join_on = joinOn;
    }
    onGenerateMap(payload);
  };

  const renderDropdown = (key, options, multiple = false, value, setValue) => (
    <div className="dropdown-wrapper" ref={(el) => (dropdownRefs.current[key] = el)}>
      <input
        className="input"
        readOnly
        value={
          multiple
            ? value.length
              ? value
                  .map((v) =>
                    typeof v === 'string'
                      ? v
                      : v.name || v.label || v.id || JSON.stringify(v)
                  )
                  .join(', ')
              : ''
            : typeof value === 'string'
            ? value
            : value?.name || value?.label || value?.id || ''
        }
        placeholder={`Select ${key.replace(/([A-Z])/g, ' $1')}`}
        onClick={() =>
          setShowDropdowns((prev) => ({ ...prev, [key]: !prev[key] }))
        }
      />
      {showDropdowns[key] && (
        <div className="dropdown-list">
          {options.map((option, i) => {
            const displayText =
              typeof option === 'string'
                ? option
                : option.name || option.label || option.id || JSON.stringify(option);
            return (
              <div
                key={i}
                className={`dropdown-item ${multiple && value.includes(option) ? 'selected' : ''}`}
                onClick={() => {
                  if (multiple) {
                    setValue((prev) =>
                      prev.includes(option)
                        ? prev.filter((item) => item !== option)
                        : [...prev, option]
                    );
                  } else {
                    setValue(option);
                    setShowDropdowns((prev) => ({ ...prev, [key]: false }));
                  }
                }}
              >
                {displayText}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="left-panel">
      <div className="sidebar-scroll">
        <h3>Filter</h3>
        <label>Load Filter Template</label>
        {renderDropdown('loadFilterTemplate', savedTemplates, false, loadFilterTemplate, setLoadFilterTemplate)}
        <button className="btn" onClick={handleLoadTemplate}>Load Template</button>
        <label>PHDB Table</label>
        {renderDropdown('phdbTable', tables, false, phdbTable, setPhdbTable)}
        {phdbTable && (
          <>
            <label>Required Columns</label>
            {Object.keys(requiredCols).map((key) => (
              <div key={key}>
                <label>{key.toUpperCase()}</label>
                {renderDropdown(`required-${key}`, columns, false, requiredCols[key], (val) =>
                  setRequiredCols((prev) => ({ ...prev, [key]: val }))
                )}
              </div>
            ))}
            <label>Extra Columns form PHDB</label>
            {renderDropdown('popupColumns', columns, true, popupColumns, setPopupColumns)}
          </>
        )}
        <label>Target Table (optional)</label>
        {renderDropdown('targetTable', tables, false, targetTable, setTargetTable)}
        {targetTable && (
          <>
            <label>Target Columns</label>
            {renderDropdown('targetColsSelected', targetColumns, true, targetColsSelected, setTargetColsSelected)}
            <label>Join On Columns</label>
            <div className="join-wrapper">
              <div style={{ flex: 1 }}>
                <label>{phdbTable}</label>
                {renderDropdown('join-physical', columns, false, joinOn.physical, (val) =>
                  setJoinOn((prev) => ({ ...prev, physical: val }))
                )}
              </div>
              <div style={{ paddingTop: '20px' }}>=</div>
              <div style={{ flex: 1 }}>
                <label>{targetTable}</label>
                {renderDropdown('join-target', targetColumns, false, joinOn.target, (val) =>
                  setJoinOn((prev) => ({ ...prev, target: val }))
                )}
              </div>
            </div>
          </>
        )}
        <>
          <label>Select Column for Layer/Color</label>
          {renderDropdown('layer', columns, false, layerColumn, (selected) => {
            setLayerColumn(selected);
            setColorRanges((prev) => ({
              ...prev,
              [selected]: prev[selected] || {
                red: [0, 0],
                green: [0, 0],
                yellow: [0, 0],
                orange: [0, 0],
                blue: [0, 0],
                pink: [0, 0],
              },
            }));
            fetch(`${import.meta.env.VITE_API_URL}/column-range?table=${phdbTable || targetTable}&column=${selected}`)
              .then((res) => res.json())
              .then(({ min, max }) => {
                if (typeof min === 'number' && typeof max === 'number') {
                  setLayerRange({ min, max });
                } else {
                  setLayerRange({ min: null, max: null });
                }
              })
              .catch(() => setLayerRange({ min: null, max: null }));
          })}
          {layerColumn && layerRange.min !== null && layerRange.max !== null && (
            <p className="range-info">
              Range <strong>{layerColumn}</strong>: <span>{layerRange.min} – {layerRange.max}</span>
            </p>
          )}
          {layerColumn && colorRanges[layerColumn] && (
            <div className="color-range-wrapper">
              {Object.entries(colorRanges[layerColumn]).map(([color, [min, max]]) => (
                <div key={color} className={`color-range-row ${color}`}>
                  <label>{color.charAt(0).toUpperCase() + color.slice(1)}:</label>
                  <input
                    type="number"
                    className="input"
                    value={min}
                    onChange={(e) =>
                      setColorRanges((prev) => ({
                        ...prev,
                        [layerColumn]: {
                          ...prev[layerColumn],
                          [color]: [Number(e.target.value), max],
                        },
                      }))
                    }
                  />
                  <input
                    type="number"
                    className="input"
                    value={max}
                    onChange={(e) =>
                      setColorRanges((prev) => ({
                        ...prev,
                        [layerColumn]: {
                          ...prev[layerColumn],
                          [color]: [min, Number(e.target.value)],
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </>
        <label>Select Band Column (Optional)</label>
        {renderDropdown('band', columns, false, bandColumn, setBandColumn)}
        <label>Select KPI to Display</label>
        {renderDropdown('kpi', columns, false, kpiColumn, setKpiColumn)}
        <label>Save Template</label>
        <input
          type="text"
          className="input"
          placeholder="Template name"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
        />
        <button className="btn" onClick={handleSaveTemplate} disabled={!templateName}>Save</button>
        <label>Export Options</label>
        <div className="button-row"></div>
        <button className="btn btn-outline" onClick={handleExportCSV}>Export as CSV</button>
        <button className="btn btn-outline" onClick={handleExportKML}>Export as KML</button>
        <button className="btn-primary" onClick={handleGenerate}> Generate Map</button>
      </div>
      {/* === Drive Test Upload === */}
      
      <div className="form-section">
        <label htmlFor="driveTestFile">Upload Drive Test Log</label>
        <input
          type="file"
          accept=".csv, .xlsx"
          onChange={handleDriveTestFileChange}
        />
        <div className="dropdown-group"></div>
        <label>Select Drive Test KPI</label>
        <select
          className="input-template"
          value={selectedDriveKPI}
          onChange={handleDriveKPIChange}
        >
          {(availableDriveKPIs.length > 0 ? availableDriveKPIs : ['RSRP', 'RSRQ', 'SINR']).map((kpi) => (
            <option key={kpi} value={kpi}>{kpi}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default Sidebar