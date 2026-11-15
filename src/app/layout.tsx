import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "McpOS — AI Development Workspace", description: "A secure, MCP-connected development workspace." };
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body>{children}</body></html>;
}
