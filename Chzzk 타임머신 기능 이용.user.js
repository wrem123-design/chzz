// ==UserScript==
// @name Chzzk 타임머신 기능 이용
// @namespace http://tampermonkey.net/
// @version 1.0.0
// @description 치지직 라이브 상세 응답에 타임머신 재생 정보를 주입합니다.
// @match https://chzzk.naver.com/*
// @match https://mul.live/*
// @icon https://chzzk.naver.com/favicon.ico
// @icon https://mul.live/favicon.ico
// @grant unsafeWindow
// @run-at document-start
// @license MIT
// ==/UserScript==

(function () {
    "use strict";

    const API_BASE_URL = "https://api.chzzk.naver.com";
    const LIVE_DETAIL_KEYWORD = "live-detail";
    const LIVE_PATH_REGEX = /\/live\/([^/?#]+)/;
    const SLIDER_SELECTOR = ".slider";
    const LIVE_DETAIL_FLAG = "__chzzkTimeMachineLiveDetail";
    const LIVE_DETAIL_CHANNEL_FLAG = "__chzzkTimeMachineChannelId";
    const BLOCKING_MODAL_TEXTS = [
        "허용되지 않는 비정상적 접근입니다",
        "타임머신 기능을 이용할 수 있어요",
        "치트키를 구매하면",
    ];

    let currentChannelId = getChannelIdFromUrl();
    const playbackCache = new Map();

    function getChannelIdFromUrl(url = location.href) {
        return url.match(LIVE_PATH_REGEX)?.[1] ?? null;
    }

    function getTimeMachineInfoUrl(channelId) {
        return `${API_BASE_URL}/service/v1/channels/${channelId}/clip-time-machine-info`;
    }

    function isLiveDetailRequestUrl(url) {
        if (!url) {
            return false;
        }

        try {
            return new URL(url, location.origin).pathname.includes(LIVE_DETAIL_KEYWORD);
        } catch {
            return String(url).includes(LIVE_DETAIL_KEYWORD);
        }
    }

    function deepClone(value) {
        return value ? JSON.parse(JSON.stringify(value)) : value;
    }

    function parseJsonSafely(value) {
        if (!value) {
            return null;
        }

        if (typeof value === "string") {
            try {
                return JSON.parse(value);
            } catch {
                return null;
            }
        }

        if (typeof value === "object") {
            return deepClone(value);
        }

        return null;
    }

    function mergePlayback(basePlayback, overridePlayback) {
        const base = parseJsonSafely(basePlayback) ?? {};
        const override = parseJsonSafely(overridePlayback) ?? {};
        const merged = { ...base, ...override };

        merged.live = {
            ...(base.live ?? {}),
            ...(override.live ?? {}),
        };

        if (Array.isArray(override.media) && override.media.length > 0) {
            merged.media = deepClone(override.media);
        } else if (Array.isArray(base.media) && base.media.length > 0) {
            merged.media = deepClone(base.media);
        }

        return merged;
    }

    function normalizePlayback(playbackSource) {
        const playback = parseJsonSafely(playbackSource);
        if (!playback) {
            return null;
        }

        const normalized = deepClone(playback);
        normalized.live = {
            ...(normalized.live ?? {}),
            timeMachine: true,
            timeMachineActive: true,
            timeMachineState: "AVAILABLE",
        };

        return normalized;
    }

    function getPlaybackEntry(channelId) {
        if (!playbackCache.has(channelId)) {
            playbackCache.set(channelId, {
                playback: null,
                promise: null,
            });
        }

        return playbackCache.get(channelId);
    }

    function getCachedPlayback(channelId = currentChannelId) {
        if (!channelId) {
            return null;
        }

        return getPlaybackEntry(channelId).playback;
    }

    function ensureTimeMachinePlayback(channelId = currentChannelId) {
        if (!channelId) {
            return Promise.resolve();
        }

        const entry = getPlaybackEntry(channelId);
        if (entry.promise) {
            return entry.promise;
        }

        entry.promise = (async () => {
            const response = await fetch(getTimeMachineInfoUrl(channelId), {
                credentials: "include",
            });
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            const playback = data?.content?.timeMachinePlayback;
            if (playback) {
                entry.playback = deepClone(playback);
            }
        })().catch((error) => {
            console.warn("[Chzzk Time Machine] 타임머신 정보 로드 실패", error);
        }).finally(() => {
            entry.promise = null;
        });

        return entry.promise;
    }

    function removeSliderOnLivePage() {
        if (!location.pathname.includes("/live/")) {
            return;
        }

        const observer = new MutationObserver((_, mutationObserver) => {
            const slider = document.querySelector(SLIDER_SELECTOR);
            if (!slider) {
                return;
            }
            slider.remove();
            mutationObserver.disconnect();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    function patchLiveDetailPayload(payloadText, channelId = currentChannelId) {
        try {
            const payload = JSON.parse(payloadText);
            if (!payload?.content) {
                return null;
            }

            const cachedPlayback = getCachedPlayback(channelId);
            const playback = normalizePlayback(
                mergePlayback(payload.content.livePlaybackJson, cachedPlayback)
            );
            if (!playback) {
                return null;
            }

            const playbackJson = JSON.stringify(playback);
            payload.content.timeMachinePlayback = cachedPlayback ?? true;
            payload.content.timeMachinePlaybackJson = playbackJson;
            payload.content.livePlaybackJson = playbackJson;
            payload.content.liveRewindPlaybackJson = playbackJson;
            payload.content.p2pQuality = [];

            if (payload.content.live && typeof payload.content.live === "object") {
                payload.content.live.timeMachinePlayback = true;
                payload.content.live.timeMachineActive = true;
                payload.content.live.timeMachineState = "AVAILABLE";
            }

            return JSON.stringify(payload);
        } catch (error) {
            console.warn("[Chzzk Time Machine] live-detail 응답 변환 실패", error);
            return null;
        }
    }

    function removeBlockingModal(root = document) {
        const candidates = root.querySelectorAll("div, section, article");
        for (const element of candidates) {
            const text = element.textContent?.trim();
            if (!text) {
                continue;
            }

            if (!BLOCKING_MODAL_TEXTS.some((keyword) => text.includes(keyword))) {
                continue;
            }

            const dialog =
                element.closest('[role="dialog"]') ??
                element.closest('[class*="modal"]') ??
                element.closest('[class*="layer"]') ??
                element;

            dialog.remove();
            return true;
        }

        return false;
    }

    function watchBlockingModal() {
        const observer = new MutationObserver(() => {
            removeBlockingModal();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    function handleRouteChange(url = location.href) {
        const nextChannelId = getChannelIdFromUrl(String(url));
        if (nextChannelId === currentChannelId) {
            return;
        }

        currentChannelId = nextChannelId;
        removeBlockingModal();
        removeSliderOnLivePage();
        void ensureTimeMachinePlayback(nextChannelId);
    }

    function installNavigationHook() {
        const { history } = unsafeWindow;
        const wrapMethod = (methodName) => {
            const nativeMethod = history[methodName];
            history[methodName] = function (...args) {
                const result = nativeMethod.apply(this, args);
                queueMicrotask(() => {
                    handleRouteChange(args[2] ?? location.href);
                });
                return result;
            };
        };

        wrapMethod("pushState");
        wrapMethod("replaceState");
        unsafeWindow.addEventListener("popstate", () => {
            handleRouteChange();
        });
    }

    const { XMLHttpRequest: NativeXMLHttpRequest } = unsafeWindow;
    const nativeOpen = NativeXMLHttpRequest.prototype.open;
    const nativeSend = NativeXMLHttpRequest.prototype.send;

    NativeXMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this[LIVE_DETAIL_FLAG] = isLiveDetailRequestUrl(url);
        this[LIVE_DETAIL_CHANNEL_FLAG] = currentChannelId;

        if (this[LIVE_DETAIL_FLAG] && !this.__chzzkTimeMachinePatched) {
            this.__chzzkTimeMachinePatched = true;

            this.addEventListener("load", () => {
                if (!isLiveDetailRequestUrl(this.responseURL)) {
                    return;
                }

                const patchedText = patchLiveDetailPayload(
                    this.responseText,
                    this[LIVE_DETAIL_CHANNEL_FLAG]
                );
                if (!patchedText) {
                    return;
                }

                Object.defineProperty(this, "responseText", {
                    configurable: true,
                    get: () => patchedText,
                });
                Object.defineProperty(this, "response", {
                    configurable: true,
                    get: () => patchedText,
                });
            });
        }

        return nativeOpen.call(this, method, url, ...rest);
    };

    NativeXMLHttpRequest.prototype.send = function (...args) {
        if (!this[LIVE_DETAIL_FLAG]) {
            return nativeSend.apply(this, args);
        }

        ensureTimeMachinePlayback(this[LIVE_DETAIL_CHANNEL_FLAG]).finally(() => {
            nativeSend.apply(this, args);
        });

        return undefined;
    };

    installNavigationHook();
    removeSliderOnLivePage();
    watchBlockingModal();
    void ensureTimeMachinePlayback(currentChannelId);
})();
