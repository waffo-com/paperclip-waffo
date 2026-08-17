import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi } from "./auth";

describe("authApi.signOut", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the managed deployment redirect from the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, redirectTo: "/cloud/logout" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(authApi.signOut()).resolves.toEqual({
      success: true,
      redirectTo: "/cloud/logout",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });
});

describe("authApi.signInOidc", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the JumpCloud authorization URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        url: "https://oauth.id.jumpcloud.com/authorize",
        redirect: true,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(authApi.signInOidc({ callbackURL: "/" })).resolves.toBe(
      "https://oauth.id.jumpcloud.com/authorize",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-in/oauth2", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "jumpcloud",
        callbackURL: "/",
      }),
    });
  });

  it("rejects an OAuth response without a redirect URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ redirect: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    await expect(authApi.signInOidc({ callbackURL: "/" })).rejects.toThrow(
      "OIDC provider did not return a redirect URL",
    );
  });
});
