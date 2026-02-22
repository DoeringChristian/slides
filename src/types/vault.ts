export interface ProjectMeta {
  id: string;
  title: string;
  filename: string;
  createdAt: number;
  updatedAt: number;
  thumbnailDataUrl?: string;
}

export interface VaultState {
  vaultHandle: FileSystemDirectoryHandle | null;
  projects: ProjectMeta[];
  activeProjectId: string | null;
  isLoading: boolean;
  error: string | null;
}

// Check if File System Access API is available
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}
