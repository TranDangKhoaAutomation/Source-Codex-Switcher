import { UsageDisplay } from '../hooks/useUsage';
import { useCountdown } from '../hooks/useCountdown';
import './UsageCard.css';
import { quotaWindowView } from '../utils/quotaWindows';

interface UsageCardProps {
    usage: UsageDisplay | null;
    loading: boolean;
    error: string | null;
    onRefresh: () => void;
}


export function UsageCard({ usage, loading, error, onRefresh }: UsageCardProps) {
    const windows = quotaWindowView(usage);
    const fiveHourCountdown = useCountdown(windows.fiveHourResetAt);
    const weeklyCountdown = useCountdown(windows.weeklyResetAt);

    if (loading && !usage) {
        return (
            <div className="usage-inline loading">
                <div className="spinner-small" />
                <span>Đang tải hạn mức...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="usage-inline error">
                <span className="error-text">{error}</span>
                <button className="btn btn-ghost btn-sm" onClick={onRefresh}>
                    Thử lại
                </button>
            </div>
        );
    }

    if (!usage) {
        return null;
    }

    const isFree = usage.plan_type.toLowerCase() === 'free';

    return (
        <div className="usage-meters">
            {windows.weeklyOnly && (
                <div className="usage-window-note weekly-only">
                    <span>📅</span>
                    <span><strong>Chỉ có hạn mức tuần</strong> · tài khoản này không có hạn mức 5 giờ</span>
                </div>
            )}
            {/* 5 小时窗口。窗口类型来自 API 的 limit_window_seconds，不按位置猜。 */}
            {windows.hasFiveHour && (
                <>
                    <div className="usage-row">
                        <span className="usage-label">5 giờ {isFree ? '· FREE' : ''}</span>
                        <span className="usage-reset">{fiveHourCountdown || windows.fiveHourReset}</span>
                        <span className="usage-percent">{windows.fiveHourLeft}%</span>
                    </div>
                    <div className="meter-bar">
                        <div
                            className={'meter-fill ' + getColorClass(windows.fiveHourLeft)}
                            style={{ width: windows.fiveHourLeft + '%' }}
                        />
                    </div>
                </>
            )}

            {/* Bucket tuần độc lập với bucket 5 giờ. */}
            {windows.hasWeekly && (
                <>
                    <div className="usage-row">
                        <span className="usage-label">{windows.weeklyOnly ? 'Tuần (hạn mức duy nhất)' : 'Hạn mức tuần'}</span>
                        <span className="usage-reset">{weeklyCountdown || windows.weeklyReset}</span>
                        <span className="usage-percent">{windows.weeklyLeft}%</span>
                    </div>
                    <div className="meter-bar">
                        <div
                            className={'meter-fill ' + getColorClass(windows.weeklyLeft)}
                            style={{ width: windows.weeklyLeft + '%' }}
                        />
                    </div>
                </>
            )}

        </div>
    );
}

function getColorClass(percent: number): string {
    if (percent > 50) return 'green';
    if (percent > 20) return 'orange';
    return 'red';
}
