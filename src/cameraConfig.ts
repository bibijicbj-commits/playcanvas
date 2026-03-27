import * as pc from 'playcanvas';
import type { MapCameraControlSettings } from './MapCameraControl.js';

export interface CameraComponentSettings {
    fov: number;
    nearClip: number;
    farClip: number;
}

export interface CameraDebugConfig {
    component: CameraComponentSettings;
    control: MapCameraControlSettings;
    model: {
        portScale: number;
    };
}

export const CAMERA_CONFIG_STORAGE_KEY = 'playcanvas-shader-lab.camera-config';

export const defaultCameraDebugConfig: CameraDebugConfig = {
    component: {
        fov: 45,
        nearClip: 0.3,
        farClip: 8000
    },
    control: {
        enabledControl: true,
        groundY: 0,
        lookAtCenterX: 0,
        lookAtCenterY: 0,
        lookAtCenterZ: 0,
        minDistance: 50,
        maxDistance: 2500,
        minPitchDeg: 80,
        maxPitchDeg: 15,
        pitchCurvePower: 8,
        zoomSpeed: 1.5,
        zoomSmooth: 0.5,
        rotateSpeed: 0.5,
        rotateSmooth: 0.5,
        moveSpeed: 10,
        autoToTopEnabled: true,
        autoToTopHeight: 1000,
        topYawDeg: 0,
        autoAdjustFarClip: true,
        farClipMin: 5000,
        farClipMultiplier: 4,
        minRuntimeDistance: 0.05,
        rangeShape: 1,
        rangeAngleDeg: 0,
        ellipseRadiiX: 2000,
        ellipseRadiiY: 900,
        rectHalfExtentsX: 2000,
        rectHalfExtentsY: 900,
        scaleRangeWithZoom: true,
        minRangeFactor: 0.1,
        coneRangeEnabled: true,
        coneAutoHeights: true,
        coneTopIsPoint: true,
        coneTopFactor: 0,
        coneFullRangeHeight: 0,
        coneMinRangeHeight: 2500,
        zoomTowardsCursor: true,
        allowKeyboardPan: true,
        allowMouseDragPan: true,
        dragPanSensitivity: 0.005,
        slideAlongBoundary: true,
        outwardSlideRatio: 0.25,
        invertWheel: true
    },
    model: {
        portScale: 0.01
    }
};

export const cloneCameraDebugConfig = (config: CameraDebugConfig): CameraDebugConfig => ({
    component: { ...config.component },
    control: { ...config.control },
    model: { ...config.model }
});

export const loadStoredCameraDebugConfig = (): CameraDebugConfig | null => {
    try {
        const raw = window.localStorage.getItem(CAMERA_CONFIG_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw) as Partial<CameraDebugConfig>;
        return {
            component: {
                ...defaultCameraDebugConfig.component,
                ...parsed.component
            },
            control: {
                ...defaultCameraDebugConfig.control,
                ...parsed.control
            },
            model: {
                ...defaultCameraDebugConfig.model,
                ...parsed.model
            }
        };
    } catch (error) {
        console.warn('Failed to load stored camera config.', error);
        return null;
    }
};

export const saveStoredCameraDebugConfig = (config: CameraDebugConfig) => {
    window.localStorage.setItem(CAMERA_CONFIG_STORAGE_KEY, JSON.stringify(config, null, 2));
};

export const clearStoredCameraDebugConfig = () => {
    window.localStorage.removeItem(CAMERA_CONFIG_STORAGE_KEY);
};

export const cameraControlSettingsToVec2 = (config: CameraDebugConfig) =>
    new pc.Vec2(config.control.rectHalfExtentsX, config.control.rectHalfExtentsY);
