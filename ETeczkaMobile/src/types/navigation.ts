export type MobileDocument = {
  id: number;
  title: string;
  filePath: string;
  mimeType: string;
  thumbnail?: string | null;
};

export type FolderSummary = {
  id: number;
  name: string;
  parentId: number | null;
  order?: number;
  _count?: { documents?: number };
};

export type FolderStackParamList = {
  HomeList: undefined;
  FolderDetails: { folder: FolderSummary };
};

export type MainTabParamList = {
  Kartoteki: NavigatorScreenParams<FolderStackParamList> | undefined;
  Skaner: { targetFolderId?: number } | undefined;
  Archiwum: undefined;
  Kosz: undefined;
  Ustawienia: undefined;
};

export type RootStackParamList = {
  MainTabs: undefined;
  DocumentViewer: { document: MobileDocument };
};
import type { NavigatorScreenParams } from "@react-navigation/native";
