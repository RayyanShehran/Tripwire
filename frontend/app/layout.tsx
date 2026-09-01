import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tripwire",
  description: "Power-grid cascading failure simulation and decision support.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
