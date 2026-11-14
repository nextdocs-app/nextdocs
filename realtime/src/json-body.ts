/** Reads a JSON object body from a Yhub API request. */
export type JsonBodyRequest = {
  bytes(): Promise<Uint8Array>;
};

/**
 * Parses a JSON object body, answering null for anything that is not one. Callers own
 * their own contract errors: an unparseable body is a malformed request, not a crash.
 */
export async function readJsonBody(req: JsonBodyRequest): Promise<Record<string, unknown> | null> {
  try {
    const raw = await req.bytes();
    if (!raw || raw.length === 0) {
      return null;
    }
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    return parsed != null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
