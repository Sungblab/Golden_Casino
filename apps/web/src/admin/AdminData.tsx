import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AdminCashRequest, AdminOverview } from "@golden/contracts";
import { getAdminCashRequests, getAdminOverview } from "../api";

type AdminDataValue = {
  token: string;
  overview: AdminOverview | null;
  cashRequests: AdminCashRequest[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const AdminDataContext = createContext<AdminDataValue | null>(null);

export function AdminDataProvider({ token, children }: { token: string; children: ReactNode }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [cashRequests, setCashRequests] = useState<AdminCashRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextOverview, nextRequests] = await Promise.all([getAdminOverview(token), getAdminCashRequests(token)]);
      setOverview(nextOverview);
      setCashRequests(nextRequests);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "관리자 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return <AdminDataContext.Provider value={{ token, overview, cashRequests, loading, error, refresh }}>{children}</AdminDataContext.Provider>;
}

export function useAdminData(): AdminDataValue {
  const value = useContext(AdminDataContext);
  if (!value) throw new Error("useAdminData must be used inside AdminDataProvider");
  return value;
}
