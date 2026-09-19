// File validation utilities for secure file uploads
// Tier 4 Security Enhancement

export const FILE_VALIDATION = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10 MB per file
  MAX_TOTAL_SIZE: 100 * 1024 * 1024, // 100 MB per upload batch
  ALLOWED_TYPES: [
    "image/jpeg",
    "image/png",
    "application/pdf",
    "image/gif",
    "image/webp",
    // What an iPhone actually produces. Converted to JPEG in the browser
    // before upload (see utils/heicConversion.ts) -- stored as-is it would be
    // a document nobody could open, since Chrome, Firefox and Edge cannot
    // render HEIC and the receipt scanner only accepts PNG/JPEG/GIF/WebP.
    "image/heic",
    "image/heif",
    "image/heic-sequence",
    "image/heif-sequence",
  ],
  ALLOWED_EXTENSIONS: [
    ".jpg",
    ".jpeg",
    ".png",
    ".pdf",
    ".gif",
    ".webp",
    ".heic",
    ".heif",
  ],
} as const;

/** The `accept` attribute for a file input, kept in step with the rules above. */
export const FILE_ACCEPT_ATTRIBUTE = [
  ...FILE_VALIDATION.ALLOWED_EXTENSIONS,
  ...FILE_VALIDATION.ALLOWED_TYPES,
].join(",");

export interface FileValidationError {
  file: File;
  errors: string[];
}

export interface FileValidationResult {
  valid: File[];
  invalid: FileValidationError[];
  totalSize: number;
}

/**
 * Validates file size
 */
export function validateFileSize(
  file: File,
  maxSize: number = FILE_VALIDATION.MAX_FILE_SIZE,
): string | null {
  if (file.size > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(1);
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return `File "${file.name}" (${fileSizeMB}MB) exceeds maximum size of ${maxSizeMB}MB`;
  }
  return null;
}

/**
 * Validates file type (MIME type and extension)
 */
export function validateFileType(file: File): string | null {
  // The `as const` on FILE_VALIDATION narrows these to readonly literal
  // tuples, so `.includes()` rejects an arbitrary string. Widen at the point
  // of use and keep the literal types on the constant itself.
  const allowedTypes: readonly string[] = FILE_VALIDATION.ALLOWED_TYPES;
  const allowedExtensions: readonly string[] =
    FILE_VALIDATION.ALLOWED_EXTENSIONS;

  const extension = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");
  if (!allowedExtensions.includes(extension)) {
    return `"${file.name}" is a ${extension.replace(".", "").toUpperCase() || "file with no extension"}. You can upload PDFs and photos (JPG, PNG, HEIC, GIF, WebP).`;
  }

  // The extension is checked first and on its own because the browser does not
  // always know the type: Chrome and Edge on Windows report an empty string
  // for a .heic file, since HEIC is not a type they can decode. Rejecting on
  // an empty type would refuse exactly the iPhone photos this accepts, so an
  // unknown type defers to the extension, which is already on the allowlist.
  if (file.type && !allowedTypes.includes(file.type)) {
    return `"${file.name}" is a ${file.type} file, which can't be uploaded. You can upload PDFs and photos (JPG, PNG, HEIC, GIF, WebP).`;
  }

  return null;
}

/**
 * Validates total upload batch size
 */
export function validateTotalSize(
  files: File[],
  maxTotal: number = FILE_VALIDATION.MAX_TOTAL_SIZE,
): string | null {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > maxTotal) {
    const maxTotalMB = (maxTotal / (1024 * 1024)).toFixed(0);
    const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);
    return `Total upload size (${totalSizeMB}MB) exceeds maximum of ${maxTotalMB}MB`;
  }
  return null;
}

/**
 * Comprehensive file validation
 */
export function validateFiles(files: File[]): FileValidationResult {
  const valid: File[] = [];
  const invalid: FileValidationError[] = [];
  let totalSize = 0;

  for (const file of files) {
    const errors: string[] = [];

    // Validate file size
    const sizeError = validateFileSize(file);
    if (sizeError) errors.push(sizeError);

    // Validate file type
    const typeError = validateFileType(file);
    if (typeError) errors.push(typeError);

    if (errors.length > 0) {
      invalid.push({ file, errors });
    } else {
      valid.push(file);
      totalSize += file.size;
    }
  }

  // Validate total size of valid files
  if (valid.length > 0) {
    const totalSizeError = validateTotalSize(valid);
    if (totalSizeError) {
      // Move all valid files to invalid
      valid.forEach((file) => {
        invalid.push({ file, errors: [totalSizeError] });
      });
      return { valid: [], invalid, totalSize: 0 };
    }
  }

  return { valid, invalid, totalSize };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}
