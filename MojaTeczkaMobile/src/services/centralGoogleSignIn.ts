import { Platform } from 'react-native';
import { getCentralGoogleChallenge, linkCentralGoogle, loginCentralWithGoogle } from './centralAccount';

let busy = false;

// Native Android credential manager. Web client ID is public; never embed an
// OAuth client secret in the app. Signing certificate and Android package must
// be registered in Google Cloud before this flow can work.
async function withGoogleCredential<T>(origin: string, webClientId: string, complete: (credential: string, nonce: string) => Promise<T>) {
  if (Platform.OS !== 'android') throw new Error('Logowanie Google na tej platformie nie jest jeszcze skonfigurowane.');
  if (!/^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(webClientId)) throw new Error('Brak konfiguracji logowania Google.');
  if (busy) throw new Error('Logowanie Google już trwa.');
  busy = true;
  try {
    const { GoogleOneTapSignIn, isSuccessResponse } = await import('react-native-nitro-google-signin');
    const { nonce } = await getCentralGoogleChallenge(origin);
    if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new Error('Serwer zwrócił nieprawidłowe wyzwanie.');
    GoogleOneTapSignIn.configure({ webClientId, nonce });
    await GoogleOneTapSignIn.checkPlayServices();
    const result = await GoogleOneTapSignIn.presentExplicitSignIn();
    if (!isSuccessResponse(result) || !result.data.idToken) throw new Error('Logowanie Google zostało anulowane lub nie powiodło się.');
    return await complete(result.data.idToken, nonce);
  } finally { busy = false; }
}

export async function signInToCentralWithGoogle(origin: string, webClientId: string) {
  return withGoogleCredential(origin, webClientId, (credential, nonce) => loginCentralWithGoogle(origin, credential, nonce));
}

export async function linkGoogleToCentral(origin: string, webClientId: string) {
  return withGoogleCredential(origin, webClientId, (credential, nonce) => linkCentralGoogle(origin, credential, nonce));
}
