/**
 * Messages for recordings that produced nothing usable, each naming what was actually measured
 * (see RecordingResult.reason in recorder.ts). Shown to the user; never logged.
 */

/** A recording that produced nothing usable, explained by what was actually measured. Every
 *  message starts with "Microphone" so the next good recording clears it from the notice line. */
export function captureProblemMessage(reason: string, device: string): string | null {
  switch (reason) {
    case 'micSilent':
      return `Microphone: Chrome opened “${device}” and the audio engine is running, but every sample it delivered was exactly 0 (no sound at all, not even room noise). The signal is being cut off before the browser: Windows has this device muted or its level at 0 (Control Panel → Sound → Recording → ${device} → Properties → Levels), or the laptop's microphone key is on.`;
    case 'trackMuted':
      return `Microphone: “${device}” stayed muted by the system for the whole turn (Chrome reported the track muted and delivered no sound). Windows mutes it in Control Panel → Sound → Recording → ${device} → Properties → Levels (the speaker button), or the laptop's microphone key does. Unmute it and press the mic again.`;
    case 'trackEnded':
      return `Microphone: “${device}” stopped while recording (disconnected or taken by another app). Check the device and try again.`;
    case 'audioStalled':
      return 'Microphone: the browser audio engine did not start, so nothing was recorded. Click anywhere on the page, then press the mic again; if it repeats, reload the page.';
    default:
      return null;
  }
}
