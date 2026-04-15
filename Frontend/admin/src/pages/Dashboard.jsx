import React, { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "../components/app-sidebar";
import Navbar from "../components/Navbar";
import DashboardHome from "../components/DashboardHome";
import SettingsPage from "../components/settings/SettingsPage";
import Categories from "../components/Categories";
import Inventory from "../components/Inventory";
import Overview from "../components/Analytics/Overview";
import Traffic from "../components/Analytics/Traffic";
import Revenue from "../components/Analytics/Revenue";
import { useContextApi } from "../hooks/useContextApi";
import { useSearchParams } from "react-router-dom";
import AllRetaialer from "../components/AllRetaialer";
import PendingApprovals from "../components/PendingApprovals";
import LicenseExpire from "../components/LicenseExpire";
import RejectedRetailers from "../components/RejectedRetailers";
import KycHistory from "../components/KycHistory";
import Products from "../components/Products";
import AllAgencies from "../components/AgencyManagement/AllAgencies";
import Orders from "../components/OrderManagement/Orders";
import PlaceholderPage from "../components/PlaceholderPage";
import AgencyReport from "../components/AgencyManagement/AgencyReport";
import Brands from "../components/Brands";
import AddAgent from "../components/AgentManagement/AddAgent";
import AgentPerformace from "../components/AgentManagement/AgentPerformace";
import AddAgency from "../components/AgencyManagement/AddAgency";
import OpenTickets from "../components/SupportandTickets/OpenTickets";
import AllTickets from "../components/SupportandTickets/AllTickets";
import ClosedTickets from "../components/SupportandTickets/ClosedTickets";
import Commissons from "../components/CommisionandReferral/Commissons";
import ReferralEarnings from "../components/CommisionandReferral/ReferralEarnings";
import PayoutRequests from "../components/CommisionandReferral/PayoutRequests";
import Campaigns from "../components/MarketingandTools/Campaigns";
import PushNotifications from "../components/MarketingandTools/PushNotifications";
import EmailMarketing from "../components/MarketingandTools/EmailMarketing";
import SystemConfig from "../components/settings/SystemConfig";
import RolesPermissions from "../components/settings/RolesPermissions";
import AllNotifications from "../components/Notifications/AllNotifications";
import SendNotification from "../components/Notifications/SendNotification";
import RetailerKYC from "../components/DocumentandKYC/RetailerKYC";
import AgentKYC from "../components/DocumentandKYC/AgentKYC";
import PendingVerifications from "../components/DocumentandKYC/PendingVerifications";
import Payments from "../components/WalletandFinance/Payments";
import WalletOverview from "../components/WalletandFinance/WalletOverview";
import ReferralSettings from "../components/WalletandFinance/ReferralSettings";
import Withdrawals from "../components/WalletandFinance/Withdrawals";
import ProcessingOrders from "../components/OrderManagement/ProcessingOrders";
import DeliveredOrders from "../components/OrderManagement/DeliveredOrders";
import Returns from "../components/OrderManagement/Returns";
import OrderDetail from "../components/OrderManagement/OrderDetail";
import AllAgents from "../components/AgentManagement/AllAgents";
import ReferralTracking from "../components/AgentManagement/ReferralTracking";
import LowStockAlerts from "../components/LowStockAlerts";

const SIDEBAR_WIDTH = 288; // 18rem = 288px (w-72)

const Dashboard = () => {
  const { activeTab, setActiveTab, getMyProfile } = useContextApi();
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  // Sync URL -> activeTab on mount and when URL changes
  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl) {
      if (tabFromUrl === "Admin Security" && !isPrimaryAdmin) {
        setActiveTab("General Settings");
      } else {
        setActiveTab(tabFromUrl);
      }
    }
  }, [searchParams, setActiveTab, isPrimaryAdmin]);

  // Keep URL in sync with activeTab whenever activeTab changes
  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (activeTab && activeTab !== "Home" && activeTab !== tabFromUrl) {
      setSearchParams({ tab: activeTab });
    } else if (activeTab === "Home" && tabFromUrl) {
      // Clear search params if tab is Home (default)
      setSearchParams({});
    }
  }, [activeTab, setSearchParams, searchParams]);

  const renderPage = () => {
    switch (activeTab) {
      case "Home":
        return <DashboardHome />;

      case "Referral Earnings":
        return <ReferralEarnings />;
      case "Referral Tracking":
        return <ReferralTracking />;
      case "Processing Orders":
        return <ProcessingOrders />;
      case "All Notifications":
        return <AllNotifications />;
      case "Send Notification":
        return <SendNotification />;
      case "Email Marketing":
        return <EmailMarketing />;
      case "Retailer KYC":
        return <RetailerKYC />;
      case "Agent KYC":
        return <AgentKYC />;
      case "Pending Verifications":
        return <PendingVerifications />;
      case "Wallet Overview":
        return <WalletOverview />;
      case "Referral Settings":
        return <ReferralSettings />;
      case "Returns":
        return <Returns />;
      case "All Agents":
        return <AllAgents />;
      case "Agent Performance":
        return <AgentPerformace />;
      case "Roles & Permissions":
        return <RolesPermissions />;
      case "Push Notifications":
        return <PushNotifications />;
      case "All Retailers":
        return <AllRetaialer />;
      case "Pending Approvals":
        return <PendingApprovals />;
      case "License Expire":
        return <LicenseExpire />;
      case "Rejected Retailers":
        return <RejectedRetailers />;
      case "KYC History":
        return <KycHistory />;
      case "All Tickets":
        return <AllTickets />;
      case "Payout Requests":
        return <PayoutRequests />;
      case "Campaigns":
        return <Campaigns />;
      case "Open Tickets":
        return <OpenTickets />;
      case "Closed Tickets":
        return <ClosedTickets />;
      case "All Agencies":
        return <AllAgencies />;
      case "Add Agent":
        return <AddAgent />;
      case "Add Agency":
        return <AddAgency />;
      case "Agency Reports":
        return <AgencyReport />;
      case "Products":
        return <Products />;
      case "Categories":
        return <Categories />;
      case "Brands":
        return <Brands />;
      case "Inventory":
        return <Inventory />;
      case "Low Stock Alerts":
        return <LowStockAlerts />;
      case "Minimum Checkout":
        return <SystemConfig />;
      case "System Config":
        return <SystemConfig />;
      case "All Orders":
        return <Orders />;
      case "Withdrawals":
        return <Withdrawals />;
      case "Transactions":
        return <Payments />;
      case "Commissions":
        return <Commissons />;
      case "Sales Analytics":
        return <Revenue />;
      case "User Analytics":
        return <Overview />;
      case "Traffic Reports":
        return <Traffic />;
      case "General Settings":
        return <SystemConfig />;
      case "Admin Security":
        return isPrimaryAdmin ? <SettingsPage /> : <PlaceholderPage title="Access Denied" />;
      case "Delivered Orders":
        return <DeliveredOrders />;
      case "Order Detail":
        return <OrderDetail />;
      default:
        return <PlaceholderPage title={activeTab || "Dashboard"} />;
    }
  };

  return (
    <>
      <Navbar />
      <div className="flex w-full min-h-screen pt-16">
        <AppSidebar collapsed={!sidebarOpen} />

        <button
          type="button"
          onClick={() => setSidebarOpen((prev) => !prev)}
          className="fixed top-20 z-30 flex h-8 w-6 items-center justify-center rounded-r-md border border-l-0 border-gray-200 bg-white shadow-sm transition-all duration-300 hover:bg-gray-50"
          style={{
            left: sidebarOpen ? SIDEBAR_WIDTH : 0,
            top: "4.5rem",
          }}
          aria-label="Toggle sidebar"
        >
          <SidebarTrigger />
        </button>

        <main
          className="flex-1 min-w-0 w-full overflow-auto transition-all duration-300"
          style={{ marginLeft: sidebarOpen ? SIDEBAR_WIDTH : 0 }}
        >
          <div className="w-full min-h-[calc(100vh-4rem)] bg-gray-50/50 p-6">
            <div className="w-full rounded-xl bg-white p-6 shadow-sm">
              {renderPage()}
            </div>
          </div>
        </main>
      </div>
    </>
  );
};
export default Dashboard;
