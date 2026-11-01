import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export const R2_CONFIG_KEY = "r2_storage_config";

export const DEFAULT_R2_CONFIG = {
  enabled: true,
  publicUrl: "https://pub-0c751f2ca3e74cf3af073e5d49be3784.r2.dev",
  bucketName: "rgm-data",
  accountId: "f6fc6e9760a371596eb7c250b34276db",
  accessKeyId: "158f35176bd351a101f7ed0fe4663e5c",
  secretAccessKey: "3ed2860555054f4462483004c2a436aa02a4f7c7394a4aa793711ece6cf8b9fc",
};

/**
 * Lấy cấu hình R2 từ localStorage (fallback về DEFAULT_R2_CONFIG)
 */
export function getR2Config() {
  try {
    const raw = localStorage.getItem(R2_CONFIG_KEY);
    if (!raw) return DEFAULT_R2_CONFIG;
    const cfg = JSON.parse(raw);
    return {
      enabled: cfg.enabled !== undefined ? Boolean(cfg.enabled) : true,
      publicUrl: (cfg.publicUrl || DEFAULT_R2_CONFIG.publicUrl).trim().replace(/\/+$/, ""),
      bucketName: (cfg.bucketName || DEFAULT_R2_CONFIG.bucketName).trim(),
      accountId: (cfg.accountId || DEFAULT_R2_CONFIG.accountId).trim(),
      accessKeyId: (cfg.accessKeyId || DEFAULT_R2_CONFIG.accessKeyId).trim(),
      secretAccessKey: (cfg.secretAccessKey || DEFAULT_R2_CONFIG.secretAccessKey).trim(),
    };
  } catch (e) {
    return DEFAULT_R2_CONFIG;
  }
}

/**
 * Lưu cấu hình R2 vào localStorage
 */
export function saveR2Config(config) {
  localStorage.setItem(R2_CONFIG_KEY, JSON.stringify(config));
}

let cachedClient = null;
let cachedKey = "";

export function getR2S3Client(config) {
  if (!config || !config.accountId || !config.accessKeyId || !config.secretAccessKey) {
    return null;
  }
  const key = `${config.accountId}:${config.accessKeyId}:${config.secretAccessKey}`;
  if (cachedClient && cachedKey === key) {
    return cachedClient;
  }
  cachedKey = key;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return cachedClient;
}

/**
 * Kiểm tra xem file đã có trên R2 chưa (sử dụng Public URL)
 * Trả về file URL nếu có, null nếu chưa có
 */
export async function checkFileOnR2(publicUrl, filename) {
  if (!publicUrl) return null;
  const cleanBase = publicUrl.trim().replace(/\/+$/, "");
  const targetUrl = `${cleanBase}/${encodeURIComponent(filename)}`;
  try {
    const res = await fetch(targetUrl, { method: "HEAD" });
    if (res.ok) {
      return targetUrl;
    }
    if (res.status === 404) {
      return null;
    }
  } catch (err) {
    try {
      const controller = new AbortController();
      const res = await fetch(targetUrl, { signal: controller.signal });
      controller.abort();
      if (res.ok) return targetUrl;
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Upload file lên R2 thông qua S3 PutObject
 */
export async function uploadToR2(config, filename, bufferOrBlob, contentType) {
  const client = getR2S3Client(config);
  if (!client || !config.bucketName) {
    throw new Error("Thiếu cấu hình R2 (Bucket Name, Account ID, Access Key)");
  }

  let bodyData;
  if (bufferOrBlob instanceof Blob) {
    const arrayBuf = await bufferOrBlob.arrayBuffer();
    bodyData = new Uint8Array(arrayBuf);
  } else if (bufferOrBlob instanceof ArrayBuffer) {
    bodyData = new Uint8Array(bufferOrBlob);
  } else if (bufferOrBlob instanceof Uint8Array) {
    bodyData = bufferOrBlob;
  } else {
    throw new Error("Định dạng dữ liệu upload không hợp lệ");
  }

  const mime =
    contentType ||
    (filename.endsWith(".png")
      ? "image/png"
      : filename.endsWith(".rgm")
      ? "application/octet-stream"
      : "application/octet-stream");

  const cmd = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: filename,
    Body: bodyData,
    ContentType: mime,
  });

  return await client.send(cmd);
}

/**
 * Kiểm tra thử kết nối tới R2 và kiểm tra quyền upload
 */
export async function testR2Connection(config) {
  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
    throw new Error("Vui lòng điền đầy đủ Account ID, Access Key ID, Secret Access Key và Bucket Name.");
  }

  const client = getR2S3Client(config);
  if (!client) throw new Error("Không thể khởi tạo S3 Client");

  const testData = new Uint8Array([84, 69, 83, 84]); // "TEST"
  const testKey = ".r2_test_ping";

  const cmd = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: testKey,
    Body: testData,
    ContentType: "text/plain",
  });

  await client.send(cmd);
  return true;
}
