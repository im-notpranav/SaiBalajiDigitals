/**
 * Shrinks a picture in the browser before it is uploaded, so phones send a few hundred KB
 * instead of several MB. The result is a JPEG, or WEBP when `square` crops a profile picture.
 * Throws when the browser cannot read the file (iPhone HEIC photos on most browsers).
 */
export async function shrinkImage(
  file: Blob,
  { maxSide, quality = 0.8, square = false }: { maxSide: number; quality?: number; square?: boolean },
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const srcW = square ? side : bitmap.width;
    const srcH = square ? side : bitmap.height;
    const scale = Math.min(1, maxSide / Math.max(srcW, srcH));

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(srcW * scale);
    canvas.height = Math.round(srcH * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot resize pictures.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - srcW) / 2,
      (bitmap.height - srcH) / 2,
      srcW,
      srcH,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, square ? "image/webp" : "image/jpeg", quality),
    );
    if (!blob) throw new Error("This browser cannot resize pictures.");
    return blob;
  } finally {
    bitmap.close();
  }
}
