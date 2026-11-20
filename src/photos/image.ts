export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/** How many photos one item can have. The client mirrors this in public/photos/limits.js. */
export const MAX_PHOTOS = 6;

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The image type the bytes really are, or null when they are not a JPEG, PNG or WebP. */
export function sniff(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}
