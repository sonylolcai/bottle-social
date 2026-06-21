import { describe, expect, it } from "vitest";
import {
  canDeliverBottle,
  canPullDelivery,
  canStoreReply,
} from "../src/state-machine";

describe("state machine", () => {
  it("only delivers approved bottles", () => {
    expect(canDeliverBottle("approved")).toBe(true);
    expect(canDeliverBottle("rejected")).toBe(false);
    expect(canDeliverBottle("delivered")).toBe(false);
    expect(canDeliverBottle("expired")).toBe(false);
  });

  it("only pulls available deliveries", () => {
    expect(canPullDelivery("available")).toBe(true);
    expect(canPullDelivery("pulled")).toBe(false);
    expect(canPullDelivery("expired")).toBe(false);
    expect(canPullDelivery("reported")).toBe(false);
  });

  it("only stores replies for pulled deliveries", () => {
    expect(canStoreReply("available")).toBe(false);
    expect(canStoreReply("pulled")).toBe(true);
    expect(canStoreReply("expired")).toBe(false);
    expect(canStoreReply("reported")).toBe(false);
  });
});
