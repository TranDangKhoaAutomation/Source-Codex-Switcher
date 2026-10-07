import { useState, useEffect, useRef } from 'react';
import {
  BarChart3,
  Database,
  LayoutDashboard,
  Network,
  RadioTower,
  Route,
  Settings as SettingsIcon,
  Sparkles,
  Copy,
  RefreshCw,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useAccounts } from './hooks/useAccounts';
import { useUsage } from './hooks/useUsage';
import { AddAccountModal } from './components/AddAccountModal';
import { AddRelayModal } from './components/AddRelayModal';
import { Dashboard } from './components/Dashboard';
import { AccountList } from './components/AccountList';
import { Settings } from './components/Settings';
import { Proxy } from './components/Proxy';
import { Stats } from './components/Stats';
import { Skills } from './components/Skills';
import { SessionRoutes } from './components/SessionRoutes';
import CachePanel from './components/CachePanel';
import { ConfirmModal } from './components/ConfirmModal';
import { RelayImportConfirm } from './components/RelayImportConfirm';
import './App.css';
import { isMacOS } from './platform';

type PageType = 'dashboard' | 'accounts' | 'proxy' | 'routes' | 'stats' | 'cache' | 'skills' | 'settings';

interface NetworkRepairResult {
  repaired: boolean;
  local_proxy_ok: boolean;
  upstream_ok: boolean;
  message: string;
  windows_command?: string | null;
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'accounts', label: 'Tài khoản', icon: Users },
  { id: 'proxy', label: 'Proxy', icon: Network },
  { id: 'routes', label: 'Định tuyến', icon: Route },
  { id: 'stats', label: 'Thống kê', icon: BarChart3 },
  { id: 'cache', label: 'Bộ nhớ', icon: Database },
  { id: 'skills', label: 'Kỹ năng', icon: Sparkles },
  { id: 'settings', label: 'Cài đặt', icon: SettingsIcon },
] as const satisfies ReadonlyArray<{
  id: PageType;
  label: string;
  icon: typeof LayoutDashboard;
}>;

function App() {
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => setSystemTheme(media.matches ? 'dark' : 'light');
    syncTheme();
    media.addEventListener('change', syncTheme);
    return () => media.removeEventListener('change', syncTheme);
  }, []);
  const {
    accounts,
    currentId,
    settings,
    loading,
    error,
    refresh,
    importCurrent,
    switchTo,
    deleteAccount,
    updateAccount,
    exportAccounts,
    reloadIdeWindows,
    updateSettings,
    checkSyncConflict,
    getSyncStatus,
    syncActiveWithDisk,
    setSessionAnchor,
  } = useAccounts();

  const {
    usage,
    loading: usageLoading,
    error: usageError,
    refresh: refreshUsage,
  } = useUsage();

  const [currentPage, setCurrentPage] = useState<PageType>(() => {
    const saved = localStorage.getItem('currentPage');
    return (saved as PageType) || 'dashboard';
  });

  // 持久化当前 tab
  useEffect(() => {
    localStorage.setItem('currentPage', currentPage);
  }, [currentPage]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRelayModal, setShowRelayModal] = useState(false);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const [networkRepair, setNetworkRepair] = useState<NetworkRepairResult | null>(null);
  const [networkRepairing, setNetworkRepairing] = useState(false);
  const [networkCommandCopied, setNetworkCommandCopied] = useState(false);
  const networkRepairInFlight = useRef(false);
  const [proxyNotice, setProxyNotice] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  // 冲突确认弹窗状态
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [conflictAccountName, setConflictAccountName] = useState('');
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [proxyRunning, setProxyRunning] = useState(false);

  const checkProxyStatus = async () => {
    try {
      const s = await invoke<{ is_running: boolean }>('get_proxy_status');
      setProxyRunning(s.is_running);
    } catch { setProxyRunning(false); }
  };

  const runNetworkRepair = async (silent = false, clearTransientError = false) => {
    if (networkRepairInFlight.current) return null;
    networkRepairInFlight.current = true;
    if (!silent) setNetworkRepairing(true);
    try {
      const result = await invoke<NetworkRepairResult>('repair_network_connection');
      if (result.local_proxy_ok && result.upstream_ok) {
        setNetworkRepair(null);
        if (clearTransientError) setSchedulerError(null);
        if (result.repaired) {
          setProxyNotice('Đã tự khôi phục proxy và kết nối mạng');
          setTimeout(() => setProxyNotice(null), 5000);
        }
      } else {
        setNetworkRepair(result);
      }
      await checkProxyStatus();
      return result;
    } catch (err) {
      const result: NetworkRepairResult = {
        repaired: false,
        local_proxy_ok: false,
        upstream_ok: false,
        message: `Không thể tự kiểm tra kết nối: ${String(err)}`,
        windows_command: 'ipconfig /flushdns',
      };
      setNetworkRepair(result);
      return result;
    } finally {
      networkRepairInFlight.current = false;
      if (!silent) setNetworkRepairing(false);
    }
  };

  const copyNetworkFixCommand = async () => {
    const command = networkRepair?.windows_command;
    if (!command) return;
    await invoke('copy_to_clipboard', { text: command });
    setNetworkCommandCopied(true);
    setTimeout(() => setNetworkCommandCopied(false), 2000);
  };

  const checkSyncStatus = async () => {
    try {
      const status = await getSyncStatus();
      setSyncStatus(status);
    } catch (err) {
      console.error('检查同步状态失败:', err);
    }
  };

  useEffect(() => {
    checkSyncStatus();
    checkProxyStatus();
    // Windows thường báo lỗi mạng giả trong vài giây đầu sau khi đăng nhập.
    // Kiểm tra nền một lần và chỉ hiện hướng dẫn khi tự sửa không thành công.
    const timer = window.setTimeout(() => { void runNetworkRepair(true); }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const currentAccount = accounts.find(a => a.id === currentId) || null;

  const classifyRefreshFailure = (reason: string): 'permanent' | 'transient' => {
    const lower = reason.toLowerCase();
    if (
      lower.includes('refresh_token_reused') ||
      lower.includes('refresh_token_invalidated') ||
      lower.includes('refresh_token_expired')
    ) {
      return 'permanent';
    }
    return 'transient';
  };

  // 监听后台调度器的账号更新事件
  useEffect(() => {
    const unlisten = listen('accounts-updated', () => {
      console.log('[Frontend] 收到后台刷新通知，重新加载账号列表');
      refresh();
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [refresh]);

  // 监听后台刷新失败事件
  useEffect(() => {
    const unlisten = listen<{ account_name: string; reason: string }>('token-refresh-failed', (event) => {
      const { account_name, reason } = event.payload;
      const timestamp = new Date().toLocaleTimeString();
      const kind = classifyRefreshFailure(reason);
      if (kind === 'permanent') {
        setSchedulerError(`Đã dừng duy trì phiên cho ${account_name}; cần đăng nhập lại · ${timestamp}`);
      } else {
        setSchedulerError(`Mạng đang gián đoạn khi cập nhật ${account_name}; Switcher đang tự kiểm tra và sửa… · ${timestamp}`);
        void runNetworkRepair(true, true);
      }
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // 监听代理切号/封号事件
  useEffect(() => {
    const unsub1 = listen<string>('proxy-account-switched', (e) => {
      const msg = `Proxy đã tự chuyển tài khoản → ${e.payload}`;
      setProxyNotice(msg);
      setTimeout(() => setProxyNotice(null), 8000);
      refresh();
      checkProxyStatus();
    });
    const unsub2 = listen<string>('proxy-account-banned', (e) => {
      const msg = `Phát hiện tài khoản bị khóa: ${e.payload}; đã tự chuyển`;
      setProxyNotice(msg);
      setTimeout(() => setProxyNotice(null), 10000);
      refresh();
    });
    const unsub3 = listen<string>('proxy-all-exhausted', (e) => {
      setProxyNotice(e.payload);
      setTimeout(() => setProxyNotice(null), 15000);
    });
    const unsub4 = listen<string>('account-switch-verified', (e) => {
      setProxyNotice(`Đã xác minh chuyển tài khoản thật → ${e.payload}`);
      setTimeout(() => setProxyNotice(null), 8000);
      refresh();
      checkProxyStatus();
    });
    return () => {
      unsub1.then(f => f());
      unsub2.then(f => f());
      unsub3.then(f => f());
      unsub4.then(f => f());
    };
  }, [refresh]);

  // 监听设置更新事件
  useEffect(() => {
    const unlisten = listen('settings-updated', () => {
      console.log('[Frontend] 收到设置更新通知，重新加载设置');
      refresh();
      checkProxyStatus();
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [refresh]);

  // 执行真正的切换逻辑
  const performSwitch = async (id: string) => {
    await switchTo(id);
    if (isMacOS && settings.auto_reload_ide) {
      setTimeout(async () => {
        await reloadIdeWindows(false);
      }, 300);
    }
    setTimeout(() => {
      refreshUsage();
    }, 500);
  };

  // 切换账号（带冲突检测）
  const handleSwitch = async (id: string) => {
    if (isSwitching) return;
    try {
      setIsSwitching(true);
      // 1. 检查是否有未同步的官方 Token 更新
      const conflictName = await checkSyncConflict();

      if (conflictName) {
        // 2. 如果有冲突，暂存目标 ID，弹出确认框
        setConflictAccountName(conflictName);
        setPendingSwitchId(id);
        setShowConflictModal(true);
        return;
      }

      // 3. 无冲突直接切换
      await performSwitch(id);
    } catch (err) {
      console.error('切换检查失败:', err);
      // 尝试保守切换
      try {
        await performSwitch(id);
      } catch (switchErr) {
        // switchTo 内部已经 setError 了，但我们这里可以再打印一下
        console.error('保守切换也失败了:', switchErr);
      }
    } finally {
      setIsSwitching(false);
      checkSyncStatus();
    }
  };

  // 确认覆盖
  const handleConfirmSwitch = async () => {
    if (!pendingSwitchId || isSwitching) return;
    try {
      setIsSwitching(true);
      await performSwitch(pendingSwitchId);
      setShowConflictModal(false);
      setPendingSwitchId(null);
    } catch (err) {
      console.error('确认切换失败:', err);
      // switchTo 内部已经 setError，这里关闭弹窗即可，让用户看到 Banner 错误
      setShowConflictModal(false);
    } finally {
      setIsSwitching(false);
      checkSyncStatus();
    }
  };

  // 以 IDE 状态为准
  const handleFollowIdeAction = async () => {
    try {
      setIsSwitching(true);
      await syncActiveWithDisk();
      setShowConflictModal(false);
      setPendingSwitchId(null);
      await checkSyncStatus();
    } catch (err) {
      console.error('同步 IDE 状态失败:', err);
    } finally {
      setIsSwitching(false);
    }
  };

  // 取消切换
  const handleCancelSwitch = () => {
    setShowConflictModal(false);
    setPendingSwitchId(null);
  };

  const handleExport = async () => {
    try {
      const json = await exportAccounts();
      const path = await save({
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }],
        defaultPath: `codex-accounts-${new Date().toISOString().slice(0, 10)}.json`
      });

      if (path) {
        await writeTextFile(path, json);
        alert('Xuất dữ liệu thành công!');
      }
    } catch (err) {
      alert('Không xuất được dữ liệu: ' + String(err));
    }
  };


  if (loading) {
    return (
      <div className="app" data-palette={settings.theme_palette || 'github'} data-theme={systemTheme}>
        <div className="loading">
          <div className="spinner" />
          <p>Đang tải...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app" data-palette={settings.theme_palette || 'github'} data-theme={systemTheme}>
      {/* 顶部标题栏 */}
      <header className="app-header">
        <div className="header-top-row">
          <div className="header-left">
            <div className="app-logo">
              <Zap size={18} />
            </div>
            <h1>Codex Switcher <span className="app-version">{appVersion ? `v${appVersion}` : 'v—'}</span></h1>
            <div className={`proxy-indicator ${proxyRunning ? 'on' : 'off'}`} title={proxyRunning ? 'Proxy đang chạy' : 'Proxy chưa chạy'}>
              <span className="proxy-dot" />
              {proxyRunning ? 'Proxy bật' : 'Proxy tắt'}
            </div>
          </div>

          <div className="header-actions">
            <button className="btn btn-primary header-action-btn" onClick={() => setShowAddModal(true)}>
              <UserPlus size={16} aria-hidden="true" />
              <span>Đăng nhập tài khoản</span>
            </button>
            <button className="btn btn-relay header-action-btn" onClick={() => setShowRelayModal(true)}>
              <RadioTower size={16} aria-hidden="true" />
              <span>Thêm relay</span>
            </button>
          </div>
        </div>

        {/* 导航菜单 */}
        <nav className="header-nav" aria-label="Điều hướng chính">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                className={`nav-item ${active ? 'active' : ''}`}
                onClick={() => setCurrentPage(item.id)}
                aria-current={active ? 'page' : undefined}
                title={item.label}
              >
                <Icon size={15} strokeWidth={2} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {(error || schedulerError || networkRepair) && (
        <div className="error-banner">
          <div className="error-banner-copy">
            {error && <div>{error}</div>}
            {schedulerError && <div>{schedulerError}</div>}
            {networkRepair && <div>{networkRepair.message}</div>}
          </div>
          {networkRepair && (
            <div className="error-banner-actions">
              <button type="button" onClick={() => void runNetworkRepair(false, true)} disabled={networkRepairing}>
                <RefreshCw size={14} className={networkRepairing ? 'spinning' : ''} />
                {networkRepairing ? 'Đang sửa…' : 'Thử sửa tự động'}
              </button>
              {networkRepair.windows_command && (
                <button type="button" onClick={() => void copyNetworkFixCommand()}>
                  <Copy size={14} />
                  {networkCommandCopied ? 'Đã sao chép' : 'Sao chép lệnh PowerShell'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {proxyNotice && (
        <div className="proxy-notice-banner" onClick={() => setProxyNotice(null)}>
          {proxyNotice}
        </div>
      )}

      <main className="app-main">
        {currentPage === 'dashboard' ? (
          <Dashboard
            accounts={accounts}
            currentAccount={currentAccount}
            usage={usage}
            usageLoading={usageLoading}
            usageError={usageError}
            isCurrentInvalid={currentAccount?.cached_quota?.is_valid_for_cli === false}
            onSwitch={handleSwitch}
            onRefreshUsage={refreshUsage}
            onNavigateToAccounts={() => setCurrentPage('accounts')}
            onExport={handleExport}
            proxyRunning={proxyRunning}
            syncStatus={syncStatus}
            onSyncWithDisk={async () => {
              try {
                await syncActiveWithDisk();
                checkSyncStatus();
              } catch (err) {
                console.error('同步状态失败:', err);
              }
            }}
            onImportDiskAccount={async (name) => {
              try {
                await importCurrent(name, 'Tự nhập từ IDE');
                checkSyncStatus();
              } catch (err) {
                console.error('导入失败:', err);
              }
            }}
            onForceOverwriteDisk={async () => {
              try {
                await invoke<string>('force_overwrite_disk_with_current');
                if (isMacOS && settings.auto_reload_ide) {
                  await reloadIdeWindows(false);
                }
                checkSyncStatus();
                refreshUsage();
              } catch (err) {
                console.error('覆盖 ~/.codex/auth.json 失败:', err);
              }
            }}
            settings={settings}
          />
        ) : currentPage === 'accounts' ? (
          <AccountList
            accounts={accounts}
            currentId={currentId}
            settings={settings}
            onSwitch={handleSwitch}
            onDelete={deleteAccount}
            onUpdateAccount={updateAccount}
            onUpdateSettings={updateSettings}
            onRefreshComplete={refresh}
            onAddAccount={() => setShowAddModal(true)}
            onAddRelay={() => setShowRelayModal(true)}
            onRefreshUsage={refreshUsage}
            usageLoading={usageLoading}
          />
        ) : currentPage === 'proxy' ? (
          <Proxy />
        ) : currentPage === 'routes' ? (
          <SessionRoutes />
        ) : currentPage === 'stats' ? (
          <Stats />
        ) : currentPage === 'cache' ? (
          <CachePanel accounts={accounts.map(a => ({ id: a.id, name: a.name }))} />
        ) : currentPage === 'skills' ? (
          <Skills />
        ) : (
          <Settings accounts={accounts} onSetSessionAnchor={setSessionAnchor} />
        )}
      </main>

      <AddAccountModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdd={importCurrent}
        onSuccess={refresh}
      />

      <AddRelayModal
        isOpen={showRelayModal}
        onClose={() => setShowRelayModal(false)}
        onSuccess={refresh}
      />

      <ConfirmModal
        isOpen={showConflictModal}
        title="⚠️ Phiên đăng nhập chưa đồng bộ"
        message={
          <>
            <p>Codex đang có token mới chưa được lưu vào Switcher.</p>
            <p>Trạng thái tài khoản khác với file đăng nhập chính thức:</p>
            <span className="confirm-account-name">{conflictAccountName || 'Tài khoản hiện tại'}</span>
            <p style={{ marginTop: '12px' }}>
              Nếu tiếp tục, Switcher sẽ <b>ghi đè</b> phiên đăng nhập hiện tại của Codex và không thể khôi phục token chưa đồng bộ.
            </p>
          </>
        }
        confirmText="Ghi đè và chuyển"
        cancelText="Hủy"
        onConfirm={handleConfirmSwitch}
        onCancel={handleCancelSwitch}
        isLoading={isSwitching}
        extraActionText="Dùng phiên của IDE"
        onExtraAction={handleFollowIdeAction}
      />

      <RelayImportConfirm />
    </div>
  );
}

export default App;
