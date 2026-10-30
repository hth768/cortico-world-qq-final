import * as silkWasm from 'silk-wasm';
import { Buffer } from 'node:buffer';
const decode = silkWasm.decode ?? silkWasm.default?.decode;
const encode = silkWasm.encode ?? silkWasm.default?.encode;

function pcmToWav(pcm, sampleRate = 16000) {
  const numChannels = 1, bytesPerSample = 2, blockAlign = numChannels * bytesPerSample, dataSize = pcm.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(numChannels, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28); buf.writeUInt16LE(blockAlign, 32); buf.writeUInt16LE(8 * bytesPerSample, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i] ?? 0, 44 + i * 2);
  return buf;
}
function indexOfBytes(h, n) {
  for (let i = 0; i + n.length <= h.length; i++) { let ok = true; for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) { ok = false; break; } if (ok) return i; }
  return -1;
}

const N = 16000 * 1;
const pcm = new Int16Array(N);
for (let i = 0; i < N; i++) pcm[i] = Math.round(3000 * Math.sin(i / 20));
const wav = pcmToWav(pcm);
console.log('wav built len', wav.length);

const silk = await encode(wav, 16000);
let body = Buffer.from(silk.data ?? silk);
console.log('silk head:', JSON.stringify(body.slice(0, 10).toString('latin1')));

const SILK_MAGIC = Buffer.from('#!SILK_V3');
const at = indexOfBytes(body, SILK_MAGIC);
const stripped = body; // 不剥离 0x02 前缀：silk-wasm 的 WASM 解码器要求保留前缀
const out = await decode(stripped, 16000);
console.log('decode data len:', out.data?.length);

const samples = Math.floor(out.data.byteLength / 2);
const pcm2 = new Int16Array(samples);
for (let i = 0; i < samples; i++) pcm2[i] = (out.data[i * 2] | (out.data[i * 2 + 1] << 8)) | 0;
const wav2 = pcmToWav(pcm2);
console.log('roundtrip wav2 head:', JSON.stringify(wav2.slice(0, 4).toString('latin1')), 'len', wav2.length, 'samples', samples);
console.log('OK');
