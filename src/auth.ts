import { Amplify } from "aws-amplify";
import {
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
  type AuthUser,
} from "aws-amplify/auth";

const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined;
const userPoolClientId = import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID as string | undefined;

export const authConfigured = Boolean(userPoolId && userPoolClientId);

if (authConfigured) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: userPoolId!,
        userPoolClientId: userPoolClientId!,
        loginWith: { email: true },
      },
    },
  });
}

export async function currentUser(): Promise<AuthUser | null> {
  if (!authConfigured) return null;
  try {
    return await getCurrentUser();
  } catch {
    return null;
  }
}

export async function login(email: string, password: string) {
  const output = await signIn({ username: email.trim(), password });
  if (output.nextStep.signInStep !== "DONE") {
    await signOut();
    throw new Error(`This account requires an unsupported sign-in step: ${output.nextStep.signInStep}.`);
  }
  return getCurrentUser();
}

export async function logout() {
  await signOut();
}

export async function accessToken(forceRefresh = false) {
  const session = await fetchAuthSession({ forceRefresh });
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new Error("Your session expired. Sign in again.");
  return token;
}

export type { AuthUser };
