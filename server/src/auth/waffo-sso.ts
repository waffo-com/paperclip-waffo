/**
 * Waffo's JumpCloud SSO wiring for Better Auth.
 *
 * Fork-owned so `better-auth.ts` — an upstream file that changes often — carries
 * three call sites rather than this whole body. Everything specific to running
 * Paperclip behind the company IdP lives here.
 */

export const OIDC_PROVIDER_ID = "jumpcloud";

const OIDC_ENV_KEYS = [
  "PAPERCLIP_OIDC_ISSUER",
  "PAPERCLIP_OIDC_CLIENT_ID",
  "PAPERCLIP_OIDC_CLIENT_SECRET",
] as const;

export type OidcEnvironment = Partial<Record<(typeof OIDC_ENV_KEYS)[number], string | undefined>>;

export interface OidcProviderConfig {
  providerId: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  pkce: boolean;
  authentication: "post";
}

/**
 * Null when the deployment configures no SSO at all, so a build without it
 * still runs on email/password. A half-filled configuration throws instead:
 * silently starting without SSO because one variable was misspelled is how an
 * instance ends up quietly accepting only passwords.
 */
export function resolveOidcProviderConfig(
  env: OidcEnvironment = process.env,
): OidcProviderConfig | null {
  const entries = OIDC_ENV_KEYS.map((key) => [key, env[key]?.trim()] as const);
  if (entries.every(([, value]) => !value)) return null;

  const missing = entries.filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`OIDC configuration is incomplete; missing ${missing.join(", ")}`);
  }

  const [[, issuer], [, clientId], [, clientSecret]] = entries;
  // Narrowing for TypeScript; `missing` above already proved all three are set.
  if (!issuer || !clientId || !clientSecret) {
    throw new Error(`OIDC configuration is incomplete; missing ${missing.join(", ")}`);
  }

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new Error("PAPERCLIP_OIDC_ISSUER must be a valid URL");
  }
  if (issuerUrl.protocol !== "https:") {
    throw new Error("PAPERCLIP_OIDC_ISSUER must use https");
  }

  return {
    providerId: OIDC_PROVIDER_ID,
    // Built from the parsed URL rather than the raw string so a trailing slash,
    // a default port, or a stray path segment normalise the same way once.
    discoveryUrl: new URL(".well-known/openid-configuration", issuerUrl).toString(),
    clientId,
    clientSecret,
    scopes: ["openid", "email", "profile"],
    pkce: true,
    authentication: "post",
  };
}

/**
 * Links a JumpCloud identity onto the local account that already owns the same
 * address. Better Auth gates that on `requireLocalEmailVerified`, which defaults
 * to true and — unlike the `!userInfo.emailVerified` check — applies even for a
 * trusted provider. Paperclip signs users up with `requireEmailVerification:
 * false`, so every local account carries `emailVerified: false` and would be
 * refused with `account_not_linked`. JumpCloud is the company IdP and vouches
 * for the address, so drop that gate rather than the provider-side one.
 */
// Not `as const`: Better Auth's option type wants a mutable `trustedProviders`
// array, and a readonly one fails to typecheck at the call site.
export const ACCOUNT_LINKING_OPTIONS = {
  enabled: true,
  trustedProviders: [OIDC_PROVIDER_ID],
  requireLocalEmailVerified: false,
};
