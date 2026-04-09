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

    let timeMachinePlaybackJson = null;

    function getChannelIdFromUrl(url = location.href) {
        return url.match(LIVE_PATH_REGEX)?.[1] ?? null;
    }

    function getTimeMachineInfoUrl(channelId) {
        return `${API_BASE_URL}/service/v1/channels/${channelId}/clip-time-machine-info`;
    }

    async function loadTimeMachinePlayback() {
        const channelId = getChannelIdFromUrl();
        if (!channelId) {
            return;
        }

        try {
            const response = await fetch(getTimeMachineInfoUrl(channelId), {
                credentials: "include",
            });
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            const playback = data?.content?.timeMachinePlayback;
            if (playback) {
                timeMachinePlaybackJson = JSON.stringify(playback);
            }
        } catch (error) {
            console.warn("[Chzzk Time Machine] 타임머신 정보 로드 실패", error);
        }
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

    function patchLiveDetailPayload(payloadText) {
        if (!timeMachinePlaybackJson) {
            return null;
        }

        try {
            const payload = JSON.parse(payloadText);
            if (!payload?.content) {
                return null;
            }

            payload.content.livePlaybackJson = timeMachinePlaybackJson;
            payload.content.p2pQuality = [];
            return JSON.stringify(payload);
        } catch (error) {
            console.warn("[Chzzk Time Machine] live-detail 응답 변환 실패", error);
            return null;
        }
    }

    const NativeXMLHttpRequest = unsafeWindow.XMLHttpRequest;

    unsafeWindow.XMLHttpRequest = class extends NativeXMLHttpRequest {
        constructor() {
            super();

            this.addEventListener("load", () => {
                if (!this.responseURL?.includes(LIVE_DETAIL_KEYWORD)) {
                    return;
                }

                const patchedText = patchLiveDetailPayload(this.responseText);
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
    };

    removeSliderOnLivePage();
    void loadTimeMachinePlayback();
})();
