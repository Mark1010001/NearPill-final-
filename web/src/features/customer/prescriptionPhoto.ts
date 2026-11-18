// Prepares a prescription photo for upload. The API accepts JPEG/PNG up to 1,048,576 decoded bytes
// (1,398,104 base64 characters), but phone cameras produce 3-12 MB files. Resize and re-encode
// on the device so typical photos upload instead of being refused.
export const MAX_UPLOAD_BYTES = 1_000_000; // below the 1,048,576-byte server limit
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 1600;
const MIN_SIDE = 640;

export type PreparedPhoto = { mimeType: 'image/jpeg'; photo: string; bytes: number; width: number; height: number; previewUrl: string };

export class PhotoError extends Error {}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new PhotoError('Could not process this photo. Try another one.'))), 'image/jpeg', quality));
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new PhotoError('Could not read the selected photo.'));
    reader.readAsDataURL(blob);
  });
}

/** Content sniffing: do not trust the file extension or the browser-reported MIME type alone. */
export async function sniffImage(file: Blob): Promise<'jpeg' | 'png' | 'heic' | null> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  const brand = String.fromCharCode(...head.slice(4, 12));
  if (brand.startsWith('ftyp') && /heic|heif|mif1|msf1|heix/.test(brand)) return 'heic';
  return null;
}

export async function preparePrescriptionPhoto(file: File): Promise<PreparedPhoto> {
  if (!file.size) throw new PhotoError('The selected file is empty.');
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('That photo is larger than 25 MB. Choose a smaller one.');
  const kind = await sniffImage(file);
  if (!kind) throw new PhotoError('Choose a photo in JPG or PNG format.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoError(kind === 'heic'
      ? 'This browser cannot open HEIC photos. Take the photo as JPG, or choose a JPG or PNG.'
      : 'This photo could not be opened. Choose another JPG or PNG.');
  }
  try {
    let side = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    for (;;) {
      const width = Math.max(1, Math.round(bitmap.width * side));
      const height = Math.max(1, Math.round(bitmap.height * side));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new PhotoError('Could not process this photo. Try another one.');
      context.fillStyle = '#ffffff'; // JPEG has no alpha: flatten PNG transparency onto white
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45]) {
        const blob = await toBlob(canvas, quality);
        if (blob.size <= MAX_UPLOAD_BYTES) {
          return { mimeType: 'image/jpeg', photo: await toBase64(blob), bytes: blob.size, width, height, previewUrl: URL.createObjectURL(blob) };
        }
      }
      if (Math.max(width, height) <= MIN_SIDE) throw new PhotoError('This photo is too detailed to shrink enough. Try a simpler photo.');
      side *= 0.8;
    }
  } finally {
    bitmap.close();
  }
}
