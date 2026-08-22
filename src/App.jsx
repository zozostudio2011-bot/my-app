import React from "react";
import "./index.css";

export default function App() {
  return (
    <div className="app">
      <div className="wrap">
        <div className="column left-card card">
          <h2 className="card-title">RGM Item Downloader</h2>

          {/* Controls moved up (removed big radio area) */}
          <div className="control-group">
            <label className="label">FileName (copy from JSON)</label>
            <input className="text-input" placeholder="ex: mh_v1004" />

            <button className="btn btn-green">Download RGM</button>
          </div>

          <div className="control-group">
            <label className="label">DDS File Name</label>
            <input className="text-input" placeholder="ex: mf_v0253" />

            <button className="btn btn-blue">Download DDS</button>
          </div>
        </div>

        <div className="column right-card card">
          <h2 className="card-title">RGM Parser</h2>

          <label className="label">Paste RGM Codes</label>
          <textarea className="parser-textarea" placeholder="Paste codes here..." />

          <div className="file-row">
            <input type="file" />
            <span className="file-hint">Choose Files</span>
          </div>
        </div>
      </div>
    </div>
  );
}