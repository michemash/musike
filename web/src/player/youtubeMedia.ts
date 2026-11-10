type PlayerEvent = { data: number; target: YouTubePlayer };

interface YouTubePlayer {
  cueVideoById(options: { videoId: string; startSeconds?: number }): void;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: () => void;
        onStateChange: (event: PlayerEvent) => void;
        onError: () => void;
      };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

function loadApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

class LoadedRange {
  constructor(private readonly media: YouTubeMediaElement) {}
  get length() {
    return this.media.duration > 0 ? 1 : 0;
  }
  end(_index: number) {
    return this.media.duration * (this.media.player?.getVideoLoadedFraction() ?? 0);
  }
}

class YouTubeMediaElement extends HTMLElement {
  player: YouTubePlayer | null = null;
  private host: HTMLDivElement;
  private connected: Promise<void>;
  private markConnected!: () => void;
  private initialized = false;
  private _src = "";
  private _id = "";
  private _paused = true;
  private _ended = false;
  private _volume = 1;
  private _muted = false;
  private wantedPlay = false;
  private startAt = 0;
  private poller: ReturnType<typeof setInterval> | null = null;

  readyState = 0;
  preload = "auto";
  playsInline = true;
  error: { code: number; message: string } | null = null;
  readonly videoWidth = 16;
  readonly videoHeight = 9;

  constructor() {
    super();
    this.host = document.createElement("div");
    this.connected = new Promise((resolve) => {
      this.markConnected = resolve;
    });
  }

  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    this.host.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    this.style.cssText = "position:relative;display:block;width:100%;height:100%;background:#000";
    this.appendChild(this.host);
    this.markConnected();
    void this.ensurePlayer();
  }

  private async ensurePlayer(): Promise<YouTubePlayer> {
    if (this.player) return this.player;
    await this.connected;
    const YT = await loadApi();
    return new Promise((resolve) => {
      const player = new YT.Player(this.host, {
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, controls: 1, rel: 0, origin: location.origin },
        events: {
          onReady: () => {
            this.player = player;
            this.applySound();
            this.readyState = 1;
            this.dispatchEvent(new Event("loadedmetadata"));
            this.dispatchEvent(new Event("durationchange"));
            this.loadCurrent();
            resolve(player);
          },
          onStateChange: (event) => this.onState(event.data),
          onError: () => {
            this.error = { code: 4, message: "YouTube could not play this video." };
            this.dispatchEvent(new Event("error"));
          },
        },
      });
    });
  }

  private loadCurrent() {
    if (!this.player || !this._id) return;
    const options = { videoId: this._id, startSeconds: this.startAt || 0 };
    if (this.wantedPlay) this.player.loadVideoById(options);
    else this.player.cueVideoById(options);
  }

  private onState(state: number) {
    if (state === 1) {
      this._paused = false;
      this._ended = false;
      this.readyState = 4;
      this.dispatchEvent(new Event("playing"));
      this.startPolling();
    } else if (state === 2) {
      this._paused = true;
      this.stopPolling();
      this.dispatchEvent(new Event("pause"));
    } else if (state === 0) {
      this._paused = true;
      this._ended = true;
      this.stopPolling();
      this.dispatchEvent(new Event("ended"));
    } else if (state === 3) {
      this.dispatchEvent(new Event("waiting"));
    } else if (state === 5) {
      this.readyState = 4;
      this.dispatchEvent(new Event("loadedmetadata"));
      this.dispatchEvent(new Event("durationchange"));
      this.dispatchEvent(new Event("progress"));
    }
  }

  private startPolling() {
    this.stopPolling();
    this.poller = setInterval(() => {
      const state = this.player?.getPlayerState();
      if (state === 0 && !this._ended) return this.onState(0);
      if (state === 2 && !this._paused) return this.onState(2);
      this.dispatchEvent(new Event("timeupdate"));
      this.dispatchEvent(new Event("progress"));
    }, 250);
  }

  private stopPolling() {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  private applySound() {
    this.player?.setVolume(Math.round(this._volume * 100));
    if (this._muted) this.player?.mute();
    else this.player?.unMute();
  }

  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    this._id = value.startsWith("youtube:") ? value.slice("youtube:".length) : "";
    this._ended = false;
    this.error = null;
    this.readyState = 0;
    this.startAt = 0;
    void this.ensurePlayer().then(() => this.loadCurrent());
  }
  get currentSrc() {
    return this._src;
  }
  get currentTime() {
    return this.player?.getCurrentTime() ?? this.startAt;
  }
  set currentTime(value: number) {
    this.startAt = Math.max(0, value);
    this.player?.seekTo(this.startAt, true);
    this.dispatchEvent(new Event("seeked"));
  }
  get duration() {
    return this.player?.getDuration() || NaN;
  }
  get paused() {
    return this._paused;
  }
  get ended() {
    return this._ended;
  }
  get volume() {
    return this._volume;
  }
  set volume(value: number) {
    this._volume = Math.max(0, Math.min(1, value));
    this.applySound();
  }
  get muted() {
    return this._muted;
  }
  set muted(value: boolean) {
    this._muted = value;
    this.applySound();
  }
  get buffered() {
    return new LoadedRange(this) as unknown as TimeRanges;
  }

  play(): Promise<void> {
    this.wantedPlay = true;
    this._paused = false;
    return this.ensurePlayer().then((player) => {
      if (!this._id) return;
      player.loadVideoById({ videoId: this._id, startSeconds: this.startAt || 0 });
      // The iframe can omit its initial PLAYING callback when loadVideoById follows a freshly cued video.
      // Optimistically start the app clock; iframe errors still arrive through onError and stop playback.
      setTimeout(() => {
        if (!this.wantedPlay || this._id === "") return;
        this.readyState = 4;
        this.dispatchEvent(new Event("loadedmetadata"));
        this.dispatchEvent(new Event("durationchange"));
        this.dispatchEvent(new Event("playing"));
        this.startPolling();
      }, 300);
    });
  }

  pause() {
    this.wantedPlay = false;
    this._paused = true;
    this.player?.pauseVideo();
  }

  load() {
    this.loadCurrent();
  }

  getAttribute(name: string) {
    if (name === "src") return this._src || null;
    return super.getAttribute(name);
  }

  setAttribute(name: string, value: string) {
    if (name === "src") this.src = value;
    else super.setAttribute(name, value);
  }

  removeAttribute(name: string) {
    if (name !== "src") return super.removeAttribute(name);
    this._src = "";
    this._id = "";
    this.wantedPlay = false;
    this.stopPolling();
    this.player?.stopVideo();
  }
}

const tag = "musike-youtube-media";
if (!customElements.get(tag)) customElements.define(tag, YouTubeMediaElement);

export function createYouTubeMediaElement(): HTMLVideoElement {
  return document.createElement(tag) as unknown as HTMLVideoElement;
}
