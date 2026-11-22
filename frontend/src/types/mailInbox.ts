export type MailItem = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  subject: string;
  from: string;
  fromEmail?: string;
  receivedAt: string;
  suggestedFolderId: number | null;
  suggestedFolderName: string | null;
  detectedLabel: string;
  reason: string;
  locked?: boolean;
};

export type SenderFilterEntry = {
  email: string;
  pendingCount: number;
  excluded: boolean;
  folderId?: number | null;
};

export type MailAccountPublic = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  mailbox: string;
};

export type MailAccountFormValues = {
  id?: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
};

export type MailboxStats = {
  totalMessages: number;
  unreadMessages: number;
  checkedMessages: number;
  newMessages: number;
  accounts: Array<{
    id: string;
    user: string;
    mailbox: string;
    totalMessages: number;
    unreadMessages: number;
    checkedMessages: number;
    newMessages: number;
  }>;
};
