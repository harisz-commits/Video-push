import type { Metadata } from "next";
import "../styles/global.css";

export const metadata: Metadata = {
  title: "Infographics Studio",
  description:
    "Stichwort zu Skript zu Voiceover zu gerendertem Erklärvideo im Flat-Vector-Stil.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
