import { cache } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import type { Organization } from "@platypus/schemas";
import { joinUrl } from "@/lib/utils";
import { OrgSettingsMenu } from "@/components/org-settings-menu";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Header } from "@/components/header";
import { HeaderBackButton } from "@/components/header-back-button";
import { HeaderHomeButton } from "@/components/header-home-button";
import { ProtectedRoute } from "@/components/protected-route";

// Cached so the metadata and the layout body share one request: both need the
// organization, and `cache` collapses them into a single backend call.
const fetchOrganization = cache(async function fetchOrganization(
  orgId: string,
): Promise<Organization | null> {
  const backendUrl =
    process.env.INTERNAL_BACKEND_URL || process.env.BACKEND_URL || "";
  const headersList = await headers();
  // Unlike the workspace shell, a failure here must not break the page: the
  // organization is only a label and the title, so it degrades to null.
  try {
    const response = await fetch(
      joinUrl(backendUrl, `/organizations/${orgId}`),
      {
        headers: {
          cookie: headersList.get("cookie") || "",
        },
      },
    );
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<Metadata> {
  const { orgId } = await params;
  const organization = await fetchOrganization(orgId);

  return {
    title: organization ? `${organization.name} | Platypus` : "Platypus",
  };
}

export default async function OrgSettingsLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}>) {
  const { orgId } = await params;
  const organization = await fetchOrganization(orgId);

  return (
    <ProtectedRoute requireOrgAccess={true} requiredOrgRole="admin">
      <SidebarProvider>
        <div className="h-dvh flex flex-col w-full overflow-hidden">
          <Header
            leftContent={
              <div className="flex items-center gap-2">
                <HeaderBackButton />
                <HeaderHomeButton />
              </div>
            }
          />
          <div className="flex-1 flex flex-col items-center overflow-y-auto">
            <div className="flex flex-col md:flex-row w-full md:w-full lg:w-4/5 max-w-5xl py-8 px-4 md:px-0">
              <div className="w-full md:w-48 md:fixed md:top-16 pt-4 mb-8 md:mb-0">
                <OrgSettingsMenu
                  orgId={orgId}
                  organizationName={organization?.name}
                />
              </div>
              <div className="flex-1 p-2 md:ml-48 min-w-0">{children}</div>
            </div>
            <div className="h-1 shrink-0" />
          </div>
        </div>
      </SidebarProvider>
    </ProtectedRoute>
  );
}
