import DesktopAccessSettings from '../../DesktopAccessSettings';
import AppUpdatePromptModal from '../AppUpdatePromptModal';
import AuthModal from '../AuthModal';
import BillingCancelModal from '../BillingCancelModal';
import BillingHistoryModal from '../BillingHistoryModal';
import BillingPlansModal from '../BillingPlansModalV2';
import CloseAppModal from '../CloseAppModal';
import DeleteAccountModal from '../DeleteAccountModal';
import FamilySettingsModal from '../FamilySettingsModal';
import FeedbackModal from '../FeedbackModal';
import LegalDocsModal, { type LegalDocId } from '../LegalDocsModal';
import MobileOnboarding from '../MobileOnboarding';
import PairingGuideModal from '../PairingGuideModal';
import PlanLimitModal from '../PlanLimitModal';
import PlanUsageModal from '../PlanUsageModal';
import SelfHostServerGuideModal from '../SelfHostServerGuideModal';
import TesterConsentModal from '../TesterConsentModal';
import WelcomeScreen from '../WelcomeScreen';
import { getElectronIpc } from '../../services/electron';
import { errorMessage } from '../../utils/errors';
import type { useAppSession } from '../../hooks/useAppSession';
import type { useAppUpdateCheck } from '../../hooks/useAppUpdateCheck';
import type { useBillingFlow } from '../../hooks/useBillingFlow';
import type { usePairingStatus } from '../../hooks/usePairingStatus';
import type { useTesterConsent } from '../../hooks/useTesterConsent';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  apiFetch: typeof fetch;
  activeView: string;
  session: ReturnType<typeof useAppSession>;
  billing: ReturnType<typeof useBillingFlow>;
  testerConsent: ReturnType<typeof useTesterConsent>;
  appUpdate: ReturnType<typeof useAppUpdateCheck>;
  pairing: ReturnType<typeof usePairingStatus>;
  isBillingPlansOpen: boolean;
  setIsBillingPlansOpen: (v: boolean) => void;
  isPlanUsageOpen: boolean;
  setIsPlanUsageOpen: (v: boolean) => void;
  isFamilyOpen: boolean;
  setIsFamilyOpen: (v: boolean) => void;
  isDeleteAccountOpen: boolean;
  setIsDeleteAccountOpen: (v: boolean) => void;
  legalDocTab: LegalDocId | null;
  setLegalDocTab: (v: LegalDocId | null) => void;
  isUpdateModalOpen: boolean;
  setIsUpdateModalOpen: (v: boolean) => void;
  isSelfHostGuideOpen: boolean;
  setIsSelfHostGuideOpen: (v: boolean) => void;
  onOpenBackupFromGuide: () => void;
  isAccessSettingsOpen: boolean;
  setIsAccessSettingsOpen: (v: boolean) => void;
  feedbackDraft: { screenshot: string | null; appVersion?: string; platform?: string } | null;
  setFeedbackDraft: (v: { screenshot: string | null; appVersion?: string; platform?: string } | null) => void;
  userFeedbackReplyCount: number;
  onHistoryViewed: () => void;
  onFetchData: () => Promise<void>;
  showToast: (message: string, type?: string, durationMs?: number) => void;
};

/** Renders account, billing, onboarding, update, feedback, and pairing modals. */
export function AppAccountModals(p: Props) {
  return (
    <>
      {p.session.showWelcome && !p.session.currentUser && (
        <WelcomeScreen
          onContinue={() => p.session.setShowWelcome(false)}
          onAuthenticated={user => { p.session.setShowWelcome(false); p.session.handleAuthenticated(user); }}
        />
      )}
      {p.billing.isBillingCancelOpen && (
        <BillingCancelModal
          previewBusy={p.billing.billingCancelPreviewBusy}
          previewError={p.billing.billingCancelPreviewError}
          preview={p.billing.billingCancelPreview}
          cancelBusy={p.billing.billingCancelBusy}
          onClose={() => p.billing.setIsBillingCancelOpen(false)}
          onConfirm={() => void p.billing.cancelBilling()}
        />
      )}
      {p.billing.planLimitMessage && (
        <PlanLimitModal
          message={p.billing.planLimitMessage}
          plan={p.billing.billingPlan}
          busy={p.billing.billingBusy}
          onClose={() => p.billing.setPlanLimitMessage('')}
          onSelect={(plan, interval) => { p.billing.setPlanLimitMessage(''); void p.billing.openBillingCheckout(plan, interval, false, true); }}
        />
      )}
      {p.isPlanUsageOpen && <PlanUsageModal apiUrl={p.apiUrl} fetcher={p.apiFetch} onClose={() => p.setIsPlanUsageOpen(false)} />}
      {p.isFamilyOpen && (
        <FamilySettingsModal
          apiUrl={p.apiUrl}
          fetcher={p.fetcher}
          currentUserEmail={p.session.currentUser?.email ?? null}
          onChanged={() => { void p.onFetchData(); }}
          onClose={() => p.setIsFamilyOpen(false)}
        />
      )}
      {p.testerConsent.needsConsent && p.session.currentUser && (
        <TesterConsentModal
          userEmail={p.session.currentUser.email}
          busy={p.testerConsent.busy}
          error={p.testerConsent.error}
          onAccept={mode => void p.testerConsent.submitConsent(true, mode).then(ok => { if (ok) void p.onFetchData(); })}
          onDecline={() => void p.testerConsent.submitConsent(false, 'local_browser').finally(() => void p.session.logoutAccount())}
          onOpenLegalDoc={p.setLegalDocTab}
        />
      )}
      {p.legalDocTab && <LegalDocsModal apiUrl={p.apiUrl} initialTab={p.legalDocTab} onClose={() => p.setLegalDocTab(null)} />}
      {p.isUpdateModalOpen && p.appUpdate.availableUpdate && !p.testerConsent.needsConsent && (
        <AppUpdatePromptModal
          update={p.appUpdate.availableUpdate}
          updatingProgress={p.appUpdate.updatingProgress}
          onUpdateNow={() => void p.appUpdate.applyUpdateNow()}
          onPostpone={delay => { p.setIsUpdateModalOpen(false); p.appUpdate.postponeUpdate(delay); }}
        />
      )}
      {p.billing.isBillingHistoryOpen && (
        <BillingHistoryModal transactions={p.billing.billingHistory} loading={p.billing.billingHistoryBusy} onClose={() => p.billing.setIsBillingHistoryOpen(false)} />
      )}
      {p.feedbackDraft && (
        <FeedbackModal
          apiUrl={p.apiUrl}
          fetcher={p.apiFetch}
          activeView={p.activeView}
          initialScreenshot={p.feedbackDraft.screenshot}
          initialAppVersion={p.feedbackDraft.appVersion}
          initialPlatform={p.feedbackDraft.platform}
          unreadReplyCount={p.userFeedbackReplyCount}
          onHistoryViewed={p.onHistoryViewed}
          onClose={() => p.setFeedbackDraft(null)}
        />
      )}
      {p.isSelfHostGuideOpen && (
        <SelfHostServerGuideModal
          onClose={() => p.setIsSelfHostGuideOpen(false)}
          onOpenBackup={() => { p.setIsSelfHostGuideOpen(false); p.onOpenBackupFromGuide(); }}
        />
      )}
      {p.isDeleteAccountOpen && p.session.currentUser && (
        <DeleteAccountModal
          apiUrl={p.apiUrl}
          fetcher={p.apiFetch}
          userEmail={p.session.currentUser.email}
          onClose={() => p.setIsDeleteAccountOpen(false)}
          onErased={notice => {
            p.setIsDeleteAccountOpen(false);
            if (notice) p.showToast(notice, 'success', 7000);
            void p.session.logoutAccount();
          }}
        />
      )}
      {p.session.isCloseModalOpen && (
        <CloseAppModal
          onMinimize={() => { p.session.setIsCloseModalOpen(false); void getElectronIpc()?.invoke('eteczka-minimize-to-tray'); }}
          onQuit={() => { p.session.setIsCloseModalOpen(false); void getElectronIpc()?.invoke('eteczka-quit-app'); }}
          onCancel={() => p.session.setIsCloseModalOpen(false)}
        />
      )}
      {p.isAccessSettingsOpen && <DesktopAccessSettings onClose={() => p.setIsAccessSettingsOpen(false)} />}
      {p.session.isAuthOpen && <AuthModal onClose={() => p.session.setIsAuthOpen(false)} onAuthenticated={p.session.handleAuthenticated} />}
      {p.isBillingPlansOpen && (
        <BillingPlansModal
          apiUrl={p.apiUrl}
          fetcher={p.apiFetch}
          busy={p.billing.billingBusy}
          currentPlan={p.billing.billingPlan}
          developmentOverride={p.billing.billingIsDev}
          cancellationScheduled={p.billing.billingDetails?.cancellationScheduled === true}
          onSelectFree={() => {
            if (p.billing.billingIsDev) {
              void (async () => {
                try {
                  const res = await p.apiFetch(`${p.apiUrl}/api/dev/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'free' }) });
                  if (!res.ok) throw new Error('Nie udało się zmienić planu testowego.');
                  p.setIsBillingPlansOpen(false);
                  p.billing.setBillingDetails(null);
                  await p.onFetchData();
                  p.showToast('Wybrano testowy plan Darmowy.');
                } catch (error) { p.showToast(errorMessage(error), 'error'); }
              })();
            } else {
              p.setIsBillingPlansOpen(false);
              void p.billing.openBillingCancel();
            }
          }}
          onClose={() => p.setIsBillingPlansOpen(false)}
          onSelect={(plan, interval) => {
            if (p.billing.billingDetails?.cancellationScheduled) {
              const amount = plan === 'standard' ? (interval === 'yearly' ? '49,90 zł za rok' : '4,99 zł miesięcznie') : (interval === 'yearly' ? '99,90 zł za rok' : '9,99 zł miesięcznie');
              const end = p.billing.billingDetails.renewalAt ? new Date(p.billing.billingDetails.renewalAt).toLocaleDateString('pl-PL') : 'końca opłaconego okresu';
              if (!window.confirm(`Obecny plan pozostaje opłacony do ${end}. Nowy plan zacznie działać od razu, a nowa płatność (${amount}) zostanie pobrana po jej zatwierdzeniu w Stripe. Niewykorzystana część bieżącego miesiąca nie zostanie ponownie rozliczona. Czy chcesz kontynuować?`)) return;
            }
            p.setIsBillingPlansOpen(false);
            void p.billing.openBillingCheckout(plan, interval, p.billing.billingDetails?.cancellationScheduled === true);
          }}
        />
      )}
      {p.session.currentUser && (
        <MobileOnboarding key={p.session.currentUser.email} email={p.session.currentUser.email} phoneConnected={p.pairing.phoneConnected} onPair={() => p.pairing.setIsPairingGuideOpen(true)} />
      )}
      {p.pairing.isPairingGuideOpen && (
        <PairingGuideModal
          localAddresses={p.pairing.localAddresses}
          pairingCode={p.pairing.pairingCode}
          phoneConnected={p.pairing.phoneConnected}
          pairingLimit={p.pairing.pairingLimit}
          pairedPhones={p.pairing.pairedPhones}
          replacementBusy={p.pairing.replacementBusy}
          replacementNotice={p.pairing.replacementNotice}
          localCaFingerprint={p.pairing.localCaFingerprint}
          onReplacePhone={id => void p.pairing.replacePhone(id)}
          onClose={() => p.pairing.setIsPairingGuideOpen(false)}
        />
      )}
    </>
  );
}
