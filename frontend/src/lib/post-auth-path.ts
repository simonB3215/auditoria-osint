const STORAGE_KEY = "aegis.postAuthPath";

/**
 * Recuerda adónde volver después del login o del segundo paso. Va en
 * sessionStorage y no en la URL porque puede incluir el token del link de
 * correo, que no debe llegar a ningún servidor.
 */
export function savePostAuthPath(path: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // Sin sessionStorage solo se pierde la redirección, no la sesión.
  }
}

export function takePostAuthPath(): string | null {
  try {
    const path = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    // Solo rutas internas: "//host" y "/\host" llevarían a otro sitio.
    return path && /^\/(?![/\\])/.test(path) ? path : null;
  } catch {
    return null;
  }
}
