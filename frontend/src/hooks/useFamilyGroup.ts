import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../utils/errors';

export type FamilyMemberInfo = {
  userId: number;
  email: string;
  name: string | null;
  role: 'host' | 'member';
  joinedAt: string;
};

export type FamilyPendingInvite = {
  id: number;
  email: string;
  code: string;
  expiresAt: string;
};

export type IncomingFamilyInvite = {
  id: number;
  hostEmail: string;
  hostName: string | null;
  code: string;
  expiresAt: string;
};

export type FamilyOverview = {
  group: {
    id: number;
    hostUserId: number;
    role: 'host' | 'member';
    maxMembers: number;
    members: FamilyMemberInfo[];
    pendingInvites: FamilyPendingInvite[];
  } | null;
  incomingInvites: IncomingFamilyInvite[];
};

/** Manages family group overview, invitations, acceptance, and membership updates. */
export function useFamilyGroup(apiUrl: string, fetcher: typeof fetch, onChanged: () => void) {
  const [overview, setOverview] = useState<FamilyOverview | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetcher(`${apiUrl}/api/family`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nie udało się pobrać informacji o rodzinie.');
      setOverview(data as FamilyOverview);
    } catch (reason) {
      setError(errorMessage(reason, 'Nie udało się pobrać informacji o rodzinie.'));
    } finally {
      setLoading(false);
    }
  }, [apiUrl, fetcher]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const response = await fetcher(`${apiUrl}/api/family/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nie udało się wysłać zaproszenia.');
      setInviteEmail('');
      setInfo(`Utworzono zaproszenie dla ${data.email}. Kod: ${data.code}`);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason, 'Nie udało się wysłać zaproszenia.'));
    } finally {
      setBusy(false);
    }
  };

  const acceptInvite = async (codeOverride?: string) => {
    const code = (codeOverride ?? inviteCode).trim();
    if (!code) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const response = await fetcher(`${apiUrl}/api/family/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nie udało się zaakceptować zaproszenia.');
      setInviteCode('');
      setOverview(data as FamilyOverview);
      setInfo('Dołączono do grupy rodzinnej. Wspólne kartoteki są już widoczne.');
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason, 'Nie udało się zaakceptować zaproszenia.'));
    } finally {
      setBusy(false);
    }
  };

  const cancelInvite = async (inviteId: number) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetcher(`${apiUrl}/api/family/invites/${inviteId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Nie udało się anulować zaproszenia.');
      }
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason, 'Nie udało się anulować zaproszenia.'));
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (memberUserId: number) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetcher(`${apiUrl}/api/family/members/${memberUserId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Nie udało się zaktualizować składu rodziny.');
      }
      await refresh();
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason, 'Nie udało się zaktualizować składu rodziny.'));
    } finally {
      setBusy(false);
    }
  };

  return {
    overview,
    loading,
    busy,
    error,
    info,
    inviteEmail,
    setInviteEmail,
    inviteCode,
    setInviteCode,
    sendInvite,
    acceptInvite,
    cancelInvite,
    removeMember,
  };
}
