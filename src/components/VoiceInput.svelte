<script>
  import { browser } from '$app/environment';
  import Icon from '$lib/Icon.svelte';

  let { ontranscript, onbusy } = $props();

  // 'idle' | 'recording' | 'transcribing' | 'error'
  let phase = $state('idle');

  // Let the parent reclaim the bar's width for a status line while we transcribe.
  $effect(() => {
    onbusy?.(phase === 'transcribing');
  });

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
    phase = 'transcribing';

    let wav;
    try {
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      audioChunks = []; // release the recorded buffers; we have the blob now
      const samples = await decodeToFloat32(await blob.arrayBuffer());
      wav = encodeWav(samples, 16_000);
    } catch {
      showError('Audio decode failed');
      return;
    }

    let text = null;
    try {
      // Transcription runs on Cloudflare Workers AI (Whisper); the body is the
      // resampled WAV, so the same format reaches the model from every browser.
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: wav,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = (await res.json()).text;
    } catch (err) {
      console.error('[VoiceInput]', err);
    }

    if (text) {
      ontranscript(text);
      phase = 'idle';
    } else {
      // Either the request failed or the clip was silent — both warrant a retry.
      showError('Transcription failed');
    }
  }

  // `msg` is logged context only — the error state is shown via the mic button's
  // styling and title, not as on-screen text.
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
    return rendered.getChannelData(0);
  }

  // Encode Float32 samples as a 16-bit PCM mono WAV. WAV decodes reliably on the
  // server across browsers, unlike the raw MediaRecorder output (webm/opus on
  // Chrome, mp4/aac on Safari).
  function encodeWav(samples, rate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (off, s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true); // byte rate (rate * channels * bytesPerSample)
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let off = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return buffer;
  }

  function handleClick() {
    if (phase === 'recording') {
      stopRecording(); // manual stop still works; VAD just makes it optional
    } else if (phase === 'idle' || phase === 'error') {
      startRecording();
    }
  }

  const supported = browser && 'mediaDevices' in navigator && typeof MediaRecorder !== 'undefined';

  // On unmount, release everything: mic, detector, and the decode context.
  $effect(() => () => {
    stopVad();
    micStream?.getTracks().forEach((t) => t.stop());
    decodeCtx?.close().catch(() => {});
  });
</script>

{#if supported}
  {#if phase === 'transcribing'}
    <div class="voice-status" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span class="status-text">Transcribing…</span>
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

  .status-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
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
