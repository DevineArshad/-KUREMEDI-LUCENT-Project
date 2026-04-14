import multer from "multer";
import fs from "fs";

export const createUploadMiddleware = (uploadDir, fileFilter = null) => {
  if (!fs.existsSync("uploads")) fs.mkdirSync("uploads", { recursive: true });
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = (file.originalname || "").split(".").pop() || "jpg";
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`);
    },
  });

  const config = {
    storage,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB per file
      files: 10, // Max 10 files per request
    },
  };
  if (fileFilter) config.fileFilter = fileFilter;

  return multer(config);
};

export const productUpload = createUploadMiddleware(
  "uploads/products",
  (req, file, cb) => {
    const mime = String(file.mimetype || "").toLowerCase();
    const original = String(file.originalname || "").toLowerCase();
    const allowedMime = /image\/(jpeg|jpg|png|webp|gif|heic|heif)/i;
    const allowedExt = /\.(jpeg|jpg|png|webp|gif|heic|heif)$/i;

    if (allowedMime.test(mime) || allowedExt.test(original)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (jpeg, jpg, png, webp, gif, heic, heif) are allowed"));
    }
  }
);

export const brandUpload = createUploadMiddleware("uploads/brands");
export const categoryUpload = createUploadMiddleware("uploads/categories");
export const bannerUpload = createUploadMiddleware("uploads/banners");
