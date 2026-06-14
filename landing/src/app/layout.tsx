import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CredFlow - Credit memory for wallets",
  description:
    "A compact landing page for CredFlow, an on-chain credit memory protocol for pseudonymous wallets.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="dark h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
