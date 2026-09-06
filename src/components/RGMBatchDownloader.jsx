import React, { useState } from "react";

export default function RGMBatchDownloader() {
  const [inputList, setInputList] = useState("");
  const [items, setItems] = useState([]); // [{ id, name, rgmUrl, ddsUrl, loading }]
  const [downloadLoading, setDownloadLoading] = useState({});

  // Khi paste vào textarea → tự động sinh links
  function handlePaste(text) {
    setInputList(text);

    // Split by newline, trim, filter empty
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    // Tạo items (mỗi item 1 base name + 2 links RGM + DDS)
    const newItems = lines.map((name, idx) => ({
      id: `${name}_${idx}`,
      name,
      rgmUrl: `https://cdn.aumix3d.com/data/${encodeURIComponent(name)}.rgm`,
      ddsUrl: `https://cdn.aumix3d.com/textures/${encodeURIComponent(name)}.png`,
    }));

    setItems(newItems);
  }

  // Download file
  async function downloadFile(url, filename, itemId, type) {
    const key = `${itemId}_${type}`;
    setDownloadLoading((s) => ({ ...s, [key]: true }));

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
      const ok = window.confirm("Download thất bại. Mở link trong tab mới?");
      if (ok) window.open(url, "_blank");
    } finally {
      setDownloadLoading((s) => ({ ...s, [key]: false }));
    }
  }

  return (
    <div style={{ padding: "16px", background: "rgba(0,0,0,0.2)", borderRadius: "8px" }}>
      <h3 style={{ marginTop: 0 }}>Batch Download RGM/DDS</h3>

      <label className="label">Paste RGM base names (one per line)</label>
      <textarea
        className="parser-textarea"
        placeholder="ff_v0319&#10;something_else&#10;another_code&#10;..."
        value={inputList}
        onChange={(e) => handlePaste(e.target.value)}
        style={{ width: "100%", minHeight: "120px", marginBottom: "16px" }}
      />

      {items.length > 0 && (
        <div>
          <div style={{ fontSize: "12px", color: "#9aa0a6", marginBottom: "12px" }}>
            {items.length} item(s) - Copy/paste links or use buttons
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {items.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: "12px",
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: "6px",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                {/* Base name */}
                <div style={{ fontSize: "13px", fontWeight: "500", marginBottom: "8px" }}>
                  {item.name}
                </div>

                {/* Links & Buttons */}
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  {/* RGM Link */}
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <input
                      type="text"
                      value={item.rgmUrl}
                      readOnly
                      style={{
                        width: "100%",
                        padding: "6px 8px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ccc",
                        fontSize: "11px",
                        borderRadius: "4px",
                        fontFamily: "monospace",
                      }}
                    />
                  </div>
                  <button
                    className="btn btn-green"
                    onClick={() =>
                      downloadFile(item.rgmUrl, `${item.name}.rgm`, item.id, "rgm")
                    }
                    disabled={downloadLoading[`${item.id}_rgm`]}
                    style={{ padding: "6px 12px", fontSize: "12px" }}
                  >
                    {downloadLoading[`${item.id}_rgm`] ? "..." : "DL"}
                  </button>

                  {/* DDS Link */}
                  {/* <div style={{ flex: 1, minWidth: "200px" }}>
                    <input
                      type="text"
                      value={item.ddsUrl}
                      readOnly
                      style={{
                        width: "100%",
                        padding: "6px 8px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ccc",
                        fontSize: "11px",
                        borderRadius: "4px",
                        fontFamily: "monospace",
                      }}
                    />
                  </div>
                  <button
                    className="btn btn-blue"
                    onClick={() =>
                      downloadFile(item.ddsUrl, `${item.name}.png`, item.id, "dds")
                    }
                    disabled={downloadLoading[`${item.id}_dds`]}
                    style={{ padding: "6px 12px", fontSize: "12px" }}
                  >
                    {downloadLoading[`${item.id}_dds`] ? "..." : "DL"}
                  </button> */}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}