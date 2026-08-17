import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { secretService } from "../services/secrets.js";
import { fillModelDefaults } from "../services/instance-model-defaults.js";

/**
 * Applies this deployment's model defaults to a draft agent configuration.
 *
 * The endpoint APPLIES rather than describes: the form posts the draft it is
 * holding and assigns the result. The alternative — returning "here are the
 * defaults" and letting the client merge — put the fill-in rule ("only what is
 * absent; a blank value means the team opted out") in two codebases, where they
 * promptly disagreed about whether a blank string counts as configured.
 *
 * It also keeps field naming where it belongs. The client merging by key meant
 * this module had to know the form's field names; returning an adapterConfig
 * lets the UI adapter keep ownership of that mapping.
 *
 * Fork-owned router so the upstream agents route carries one mount line.
 */
export function waffoModelDefaultsRoutes(
  db: Db,
  assertCompanyAccess: (req: Request, companyId: string) => void,
): Router {
  const router = Router();
  const secretsSvc = secretService(db);

  router.post("/companies/:companyId/agent-model-defaults", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const adapterType = typeof req.body?.adapterType === "string" ? req.body.adapterType : null;
    const draft = isPlainRecord(req.body?.adapterConfig) ? req.body.adapterConfig : {};
    if (!adapterType) {
      res.status(400).json({ error: "adapterType is required" });
      return;
    }

    res.json({
      adapterConfig: await fillModelDefaults({
        secretsSvc,
        companyId,
        adapterType,
        adapterConfig: draft,
      }),
    });
  });

  return router;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
