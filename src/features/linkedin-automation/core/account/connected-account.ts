/**
 * Authentication-neutral result of connecting a LinkedIn account.
 * The concrete authorization flow must not leak into feature modules.
 */
export type ConnectedAccount = {
  provider: 'linkedin';
  accountId: string;
  displayName: string;
  profileUrl?: string;
  verifiedAt: string;
};
