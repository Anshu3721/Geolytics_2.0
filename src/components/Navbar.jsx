import React from 'react';
import './Styles.css';

const Navbar = () => {
  return (
    <nav className="geolytics-navbar">
      <div className="navbar-left">
        <a className="geolytics-logo" href="/">Geolytics</a>
      </div>
      <div className="navbar-right">
        <div className="dropdown">
          <button className="dropdown-btn">Module — GeoLytics</button>
        </div>
        <div className="dropdown">
          <button className="dropdown-btn">TPGA02</button>
        </div>
        <button className="icon-btn">
          <i className="fas fa-cog"></i>
        </button>
        <button className="icon-btn">
          <i className="fas fa-user"></i>
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
