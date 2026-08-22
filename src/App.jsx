// import React, { useState } from "react";
// import "./index.css";

// export default function App() {
//   const [rgmName, setRgmName] = useState("");
//   const [ddsName, setDdsName] = useState("");
//   const [loading, setLoading] = useState({ rgm: false, dds: false });

//   // Generic download helper: fetch -> blob -> create link -> click
//   async function downloadBlobFromUrl(url, suggestedFilename) {
//     const res = await fetch(url);
//     if (!res.ok) throw new Error(`Request failed: ${res.status}`);
//     const blob = await res.blob();
//     const blobUrl = URL.createObjectURL(blob);
//     const a = document.createElement("a");
//     a.href = blobUrl;
//     a.download = suggestedFilename || "download";
//     document.body.appendChild(a);
//     a.click();
//     a.remove();
//     URL.revokeObjectURL(blobUrl);
//   }

//   async function handleDownloadRgm() {
//     if (!rgmName.trim()) return alert("Please enter a filename for RGM (e.g. mf_v0146)");
//     const file = rgmName.trim();
//     // construct URL
//     const url = `https://cdn.aumix3d.com/data/${encodeURIComponent(file)}.rgm`;
//     setLoading((s) => ({ ...s, rgm: true }));
//     try {
//       // some CDNs don't allow cross-origin download via `download` attribute; fetching and creating a blob forces download
//       await downloadBlobFromUrl(url, `${file}.rgm`);
//     } catch (err) {
//       console.error(err);
//       // fallback: open in new tab so user can save manually
//       const ok = window.confirm(
//         "Could not download automatically. Open file in a new tab instead?"
//       );
//       if (ok) window.open(url, "_blank");
//     } finally {
//       setLoading((s) => ({ ...s, rgm: false }));
//     }
//   }

//   async function handleDownloadDds() {
//     if (!ddsName.trim()) return alert("Please enter a DDS image name (e.g. mf_v0430_001)");
//     const file = ddsName.trim();
//     // construct URL
//     const url = `https://cdn.aumix3d.com/textures/${encodeURIComponent(file)}.png`;
//     setLoading((s) => ({ ...s, dds: true }));
//     try {
//       await downloadBlobFromUrl(url, `${file}.png`);
//     } catch (err) {
//       console.error(err);
//       const ok = window.confirm(
//         "Could not download automatically. Open image in a new tab instead?"
//       );
//       if (ok) window.open(url, "_blank");
//     } finally {
//       setLoading((s) => ({ ...s, dds: false }));
//     }
//   }

//   return (
//     <div className="app">
//       <div className="wrap">
//         <div className="column left-card card">
//           <h2 className="card-title">RGM Item Downloader</h2>

//           <div className="control-group">
//             <label className="label">FileName (copy from JSON)</label>
//             <input
//               className="text-input"
//               placeholder="ex: mf_v0146"
//               value={rgmName}
//               onChange={(e) => setRgmName(e.target.value)}
//             />

//             <button
//               className="btn btn-green"
//               onClick={handleDownloadRgm}
//               disabled={loading.rgm}
//             >
//               {loading.rgm ? "Downloading..." : "Download RGM"}
//             </button>
//           </div>

//           <div className="control-group">
//             <label className="label">DDS File Name</label>
//             <input
//               className="text-input"
//               placeholder="ex: mf_v0430_001"
//               value={ddsName}
//               onChange={(e) => setDdsName(e.target.value)}
//             />

//             <button
//               className="btn btn-blue"
//               onClick={handleDownloadDds}
//               disabled={loading.dds}
//             >
//               {loading.dds ? "Downloading..." : "Download DDS"}
//             </button>
//           </div>
//         </div>

//         <div className="column right-card card">
//           <h2 className="card-title">RGM Parser</h2>

//           <label className="label">Paste RGM Codes</label>
//           <textarea className="parser-textarea" placeholder="Paste codes here..." />

//           <div className="file-row">
//             <input type="file" />
//             <span className="file-hint">Choose Files</span>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

import React, { useState, useEffect } from "react";
import "./index.css";
// Import parser file for side effects only — DO NOT MODIFY rgmParser.js
import "./rgmParser";

export default function App() {
  // Left side states (download by name)
  const [rgmName, setRgmName] = useState("");
  const [ddsName, setDdsName] = useState("");
  const [loading, setLoading] = useState({ rgm: false, dds: false });

  // Right side states (parsing folder)
  const [inputList, setInputList] = useState("");
  const [results, setResults] = useState([]); // { baseName, textures: [], error }
  const [parsing, setParsing] = useState(false);
  const [parserReady, setParserReady] = useState(false);

  // When component mounts, check parser availability
  useEffect(() => {
    // parser might attach to window (your original file) OR export — we only imported for side effects.
    if (typeof window.parseRGMFile === "function") {
      setParserReady(true);
    } else {
      // small delay in case parser file is heavy; check again later
      const id = setTimeout(() => {
        setParserReady(typeof window.parseRGMFile === "function");
      }, 200);
      return () => clearTimeout(id);
    }
  }, []);

  async function downloadBlobFromUrl(url, suggestedFilename) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = suggestedFilename || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
      const ok = window.confirm("Tự động download thất bại. Mở file trong tab mới thay thế?");
      if (ok) window.open(url, "_blank");
    }
  }

  // Left: download RGM file from CDN by base name
  async function handleDownloadRgm() {
    if (!rgmName.trim()) return alert("Nhập tên file RGM (ví dụ: mf_v0146)");
    const file = rgmName.trim();
    const url = `https://cdn.aumix3d.com/data/${encodeURIComponent(file)}.rgm`;
    setLoading((s) => ({ ...s, rgm: true }));
    try {
      await downloadBlobFromUrl(url, `${file}.rgm`);
    } finally {
      setLoading((s) => ({ ...s, rgm: false }));
    }
  }

  // Left: download texture by name (dds/png)
  async function handleDownloadDds() {
    if (!ddsName.trim()) return alert("Nhập tên hình (ví dụ: mf_v0430_001)");
    const file = ddsName.trim();
    const url = `https://cdn.aumix3d.com/textures/${encodeURIComponent(file)}.png`;
    setLoading((s) => ({ ...s, dds: true }));
    try {
      await downloadBlobFromUrl(url, `${file}.png`);
    } finally {
      setLoading((s) => ({ ...s, dds: false }));
    }
  }

  // RIGHT: handle folder selection
  // async function handleFolderSelect(e) {
  //   const fileList = Array.from(e.target.files || []);
  //   if (!fileList.length) return;
  //   const names = inputList
  //     .split(/\r?\n/)
  //     .map((s) => s.trim())
  //     .filter(Boolean);
  //   if (!names.length) return alert("Paste danh sách base names (mỗi dòng 1 tên) trước khi chọn folder.");
  //   const nameSet = new Set(names);

  //   // Filter .rgm files that match
  //   const matched = fileList.filter((f) => {
  //     if (!f.name.toLowerCase().endsWith(".rgm")) return false;
  //     const base = f.name.replace(/\.rgm$/i, "");
  //     return nameSet.has(base);
  //   });

  //   if (!matched.length) {
  //     setResults([]);
  //     return alert("Không tìm thấy file .rgm khớp trong folder đã chọn.");
  //   }

  //   if (typeof window.parseRGMFile !== "function") {
  //     // parser missing
  //     setResults(matched.map((f) => ({ baseName: f.name.replace(/\.rgm$/i, ""), textures: [], error: "Parser not loaded" })));
  //     return alert("Parser chưa load được (window.parseRGMFile không tồn tại). Kiểm tra rgmParser.js đã ở src và được import.");
  //   }

  //   setParsing(true);
  //   const out = [];
  //   for (const file of matched) {
  //     const base = file.name.replace(/\.rgm$/i, "");
  //     try {
  //       const buffer = await file.arrayBuffer();
  //       // parse using your parser (attached to window)
  //       const parsed = window.parseRGMFile(buffer);
  //       if (!parsed) {
  //         out.push({ baseName: base, textures: [], error: "Parse trả về null/invalid" });
  //         continue;
  //       }

  //       // Try to use convertToThreeJSData if available; otherwise fallback to extracting textureData
  //       let meshList = [];
  //       if (typeof window.convertToThreeJSData === "function") {
  //         try {
  //           meshList = window.convertToThreeJSData(parsed);
  //         } catch (err) {
  //           console.warn("convertToThreeJSData threw:", err);
  //           meshList = [];
  //         }
  //       }

  //       // Collect texture names
  //       const texSet = new Set();
  //       if (meshList && meshList.length) {
  //         for (const m of meshList) {
  //           if (Array.isArray(m.textureNames)) {
  //             for (const t of m.textureNames) if (t) texSet.add(t);
  //           }
  //         }
  //       } else {
  //         // Fallback: traverse parsed.chunk.x2A[*].meshData.textureData[*].filename
  //         try {
  //           const arr = parsed?.chunk?.x2A || [];
  //           for (const mesh of arr) {
  //             const texs = mesh?.meshData?.textureData || [];
  //             for (const td of texs) {
  //               if (td && td.filename) texSet.add(td.filename);
  //             }
  //           }
  //         } catch (err) {
  //           console.warn("Fallback texture extraction failed", err);
  //         }
  //       }

  //       const textures = Array.from(texSet);
  //       out.push({ baseName: base, textures, error: textures.length ? null : null });
  //     } catch (err) {
  //       console.error("Error parsing file", file.name, err);
  //       out.push({ baseName: base, textures: [], error: err?.message || String(err) });
  //     }
  //   }
  //   setResults(out);
  //   setParsing(false);
  // }

  async function handleFolderSelect(e) {
  const fileList = Array.from(e.target.files || []);
  if (!fileList.length) return;

  // Split by any whitespace (space, newline, tab). Also accept tokens that include .rgm (we strip it).
  const tokens = (inputList || "")
    .trim()
    .split(/\s+/)                      // split on any whitespace
    .map((t) => t.replace(/\.rgm$/i, "").trim()) // remove trailing .rgm if present
    .filter(Boolean);

  if (!tokens.length) return alert("Paste danh sách base names (mỗi token cách nhau bởi space/newline) trước khi chọn folder.");
  const nameSet = new Set(tokens.map((t) => t.toLowerCase())); // compare case-insensitive

  // Filter .rgm files that match any token
  const matched = fileList.filter((f) => {
    if (!f.name.toLowerCase().endsWith(".rgm")) return false;
    const base = f.name.replace(/\.rgm$/i, "").toLowerCase();
    return nameSet.has(base);
  });

  if (!matched.length) {
    setResults([]);
    return alert("Không tìm thấy file .rgm khớp trong folder đã chọn.");
  }

  if (typeof window.parseRGMFile !== "function") {
    // parser missing
    setResults(
      matched.map((f) => ({
        baseName: f.name.replace(/\.rgm$/i, ""),
        textures: [],
        error: "Parser not loaded",
      }))
    );
    return alert("Parser chưa load được (window.parseRGMFile không tồn tại). Kiểm tra rgmParser.js đã ở src và được import.");
  }

  setParsing(true);
  const out = [];
  for (const file of matched) {
    const base = file.name.replace(/\.rgm$/i, "");
    try {
      const buffer = await file.arrayBuffer();
      // parse using your parser (attached to window)
      const parsed = window.parseRGMFile(buffer);
      if (!parsed) {
        out.push({ baseName: base, textures: [], error: "Parse trả về null/invalid" });
        continue;
      }

      // Try to use convertToThreeJSData if available; otherwise fallback to extracting textureData
      let meshList = [];
      if (typeof window.convertToThreeJSData === "function") {
        try {
          meshList = window.convertToThreeJSData(parsed);
        } catch (err) {
          console.warn("convertToThreeJSData threw:", err);
          meshList = [];
        }
      }

      // Collect texture names
      const texSet = new Set();
      if (meshList && meshList.length) {
        for (const m of meshList) {
          if (Array.isArray(m.textureNames)) {
            for (const t of m.textureNames) if (t) texSet.add(t);
          }
        }
      } else {
        // Fallback: traverse parsed.chunk.x2A[*].meshData.textureData[*].filename
        try {
          const arr = parsed?.chunk?.x2A || [];
          for (const mesh of arr) {
            const texs = mesh?.meshData?.textureData || [];
            for (const td of texs) {
              if (td && td.filename) texSet.add(td.filename);
            }
          }
        } catch (err) {
          console.warn("Fallback texture extraction failed", err);
        }
      }

      const textures = Array.from(texSet);
      out.push({ baseName: base, textures, error: textures.length ? null : null });
    } catch (err) {
      console.error("Error parsing file", file.name, err);
      out.push({ baseName: base, textures: [], error: err?.message || String(err) });
    }
  }
  setResults(out);
  setParsing(false);
}

  // Download texture by texture base name (from parser)
  async function downloadTextureByName(textureName) {
    if (!textureName) return;
    const url = `https://cdn.aumix3d.com/textures/${encodeURIComponent(textureName)}.png`;
    await downloadBlobFromUrl(url, `${textureName}.png`);
  }

  return (
    <div className="app">
      <div className="wrap">
        {/* LEFT */}
        <div className="column left-card card">
          <h2 className="card-title">RGM Item Downloader</h2>

          <div className="control-group">
            <label className="label">FileName (copy from JSON)</label>
            <input
              className="text-input"
              placeholder="ex: mf_v0146"
              value={rgmName}
              onChange={(e) => setRgmName(e.target.value)}
            />
            <button className="btn btn-green" onClick={handleDownloadRgm} disabled={loading.rgm}>
              {loading.rgm ? "Downloading..." : "Download RGM"}
            </button>
          </div>

          <div className="control-group">
            <label className="label">DDS File Name</label>
            <input
              className="text-input"
              placeholder="ex: mf_v0430_001"
              value={ddsName}
              onChange={(e) => setDdsName(e.target.value)}
            />
            <button className="btn btn-blue" onClick={handleDownloadDds} disabled={loading.dds}>
              {loading.dds ? "Downloading..." : "Download DDS"}
            </button>
          </div>
        </div>

        {/* RIGHT */}
        <div className="column right-card card">
          <h2 className="card-title">RGM Parser</h2>

          <label className="label">Paste RGM base names (one per line)</label>
          <textarea
            className="parser-textarea"
            placeholder="fh_v2375\nff_v0377\n..."
            value={inputList}
            onChange={(e) => setInputList(e.target.value)}
          />

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <label className="label" style={{ margin: 0 }}>
              Choose folder with .rgm files
            </label>
            <input type="file" webkitdirectory="true" directory="true" multiple onChange={handleFolderSelect} />
          </div>

          <div style={{ marginTop: 18 }}>
            {!parserReady && (
              <div style={{ color: "#ffcc66", marginBottom: 8 }}>
                Parser chưa sẵn sàng — kiểm tra src/rgmParser.js (mình đã import nhưng window.parseRGMFile chưa có).
              </div>
            )}

            {parsing && <div style={{ color: "#9aa0a6" }}>Parsing matched files...</div>}

            {results.map((r, idx) => (
              <div key={idx} style={{ marginTop: 12, padding: 10, border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{r.baseName}</strong>
                  {r.error ? <span style={{ color: "#ff8b8b" }}>{r.error}</span> : <span style={{ color: "#9aa0a6" }}>{r.textures.length} texture(s)</span>}
                </div>

                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {r.textures.length === 0 && !r.error && <span style={{ color: "#9aa0a6" }}>No textures found</span>}
                  {r.textures.map((tname, i) => (
                    <button
                      key={i}
                      className="btn"
                      style={{ padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 6, fontSize: 13 }}
                      onClick={() => downloadTextureByName(tname)}
                    >
                      {tname}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}