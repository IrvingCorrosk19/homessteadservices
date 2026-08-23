const LONG_EDGE = 1920;
const JPEG_QUALITY = 0.85;

export type PreparedClientPhoto = {
  file: File;
  previewUrl: string;
  preparedOnClient: boolean;
};

function isHeic(file: File) {
  return /heic|heif/i.test(file.type) || /\.heic$|\.heif$/i.test(file.name);
}

async function loadBitmapFromFile(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through */
    }
  }
  return new Promise<ImageBitmap>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      createImageBitmap(img)
        .then(resolve)
        .catch(reject);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load_failed"));
    };
    img.src = url;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode_failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

export async function prepareConciergePhoto(file: File): Promise<PreparedClientPhoto> {
  if (isHeic(file)) {
    return { file, previewUrl: URL.createObjectURL(file), preparedOnClient: false };
  }

  try {
    const bitmap = await loadBitmapFromFile(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > LONG_EDGE ? LONG_EDGE / longEdge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await canvasToJpegBlob(canvas);
    const optimized = new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
    const previewUrl = URL.createObjectURL(blob);
    return { file: optimized, previewUrl, preparedOnClient: true };
  } catch {
    const previewUrl = URL.createObjectURL(file);
    return { file, previewUrl, preparedOnClient: false };
  }
}

export function revokePreparedPhoto(previewUrl: string) {
  if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
}
