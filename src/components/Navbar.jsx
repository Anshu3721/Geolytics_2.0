import React from 'react';
import './Styles.css'; // Use your Geolytics Styles.css for consistent styling

const Navbar = ({
  activeSubModule = "TPGA02",
  setActiveSubModule = () => {},
  modules = ["GeoLytics", "Vizbot", "Automation Studio", "PM Tool"],
  projects = ["Project A", "Project B"],
}) => {
  return (
    <nav className="geolytics-navbar">
      <div className="navbar-left">
        {/* Sidebar Icon */}
        <span className="icon-btn" id="sidebarCollapseBtn" onClick={() => console.log("Sidebar toggle")}>
          <i className="fas fa-bars"></i>
        </span>
        {/* Logo */}
        <a className="geolytics-logo" href="/">
          GeoLytics
        </a>
      </div>
      <div className="navbar-right">
        {/* Module Dropdown */}
        <div className="dropdown-wrapper">
          <button className="dropdown-btn">
            Module — GeoLytics
          </button>
          <ul className="dropdown-list" style={{ display: 'none' }}>
            {modules.map((mod, idx) => (
              <li key={idx}>
                <button className="dropdown-item">{mod}</button>
              </li>
            ))}
          </ul>
        </div>
        {/* Sub-Module Dropdown */}
        <div className="dropdown-wrapper">
          <button className="dropdown-btn">
            {activeSubModule}
          </button>
          <ul className="dropdown-list" style={{ display: 'none' }}>
            <li>
              <button className="dropdown-item" onClick={() => setActiveSubModule("TPGA02")}>
                TPGA02
              </button>
            </li>
            <li>
              <button className="dropdown-item" onClick={() => setActiveSubModule("TPGA03")}>
                TPGA03
              </button>
            </li>
          </ul>
        </div>
        {/* Project Dropdown */}
        <div className="dropdown-wrapper">
          <button className="dropdown-btn">
            Select Project
          </button>
          <ul className="dropdown-list" style={{ display: 'none' }}>
            {projects.map((proj, idx) => (
              <li key={idx}>
                <button className="dropdown-item">{proj}</button>
              </li>
            ))}
          </ul>
        </div>
        {/* Settings Icon */}
        <button className="icon-btn" title="Settings">
          <i className="fas fa-cog"></i>
        </button>
        {/* Profile Icon */}
        <button className="icon-btn" title="Profile">
          <i className="fas fa-user"></i>
        </button>
      </div>
    </nav>
  );
};

export default Navbar;