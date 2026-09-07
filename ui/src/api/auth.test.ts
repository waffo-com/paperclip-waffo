import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTenantSessionRecoveryCoordinator,
  tenantSessionRecovery,
} from "@/lib/tenant-session-recovery";
import { authApi } from "./auth";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("authApi.getSession", () => {
  it("returns null for an ordinary local 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(authApi.getSession()).resolves.toBeNull();
  });

  it("initiates recovery and stays pending for a Cloud tenant-session 401", async () => {
    const reload = vi.fn();
    const recovery = createTenantSessionRecoveryCoordinator(reload);
    vi.spyOn(tenantSessionRecovery, "recoverIfNeeded").mockImplementation(recovery.recoverIfNeeded);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "tenant_session_required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = authApi.getSession();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    let settled = false;
    void request.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});

describe("authApi.signOut", () => {
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
