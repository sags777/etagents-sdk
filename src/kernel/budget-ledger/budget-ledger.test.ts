import { describe, it, expect, vi } from "vitest";
import { BudgetLedger } from "./budget-ledger.js";

function usage(total: number) {
  return { prompt: 0, completion: total, total };
}

describe("BudgetLedger", () => {
  describe("add / state", () => {
    it("starts at zero", () => {
      const ledger = new BudgetLedger();
      expect(ledger.state()).toEqual({ prompt: 0, completion: 0, total: 0 });
    });

    it("accumulates multiple add() calls", () => {
      const ledger = new BudgetLedger();
      ledger.add({ prompt: 10, completion: 20, total: 30 });
      ledger.add({ prompt: 5, completion: 15, total: 20 });
      expect(ledger.state()).toEqual({ prompt: 15, completion: 35, total: 50 });
    });
  });

  describe("isExceeded", () => {
    it("returns false when total is below limit", () => {
      const ledger = new BudgetLedger();
      ledger.add(usage(80));
      expect(ledger.isExceeded(100)).toBe(false);
    });

    it("returns true when total equals limit", () => {
      const ledger = new BudgetLedger();
      ledger.add(usage(100));
      expect(ledger.isExceeded(100)).toBe(true);
    });

    it("returns true when total exceeds limit", () => {
      const ledger = new BudgetLedger();
      ledger.add(usage(150));
      expect(ledger.isExceeded(100)).toBe(true);
    });
  });

  describe("isWarning", () => {
    it("returns false when total is below warn threshold", () => {
      const ledger = new BudgetLedger();
      ledger.add(usage(70));
      expect(ledger.isWarning(100, 0.8)).toBe(false);
    });

    it("returns true when total is exactly at warn threshold (80%)", () => {
      const ledger = new BudgetLedger();
      ledger.add(usage(80));
      expect(ledger.isWarning(100, 0.8)).toBe(true);
    });

    it("returns true when total is between warn threshold and limit", () => {
      const ledger = new BudgetLedger();
      ledger.add(usage(90));
      expect(ledger.isWarning(100, 0.8)).toBe(true);
    });

    it("returns false when total has reached the limit (exceeded, not warning)", () => {
      const ledger = new BudgetLedger();
      ledger.add(usage(100));
      expect(ledger.isWarning(100, 0.8)).toBe(false);
    });
  });

  describe("checkAndEmit", () => {
    it("fires warning event when total crosses 80% of limit", () => {
      const cb = vi.fn();
      const ledger = new BudgetLedger(cb);
      ledger.add(usage(80));
      ledger.checkAndEmit(100);
      expect(cb).toHaveBeenCalledOnce();
      expect(cb.mock.calls[0][0]).toMatchObject({ kind: "warning" });
    });

    it("fires exceeded event when total reaches 100% of limit", () => {
      const cb = vi.fn();
      const ledger = new BudgetLedger(cb);
      ledger.add(usage(100));
      ledger.checkAndEmit(100);
      expect(cb).toHaveBeenCalledOnce();
      expect(cb.mock.calls[0][0]).toMatchObject({ kind: "exceeded" });
    });

    it("does not fire when total is below warn threshold", () => {
      const cb = vi.fn();
      const ledger = new BudgetLedger(cb);
      ledger.add(usage(50));
      ledger.checkAndEmit(100);
      expect(cb).not.toHaveBeenCalled();
    });

    it("is a no-op when no callback is provided", () => {
      const ledger = new BudgetLedger();
      ledger.add(usage(100));
      expect(() => ledger.checkAndEmit(100)).not.toThrow();
    });

    it("event state matches current ledger state", () => {
      const cb = vi.fn();
      const ledger = new BudgetLedger(cb);
      ledger.add({ prompt: 10, completion: 90, total: 100 });
      ledger.checkAndEmit(100);
      expect(cb.mock.calls[0][0].state).toEqual({ prompt: 10, completion: 90, total: 100 });
    });

    it("fires exceeded (not warning) when total exceeds limit", () => {
      const cb = vi.fn();
      const ledger = new BudgetLedger(cb);
      ledger.add(usage(120));
      ledger.checkAndEmit(100);
      expect(cb.mock.calls[0][0]).toMatchObject({ kind: "exceeded" });
    });
  });
});
