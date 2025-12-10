import { IKGPlayerFactory } from "@ikigaians/ikgplayer";

export const QUALITIES = ["lo", "me", "hi", "hd"]; // Mapping for accessing RGS stream URL

export const initPlayerInstance = (videoEl: HTMLDivElement) => {
  const { origin, pathname } = window.location;
  const options = {
    wasmBaseUrl: `${origin}${pathname}libmedia/wasm`,
    container: videoEl,
    isLive: true,
  };
  return IKGPlayerFactory.create("libmedia", options);
};

export enum PlayerStatus {
  STOPPED = 0,
  DESTROYING = 1,
  DESTROYED = 2,
  LOADING = 3,
  LOADED = 4,
  PLAYING = 5,
  PLAYED = 6,
  PAUSED = 7,
  CHANGING = 9,
  SEEKING = 8,
}

export enum PlayerEventType {
  LOADING = "loading",
  LOADED = "loaded",
  PLAYING = "playing",
  PLAYED = "played",
  PAUSED = "paused",
  STOPPED = "stopped",
  ENDED = "ended",
  SEEKING = "seeking",
  SEEKED = "seeked",
  CHANGING = "changing",
  CHANGED = "changed",
  TIMEOUT = "timeout",
  ERROR = "error",
  TIME = "time",
  RESUME = "resume",
  AUDIO_CONTEXT_RUNNING = "audioContextRunning",
  FIRST_AUDIO_RENDERED = "firstAudioRendered",
  FIRST_VIDEO_RENDERED = "firstVideoRendered",
  STREAM_UPDATE = "streamUpdate",
  PROGRESS = "progress",
  VOLUME_CHANGE = "volumeChange",
  SUBTITLE_DELAY_CHANGE = "subtitleDelayChange",
  QUALITY_CHANGE = "qualityChange",
  TIMEUP = "timeup",
}
