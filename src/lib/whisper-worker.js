import { pipeline, env } from '@huggingface/transformers';

// Run ONNX directly on this worker thread (no nested proxy worker)
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.proxy = false;
  // Cap threads: each WASM thread adds memory/overhead, and on mobile the extra
  // pressure can crash the tab. Two is plenty for a tiny model.
  env.backends.onnx.wasm.numThreads = Math.min(2, navigator.hardwareConcurrency || 2);
}

// The always-works baseline: tiny.en quantized on the CPU/WASM backend. Used
// on low-end devices and as the fallback if a richer config fails to load.
const TINY = 'onnx-community/whisper-tiny.en';
const BASE = 'onnx-community/whisper-base.en';
const SAFE = { model: TINY, opts: { dtype: { encoder_model: 'q8', decoder_model_merged: 'q4' } } };

/**
 * Pick the most accurate model the device can actually run:
 *  - WebGPU present → base.en in fp16 on the GPU (big accuracy gain over tiny,
 *    and GPU memory sidesteps the mobile CPU/RAM crash).
 *  - lots of RAM/cores (desktop-class) → base.en quantized on WASM.
 *  - otherwise → the safe tiny.en/q8 baseline.
 */
async function pickConfig() {
  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        return {
          model: BASE,
          opts: {
            device: 'webgpu',
            dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' },
          },
        };
      }
    }
  } catch {
    // WebGPU probe failed — fall through to a CPU config.
  }

  const mem = /** @type {any} */ (navigator).deviceMemory ?? 4; // GiB (Chromium-only)
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mem >= 8 && cores >= 8) {
    return { model: BASE, opts: { dtype: { encoder_model: 'q8', decoder_model_merged: 'q4' } } };
  }
  return SAFE;
}

let transcriber = null;

async function getTranscriber() {
  if (transcriber) return transcriber;

  // Aggregate per-file byte counts into one overall download figure. The model
  // arrives as several files (tokenizer, config, encoder, decoder weights); a
  // single percentage hides which/how much, so we report real bytes.
  const files = new Map();
  const progress_callback = (info) => {
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
  };

  const config = await pickConfig();
  try {
    transcriber = await pipeline(
      'automatic-speech-recognition',
      config.model,
      /** @type {any} */ ({ ...config.opts, progress_callback }),
    );
  } catch (err) {
    // A richer config (WebGPU, or base.en) failed — retry on the safe baseline
    // so voice input still works rather than erroring out entirely.
    if (config.model === SAFE.model && !('device' in config.opts)) throw err;
    files.clear();
    self.postMessage({
      type: 'fallback',
      reason: err instanceof Error ? err.message : String(err),
    });
    transcriber = await pipeline(
      'automatic-speech-recognition',
      SAFE.model,
      /** @type {any} */ ({ ...SAFE.opts, progress_callback }),
    );
  }

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
