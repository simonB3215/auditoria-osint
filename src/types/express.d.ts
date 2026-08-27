export type UserRole = "ciso" | "auditor" | "viewer";

export interface AuthenticatedProfile {
  id: string; // = auth.uid()
  organizationId: string;
  role: UserRole;
  accessToken: string;
  /** Superadmin de plataforma (ve/administra todas las organizaciones). No es parte del RBAC por-org. */
  isPlatformAdmin: boolean;
  /**
   * Legado del rol auditor_guest ("Piloto Invitado", removido — ver
   * migración 022_remove_guest_role.sql). Solo puede ser no-null en
   * perfiles que fueron guest en el pasado; ningún flujo actual lo
   * setea. Se conserva la columna/campo como registro histórico, no se
   * borra dato de nadie.
   */
  expiresAt: string | null;
}

declare global {
  namespace Express {
    interface Request {
      profile?: AuthenticatedProfile;
      /** Solo seteado por authenticateTokenOnly (flujo de onboarding, antes de que exista `profiles`). */
      userId?: string;
    }
  }
}
