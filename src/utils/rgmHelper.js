import "../rgmParser";

// Helper functions for RGM parsing and downloading

/**
 * Extracts texture names from an RGM ArrayBuffer using window.parseRGMFile
 * @param {ArrayBuffer} buffer
 * @returns {string[]} Array of clean texture names
 */
export function parseTexturesFromRgmBuffer(buffer) {
  if (typeof window === "undefined" || typeof window.parseRGMFile !== "function") {
    throw new Error("RGM Parser chưa sẵn sàng (window.parseRGMFile không tồn tại)");
  }

  const parsed = window.parseRGMFile(buffer);
  if (!parsed) {
    return [];
  }

  const texSet = new Set();

  // 1. Convert to threeJS data if available
  if (typeof window.convertToThreeJSData === "function") {
    try {
      const meshList = window.convertToThreeJSData(parsed);
      if (Array.isArray(meshList)) {
        for (const m of meshList) {
          if (Array.isArray(m.textureNames)) {
            for (const t of m.textureNames) {
              if (t && typeof t === "string") {
                const clean = cleanTextureName(t);
                if (clean) texSet.add(clean);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("convertToThreeJSData warning:", err);
    }
  }

  // 2. Direct chunk inspection fallback
  try {
    const meshes = parsed?.chunk?.x2A || [];
    for (const mesh of meshes) {
      const texs = mesh?.meshData?.textureData || [];
      for (const td of texs) {
        if (td && td.filename) {
          const clean = cleanTextureName(td.filename);
          if (clean) texSet.add(clean);
        }
      }
    }
  } catch (err) {
    console.warn("Direct chunk inspection warning:", err);
  }

  return Array.from(texSet);
}

/**
 * Cleans texture name: trims, removes null bytes, removes extensions
 */
export function cleanTextureName(name) {
  if (!name || typeof name !== "string") return "";
  return name
    .replace(/\0/g, "")
    .trim()
    .replace(/\.(dds|png|tga|bmp)$/i, "");
}

/**
 * Constructs CDN URL for RGM file
 */
export function getRgmUrl(baseName) {
  const clean = baseName.trim().replace(/\.rgm$/i, "");
  return `https://cdn.aumix3d.com/data/${encodeURIComponent(clean)}.rgm`;
}

/**
 * Constructs CDN URL for DDS/PNG texture file
 */
export function getTextureUrl(textureName) {
  const clean = cleanTextureName(textureName);
  return `https://cdn.aumix3d.com/textures/${encodeURIComponent(clean)}.png`;
}

/**
 * Simulates human delay: resolves after a random duration between minMs and maxMs
 * @param {number} minMs
 * @param {number} maxMs
 * @param {function} [onTick] optional callback with remaining ms
 * @returns {Promise<number>} actual delayed ms
 */
export function sleepWithJitter(minMs, maxMs, onTick) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => {
    const startTime = Date.now();
    const interval = 100;
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, delay - elapsed);
      if (onTick) onTick(remaining, delay);
      if (elapsed >= delay) {
        clearInterval(timer);
        resolve(delay);
      }
    }, interval);
  });
}

/**
 * Triggers a browser download for a Blob
 */
export function triggerDownload(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}
