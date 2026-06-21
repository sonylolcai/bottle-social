export type CachedBottleContext = {
  deliveryId: string;
  bottleId: string;
  senderId: string;
  content: string;
  receivedAt: string;
  expiresAt: string;
};

export class LocalCache {
  private readonly bottles = new Map<string, CachedBottleContext>();

  saveBottle(context: CachedBottleContext): void {
    this.bottles.set(context.deliveryId, context);
  }

  getBottle(deliveryId: string): CachedBottleContext | undefined {
    return this.bottles.get(deliveryId);
  }

  listBottles(): CachedBottleContext[] {
    return [...this.bottles.values()];
  }
}
