/** Provider constants, kept apart from the SDK adapters so the editor shell
 *  (header, settings) can use them without loading a model SDK. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
