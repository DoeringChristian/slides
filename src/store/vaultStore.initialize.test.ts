import { expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({test:vi.fn().mockResolvedValue(false),set:vi.fn(),list:vi.fn().mockResolvedValue([])}));
vi.mock('../utils/io/storageClient',()=>({
  initStorageConfig:()=>{},getStorageConfig:()=>({mode:'server',serverUrl:'http://127.0.0.1:3001'}),
  setStorageConfig:mocks.set,testServerConnection:mocks.test,getStorageClient:()=>({listProjects:mocks.list}),
}));
vi.mock('../utils/editor/keyboard',()=>({isShiftHeld:()=>false,isCtrlHeld:()=>false}));
vi.stubGlobal('window',{});
const {useVaultStore: vault}=await import('./vaultStore');
it('temporary backend downtime preserves the configured server and reports an error',async()=>{
  await vault.getState().initialize();
  expect(vault.getState().storageMode).toBe('server');
  expect(vault.getState().serverUrl).toBe('http://127.0.0.1:3001');
  expect(vault.getState().error).toContain('Server unavailable');
  expect(mocks.set).not.toHaveBeenCalled();expect(mocks.list).not.toHaveBeenCalled();
  mocks.test.mockResolvedValue(true);
  await vault.getState().initialize();
  expect(vault.getState().error).toBeNull();expect(mocks.list).toHaveBeenCalledOnce();
});
