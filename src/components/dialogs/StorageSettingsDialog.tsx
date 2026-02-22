import React, { useState, useEffect } from 'react';
import { X, Server, HardDrive, FolderOpen, Loader2, Check, AlertCircle } from 'lucide-react';
import { useVaultStore } from '../../store/vaultStore';
import { isFileSystemAccessSupported } from '../../types/vault';

const supportsFileSystem = isFileSystemAccessSupported();

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const StorageSettingsDialog: React.FC<Props> = ({ isOpen, onClose }) => {
  const storageMode = useVaultStore((s) => s.storageMode);
  const serverUrl = useVaultStore((s) => s.serverUrl);
  const vaultHandle = useVaultStore((s) => s.vaultHandle);
  const isLoading = useVaultStore((s) => s.isLoading);
  const error = useVaultStore((s) => s.error);

  const setStorageMode = useVaultStore((s) => s.setStorageMode);
  const selectVault = useVaultStore((s) => s.selectVault);
  const testServer = useVaultStore((s) => s.testServer);
  const setError = useVaultStore((s) => s.setError);

  const [inputServerUrl, setInputServerUrl] = useState(serverUrl || 'http://localhost:3001');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (serverUrl) {
      setInputServerUrl(serverUrl);
    }
  }, [serverUrl]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setTestStatus('testing');
    const success = await testServer(inputServerUrl);
    setTestStatus(success ? 'success' : 'error');
  };

  const handleSwitchToServer = async () => {
    setError(null);
    await setStorageMode('server', inputServerUrl);
    if (!useVaultStore.getState().error) {
      onClose();
    }
  };

  const handleSwitchToLocal = async () => {
    setError(null);
    await setStorageMode('local');
    onClose();
  };

  const handleSwitchToFileSystem = async () => {
    setError(null);
    await selectVault();
    if (useVaultStore.getState().vaultHandle) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-medium">Storage Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Local Storage Option */}
          <div
            className={`p-4 border rounded-lg cursor-pointer transition-colors ${
              storageMode === 'local'
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onClick={handleSwitchToLocal}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${storageMode === 'local' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                <HardDrive size={20} className={storageMode === 'local' ? 'text-blue-600' : 'text-gray-600'} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Browser Storage</span>
                  {storageMode === 'local' && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Active</span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Store presentations in your browser's IndexedDB. Data stays local and private.
                </p>
              </div>
            </div>
          </div>

          {/* Server Storage Option */}
          <div
            className={`p-4 border rounded-lg transition-colors ${
              storageMode === 'server'
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-200'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${storageMode === 'server' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                <Server size={20} className={storageMode === 'server' ? 'text-blue-600' : 'text-gray-600'} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Server Storage</span>
                  {storageMode === 'server' && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Active</span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Store presentations on a remote server. Access from multiple devices.
                </p>

                <div className="mt-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inputServerUrl}
                      onChange={(e) => {
                        setInputServerUrl(e.target.value);
                        setTestStatus('idle');
                      }}
                      placeholder="http://localhost:3001"
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-400"
                    />
                    <button
                      onClick={handleTestConnection}
                      disabled={testStatus === 'testing' || !inputServerUrl}
                      className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      {testStatus === 'testing' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : testStatus === 'success' ? (
                        <Check size={14} className="text-green-600" />
                      ) : testStatus === 'error' ? (
                        <AlertCircle size={14} className="text-red-600" />
                      ) : null}
                      Test
                    </button>
                  </div>

                  {testStatus === 'success' && (
                    <p className="text-sm text-green-600 flex items-center gap-1">
                      <Check size={14} /> Connected successfully
                    </p>
                  )}
                  {testStatus === 'error' && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle size={14} /> Could not connect to server
                    </p>
                  )}

                  <button
                    onClick={handleSwitchToServer}
                    disabled={isLoading || testStatus !== 'success'}
                    className="w-full px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isLoading && <Loader2 size={14} className="animate-spin" />}
                    {storageMode === 'server' ? 'Update Server' : 'Switch to Server'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* File System Option (Chrome/Edge only) */}
          {supportsFileSystem && (
            <div
              className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                storageMode === 'filesystem'
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
              onClick={handleSwitchToFileSystem}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${storageMode === 'filesystem' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                  <FolderOpen size={20} className={storageMode === 'filesystem' ? 'text-blue-600' : 'text-gray-600'} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Local Folder</span>
                    {storageMode === 'filesystem' && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Active</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Sync presentations to a folder on your computer. Files are saved as JSON.
                  </p>
                  {vaultHandle && storageMode === 'filesystem' && (
                    <p className="text-sm text-gray-600 mt-2 font-mono bg-gray-100 px-2 py-1 rounded">
                      {vaultHandle.name}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <p className="text-xs text-gray-500">
            Note: Switching storage modes will not migrate your existing presentations.
            Export your presentations first if you want to move them.
          </p>
        </div>
      </div>
    </div>
  );
};
