import { AppRegistry, AppState, type AppStateStatus } from 'react-native';
import { getCentralSession } from './centralAccount';
import { currentMobileAccount, selectMobileProfile } from './mobileProfile';
import { pendingChangeCount, syncNow } from './offlineSync';

let registered = false;

async function runPendingSync() {
  try {
    if ((await pendingChangeCount()) > 0) {
      await syncNow();
    }
  } catch {
    // Pending items stay safely in the local queue for the next retry.
  }
}

export function registerBackgroundSync() {
  if (registered) return;
  registered = true;

  AppRegistry.registerHeadlessTask('ETeczkaBackgroundSync', () => async () => {
    if(!currentMobileAccount()){const session=await getCentralSession(process.env.EXPO_PUBLIC_CENTRAL_ACCOUNT_URL||'');if(!session)return;await selectMobileProfile(session.user.id,session.user.email);}
    await runPendingSync();
  });

  let lastState: AppStateStatus = AppState.currentState;
  AppState.addEventListener('change', nextState => {
    if (lastState !== 'active' && nextState === 'active') {
      void runPendingSync();
    } else if (lastState === 'active' && nextState === 'background') {
      void runPendingSync();
    }
    lastState = nextState;
  });
}
