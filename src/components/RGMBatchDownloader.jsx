import React, { useState, useRef, useEffect } from "react";
import JSZip from "jszip";
import {
  parseTexturesFromRgmBuffer,
  cleanTextureName,
  getRgmUrl,
  getTextureUrl,
  sleepWithJitter,
  triggerDownload,
} from "../utils/rgmHelper";
import {
  getR2Config,
  saveR2Config,
  checkFileOnR2,
  uploadToR2,
  testR2Connection,
} from "../utils/r2Storage";

export default function RGMBatchDownloader() {
  const [inputList, setInputList] = useState("");
  const [items, setItems] = useState([]);

  // Settings thời gian chờ ngẫu nhiên giữa các lần bấm
  const [minDelay, setMinDelay] = useState(1.0); // giây
  const [maxDelay, setMaxDelay] = useState(2.5); // giây
  const [deduplicate, setDeduplicate] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // Cấu hình Cloudflare R2
  const [r2Config, setR2Config] = useState(getR2Config);
  const [showR2Modal, setShowR2Modal] = useState(false);
  const [r2TestStatus, setR2TestStatus] = useState({ type: "idle", msg: "" });

  // Execution state
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMode, setProcessingMode] = useState(null); // 'zip' | 'direct'
  const [activeItemId, setActiveItemId] = useState(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [progress, setProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [downloadLoading, setDownloadLoading] = useState({});

  // Abort controller ref
  const abortRef = useRef(false);

  // Lưu r2Config khi thay đổi
  function handleR2Change(field, val) {
    const updated = { ...r2Config, [field]: val };
    setR2Config(updated);
    saveR2Config(updated);
  }

  // Test kết nối R2
  async function handleTestR2() {
    setR2TestStatus({ type: "testing", msg: "Đang gửi ping kiểm tra tới Cloudflare R2..." });
    try {
      await testR2Connection(r2Config);
      setR2TestStatus({ type: "success", msg: "✅ Kết nối và quyền Upload vào R2 thành công!" });
    } catch (err) {
      console.error(err);
      setR2TestStatus({
        type: "error",
        msg: `❌ Lỗi kết nối: ${err.message || String(err)}. Kiểm tra lại Account ID, Keys, hoặc CORS của Bucket.`,
      });
    }
  }

  // Khi paste vào textarea → tự động parse ra danh sách items
  function handlePaste(text) {
    setInputList(text);

    let lines = text
      .split(/[\r\n]+/)
      .map((line) => line.trim().replace(/\.rgm$/i, "").replace(/[\\/]/g, ""))
      .filter(Boolean);

    if (deduplicate) {
      lines = Array.from(new Set(lines));
    }

    const newItems = lines.map((name, idx) => ({
      id: `${name}_${idx}_${Date.now()}`,
      name,
      rgmUrl: getRgmUrl(name),
      status: "idle", // 'idle' | 'waiting' | 'downloading_rgm' | 'parsing' | 'downloading_tex' | 'done' | 'error'
      statusText: "Chờ xử lý",
      r2Source: null, // 'cached' (đã có trên R2) | 'synced' (vừa up lên R2) | 'cdn' (từ CDN gốc)
      textures: [],
      error: null,
    }));

    setItems(newItems);
    setProgress({ current: 0, total: newItems.length, percent: 0 });
    setLiveMessage("");
  }

  // Cập nhật trạng thái từng item an toàn
  function updateItem(id, updates) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...updates } : it))
    );
  }

  // Dừng tiến trình
  function handleStop() {
    abortRef.current = true;
    setIsProcessing(false);
    setActiveItemId(null);
    setLiveMessage("⏹ Đã dừng tiến trình bởi người dùng.");
  }

  // Giả lập chờ ngẫu nhiên ("có nhanh có chậm") với thông báo đếm ngược live
  async function simulateHumanWait(actionLabel) {
    const minMs = Math.round(minDelay * 1000);
    const maxMs = Math.round(maxDelay * 1000);
    return await sleepWithJitter(minMs, maxMs, (remaining, total) => {
      setLiveMessage(
        `🤖 Giả lập người bấm: Chờ ${(remaining / 1000).toFixed(1)}s (nghỉ ngẫu nhiên ${(total / 1000).toFixed(1)}s)... ${actionLabel ? `[${actionLabel}]` : ""}`
      );
    });
  }

  // Tải trực tiếp 1 file đơn lẻ (manual click)
  async function handleDownloadSingle(url, filename, key) {
    setDownloadLoading((s) => ({ ...s, [key]: true }));
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      triggerDownload(blob, filename);
    } catch (err) {
      console.error(err);
      const ok = window.confirm(`Không thể tải ${filename}. Mở link trong tab mới?`);
      if (ok) window.open(url, "_blank");
    } finally {
      setDownloadLoading((s) => ({ ...s, [key]: false }));
    }
  }

  // Parse thủ công 1 file RGM đơn lẻ để tìm texture
  async function handleManualParse(item) {
    updateItem(item.id, { status: "parsing", statusText: "Đang tải & parse..." });
    try {
      const res = await fetch(item.rgmUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}: Không tìm thấy file RGM`);
      const buffer = await res.arrayBuffer();
      const textures = parseTexturesFromRgmBuffer(buffer);
      updateItem(item.id, {
        status: "idle",
        statusText: `Tìm thấy ${textures.length} texture`,
        textures,
      });
    } catch (err) {
      updateItem(item.id, {
        status: "error",
        statusText: err.message,
        error: err.message,
      });
    }
  }

  // TIẾN TRÌNH TỰ ĐỘNG CHÍNH (CÓ TÍCH HỢP CLOUDFLARE R2 CACHE + SYNC)
  async function runBatchProcess(mode) {
    if (!items.length) {
      return alert("Vui lòng dán danh sách tên RGM trước!");
    }

    abortRef.current = false;
    setIsProcessing(true);
    setProcessingMode(mode);

    const isR2Enabled = Boolean(r2Config.enabled && r2Config.publicUrl);
    const canUploadR2 = Boolean(
      isR2Enabled && r2Config.bucketName && r2Config.accountId && r2Config.accessKeyId && r2Config.secretAccessKey
    );

    const zip = mode === "zip" ? new JSZip() : null;
    const downloadedTextureSet = new Set();
    let totalFilesCount = 0;

    for (let i = 0; i < items.length; i++) {
      if (abortRef.current) break;

      const item = items[i];
      setActiveItemId(item.id);
      setProgress({
        current: i + 1,
        total: items.length,
        percent: Math.round(((i + 1) / items.length) * 100),
      });

      let rgmBuffer = null;
      let rgmBlob = null;
      let rgmSource = "cdn";

      // BƯỚC 1: KIỂM TRA FILE RGM TRÊN CLOUDFLARE R2 TRƯỚC
      let r2RgmUrl = null;
      if (isR2Enabled) {
        setLiveMessage(`🔍 [${i + 1}/${items.length}] Kiểm tra ${item.name}.rgm trên R2...`);
        r2RgmUrl = await checkFileOnR2(r2Config.publicUrl, `${item.name}.rgm`);
      }

      if (r2RgmUrl) {
        // ĐÃ CÓ TRÊN R2 -> TẢI TRỰC TIẾP TỪ R2 (CỰC NHANH, KHÔNG LO BỊ CDN GỐC LIMIT)
        rgmSource = "cached";
        updateItem(item.id, {
          status: "downloading_rgm",
          statusText: "⚡ Đã có trên R2! Tải trực tiếp...",
          r2Source: "cached",
        });
        setLiveMessage(`⚡ [${i + 1}/${items.length}] Tải ${item.name}.rgm trực tiếp từ Cloudflare R2...`);

        try {
          const res = await fetch(r2RgmUrl);
          if (!res.ok) throw new Error(`Lỗi tải từ R2 (HTTP ${res.status})`);
          rgmBuffer = await res.arrayBuffer();
          rgmBlob = new Blob([rgmBuffer]);
          totalFilesCount++;

          if (mode === "direct") {
            triggerDownload(rgmBlob, `${item.name}.rgm`);
          } else if (mode === "zip") {
            zip.file(`${item.name}.rgm`, rgmBlob);
          }
        } catch (r2Err) {
          console.warn("Lỗi tải từ R2, chuyển sang CDN gốc:", r2Err);
          r2RgmUrl = null; // Chuyển về tải CDN gốc
        }
      }

      // NẾU CHƯA CÓ TRÊN R2 (HOẶC TẮT R2) -> TẢI TỪ CDN GỐC VỚI DELAY GIẢ LẬP
      if (!r2RgmUrl) {
        updateItem(item.id, {
          status: "waiting",
          statusText: isR2Enabled ? "Chưa có trên R2 -> Chờ tải CDN gốc..." : "Chờ giả lập bấm tải RGM...",
        });
        await simulateHumanWait(`Bấm tải ${item.name}.rgm từ CDN`);
        if (abortRef.current) break;

        updateItem(item.id, {
          status: "downloading_rgm",
          statusText: "Đang tải file RGM từ CDN...",
        });
        setLiveMessage(`📥 [${i + 1}/${items.length}] Đang tải ${item.name}.rgm từ CDN gốc...`);

        try {
          const res = await fetch(item.rgmUrl);
          if (!res.ok) throw new Error(`Không tải được RGM (HTTP ${res.status})`);
          rgmBuffer = await res.arrayBuffer();
          rgmBlob = new Blob([rgmBuffer]);
          totalFilesCount++;

          if (mode === "direct") {
            triggerDownload(rgmBlob, `${item.name}.rgm`);
          } else if (mode === "zip") {
            zip.file(`${item.name}.rgm`, rgmBlob);
          }

          // NẾU BẬT R2 VÀ CÓ QUYỀN UPLOAD -> TỰ ĐỘNG UP LÊN R2
          if (canUploadR2) {
            setLiveMessage(`☁️ Đang đồng bộ lưu ${item.name}.rgm lên Cloudflare R2...`);
            try {
              await uploadToR2(r2Config, `${item.name}.rgm`, rgmBuffer, "application/octet-stream");
              rgmSource = "synced";
              updateItem(item.id, { r2Source: "synced" });
              setLiveMessage(`✅ Đã lưu ${item.name}.rgm lên R2 thành công!`);
            } catch (upErr) {
              console.warn("Lỗi upload R2:", upErr);
            }
          }
        } catch (err) {
          console.error(`Lỗi tải RGM ${item.name}:`, err);
          updateItem(item.id, {
            status: "error",
            statusText: err.message,
            error: err.message,
          });
          continue;
        }
      }

      // BƯỚC 2: PARSE FILE RGM TRONG BỘ NHỚ ĐỂ TÌM DDS TEXTURES
      updateItem(item.id, {
        status: "parsing",
        statusText: "Đang phân tích DDS textures...",
      });
      setLiveMessage(`🔍 Phân tích cấu trúc 3D của ${item.name}.rgm...`);

      let detectedTextures = [];
      try {
        detectedTextures = parseTexturesFromRgmBuffer(rgmBuffer);
        updateItem(item.id, { textures: detectedTextures });
      } catch (parseErr) {
        console.warn(`Lỗi parse RGM ${item.name}:`, parseErr);
        updateItem(item.id, {
          status: "done",
          statusText: "Tải RGM xong (Không parse được textures)",
        });
        continue;
      }

      // BƯỚC 3: TẢI TỪNG DDS TEXTURE (CHECK R2 TRƯỚC -> NẾU CHƯA CÓ THÌ TẢI GỐC RỒI UP R2)
      if (detectedTextures.length > 0) {
        for (let t = 0; t < detectedTextures.length; t++) {
          if (abortRef.current) break;

          const texName = detectedTextures[t];
          const cleanName = cleanTextureName(texName);
          const textureFilename = `${cleanName}.png`;

          // Đã có trong zip do model trước dùng chung
          if (downloadedTextureSet.has(cleanName)) {
            setLiveMessage(`✨ Texture ${textureFilename} đã có trong gói.`);
            continue;
          }

          // Kiểm tra xem texture đã có trên R2 chưa
          let r2TexUrl = null;
          if (isR2Enabled) {
            r2TexUrl = await checkFileOnR2(r2Config.publicUrl, textureFilename);
          }

          let texBlob = null;

          if (r2TexUrl) {
            // TẢI TRỰC TIẾP TỪ R2
            setLiveMessage(`⚡ Texture ${textureFilename} có sẵn trên R2! Tải về...`);
            try {
              const texRes = await fetch(r2TexUrl);
              if (texRes.ok) {
                texBlob = await texRes.blob();
                totalFilesCount++;
                downloadedTextureSet.add(cleanName);

                if (mode === "direct") {
                  triggerDownload(texBlob, textureFilename);
                } else if (mode === "zip") {
                  zip.file(textureFilename, texBlob);
                }
              }
            } catch (e) {
              console.warn("Lỗi tải texture từ R2:", e);
            }
          }

          // NẾU CHƯA CÓ TRÊN R2 -> TẢI TỪ CDN GỐC (CÓ DELAY GIẢ LẬP) RỒI UP LÊN R2
          if (!texBlob) {
            const originalTexUrl = getTextureUrl(cleanName);

            updateItem(item.id, {
              status: "waiting",
              statusText: `Chờ giả lập bấm tải texture (${t + 1}/${detectedTextures.length})...`,
            });
            await simulateHumanWait(`Bấm tải texture ${textureFilename}`);
            if (abortRef.current) break;

            updateItem(item.id, {
              status: "downloading_tex",
              statusText: `Đang tải DDS (${t + 1}/${detectedTextures.length}): ${textureFilename}`,
            });
            setLiveMessage(`🖼️ Đang tải ${textureFilename} từ CDN gốc...`);

            try {
              const texRes = await fetch(originalTexUrl);
              if (texRes.ok) {
                texBlob = await texRes.blob();
                totalFilesCount++;
                downloadedTextureSet.add(cleanName);

                if (mode === "direct") {
                  triggerDownload(texBlob, textureFilename);
                } else if (mode === "zip") {
                  zip.file(textureFilename, texBlob);
                }

                // Tự động upload texture lên R2
                if (canUploadR2) {
                  try {
                    await uploadToR2(r2Config, textureFilename, texBlob, "image/png");
                    setLiveMessage(`☁️ Đã lưu texture ${textureFilename} lên R2!`);
                  } catch (upTexErr) {
                    console.warn(`Lỗi upload texture ${textureFilename} lên R2:`, upTexErr);
                  }
                }
              } else {
                console.warn(`Texture không tìm thấy trên CDN: ${originalTexUrl}`);
              }
            } catch (texErr) {
              console.warn(`Lỗi tải texture ${textureFilename}:`, texErr);
            }
          }
        }
      }

      // Hoàn tất item
      const sourceTag = rgmSource === "cached" ? "⚡ Từ R2" : rgmSource === "synced" ? "☁️ Đã sync R2" : "CDN";
      updateItem(item.id, {
        status: "done",
        statusText: `Hoàn tất (${detectedTextures.length} textures) [${sourceTag}]`,
      });
    }

    // BƯỚC 4: NÉN FILE ZIP VÀ TẢI VỀ
    if (mode === "zip" && !abortRef.current && totalFilesCount > 0) {
      setLiveMessage("📦 Đang đóng gói nén toàn bộ file vào file ZIP...");
      try {
        const zipBlob = await zip.generateAsync(
          {
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 6 },
          },
          (meta) => {
            setLiveMessage(`📦 Đang nén ZIP: ${meta.percent.toFixed(0)}%...`);
          }
        );

        const zipFilename = `rgm_batch_${new Date().toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}.zip`;
        triggerDownload(zipBlob, zipFilename);
        setLiveMessage(`🎉 Đã tải file ZIP (${totalFilesCount} files nằm thẳng ở gốc)!`);
      } catch (zipErr) {
        console.error("Lỗi tạo file zip:", zipErr);
        setLiveMessage(`❌ Lỗi tạo file ZIP: ${zipErr.message}`);
      }
    } else if (mode === "direct" && !abortRef.current) {
      setLiveMessage(`🎉 Hoàn tất tải từng file (${totalFilesCount} files)!`);
    }

    setIsProcessing(false);
    setActiveItemId(null);
  }

  return (
    <div
      style={{
        marginTop: "20px",
        padding: "18px",
        background: "rgba(0,0,0,0.25)",
        borderRadius: "10px",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* HEADER & THANH NÚT CẤU HÌNH */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: "#e7e9ea" }}>
          Batch Download RGM/DDS
        </h3>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* Nút bật popup R2 */}
          <button
            onClick={() => setShowR2Modal(!showR2Modal)}
            style={{
              background: r2Config.enabled ? "rgba(20,165,106,0.2)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${r2Config.enabled ? "#14a56a" : "rgba(255,255,255,0.15)"}`,
              color: r2Config.enabled ? "#4ade80" : "#9aa0a6",
              borderRadius: "4px",
              padding: "4px 8px",
              cursor: "pointer",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>☁️</span>
            <span>Cloudflare R2 {r2Config.enabled ? "(Bật)" : "(Tắt)"}</span>
          </button>

          {/* Nút bật tùy chọn tốc độ */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: "none",
              border: "none",
              color: "#9aa0a6",
              cursor: "pointer",
              fontSize: "12px",
              textDecoration: "underline",
            }}
          >
            {showSettings ? "Ẩn tốc độ ▲" : "Tốc độ giả lập ▼"}
          </button>
        </div>
      </div>

      {/* KHUNG CẤU HÌNH CLOUDFLARE R2 */}
      {showR2Modal && (
        <div
          style={{
            padding: "14px",
            background: "rgba(15,23,42,0.85)",
            borderRadius: "8px",
            border: "1px solid rgba(59,130,246,0.3)",
            marginBottom: "14px",
            fontSize: "12px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontWeight: "600", color: "#60a5fa", fontSize: "13px" }}>
              ☁️ Cấu hình Cloudflare R2 (Lưu trữ & Tải trực tiếp tránh limit):
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: "#fff", fontWeight: "600" }}>
              <input
                type="checkbox"
                checked={r2Config.enabled}
                onChange={(e) => handleR2Change("enabled", e.target.checked)}
              />
              Bật dùng R2
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
            <div>
              <label style={{ color: "#9aa0a6", display: "block", marginBottom: "4px" }}>
                1. R2 Public URL / Domain (Bắt buộc):
              </label>
              <input
                type="text"
                placeholder="https://pub-xxxx.r2.dev hoặc domain riêng"
                value={r2Config.publicUrl}
                onChange={(e) => handleR2Change("publicUrl", e.target.value)}
                style={{ width: "100%", padding: "6px 8px", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: "4px" }}
              />
              <span style={{ color: "#64748b", fontSize: "10px" }}>Lấy ở R2 Bucket -&gt; Settings -&gt; Public Access (Bật R2.dev subdomain)</span>
            </div>

            <div>
              <label style={{ color: "#9aa0a6", display: "block", marginBottom: "4px" }}>
                2. Bucket Name (Tên Bucket):
              </label>
              <input
                type="text"
                placeholder="vd: rgm-data"
                value={r2Config.bucketName}
                onChange={(e) => handleR2Change("bucketName", e.target.value)}
                style={{ width: "100%", padding: "6px 8px", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: "4px" }}
              />
            </div>

            <div>
              <label style={{ color: "#9aa0a6", display: "block", marginBottom: "4px" }}>
                3. Cloudflare Account ID:
              </label>
              <input
                type="text"
                placeholder="Account ID (32 ký tự, lấy ở trang chủ R2)"
                value={r2Config.accountId}
                onChange={(e) => handleR2Change("accountId", e.target.value)}
                style={{ width: "100%", padding: "6px 8px", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: "4px" }}
              />
            </div>

            <div>
              <label style={{ color: "#9aa0a6", display: "block", marginBottom: "4px" }}>
                4. Access Key ID (Tạo trong R2 API Tokens):
              </label>
              <input
                type="text"
                placeholder="Access Key ID"
                value={r2Config.accessKeyId}
                onChange={(e) => handleR2Change("accessKeyId", e.target.value)}
                style={{ width: "100%", padding: "6px 8px", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: "4px" }}
              />
            </div>

            <div style={{ gridColumn: "span 2" }}>
              <label style={{ color: "#9aa0a6", display: "block", marginBottom: "4px" }}>
                5. Secret Access Key:
              </label>
              <input
                type="password"
                placeholder="Secret Access Key"
                value={r2Config.secretAccessKey}
                onChange={(e) => handleR2Change("secretAccessKey", e.target.value)}
                style={{ width: "100%", padding: "6px 8px", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: "4px" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleTestR2}
              style={{
                padding: "6px 12px",
                background: "#2563eb",
                border: "none",
                color: "#fff",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "11px",
              }}
            >
              🧪 Kiểm tra kết nối R2
            </button>

            {r2TestStatus.msg && (
              <span
                style={{
                  fontSize: "11px",
                  color:
                    r2TestStatus.type === "success"
                      ? "#4ade80"
                      : r2TestStatus.type === "error"
                      ? "#f87171"
                      : "#93c5fd",
                }}
              >
                {r2TestStatus.msg}
              </span>
            )}
          </div>
        </div>
      )}

      {/* KHUNG CẤU HÌNH TỐC ĐỘ GIẢ LẬP */}
      {showSettings && (
        <div
          style={{
            padding: "12px",
            background: "rgba(255,255,255,0.03)",
            borderRadius: "6px",
            border: "1px solid rgba(255,255,255,0.06)",
            marginBottom: "14px",
            fontSize: "12px",
          }}
        >
          <div style={{ fontWeight: "600", color: "#ffcc66", marginBottom: "8px" }}>
            ⚙️ Cấu hình thời gian nghỉ ngẫu nhiên trước mỗi lần bấm tải:
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: "10px" }}>
            <div>
              <label style={{ color: "#9aa0a6", marginRight: "6px" }}>Chờ tối thiểu:</label>
              <input
                type="number"
                min="0.3"
                max="10"
                step="0.1"
                value={minDelay}
                onChange={(e) => setMinDelay(Math.max(0.3, parseFloat(e.target.value) || 0.5))}
                style={{ width: "60px", padding: "4px 6px", background: "#121416", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: "4px" }}
              />
              <span style={{ color: "#9aa0a6", marginLeft: "4px" }}>giây</span>
            </div>

            <div>
              <label style={{ color: "#9aa0a6", marginRight: "6px" }}>Chờ tối đa:</label>
              <input
                type="number"
                min="0.5"
                max="15"
                step="0.1"
                value={maxDelay}
                onChange={(e) => setMaxDelay(Math.max(minDelay, parseFloat(e.target.value) || 2.0))}
                style={{ width: "60px", padding: "4px 6px", background: "#121416", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: "4px" }}
              />
              <span style={{ color: "#9aa0a6", marginLeft: "4px" }}>giây</span>
            </div>

            <div style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                onClick={() => { setMinDelay(0.8); setMaxDelay(1.8); }}
                style={{ padding: "4px 8px", background: "rgba(255,255,255,0.06)", border: "none", color: "#ccc", borderRadius: "4px", cursor: "pointer", fontSize: "11px" }}
              >
                Nhanh (0.8-1.8s)
              </button>
              <button
                type="button"
                onClick={() => { setMinDelay(1.2); setMaxDelay(2.8); }}
                style={{ padding: "4px 8px", background: "rgba(255,255,255,0.06)", border: "none", color: "#ccc", borderRadius: "4px", cursor: "pointer", fontSize: "11px" }}
              >
                Tự nhiên (1.2-2.8s)
              </button>
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: "#ccc" }}>
            <input
              type="checkbox"
              checked={deduplicate}
              onChange={(e) => setDeduplicate(e.target.checked)}
            />
            Tự động lọc trùng lặp khi dán danh sách
          </label>
        </div>
      )}

      {/* TEXTAREA NHẬP DANH SÁCH */}
      <label className="label" style={{ display: "block", textAlign: "left", marginBottom: "6px" }}>
        Paste RGM base names (one per line)
      </label>
      <textarea
        className="parser-textarea"
        placeholder="mf_v0251&#10;mh_c8945&#10;mj_c9942&#10;mp_v3043&#10;ms_v2281&#10;..."
        value={inputList}
        onChange={(e) => handlePaste(e.target.value)}
        disabled={isProcessing}
        style={{ width: "100%", minHeight: "110px", marginBottom: "12px" }}
      />

      {/* THANH ĐIỀU KHIỂN NÚT BẤM */}
      {items.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            {/* NÚT TẢI FILE ZIP (CHÍNH - BỎ THẲNG VÀO GỐC) */}
            <button
              className="btn btn-green"
              onClick={() => runBatchProcess("zip")}
              disabled={isProcessing}
              style={{
                flex: "1 1 180px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "10px 14px",
                fontSize: "13px",
              }}
            >
              <span>📦</span> Tải Gói File ZIP (Bỏ Thẳng Vào Gốc)
            </button>

            {/* NÚT GIẢ LẬP BẤM TẢI TỪNG FILE */}
            <button
              className="btn btn-blue"
              onClick={() => runBatchProcess("direct")}
              disabled={isProcessing}
              style={{
                flex: "1 1 180px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "10px 14px",
                fontSize: "13px",
              }}
            >
              <span>⚡</span> Giả lập bấm tải từng file
            </button>

            {/* NÚT DỪNG LẠI */}
            {isProcessing && (
              <button
                className="btn"
                onClick={handleStop}
                style={{
                  background: "#dc2626",
                  color: "#fff",
                  padding: "10px 16px",
                  fontSize: "13px",
                }}
              >
                ⏹ Dừng lại
              </button>
            )}

            {/* NÚT XÓA DANH SÁCH */}
            {!isProcessing && (
              <button
                type="button"
                onClick={() => {
                  setInputList("");
                  setItems([]);
                  setLiveMessage("");
                }}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "none",
                  color: "#9aa0a6",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                Xóa hết
              </button>
            )}
          </div>

          {/* DÒNG THÔNG BÁO GIẢ LẬP LIVE & PROGRESS BAR */}
          {liveMessage && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px 12px",
                background: isProcessing ? "rgba(30,108,255,0.1)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${isProcessing ? "rgba(30,108,255,0.3)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: "6px",
                fontSize: "12px",
                color: "#e7e9ea",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span>{liveMessage}</span>
                {isProcessing && <span>{progress.current}/{progress.total}</span>}
              </div>

              {isProcessing && (
                <div
                  style={{
                    width: "100%",
                    height: "5px",
                    background: "rgba(255,255,255,0.1)",
                    borderRadius: "3px",
                    overflow: "hidden",
                    marginTop: "6px",
                  }}
                >
                  <div
                    style={{
                      width: `${progress.percent}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #14a56a, #1e6cff)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: "12px", color: "#9aa0a6", marginTop: "12px", marginBottom: "8px" }}>
            {items.length} item(s) - Tự động tải RGM & DDS (Có R2 Cache & Sync):
          </div>

          {/* DANH SÁCH CÁC ITEM */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "480px", overflowY: "auto", paddingRight: "4px" }}>
            {items.map((item, idx) => {
              const isActive = activeItemId === item.id;
              const isDone = item.status === "done";
              const isError = item.status === "error";

              return (
                <div
                  key={item.id}
                  style={{
                    padding: "12px",
                    background: isActive
                      ? "rgba(30,108,255,0.15)"
                      : "rgba(255,255,255,0.04)",
                    borderRadius: "6px",
                    border: isActive
                      ? "1px solid #1e6cff"
                      : isDone
                      ? "1px solid rgba(20,165,106,0.3)"
                      : isError
                      ? "1px solid rgba(220,38,38,0.4)"
                      : "1px solid rgba(255,255,255,0.08)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {/* Dòng tên và trạng thái */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "8px",
                      fontSize: "13px",
                    }}
                  >
                    <div style={{ fontWeight: "600", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ color: "#9aa0a6", fontSize: "11px" }}>#{idx + 1}</span>
                      <span>{item.name}</span>
                      {item.r2Source === "cached" && (
                        <span style={{ fontSize: "10px", background: "rgba(16,185,129,0.2)", color: "#10b981", padding: "1px 6px", borderRadius: "4px" }}>
                          ⚡ R2 Cached
                        </span>
                      )}
                      {item.r2Source === "synced" && (
                        <span style={{ fontSize: "10px", background: "rgba(59,130,246,0.2)", color: "#60a5fa", padding: "1px 6px", borderRadius: "4px" }}>
                          ☁️ Synced to R2
                        </span>
                      )}
                    </div>

                    {/* Status badge */}
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "10px",
                        background: isDone
                          ? "rgba(20,165,106,0.2)"
                          : isError
                          ? "rgba(220,38,38,0.2)"
                          : isActive
                          ? "rgba(30,108,255,0.3)"
                          : "rgba(255,255,255,0.06)",
                        color: isDone
                          ? "#14a56a"
                          : isError
                          ? "#ff8b8b"
                          : isActive
                          ? "#60a5fa"
                          : "#9aa0a6",
                      }}
                    >
                      {isActive && "⚡ "}
                      {item.statusText}
                    </span>
                  </div>

                  {/* Dòng RGM File & nút tải thủ công */}
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="text"
                      value={item.rgmUrl}
                      readOnly
                      style={{
                        flex: 1,
                        padding: "6px 8px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ccc",
                        fontSize: "11px",
                        borderRadius: "4px",
                        fontFamily: "monospace",
                      }}
                    />
                    <button
                      className="btn btn-green"
                      onClick={() =>
                        handleDownloadSingle(item.rgmUrl, `${item.name}.rgm`, `${item.id}_rgm`)
                      }
                      disabled={downloadLoading[`${item.id}_rgm`] || isProcessing}
                      style={{ padding: "5px 10px", fontSize: "11px", margin: 0 }}
                      title="Tải riêng file RGM này"
                    >
                      {downloadLoading[`${item.id}_rgm`] ? "..." : "DL RGM"}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleManualParse(item)}
                      disabled={isProcessing}
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: "#ccc",
                        padding: "5px 8px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        cursor: "pointer",
                      }}
                      title="Phân tích tìm texture ngay"
                    >
                      🔍 Parse
                    </button>
                  </div>

                  {/* DANH SÁCH DDS TEXTURES ĐÃ PARSE ĐƯỢC */}
                  {item.textures && item.textures.length > 0 && (
                    <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed rgba(255,255,255,0.08)" }}>
                      <div style={{ fontSize: "11px", color: "#ffcc66", marginBottom: "6px" }}>
                        🖼️ {item.textures.length} texture DDS (PNG) tìm thấy:
                      </div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {item.textures.map((tex, tIdx) => {
                          const clean = cleanTextureName(tex);
                          const texUrl = getTextureUrl(clean);
                          const isDl = downloadLoading[`${item.id}_tex_${tIdx}`];
                          return (
                            <button
                              key={tIdx}
                              type="button"
                              onClick={() =>
                                handleDownloadSingle(texUrl, `${clean}.png`, `${item.id}_tex_${tIdx}`)
                              }
                              disabled={isProcessing || isDl}
                              style={{
                                padding: "4px 8px",
                                background: "rgba(30,108,255,0.15)",
                                border: "1px solid rgba(30,108,255,0.3)",
                                color: "#93c5fd",
                                borderRadius: "4px",
                                fontSize: "11px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                              title={`Bấm để tải texture ${clean}.png`}
                            >
                              <span>📥</span>
                              <span>{clean}.png</span>
                              {isDl && "..."}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
