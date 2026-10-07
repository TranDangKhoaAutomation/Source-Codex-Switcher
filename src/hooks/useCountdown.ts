import { useState, useEffect } from 'react';

/**
 * Hook to calculate remaining time until a reset timestamp
 * @param resetAt Unix timestamp in seconds
 */
export function useCountdown(resetAt?: number) {
    const [timeLeft, setTimeLeft] = useState<string>('');

    useEffect(() => {
        if (!resetAt || resetAt <= 0) {
            setTimeLeft('');
            return;
        }

        const update = () => {
            const now = Math.floor(Date.now() / 1000);
            const diff = resetAt - now;

            if (diff <= 0) {
                setTimeLeft('Sắp đặt lại');
                return;
            }

            const days = Math.floor(diff / 86400);
            const hours = Math.floor((diff % 86400) / 3600);
            const minutes = Math.floor((diff % 3600) / 60);
            const seconds = diff % 60;

            if (days > 0) {
                setTimeLeft(`Còn ${days} ngày ${hours} giờ ${minutes} phút`);
            } else if (hours > 0) {
                setTimeLeft(`Còn ${hours} giờ ${minutes} phút`);
            } else if (minutes > 0) {
                setTimeLeft(`Còn ${minutes} phút ${seconds} giây`);
            } else {
                setTimeLeft(`Còn ${seconds} giây`);
            }
        };

        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [resetAt]);

    return timeLeft;
}

/**
 * Minimal version of the countdown for table/list views (e.g. "4h 59m")
 */
export function useShortCountdown(resetAt?: number) {
    const [timeLeft, setTimeLeft] = useState<string>('');

    useEffect(() => {
        if (!resetAt || resetAt <= 0) {
            setTimeLeft('');
            return;
        }

        const update = () => {
            const now = Math.floor(Date.now() / 1000);
            const diff = resetAt - now;

            if (diff <= 0) {
                setTimeLeft('Sắp đặt lại');
                return;
            }

            const days = Math.floor(diff / 86400);
            const hours = Math.floor((diff % 86400) / 3600);
            const minutes = Math.floor((diff % 3600) / 60);

            if (days > 0) {
                setTimeLeft(`${days} ngày ${hours} giờ`);
            } else if (hours > 0) {
                setTimeLeft(`${hours} giờ ${minutes} phút`);
            } else if (minutes > 0) {
                setTimeLeft(`${minutes} phút`);
            } else {
                setTimeLeft(`${diff} giây`);
            }
        };

        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [resetAt]);

    return timeLeft;
}
