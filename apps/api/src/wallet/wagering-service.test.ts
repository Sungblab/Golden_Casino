import { describe, expect, it } from "vitest";
import { progressAfterDeposit, progressAfterWager } from "./wagering-service.js";

describe("100 percent wagering requirement", () => {
  it("creates a one-times requirement for a newly approved deposit", () => {
    expect(progressAfterDeposit({ requiredMinor: 0, completedMinor: 0, remainingMinor: 0 }, 10_000)).toEqual({
      requiredMinor: 10_000,
      completedMinor: 0,
      remainingMinor: 10_000,
    });
  });

  it("adds another deposit to an unfinished cycle", () => {
    expect(progressAfterDeposit({ requiredMinor: 10_000, completedMinor: 4_000, remainingMinor: 6_000 }, 5_000)).toEqual({
      requiredMinor: 15_000,
      completedMinor: 4_000,
      remainingMinor: 11_000,
    });
  });

  it("never carries excess wagering into the next deposit", () => {
    const completed = progressAfterWager({ requiredMinor: 10_000, completedMinor: 8_000, remainingMinor: 2_000 }, 5_000);
    expect(completed).toEqual({ requiredMinor: 10_000, completedMinor: 10_000, remainingMinor: 0 });
    expect(progressAfterDeposit(completed, 3_000)).toEqual({ requiredMinor: 3_000, completedMinor: 0, remainingMinor: 3_000 });
  });
});
