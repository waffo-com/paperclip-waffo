import { describe, expect, it } from "vitest";
import {
  ACCOUNT_LINKING_OPTIONS,
  resolveOidcProviderConfig,
} from "../auth/waffo-sso.js";

describe("OIDC provider configuration", () => {
  it("stays disabled when no OIDC settings are present", () => {
    expect(resolveOidcProviderConfig({})).toBeNull();
  });

  it("builds the JumpCloud discovery configuration", () => {
    expect(resolveOidcProviderConfig({
      PAPERCLIP_OIDC_ISSUER: "https://oauth.id.jumpcloud.com/",
      PAPERCLIP_OIDC_CLIENT_ID: "client-id",
      PAPERCLIP_OIDC_CLIENT_SECRET: "client-secret",
    })).toEqual({
      providerId: "jumpcloud",
      discoveryUrl: "https://oauth.id.jumpcloud.com/.well-known/openid-configuration",
      clientId: "client-id",
      clientSecret: "client-secret",
      scopes: ["openid", "email", "profile"],
      pkce: true,
      authentication: "post",
    });
  });

  it("normalises an issuer given without its trailing slash", () => {
    expect(resolveOidcProviderConfig({
      PAPERCLIP_OIDC_ISSUER: "https://oauth.id.jumpcloud.com",
      PAPERCLIP_OIDC_CLIENT_ID: "client-id",
      PAPERCLIP_OIDC_CLIENT_SECRET: "client-secret",
    })?.discoveryUrl).toBe("https://oauth.id.jumpcloud.com/.well-known/openid-configuration");
  });

  it("refuses a partial configuration rather than silently running without SSO", () => {
    expect(() => resolveOidcProviderConfig({
      PAPERCLIP_OIDC_ISSUER: "https://oauth.id.jumpcloud.com",
      PAPERCLIP_OIDC_CLIENT_ID: "client-id",
    })).toThrow(/PAPERCLIP_OIDC_CLIENT_SECRET/);
  });

  it("requires https, since the provider will not redirect to a plaintext callback", () => {
    expect(() => resolveOidcProviderConfig({
      PAPERCLIP_OIDC_ISSUER: "http://oauth.id.jumpcloud.com",
      PAPERCLIP_OIDC_CLIENT_ID: "client-id",
      PAPERCLIP_OIDC_CLIENT_SECRET: "client-secret",
    })).toThrow(/https/);
  });
});

describe("account linking", () => {
  // Regression: leaving requireLocalEmailVerified at its default of true made
  // every SSO sign-in fail with `account_not_linked`, because Paperclip signs
  // users up without email verification so no local account is ever verified.
  // Better Auth applies that gate independently of trustedProviders, so naming
  // the provider does not cover it.
  it("links onto local accounts that were never email-verified", () => {
    expect(ACCOUNT_LINKING_OPTIONS).toEqual({
      enabled: true,
      trustedProviders: ["jumpcloud"],
      requireLocalEmailVerified: false,
    });
  });
});
