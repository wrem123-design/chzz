// ==UserScript==
// @name Chzzk 타임머신 기능 이용
// @namespace http://tampermonkey.net/
// @version 1.1.7
// @description 치지직 라이브에서 버튼으로 타임머신을 시도합니다.
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

    const LIVE_SERVICE_V1_1_BASE_URL = "https://api.chzzk.naver.com/service/v1.1";
    const LIVE_DETAIL_KEYWORD = "/live-detail";
    const LIVE_PLAYBACK_KEYWORD = "/live-playback-json";
    const TIME_MACHINE_INFO_KEYWORD = "/clip-time-machine-info";
    const LIVE_PATH_REGEX = /\/live\/([^/?#]+)/;
    const CHANNEL_API_PATH_REGEX = /\/channels\/([^/?#]+)/;
    const SLIDER_SELECTOR = ".slider";
    const LIVE_DETAIL_FLAG = "__chzzkTimeMachineLiveDetail";
    const LIVE_PLAYBACK_FLAG = "__chzzkTimeMachineLivePlayback";
    const TIME_MACHINE_INFO_FLAG = "__chzzkTimeMachineInfo";
    const REQUEST_CHANNEL_FLAG = "__chzzkTimeMachineChannelId";
    const TOGGLE_SESSION_KEY = "__chzzkTimeMachineEnabledChannelId";
    const TOGGLE_POSITION_STORAGE_KEY = "__chzzkTimeMachineTogglePosition";
    const TOGGLE_LOCK_STORAGE_KEY = "__chzzkTimeMachineToggleLock";
    const TOGGLE_SCALE_STORAGE_KEY = "__chzzkTimeMachineToggleScale";
    const TOGGLE_BUTTON_ID = "__chzzkTimeMachineToggleButton";
    const TOGGLE_STYLE_ID = "__chzzkTimeMachineToggleStyle";
    const TOGGLE_MENU_ID = "__chzzkTimeMachineToggleMenu";
    const TOGGLE_DEFAULT_OFFSET = {
        top: 96,
        right: 24,
    };
    const TOGGLE_DRAG_THRESHOLD = 4;
    const TOGGLE_SCALE_MIN = 50;
    const TOGGLE_SCALE_MAX = 150;
    const TOGGLE_SCALE_DEFAULT = 50;
    const BLOCKING_MODAL_TEXTS = [
        "허용되지 않는 비정상적 접근입니다",
        "타임머신 기능을 이용할 수 있어요",
        "치트키를 구매하면",
    ];
    const LOG_PREFIX = "[Chzzk Time Machine 1.1.7]";

    let currentChannelId = getChannelIdFromUrl();
    const playbackCache = new Map();
    let timeMachineCapabilityPromise = null;

    console.info(`${LOG_PREFIX} script start`);

    function getSessionStorage() {
        return unsafeWindow.sessionStorage ?? sessionStorage;
    }

    function getLocalStorage() {
        return unsafeWindow.localStorage ?? localStorage;
    }

    function clampToggleScaleValue(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return TOGGLE_SCALE_DEFAULT;
        }

        return Math.min(TOGGLE_SCALE_MAX, Math.max(TOGGLE_SCALE_MIN, Math.round(numericValue)));
    }

    function getToggleScaleValue() {
        try {
            const rawValue = getLocalStorage().getItem(TOGGLE_SCALE_STORAGE_KEY);
            if (rawValue === null) {
                return TOGGLE_SCALE_DEFAULT;
            }

            return clampToggleScaleValue(rawValue);
        } catch {
            return TOGGLE_SCALE_DEFAULT;
        }
    }

    function setToggleScaleValue(value) {
        const nextValue = clampToggleScaleValue(value);

        try {
            getLocalStorage().setItem(TOGGLE_SCALE_STORAGE_KEY, String(nextValue));
        } catch {
            // Ignore storage failures and keep runtime behavior intact.
        }

        return nextValue;
    }

    function isTogglePositionLocked() {
        try {
            return getLocalStorage().getItem(TOGGLE_LOCK_STORAGE_KEY) === "true";
        } catch {
            return false;
        }
    }

    function setTogglePositionLocked(locked) {
        try {
            getLocalStorage().setItem(TOGGLE_LOCK_STORAGE_KEY, String(Boolean(locked)));
        } catch {
            // Ignore storage failures and keep runtime behavior intact.
        }
    }

    function getEnabledChannelId() {
        try {
            return getSessionStorage().getItem(TOGGLE_SESSION_KEY);
        } catch {
            return null;
        }
    }

    function setEnabledChannelId(channelId) {
        if (!channelId) {
            return;
        }

        try {
            getSessionStorage().setItem(TOGGLE_SESSION_KEY, channelId);
        } catch {
            // Ignore storage failures and keep runtime behavior intact.
        }
    }

    function clearEnabledChannelId(channelId = null) {
        try {
            const enabledChannelId = getEnabledChannelId();
            if (channelId && enabledChannelId !== channelId) {
                return;
            }

            getSessionStorage().removeItem(TOGGLE_SESSION_KEY);
        } catch {
            // Ignore storage failures and keep runtime behavior intact.
        }
    }

    function getChannelIdFromUrl(url = location.href) {
        return url.match(LIVE_PATH_REGEX)?.[1] ?? null;
    }

    function getChannelIdFromApiUrl(url) {
        if (!url) {
            return null;
        }

        try {
            return new URL(url, location.origin).pathname.match(CHANNEL_API_PATH_REGEX)?.[1] ?? null;
        } catch {
            return String(url).match(CHANNEL_API_PATH_REGEX)?.[1] ?? null;
        }
    }

    function isLivePage(url = location.href) {
        return Boolean(getChannelIdFromUrl(String(url)));
    }

    function isTimeMachineEnabled(channelId = currentChannelId) {
        return Boolean(channelId) && getEnabledChannelId() === channelId;
    }

    function clearPlaybackEntry(channelId = currentChannelId) {
        if (!channelId) {
            return;
        }

        playbackCache.delete(channelId);
    }

    function getToggleButtonState(channelId = currentChannelId) {
        if (!channelId || !isTimeMachineEnabled(channelId)) {
            return "idle";
        }

        const entry = playbackCache.get(channelId);
        if (entry?.livePlaybackTmp === true || entry?.timeMachinePlayback) {
            return "active";
        }

        return "pending";
    }

    function loadToggleButtonPosition() {
        try {
            const rawValue = getLocalStorage().getItem(TOGGLE_POSITION_STORAGE_KEY);
            if (!rawValue) {
                return null;
            }

            const parsed = JSON.parse(rawValue);
            if (!Number.isFinite(parsed?.left) || !Number.isFinite(parsed?.top)) {
                return null;
            }

            return {
                left: Math.round(parsed.left),
                top: Math.round(parsed.top),
            };
        } catch {
            return null;
        }
    }

    function saveToggleButtonPosition(position) {
        if (!position) {
            return;
        }

        try {
            getLocalStorage().setItem(
                TOGGLE_POSITION_STORAGE_KEY,
                JSON.stringify({
                    left: Math.round(position.left),
                    top: Math.round(position.top),
                })
            );
        } catch {
            // Ignore storage failures and keep runtime behavior intact.
        }
    }

    function clampToggleButtonPosition(position, button) {
        const rect = button.getBoundingClientRect();
        const maxLeft = Math.max(0, unsafeWindow.innerWidth - rect.width);
        const maxTop = Math.max(0, unsafeWindow.innerHeight - rect.height);

        return {
            left: Math.min(Math.max(0, Math.round(position.left)), maxLeft),
            top: Math.min(Math.max(0, Math.round(position.top)), maxTop),
        };
    }

    function applyToggleButtonPosition(button) {
        const savedPosition = loadToggleButtonPosition();
        if (savedPosition) {
            const nextPosition = clampToggleButtonPosition(savedPosition, button);
            button.style.left = `${nextPosition.left}px`;
            button.style.top = `${nextPosition.top}px`;
            button.style.right = "auto";
            saveToggleButtonPosition(nextPosition);
            return;
        }

        button.style.left = "auto";
        button.style.top = `${TOGGLE_DEFAULT_OFFSET.top}px`;
        button.style.right = `${TOGGLE_DEFAULT_OFFSET.right}px`;
    }

    function applyToggleButtonScale(button) {
        const scaleMultiplier = getToggleScaleValue() / TOGGLE_SCALE_MIN;
        button.style.setProperty("--chzzk-time-machine-scale", scaleMultiplier.toFixed(2));

        const savedPosition = loadToggleButtonPosition();
        if (!savedPosition) {
            return;
        }

        const nextPosition = clampToggleButtonPosition(savedPosition, button);
        button.style.left = `${nextPosition.left}px`;
        button.style.top = `${nextPosition.top}px`;
        button.style.right = "auto";
        saveToggleButtonPosition(nextPosition);
    }

    function installToggleButtonDrag(button) {
        if (button.__chzzkTimeMachineDragInstalled) {
            return;
        }

        button.__chzzkTimeMachineDragInstalled = true;
        let dragState = null;

        const finishDrag = (event) => {
            if (!dragState) {
                return;
            }

            if (event && typeof event.pointerId === "number" && event.pointerId !== dragState.pointerId) {
                return;
            }

            const { moved, pointerId } = dragState;
            dragState = null;

            if (typeof pointerId === "number" && button.hasPointerCapture?.(pointerId)) {
                button.releasePointerCapture(pointerId);
            }

            button.removeAttribute("data-drag-state");

            if (!moved) {
                return;
            }

            const nextPosition = clampToggleButtonPosition(
                {
                    left: button.getBoundingClientRect().left,
                    top: button.getBoundingClientRect().top,
                },
                button
            );

            button.style.left = `${nextPosition.left}px`;
            button.style.top = `${nextPosition.top}px`;
            button.style.right = "auto";
            button.dataset.suppressClick = "true";
            saveToggleButtonPosition(nextPosition);
        };

        button.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) {
                return;
            }

            if (isTogglePositionLocked()) {
                return;
            }

            const rect = button.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startLeft: rect.left,
                startTop: rect.top,
                moved: false,
            };

            button.setPointerCapture?.(event.pointerId);
            button.dataset.dragState = "ready";
        });

        button.addEventListener("pointermove", (event) => {
            if (!dragState || event.pointerId !== dragState.pointerId) {
                return;
            }

            const deltaX = event.clientX - dragState.startX;
            const deltaY = event.clientY - dragState.startY;

            if (!dragState.moved && Math.hypot(deltaX, deltaY) < TOGGLE_DRAG_THRESHOLD) {
                return;
            }

            dragState.moved = true;
            button.dataset.dragState = "dragging";

            const nextPosition = clampToggleButtonPosition(
                {
                    left: dragState.startLeft + deltaX,
                    top: dragState.startTop + deltaY,
                },
                button
            );

            button.style.left = `${nextPosition.left}px`;
            button.style.top = `${nextPosition.top}px`;
            button.style.right = "auto";
            event.preventDefault();
        });

        button.addEventListener("pointerup", finishDrag);
        button.addEventListener("pointercancel", finishDrag);
        button.addEventListener("lostpointercapture", finishDrag);
        button.addEventListener("dragstart", (event) => {
            event.preventDefault();
        });
    }

    function ensureToggleStyle() {
        if (document.getElementById(TOGGLE_STYLE_ID)) {
            return;
        }

        const style = document.createElement("style");
        style.id = TOGGLE_STYLE_ID;
        style.textContent = `
            #${TOGGLE_BUTTON_ID} {
                position: fixed;
                z-index: 2147483647;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: calc(48px * var(--chzzk-time-machine-scale, 1));
                height: calc(20px * var(--chzzk-time-machine-scale, 1));
                padding: 0 calc(8px * var(--chzzk-time-machine-scale, 1));
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 9999px;
                background: rgba(17, 19, 21, 0.88);
                color: #ffffff;
                font-size: calc(8px * var(--chzzk-time-machine-scale, 1));
                font-weight: 700;
                line-height: 1;
                cursor: grab;
                user-select: none;
                touch-action: none;
                backdrop-filter: blur(12px);
                box-shadow: 0 calc(6px * var(--chzzk-time-machine-scale, 1))
                    calc(14px * var(--chzzk-time-machine-scale, 1)) rgba(0, 0, 0, 0.28);
                transition: background-color 0.18s ease, transform 0.18s ease, opacity 0.18s ease;
            }

            #${TOGGLE_BUTTON_ID}[data-state="pending"] {
                background: rgba(205, 126, 18, 0.92);
            }

            #${TOGGLE_BUTTON_ID}[data-state="active"] {
                background: rgba(18, 166, 95, 0.94);
            }

            #${TOGGLE_BUTTON_ID}:hover {
                transform: translateY(-1px);
            }

            #${TOGGLE_BUTTON_ID}[data-drag-state="dragging"] {
                cursor: grabbing;
                transform: none;
            }

            #${TOGGLE_BUTTON_ID}[data-position-locked="true"] {
                cursor: pointer;
            }

            #${TOGGLE_MENU_ID} {
                position: fixed;
                z-index: 2147483647;
                min-width: 176px;
                padding: 12px;
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 14px;
                background: rgba(17, 19, 21, 0.96);
                color: #ffffff;
                font-size: 12px;
                line-height: 1.4;
                box-shadow: 0 16px 36px rgba(0, 0, 0, 0.32);
                backdrop-filter: blur(18px);
            }

            #${TOGGLE_MENU_ID}[hidden] {
                display: none;
            }

            #${TOGGLE_MENU_ID} .tm-menu-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            #${TOGGLE_MENU_ID} .tm-menu-row + .tm-menu-row {
                margin-top: 10px;
            }

            #${TOGGLE_MENU_ID} .tm-menu-row--stack {
                flex-direction: column;
                align-items: stretch;
                gap: 6px;
            }

            #${TOGGLE_MENU_ID} .tm-menu-check {
                width: 14px;
                height: 14px;
                margin: 0;
            }

            #${TOGGLE_MENU_ID} .tm-menu-scale-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
            }

            #${TOGGLE_MENU_ID} .tm-menu-scale-value {
                color: rgba(255, 255, 255, 0.76);
                font-variant-numeric: tabular-nums;
            }

            #${TOGGLE_MENU_ID} .tm-menu-scale-input {
                width: 100%;
                margin: 0;
            }
        `;

        document.documentElement.appendChild(style);
    }

    function disableTimeMachine(channelId = currentChannelId, reason = "manual") {
        if (!channelId || getEnabledChannelId() !== channelId) {
            return;
        }

        clearEnabledChannelId(channelId);
        clearPlaybackEntry(channelId);
        console.info(`${LOG_PREFIX} toggle disabled`, { channelId, reason });
        queueMicrotask(updateToggleButton);
    }

    function enableTimeMachine(channelId = currentChannelId) {
        if (!channelId) {
            return;
        }

        setEnabledChannelId(channelId);
        clearPlaybackEntry(channelId);
        console.info(`${LOG_PREFIX} toggle enabled`, { channelId });
        queueMicrotask(updateToggleButton);
    }

    function hideToggleMenu() {
        const menu = document.getElementById(TOGGLE_MENU_ID);
        if (!menu) {
            return;
        }

        menu.hidden = true;
    }

    function updateToggleMenu() {
        const menu = document.getElementById(TOGGLE_MENU_ID);
        if (!menu) {
            return;
        }

        const lockInput = menu.querySelector(".tm-menu-check");
        const scaleInput = menu.querySelector(".tm-menu-scale-input");
        const scaleValue = menu.querySelector(".tm-menu-scale-value");

        if (lockInput instanceof HTMLInputElement) {
            lockInput.checked = isTogglePositionLocked();
        }

        const scale = getToggleScaleValue();
        if (scaleInput instanceof HTMLInputElement) {
            scaleInput.value = String(scale);
        }

        if (scaleValue) {
            scaleValue.textContent = `${scale}%`;
        }
    }

    function positionToggleMenu(menu, anchorX, anchorY) {
        menu.hidden = false;
        menu.style.left = "0px";
        menu.style.top = "0px";
        menu.style.visibility = "hidden";

        const rect = menu.getBoundingClientRect();
        const nextLeft = Math.min(
            Math.max(8, Math.round(anchorX)),
            Math.max(8, unsafeWindow.innerWidth - rect.width - 8)
        );
        const nextTop = Math.min(
            Math.max(8, Math.round(anchorY)),
            Math.max(8, unsafeWindow.innerHeight - rect.height - 8)
        );

        menu.style.left = `${nextLeft}px`;
        menu.style.top = `${nextTop}px`;
        menu.style.visibility = "visible";
    }

    function ensureToggleMenu() {
        let menu = document.getElementById(TOGGLE_MENU_ID);
        if (menu) {
            updateToggleMenu();
            return menu;
        }

        menu = document.createElement("div");
        menu.id = TOGGLE_MENU_ID;
        menu.hidden = true;
        menu.innerHTML = `
            <label class="tm-menu-row">
                <input class="tm-menu-check" type="checkbox">
                <span>위치 잠금</span>
            </label>
            <div class="tm-menu-row tm-menu-row--stack">
                <div class="tm-menu-scale-header">
                    <span>UI 크기</span>
                    <span class="tm-menu-scale-value">${TOGGLE_SCALE_DEFAULT}%</span>
                </div>
                <input
                    class="tm-menu-scale-input"
                    type="range"
                    min="${TOGGLE_SCALE_MIN}"
                    max="${TOGGLE_SCALE_MAX}"
                    step="10"
                    value="${TOGGLE_SCALE_DEFAULT}"
                >
            </div>
        `;

        const lockInput = menu.querySelector(".tm-menu-check");
        const scaleInput = menu.querySelector(".tm-menu-scale-input");

        if (lockInput instanceof HTMLInputElement) {
            lockInput.addEventListener("change", () => {
                setTogglePositionLocked(lockInput.checked);
                updateToggleButton();
                updateToggleMenu();
            });
        }

        if (scaleInput instanceof HTMLInputElement) {
            scaleInput.addEventListener("input", () => {
                setToggleScaleValue(scaleInput.value);
                updateToggleButton();
                updateToggleMenu();
            });
        }

        menu.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
        });
        menu.addEventListener("click", (event) => {
            event.stopPropagation();
        });
        menu.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        document.body.appendChild(menu);

        if (!document.__chzzkTimeMachineMenuDismissInstalled) {
            document.__chzzkTimeMachineMenuDismissInstalled = true;

            unsafeWindow.addEventListener("pointerdown", (event) => {
                const button = document.getElementById(TOGGLE_BUTTON_ID);
                const activeMenu = document.getElementById(TOGGLE_MENU_ID);
                if (!activeMenu || activeMenu.hidden) {
                    return;
                }

                const target = event.target;
                if (button?.contains(target) || activeMenu.contains(target)) {
                    return;
                }

                hideToggleMenu();
            });

            unsafeWindow.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                    hideToggleMenu();
                }
            });

            unsafeWindow.addEventListener("resize", () => {
                updateToggleButton();
                hideToggleMenu();
            });
        }

        updateToggleMenu();
        return menu;
    }

    function showToggleMenu(button, anchorX, anchorY) {
        const menu = ensureToggleMenu();
        if (!menu) {
            return;
        }

        updateToggleMenu();
        const buttonRect = button.getBoundingClientRect();
        positionToggleMenu(menu, anchorX ?? buttonRect.right + 8, anchorY ?? buttonRect.top);
    }

    function ensureToggleButton() {
        if (!document.body || !isLivePage()) {
            return null;
        }

        ensureToggleStyle();

        let button = document.getElementById(TOGGLE_BUTTON_ID);
        if (button) {
            return button;
        }

        button = document.createElement("button");
        button.id = TOGGLE_BUTTON_ID;
        button.type = "button";
        button.textContent = "타임머신";
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            hideToggleMenu();

            if (button.dataset.suppressClick === "true") {
                button.dataset.suppressClick = "false";
                return;
            }

            const channelId = getChannelIdFromUrl();
            if (!channelId) {
                return;
            }

            if (isTimeMachineEnabled(channelId)) {
                disableTimeMachine(channelId, "manualToggleOff");
            } else {
                enableTimeMachine(channelId);
            }

            unsafeWindow.location.reload();
        });
        button.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            showToggleMenu(button, event.clientX + 8, event.clientY + 8);
        });

        document.body.appendChild(button);
        applyToggleButtonPosition(button);
        installToggleButtonDrag(button);
        applyToggleButtonScale(button);
        return button;
    }

    function updateToggleButton() {
        const existingButton = document.getElementById(TOGGLE_BUTTON_ID);
        if (!isLivePage() || !document.body) {
            existingButton?.remove();
            hideToggleMenu();
            return;
        }

        const button = existingButton ?? ensureToggleButton();
        if (!button) {
            return;
        }

        applyToggleButtonScale(button);
        const state = getToggleButtonState();
        button.dataset.state = state;
        button.dataset.positionLocked = String(isTogglePositionLocked());
        button.textContent = "타임머신";
        button.setAttribute("aria-pressed", String(isTimeMachineEnabled(currentChannelId)));

        if (state === "active") {
            button.title = "현재 방송에서 타임머신이 활성화되어 있습니다. 우클릭으로 설정을 열 수 있습니다.";
            return;
        }

        if (state === "pending") {
            button.title = "현재 방송에서 타임머신을 시도 중입니다. 우클릭으로 설정을 열 수 있습니다.";
            return;
        }

        button.title = "현재 방송에서 타임머신을 시도합니다. 우클릭으로 설정을 열 수 있습니다.";
    }

    function installToggleButton() {
        if (document.body) {
            updateToggleButton();
            return;
        }

        const observer = new MutationObserver(() => {
            if (!document.body) {
                return;
            }

            observer.disconnect();
            updateToggleButton();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    function syncEnabledChannel(channelId = currentChannelId) {
        const enabledChannelId = getEnabledChannelId();
        if (!enabledChannelId) {
            queueMicrotask(updateToggleButton);
            return;
        }

        if (!channelId || enabledChannelId !== channelId) {
            disableTimeMachine(enabledChannelId, channelId ? "channelChanged" : "leftLivePage");
            return;
        }

        queueMicrotask(updateToggleButton);
    }

    function getTimeMachineInfoUrl(channelId) {
        return `${LIVE_SERVICE_V1_1_BASE_URL}/channels/${channelId}/clip-time-machine-info`;
    }

    function getTimeMachineCapability() {
        if (timeMachineCapabilityPromise) {
            return timeMachineCapabilityPromise;
        }

        timeMachineCapabilityPromise = (async () => {
            const requestMediaKeySystemAccess =
                unsafeWindow.navigator?.requestMediaKeySystemAccess?.bind(unsafeWindow.navigator);

            if (!requestMediaKeySystemAccess) {
                return true;
            }

            try {
                await requestMediaKeySystemAccess("com.naver.lip.smp", [
                    {
                        initDataTypes: ["uri-redirect"],
                        videoCapabilities: [
                            {
                                contentType: "application/x-mpegURL",
                            },
                        ],
                    },
                ]);
                return true;
            } catch {
                return false;
            }
        })();

        return timeMachineCapabilityPromise;
    }

    function hasPathKeyword(url, keyword) {
        if (!url) {
            return false;
        }

        try {
            return new URL(url, location.origin).pathname.includes(keyword);
        } catch {
            return String(url).includes(keyword);
        }
    }

    function isLiveDetailRequestUrl(url) {
        return hasPathKeyword(url, LIVE_DETAIL_KEYWORD);
    }

    function isLivePlaybackRequestUrl(url) {
        return hasPathKeyword(url, LIVE_PLAYBACK_KEYWORD);
    }

    function isTimeMachineInfoRequestUrl(url) {
        return hasPathKeyword(url, TIME_MACHINE_INFO_KEYWORD);
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
                timeMachineInfo: null,
                timeMachinePlayback: null,
                timeMachineActive: null,
                liveOpenDate: null,
                livePlaybackJson: null,
                livePlaybackTmp: null,
                timeMachinePromise: null,
                livePlaybackPromise: null,
            });
        }

        return playbackCache.get(channelId);
    }

    function getCachedTimeMachinePlayback(channelId = currentChannelId) {
        if (!channelId) {
            return null;
        }

        return getPlaybackEntry(channelId).timeMachinePlayback;
    }

    function getCachedLivePlaybackJson(channelId = currentChannelId) {
        if (!channelId) {
            return null;
        }

        return getPlaybackEntry(channelId).livePlaybackJson;
    }

    function getCachedTimeMachineInfo(channelId = currentChannelId) {
        if (!channelId) {
            return null;
        }

        return getPlaybackEntry(channelId).timeMachineInfo;
    }

    function syncTimeMachineInfoEntry(channelId, content) {
        if (!channelId || !content || typeof content !== "object") {
            return;
        }

        const entry = getPlaybackEntry(channelId);
        entry.timeMachineInfo = deepClone(content);

        if (typeof content.timeMachineActive === "boolean") {
            entry.timeMachineActive = content.timeMachineActive;
        }

        if (content.timeMachinePlayback) {
            entry.timeMachinePlayback = deepClone(content.timeMachinePlayback);
        }

        if (content.liveOpenDate) {
            entry.liveOpenDate = content.liveOpenDate;
        } else if (content.openDate && !entry.liveOpenDate) {
            entry.liveOpenDate = content.openDate;
        }
    }

    function hasInjectedPlayback(channelId = currentChannelId) {
        if (!channelId) {
            return false;
        }

        const entry = getPlaybackEntry(channelId);
        return Boolean(entry.timeMachinePlayback);
    }

    function ensureTimeMachinePlayback(channelId = currentChannelId) {
        if (!channelId || !isTimeMachineEnabled(channelId)) {
            return Promise.resolve();
        }

        const entry = getPlaybackEntry(channelId);
        if (entry.timeMachinePromise) {
            return entry.timeMachinePromise;
        }

        entry.timeMachinePromise = (async () => {
            const response = await fetch(getTimeMachineInfoUrl(channelId), {
                credentials: "include",
            });
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            syncTimeMachineInfoEntry(channelId, data?.content);
        })().catch((error) => {
            console.warn(`${LOG_PREFIX} 타임머신 정보 로드 실패`, error);
        }).finally(() => {
            entry.timeMachinePromise = null;
            queueMicrotask(updateToggleButton);
        });

        return entry.timeMachinePromise;
    }

    function ensureLivePlayback(channelId = currentChannelId) {
        if (!channelId || !isTimeMachineEnabled(channelId)) {
            return Promise.resolve();
        }

        const entry = getPlaybackEntry(channelId);
        if (entry.livePlaybackPromise) {
            return entry.livePlaybackPromise;
        }

        entry.livePlaybackPromise = (async () => {
            const tm = await getTimeMachineCapability();
            const query = new URLSearchParams({
                tm: String(tm),
            });
            const response = await fetch(
                `${LIVE_SERVICE_V1_1_BASE_URL}/channels/${channelId}/live-playback-json?${query}`,
                {
                credentials: "include",
                }
            );
            if (!response.ok) {
                return;
            }

            const data = await response.json();
            const playbackJson = data?.content?.playbackJson;
            if (playbackJson) {
                entry.livePlaybackJson = playbackJson;
            }

            if (typeof data?.content?.tmp === "boolean") {
                entry.livePlaybackTmp = data.content.tmp;
            }

            const timeMachinePromise = entry.timeMachinePromise;
            if (timeMachinePromise) {
                await timeMachinePromise.catch(() => {});
            }

            if (isTimeMachineEnabled(channelId) && entry.livePlaybackTmp !== true && !entry.timeMachinePlayback) {
                disableTimeMachine(channelId, "unsupportedPreload");
            }

            console.info(`${LOG_PREFIX} live-playback preload`, {
                channelId,
                tm,
                tmp: entry.livePlaybackTmp,
                hasPlaybackJson: Boolean(playbackJson),
                hasTimeMachinePlayback: Boolean(entry.timeMachinePlayback),
            });
        })().catch((error) => {
            console.warn(`${LOG_PREFIX} live-playback-json 로드 실패`, error);
        }).finally(() => {
            entry.livePlaybackPromise = null;
            queueMicrotask(updateToggleButton);
        });

        return entry.livePlaybackPromise;
    }

    function ensureLiveDetailPrerequisites(channelId = currentChannelId) {
        return ensureTimeMachinePlayback(channelId);
    }

    function buildPatchedPlayback(channelId, fallbackPlayback) {
        const entry = getPlaybackEntry(channelId);
        const basePlayback =
            entry.livePlaybackJson ??
            fallbackPlayback ??
            entry.timeMachinePlayback;

        return normalizePlayback(
            mergePlayback(basePlayback, entry.timeMachinePlayback)
        );
    }

    function buildPatchedTimeMachineInfo(channelId, fallbackContent = null) {
        const entry = getPlaybackEntry(channelId);
        const baseContent =
            (fallbackContent && typeof fallbackContent === "object" ? fallbackContent : null) ??
            getCachedTimeMachineInfo(channelId) ??
            {};
        const patchedContent = deepClone(baseContent);
        const hasPlayback = hasInjectedPlayback(channelId);

        patchedContent.channelId ??= channelId;
        patchedContent.timeMachineActive =
            hasPlayback || patchedContent.timeMachineActive === true;

        if (entry.liveOpenDate && !patchedContent.liveOpenDate) {
            patchedContent.liveOpenDate = entry.liveOpenDate;
        }

        if (hasPlayback) {
            patchedContent.timeMachinePlayback = getCachedTimeMachinePlayback(channelId);
        }

        return patchedContent;
    }

    function patchLiveDetailPayload(payloadText, channelId = currentChannelId) {
        try {
            if (!isTimeMachineEnabled(channelId)) {
                return null;
            }

            const payload = JSON.parse(payloadText);
            if (!payload?.content) {
                return null;
            }

            if (!hasInjectedPlayback(channelId)) {
                console.info(`${LOG_PREFIX} live-detail patch skipped`, {
                    channelId,
                    reason: "noTimeMachinePlayback",
                });
                return null;
            }

            const playback = buildPatchedPlayback(
                channelId,
                payload.content.liveRewindPlaybackJson ?? payload.content.livePlaybackJson
            );
            if (!playback) {
                return null;
            }

            const playbackJson = JSON.stringify(playback);
            payload.content.timeMachinePlayback =
                getCachedTimeMachinePlayback(channelId) ??
                (hasInjectedPlayback(channelId) ? true : payload.content.timeMachinePlayback) ??
                true;
            payload.content.timeMachinePlaybackJson = playbackJson;
            payload.content.livePlaybackJson = playbackJson;
            payload.content.liveRewindPlaybackJson = playbackJson;
            payload.content.timeMachineActive = true;
            payload.content.timeMachineState = "AVAILABLE";
            payload.content.p2pQuality = [];

            if (payload.content.live && typeof payload.content.live === "object") {
                payload.content.live.timeMachine = true;
                payload.content.live.timeMachinePlayback = true;
                payload.content.live.timeMachineActive = true;
                payload.content.live.timeMachineState = "AVAILABLE";
            }

            return JSON.stringify(payload);
        } catch (error) {
            console.warn(`${LOG_PREFIX} live-detail 응답 변환 실패`, error);
            return null;
        }
    }

    function patchLivePlaybackPayload(payloadText, channelId = currentChannelId) {
        try {
            if (!isTimeMachineEnabled(channelId)) {
                return null;
            }

            const payload = JSON.parse(payloadText);
            if (!payload?.content) {
                return null;
            }

            const entry = getPlaybackEntry(channelId);
            if (payload.content.playbackJson) {
                entry.livePlaybackJson = payload.content.playbackJson;
            }

            if (typeof payload.content.tmp === "boolean") {
                entry.livePlaybackTmp = payload.content.tmp;
            }

            if (!hasInjectedPlayback(channelId) && payload.content.tmp !== true) {
                if (!entry.timeMachinePromise) {
                    disableTimeMachine(channelId, "unsupportedPlaybackPayload");
                }

                console.info(`${LOG_PREFIX} live-playback patch passthrough`, {
                    channelId,
                    reason: "serverTmpFalseWithoutTimeMachinePlayback",
                    tmp: payload.content.tmp,
                    hasPlaybackJson: Boolean(payload.content.playbackJson),
                });
                return null;
            }

            const playback = buildPatchedPlayback(channelId, payload.content.playbackJson);
            if (!playback) {
                return null;
            }

            const playbackJson = JSON.stringify(playback);
            entry.livePlaybackJson = playbackJson;
            entry.livePlaybackTmp = true;
            payload.content.playbackJson = playbackJson;
            payload.content.tmp = true;
            payload.content.timeMachinePlayback =
                getCachedTimeMachinePlayback(channelId) ??
                payload.content.timeMachinePlayback ??
                true;
            payload.content.timeMachineActive = true;
            payload.content.timeMachineState = "AVAILABLE";
            queueMicrotask(updateToggleButton);

            return JSON.stringify(payload);
        } catch (error) {
            console.warn(`${LOG_PREFIX} live-playback-json 응답 변환 실패`, error);
            return null;
        }
    }

    function patchTimeMachineInfoPayload(payloadText, channelId = currentChannelId) {
        try {
            if (!isTimeMachineEnabled(channelId)) {
                return null;
            }

            const payload = JSON.parse(payloadText);
            if (!payload?.content) {
                return null;
            }

            syncTimeMachineInfoEntry(channelId, payload.content);

            const entry = getPlaybackEntry(channelId);
            if (!hasInjectedPlayback(channelId) && payload.content.timeMachineActive !== true) {
                if (!entry.timeMachinePromise) {
                    disableTimeMachine(channelId, "unsupportedTimeMachineInfo");
                }

                console.info(`${LOG_PREFIX} time-machine-info patch passthrough`, {
                    channelId,
                    reason: "serverInactiveWithoutTimeMachinePlayback",
                    timeMachineActive: payload.content.timeMachineActive,
                    hasTimeMachinePlayback: Boolean(payload.content.timeMachinePlayback),
                });
                return null;
            }

            const patchedContent = buildPatchedTimeMachineInfo(channelId, payload.content);
            if (!patchedContent.timeMachineActive) {
                return null;
            }

            payload.content = patchedContent;
            queueMicrotask(updateToggleButton);
            return JSON.stringify(payload);
        } catch (error) {
            console.warn(`${LOG_PREFIX} time-machine-info 응답 변환 실패`, error);
            return null;
        }
    }

    function applyPatchedXhrResponse(xhr, patchedText) {
        if (!patchedText || xhr.__chzzkTimeMachineResponsePatched) {
            return;
        }

        xhr.__chzzkTimeMachineResponsePatched = true;
        Object.defineProperty(xhr, "responseText", {
            configurable: true,
            get: () => patchedText,
        });
        Object.defineProperty(xhr, "response", {
            configurable: true,
            get: () => patchedText,
        });
    }

    function removeSliderOnLivePage() {
        if (!location.pathname.includes("/live/") || !isTimeMachineEnabled(currentChannelId)) {
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

    function removeBlockingModal(root = document) {
        if (!isTimeMachineEnabled(currentChannelId)) {
            return false;
        }

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

    function warmupPlayback(channelId = currentChannelId) {
        if (!channelId || !isTimeMachineEnabled(channelId)) {
            return;
        }

        void ensureLiveDetailPrerequisites(channelId);
        void ensureLivePlayback(channelId);
    }

    function handleRouteChange(url = location.href) {
        const nextChannelId = getChannelIdFromUrl(String(url));
        if (nextChannelId === currentChannelId) {
            syncEnabledChannel(nextChannelId);
            updateToggleButton();
            return;
        }

        syncEnabledChannel(nextChannelId);
        currentChannelId = nextChannelId;
        removeBlockingModal();
        removeSliderOnLivePage();
        warmupPlayback(nextChannelId);
        updateToggleButton();
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
        this[LIVE_PLAYBACK_FLAG] = isLivePlaybackRequestUrl(url);
        this[TIME_MACHINE_INFO_FLAG] = isTimeMachineInfoRequestUrl(url);
        this[REQUEST_CHANNEL_FLAG] = getChannelIdFromApiUrl(url) ?? currentChannelId;

        if ((this[LIVE_DETAIL_FLAG] || this[LIVE_PLAYBACK_FLAG] || this[TIME_MACHINE_INFO_FLAG]) && !this.__chzzkTimeMachinePatched) {
            this.__chzzkTimeMachinePatched = true;

            this.addEventListener("readystatechange", () => {
                if (this.readyState !== 4) {
                    return;
                }

                const responseUrl = this.responseURL;
                const channelId = this[REQUEST_CHANNEL_FLAG];

                let patchedText = null;
                if (this[LIVE_DETAIL_FLAG] || isLiveDetailRequestUrl(responseUrl)) {
                    patchedText = patchLiveDetailPayload(this.responseText, channelId);
                } else if (this[LIVE_PLAYBACK_FLAG] || isLivePlaybackRequestUrl(responseUrl)) {
                    patchedText = patchLivePlaybackPayload(this.responseText, channelId);
                } else if (this[TIME_MACHINE_INFO_FLAG] || isTimeMachineInfoRequestUrl(responseUrl)) {
                    patchedText = patchTimeMachineInfoPayload(this.responseText, channelId);
                }

                if (patchedText) {
                    applyPatchedXhrResponse(this, patchedText);
                }
            });
        }

        return nativeOpen.call(this, method, url, ...rest);
    };

    NativeXMLHttpRequest.prototype.send = function (...args) {
        if (!this[LIVE_DETAIL_FLAG] && !this[LIVE_PLAYBACK_FLAG] && !this[TIME_MACHINE_INFO_FLAG]) {
            return nativeSend.apply(this, args);
        }

        if (this[LIVE_DETAIL_FLAG] || this[TIME_MACHINE_INFO_FLAG]) {
            void ensureLiveDetailPrerequisites(this[REQUEST_CHANNEL_FLAG]);
        }

        return nativeSend.apply(this, args);
    };

    installNavigationHook();
    installToggleButton();
    syncEnabledChannel(currentChannelId);
    removeSliderOnLivePage();
    watchBlockingModal();
    warmupPlayback(currentChannelId);
    updateToggleButton();
})();
