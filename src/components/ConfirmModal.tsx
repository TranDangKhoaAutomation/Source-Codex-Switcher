import './ConfirmModal.css';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    isLoading?: boolean;
    loadingText?: string;
    extraActionText?: string;
    onExtraAction?: () => void;
    danger?: boolean;
}

export function ConfirmModal({
    isOpen,
    title,
    message,
    confirmText = 'Xác nhận',
    cancelText = 'Hủy',
    onConfirm,
    onCancel,
    isLoading = false,
    loadingText = 'Đang xử lý...',
    extraActionText,
    onExtraAction,
    danger = false,
}: ConfirmModalProps) {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
                <div className="confirm-header">
                    <div className="confirm-icon">⚠️</div>
                    <h3 className="confirm-title">{title}</h3>
                </div>

                <div className="confirm-body">
                    {message}
                </div>

                <div className="confirm-footer">
                    <button className="btn-cancel" onClick={onCancel} disabled={isLoading}>
                        {cancelText}
                    </button>
                    {extraActionText && onExtraAction && (
                        <button className="btn-extra" onClick={onExtraAction} disabled={isLoading}>
                            {extraActionText}
                        </button>
                    )}
                    <button className={`btn-confirm${danger ? ' danger' : ''}`} onClick={onConfirm} disabled={isLoading}>
                        {isLoading ? loadingText : confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
