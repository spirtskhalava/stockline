import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Stockline", description: "Warehouse ↔ PrestaShop stock sync" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site"><strong>Stockline</strong><span>warehouse ↔ PrestaShop</span></header>
        <main>{children}</main>
      </body>
    </html>
  );
}
