import { UsageDisplay } from '../hooks/useUsage';
import { Account, AppSettings, effectiveKind } from '../hooks/useAccounts';
import { StatsBar } from './StatsBar';
import { UsageCard } from './UsageCard';
import { quotaWindowView } from '../utils/quotaWindows';
import './Dashboard.css';

interface DashboardProps {
    accounts: Account[];
    currentAccount: Account | null;
    usage: UsageDisplay | null;
    usageLoading: boolean;
    usageError: string | null;
    isCurrentInvalid?: boolean;
    onSwitch: (id: string) => void;
    onRefreshUsage: () => void;
    onNavigateToAccounts: () => void;
    onExport: () => void;
    proxyRunning?: boolean;
    syncStatus?: {
        is_synced: boolean;
        disk_email: string | null;
        matching_id: string | null;
    };
    onSyncWithDisk: () => void;
    onImportDiskAccount: (name: string) => void;
    onForceOverwriteDisk: () => void;
    settings?: AppSettings;
}

export function Dashboard({
    accounts,
    currentAccount,
    usage,
    usageLoading,
    usageError,
    isCurrentInvalid,
    onSwitch,
    onRefreshUsage,
    onNavigateToAccounts,
    onExport,
    proxyRunning,
    syncStatus,
    onSyncWithDisk,
    onImportDiskAccount,
    onForceOverwriteDisk,
    settings,
}: DashboardProps) {
    // 切号现在永远写 disk auth.json（store ↔ disk 强一致），不一致仅出现在
    // 用户在 codex 中手动改了登录状态、或 disk 文件被外部进程改动这种边角场景。
    const isMismatched = !!(syncStatus && !syncStatus.is_synced);
    const isHarmless = isMismatched && proxyRunning;

    // v0.7+ 手机锚生效场景：disk 故意"落后"于 current，但 disk 身份 = anchor，
    // 这是 BY DESIGN 不是冲突。识别条件：有 anchor + anchor != current + disk 身份匹配 anchor。
    const anchorAccount = accounts.find(a => a.is_session_anchor);
    const anchorIsActiveLayer = !!(
        anchorAccount &&
        currentAccount &&
        anchorAccount.id !== currentAccount.id &&
        isMismatched &&
        syncStatus?.matching_id === anchorAccount.id
    );
    // 使用与后端相同的核心顺序：用户优先级优先，其次才比较有效额度。
    const getBestAccount = () => {
        const effectiveQuota = (account: Account) => {
            const quota = account.cached_quota;
            if (!quota || quota.is_valid_for_cli === false) return -1;
            const windows = quotaWindowView(quota);
            if (windows.hasFiveHour && windows.hasWeekly) {
                return Math.min(windows.fiveHourLeft, windows.weeklyLeft);
            }
            if (windows.hasWeekly) return windows.weeklyLeft;
            if (windows.hasFiveHour) return windows.fiveHourLeft;
            return -1;
        };
        return accounts
            .filter(account => account.id !== currentAccount?.id)
            .filter(account => !account.is_banned && !account.is_token_invalid && !account.is_logged_out)
            .filter(account => effectiveKind(account) !== 'antigravity_oauth')
            .filter(account => settings?.relay_auto_switch_in || effectiveKind(account) !== 'relay')
            .filter(account => {
                const plan = account.cached_quota?.plan_type.toLowerCase();
                return settings?.allow_auto_switch_to_free || (plan !== 'free' && plan !== 'unknown');
            })
            .filter(account => effectiveQuota(account) > 0)
            .sort((left, right) =>
                (left.priority ?? 50) - (right.priority ?? 50)
                || effectiveQuota(right) - effectiveQuota(left)
                || left.name.localeCompare(right.name)
            )[0] || null;
    };

    const bestAccount = getBestAccount();
    const bestQuota = (() => {
        if (!bestAccount?.cached_quota) return null;
        const windows = quotaWindowView(bestAccount.cached_quota);
        const remaining = windows.hasFiveHour && windows.hasWeekly
            ? Math.min(windows.fiveHourLeft, windows.weeklyLeft)
            : windows.hasWeekly
                ? windows.weeklyLeft
                : windows.hasFiveHour
                    ? windows.fiveHourLeft
                    : null;
        return remaining === null ? null : Math.max(0, remaining);
    })();
    const returningToPriority = !!bestAccount
        && (bestAccount.priority ?? 50) < (currentAccount?.priority ?? 50);

    return (
        <div className="dashboard">
            {/* 问候语 */}
            <div className="dashboard-greeting">
                <h2>
                    Xin chào, {currentAccount?.name.split('@')[0] || 'bạn'} 👋
                </h2>
            </div>

            {/* 统计卡片 */}
            <StatsBar accountCount={accounts.length} usage={usage} />

            {/* 手机锚生效：disk 锁定在 anchor，不显示警告而是 info 提示 */}
            {anchorIsActiveLayer && anchorAccount && (
                <div className="sync-info-banner anchor-active">
                    <div className="banner-content">
                        <span className="banner-icon">📱</span>
                        <div className="banner-text">
                            <strong>Đang ghim tài khoản cho điện thoại:</strong>{' '}
                            Codex.app vẫn giữ phiên <span>{anchorAccount.name}</span>, còn proxy đang dùng <b>{currentAccount?.name}</b>.
                        </div>
                    </div>
                </div>
            )}

            {/* 旧的"磁盘落后/不一致"提示：anchor 生效时彻底隐藏（避免误导） */}
            {syncStatus && !syncStatus.is_synced && !anchorIsActiveLayer && (
                <div className={isHarmless ? 'sync-info-banner' : 'sync-warning-banner'}>
                    <div className="banner-content">
                        <span className="banner-icon">{isHarmless ? 'ℹ️' : '⚠️'}</span>
                        <div className="banner-text">
                            {isHarmless ? (
                                <>
                                    <strong>Tệp auth.json chưa theo tài khoản hiện tại:</strong>{' '}
                                    đang lưu <span>{syncStatus.disk_email || 'tài khoản chưa xác định'}</span>.
                                    Proxy vẫn gắn token của tài khoản đang chọn nên <b>Codex hoạt động bình thường</b>.
                                </>
                            ) : (
                                <>
                                    <strong>Phiên đăng nhập chưa đồng bộ:</strong>{' '}
                                    IDE đang dùng <span>{syncStatus.disk_email || 'tài khoản chưa xác định'}</span>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="banner-actions">
                        {syncStatus.matching_id ? (
                            <button className="btn btn-sm btn-accent" onClick={onSyncWithDisk}>
                                {isHarmless ? 'Đồng bộ tệp đăng nhập' : 'Dùng phiên của IDE'}
                            </button>
                        ) : (
                            <button className="btn btn-sm btn-primary" onClick={() => onImportDiskAccount(syncStatus.disk_email || '新账号')}>
                                Nhập tài khoản này
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* 双栏布局 */}
            <div className="dashboard-grid">
                {/* 当前账号 */}
                <div className={`dashboard-card current-account ${isCurrentInvalid ? 'invalid' : ''}`}>
                    <div className="card-header">
                        <span className="card-icon">✓</span>
                        <h3>Tài khoản hiện tại</h3>
                        {isCurrentInvalid && <span className="invalid-badge" title="Phiên đăng nhập đã hết hiệu lực">⚠️ Cần đăng nhập lại</span>}
                    </div>
                    {currentAccount ? (
                        <div className="current-account-content">
                            <div className="account-info">
                                <span className="email-icon">✉</span>
                                <span className="email">{currentAccount.name}</span>
                                {usage?.plan_type && (
                                    <span className="plan-badge">{usage.plan_type.toUpperCase()}</span>
                                )}
                            </div>

                            {isMismatched && !anchorIsActiveLayer ? (
                                <div className="mismatch-panel">
                                    <div className="mismatch-headline">
                                        Tài khoản trong auth.json không khớp
                                    </div>
                                    <div className="mismatch-detail">
                                        IDE đang dùng: <span className="mono">{syncStatus?.disk_email || 'chưa xác định'}</span>
                                    </div>
                                    <div className="mismatch-actions">
                                        <button
                                            className="btn btn-primary btn-sm"
                                            onClick={onForceOverwriteDisk}
                                        >
                                            Chuyển IDE sang tài khoản này
                                        </button>
                                        {syncStatus?.matching_id ? (
                                            <button className="btn btn-ghost btn-sm" onClick={onSyncWithDisk}>
                                                Dùng tài khoản của IDE
                                            </button>
                                        ) : (
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => onImportDiskAccount(syncStatus?.disk_email || '新账号')}
                                            >
                                                Nhập tài khoản của IDE
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <UsageCard
                                    usage={usage}
                                    loading={usageLoading}
                                    error={usageError}
                                    onRefresh={onRefreshUsage}
                                />
                            )}

                            <button
                                className="btn btn-outline btn-full"
                                onClick={onNavigateToAccounts}
                            >
                                Chuyển tài khoản
                            </button>
                        </div>
                    ) : (
                        <div className="no-account">
                            <p>Chưa có tài khoản</p>
                        </div>
                    )}
                </div>

                {/* 最佳账号推荐 */}
                <div className="dashboard-card best-accounts">
                    <div className="card-header">
                        <span className="card-icon">↗</span>
                        <h3>Tài khoản nên dùng tiếp theo</h3>
                    </div>
                    <div className="best-accounts-list">
                        {bestAccount ? (
                            <div className="best-account-item">
                                <div className="account-label">
                                    <span className="label-text">Đề xuất</span>
                                    <span className="account-email">{bestAccount.name}</span>
                                    <span className="label-text">Ưu tiên {bestAccount.priority ?? 50}</span>
                                </div>
                                <span className="quota-badge">{bestQuota === null ? '—' : `${Math.round(bestQuota)}%`}</span>
                            </div>
                        ) : (
                            <p className="no-recommendation">Không có tài khoản khả dụng khác</p>
                        )}
                    </div>
                    {accounts.length > 1 && (
                        <button
                            className="btn btn-accent btn-full"
                            onClick={() => bestAccount && onSwitch(bestAccount.id)}
                        >
                            {returningToPriority ? 'Chuyển về tài khoản ưu tiên' : 'Chuyển sang tài khoản tốt nhất'}
                        </button>
                    )}
                </div>
            </div>

            {/* 快速链接 */}
            <div className="dashboard-links">
                <button className="link-card" onClick={onNavigateToAccounts}>
                    <span>Xem tất cả tài khoản</span>
                    <span className="link-arrow">→</span>
                </button>
                <button className="link-card" onClick={onExport}>
                    <span>Xuất dữ liệu tài khoản</span>
                    <span className="link-icon">↓</span>
                </button>
            </div>
        </div>
    );
}
