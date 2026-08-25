import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { PublicAuthUser } from "@golden/contracts";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { LobbyPage } from "./pages/LobbyPage";
import { BaccaratRoomPage } from "./pages/BaccaratRoomPage";
import { BlackjackRoomPage } from "./pages/BlackjackRoomPage";
import { DragonTigerRoomPage } from "./pages/DragonTigerRoomPage";
import { HoldemRoomPage } from "./pages/HoldemRoomPage";
import { WalletPage } from "./pages/WalletPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AdminApp } from "./admin/AdminShell";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminCashPage } from "./pages/AdminCashPage";
import { AdminSupportPage } from "./pages/AdminSupportPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminGamesPage } from "./pages/AdminGamesPage";
import { AdminStatsPage } from "./pages/AdminStatsPage";
import { SupportPage } from "./pages/SupportPage";
import { logoutServer, refreshAccessToken } from "./api";

/** Access tokens expire after 30 minutes; rotate the httpOnly refresh cookie well before that. */
const REFRESH_INTERVAL_MS = 20 * 60 * 1_000;

const TOKEN_KEY = "golden.accessToken";
const USER_KEY = "golden.user";

function readUser(): PublicAuthUser | null {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PublicAuthUser;
  } catch {
    return null;
  }
}

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<PublicAuthUser | null>(() => readUser());
  const authenticate = (nextToken: string, nextUser: PublicAuthUser) => {
    sessionStorage.setItem(TOKEN_KEY, nextToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  };
  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    void logoutServer();
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => logout();
    window.addEventListener("golden:session-expired", handleSessionExpired);
    return () => window.removeEventListener("golden:session-expired", handleSessionExpired);
  }, [logout]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(() => {
      refreshAccessToken()
        .then((result) => authenticate(result.token, result.user))
        .catch(() => logout());
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [logout, token]);

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/lobby" replace /> : <LoginPage onLogin={authenticate} />} />
      <Route path="/signup" element={token ? <Navigate to="/lobby" replace /> : <SignupPage />} />
      <Route path="/lobby" element={token ? <LobbyPage token={token} user={user} onLogout={logout} /> : <Navigate to="/login" replace />} />
      <Route path="/wallet" element={token ? <WalletPage token={token} onLogout={logout} /> : <Navigate to="/login" replace />} />
      <Route path="/profile" element={token ? <ProfilePage token={token} onLogout={logout} /> : <Navigate to="/login" replace />} />
      <Route path="/support" element={token && user?.role !== "admin" ? <SupportPage token={token} onLogout={logout} /> : token ? <Navigate to="/admin" replace /> : <Navigate to="/login" replace />} />
      <Route path="/admin" element={token && user?.role === "admin" ? <AdminApp token={token} onLogout={logout} /> : token ? <Navigate to="/lobby" replace /> : <Navigate to="/login" replace />}>
        <Route index element={<AdminDashboardPage />} />
        <Route path="cash" element={<AdminCashPage />} />
        <Route path="support" element={<AdminSupportPage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="games" element={<AdminGamesPage />} />
        <Route path="stats" element={<AdminStatsPage />} />
      </Route>
      <Route path="/rooms/blackjack/:roomId" element={token ? <BlackjackRoomPage token={token} onLogout={logout} /> : <Navigate to="/login" replace />} />
      <Route path="/rooms/dragon-tiger/:roomId" element={token ? <DragonTigerRoomPage token={token} onLogout={logout} /> : <Navigate to="/login" replace />} />
      <Route path="/rooms/holdem/:roomId" element={token ? <HoldemRoomPage token={token} onLogout={logout} /> : <Navigate to="/login" replace />} />
      <Route path="/rooms/:roomId" element={token ? <BaccaratRoomPage token={token} onLogout={logout} /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={token ? "/lobby" : "/login"} replace />} />
    </Routes>
  );
}
