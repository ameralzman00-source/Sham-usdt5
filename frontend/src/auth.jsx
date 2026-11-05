import React, { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";

const AuthCtx = createContext(null);

const FALLBACK_BOT = "EntrepreneurMA_bot";

function telegramWebApp() {
  return (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) || null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [insideTelegram, setInsideTelegram] = useState(false);
  const [authError, setAuthError] = useState("");
  const [tgInitData, setTgInitData] = useState("");
  const [needsTelegramChoice, setNeedsTelegramChoice] = useState(false);

  async function refresh() {
    if (!getToken()) {
      setUser(null);
      setReady(true);
      return null;
    }
    try {
      const data = await api("/api/me");
      setUser(data.user);
      return data.user;
    } catch (ex) {
      if (ex && (ex.status === 401 || ex.status === 403)) {
        setToken("");
        setUser(null);
      }
      return null;
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    const tg = telegramWebApp();
    if (tg) {
      try {
        document.documentElement.classList.add("tg-app");
        document.body.classList.add("tg-app");
        tg.ready();
        tg.expand();
        if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
        if (tg.setHeaderColor) tg.setHeaderColor("#06080b");
        if (tg.setBackgroundColor) tg.setBackgroundColor("#06080b");
      } catch {
        /* ignore */
      }
    }

    function waitInitData(maxMs) {
      return new Promise((resolve) => {
        const start = Date.now();
        function tick() {
          const current = telegramWebApp();
          const data = current && current.initData ? current.initData : "";
          if (data || Date.now() - start >= maxMs) {
            resolve(data);
            return;
          }
          setTimeout(tick, 50);
        }
        tick();
      });
    }

    async function boot() {
      const initData = await waitInitData(tg ? 1500 : 0);
      setInsideTelegram(!!initData);
      setTgInitData(initData || "");
      if (initData) {
        if (getToken()) {
          try {
            const linked = await api("/api/auth/telegram-link", {
              method: "POST",
              body: JSON.stringify({ initData })
            });
            setToken(linked.token);
            setUser(linked.user);
            setAuthError("");
            setNeedsTelegramChoice(false);
            setReady(true);
            return;
          } catch {
            /* fall through to telegram status */
          }
        }
        try {
          const status = await api("/api/auth/telegram", {
            method: "POST",
            body: JSON.stringify({ initData, action: "status" })
          });
          if (getToken()) {
            const existing = await refresh();
            if (existing) {
              setNeedsTelegramChoice(!existing.telegramId);
              setReady(true);
              return;
            }
          }
          if (status.linked) {
            const data = await api("/api/auth/telegram", {
              method: "POST",
              body: JSON.stringify({ initData, action: "auto" })
            });
            setToken(data.token);
            setUser(data.user);
            setAuthError("");
            setNeedsTelegramChoice(false);
            setReady(true);
            return;
          }
          setNeedsTelegramChoice(true);
          setReady(true);
          return;
        } catch (ex) {
          setAuthError(ex.message || "تعذر تسجيل الدخول عبر تلغرام");
        }
      }
      if (getToken()) {
        const existing = await refresh();
        if (existing) return;
      }
      setUser(null);
      setReady(true);
    }
    boot();
  }, []);

  async function loginWithPassword(username, password, mode) {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, mode })
    });
    setToken(data.token);
    setUser(data.user);
    setAuthError("");
    if (tgInitData) {
      try {
        const linked = await api("/api/auth/telegram-link", {
          method: "POST",
          body: JSON.stringify({ initData: tgInitData })
        });
        setUser(linked.user);
        setNeedsTelegramChoice(false);
      } catch {
        /* password login still succeeded */
      }
    }
    return data.user;
  }

  async function registerAccount(username, password, displayName, acceptTerms) {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, displayName, acceptTerms: !!acceptTerms })
    });
    setToken(data.token);
    setUser(data.user);
    setAuthError("");
    if (tgInitData) {
      try {
        const linked = await api("/api/auth/telegram-link", {
          method: "POST",
          body: JSON.stringify({ initData: tgInitData })
        });
        setUser(linked.user);
        setNeedsTelegramChoice(false);
      } catch {
        /* register still succeeded */
      }
    }
    return data.user;
  }

  async function loginWithTelegram() {
    const initData = tgInitData || (telegramWebApp() && telegramWebApp().initData) || "";
    if (!initData) throw new Error("افتح المنصة من زر البوت داخل تلغرام لتسجيل الدخول.");
    const data = await api("/api/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ initData, action: "auto" })
    });
    if (data.needsChoice) {
      setNeedsTelegramChoice(true);
      throw new Error("هذا التلغرام غير مرتبط بعد. اختر: حساب حالي أو إنشاء حساب جديد.");
    }
    setToken(data.token);
    setUser(data.user);
    setAuthError("");
    setNeedsTelegramChoice(false);
    return data.user;
  }

  async function linkTelegramAccount(username, password) {
    const initData = tgInitData || (telegramWebApp() && telegramWebApp().initData) || "";
    if (!initData) throw new Error("افتح المنصة من داخل تلغرام.");
    const data = await api("/api/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ initData, action: "link", username, password })
    });
    setToken(data.token);
    setUser(data.user);
    setAuthError("");
    setNeedsTelegramChoice(false);
    return data.user;
  }

  async function createTelegramAccount() {
    const initData = tgInitData || (telegramWebApp() && telegramWebApp().initData) || "";
    if (!initData) throw new Error("افتح المنصة من داخل تلغرام.");
    const data = await api("/api/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ initData, action: "create" })
    });
    setToken(data.token);
    setUser(data.user);
    setAuthError("");
    setNeedsTelegramChoice(false);
    return data.user;
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setToken("");
    setUser(null);
  }

  return (
    <AuthCtx.Provider
      value={{
        user,
        ready,
        insideTelegram,
        authError,
        needsTelegramChoice,
        logout,
        refresh,
        loginWithPassword,
        registerAccount,
        loginWithTelegram,
        linkTelegramAccount,
        createTelegramAccount,
        botUsername: FALLBACK_BOT
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}

export function openTelegramBot(username) {
  const bot = (username || FALLBACK_BOT).replace(/^@/, "");
  const url = `https://t.me/${bot}`;
  const tg = telegramWebApp();
  if (tg && tg.openTelegramLink) {
    try {
      tg.openTelegramLink(url);
      return;
    } catch {
      /* fall through */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
