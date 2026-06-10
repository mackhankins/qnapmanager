import { describe, it, expect } from "vitest";
import { formatBytes, ageDays, formatAge, formatStatus } from "./format";

// NOTE: The plan's test expectations ("82.1 GB", "9.3 MB") matched 1024-based (binary)
// division, but the formatter uses 1000-based (decimal) powers. Corrected expectations:
//   88_130_000_000 / 1e9 = 88.13 → rounds to 88.1 GB  (was "82.1 GB" in plan — wrong)
//   9_700_000 / 1e6       = 9.7  → rounds to 9.7 MB   (was "9.3 MB" in plan — wrong)

describe("formatBytes", () => {
  it("formats GB", () => expect(formatBytes(88_130_000_000)).toBe("88.1 GB"));
  it("formats MB", () => expect(formatBytes(9_700_000)).toBe("9.7 MB"));
  it("handles zero", () => expect(formatBytes(0)).toBe("0 B"));
});

describe("age", () => {
  it("computes whole days", () => {
    const now = new Date("2025-03-01T00:00:00Z").getTime();
    expect(ageDays("2025-02-01T00:00:00Z", now)).toBe(28);
  });
  it("formats null added as dash", () => expect(formatAge(null, Date.now())).toBe("—"));
  it("formats day count", () => {
    const now = new Date("2025-03-01T00:00:00Z").getTime();
    expect(formatAge("2025-02-01T00:00:00Z", now)).toBe("28d");
  });
});

describe("formatStatus", () => {
  it("maps known statuses to friendly labels", () => {
    expect(formatStatus("ended")).toBe("Ended");
    expect(formatStatus("inCinemas")).toBe("In Cinemas");
  });
  it("dashes a null status", () => expect(formatStatus(null)).toBe("—"));
  it("falls back to the raw value when unknown", () => expect(formatStatus("weird")).toBe("weird"));
});
