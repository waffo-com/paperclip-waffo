import { describe, expect, it } from "vitest";
import {
  applyModelDefaultsPatch,
  buildModelDefaultsPatch,
  resolveModelDefaultsSettings,
  DEFAULT_MODEL_SECRET_NAME_FALLBACK,
  type ModelDefaultsSettings,
} from "../services/instance-model-defaults.js";

const GATEWAY: ModelDefaultsSettings = {
  secretName: "ai-proxy-api-key",
  baseUrl: "https://ai-proxy.waffo.co",
  hermesGatewayUrl: null,
  openclawUrl: null,
  anthropicModel: "claude-sonnet-4-6",
  openaiModel: "gpt-5.4",
};
const SECRET_ID = "60637673-607e-4e6d-91f4-0a927fec8599";

const patchFor = (adapterType: string, adapterConfig: Record<string, unknown> = {}) =>
  buildModelDefaultsPatch({ adapterType, adapterConfig, secretId: SECRET_ID, settings: GATEWAY });

describe("resolveModelDefaultsSettings", () => {
  it("falls back to the conventional secret name when none is configured", () => {
    expect(resolveModelDefaultsSettings({}).secretName).toBe(DEFAULT_MODEL_SECRET_NAME_FALLBACK);
  });

  it("reads the gateway, both protocol models, and a renamed secret", () => {
    expect(resolveModelDefaultsSettings({
      PAPERCLIP_DEFAULT_MODEL_SECRET_NAME: "risk-team-gateway",
      PAPERCLIP_DEFAULT_MODEL_BASE_URL: "https://ai-proxy.waffo.co",
      PAPERCLIP_DEFAULT_ANTHROPIC_MODEL: "claude-sonnet-4-6",
      PAPERCLIP_DEFAULT_OPENAI_MODEL: "gpt-5.4",
    })).toEqual({
      secretName: "risk-team-gateway",
      baseUrl: "https://ai-proxy.waffo.co",
      hermesGatewayUrl: null,
      openclawUrl: null,
      anthropicModel: "claude-sonnet-4-6",
      openaiModel: "gpt-5.4",
    });
  });
});

describe("adapter coverage", () => {
  const SUPPORTED = ["claude_local", "codex_local", "opencode_local", "pi_local",
    "hermes_local", "hermes_gateway", "openclaw_gateway"];

  it("wires every harness that can reach a service this deployment runs", () => {
    for (const adapterType of SUPPORTED) {
      const patch = buildModelDefaultsPatch({
        adapterType,
        adapterConfig: {},
        secretId: SECRET_ID,
        settings: { ...GATEWAY, hermesGatewayUrl: "https://hermes.test", openclawUrl: "wss://openclaw.test" },
      });
      const wiredSomething = Object.keys(patch.env).length > 0 || Object.keys(patch.values).length > 0;
      expect(wiredSomething, `${adapterType} prefilled nothing`).toBe(true);
    }
  });

  it("leaves harnesses it cannot point anywhere completely alone", () => {
    // Half-configuring these would produce an agent that looks ready and still
    // fails; blank is the honest state.
    for (const adapterType of ["gemini_local", "grok_local", "cursor", "cursor_cloud", "process", "http"]) {
      expect(patchFor(adapterType)).toEqual({ env: {}, model: null, values: {} });
    }
  });
});

describe("per-harness wiring", () => {
  it("gives Claude Code a plain base URL", () => {
    expect(patchFor("claude_local")).toEqual({
      env: {
        ANTHROPIC_API_KEY: { type: "secret_ref", secretId: SECRET_ID, version: "latest" },
        ANTHROPIC_BASE_URL: { type: "plain", value: "https://ai-proxy.waffo.co" },
      },
      model: "claude-sonnet-4-6",
      values: {},
    });
  });

  it("gives Codex a provider table over /v1/responses, keyed to OPENAI_API_KEY", () => {
    const patch = patchFor("codex_local");
    expect(patch.model).toBe("gpt-5.4");
    expect(patch.env.OPENAI_API_KEY).toEqual({
      type: "secret_ref", secretId: SECRET_ID, version: "latest",
    });
    expect(patch.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    const providers = JSON.parse((patch.env.PAPERCLIP_CODEX_PROVIDERS as { value: string }).value);
    expect(providers.providers["waffo-gateway"]).toMatchObject({
      base_url: "https://ai-proxy.waffo.co",
      env_key: "OPENAI_API_KEY",
      wire_api: "responses",
    });
    expect(providers.model_provider).toBe("waffo-gateway");
  });

  it("gives OpenCode an openai-compatible provider listing the model", () => {
    const patch = patchFor("opencode_local");
    const providers = JSON.parse((patch.env.PAPERCLIP_OPENCODE_PROVIDERS as { value: string }).value);
    expect(providers["waffo-gateway"].options).toEqual({
      baseURL: "https://ai-proxy.waffo.co",
      apiKey: "{env:OPENAI_API_KEY}",
    });
    // OpenCode only offers models the provider lists.
    expect(providers["waffo-gateway"].models).toHaveProperty("gpt-5.4");
  });

  it("gives Pi an anthropic-messages provider, since it has no base-url setting", () => {
    const patch = patchFor("pi_local");
    const providers = JSON.parse((patch.env.PAPERCLIP_PI_PROVIDERS as { value: string }).value);
    expect(providers["waffo-gateway"]).toMatchObject({
      baseUrl: "https://ai-proxy.waffo.co",
      api: "anthropic-messages",
    });
    expect(providers["waffo-gateway"].models[0].id).toBe("claude-sonnet-4-6");
  });

  it("gives Hermes only the key, since its endpoint lives in Hermes' own config", () => {
    const patch = patchFor("hermes_local");
    expect(patch.env.ANTHROPIC_API_KEY).toEqual({
      type: "secret_ref", secretId: SECRET_ID, version: "latest",
    });
    expect(patch.env).not.toHaveProperty("ANTHROPIC_BASE_URL");
    // Which provider Hermes uses is decided in its config, so guessing a model
    // here would be inventing an answer.
    expect(patch.model).toBeNull();
  });

  it("prefills the gateway harnesses as config fields, not env vars", () => {
    // The generalisation this exists for: a local user connects these by
    // filling a URL and a credential, so that is what defaults must cover.
    const settings = {
      ...GATEWAY,
      hermesGatewayUrl: "https://hermes.waffo.co",
      openclawUrl: "wss://openclaw.waffo.co",
    };
    const hermes = buildModelDefaultsPatch({
      adapterType: "hermes_gateway", adapterConfig: {}, secretId: SECRET_ID, settings,
    });
    expect(hermes.values).toEqual({
      apiBaseUrl: "https://hermes.waffo.co",
      apiKey: { type: "secret_ref", secretId: SECRET_ID, version: "latest" },
    });
    expect(hermes.env).toEqual({});

    const openclaw = buildModelDefaultsPatch({
      adapterType: "openclaw_gateway", adapterConfig: {}, secretId: SECRET_ID, settings,
    });
    // Only the URL: authToken is a plain string field, and baking a token into
    // every agent created is not something a default should do.
    expect(openclaw.values).toEqual({ url: "wss://openclaw.waffo.co" });
  });

  it("prefills nothing for a gateway harness the deployment does not run", () => {
    // hermesGatewayUrl/openclawUrl are unset in GATEWAY.
    expect(patchFor("hermes_gateway").values).toEqual({});
    expect(patchFor("openclaw_gateway").values).toEqual({});
  });

  it("leaves a gateway field the creator already set", () => {
    const patch = buildModelDefaultsPatch({
      adapterType: "openclaw_gateway",
      adapterConfig: { url: "wss://team-openclaw.internal" },
      secretId: SECRET_ID,
      settings: { ...GATEWAY, openclawUrl: "wss://openclaw.waffo.co" },
    });
    expect(patch.values).toEqual({});
  });

  it("never mixes one harness's variables into another", () => {
    expect(Object.keys(patchFor("claude_local").env)).not.toContain("OPENAI_API_KEY");
    expect(Object.keys(patchFor("codex_local").env)).not.toContain("ANTHROPIC_BASE_URL");
  });
});

describe("fill-in semantics", () => {
  it("never overrides what the creator supplied", () => {
    expect(patchFor("claude_local", {
      env: {
        ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "team-owned", version: "latest" },
        ANTHROPIC_BASE_URL: { type: "plain", value: "https://team-gateway.internal" },
      },
      model: "claude-opus-4-6",
    })).toEqual({ env: {}, model: null, values: {} });
  });

  it("treats a deliberately blanked key as configured", () => {
    expect(patchFor("claude_local", { env: { ANTHROPIC_BASE_URL: "" } }).env)
      .not.toHaveProperty("ANTHROPIC_BASE_URL");
  });

  it("still sets the gateway when the company has no secret yet", () => {
    const patch = buildModelDefaultsPatch({
      adapterType: "claude_local",
      adapterConfig: {},
      secretId: null,
      settings: GATEWAY,
    });
    expect(patch.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(patch.env).toHaveProperty("ANTHROPIC_BASE_URL");
  });

  it("does nothing for an unsupported harness", () => {
    expect(patchFor("gemini_local")).toEqual({ env: {}, model: null, values: {} });
  });
});

describe("applyModelDefaultsPatch", () => {
  it("merges without disturbing unrelated config", () => {
    expect(applyModelDefaultsPatch(
      { env: { GH_TOKEN: { type: "plain", value: "t" } }, instructionsEntryFile: "AGENTS.md" },
      { env: { ANTHROPIC_BASE_URL: { type: "plain", value: "u" } }, model: "claude-sonnet-4-6", values: {} },
    )).toEqual({
      env: { GH_TOKEN: { type: "plain", value: "t" }, ANTHROPIC_BASE_URL: { type: "plain", value: "u" } },
      model: "claude-sonnet-4-6",
      instructionsEntryFile: "AGENTS.md",
    });
  });

  it("returns the config untouched when there is nothing to fill in", () => {
    const config = { model: "claude-opus-4-6" };
    expect(applyModelDefaultsPatch(config, { env: {}, model: null, values: {} })).toBe(config);
  });
});
