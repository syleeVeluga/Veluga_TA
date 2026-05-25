export type ProviderVisibilityKey =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'custom';

export const PROVIDER_VISIBILITY_KEYS: ProviderVisibilityKey[] = [
  'openrouter',
  'anthropic',
  'openai',
  'gemini',
  'ollama',
  'custom',
];

export type ProviderVisibility = Partial<Record<ProviderVisibilityKey, boolean>>;

export const DEFAULT_PROVIDER_VISIBILITY: Record<ProviderVisibilityKey, boolean> = {
  openrouter: true,
  anthropic: true,
  openai: true,
  gemini: true,
  ollama: true,
  custom: true,
};

export function toVisibilityKey(profileKey: string): ProviderVisibilityKey {
  if (
    profileKey === 'custom:anthropic' ||
    profileKey === 'custom:openai' ||
    profileKey === 'custom:gemini'
  ) {
    return 'custom';
  }
  return profileKey as ProviderVisibilityKey;
}

export function isProviderVisible(
  profileKey: string,
  visibility: ProviderVisibility | undefined,
): boolean {
  if (!visibility) return true;
  return visibility[toVisibilityKey(profileKey)] !== false;
}
