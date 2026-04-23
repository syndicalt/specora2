import "./globals.css";

export const metadata = {
  title: "Specora",
  description: "AI-Native ITSM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="overflow-hidden">
      <body className="bg-gray-950 text-gray-100 overflow-hidden">{children}</body>
    </html>
  );
}
