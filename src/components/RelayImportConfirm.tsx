import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { emit } from '@tauri-apps/api/event';
import './ConfirmModal.css';

interface PendingRelayImport {
  source: string;
  name: string;
  base_url: string;
  api_key: string;
  homepage: string | null;
  usage_preset: string | null;
  usage_script_unknown: boolean;
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + '…';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function RelayImportConfirm() {
  const [pending, setPending] = useState<PendingRelayImport | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<PendingRelayImport>('deep-link://import-pending', (event) => {
      setPending(event.payload);
      setError(null);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (!pending) return null;

  const close = () => {
    setPending(null);
    setError(null);
    setSubmitting(false);
  };

  const onConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await invoke('add_relay_account', {
        name: pending.name,
        baseUrl: pending.base_url,
        apiKey: pending.api_key,
        homepage: pending.homepage ?? null,
        usagePreset: pending.usage_preset ?? null,
        notes: `via ${pending.source} deep link`,
      });
      // 通知 App 刷新账号列表
      await emit('accounts-updated');
      close();
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={submitting ? undefined : close}>
      <div className="modal-content confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-header">
          <div className="confirm-icon">🔗</div>
          <h3 className="confirm-title">Nhập tài khoản relay</h3>
        </div>

        <div className="confirm-body">
          <p className="relay-import-source">
            Nguồn: <code>{pending.source}://</code> deep link
          </p>

          <table className="relay-import-table">
            <tbody>
              <tr>
                <th>Tên</th>
                <td>{pending.name}</td>
              </tr>
              <tr>
                <th>Base URL</th>
                <td style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {pending.base_url}
                </td>
              </tr>
              <tr>
                <th>API Key</th>
                <td style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {maskKey(pending.api_key)}
                </td>
              </tr>
              {pending.homepage && (
                <tr>
                  <th>Trang chủ</th>
                  <td>{pending.homepage}</td>
                </tr>
              )}
              <tr>
                <th>Usage</th>
                <td>
                  {pending.usage_preset
                    ? <code>{pending.usage_preset}</code>
                    : <span style={{ color: 'var(--text-muted)' }}>Không lấy dữ liệu</span>}
                </td>
              </tr>
            </tbody>
          </table>

          {pending.usage_script_unknown && (
            <p className="relay-import-note warning">
              ⚠️ <code>usageScript</code> trong liên kết không nằm trong danh sách an toàn nên đã bị bỏ qua.
              Tài khoản vẫn dùng được, nhưng ứng dụng sẽ không tự lấy hạn mức. Sau khi nhập, bạn có thể chọn usage preset trong chi tiết tài khoản.
            </p>
          )}

          {error && (
            <p className="relay-import-note error">
              Nhập thất bại: {error}
            </p>
          )}
        </div>

        <div className="confirm-footer">
          <button className="btn-cancel" onClick={close} disabled={submitting}>
            Hủy
          </button>
          <button className="btn-confirm" onClick={onConfirm} disabled={submitting}>
            {submitting ? 'Đang nhập…' : 'Nhập tài khoản'}
          </button>
        </div>
      </div>
    </div>
  );
}
