export interface VideoSource {
  label: string;
  url: string;
  height?: number;
  /** Approximate bitrate in kbps. */
  bitrate?: number;
  type?: string;
}

export interface CaptionTrack {
  label: string;
  lang: string;
  src: string;
}

export interface SourcesResponse {
  sources: VideoSource[];
  captions: CaptionTrack[];
}
