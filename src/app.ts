import express, { type Express } from "express";
import { corsMiddleware, globalRateLimiter, helmetMiddleware } from "./middlewares/security.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { usersRouter } from "./routes/users.js";
import { auditsRouter } from "./routes/audits.js";
import { sandboxRouter } from "./routes/sandbox.js";
import { evidencesRouter } from "./routes/evidences.js";
import { assetsRouter } from "./routes/assets.js";
import { domainVerificationRouter } from "./routes/domainVerification.js";
import { scansRouter } from "./routes/scans.js";
import { osintRouter } from "./routes/osint.js";
import { reportsRouter } from "./routes/reports.js";
import { findingsRouter } from "./routes/findings.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { frameworksRouter } from "./routes/frameworks.js";
import { adminRouter } from "./routes/admin.js";
import { adminCostsRouter } from "./routes/adminCosts.js";
import { auditLogsRouter } from "./routes/auditLogs.js";
import { settingsRouter } from "./routes/settings.js";
import { internalFinopsRouter } from "./routes/internalFinops.js";
import { adminKpisRouter } from "./routes/adminKpis.js";
import { authEventsRouter } from "./routes/authEvents.js";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(globalRateLimiter);
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use("/api/v1", usersRouter);
  // sandboxRouter antes que auditsRouter a propósito: GET/DELETE
  // /audits/:id de auditsRouter matchearía "sandbox" como si fuera un
  // :id (y lo rechazaría por no ser un UUID) si se registrara primero —
  // Express prueba las rutas en el orden en que se montan los routers.
  app.use("/api/v1", sandboxRouter);
  app.use("/api/v1", auditsRouter);
  app.use("/api/v1", evidencesRouter);
  app.use("/api/v1", assetsRouter);
  app.use("/api/v1", domainVerificationRouter);
  app.use("/api/v1", scansRouter);
  app.use("/api/v1", osintRouter);
  app.use("/api/v1", reportsRouter);
  app.use("/api/v1", findingsRouter);
  app.use("/api/v1", dashboardRouter);
  app.use("/api/v1", onboardingRouter);
  app.use("/api/v1", frameworksRouter);
  app.use("/api/v1", adminRouter);
  app.use("/api/v1", adminCostsRouter);
  app.use("/api/v1", auditLogsRouter);
  app.use("/api/v1", settingsRouter);
  app.use("/api/v1", internalFinopsRouter);
  app.use("/api/v1", adminKpisRouter);
  app.use("/api/v1", authEventsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
