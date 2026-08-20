// Phone photos land at 3–5 MB, which is slow on dorm wifi and eats the
// free storage tier. Downscale and re-encode before uploading — a 1600px
// JPEG is plenty for reading a flyer or viewing a photo full-screen.

const MAX_DIM = 1600
const QUALITY = 0.82

export async function compressImage(file) {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    // Flyers are often screenshots with white backgrounds; JPEG has no alpha,
    // so fill white rather than letting transparency turn black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    if (!blob) throw new Error('Could not process that image.')

    // If compression made it bigger (already-small images), keep the original.
    if (blob.size >= file.size && file.type === 'image/jpeg') {
      return { blob: file, width: bitmap.width, height: bitmap.height }
    }
    return { blob, width, height }
  } finally {
    bitmap.close?.()
  }
}

export function isImage(file) {
  return !!file && file.type.startsWith('image/')
}

export function isPdf(file) {
  return !!file && file.type === 'application/pdf'
}

// Matches the bucket's file_size_limit; PDFs can't be shrunk on the device
// the way photos can, so oversized ones are rejected with a clear message.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
