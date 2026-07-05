import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Coach",
  description: "Endurance training app",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: 860,
          margin: "0 auto",
          padding: "2rem 1rem",
          lineHeight: 1.5,
        }}
      >
        {children}
      </body>
    </html>
  );
}
