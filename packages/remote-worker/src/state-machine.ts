export type BottleStatus = "rejected" | "approved" | "delivered" | "expired";
export type DeliveryStatus = "available" | "pulled" | "expired" | "reported";

export function canDeliverBottle(status: BottleStatus): boolean {
  return status === "approved";
}

export function canPullDelivery(status: DeliveryStatus): boolean {
  return status === "available";
}

export function canStoreReply(deliveryStatus: DeliveryStatus): boolean {
  return deliveryStatus === "pulled";
}
