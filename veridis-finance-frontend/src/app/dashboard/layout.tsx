import { redirect } from "next/navigation";

import { ErrorBoundary } from "@/components/common/error-boundary";
import { Navbar } from "@/components/layout/navbar";
import { Sidebar } from "@/components/layout/sidebar";
import { SessionProvider } from "@/components/session-provider";
import { getSessionFromCookies } from "@/lib/auth";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = getSessionFromCookies();

  if (!session) {
    redirect("/login");
  }

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-screen bg-background">
        <Sidebar session={session} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar session={session} />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1400px]">
              <ErrorBoundary>{children}</ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </SessionProvider>
  );
}
