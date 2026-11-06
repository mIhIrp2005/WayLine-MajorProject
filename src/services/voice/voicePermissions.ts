// WAYLINE Voice Permissions & Environment Diagnostics
// Validates Secure Context (HTTPS/localhost) and Microphone Access

export interface PermissionCheckResult {
  isSecure: boolean;
  hasHardware: boolean;
  error?: string;
  advice?: string;
}

export class VoicePermissionsService {
  public static checkEnvironment(): PermissionCheckResult {
    const isSecure = typeof window !== 'undefined' && Boolean(window.isSecureContext);
    const hasHardware = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

    if (!isSecure) {
      return {
        isSecure: false,
        hasHardware,
        error: 'Insecure Origin (HTTP)',
        advice: 'Mobile browsers block microphone access over plain HTTP. Connect via HTTPS or set chrome://flags/#unsafely-treat-insecure-origin-as-secure.'
      };
    }

    if (!hasHardware) {
      return {
        isSecure: true,
        hasHardware: false,
        error: 'MediaDevices API unavailable',
        advice: 'No audio capture devices detected on this browser.'
      };
    }

    return {
      isSecure: true,
      hasHardware: true
    };
  }

  public static async queryMicrophoneStatus(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      return 'unknown';
    }
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return status.state;
    } catch {
      return 'unknown';
    }
  }

  public static async requestMicrophone(): Promise<MediaStream> {
    const env = this.checkEnvironment();

    // Check if mediaDevices.getUserMedia is supported
    if (!navigator.mediaDevices?.getUserMedia) {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'wayline.local';
      if (!env.isSecure) {
        throw new Error(`Microphone requires HTTPS on LAN. Access via https://${host}:8767 or download the CA certificate.`);
      }
      throw new Error('Microphone device not supported by this browser.');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      return stream;
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission was denied. Tap the browser address bar / lock icon to allow microphone access.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw new Error('No physical microphone found on this device.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        throw new Error('Microphone is already in use by another application.');
      }
      throw new Error(`Failed to capture microphone: ${err.message || err.name}`);
    }
  }
}
