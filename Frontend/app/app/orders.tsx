import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getMyOrders, getOrderTracking } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";
import { SkeletonList } from "@/src/components/Skeleton";

const STATUS_STEPS = [
  { key: "PLACED", label: "Order Placed", icon: "receipt-outline" as const },
  { key: "CONFIRMED", label: "Confirmed", icon: "checkmark-done-outline" as const },
  { key: "DISPATCHED", label: "Shipped", icon: "boat-outline" as const },
  { key: "DELIVERED", label: "Delivered", icon: "checkmark-circle" as const },
];

const STATUS_ORDER = ["PLACED", "CONFIRMED", "DISPATCHED", "DELIVERED", "CANCELLED"];

function getStepIndex(status: string): number {
  const raw = (status || "PLACED").toUpperCase();
  const s = raw === "PENDING" ? "PLACED" : raw;
  if (s === "CANCELLED") return -1;
  const i = STATUS_ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}

function OrderStatusTimeline({ status }: { status: string }) {
  const currentIndex = getStepIndex(status);
  const statusUpper = (status || "PLACED").toUpperCase();
  const isCancelled = statusUpper === "CANCELLED";

  if (isCancelled) {
    return (
      <View className="flex-row items-center gap-2 mt-2">
        <View className="w-6 h-6 rounded-full bg-red-100 items-center justify-center">
          <Ionicons name="close" size={14} color="#dc2626" />
        </View>
        <Text className="text-red-600 font-medium text-sm">Cancelled</Text>
      </View>
    );
  }

  return (
    <View className="mt-3 flex-row justify-between">
      {STATUS_STEPS.map((step, index) => {
        const stepOrderIndex = STATUS_ORDER.indexOf(step.key);
        const isDone = currentIndex > stepOrderIndex || (step.key === "DELIVERED" && statusUpper === "DELIVERED");
        const isCurrent = statusUpper === step.key;
        return (
          <View key={step.key} className="items-center flex-1">
            <View
              className={`w-8 h-8 rounded-full items-center justify-center ${
                isDone ? "bg-teal-600" : isCurrent ? "bg-teal-500" : "bg-gray-200"
              }`}
            >
              <Ionicons
                name={isDone ? "checkmark" : step.icon}
                size={isDone ? 16 : 14}
                color={isDone || isCurrent ? "#fff" : "#9ca3af"}
              />
            </View>
            <Text
              className={`text-[10px] mt-1 text-center max-w-[60px] ${
                isCurrent ? "text-teal-600 font-semibold" : isDone ? "text-teal-600" : "text-gray-400"
              }`}
              numberOfLines={2}
            >
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const [orders, setOrders] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [trackingData, setTrackingData] = useState<{
    order?: Record<string, unknown>;
    tracking?: Record<string, unknown>;
  } | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);

  const fetchOrders = useCallback(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    getMyOrders()
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchOrders();
  }, [isAuthenticated, fetchOrders]);

  const openTracking = (orderId: string) => {
    setTrackingOrderId(orderId);
    setTrackingData(null);
    setTrackingLoading(true);
    getOrderTracking(orderId)
      .then((data) => setTrackingData(data as { order?: Record<string, unknown>; tracking?: Record<string, unknown> }))
      .catch(() => setTrackingData({}))
      .finally(() => setTrackingLoading(false));
  };

  const closeTrackingModal = () => {
    setTrackingOrderId(null);
    setTrackingData(null);
  };

  if (!isAuthenticated) {
    return (
      <View
        style={{ paddingTop: insets.top }}
        className="flex-1 bg-[#f8faf8] items-center justify-center px-4"
      >
        <Text className="text-gray-500 mb-4">Please login to view orders</Text>
        <Pressable
          onPress={() => router.replace("/login")}
          className="bg-teal-600 px-6 py-3 rounded-xl"
        >
          <Text className="text-white font-semibold">Login</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ paddingTop: insets.top }} className="flex-1 bg-[#f8faf8]">
      <View className="flex-row items-center px-4 py-3 bg-white border-b border-gray-200">
        <Pressable onPress={() => router.back()} hitSlop={12} className="p-1">
          <Ionicons name="chevron-back" size={28} color="#111" />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold text-black text-center -ml-6">
          My Orders
        </Text>
        <Pressable onPress={fetchOrders} disabled={loading} className="p-1">
          <Ionicons name="refresh" size={24} color={loading ? "#9ca3af" : "#0d9488"} />
        </Pressable>
      </View>

      {loading ? (
        <SkeletonList count={6} hasImage />
      ) : orders.length === 0 ? (
        <View className="flex-1 items-center justify-center px-4">
          <View className="w-20 h-20 rounded-full bg-gray-100 items-center justify-center mb-4">
            <Ionicons name="receipt-outline" size={40} color="#9ca3af" />
          </View>
          <Text className="text-lg font-semibold text-gray-700">No orders yet</Text>
          <Text className="text-gray-500 mt-2 text-center">
            Your orders will appear here once you place them.
          </Text>
          <Pressable
            onPress={() => router.replace("/(tabs)")}
            className="mt-6 bg-teal-600 px-6 py-3 rounded-xl"
          >
            <Text className="text-white font-semibold">Continue Shopping</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={orders as { _id?: string }[]}
          keyExtractor={(item: { _id?: string }) => String(item?._id ?? Math.random())}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
          }}
          renderItem={({ item }: { item: Record<string, unknown> }) => {
            const status = (item.status as string) || "PLACED";
            const hasTracking = !!(item.trackingUrl || (item as Record<string, unknown>).shiprocketAwb);
            const isDispatched =
              (status as string).toUpperCase() === "DISPATCHED" ||
              (status as string).toUpperCase() === "DELIVERED";
            
            // Refund window info
            const daysRemaining = (item.daysRemainingForRefund as number) ?? 0;
            const refundWindowActive = (item.refundWindowActive as boolean) ?? false;
            const refundDeadlineDate = item.refundDeadline ? new Date(String(item.refundDeadline)) : null;
            
            // Refund timeline info
            const isCancelled = (status as string).toUpperCase() === "CANCELLED";
            const refundStatus = (item.refundStatus as string) || "none";
            const paymentStatus = (item.paymentStatus as string) || "unpaid";
            const isPaid = ["paid", "refund_pending", "refunded"].includes(paymentStatus.toLowerCase());
            const estimatedCompletionDate = item.refundEstimatedCompletionDate ? new Date(String(item.refundEstimatedCompletionDate)) : null;

            return (
              <View className="bg-white rounded-2xl p-4 mb-3 border border-gray-200">
                <View className="flex-row justify-between items-start">
                  <Text className="text-sm font-medium text-gray-500">
                    Order #{String(item._id ?? "").slice(-8).toUpperCase()}
                  </Text>
                  <Text className="text-sm font-semibold text-teal-600">
                    ₹{Number(item.payableAmount ?? item.totalAmount ?? 0)}
                  </Text>
                </View>
                <Text className="text-xs text-gray-400 mt-1">
                  {item.createdAt
                    ? new Date(String(item.createdAt)).toLocaleDateString()
                    : ""}
                </Text>

                <OrderStatusTimeline status={status} />
                
                {/* Refund Timeline Information */}
                {isCancelled && isPaid ? (
                  <View className="mt-3 p-3 rounded-lg border">
                    {refundStatus === "completed" ? (
                      <View className="bg-emerald-50 border-emerald-200">
                        <View className="flex-row items-center gap-2 mb-1">
                          <Ionicons name="checkmark-circle" size={16} color="#059669" />
                          <Text className="text-xs font-semibold text-emerald-900">
                            Refunded
                          </Text>
                        </View>
                        <Text className="text-xs text-emerald-700 ml-6">
                          Amount credited to your {item.paymentMethod === "ONLINE" ? "bank account" : "wallet"}
                        </Text>
                      </View>
                    ) : refundStatus === "failed" ? (
                      <View className="bg-red-50 border-red-200">
                        <View className="flex-row items-center gap-2 mb-1">
                          <Ionicons name="alert-circle" size={16} color="#dc2626" />
                          <Text className="text-xs font-semibold text-red-900">
                            Refund Failed
                          </Text>
                        </View>
                        <Text className="text-xs text-red-700 ml-6">
                          {item.refundFailureReason || "Unable to process. Contact support."}
                        </Text>
                      </View>
                    ) : refundStatus === "processing" ? (
                      <View className="bg-blue-50 border-blue-200">
                        <View className="flex-row items-center gap-2 mb-1">
                          <Ionicons name="hourglass" size={16} color="#0369a1" />
                          <Text className="text-xs font-semibold text-blue-900">
                            Refund Processing
                          </Text>
                        </View>
                        <Text className="text-xs text-blue-700 ml-6">
                          Estimated completion: {estimatedCompletionDate?.toLocaleDateString()}
                        </Text>
                      </View>
                    ) : (
                      <View className="bg-amber-50 border-amber-200">
                        <View className="flex-row items-center gap-2 mb-1">
                          <Ionicons name="time" size={16} color="#b45309" />
                          <Text className="text-xs font-semibold text-amber-900">
                            Refund in Process
                          </Text>
                        </View>
                        <Text className="text-xs text-amber-700 ml-6">
                          Takes 3–5 working days. Amount will be credited to your {item.paymentMethod === "ONLINE" ? "bank account" : "wallet"} within 5–7 working days.
                        </Text>
                      </View>
                    )}
                  </View>
                ) : refundWindowActive && !isCancelled ? (
                  <View className="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <View className="flex-row items-center gap-2 mb-1">
                      <Ionicons name="time-outline" size={16} color="#0369a1" />
                      <Text className="text-xs font-semibold text-blue-900">
                        {daysRemaining === 0 ? "Last day for refund" : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} left for refund`}
                      </Text>
                    </View>
                    {refundDeadlineDate && (
                      <Text className="text-xs text-blue-800 ml-6">
                        via Razorpay until {refundDeadlineDate.toLocaleDateString()}
                      </Text>
                    )}
                  </View>
                ) : null}

                {isDispatched && hasTracking && (
                  <Pressable
                    onPress={() => openTracking(String(item._id))}
                    className="mt-3 flex-row items-center justify-center gap-2 py-2 rounded-xl bg-teal-50 border border-teal-200"
                  >
                    <Ionicons name="locate" size={18} color="#0d9488" />
                    <Text className="text-teal-700 font-semibold text-sm">Track order</Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal visible={!!trackingOrderId} transparent animationType="slide">
        <Pressable
          onPress={closeTrackingModal}
          className="flex-1 bg-black/50 justify-end"
        >
          <Pressable onPress={(e) => e.stopPropagation()} className="bg-white rounded-t-3xl max-h-[80%]">
            <View className="p-4 border-b border-gray-200 flex-row justify-between items-center">
              <Text className="text-lg font-semibold">Where is my order?</Text>
              <Pressable onPress={closeTrackingModal}>
                <Ionicons name="close" size={24} color="#374151" />
              </Pressable>
            </View>
            <ScrollView className="p-4">
              {trackingLoading ? (
                <View className="py-8 items-center">
                  <ActivityIndicator size="large" color="#0d9488" />
                  <Text className="mt-2 text-gray-500">Loading tracking...</Text>
                </View>
              ) : trackingData?.tracking ? (
                <View>
                  {(() => {
                    const td = (trackingData.tracking as Record<string, unknown>)?.tracking_data as Record<string, unknown> | undefined;
                    const activities = td?.shipment_track_activities as { date?: string; status?: string; activity?: string }[] | undefined;
                    return activities?.length ? (
                      <View className="space-y-2">
                        <Text className="text-sm font-semibold text-gray-700 mb-2">Live status</Text>
                        {activities.map((act, i) => (
                          <View key={i} className="flex-row gap-3 pb-3 border-b border-gray-100">
                            <View className="w-2 h-2 rounded-full bg-teal-500 mt-1.5" />
                            <View className="flex-1">
                              <Text className="text-gray-800 font-medium">{act.status ?? act.activity ?? "Update"}</Text>
                              <Text className="text-xs text-gray-500">{act.date ?? ""}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text className="text-gray-500 py-4">No scan updates yet. Status will appear here soon.</Text>
                    );
                  })()}
                </View>
              ) : (
                <Text className="text-gray-500 py-4">Tracking details will appear once available.</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
