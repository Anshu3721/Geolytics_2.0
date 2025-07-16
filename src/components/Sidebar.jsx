import React, { useState, useEffect, useRef } from 'react';
import './Styles.css';

const Sidebar = ({ onGenerateMap }) => {
  const [tables, setTables] = useState([]);
  const [columns, setColumns] = useState([]);
  const [targetColumns, setTargetColumns] = useState([]);

  const [phdbTable, setPhdbTable] = useState('');
  const [targetTable, setTargetTable] = useState('');
  const [requiredCols, setRequiredCols] = useState({
  site_id: 'Site_ID',        // fallback: 'D2EL02'
  cellname: 'Cell_name',     // fallback: 'D2EL01'
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


useEffect(() => {
  if (columns.length && targetColumns.length) {
    const intersection = columns.filter((col) => targetColumns.includes(col));
    setValidJoinOptions({ physical: intersection, target: intersection });

    // Optional: auto-select first common col
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

      // Auto-assign required columns if they exist in the fetched list
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
      return res.json(); // Optional: use response if needed
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
    console.log("Payload sent to App:", payload);
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

    // Only initialize colorRanges if not already present
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

    // Fetch min/max range for the selected layer column
    fetch(`${import.meta.env.VITE_API_URL}/column-range?table=${phdbTable || targetTable}&column=${selected}`)
      .then((res) => res.json())
      .then(({ min, max }) => {
        if (typeof min === 'number' && typeof max === 'number') {
          setLayerRange({ min, max });
        } else {
          console.warn('Non-numeric column selected for layer range');
          setLayerRange({ min: null, max: null });
        }
      })
      .catch((err) => {
        console.error('Error fetching layer column range', err);
        setLayerRange({ min: null, max: null });
      });
  })}

  {/* Display the range (min–max) below the dropdown */}
  {layerColumn && layerRange.min !== null && layerRange.max !== null && (
    <p className="range-info">
      Range for <strong>{layerColumn}</strong>: <span>{layerRange.min} – {layerRange.max}</span>
    </p>
  )}

  {/* Editable color buckets */}
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
        <button className="btn">Export as CSV</button>
        <button className="btn">Export as KML</button>
        <button className="btn-primary" onClick={handleGenerate}> Generate Map</button>
      </div>
    </div>
  );
};

export default Sidebar;
 