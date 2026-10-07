import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { UsageDisplay } from '../hooks/useUsage';
import { quotaWindowView } from '../utils/quotaWindows';
import { useShortCountdown } from '../hooks/useCountdown';
import './StatsBar.css';

interface ProxyStatus {
    enabled: boolean;
    port: number;
    is_running: boolean;
    base_url: string;
    allow_lan: boolean;
    lan_base_url?: string | null;
}

interface StatsBarProps {
    accountCount: number;
    usage: UsageDisplay | null;
}

export function StatsBar({ accountCount, usage }: StatsBarProps) {
    const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);

    const fetchProxyStatus = async () => {
        try {
            const status = await invoke<ProxyStatus>('get_proxy_status');
            setProxyStatus(status);
        } catch {
            setProxyStatus(null);
        }
    };

    useEffect(() => {
        fetchProxyStatus();
        const unlisten = listen('settings-updated', () => {
            fetchProxyStatus();
        });
        return () => { unlisten.then(fn => fn()); };
    }, []);
    const windows = quotaWindowView(usage);
    const fiveHourReset = useShortCountdown(windows.fiveHourResetAt);
    const weeklyReset = useShortCountdown(windows.weeklyResetAt);

    return (
        <div className="stats-bar">
            <div className="stat-card">
                <div className="stat-icon blue">👤</div>
                <div className="stat-info">
                    <div className="stat-value">{accountCount}</div>
                    <div className="stat-label">Tổng tài khoản</div>
                </div>
            </div>

            {windows.hasFiveHour && <div className="stat-card">
                <div className="stat-icon green">⏱</div>
                <div className="stat-info">
                    <div className="stat-value">{windows.fiveHourLeft}%</div>
                    <div className="stat-label">Giới hạn 5 giờ</div>
                    <div className={'stat-hint ' + (windows.fiveHourLeft > 50 ? 'good' : 'warn')}>
                        {fiveHourReset ? `Đặt lại sau ${fiveHourReset}` : windows.fiveHourLeft > 50 ? 'Còn nhiều lượt' : 'Sắp hết lượt'}
                    </div>
                </div>
            </div>}

            {windows.hasWeekly && <div className={`stat-card ${windows.weeklyOnly ? 'weekly-only' : ''}`}>
                <div className="stat-icon purple">📅</div>
                <div className="stat-info">
                    <div className="stat-value">{windows.weeklyLeft}%</div>
                    <div className="stat-label">{windows.weeklyOnly ? 'Chỉ có hạn mức tuần' : 'Hạn mức tuần'}</div>
                    <div className={'stat-hint ' + (windows.weeklyLeft > 50 ? 'good' : 'warn')}>
                        {weeklyReset ? `Đặt lại sau ${weeklyReset}` : windows.weeklyOnly ? 'Không có hạn mức 5 giờ' : windows.weeklyLeft > 50 ? 'Còn nhiều lượt' : 'Sắp hết lượt'}
                    </div>
                </div>
            </div>}

            {proxyStatus?.enabled && (
                <div className="stat-card">
                    <div className={`stat-icon ${proxyStatus.is_running ? 'green' : 'red'}`}>
                        {proxyStatus.is_running ? '🔗' : '🔌'}
                    </div>
                    <div className="stat-info">
                        <div className="stat-value">:{proxyStatus.port}</div>
                        <div className="stat-label">Proxy</div>
                        <div className={`stat-hint ${proxyStatus.is_running ? 'good' : 'warn'}`}>
                            {proxyStatus.is_running
                                ? proxyStatus.allow_lan ? 'Có thể dùng trong mạng LAN' : 'Chỉ máy này'
                                : 'Đã dừng'}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
