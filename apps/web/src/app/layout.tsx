import "./globals.css";

export const metadata = {
  title: "Specora",
  description: "AI-Native ITSM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100">{children}</body>
    </html>
  );
}
