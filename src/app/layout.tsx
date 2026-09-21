import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
  weight: ["500", "600", "700", "800"],
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: {
    default: "Hirewise Connect — Verified virtual assistants, managed by Hirewise",
    template: "%s · Hirewise Connect",
  },
  description:
    "Hirewise Connect is the agency-controlled talent marketplace of Hirewise Virtual Assistance Services. Discover certified, assessed virtual assistants. Hirewise handles pricing, interviews, contracts, deposits, and deployment.",
  metadataBase: new URL("https://connect.hirewise.example"),
  openGraph: {
    title: "Hirewise Connect",
    description: "Hire verified virtual assistants, not résumés.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} ${instrument.variable}`}>
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
