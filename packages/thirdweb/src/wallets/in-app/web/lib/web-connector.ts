import type { ThirdwebClient } from "../../../../client/client.js";
import { getThirdwebBaseUrl } from "../../../../utils/domains.js";
import { webLocalStorage } from "../../../../utils/storage/webStorage.js";
import type { SocialAuthOption } from "../../../../wallets/types.js";
import type { Account } from "../../../interfaces/wallet.js";
import { guestAuthenticate } from "../../core/authentication/guest.js";
import {
  loginWithPasskey,
  registerPasskey,
} from "../../core/authentication/passkeys.js";
import { siweAuthenticate } from "../../core/authentication/siwe.js";
import {
  type AuthLoginReturnType,
  type AuthStoredTokenWithCookieReturnType,
  type GetUser,
  type LogoutReturnType,
  type MultiStepAuthArgsType,
  type MultiStepAuthProviderType,
  type SingleStepAuthArgsType,
  UserWalletStatus,
} from "../../core/authentication/types.js";
import type { InAppConnector } from "../../core/interfaces/connector.js";
import { getEnclaveUserStatus } from "../lib/actions/get-enclave-user-status.js";
import type { Ecosystem, InAppWalletConstructorType } from "../types.js";
import { InAppWalletIframeCommunicator } from "../utils/iFrameCommunication/InAppWalletIframeCommunicator.js";
import { Auth, type AuthQuerierTypes } from "./auth/iframe-auth.js";
import { loginWithOauth, loginWithOauthRedirect } from "./auth/oauth.js";
import { sendOtp, verifyOtp } from "./auth/otp.js";
import { EnclaveWallet } from "./enclave-wallet.js";
import { getAuthToken } from "./get-auth-token.js";
import { IFrameWallet } from "./iframe-wallet.js";

/**
 * @internal
 */
export class InAppWebConnector implements InAppConnector {
  protected client: ThirdwebClient;
  protected ecosystem?: Ecosystem;
  protected querier: InAppWalletIframeCommunicator<AuthQuerierTypes>;

  private wallet?: EnclaveWallet | IFrameWallet;
  /**
   * Used to manage the Auth state of the user.
   */
  auth: Auth;
  private passkeyDomain?: string;

  private isClientIdLegacyPaper(clientId: string): boolean {
    if (clientId.indexOf("-") > 0 && clientId.length === 36) {
      return true;
    }
    return false;
  }

  /**
   * @example
   * `const thirdwebInAppWallet = new InAppWalletSdk({ clientId: "", chain: "Goerli" });`
   * @internal
   */
  constructor({
    client,
    onAuthSuccess,
    ecosystem,
    passkeyDomain,
  }: InAppWalletConstructorType) {
    if (this.isClientIdLegacyPaper(client.clientId)) {
      throw new Error(
        "You are using a legacy clientId. Please use the clientId found on the thirdweb dashboard settings page",
      );
    }
    const baseUrl = getThirdwebBaseUrl("inAppWallet");
    this.client = client;
    this.ecosystem = ecosystem;
    this.passkeyDomain = passkeyDomain;
    this.querier = new InAppWalletIframeCommunicator({
      clientId: client.clientId,
      ecosystem,
      baseUrl,
    });

    this.auth = new Auth({
      client,
      querier: this.querier,
      baseUrl,
      ecosystem,
      onAuthSuccess: async (authResult) => {
        onAuthSuccess?.(authResult);

        if (
          this.ecosystem &&
          authResult.storedToken.authDetails.walletType === "sharded"
        ) {
          // If this is an existing sharded ecosystem wallet, we'll need to migrate
          const result = await this.querier.call<boolean>({
            procedureName: "migrateFromShardToEnclave",
            params: {
              storedToken: authResult.storedToken,
            },
          });
          if (!result) {
            throw new Error("Failed to migrate from sharded to enclave wallet");
          }
        }

        await this.initializeWallet(authResult.storedToken.cookieString);

        if (!this.wallet) {
          throw new Error("Failed to initialize wallet");
        }

        await this.wallet.postWalletSetUp({
          ...authResult.walletDetails,
          authToken: authResult.storedToken.cookieString,
          walletUserId: authResult.storedToken.authDetails.userWalletId,
        });

        if (authResult.storedToken.authDetails.walletType !== "enclave") {
          await this.querier.call({
            procedureName: "initIframe",
            params: {
              partnerId: ecosystem?.partnerId,
              ecosystemId: ecosystem?.id,
              clientId: this.client.clientId,
              // For enclave wallets we won't have a device share
              deviceShareStored:
                "deviceShareStored" in authResult.walletDetails
                  ? authResult.walletDetails.deviceShareStored
                  : null,
              walletUserId: authResult.storedToken.authDetails.userWalletId,
              authCookie: authResult.storedToken.cookieString,
            },
          });
        }

        return {
          user: {
            status: UserWalletStatus.LOGGED_IN_WALLET_INITIALIZED,
            authDetails: authResult.storedToken.authDetails,
            account: await this.wallet.getAccount(),
            walletAddress: authResult.walletDetails.walletAddress,
          },
        };
      },
    });
  }

  async initializeWallet(authToken?: string) {
    const storedAuthToken = await getAuthToken(this.client, this.ecosystem);
    if (!authToken && storedAuthToken === null) {
      throw new Error(
        "No auth token provided and no stored auth token found to initialize the wallet",
      );
    }

    const user = await getEnclaveUserStatus({
      authToken: authToken || (storedAuthToken as string),
      client: this.client,
      ecosystem: this.ecosystem,
    });
    if (!user) {
      throw new Error("Cannot initialize wallet, no user logged in");
    }
    if (user.wallets.length === 0) {
      throw new Error(
        "Cannot initialize wallet, this user does not have a wallet generated yet",
      );
    }

    if (user.wallets[0].type === "enclave") {
      this.wallet = new EnclaveWallet({
        client: this.client,
        ecosystem: this.ecosystem,
        address: user.wallets[0].address,
      });
      return;
    }

    this.wallet = new IFrameWallet({
      client: this.client,
      ecosystem: this.ecosystem,
      querier: this.querier,
    });
  }

  /**
   * Gets the user if they're logged in
   * @example
   * ```js
   *  const user = await thirdwebInAppWallet.getUser();
   *  switch (user.status) {
   *     case UserWalletStatus.LOGGED_OUT: {
   *       // User is logged out, call one of the auth methods on thirdwebInAppWallet.auth to authenticate the user
   *       break;
   *     }
   *     case UserWalletStatus.LOGGED_IN_WALLET_INITIALIZED: {
   *       // user is logged in and wallet is all set up.
   *       // You have access to:
   *       user.status;
   *       user.authDetails;
   *       user.walletAddress;
   *       user.wallet;
   *       break;
   *     }
   * }
   * ```
   * @returns GetUser - an object to containing various information on the user statuses
   */
  async getUser(): Promise<GetUser> {
    // If we don't have a wallet yet we'll create one
    if (!this.wallet) {
      const maybeAuthToken = await getAuthToken(this.client, this.ecosystem);
      if (!maybeAuthToken) {
        return { status: UserWalletStatus.LOGGED_OUT };
      }
      await this.initializeWallet(maybeAuthToken);
    }
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }
    return await this.wallet.getUserWalletStatus();
  }

  getAccount(): Promise<Account> {
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }
    return this.wallet.getAccount();
  }

  async preAuthenticate(args: MultiStepAuthProviderType): Promise<void> {
    return sendOtp({
      ...args,
      client: this.client,
      ecosystem: this.ecosystem,
    });
  }

  authenticateWithRedirect(
    strategy: SocialAuthOption,
    mode?: "redirect" | "popup" | "window",
    redirectUrl?: string,
  ): void {
    loginWithOauthRedirect({
      authOption: strategy,
      client: this.client,
      ecosystem: this.ecosystem,
      redirectUrl,
      mode,
    });
  }

  async loginWithAuthToken(authResult: AuthStoredTokenWithCookieReturnType) {
    return this.auth.loginWithAuthToken(authResult);
  }

  /**
   * Authenticates the user and returns the auth token, but does not instantiate their wallet
   */
  async authenticate(
    args: MultiStepAuthArgsType | SingleStepAuthArgsType,
  ): Promise<AuthStoredTokenWithCookieReturnType> {
    const strategy = args.strategy;
    switch (strategy) {
      case "email":
        return verifyOtp({
          ...args,
          client: this.client,
          ecosystem: this.ecosystem,
        });
      case "phone":
        return verifyOtp({
          ...args,
          client: this.client,
          ecosystem: this.ecosystem,
        });
      case "jwt":
        return this.auth.authenticateWithCustomJwt({
          jwt: args.jwt,
          encryptionKey: args.encryptionKey,
        });
      case "passkey": {
        return this.passkeyAuth(args);
      }
      case "auth_endpoint": {
        return this.auth.authenticateWithCustomAuthEndpoint({
          payload: args.payload,
          encryptionKey: args.encryptionKey,
        });
      }
      case "iframe_email_verification": {
        return this.auth.authenticateWithIframe({
          email: args.email,
        });
      }
      case "iframe": {
        return this.auth.authenticateWithModal();
      }
      case "apple":
      case "facebook":
      case "google":
      case "telegram":
      case "farcaster":
      case "line":
      case "x":
      case "coinbase":
      case "discord": {
        return loginWithOauth({
          authOption: strategy,
          client: this.client,
          ecosystem: this.ecosystem,
          closeOpenedWindow: args.closeOpenedWindow,
          openedWindow: args.openedWindow,
        });
      }
      case "guest": {
        return guestAuthenticate({
          client: this.client,
          ecosystem: this.ecosystem,
        });
      }
      case "wallet": {
        return siweAuthenticate({
          ecosystem: this.ecosystem,
          client: this.client,
          wallet: args.wallet,
          chain: args.chain,
        });
      }
    }
  }

  /**
   * Authenticates the user then instantiates their wallet using the resulting auth token
   */
  async connect(
    args: MultiStepAuthArgsType | SingleStepAuthArgsType,
  ): Promise<AuthLoginReturnType> {
    const strategy = args.strategy;
    switch (strategy) {
      case "jwt": {
        return this.auth.loginWithCustomJwt({
          jwt: args.jwt,
          encryptionKey: args.encryptionKey,
        });
      }
      case "auth_endpoint": {
        return this.auth.loginWithCustomAuthEndpoint({
          payload: args.payload,
          encryptionKey: args.encryptionKey,
        });
      }
      case "iframe_email_verification": {
        return this.auth.loginWithIframe({
          email: args.email,
        });
      }
      case "iframe": {
        return this.auth.loginWithModal();
      }
      case "passkey": {
        const authToken = await this.passkeyAuth(args);
        return this.loginWithAuthToken(authToken);
      }
      case "phone":
      case "email":
      case "wallet":
      case "apple":
      case "facebook":
      case "google":
      case "farcaster":
      case "telegram":
      case "line":
      case "x":
      case "guest":
      case "coinbase":
      case "discord": {
        const authToken = await this.authenticate(args);
        return await this.auth.loginWithAuthToken(authToken);
      }

      default:
        assertUnreachable(strategy);
    }
  }

  async logout(): Promise<LogoutReturnType> {
    return await this.auth.logout();
  }

  private async passkeyAuth(
    args: Extract<SingleStepAuthArgsType, { strategy: "passkey" }>,
  ) {
    const { PasskeyWebClient } = await import("./auth/passkeys.js");
    const passkeyClient = new PasskeyWebClient();
    const storage = webLocalStorage;
    if (args.type === "sign-up") {
      return registerPasskey({
        client: this.client,
        ecosystem: this.ecosystem,
        username: args.passkeyName,
        passkeyClient,
        storage,
        rp: {
          id: this.passkeyDomain ?? window.location.hostname,
          name: this.passkeyDomain ?? window.document.title,
        },
      });
    }
    return loginWithPasskey({
      client: this.client,
      ecosystem: this.ecosystem,
      passkeyClient,
      storage,
      rp: {
        id: this.passkeyDomain ?? window.location.hostname,
        name: this.passkeyDomain ?? window.document.title,
      },
    });
  }
}

function assertUnreachable(x: never, message?: string): never {
  throw new Error(message ?? `Invalid param: ${x}`);
}
