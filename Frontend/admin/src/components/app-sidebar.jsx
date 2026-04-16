import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { useState, useEffect } from "react";
import {
  Home,
  Inbox,
  Settings,
  Send,
  FileText,
  Archive,
  Package,
  Edit3,
  User,
  TrendingUp,
  MessageSquare,
  DollarSign,
  BarChart3,
  Globe,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { useContextApi } from "../hooks/useContextApi";
import { useSearchParams } from "react-router-dom";

const items = [
  {
    title: "Home",
    icon: Home,
    route: "Home",
  },
  {
    title: "Retailer Management",
    icon: User,
    children: [
      { title: "All Retailers", icon: Inbox },
      { title: "Pending Approvals", icon: FileText },
      { title: "Rejected Retailers", icon: Archive },
      { title: "KYC History", icon: FileText },
      { title: "License Expire", icon: Settings },
    ],
  },
  {
    title: "Agent Management",
    icon: User,
    children: [
      { title: "All Agents", icon: Inbox },
      { title: "Add Agent", icon: Edit3 },
      { title: "Agent Performance", icon: BarChart3 },
    ],
  },
  // {
  //   title: "Agency Management",
  //   icon: Home,
  //   children: [
  //     { title: "All Agencies", icon: Inbox },
  //     { title: "Add Agency", icon: Edit3 },
  //     { title: "Agency Reports", icon: BarChart3 },
  //   ],
  // },
  {
    title: "Products & Inventory",
    icon: Package,
    children: [
      { title: "Products", icon: Package },
      { title: "Categories", icon: Inbox },
      { title: "Brands", icon: Inbox },
      { title: "Inventory", icon: Archive },
      { title: "Low Stock Alerts", icon: BarChart3 },
      { title: "Minimum Checkout", icon: Settings },
    ],
  },
  {
    title: "Order Management",
    icon: Send,
    children: [
      { title: "All Orders", icon: Inbox },
      { title: "Cancelled Orders", icon: Archive },
      { title: "Processing Orders", icon: Settings },
      { title: "Delivered Orders", icon: FileText },
      { title: "Returns", icon: Archive },
    ],
  },
  {
    title: "Commission & Referrals",
    icon: DollarSign,
    children: [
      { title: "Commissions", icon: DollarSign },
      { title: "Referral Earnings", icon: TrendingUp },
      { title: "Referral Tracking", icon: BarChart3 },
      { title: "Payout Requests", icon: Send },
    ],
  },
  {
    title: "Marketing Tools",
    icon: MessageSquare,
    children: [
      { title: "Campaigns", icon: MessageSquare },
      { title: "Push Notifications", icon: Send },
      { title: "Email Marketing", icon: Inbox },
    ],
  },
  {
    title: "Support & Tickets",
    icon: MessageSquare,
    children: [
      { title: "All Tickets", icon: Inbox },
      { title: "Open Tickets", icon: Settings },
      { title: "Closed Tickets", icon: Archive },
    ],
  },
  {
    title: "Wallet & Finance",
    icon: DollarSign,
    children: [
      { title: "Wallet Overview", icon: DollarSign },
      { title: "Referral Settings", icon: Settings },
      { title: "Transactions", icon: FileText },
      { title: "Withdrawals", icon: Send },
    ],
  },
  {
    title: "Documents & KYC",
    icon: FileText,
    children: [
      { title: "Retailer KYC", icon: FileText },
      { title: "Agent KYC", icon: FileText },
      { title: "Pending Verifications", icon: Inbox },
    ],
  },

  {
    title: "Analytics",
    icon: BarChart3,
    children: [
      { title: "Sales Analytics", icon: TrendingUp },
      { title: "User Analytics", icon: BarChart3 },
      { title: "Traffic Reports", icon: Globe },
    ],
  },
  {
    title: "Notifications",
    icon: Inbox,
    children: [
      { title: "All Notifications", icon: Inbox },
      { title: "Send Notification", icon: Send },
    ],
  },
  {
    title: "Settings",
    icon: Settings,
    children: [
      { title: "Admin Security", icon: Settings },
      { title: "General Settings", icon: Settings },
      { title: "Roles & Permissions", icon: User },
      { title: "System Config", icon: Settings },
    ],
  },
];

// Helper: find parent that contains this child tab
const getParentForTab = (tabName) => {
  for (const item of items) {
    if (item.children?.some((c) => c.title === tabName)) return item.title;
  }
  return null;
};

export function AppSidebar({ collapsed = false }) {
  const [openItem, setOpenItem] = useState(null);
  const { setActiveTab, activeTab, getMyProfile } = useContextApi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isPrimaryAdmin, setIsPrimaryAdmin] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const profile = await getMyProfile();
        const email = String(profile?.email || "").trim().toLowerCase();
        const primaryAdminEmail = String(profile?.primaryAdminEmail || "").trim().toLowerCase();
        const isPrimary =
          !!profile?.isPrimaryAdmin ||
          (!!primaryAdminEmail && email === primaryAdminEmail) ||
          email === "kuremedi370@gmail.com";
        setIsPrimaryAdmin(isPrimary);
      } catch {
        setIsPrimaryAdmin(false);
      }
    };
    loadProfile();
  }, [getMyProfile]);

  // Auto-expand parent when activeTab is a child
  useEffect(() => {
    const parent = getParentForTab(activeTab);
    if (parent) setOpenItem(parent);
  }, [activeTab]);

  // Sync URL -> activeTab on mount and when URL changes
  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl) setActiveTab(tabFromUrl);
  }, [searchParams, setActiveTab]);

  const handleToggle = (title) => {
    setOpenItem(openItem === title ? null : title);
  };

  const handleTabClick = (tabName) => {
    setActiveTab(tabName);
    setSearchParams({ tab: tabName });
  };

  const isChildActive = (item) =>
    item.children?.some((c) => c.title === activeTab);
  const isParentOpen = (title) => openItem === title;

  return (
    <div className="relative shrink-0 w-0">
      <div
        className={`fixed top-16 left-0 h-[calc(100vh-4rem)] z-40 w-72 shadow-lg border-r border-gray-200 transition-all duration-300 bg-slate-900 overflow-y-auto ${collapsed ? "-translate-x-full" : "translate-x-0"
          }`}
        data-slot="sidebar"
      >
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="px-5 py-4 text-base font-semibold text-white bg-slate-800/80">
              Dashboard
            </SidebarGroupLabel>

            <SidebarGroupContent className="px-2 pb-4">
              <SidebarMenu className="space-y-0.5">
                {items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    {item.children ? (
                      <>
                        <SidebarMenuButton
                          onClick={() => handleToggle(item.title)}
                          className={`cursor-pointer flex justify-between items-center gap-2 px-3 py-2.5 rounded-lg transition-all duration-200 min-w-0 ${isChildActive(item)
                            ? "bg-blue-600/90 text-white"
                            : "text-slate-300 hover:bg-slate-700/80 hover:text-white"
                            }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <item.icon className="w-5 h-5 shrink-0" />
                            <span className="text-sm font-medium truncate">
                              {item.title}
                            </span>
                          </div>
                          {isParentOpen(item.title) ? (
                            <ChevronDown className="w-4 h-4 shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 shrink-0" />
                          )}
                        </SidebarMenuButton>

                        <div
                          className={`overflow-hidden transition-all duration-300 ease-out ${isParentOpen(item.title)
                            ? "max-h-125 opacity-100"
                            : "max-h-0 opacity-0"
                            }`}
                        >
                          <div className="mt-1 ml-4 pl-4 border-l border-slate-600/50 space-y-0.5 py-1">
                            {item.children
                              .filter((child) => {
                                if (item.title === "Settings" && child.title === "Admin Security") {
                                  return isPrimaryAdmin;
                                }
                                return true;
                              })
                              .map((child) => (
                              <button
                                key={child.title}
                                type="button"
                                onClick={() => handleTabClick(child.title)}
                                className={`w-full flex items-center gap-2 min-w-0 text-sm px-3 py-2 rounded-md transition-all duration-200 cursor-pointer ${activeTab === child.title
                                  ? "bg-blue-600 text-white shadow-sm"
                                  : "text-slate-400 hover:bg-slate-700/60 hover:text-white"
                                  }`}
                              >
                                <child.icon className="w-4 h-4 shrink-0" />
                                <span className="truncate min-w-0">{child.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleTabClick(item.route || item.title)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer ${activeTab === (item.route || item.title)
                          ? "bg-blue-600/90 text-white"
                          : "text-slate-300 hover:bg-slate-700/80 hover:text-white"
                          }`}
                      >
                        <item.icon className="w-5 h-5 shrink-0" />
                        <span className="text-sm font-medium truncate">
                          {item.title}
                        </span>
                      </button>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </div>
    </div>
  );
}
