import { Router } from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { env } from "../config/env.js";

export const usersRouter = Router();

usersRouter.get(
  "/users/me",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { id, organizationId, role, isPlatformAdmin, expiresAt } = req.profile!;
    // maxAssetsPerOrg viaja acá (a.md, auditoría post-venta, Secundario A)
    // para que el frontend no tenga que hardcodear el límite de activos:
    // /users/me ya es el endpoint de perfil que se pide en casi todas las
    // páginas autenticadas (ver frontend/src/hooks/useProfile.ts).
    res.status(200).json({
      data: { id, organizationId, role, isPlatformAdmin, expiresAt, maxAssetsPerOrg: env.MAX_ASSETS_PER_ORG, maxSubdomainAssetsPerOrg: env.MAX_SUBDOMAIN_ASSETS_PER_ORG },
    });
  })
);
