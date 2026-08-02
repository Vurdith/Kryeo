export function encodeEmbedding(values: Float32Array): string {
  const bytes = Buffer.allocUnsafe(values.length);
  for (let index = 0; index < values.length; index += 1) {
    bytes.writeInt8(Math.max(-127, Math.min(127, Math.round(values[index] * 127))), index);
  }
  return bytes.toString('base64');
}

export function decodeEmbedding(value: string): Float32Array {
  if (!value) return new Float32Array();
  const bytes = Buffer.from(value, 'base64');
  const result = new Float32Array(bytes.length);
  let magnitude = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    result[index] = bytes.readInt8(index) / 127;
    magnitude += result[index] * result[index];
  }
  magnitude = Math.sqrt(magnitude) || 1;
  for (let index = 0; index < result.length; index += 1) result[index] /= magnitude;
  return result;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length === 0 || left.length !== right.length) return -1;
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return value;
}
