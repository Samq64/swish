<script>
  import { browser } from '$app/environment';
  import Icon from '$lib/Icon.svelte';

  let { ontranscript, onbusy } = $props();

  // 'idle' | 'recording' | 'loading' (one-time model download) | 'transcribing' | 'error'
  let phase = $state('idle');
  let loadedBytes = $state(0);
  let totalBytes = $state(0);

  // Let the parent reclaim the bar's width for a status line while we work.
  $effect(() => {
    onbusy?.(phase === 'loading' || phase === 'transcribing');
  });

  // Cache Storage is evicted under pressure unless the origin is persisted;
  // without this the ~75 MB model gets re-downloaded far too often.
  let persistAsked = false;
  async function ensurePersistentStorage() {
    if (persistAsked || !navigator.storage?.persist) return;
    persistAsked = true;
    try {
      await navigator.storage.persist();
    } catch {
      // best-effort; nothing to do if the browser refuses
    }
  }

  // Worker is created lazily on first use and reused across recordings.
  // The pipeline inside the worker is also cached after first load.
  let worker = null;

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('../lib/whisper-worker.js', import.meta.url), {
      type: 'module',
    });
    return worker;
  }

  let mediaRecorder = null;
  let micStream = null;
  let audioChunks = [];

  // Silence detection so a single tap is enough: tap, speak, and it stops on
  // its own once you go quiet — no need to find the button again while driving.
  let monitorCtx = null;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let vadTimer;
  const SPEAK_RMS = 0.015; // amplitude (0–1) above which we count it as speech
  const SILENCE_MS = 1500; // stop this long after the last speech
  const MAX_MS = 12_000; // hard cap so road noise can't keep it open forever

  async function startRecording() {
    ensurePersistentStorage();
    let stream;
    try {
      // Echo/noise/gain processing helps a lot in a car cabin.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      showError(name === 'NotAllowedError' ? 'Microphone access denied' : 'Could not access mic');
      return;
    }

    micStream = stream;
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stopVad();
      transcribeAudio();
    };

    mediaRecorder.start();
    phase = 'recording';
    startVad(stream);
  }

  function startVad(stream) {
    monitorCtx = new AudioContext();
    const source = monitorCtx.createMediaStreamSource(stream);
    const analyser = monitorCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);

    const startedAt = performance.now();
    let lastLoud = startedAt;
    let hasSpoken = false;

    // setInterval (not rAF) so detection keeps running if the tab is backgrounded.
    vadTimer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const t = performance.now();
      if (rms > SPEAK_RMS) {
        hasSpoken = true;
        lastLoud = t;
      }
      const overCap = t - startedAt > MAX_MS;
      const wentQuiet = hasSpoken && t - lastLoud > SILENCE_MS;
      if (overCap || wentQuiet) stopRecording();
    }, 100);
  }

  function stopVad() {
    if (vadTimer) {
      clearInterval(vadTimer);
      vadTimer = undefined;
    }
    monitorCtx?.close().catch(() => {});
    monitorCtx = null;
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop(); // fires onstop → stopVad + transcribeAudio
    }
  }

  async function transcribeAudio() {
    micStream?.getTracks().forEach((t) => t.stop());
    // Optimistic: a cached model skips straight to transcribing. The worker
    // sends a 'loading' stage only if it actually has to download.
    phase = 'transcribing';
    loadedBytes = 0;
    totalBytes = 0;

    let audioData;
    try {
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      audioChunks = []; // release the recorded buffers; we have the blob now
      audioData = await decodeToFloat32(await blob.arrayBuffer());
    } catch {
      showError('Audio decode failed');
      return;
    }

    const w = getWorker();
    const text = await new Promise((resolve, reject) => {
      const handle = ({ data }) => {
        if (data.type === 'stage') {
          phase = data.stage; // 'loading' | 'transcribing'
        } else if (data.type === 'progress') {
          loadedBytes = data.loaded;
          totalBytes = data.total;
        } else if (data.type === 'result') {
          w.removeEventListener('message', handle);
          resolve(data.text);
        } else if (data.type === 'error') {
          w.removeEventListener('message', handle);
          reject(new Error(data.message));
        }
      };
      w.addEventListener('message', handle);
      // Transfer the buffer so the worker owns it (zero-copy)
      w.postMessage({ type: 'transcribe', audio: audioData }, [audioData.buffer]);
    }).catch((err) => {
      console.error('[VoiceInput]', err);
      return null;
    });

    if (text) {
      ontranscript(text);
      phase = 'idle';
    } else {
      showError('Transcription failed');
    }
  }

  function showError(msg) {
    phase = 'error';
    setTimeout(() => {
      phase = 'idle';
    }, 3000);
  }

  // One reusable decode context. Creating/closing an AudioContext per recording
  // churns memory and can hit the browser's hard cap on live contexts.
  let decodeCtx = null;

  async function decodeToFloat32(arrayBuffer) {
    if (!decodeCtx || decodeCtx.state === 'closed') decodeCtx = new AudioContext();
    const decoded = await decodeCtx.decodeAudioData(arrayBuffer);

    // Resample to 16 kHz mono — what Whisper expects
    const targetRate = 16_000;
    const offCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
    const src = offCtx.createBufferSource();
    src.buffer = decoded;
    src.connect(offCtx.destination);
    src.start(0);
    const rendered = await offCtx.startRendering();
    // Copy the samples out so the (large) AudioBuffer can be GC'd immediately and
    // we transfer a standalone buffer to the worker rather than its backing store.
    return new Float32Array(rendered.getChannelData(0));
  }

  function handleClick() {
    if (phase === 'recording') {
      stopRecording(); // manual stop still works; VAD just makes it optional
    } else if (phase === 'idle' || phase === 'error') {
      startRecording();
    }
  }

  const supported = browser && 'mediaDevices' in navigator && typeof MediaRecorder !== 'undefined';

  let busy = $derived(phase === 'loading' || phase === 'transcribing');
  const fmtMB = (bytes) => (bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0);
  let pct = $derived(totalBytes ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0);

  // On unmount, release everything: mic, detector, decode context, and the
  // worker (which holds the loaded model in memory).
  $effect(() => () => {
    stopVad();
    micStream?.getTracks().forEach((t) => t.stop());
    decodeCtx?.close().catch(() => {});
    worker?.terminate();
    worker = null;
  });
</script>

{#if supported}
  {#if busy}
    <div class="voice-status" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      {#if phase === 'loading'}
        <div class="status-body">
          <span class="status-text">
            Downloading voice model
            {#if totalBytes}<span class="bytes">{fmtMB(loadedBytes)} / {fmtMB(totalBytes)} MB</span>{/if}
            <span class="hint">· one-time</span>
          </span>
          <span class="bar" style:--pct="{pct}%"></span>
        </div>
      {:else}
        <span class="status-text">Transcribing…</span>
      {/if}
    </div>
  {:else}
    <button
      class="mic-btn"
      class:recording={phase === 'recording'}
      class:errored={phase === 'error'}
      onclick={handleClick}
      title={phase === 'recording'
        ? 'Listening… stops when you finish (or tap)'
        : phase === 'error'
          ? 'Voice input failed — tap to retry'
          : 'Voice input — tap and speak'}
      aria-label={phase === 'recording' ? 'Stop recording' : 'Start voice input'}
      type="button"
    >
      <Icon name="mic" size={15} />
    </button>
  {/if}
{/if}

<style>
  .mic-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border: none;
    background: none;
    color: var(--muted);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition:
      color 0.15s,
      background 0.15s;
  }

  .mic-btn:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg);
  }

  .mic-btn.recording {
    color: #e74c3c;
    animation: pulse 1.4s ease-in-out infinite;
  }

  .mic-btn.errored {
    color: var(--danger);
  }

  .mic-btn:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .spinner {
    display: block;
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  .voice-status {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted);
    font-size: 13px;
  }

  .status-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .status-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }

  .bytes {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  .hint {
    color: var(--muted);
  }

  /* Thin determinate download bar under the label. */
  .bar {
    height: 3px;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
  }
  .bar::after {
    content: '';
    display: block;
    height: 100%;
    width: var(--pct, 0%);
    background: var(--accent);
    border-radius: inherit;
    transition: width 0.2s ease;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
