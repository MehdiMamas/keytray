/**
 * Watches the page for a code field, asks the background to poll faster,
 * and fills when a code arrives or the inline chip is clicked.
 */
import { browser } from 'wxt/browser';
import type { FillResponse } from '~/lib/messages';
import { fillCode } from '~/lib/otp-autofill';
import { getBestOtpField, type OtpFieldDetection } from '~/lib/otp-detector';
import { hideChip, showChip } from './chip';

const SCAN_DELAY_MS = 500;
const POLL_INTERVAL_MS = 3000;
const POLL_TICKS = 40;

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    if (!document.body) return;

    let detection: OtpFieldDetection | null = null;
    let locked = false;
    let lastUrl = location.href;
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let pollTicks = 0;

    const ping = async (message: unknown): Promise<unknown> => {
      try {
        return await browser.runtime.sendMessage(message);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (!text.includes('Could not establish connection') && !text.includes('Receiving end does not exist')) {
          return null;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        try {
          return await browser.runtime.sendMessage(message);
        } catch {
          return null;
        }
      }
    };

    const stopPoll = (): void => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
      pollTicks = 0;
    };

    const startPoll = (): void => {
      void ping({ type: 'OTP_PAGE_DETECTED' });
      if (pollTimer) return;
      pollTicks = 0;
      pollTimer = setInterval(() => {
        pollTicks += 1;
        if (pollTicks > POLL_TICKS) {
          stopPoll();
          return;
        }
        void ping({ type: 'POLL' });
      }, POLL_INTERVAL_MS);
    };

    const stillThere = (): boolean => {
      const element = detection?.element;
      if (!element || !document.body.contains(element)) return false;
      if (!element.offsetParent && element.style.position !== 'fixed') return false;
      return true;
    };

    const paintChip = (): void => {
      if (!detection || detection.confidence < 0.3) {
        hideChip();
        return;
      }
      const boxes = detection.type === 'split' ? detection.splitInputs : undefined;
      const anchor = boxes?.length ? boxes[boxes.length - 1]! : detection.element;
      showChip(anchor, boxes?.length ? 'outside' : 'inside', (code) => {
        if (detection) fillCode(detection, code, false);
      });
    };

    const clearPage = (): void => {
      hideChip();
      detection = null;
      locked = false;
      stopPoll();
    };

    const scan = (): void => {
      if (locked) return;
      const next = getBestOtpField(0.3);
      if (!next) return;
      detection = next;
      locked = true;
      paintChip();
      if (next.confidence >= 0.5) startPoll();
    };

    const scheduleScan = (): void => {
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(scan, SCAN_DELAY_MS);
    };

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const request = message as { type?: string; code?: string; autoSubmit?: boolean };
      if (request.type === 'HAS_OTP_FIELD') {
        sendResponse({ hasField: getBestOtpField(0.5) !== null });
        return;
      }
      if (request.type !== 'FILL_OTP' || !request.code) return;
      const target = getBestOtpField(0.5);
      if (!target) {
        sendResponse({ filled: false } satisfies FillResponse);
        return;
      }
      detection = target;
      fillCode(target, request.code, request.autoSubmit === true);
      paintChip();
      sendResponse({ filled: true } satisfies FillResponse);
    });

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.otpState || !detection || !stillThere()) return;
      paintChip();
    });

    const observer = new MutationObserver((mutations) => {
      const addedInput = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some(
          (node) => node instanceof HTMLElement && (node.tagName === 'INPUT' || node.querySelector('input')),
        ),
      );
      if (addedInput) scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener(
      'focusin',
      (event) => {
        if (!(event.target instanceof HTMLInputElement)) return;
        if (!locked) {
          scheduleScan();
          return;
        }
        const target = event.target;
        const hit = detection?.element === target || detection?.splitInputs?.includes(target);
        if (hit && (detection?.confidence ?? 0) >= 0.5) startPoll();
      },
      true,
    );

    window.addEventListener('beforeunload', () => hideChip());
    window.addEventListener('popstate', () => {
      clearPage();
      scheduleScan();
    });

    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        clearPage();
        scheduleScan();
        return;
      }
      if (locked && !stillThere()) {
        clearPage();
        scheduleScan();
      }
    }, SCAN_DELAY_MS);

    scheduleScan();
  },
});
