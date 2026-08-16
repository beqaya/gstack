/**
 * Application-Default-Credentials fallback for GCP.
 *
 * Stored access tokens expire in ~1h, so "configure gcp <token>" rots by
 * design. When neither keychain nor env has a credential, mint one from the
 * user's own gcloud ADC at call time — nothing is persisted, and revoking
 * gcloud auth revokes us. Returns null (never throws) when gcloud is absent
 * or unauthenticated; callers already handle the no-token path.
 */
export async function getAdcToken(): Promise<string | null> {
  try {
    const proc = (Bun as any).spawn(
      ["gcloud", "auth", "application-default", "print-access-token"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    const token = out.trim();
    return code === 0 && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
