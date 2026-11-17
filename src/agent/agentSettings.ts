import { create } from 'zustand';
import { DEFAULT_ANTHROPIC_MODEL, type Effort } from './providers/models';
import { getStorageConfig } from '../utils/io/storageClient';

/**
 * Assistant settings, per browser.
 *
 * API keys are the user's own and stay in this browser's localStorage. They
 * are never written into the deck, the collab document, exports, or any
 * request to the slides server; only the provider's API receives them.
 * ChatGPT sign-in keeps no credential here at all: the local slides server
 * holds those tokens (OpenAI requires them out of browser storage).
 */

export type ProviderId = 'anthropic' | 'openai' | 'chatgpt';

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Claude (Anthropic API key)',
  openai: 'OpenAI (API key)',
  chatgpt: 'ChatGPT plan (sign in)',
};

export interface AgentSettings {
  provider: ProviderId;
  anthropicKey: string;
  openaiKey: string;
  models: Record<ProviderId, string>;
  /** Unset = the model's default effort. */
  effort: Effort | '';
  /** Slides server that relays ChatGPT plan usage; '' = the storage server,
   *  else http://localhost:3001. */
  relayUrl: string;
  /** Switch the editor to the slide the agent is editing. Off by default:
   *  the assistant is a collaborator and never moves the user's view unless
   *  asked to (its slide is marked in the slide panel instead). */
  followAgent: boolean;
}

const STORAGE_KEY = 'slides.agent.settings';

const DEFAULTS: AgentSettings = {
  provider: 'anthropic',
  anthropicKey: '',
  openaiKey: '',
  models: { anthropic: DEFAULT_ANTHROPIC_MODEL, openai: '', chatgpt: '' },
  effort: '',
  relayUrl: '',
  followAgent: false,
};

const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'chatgpt'];
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);

function load(): AgentSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<AgentSettings>;
    const models = (p.models ?? {}) as Partial<Record<ProviderId, string>>;
    return {
      provider: PROVIDERS.includes(p.provider as ProviderId) ? p.provider as ProviderId : DEFAULTS.provider,
      anthropicKey: str(p.anthropicKey, ''),
      openaiKey: str(p.openaiKey, ''),
      models: {
        anthropic: str(models.anthropic, '') || DEFAULTS.models.anthropic,
        openai: str(models.openai, ''),
        chatgpt: str(models.chatgpt, ''),
      },
      effort: EFFORTS.includes(p.effort as Effort) ? p.effort as Effort : '',
      relayUrl: str(p.relayUrl, ''),
      followAgent: p.followAgent === true,
    };
  } catch {
    return DEFAULTS;
  }
}

interface AgentSettingsStore extends AgentSettings {
  update: (changes: Partial<AgentSettings>) => void;
  setModel: (provider: ProviderId, model: string) => void;
}

function persist(settings: AgentSettings) {
  const { provider, anthropicKey, openaiKey, models, effort, relayUrl, followAgent } = settings;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, anthropicKey, openaiKey, models, effort, relayUrl, followAgent }));
  } catch { /* private mode: settings last for this tab only */ }
}

export const useAgentSettings = create<AgentSettingsStore>((set, get) => ({
  ...load(),
  update: (changes) => {
    set(changes);
    persist(get());
  },
  setModel: (provider, model) => {
    set(s => ({ models: { ...s.models, [provider]: model } }));
    persist(get());
  },
}));

/** The slides server that relays ChatGPT plan usage. */
export function relayServerUrl(settings: Pick<AgentSettings, 'relayUrl'> = useAgentSettings.getState()): string {
  if (settings.relayUrl.trim()) return settings.relayUrl.trim().replace(/\/$/, '');
  const storage = getStorageConfig();
  return (storage.mode === 'server' && storage.serverUrl ? storage.serverUrl : 'http://localhost:3001').replace(/\/$/, '');
}

/** Whether the chosen provider has what it needs to run, without asking
 *  the server (ChatGPT sign-in is checked live by the panel). */
export function hasCredentials(settings: AgentSettings): boolean {
  if (settings.provider === 'anthropic') return !!settings.anthropicKey;
  if (settings.provider === 'openai') return !!settings.openaiKey && !!settings.models.openai;
  return true;
}
