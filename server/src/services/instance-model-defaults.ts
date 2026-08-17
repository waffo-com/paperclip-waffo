/**
 * Model credentials for newly created agents.
 *
 * Upstream Paperclip expects whoever creates an agent to wire its model
 * credentials by hand: pick a company secret for the API key, point the agent
 * at a gateway, choose a model. That works for one technical operator running
 * one company. It does not survive a multi-team rollout — an agent the CEO
 * hires on its own is created with none of it and fails its first heartbeat
 * with "Authentication required", and every new team repeats the setup before
 * anything runs. Neither is something a business user can do.
 *
 * So the deployment configures the gateway once and two callers use it: the
 * creation form prefills from it (visible, editable, before saving), and
 * `agentService.create` fills in whatever the caller still left out (which is
 * what covers agents nobody filled a form for). Both read the same specs below,
 * so the two cannot drift.
 *
 * The API key is always bound as a `secret_ref` to a COMPANY secret looked up
 * by name, never an inline value. Each team therefore lands on its own key
 * under a shared name, which is what keeps per-team gateway billing possible
 * and makes rotation a UI edit of one secret rather than a re-wiring of every
 * agent.
 *
 * Defaults only ever FILL IN. Any key the caller supplied is left untouched.
 */

export const DEFAULT_MODEL_SECRET_NAME_ENV = "PAPERCLIP_DEFAULT_MODEL_SECRET_NAME";
export const DEFAULT_MODEL_SECRET_NAME_FALLBACK = "ai-proxy-api-key";
export const DEFAULT_BASE_URL_ENV = "PAPERCLIP_DEFAULT_MODEL_BASE_URL";
/**
 * Two model settings rather than one per adapter: the gateway speaks two
 * protocols, and which one an agent needs follows from its harness, not from a
 * separate choice the operator should have to make four times.
 */
export const DEFAULT_ANTHROPIC_MODEL_ENV = "PAPERCLIP_DEFAULT_ANTHROPIC_MODEL";
export const DEFAULT_OPENAI_MODEL_ENV = "PAPERCLIP_DEFAULT_OPENAI_MODEL";

/**
 * Harnesses this deployment cannot point at the gateway, and why. Kept as data
 * so the reason is answerable without re-deriving it from each adapter's
 * source — the question "why is Gemini not prefilled" has come up once already.
 */
export const HERMES_GATEWAY_URL_ENV = "PAPERCLIP_DEFAULT_HERMES_GATEWAY_URL";
export const OPENCLAW_URL_ENV = "PAPERCLIP_DEFAULT_OPENCLAW_URL";

export const UNSUPPORTED_ADAPTER_REASONS: Record<string, string> = {
  gemini_local: "reads GEMINI_API_KEY/GOOGLE_API_KEY with no endpoint override, and the gateway serves no Gemini model",
  grok_local: "reads XAI_API_KEY with no endpoint override, and the gateway serves no Grok model",
  cursor: "authenticates to Cursor's own service with CURSOR_API_KEY; not an OpenAI-compatible client",
  cursor_cloud: "runs on Cursor's cloud with CURSOR_API_KEY; nothing routes through a self-hosted gateway",
  process: "runs an arbitrary command; it has no model of its own to credential",
  http: "calls a webhook; it has no model of its own to credential",
};

/**
 * How each adapter is pointed at the gateway.
 *
 * The shape differs per harness and does not generalise into one pair of key
 * names: Claude Code reads a plain base-URL variable, while Codex takes its
 * whole provider table as JSON in PAPERCLIP_CODEX_PROVIDERS (which the adapter
 * renders into config.toml) and reads the key from the variable that table
 * names in `env_key`. So each entry owns its own builder and its own model
 * setting.
 *
 * An adapter belongs here only once we know the variables it actually reads. A
 * wrong guess produces an agent that looks configured and still fails, which is
 * worse than leaving it blank.
 */
interface AdapterGatewaySpec {
  /**
   * Env var this adapter reads the API key from, when its credential is an env
   * var at all. Gateway-style harnesses take theirs as a config field instead —
   * those declare it through `buildValues`.
   */
  apiKeyEnv?: string;
  /**
   * Named after the settings fields they read, so both are a direct lookup and
   * a new endpoint or protocol is one edit here plus one on the settings type —
   * not a union, a switch arm, and a settings field kept in sync by hand.
   */
  modelKey?: "anthropicModel" | "openaiModel";
  endpointKey?: "baseUrl" | "hermesGatewayUrl" | "openclawUrl";
  /** Adapter env this harness needs beyond the key. */
  buildGatewayEnv?: (input: { baseUrl: string; model: string | null }) => Record<string, unknown>;
  /**
   * Plain adapter-config fields to prefill. This is the surface a local user
   * fills in for gateway-style harnesses — a URL and a credential — and the
   * reason defaults cannot be env-only.
   */
  buildValues?: (input: { baseUrl: string; secretId: string | null }) => Record<string, unknown>;
}

const PROVIDER_ID = "waffo-gateway";
const PROVIDER_NAME = "Waffo AI gateway";

const plain = (value: string) => ({ type: "plain", value });

const ADAPTER_GATEWAY_SPECS: Record<string, AdapterGatewaySpec> = {
  // The only one with a plain base-URL variable; the rest carry a provider
  // table because their CLI has no endpoint flag.
  claude_local: {
    endpointKey: "baseUrl",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    modelKey: "anthropicModel",
    buildGatewayEnv: ({ baseUrl }) => ({
      ANTHROPIC_BASE_URL: plain(baseUrl),
    }),
  },
  // Rendered into config.toml. `wire_api: "responses"` because the gateway
  // serves Codex over /v1/responses; `env_key` names the variable the key
  // binding fills.
  codex_local: {
    endpointKey: "baseUrl",
    apiKeyEnv: "OPENAI_API_KEY",
    modelKey: "openaiModel",
    buildGatewayEnv: ({ baseUrl }) => ({
      PAPERCLIP_CODEX_PROVIDERS: plain(JSON.stringify({
        providers: {
          [PROVIDER_ID]: {
            name: PROVIDER_NAME,
            base_url: baseUrl,
            env_key: "OPENAI_API_KEY",
            wire_api: "responses",
          },
        },
        model_provider: PROVIDER_ID,
      })),
    }),
  },
  // OpenCode's providers map is keyed by provider id, and the model must be
  // listed for it to be selectable — an empty descriptor is enough.
  opencode_local: {
    endpointKey: "baseUrl",
    apiKeyEnv: "OPENAI_API_KEY",
    modelKey: "openaiModel",
    buildGatewayEnv: ({ baseUrl, model }) => ({
      PAPERCLIP_OPENCODE_PROVIDERS: plain(JSON.stringify({
        [PROVIDER_ID]: {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: baseUrl, apiKey: "{env:OPENAI_API_KEY}" },
          models: model ? { [model]: {} } : {},
        },
      })),
    }),
  },
  // Pi has no base-url flag or env var at all: a models.json provider entry is
  // the only way to point it anywhere. Its descriptors carry cost and context
  // metadata, which for an internal gateway is not billed per token — zeroed
  // rather than guessed, so nothing here pretends to know a price.
  pi_local: {
    apiKeyEnv: "ANTHROPIC_API_KEY",
    modelKey: "anthropicModel",
    endpointKey: "baseUrl",
    buildGatewayEnv: ({ baseUrl, model }) => ({
      PAPERCLIP_PI_PROVIDERS: plain(JSON.stringify({
        [PROVIDER_ID]: {
          baseUrl,
          apiKey: "{env:ANTHROPIC_API_KEY}",
          api: "anthropic-messages",
          models: model
            ? [{
                id: model,
                name: model,
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              }]
            : [],
        },
      })),
    }),
  },
  // Hermes resolves its own endpoint from its config.yaml, which Paperclip only
  // reads. So the key is all this can supply — pointing Hermes at the gateway
  // stays a step in Hermes' own config, and no `model` is set because which
  // provider it uses is decided there too.
  hermes_local: {
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  // Talks to an already-running Hermes API server, so the endpoint to prefill
  // is that server's, not the model gateway's. Its apiKey field takes a
  // secret_ref, so the credential stays a company secret like everywhere else.
  hermes_gateway: {
    endpointKey: "hermesGatewayUrl",
    buildValues: ({ baseUrl, secretId }) => ({
      apiBaseUrl: baseUrl,
      ...(secretId ? { apiKey: { type: "secret_ref", secretId, version: "latest" } } : {}),
    }),
  },
  // Same shape over WebSocket. `authToken` is a plain string field with no
  // secret_ref support, so only the URL is prefilled — a token belongs to the
  // team and should not be baked inline into every agent this creates.
  openclaw_gateway: {
    endpointKey: "openclawUrl",
    buildValues: ({ baseUrl }) => ({ url: baseUrl }),
  },
};

export function isAdapterWithModelDefaults(adapterType: string | null | undefined): boolean {
  return Boolean(adapterType && adapterType in ADAPTER_GATEWAY_SPECS);
}

/** Adapter types the creation form can prefill. */
export const MODEL_DEFAULT_ADAPTER_TYPES = Object.keys(ADAPTER_GATEWAY_SPECS);

export interface ModelDefaultsSettings {
  secretName: string;
  /** Model gateway, for the harnesses that speak to one directly. */
  baseUrl: string | null;
  /** A Hermes API server this deployment runs, if any. */
  hermesGatewayUrl: string | null;
  /** An OpenClaw server this deployment runs, if any. */
  openclawUrl: string | null;
  anthropicModel: string | null;
  openaiModel: string | null;
}

type DefaultsEnvironment = Partial<Record<string, string | undefined>>;

export function resolveModelDefaultsSettings(
  env: DefaultsEnvironment = process.env,
): ModelDefaultsSettings {
  const read = (key: string) => {
    const value = env[key]?.trim();
    return value && value.length > 0 ? value : null;
  };
  return {
    secretName: read(DEFAULT_MODEL_SECRET_NAME_ENV) ?? DEFAULT_MODEL_SECRET_NAME_FALLBACK,
    baseUrl: read(DEFAULT_BASE_URL_ENV),
    hermesGatewayUrl: read(HERMES_GATEWAY_URL_ENV),
    openclawUrl: read(OPENCLAW_URL_ENV),
    anthropicModel: read(DEFAULT_ANTHROPIC_MODEL_ENV),
    openaiModel: read(DEFAULT_OPENAI_MODEL_ENV),
  };
}

export interface ModelDefaultsPatch {
  /** Env entries to add, in the persisted binding shape. */
  env: Record<string, unknown>;
  /** Model to set, or null to leave the caller's choice alone. */
  model: string | null;
  /**
   * Plain adapter-config fields to add — the connection surface for
   * gateway-style harnesses, which configure a URL and credential as fields
   * rather than environment variables.
   */
  values: Record<string, unknown>;
}

/**
 * `secretId` is null when the company has no such secret yet — the gateway and
 * model are still worth filling in, and the missing key then surfaces through
 * the product's own configuration-incomplete path rather than as a binding
 * pointing at nothing.
 */
export function buildModelDefaultsPatch(input: {
  adapterType: string | null | undefined;
  adapterConfig: Record<string, unknown>;
  secretId: string | null;
  settings: ModelDefaultsSettings;
}): ModelDefaultsPatch {
  const spec = input.adapterType ? ADAPTER_GATEWAY_SPECS[input.adapterType] : undefined;
  if (!spec) return { env: {}, model: null, values: {} };

  const defaultModel = spec.modelKey ? input.settings[spec.modelKey] : null;
  const endpoint = spec.endpointKey ? input.settings[spec.endpointKey] : null;
  const existingEnv = isPlainRecord(input.adapterConfig.env) ? input.adapterConfig.env : {};

  // One rule, stated once: a key already present — even blank — is left alone,
  // because blanking one is how a team opts out of the shared gateway.
  const fillIn = (built: Record<string, unknown>, existing: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(built).filter(([key]) => !Object.prototype.hasOwnProperty.call(existing, key)),
    );

  const env = {
    ...(spec.apiKeyEnv && input.secretId
      ? fillIn(
          { [spec.apiKeyEnv]: { type: "secret_ref", secretId: input.secretId, version: "latest" } },
          existingEnv,
        )
      : {}),
    ...(endpoint && spec.buildGatewayEnv
      ? fillIn(spec.buildGatewayEnv({ baseUrl: endpoint, model: defaultModel }), existingEnv)
      : {}),
  };
  const values = endpoint && spec.buildValues
    ? fillIn(spec.buildValues({ baseUrl: endpoint, secretId: input.secretId }), input.adapterConfig)
    : {};

  const existingModel = input.adapterConfig.model;
  const hasModel = typeof existingModel === "string" && existingModel.trim().length > 0;

  return { env, model: defaultModel && !hasModel ? defaultModel : null, values };
}

/**
 * The one way to apply defaults. Both callers — agent creation and the form's
 * prefill endpoint — go through here, so the fill-in rule has a single
 * implementation and the two can never drift apart.
 *
 * The secret lookup is skipped for harnesses whose spec never consumes it,
 * rather than issued and discarded.
 */
export async function fillModelDefaults(input: {
  secretsSvc: { getByName: (companyId: string, name: string) => Promise<{ id: string } | null | undefined> };
  companyId: string;
  adapterType: string | null | undefined;
  adapterConfig: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const spec = input.adapterType ? ADAPTER_GATEWAY_SPECS[input.adapterType] : undefined;
  if (!spec) return input.adapterConfig;

  const settings = resolveModelDefaultsSettings();
  const secretId = specConsumesSecret(spec)
    ? (await input.secretsSvc.getByName(input.companyId, settings.secretName))?.id ?? null
    : null;

  return applyModelDefaultsPatch(
    input.adapterConfig,
    buildModelDefaultsPatch({
      adapterType: input.adapterType,
      adapterConfig: input.adapterConfig,
      secretId,
      settings,
    }),
  );
}

/**
 * openclaw_gateway takes only a URL — looking up a secret for it would be a
 * round-trip whose result is discarded.
 */
function specConsumesSecret(spec: AdapterGatewaySpec): boolean {
  if (spec.apiKeyEnv) return true;
  if (!spec.buildValues) return false;
  return Object.keys(spec.buildValues({ baseUrl: "https://probe.invalid", secretId: "probe" })).length
    !== Object.keys(spec.buildValues({ baseUrl: "https://probe.invalid", secretId: null })).length;
}

export function applyModelDefaultsPatch(
  adapterConfig: Record<string, unknown>,
  patch: ModelDefaultsPatch,
): Record<string, unknown> {
  const hasEnv = Object.keys(patch.env).length > 0;
  const hasValues = Object.keys(patch.values).length > 0;
  if (!hasEnv && !hasValues && !patch.model) return adapterConfig;
  const existingEnv = isPlainRecord(adapterConfig.env) ? adapterConfig.env : {};
  return {
    ...adapterConfig,
    ...patch.values,
    ...(patch.model ? { model: patch.model } : {}),
    ...(hasEnv ? { env: { ...existingEnv, ...patch.env } } : {}),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
