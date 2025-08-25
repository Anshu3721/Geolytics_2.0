import React, { useState, useEffect, useRef } from 'react';
import './Styles.css';
import KPIGridUploader from './KPIGridUploader';


const colorNameMap = {
  "#00ff00": "Green",
  "#ffff00": "Yellow",
  "#ff0000": "Red",
  "#0000ff": "Blue",
  "#ffa500": "Orange",
  "#800080": "Purple",
  "#808080": "Gray",
};

function getColorLabel(hex) {
  return colorNameMap[hex.toLowerCase()] || hex;
}



const LEGEND_TYPES = [
  { value: 'kpi', label: 'KPI Heatmap' },
  { value: 'band', label: 'Band Colors' },
  { value: 'sector', label: 'Sector Colors' },
  { value: 'driveTest', label: 'Drive Test KPI' }
];

function normalizeBand(raw) {
  if (!raw && raw !== 0) return '';
  let s = String(raw).toUpperCase().trim();
  s = s.replace(/\s+/g, '');
  const m = s.match(/N?(\d{1,4})/);
  if (!m) return s;
  return 'N' + m[1];
}


function getColorForValue(value, colorBands) {
  for (const { color, from, to } of colorBands) {
    if (value >= from && value <= to) return color;
  }
  return '#cccccc'; // Default gray
}
let warned = false;
let missingColorKeysLogged = new Set();

function generateSectorGeoJSON(features, colorColumn, colorBands) {
  if (!colorColumn || typeof colorColumn !== "string") {
    console.warn("⛔ Skipping color logic. Invalid colorColumn:", colorColumn);
    return []; // or just return features unchanged
  }

  return features.map((f) => {
    const props = f.properties || {};
    const rawVal = props[colorColumn];
    const parsed = parseFloat(rawVal);

    const isValidNumber =
      rawVal !== undefined &&
      rawVal !== null &&
      rawVal !== "" &&
      rawVal !== "null" &&
      rawVal !== "--" &&
      !isNaN(parsed);

    if (isValidNumber) {
      f.properties.fillColor = getColorForValue(parsed, colorBands);
    } else {
      console.warn(`⚠️ Invalid KPI value for ${colorColumn}. Got:`, rawVal, props);
    }

    return f;
  });
}






function getClosestColorName(hex) {
  const knownColors = {
    '#ff0000': 'red',
    '#00ff00': 'lime',
    '#0000ff': 'blue',
    '#ffff00': 'yellow',
    '#ff00ff': 'magenta',
    '#00ffff': 'cyan',
    '#ffffff': 'white',
    '#000000': 'black',
    '#808080': 'gray',
    '#800000': 'maroon',
    '#008000': 'green',
    '#000080': 'navy',
    '#ffa500': 'orange',
    '#a52a2a': 'brown',
    '#800080': 'purple',
    '#ffc0cb': 'pink',
    '#808000': 'olive',
    '#f0e68c': 'khaki',
  };

  return knownColors[hex.toLowerCase()] || hex.toLowerCase();
}

const Sidebar = ({ 
  driveLayerRange,
   setDriveLayerRange,
  // Data & map generation
  onGenerateMap,
  geoJsonData,
  onDriveTestUpload,
  
  // Legend & KPI
  legendType,
  setLegendType,
  legendOptions,
  kpiColumn,
  setKpiColumn,
  
  // Layer & color settings
  selectedLayerColumn,
  setSelectedLayerColumn,
  colorRanges,
  setColorRanges,

  // Band column & band cells
  selectedBandColumn,
  bandCellOptions,
  setBandCellOptions,
  selectedBandCell,
  setSelectedBandCell,
  setSelectedCellBand,
  onGridData,
   setGridData,
   selectedDriveKPI,
  setSelectedDriveKPI,
  
  
}) => {

  // Table and column states
  const [tables, setTables] = useState([]);
  const [columns, setColumns] = useState([]);
  const [targetTables, setTargetTables] = useState([]);
  const [targetConfigs, setTargetConfigs] = useState([]);

  // Drive test states
  const [driveTestFile, setDriveTestFile] = useState(null);

  // State for dropdown toggle & selected bands
const [isUniqueBandOpen, setIsUniqueBandOpen] = useState(false);

const [uniqueBands, setUniqueBands] = useState([]);
const [selectedBands, setSelectedBands] = useState([]);
  




  const [searchTexts, setSearchTexts] = useState({});
  const [layerRange, setLayerRange] = useState({ min: null, max: null });
  const [newColorHex, setNewColorHex] = useState('#663399');
  const [newColorMin, setNewColorMin] = useState(layerRange.min || 0);
  const [newColorMax, setNewColorMax] = useState(layerRange.max || 0);
  const [bandRange, setBandRange] = useState({ min: null, max: null }); 
  

  // === Band dropdown UI state (UI only, doesn't change your data flow) ===
const [isBandDropdownOpen, setIsBandDropdownOpen] = useState(false);
const [bandSearch, setBandSearch] = useState('');
const bandDropdownRef = useRef(null);

const [selectedUniqueBands, setSelectedUniqueBands] = useState([]);


const [addingDriveColor, setAddingDriveColor] = useState(false);
const [newDriveColorHex, setNewDriveColorHex] = useState("#0000ff");
const [newDriveMin, setNewDriveMin] = useState(0);
const [newDriveMax, setNewDriveMax] = useState(0);

const [availableDriveKPIs, setAvailableDriveKPIs] = useState([]);



  // Filter config states
  const [phdbTable, setPhdbTable] = useState('');
  const [requiredCols, setRequiredCols] = useState({
    site_id: ['Site_ID' ,'D2EL02'],
    cellname: ['Cell_name' ,'D2EL01'],
    lat: 'Lat',
    lon: 'Long',
    azimuth: 'Azimuth'
  });
  const [popupColumns, setPopupColumns] = useState([]);
  const [layerColumn, setLayerColumn] = useState('');
  
  const [bandColumn, setBandColumn] = useState('');
  // const [kpiColumn, setKpiColumn] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [loadFilterTemplate, setLoadFilterTemplate] = useState('');
  const [showDropdowns, setShowDropdowns] = useState({});
  const dropdownRefs = useRef({});
  const [driveTestColumns, setDriveTestColumns] = useState([]);
  const [kpiProgress, setKpiProgress] = useState(0);
const [fetchingKPI, setFetchingKPI] = useState(false);





  const handleGridHeatmapUpload = async (file) => {
  if (!file) {
    alert("⚠️ Please upload a grid KPI file.");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/upload-grid-kpi`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) throw new Error("Upload failed");

    const data = await res.json();
    setGridHeatmapGeoJSON(data.geojson); // ✅ Store separately

    // Optional: populate dropdown with KPIs
    if (data.available_kpis?.length) {
      // You can store them in a new state like:
      setAvailableGridKPIs(data.available_kpis);
      setSelectedKPI(data.available_kpis[0]);
    }

  } catch (err) {
    console.error("Grid KPI upload failed:", err);
    alert("❌ Grid KPI upload failed.");
  }
};

 
 
  

const [addingColor, setAddingColor] = useState(false);
const [newColorName, setNewColorName] = useState('');
const bandSortOrder = (band) => {
  const numericPart = parseInt(band.replace(/[^\d]/g, '')); // L21 -> 21
  return isNaN(numericPart) ? 0 : numericPart;
};


useEffect(() => {
  const onDocClick = (e) => {
    if (bandDropdownRef.current && !bandDropdownRef.current.contains(e.target)) {
      setIsBandDropdownOpen(false);
    }
  };
  document.addEventListener('mousedown', onDocClick);
  return () => document.removeEventListener('mousedown', onDocClick);
}, []);



useEffect(() => {
  if (!selectedDriveKPI || !colorRanges[selectedDriveKPI]) return;

  // Notify parent that config changed
  onDriveTestUpload?.(driveTestFile, selectedDriveKPI, {
    colorRanges,
    driveLayerRange
  });

  // Optional: if still needed
  window.refreshDriveTestLayer?.();
}, [selectedDriveKPI, colorRanges, driveLayerRange]);

// When bandCellOptions change, extract unique bands
useEffect(() => {
  if (bandCellOptions && bandCellOptions.length > 0) {
    const bands = [...new Set(bandCellOptions.map(opt => opt.band))];
    setUniqueBands(bands);
    console.log("Unique Bands:", bands);
  }
}, [bandCellOptions]);
// Toggle dropdown
const toggleUniqueBandDropdown = () => {
  console.log("Toggle Unique Band Dropdown (before):", showUniqueBandDropdown);
  setShowUniqueBandDropdown(prev => !prev);
  console.log("Toggle Unique Band Dropdown (after):", !showUniqueBandDropdown);
};

// Handle band selection
const handleBandSelection = (band) => {
  setSelectedBands(prev =>
    prev.includes(band) ? prev.filter(b => b !== band) : [...prev, band]
  );
};


useEffect(() => {
  if (geoJsonData && Array.isArray(geoJsonData.features) && selectedBandColumn) {
    const opts = geoJsonData.features.map(f => {
      const props = f.properties || {};
      const bandRaw = props[selectedBandColumn] ?? props.BAND ?? props.band ?? props.Band;
      const band = normalizeBand(bandRaw);
      const cellname = props.cellname || props.Cell_name || props.CELLNAME || '';
      return { band, cellname };
    }).filter(o => o.band && o.cellname);

    setBandCellOptions(opts);
  }
}, [geoJsonData, selectedBandColumn]);


  useEffect(() => {
  if (layerColumn) {
    setSelectedLayerColumn(layerColumn);
  }
}, [layerColumn]);




// useEffect(() => {
//   fetch(`${import.meta.env.VITE_API_URL}/drive-test/columns`)
//     .then((res) => res.json())
//     .then((data) => {
//       if (data.columns) {
//         setDriveTestColumns(data.columns); // ✅ store numeric KPIs
//       }
//     })
//     .catch((err) => console.error("❌ Failed to fetch drive test columns:", err));
// }, []);


  // Fetch tables and templates on mount
  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/tables`).then(res => res.json()).then(setTables);
    fetch(`${import.meta.env.VITE_API_URL}/templates`).then(res => res.json()).then(setSavedTemplates);
  }, []);

  // Fetch columns when PHDB table changes
  useEffect(() => {
    if (!phdbTable) return;
    fetch(`${import.meta.env.VITE_API_URL}/columns/${phdbTable}`)
      .then(res => res.json())
      .then(fetchedCols => {
        setColumns(fetchedCols);
        setRequiredCols(prev => ({
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
      });
  }, [phdbTable]);

  // Fetch columns for target tables
  // Fetch columns for target tables (preserving selectedCols and joinOn)
useEffect(() => {
  Promise.all(
    targetTables.map((table) =>
      fetch(`${import.meta.env.VITE_API_URL}/columns/${table}`)
        .then((res) => res.json())
        .then((columns) => ({ table, columns }))
    )
  ).then((results) => {
    setTargetConfigs((prevConfigs) =>
      results.map(({ table, columns }) => {
        const existing = prevConfigs.find((cfg) => cfg.table === table);
        return {
          table,
          columns,
          selectedCols: existing?.selectedCols || [],
          joinOn: existing?.joinOn || { physical: '', target: '' },
        };
      })
    );
  });
}, [targetTables]);


  useEffect(() => {
    function handleDocumentClick(e) {
      // For each dropdown, if click is outside, close it
      Object.entries(dropdownRefs.current).forEach(([key, el]) => {
        if (showDropdowns[key] && el && !el.contains(e.target)) {
          setShowDropdowns(prev => ({ ...prev, [key]: false }));
        }
      });
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [showDropdowns]);

  // Save filter template
  const handleSaveTemplate = () => {
    const template = {
      name: templateName,
      config: {
        phdbTable, requiredCols, popupColumns,
        target_joins: targetConfigs.map(cfg => ({
          table: cfg.table, target_columns: cfg.selectedCols, join_on: cfg.joinOn
        })),
        layerColumn, bandColumn, kpiColumn,
      }
    };
    fetch(`${import.meta.env.VITE_API_URL}/save-template`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template),
    })
      .then(res => res.json())
      .then(() => {
        alert('Template saved!');
        setTemplateName('');
        return fetch(`${import.meta.env.VITE_API_URL}/templates`);
      })
      .then(res => res.json())
      .then(setSavedTemplates)
      .catch(() => alert('Failed to save template.'));
  };

  // Load a saved filter template
  const handleLoadTemplate = () => {
    if (!loadFilterTemplate) return;
    fetch(`${import.meta.env.VITE_API_URL}/template/${loadFilterTemplate}`)
      .then(res => res.json())
      .then(data => {
        const config = data.config;
        setPhdbTable(config.phdbTable);
        setRequiredCols(config.requiredCols);
        setPopupColumns(config.popupColumns || []);
        setTargetConfigs((config.target_joins || []).map(join => ({
          table: join.table, columns: [], selectedCols: join.target_columns || [], joinOn: join.join_on || { physical: '', target: '' },
        })));
        setLayerColumn(config.layerColumn || '');
        setBandColumn(config.bandColumn || '');
        setKpiColumn(config.kpiColumn || '');
      });
  };

  // Generate map payload and call parent handler
  const handleGenerate = () => {
  const payload = {
  physical_table: phdbTable,
  physical_columns: requiredCols,
  physical_extra_cols: [
    ...popupColumns,
    ...(layerColumn ? [layerColumn] : [])
  ],
  target_joins: targetConfigs.map(cfg => ({
    table: cfg.table,
    target_columns: cfg.selectedCols,
    join_on: cfg.joinOn,
  })),
  ...(layerColumn && { layerColumn }),
  ...(bandColumn && { bandColumn }),
  ...(kpiColumn && { kpiColumn }),
  ...(layerColumn && {
    colorRanges: Object.entries(colorRanges[layerColumn] || {}).map(([color, [from, to]]) => ({
      color, from, to
    }))
  })
};


 
  onGenerateMap(payload);
};

  // Dropdown rendering helper
  const renderDropdown = (key, options, multiple, value, setValue) => {
  const searchText = searchTexts[key] || '';
  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(searchText.toLowerCase())
  );

  

  return (
    <div className="dropdown-wrapper" ref={(el) => (dropdownRefs.current[key] = el)}>
      <input
        className="input"
        readOnly
        value={
          multiple
            ? Array.isArray(value) && value.length ? value.join(', ') : ''
            : value
        }
        placeholder={`Select ${key}`}
        onClick={() =>
          setShowDropdowns((prev) => ({ ...prev, [key]: !prev[key] }))
        }
      />
      {showDropdowns[key] && (
        <div className="dropdown-list">
          <input
            type="text"
            className="input search-input"
            placeholder="Search..."
            value={searchText}
            onChange={(e) =>
              setSearchTexts((prev) => ({ ...prev, [key]: e.target.value }))
            }
            autoFocus
          />
          {filteredOptions.map((option, i) => (
            <div
              key={i}
              className={`dropdown-item ${multiple && Array.isArray(value) && value.includes(option) ? 'selected' : ''}`}
              onClick={() => {
                if (multiple) {
                  const safeValue = Array.isArray(value) ? value : [];
                  const newValue = safeValue.includes(option)
                    ? safeValue.filter((item) => item !== option)
                    : [...safeValue, option];
                  setValue(newValue);
                } else {
                  setValue(option);
                  setShowDropdowns((prev) => ({ ...prev, [key]: false }));
                }
              }}
            >
              {option}
            </div>
          ))}
          {filteredOptions.length === 0 && (
            <div className="dropdown-item disabled">No matches</div>
          )}
        </div>
      )}
    </div>
  );
};

{/* === KPI Grid Uploader === */}
<div className="sidebar-section">
  <h3>Grid Heatmap</h3>
   <KPIGridUploader onGridData={setGridData} />
</div>


  // === Drive Test Upload Handler ===
  const handleDriveTestFileChange = async (e) => {
    const file = e.target.files[0];
    setDriveTestFile(file);
    if (!file) return;

    setFetchingKPI(true);
    setKpiProgress(0);

    const interval = setInterval(() => {
      setKpiProgress(prev => (prev < 95 ? prev + 5 : prev));
    }, 100);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/upload-drive-test`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(`Error: ${response.status}`);
      const result = await response.json();

      // ✅ Extract and store all columns
      if (result.available_kpis?.length) setDriveTestColumns(result.available_kpis);

      // ✅ Filter KPIs to only signal metrics
      setAvailableDriveKPIs(
        (result.available_kpis || []).filter(
          (k) =>
            k.toUpperCase().includes("RSRP") ||
            k.toUpperCase().includes("RSRQ") ||
            k.toUpperCase().includes("SINR") ||
            k.toUpperCase().includes("EARFCN")
        )
      );

      // ✅ Pick default KPI and fetch its range immediately
      if (result.available_kpis?.length > 0) {
        const defaultKPI = result.available_kpis[0];
        setSelectedDriveKPI(defaultKPI);

        try {
          const res = await fetch(
            `${import.meta.env.VITE_API_URL}/drive-test/column-range?column=${encodeURIComponent(defaultKPI)}`
          );
          const range = await res.json();
          if (range.min != null && range.max != null) setDriveLayerRange({ min: range.min, max: range.max });
        } catch (err) {
          console.error("❌ Failed to fetch drive test column range", err);
        }
      }

      // Notify parent
      if (onDriveTestUpload) onDriveTestUpload(file, result.available_kpis?.[0] || selectedDriveKPI);
    } catch (err) {
      console.error("Upload failed:", err.message);
    } finally {
      clearInterval(interval);
      setKpiProgress(100);
      setTimeout(() => {
        setFetchingKPI(false);
        setKpiProgress(0);
      }, 300);
    }
  };

  // === KPI Change Handler ===
  const handleDriveKPIChange = async (e) => {
    const kpi = e.target.value;
    setSelectedDriveKPI(kpi);
    if (!kpi) return;

    setFetchingKPI(true);
    setKpiProgress(0);

    const interval = setInterval(() => {
      setKpiProgress(prev => (prev < 95 ? prev + 5 : prev));
    }, 100);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/drive-test/column-range?column=${encodeURIComponent(kpi)}`
      );
      const range = await res.json();
      if (range.min != null && range.max != null) setDriveLayerRange({ min: range.min, max: range.max });
    } catch (err) {
      console.error("❌ Failed to fetch drive test column range", err);
    } finally {
      clearInterval(interval);
      setKpiProgress(100);
      setTimeout(() => {
        setFetchingKPI(false);
        setKpiProgress(0);
      }, 300);
    }

    // Notify parent
    if (driveTestFile && onDriveTestUpload) onDriveTestUpload(driveTestFile, kpi);
  };


  // Export CSV/KML handlers
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

  return (
    <div className="left-panel">
      <div className="sidebar-scroll">
        <h3>Filter</h3>
        {/* Legend type selection
        <label>Legend Type</label>
        <select
          className="input"
          value={legendType}
          onChange={e => setLegendType(e.target.value)}
          style={{ marginBottom: '12px' }}
        >
          {LEGEND_TYPES.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      
        {legendType === 'kpi' && (
          <>
            <label>Select KPI to Display in Legend</label>
            {renderDropdown('kpi', columns, false, kpiColumn, setKpiColumn)}
          </>
        )} */}
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
            <label>Extra Columns from PHDB</label>
            {renderDropdown('popupColumns', columns, true, popupColumns, setPopupColumns)}
          </>
        )}
<label>Target Table (optional)</label>
{renderDropdown('targetTables', tables, true, targetTables, setTargetTables)}

{targetConfigs.map((cfg, idx) => (
  <div
    key={cfg.table}
    style={{ marginBottom: '16px', borderTop: '1px solid #ccc', paddingTop: '8px' }}
  >
    <label>Target Table: {cfg.table}</label>

    <label>Target Columns</label>
    {renderDropdown(
      `targetCols-${idx}`,
      cfg.columns || [],
      true,
      cfg.selectedCols || [],
      (val) => {
        setTargetConfigs((prev) =>
          prev.map((item, i) =>
            i === idx ? { ...item, selectedCols: val } : item
          )
        );
      }
    )}

    <label>Join On Columns</label>
    <div className="join-wrapper" style={{ display: 'flex', gap: '10px' }}>
      <div style={{ flex: 1 }}>
        <label>{phdbTable}</label>
        {renderDropdown(
          `join-physical-${idx}`,
          columns || [], // these are PHDB table columns
          false,
          cfg.joinOn?.physical || '',
          (val) => {
            setTargetConfigs((prev) => {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                joinOn: {
                  ...updated[idx].joinOn,
                  physical: val,
                },
              };
              return updated;
            });
          }
        )}
      </div>

      <div style={{ paddingTop: '20px' }}>=</div>

      <div style={{ flex: 1 }}>
        <label>{cfg.table}</label>
        {renderDropdown(
          `join-target-${idx}`,
          cfg.columns || [], // these are target table columns
          false,
          cfg.joinOn?.target || '',
          (val) => {
            setTargetConfigs((prev) => {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                joinOn: {
                  ...updated[idx].joinOn,
                  target: val,
                },
              };
              return updated;
            });
          }
        )}
      </div>
    </div>
  </div>
))}

{/* === Layer/Color Column Selection === */}
<label>Select Column for Layer/Color</label>
{renderDropdown('layer', columns, false, layerColumn, (selected) => {
  setLayerColumn(selected);
  setSelectedLayerColumn(selected); 
  fetch(`${import.meta.env.VITE_API_URL}/column-range?table=${phdbTable}&column=${selected}`)
    .then((res) => res.json())
    .then(({ min, max }) => {
      if (typeof min === 'number' && typeof max === 'number') {
        setLayerRange({ min, max });
        const step = (max - min) / 3;
        const defaultBands = {
          green: [min, min + step],
          yellow: [min + step, min + 2 * step],
          red: [min + 2 * step, max],
        };

        setColorRanges((prev) => ({
          ...prev,
          [selected]: prev[selected] || defaultBands,
        }));
      } else {
        setLayerRange({ min: null, max: null });
      }
    })
    .catch(() => setLayerRange({ min: null, max: null }));
})}

{layerColumn && layerRange.min != null && layerRange.max != null && (
  <p className="range-info">
    Range <strong>{layerColumn}</strong>: <span>{layerRange.min} – {layerRange.max}</span>
  </p>
)}

{layerColumn && colorRanges[layerColumn] && (
  <div className="color-range-wrapper">
    {Object.entries(colorRanges[layerColumn]).map(([color, [min, max]]) => (
      <div key={color} className="color-range-row">
        <label style={{ minWidth: 60 }}>
          {color.charAt(0).toUpperCase() + color.slice(1)}:
          <span
            style={{
              display: 'inline-block',
              width: 16,
              height: 16,
              backgroundColor: color,
              borderRadius: 4,
              marginLeft: 6,
              border: '1px solid #ccc',
              verticalAlign: 'middle',
              cursor: 'pointer',
            }}
            title={`Preview: ${color}`}
          />
        </label>
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
        <button
          className="btn-remove"
          title="Remove color band"
          onClick={() =>
            setColorRanges((prev) => {
              const updated = { ...prev[layerColumn] };
              delete updated[color];
              return { ...prev, [layerColumn]: updated };
            })
          }
        >
          ❌
        </button>
      </div>
    ))}

    {/* === Add New Color Band === */}
    {!addingColor ? (
      <button
        className="btn-add"
        onClick={() => {
          setAddingColor(true);
          setNewColorName('');
          setNewColorHex('#ff0000');
          setNewColorMin(layerRange.min ?? 0);
          setNewColorMax(layerRange.max ?? 0);
        }}
      >
        + Add Color Band
      </button>
    ) : (
      <div
        className="color-range-add-form"
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          marginTop: 8,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          placeholder="Color name (optional)"
          value={newColorName}
          onChange={(e) => setNewColorName(e.target.value)}
          className="input"
          style={{ width: 140 }}
        />
        <input
          type="color"
          value={newColorHex}
          onChange={(e) => setNewColorHex(e.target.value)}
          title="Pick color"
        />
        <input
          type="number"
          placeholder="Min"
          value={newColorMin}
          onChange={(e) => setNewColorMin(Number(e.target.value))}
          className="input"
          style={{ width: 70 }}
        />
        <input
          type="number"
          placeholder="Max"
          value={newColorMax}
          onChange={(e) => setNewColorMax(Number(e.target.value))}
          className="input"
          style={{ width: 70 }}
        />
        <button
          className="btn-add"
          onClick={() => {
            let name = newColorName.trim().toLowerCase();
            if (!name) {
              name = getClosestColorName(newColorHex);
            }

            if (colorRanges[layerColumn]?.[name]) {
              alert('Color already exists!');
              return;
            }
            if (newColorMin >= newColorMax) {
              alert('Min must be less than Max.');
              return;
            }

            setColorRanges((prev) => ({
              ...prev,
              [layerColumn]: {
                ...prev[layerColumn],
                [name]: [newColorMin, newColorMax],
              },
            }));
            setAddingColor(false);
          }}
        >
          ✅ Add
        </button>
        <button
          className="btn-add"
          style={{ padding: '4px 10px', fontSize: 13 }}
          onClick={() => setAddingColor(false)}
        >
          ❌ Cancel
        </button>
      </div>
    )}
  </div>
)}


                
        

{/* === Select Band Column (Optional) === */}
<label>Select Band Column (Optional)</label>

<div className="dropdown-wrapper" ref={bandDropdownRef}>
  {/* Trigger bar */}
  <button
    type="button"
    className="input"
    onClick={() => setIsBandDropdownOpen((v) => !v)}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      cursor: 'pointer'
    }}
    aria-expanded={isBandDropdownOpen}
    aria-haspopup="listbox"
  >
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {Array.isArray(selectedBandCell) && selectedBandCell.length > 0
        ? `${selectedBandCell[0]}${selectedBandCell.length > 1 ? ` (+${selectedBandCell.length - 1})` : ''}`
        : 'Select band cells'}
    </span>
    <span aria-hidden>▾</span>
  </button>

  {/* Dropdown list */}
  {isBandDropdownOpen && (
    <div className="dropdown-list" role="listbox" aria-multiselectable="true">
      <input
        className="search-input"
        placeholder="Search..."
        value={bandSearch}
        onChange={(e) => setBandSearch(e.target.value)}
      />

      {(Array.isArray(bandCellOptions) ? bandCellOptions : [])
        .slice()
        .sort((a, b) => {
          const numA = parseInt(String(a.band || '').replace(/\D/g, ''), 10) || 0;
          const numB = parseInt(String(b.band || '').replace(/\D/g, ''), 10) || 0;
          return numB - numA;
        })
        .filter((item) => {
          const txt = `${item.band ?? ''} - ${item.cellname ?? ''}`.toLowerCase();
          return txt.includes(bandSearch.trim().toLowerCase());
        })
        .map((item, idx, arr) => {
          const prev = arr[idx - 1];
          const showDivider = idx > 0 && prev?.band === item.band;
          const value = item.cellname;
          const isSelected = Array.isArray(selectedBandCell) && selectedBandCell.includes(value);

          return (
            <React.Fragment key={`${item.band}-${value}-${idx}`}>
              {showDivider && (
                <div className="dropdown-item disabled" style={{ fontStyle: 'italic' }}>
                  ─── {item.band} (another set) ───
                </div>
              )}

              <div
                className={`dropdown-item ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  let next = Array.isArray(selectedBandCell) ? [...selectedBandCell] : [];

                  if (isSelected) {
                    next = next.filter((v) => v !== value);
                  } else {
                    next.push(value);
                  }

                  // Always keep both states in sync
                  setSelectedBandCell(next);
                  setSelectedCellBand(next);

                  setColorRanges((prev) => {
                    const updated = { ...prev };
                    if (isSelected) {
                      delete updated[value];
                    } else if (!updated[value]) {
                      updated[value] = '#ff0000';
                    }
                    return updated;
                  });
                }}
                role="option"
                aria-selected={isSelected}
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={!!isSelected}
                  style={{ marginRight: 8 }}
                />
                {`${item.band} - ${item.cellname}`}
              </div>
            </React.Fragment>
          );
        })}

      {(!bandCellOptions || bandCellOptions.length === 0) && (
        <div className="dropdown-item disabled">No band cells available</div>
      )}
    </div>
  )}
</div>

{/* === Color pickers for selected bands === */}
{Array.isArray(selectedBandCell) && selectedBandCell.length > 0 && (
  <div className="color-range-wrapper" style={{ marginTop: '10px' }}>
    {selectedBandCell.map((cell) => (
      <div
        key={cell}
        className="color-range-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          marginBottom: '6px'
        }}
      >
        {/* Band name */}
        <label style={{ flex: 1, minWidth: 60, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {cell}
        </label>

        {/* Color preview box */}
        <span
          style={{
            display: 'inline-block',
            width: 16,
            height: 16,
            backgroundColor: colorRanges[cell] || '#ff0000',
            borderRadius: 4,
            border: '1px solid #ccc',
            verticalAlign: 'middle',
            cursor: 'pointer',
          }}
          title={`Preview: ${colorRanges[cell] || '#ff0000'}`}
        />

        {/* Color Picker */}
        <input
          type="color"
          value={colorRanges[cell] || "#ff0000"}
          onChange={(e) => {
            const newColor = e.target.value;
            setColorRanges((prev) => ({
              ...prev,
              [cell]: newColor,
            }));
          }}
          style={{
            width: 40,
            height: 26,
            padding: 0,
            border: '1px solid #ccc',
            borderRadius: 4,
            cursor: 'pointer'
          }}
        />

        {/* Remove Button */}
        <button
          className="btn-remove"
          title="Remove band"
          onClick={() => {
            setSelectedBandCell((prev) => prev.filter((b) => b !== cell));
            setSelectedCellBand((prev) => prev.filter((b) => b !== cell));
            setColorRanges((prev) => {
              const updated = { ...prev };
              delete updated[cell];
              return updated;
            });
          }}
        >
          ❌
        </button>
      </div>
    ))}
  </div>
)}

{/* === Unique Band Multi-Filter === */}
<div style={{ marginTop: "12px", position: "relative" }}>
  

  {/* Toggle Button */}
  <button
    type="button"
    className="btn-filter"
    onClick={() => setIsUniqueBandOpen((prev) => !prev)}
    style={{
      color: "#000",
      display: "inline-block",
      marginTop: "6px",
      padding: "1px 2px",
      borderRadius: "20px",
      border: "1px solid #ccc",
      background: "#f9f9f9",
      cursor: "pointer",
    }}
  >
    {selectedUniqueBands?.length > 0
      ? selectedUniqueBands.join(", ")
      : "Filter"}
    <span style={{ marginLeft: 8 }}>▾</span>
  </button>

  {/* Dropdown */}
  {isUniqueBandOpen && (
    <div
      className="dropdown-list"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        color: "#000",
        marginTop: "4px",
        border: "1px solid #ccc",
        borderRadius: "6px",
        background: "#fff",
        maxHeight: "200px",
        overflowY: "auto",
        zIndex: 2000, 
      }}
    >
      {Array.from(new Set((bandCellOptions || []).map((b) => b.band))) // unique bands
        .sort((a, b) => {
          const numA = parseInt(String(a || "").replace(/\D/g, ""), 10) || 0;
          const numB = parseInt(String(b || "").replace(/\D/g, ""), 10) || 0;
          return numB - numA; // descending order
        })
        .map((band) => {
          const checked = selectedUniqueBands?.includes(band);

          return (
            <div
              key={band}
              className="dropdown-item"
              style={{
                color: "#000",
                padding: "6px 10px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid #eee",
              }}
              onClick={() => {
                // toggle band selection
                let newBands;
                if (checked) {
                  newBands = selectedUniqueBands.filter((b) => b !== band);
                } else {
                  newBands = [...(selectedUniqueBands || []), band];
                }

                setSelectedUniqueBands(newBands);

                // filter cells belonging to selected bands
                const filteredCells = (bandCellOptions || [])
                  .filter((c) => newBands.includes(c.band))
                  .map((c) => c.cellname);

                setSelectedBandCell(filteredCells);
                setSelectedCellBand(filteredCells);

                
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                readOnly
                style={{ marginRight: "8px" }}
              />
              {band}
            </div>
          );
        })}
    </div>
  )}
</div>





return (
    <div>
      {/* === Drive Test Upload === */}
      <div className="form-section">
  <label htmlFor="driveTestFile">📂 Upload Drive Test File</label>
  <input
    id="driveTestFile"
    type="file"
    accept=".csv,.xlsx,.xls,.geojson,.json"
    onChange={handleDriveTestFileChange}
    style={{ display: "block", marginTop: "6px" }}
  />
  
  {/* Progress Bar */}
  {fetchingKPI && (
    <div style={{
      height: "4px",
      background: "#e0e0e0",
      borderRadius: "2px",
      marginTop: "4px",
      overflow: "hidden",
    }}>
      <div style={{
        height: "100%",
        width: `${kpiProgress}%`,
        background: "#4caf50",
        transition: "width 0.2s",
      }} />
    </div>
  )}
</div>

      {/* === Drive Test KPI Selection === */}
<label>Select Drive Test KPI</label>



{renderDropdown("driveKPI", driveTestColumns, false, selectedDriveKPI, (selected) => {
  setSelectedDriveKPI(selected);
  setFetchingKPI(true);
  setKpiProgress(0);

  // Animate progress bar
  const interval = setInterval(() => {
    setKpiProgress(prev => (prev < 95 ? prev + 5 : prev));
  }, 100);

  fetch(`${import.meta.env.VITE_API_URL}/drive-test/column-range?column=${encodeURIComponent(selected)}`)
    .then((res) => res.json())
    .then(({ min, max }) => {
      if (typeof min === "number" && typeof max === "number") {
        setDriveLayerRange({ min, max });
        const step = (max - min) / 3;
        const defaultBands = {
          "#00ff00": [min, min + step],
          "#ffff00": [min + step, min + 2 * step],
          "#ff0000": [min + 2 * step, max],
        };
        setColorRanges(prev => ({
          ...prev,
          [selected]: prev[selected] || defaultBands
        }));
      } else {
        setDriveLayerRange({ min: null, max: null });
      }
    })
    .catch((err) => {
      console.error("❌ Failed fetching KPI range:", err);
      setDriveLayerRange({ min: null, max: null });
    })
    .finally(() => {
      clearInterval(interval);
      setKpiProgress(100); // complete
      setTimeout(() => {
        setFetchingKPI(false);
        setKpiProgress(0);
      }, 300);
      window.refreshDriveTestLayer?.();
    });
})}


      {/* === Range Info === */}
      {selectedDriveKPI && driveLayerRange.min != null && driveLayerRange.max != null && (
        <p className="range-info" style={{ fontSize: "10px", fontWeight: "bold" }}>
          Range <strong>{selectedDriveKPI}</strong>:{" "}
          <span>
            {driveLayerRange.min} – {driveLayerRange.max}
          </span>
        </p>
      )}

      {/* === Dynamic Color Bands for Drive Test KPI === */}
      {selectedDriveKPI && colorRanges[selectedDriveKPI] && (
        <div className="color-range-wrapper">
          {Object.entries(colorRanges[selectedDriveKPI]).map(([color, [min, max]]) => (
            <div key={color} className="color-range-row" style={{ marginBottom: "6px" }}>
              <label style={{ minWidth: 70, fontWeight: 500 }}>{getColorLabel(color)}:</label>

              {/* Color Picker */}
              <input
                type="color"
                value={color.startsWith("#") ? color : ""}
                onChange={(e) => {
                  const newColor = e.target.value;
                  setColorRanges((prev) => {
                    const bands = { ...prev[selectedDriveKPI] };
                    bands[newColor] = bands[color];
                    delete bands[color];
                    return { ...prev, [selectedDriveKPI]: bands };
                  });
                  window.refreshDriveTestLayer?.();
                }}
                style={{ width: 24, height: 24, border: "none", marginRight: 8 }}
              />

              {/* Min */}
              <input
                type="number"
                className="input"
                style={{ width: 70 }}
                value={min}
                onChange={(e) => {
                  setColorRanges((prev) => ({
                    ...prev,
                    [selectedDriveKPI]: {
                      ...prev[selectedDriveKPI],
                      [color]: [Number(e.target.value), max],
                    },
                  }));
                  window.refreshDriveTestLayer?.();
                }}
              />

              {/* Max */}
              <input
                type="number"
                className="input"
                style={{ width: 70 }}
                value={max}
                onChange={(e) => {
                  setColorRanges((prev) => ({
                    ...prev,
                    [selectedDriveKPI]: {
                      ...prev[selectedDriveKPI],
                      [color]: [min, Number(e.target.value)],
                    },
                  }));
                  window.refreshDriveTestLayer?.();
                }}
              />

              {/* Remove Band */}
              <button
                className="btn-remove"
                style={{ marginLeft: 6 }}
                onClick={() => {
                  setColorRanges((prev) => {
                    const updated = { ...prev[selectedDriveKPI] };
                    delete updated[color];
                    return { ...prev, [selectedDriveKPI]: updated };
                  });
                  window.refreshDriveTestLayer?.();
                }}
              >
                ❌
              </button>
            </div>
          ))}

          {/* === Add New Color Band === */}
          {!addingDriveColor ? (
            <button
              className="btn-add"
              style={{ marginTop: 8 }}
              onClick={() => {
                setAddingDriveColor(true);
                setNewDriveColorHex("#0000ff");
                setNewDriveMin(driveLayerRange.min ?? 0);
                setNewDriveMax(driveLayerRange.max ?? 0);
              }}
            >
              + Add Color Band
            </button>
          ) : (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: 8 }}>
              <input
                type="color"
                value={newDriveColorHex}
                onChange={(e) => setNewDriveColorHex(e.target.value)}
                style={{ width: 32, height: 32, border: "none" }}
              />
              <input
                type="number"
                placeholder="Min"
                value={newDriveMin}
                onChange={(e) => setNewDriveMin(Number(e.target.value))}
                className="input"
                style={{ width: 70 }}
              />
              <input
                type="number"
                placeholder="Max"
                value={newDriveMax}
                onChange={(e) => setNewDriveMax(Number(e.target.value))}
                className="input"
                style={{ width: 70 }}
              />
              <button
                className="btn-add"
                onClick={() => {
                  if (colorRanges[selectedDriveKPI]?.[newDriveColorHex]) {
                    alert("Color already exists!");
                    return;
                  }
                  if (newDriveMin >= newDriveMax) {
                    alert("Min must be less than Max.");
                    return;
                  }
                  setColorRanges((prev) => ({
                    ...prev,
                    [selectedDriveKPI]: {
                      ...prev[selectedDriveKPI],
                      [newDriveColorHex]: [newDriveMin, newDriveMax],
                    },
                  }));
                  setAddingDriveColor(false);
                  window.refreshDriveTestLayer?.();
                }}
              >
                ✅ Add
              </button>
              <button className="btn-remove" 
              style={{ marginLeft: 6 }}
              onClick={() => setAddingDriveColor(false)}
              >
                ❌ 
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );




        {/* <label>Select KPI to Display</label> */}
        {/* {renderDropdown('kpi', columns, false, kpiColumn, setKpiColumn)} */}
        <label>Save Template</label>
        <input
          type="text"
          className="input"
          placeholder="Template name"
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
        />
        <button className="btn" onClick={handleSaveTemplate} disabled={!templateName}>
          Save
        </button>

        

        <label>Export Options</label>
        <div className="button-row"></div>
        <button className="btn btn-outline" onClick={handleExportCSV}>
          Export as CSV
        </button>
        <button className="btn btn-outline" onClick={handleExportKML}>
          Export as KML
        </button>
        <button className="btn-primary" onClick={handleGenerate}>
          Generate Map
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
