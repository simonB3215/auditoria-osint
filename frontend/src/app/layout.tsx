import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/context";
import { ThemeProvider } from "@/lib/theme/context";
import { ToastProvider } from "@/hooks/use-toast";
import { CookieConsentProvider } from "@/lib/cookieConsent/context";

// Script bloqueante (corre antes de que React hidrate) para aplicar el
// tema guardado sin flash de contenido sin estilo — ThemeProvider hace lo
// mismo en un useEffect, mucho después del primer paint.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("aegis-theme");
    var dark = stored === "dark" || (!stored && matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aegis CyberAudit",
  description: "Plataforma de auditoría de ciberseguridad",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // El script bloqueante de abajo agrega la clase `dark` a <html> ANTES
      // de que React hidrate (necesario para que no haya flash de tema
      // incorrecto). Eso hace que el className del server y el del cliente
      // difieran a propósito en esa hidratación puntual — sin este flag,
      // React lo reporta como un mismatch de hidratación real, cuando en
      // realidad es intencional (mismo patrón que usa next-themes).
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <I18nProvider>
            <ToastProvider>
              <CookieConsentProvider>{children}</CookieConsentProvider>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
