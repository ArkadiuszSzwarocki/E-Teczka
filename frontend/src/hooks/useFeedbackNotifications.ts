import { useCallback, useEffect, useState } from 'react';

/** Polls dev bug counts and unread user feedback replies in the background. */
export function useFeedbackNotifications(apiUrl: string, apiFetch: typeof fetch) {
  const [openBugCount, setOpenBugCount] = useState<number>(() => {
    const saved = Number(localStorage.getItem('eteczka_dev_open_bugs'));
    return Number.isFinite(saved) && saved >= 0 ? saved : 0;
  });
  const [adminReplyCount, setAdminReplyCount] = useState<number>(0);
  const [userFeedbackReplyCount, setUserFeedbackReplyCount] = useState<number>(0);

  const updateOpenBugCount = useCallback((count: number) => {
    setOpenBugCount(count);
    localStorage.setItem('eteczka_dev_open_bugs', String(count));
  }, []);

  const markUserFeedbackSeen = useCallback(() => {
    localStorage.setItem('eteczka_feedback_user_seen_at', new Date().toISOString());
    setUserFeedbackReplyCount(0);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let active = true;
    const loadBugCount = async () => {
      try {
        const res = await apiFetch(`${apiUrl}/api/dev/feedback`);
        if (!res.ok) return;
        const payload = await res.json().catch(() => ({})) as { items?: Array<{ status?: string; messages?: Array<{ author?: string }> }> };
        if (active && Array.isArray(payload.items)) {
          updateOpenBugCount(payload.items.filter(item => item.status !== 'closed').length);
          setAdminReplyCount(payload.items.filter(item => item.status !== 'closed' && item.messages?.at(-1)?.author === 'user').length);
        }
      } catch { /* keep last known count when rate-limited or starting */ }
    };
    void loadBugCount();
    const timer = window.setInterval(() => void loadBugCount(), 300_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [apiUrl, apiFetch, updateOpenBugCount]);

  useEffect(() => {
    let active = true;
    const loadUserReplies = async () => {
      try {
        const res = await apiFetch(`${apiUrl}/api/feedback/history`);
        if (!res.ok) return;
        const payload = await res.json().catch(() => ({})) as { items?: Array<{ messages?: Array<{ author?: string; createdAt?: string }> }> };
        if (!active || !Array.isArray(payload.items)) return;
        const seenAt = Date.parse(localStorage.getItem('eteczka_feedback_user_seen_at') || '') || 0;
        const unread = payload.items.filter(item => {
          const last = item.messages?.at(-1);
          if (!last || last.author !== 'admin') return false;
          const msgTime = Date.parse(last.createdAt || '') || 0;
          return msgTime > seenAt;
        }).length;
        setUserFeedbackReplyCount(unread);
      } catch { /* ignore transient feedback history check failures */ }
    };
    void loadUserReplies();
    const timer = window.setInterval(() => void loadUserReplies(), 300_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [apiUrl, apiFetch]);

  return {
    openBugCount,
    adminReplyCount,
    setAdminReplyCount,
    userFeedbackReplyCount,
    updateOpenBugCount,
    markUserFeedbackSeen,
  };
}
