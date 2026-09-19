/**
 * Turning an iPhone photo into something the rest of the app can actually use.
 *
 * HEIC is what an iPhone camera produces by default, so it is the single most
 * likely format for a photographed receipt. It is also a format that, stored
 * as-is, would produce a document nobody could open:
 *
 *   - The document preview is a plain <img> (components/documents/DocumentCard
 *     .tsx). Safari renders HEIC; Chrome, Firefox and Edge do not, so a desktop
 *     user would get a broken image where their receipt should be.
 *   - The receipt scanner rejects it outright — process-receipt-ocr validates
 *     the data URL against /^data:image\/(png|jpeg|jpg|gif|webp);base64,/.
 *
 * So the file is converted to JPEG in the browser, before it is uploaded, and
 * what lands in storage is a JPEG. Converting on the way in rather than on the
 * way out means it happens once, on one device, instead of on every view and
 * in every edge function that later has to read the file.
 *
 * The converter is imported dynamically: it carries a WebAssembly HEIF decoder
 * that is far larger than the rest of this page, and someone uploading a PDF
 * should never pay to download it.
 */

import { logError } from "@/utils/errorHandler";

/** Extensions and types an iPhone hands over for a HEIC photo. */
const HEIC_EXTENSIONS = [".heic", ".heif"];
const HEIC_TYPES = [
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
];

/**
 * Whether this file needs converting before upload.
 *
 * Checks the extension as well as the type because Chrome and Edge on Windows
 * report an empty type for a .heic file — they cannot decode HEIC, so they do
 * not name it. Trusting the type alone would let the file through unconverted
 * on exactly the browsers that cannot display it.
 */
export function isHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    HEIC_TYPES.includes(file.type.toLowerCase()) ||
    HEIC_EXTENSIONS.some((ext) => name.endsWith(ext))
  );
}

/**
 * The file as it should be stored: HEIC becomes JPEG, everything else is
 * returned untouched.
 *
 * Throws with the file's name in the message when conversion fails, because
 * the caller is uploading a batch and "one of them failed" is not a useful
 * thing to tell someone holding seven receipts.
 */
export async function toUploadableFile(file: File): Promise<File> {
  if (!isHeic(file)) return file;

  try {
    // Both this and the default build start the decoder in a Web Worker made
    // from a blob: URL, which the app's Content Security Policy blocked until
    // `worker-src 'self' blob:` was stated in index.html -- see the comment
    // there. The "/csp" entry point is the one built for pages that ship a
    // policy at all, so it is the one to keep as script-src tightens.
    const { heicTo } = await import("heic-to/csp");
    const converted = await heicTo({
      blob: file,
      type: "image/jpeg",
      quality: 0.9,
    });

    return new File([converted], jpegName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch (cause) {
    // Logged here because the error thrown on is written for the person
    // holding the phone, and loses whatever the decoder actually said.
    logError("HEIC conversion failed", cause);
    throw new Error(
      `"${file.name}" is a HEIC photo we couldn't convert. Re-save it as a JPG and try again.`,
    );
  }
}

function jpegName(original: string): string {
  return original.replace(/\.(heic|heif)$/i, "") + ".jpg";
}
