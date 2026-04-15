import fs from "fs/promises";
import { ensureCloudinaryConfigured } from "../config/cloudinary.js";

const cleanupLocalFile = async (filePath) => {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
};

export const uploadImageToCloudinary = async (file, options = {}) => {
  if (!file?.path) return null;

  const cloudinary = ensureCloudinaryConfigured();

  try {
    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: "image",
      folder: options.folder || "lucent/uploads",
    });
    return result?.secure_url || null;
  } finally {
    await cleanupLocalFile(file.path);
  }
};

export const uploadImagesToCloudinary = async (files = [], options = {}) => {
  const list = Array.isArray(files) ? files : [];
  const values = await Promise.all(
    list.map((item) => uploadImageToCloudinary(item, options))
  );
  return values.filter(Boolean);
};

export const uploadFileToCloudinary = async (file, options = {}) => {
  if (!file?.path) return null;

  const cloudinary = ensureCloudinaryConfigured();

  try {
    const result = await cloudinary.uploader.upload(file.path, {
      resource_type: "auto",
      folder: options.folder || "lucent/uploads",
    });
    return result?.secure_url || null;
  } finally {
    await cleanupLocalFile(file.path);
  }
};

const deriveCloudinaryPublicId = (url) => {
  const raw = String(url || "").trim();
  if (!raw || !raw.includes("res.cloudinary.com") || !raw.includes("/upload/")) {
    return null;
  }

  const marker = "/upload/";
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) return null;

  let tail = raw.slice(markerIndex + marker.length);
  const queryIndex = tail.indexOf("?");
  if (queryIndex >= 0) tail = tail.slice(0, queryIndex);

  tail = tail.replace(/^v\d+\//, "");

  const extIndex = tail.lastIndexOf(".");
  if (extIndex > 0) {
    tail = tail.slice(0, extIndex);
  }

  return tail || null;
};

export const deleteCloudinaryAssetByUrl = async (url) => {
  const publicId = deriveCloudinaryPublicId(url);
  if (!publicId) {
    return { deleted: false, reason: "not_cloudinary_or_invalid_url" };
  }

  const cloudinary = ensureCloudinaryConfigured();
  const resourceTypes = ["image", "raw", "video"];

  for (const resourceType of resourceTypes) {
    try {
      const response = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: true,
      });
      const result = String(response?.result || "").toLowerCase();
      if (result === "ok" || result === "not found") {
        return { deleted: true, publicId, resourceType, result };
      }
    } catch (error) {
      // Try next resource type.
    }
  }

  return { deleted: false, publicId, reason: "destroy_failed" };
};