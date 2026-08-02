"use client";

import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenu,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  Blocks,
  Bot,
  Layers,
  Mail,
  Plug,
  Settings,
  Sparkles,
  Unplug,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface OrgSettingsMenuProps {
  orgId: string;
  /**
   * Resolved by the settings layout. Undefined when the organization could not
   * be fetched, in which case the heading is left out rather than blocking the
   * settings pages behind an error.
   */
  organizationName?: string;
}

export function OrgSettingsMenu({
  orgId,
  organizationName,
}: OrgSettingsMenuProps) {
  const pathname = usePathname();

  const generalHref = `/${orgId}/settings`;
  const membersHref = `/${orgId}/settings/members`;
  const invitationsHref = `/${orgId}/settings/invitations`;
  const providersHref = `/${orgId}/settings/providers`;
  const mcpHref = `/${orgId}/settings/mcp`;
  const skillsHref = `/${orgId}/settings/skills`;
  const agentsHref = `/${orgId}/settings/agents`;
  const blueprintsHref = `/${orgId}/settings/blueprints`;
  const pluginsHref = `/${orgId}/settings/plugins`;

  return (
    <SidebarContent>
      <SidebarGroup>
        {organizationName && (
          <>
            <h2
              title={organizationName}
              className="h-8 truncate px-2 text-sm leading-8 font-medium"
            >
              {organizationName}
            </h2>
            {/* Sets the static heading apart from the links below it */}
            <SidebarSeparator className="mx-0 my-1" />
          </>
        )}
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === generalHref}>
                <Link href={generalHref}>
                  <Settings /> General
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(membersHref)}
              >
                <Link href={membersHref}>
                  <Users /> Members
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(invitationsHref)}
              >
                <Link href={invitationsHref}>
                  <Mail /> Invitations
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(providersHref)}
              >
                <Link href={providersHref}>
                  <Unplug /> Providers
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(mcpHref)}
              >
                <Link href={mcpHref}>
                  <Plug /> MCP
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(skillsHref)}
              >
                <Link href={skillsHref}>
                  <Sparkles /> Skills
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(agentsHref)}
              >
                <Link href={agentsHref}>
                  <Bot /> Agents
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(blueprintsHref)}
              >
                <Link href={blueprintsHref}>
                  <Layers /> Blueprints
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={pathname.startsWith(pluginsHref)}
              >
                <Link href={pluginsHref}>
                  <Blocks /> Plugins
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  );
}
