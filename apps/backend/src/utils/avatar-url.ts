/**
 * Converts a storage avatar key to a full URL.
 * Uses STORAGE_PUBLIC_URL if set, otherwise proxies through /files/ endpoint.
 */
export function avatarKeyToUrl(
  avatarKey: string | null | undefined,
  baseUrl: string,
): string | null {
  if (!avatarKey) return null;
  const publicUrl = process.env.STORAGE_PUBLIC_URL;
  return publicUrl
    ? `${publicUrl}/${avatarKey}`
    : `${baseUrl}/files/${avatarKey}`;
}

/**
 * Replaces an Agent row's stored `avatarKey` with a resolved `avatarUrl` for
 * the response — shared by the Workspace and Organization Agent routes so the
 * two surfaces cannot drift on the shape (#605).
 */
export function agentWithAvatarUrl(
  agent: Record<string, unknown>,
  baseUrl: string,
): Record<string, unknown> {
  const key = agent.avatarKey as string | null | undefined;
  const { avatarKey: _avatarKey, ...rest } = agent;
  return { ...rest, avatarUrl: avatarKeyToUrl(key, baseUrl) ?? undefined };
}
