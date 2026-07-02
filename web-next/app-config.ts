/** A voice the user can pick on the landing page. Maps server-side to a Fish voice_id. */
export interface VoiceOption {
  id: string;
  name: string;
}

/** A conversation language the user can pick. Maps server-side to STT + instructions. */
export interface LanguageOption {
  id: string;
  name: string;
}

// Keep the ids in sync with the server-side allowlist in the Python worker.
export const VOICES: VoiceOption[] = [
  { id: 'koi', name: 'Koi' },
  { id: 'finn', name: 'Finn' },
  { id: 'marlin', name: 'Marlin' },
];

export const LANGUAGES: LanguageOption[] = [
  { id: 'en', name: 'English' },
  { id: 'zh', name: '中文' },
  { id: 'ja', name: '日本語' },
];

export const DEFAULT_VOICE = 'koi' as const;
export const DEFAULT_LANGUAGE = 'en' as const;

export interface AppConfig {
  pageTitle: string;
  pageDescription: string;
  companyName: string;

  supportsVideoInput: boolean;
  supportsScreenShare: boolean;
  isPreConnectBufferEnabled: boolean;

  logo: string;
  startButtonText: string;
  accent?: string;
  logoDark?: string;
  accentDark?: string;

  // agent dispatch configuration
  agentName?: string;

  // LiveKit Cloud Sandbox configuration
  sandboxId?: string;
}

export const APP_CONFIG_DEFAULTS: AppConfig = {
  companyName: 'Fish Lead Qualification',
  pageTitle: 'Fish Lead Qualification',
  pageDescription:
    'Talk to a LiveKit voice agent for lead qualification. Pick a voice and a language, then start the call.',

  supportsVideoInput: false,
  supportsScreenShare: false,
  isPreConnectBufferEnabled: false,

  logo: '/lk-logo.svg',
  accent: '#002cf2',
  logoDark: '/lk-logo-dark.svg',
  accentDark: '#1fd5f9',
  startButtonText: 'Start call',

  // Client-side SDK scaffolding only: the name the React SDK puts on its request so
  // per-session config (chosen voice / language) rides agentMetadata. The signed
  // dispatch is rebuilt SERVER-SIDE in /api/token with a hardcoded agentName, so this
  // value is advisory — it must simply match the worker's registered agent_name.
  agentName: 'lead-qual',

  // LiveKit Cloud Sandbox configuration
  sandboxId: undefined,
};
