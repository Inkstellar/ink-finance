/**
 * Turn a picked/captured photo into a small data URL for an avatar.
 *
 * Why downscale in the browser rather than server-side: it keeps the upload
 * tiny (~20KB instead of several MB from a phone camera), which matters on
 * mobile data and keeps the request well inside the API's body limit. The
 * server still enforces its own size and type limits — this is courtesy, not
 * the security boundary.
 */

export interface AvatarImageOptions {
  /** Longest edge of the output, in pixels. */
  maxDimension?: number;
  /** JPEG quality, 0–1. */
  quality?: number;
}

/** Decode a File into something drawable, with a clear error if it can't. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Most often a HEIC straight off an iPhone, or a renamed non-image.
      reject(
        new Error(
          "That image could not be read. iPhone HEIC photos sometimes need to be " +
            "converted first — try taking the photo with the camera button instead.",
        ),
      );
    };
    img.src = url;
  });
}

export async function fileToAvatarDataUrl(
  file: File,
  { maxDimension = 256, quality = 0.85 }: AvatarImageOptions = {},
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image.');
  }

  const img = await loadImage(file);

  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not process the image.');

  // Avatars render as circles, so transparency would show as odd black corners
  // once flattened to JPEG. Paint white underneath first.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', quality);
}
