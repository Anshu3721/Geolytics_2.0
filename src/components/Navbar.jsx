import React, { useState, useRef, useEffect } from 'react';

const Navbar = ({
  activeSubModule = 'TPGA02',
  setActiveSubModule = () => {},
  modules = ['GeoLytics', 'Vizbot', 'Automation Studio', 'PM Tool'],
}) => {
  const [showSubModuleMenu, setShowSubModuleMenu] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [subModulePosition, setSubModulePosition] = useState('down');

  const subModuleBtnRef = useRef(null);
  const subModuleMenuRef = useRef(null);

  useEffect(() => {
    if (showSubModuleMenu && subModuleBtnRef.current && subModuleMenuRef.current) {
      const btnRect = subModuleBtnRef.current.getBoundingClientRect();
      const dropdownHeight = subModuleMenuRef.current.offsetHeight;
      const spaceBelow = window.innerHeight - btnRect.bottom;
      const spaceAbove = btnRect.top;

      if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
        setSubModulePosition('up');
      } else {
        setSubModulePosition('down');
      }
    }
  }, [showSubModuleMenu]);

  return (
    <>
      <style>{`
        .geolytics-navbar {
          background-color: #dcfce7;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 12px;
          font-family: 'Segoe UI', sans-serif;
          height: 36px;
          border-bottom: 1px solid #ccc;
        }

        .navbar-left {
          display: flex;
          align-items: center;
        }

        .geolytics-logo {
          font-weight: bold;
          font-size: 13px;
          text-decoration: none;
          color: #000;
          margin-left: 8px;
        }

        .navbar-right {
          display: flex;
          align-items: center;
          gap: 8px;x
          position: relative;
        }

        .dropdown-btn, .icon-btn {
          background-color: #bbf7d0;
          border: 1px solid #000;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          color: #000;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
        }

        .dropdown-btn:hover, .icon-btn:hover {
          background-color: #86efac;
        }

        .dropdown-content {
          position: absolute;
          background-color: white;
          border: 1px solid #ccc;
          border-radius: 4px;
          z-index: 9999 !important;
          box-shadow: 0 2px 6px rgba(0,0,0,0.1);
          font-size: 12px;
          min-width: 120px;
        }

        .dropdown-content button {
          color: #000;
          background: none;
          border: none;
          text-align: left;
          padding: 6px 10px;
          width: 100%;
          cursor: pointer;
        }

        .dropdown-content button:hover {
          background-color: #d1fae5;
        }

        .drop-up {
          bottom: 100%;
          margin-bottom: 6px;
        }

        .drop-down {
          top: 100%;
          margin-top: 6px;
        }

        .icon-btn span {
          margin-left: 2px;
        }
          .profile-btn {
          background-color: #dcfce7;
          border: 1px #000;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          color: #000;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
        }

      `}</style>

      <nav className="geolytics-navbar">
        <div className="navbar-left">
          <span className="profile-btn" title="Toggle Sidebar">
            <span>≡</span>
          </span>
          <a className="geolytics-logo" href="/">Geolytics</a>
        </div>

        <div className="navbar-right">
          {/* Module dropdown - placeholder static */}
          <button className="dropdown-btn">
            Module — GeoLytics <span>▾</span>
          </button>

          {/* Submodule dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              ref={subModuleBtnRef}
              className="dropdown-btn"
              onClick={() => setShowSubModuleMenu(prev => !prev)}
            >
              {activeSubModule} <span>▾</span>
            </button>
            {showSubModuleMenu && (
              <div
                ref={subModuleMenuRef}
                className={`dropdown-content ${subModulePosition === 'up' ? 'drop-up' : 'drop-down'}`}
              >
                {['TPGA01', 'TPGA02', 'TPGA03'].map(sub => (
                  <button
                    key={sub}
                    onClick={() => {
                      setActiveSubModule(sub);
                      setShowSubModuleMenu(false);
                    }}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Settings */}
          <button className="profile-btn" title="Settings">
            <span>⚙️</span>
          </button>

          {/* Profile dropdown - text-based 👤 icon */}
          <div style={{ position: 'relative' }}>
            <button
              className="profile-btn"
              onClick={() => setShowProfileMenu(prev => !prev)}
              title="Profile"
            >
              <span role="img" aria-label="Profile">👤</span> <span>▾</span>
            </button>
            {showProfileMenu && (
              <div className="dropdown-content drop-down" style={{ right: 0 }}>
                <button>Profile</button>
                <button>Logout</button>
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  );
};

export default Navbar;
