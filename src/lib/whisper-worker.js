import { pipeline, env } from '@huggingface/transformers';

// Run ONNX directly on this worker thread (no nested proxy worker)
if (env.backends.onnx.wasm) env.backends.onnx.wasm.proxy = false;

let transcriber = null;

async function getTranscriber() {
  if (transcriber) return transcriber;

  // Aggregate per-file byte counts into one overall download figure. The model
  // arrives as several files (tokenizer, config, encoder, decoder weights); a
  // single percentage hides which/how much, so we report real bytes.
  const files = new Map();

  transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    progress_callback(info) {
      // Only 'progress' events carry byte counts; 'done' just names the file,
      // so we settle that file to its known total. Other statuses are ignored.
      if (info.status === 'progress') {
        files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
      } else if (info.status === 'done' && files.has(info.file)) {
        const f = files.get(info.file);
        files.set(info.file, { loaded: f.total, total: f.total });
      } else {
        return;
      }
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      if (total > 0) {
        self.postMessage({ type: 'progress', loaded, total, fileCount: files.size });
      }
    },
  });

  return transcriber;
}

self.addEventListener('message', async ({ data }) => {
  if (data.type !== 'transcribe') return;

  try {
    const needsLoad = !transcriber;
    if (needsLoad) self.postMessage({ type: 'stage', stage: 'loading' });
    const t = await getTranscriber();
    // Model is ready; the actual speech-to-text is the fast part.
    self.postMessage({ type: 'stage', stage: 'transcribing' });
    const result = await t(data.audio);
    self.postMessage({ type: 'result', text: result.text.trim() });
  } catch (err) {
    // Reset so the next attempt retries the model load
    transcriber = null;
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
