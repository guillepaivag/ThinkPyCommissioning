export function cooldownExpiresAt(createdAt: string, minutes: number): string {
  return new Date(new Date(createdAt).getTime() + minutes * 60_000).toISOString();
}

export function isInCooldown(createdAt: string | undefined, now: string, minutes: number): boolean {
  return createdAt !== undefined && cooldownExpiresAt(createdAt, minutes) > now;
}
