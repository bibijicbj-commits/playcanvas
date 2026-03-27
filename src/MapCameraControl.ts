
import * as pc from 'playcanvas';

export interface MapCameraControlOptions {
    enabledControl?: boolean;
    groundY?: number;
    lookAtCenter?: pc.Vec3;
    minDistance?: number;
    maxDistance?: number;
    minPitchDeg?: number;
    maxPitchDeg?: number;
    pitchCurvePower?: number;
    zoomSpeed?: number;
    zoomSmooth?: number;
    rotateSpeed?: number;
    rotateSmooth?: number;
    moveSpeed?: number;
    autoToTopEnabled?: boolean;
    autoToTopHeight?: number;
    topYawDeg?: number;
    autoAdjustFarClip?: boolean;
    farClipMin?: number;
    farClipMultiplier?: number;
    minRuntimeDistance?: number;
    rangeShape?: 0 | 1;
    rangeAngleDeg?: number;
    ellipseRadii?: pc.Vec2;
    rectHalfExtents?: pc.Vec2;
    scaleRangeWithZoom?: boolean;
    minRangeFactor?: number;
    coneRangeEnabled?: boolean;
    coneAutoHeights?: boolean;
    coneTopIsPoint?: boolean;
    coneTopFactor?: number;
    coneFullRangeHeight?: number;
    coneMinRangeHeight?: number;
    zoomTowardsCursor?: boolean;
    allowKeyboardPan?: boolean;
    allowMouseDragPan?: boolean;
    dragPanSensitivity?: number;
    slideAlongBoundary?: boolean;
    outwardSlideRatio?: number;
    invertWheel?: boolean;
    debugLog?: boolean;
}

export interface MapCameraControlSettings {
    enabledControl: boolean;
    groundY: number;
    lookAtCenterX: number;
    lookAtCenterY: number;
    lookAtCenterZ: number;
    minDistance: number;
    maxDistance: number;
    minPitchDeg: number;
    maxPitchDeg: number;
    pitchCurvePower: number;
    zoomSpeed: number;
    zoomSmooth: number;
    rotateSpeed: number;
    rotateSmooth: number;
    moveSpeed: number;
    autoToTopEnabled: boolean;
    autoToTopHeight: number;
    topYawDeg: number;
    autoAdjustFarClip: boolean;
    farClipMin: number;
    farClipMultiplier: number;
    minRuntimeDistance: number;
    rangeShape: 0 | 1;
    rangeAngleDeg: number;
    ellipseRadiiX: number;
    ellipseRadiiY: number;
    rectHalfExtentsX: number;
    rectHalfExtentsY: number;
    scaleRangeWithZoom: boolean;
    minRangeFactor: number;
    coneRangeEnabled: boolean;
    coneAutoHeights: boolean;
    coneTopIsPoint: boolean;
    coneTopFactor: number;
    coneFullRangeHeight: number;
    coneMinRangeHeight: number;
    zoomTowardsCursor: boolean;
    allowKeyboardPan: boolean;
    allowMouseDragPan: boolean;
    dragPanSensitivity: number;
    slideAlongBoundary: boolean;
    outwardSlideRatio: number;
    invertWheel: boolean;
}

const DEFAULTS: Required<MapCameraControlOptions> = {
    enabledControl: true,
    groundY: 0,
    lookAtCenter: new pc.Vec3(0, 0, 0),
    minDistance: 50,
    maxDistance: 2500,
    minPitchDeg: 80,
    maxPitchDeg: 15,
    pitchCurvePower: 8,
    zoomSpeed: 0.5,
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
    rangeShape: 0,
    rangeAngleDeg: 0,
    ellipseRadii: new pc.Vec2(2000, 900),
    rectHalfExtents: new pc.Vec2(2000, 900),
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
    invertWheel: true,
    debugLog: false
};

export class MapCameraControl {
    private readonly app: pc.Application;
    private readonly camera: pc.Entity;
    private readonly options: Required<MapCameraControlOptions>;
    private readonly mouseDelta = new pc.Vec2();
    private readonly dragPanDelta = new pc.Vec2();
    private readonly contextMenuHandler: (event: MouseEvent) => boolean;
    private readonly lastPointerPos = new pc.Vec2();
    private targetLookAt: pc.Vec3;
    private currentLookAt: pc.Vec3;
    private targetDistance: number;
    private currentDistance: number;
    private targetYawRad: number;
    private currentYawRad: number;
    private targetPitchDeg: number;
    private currentPitchDeg: number;
    private isRotating = false;
    private isDragPanning = false;

    constructor(app: pc.Application, camera: pc.Entity, options: MapCameraControlOptions = {}) {
        this.app = app;
        this.camera = camera;
        this.options = {
            ...DEFAULTS,
            ...options,
            lookAtCenter: (options.lookAtCenter ?? DEFAULTS.lookAtCenter).clone(),
            ellipseRadii: (options.ellipseRadii ?? DEFAULTS.ellipseRadii).clone(),
            rectHalfExtents: (options.rectHalfExtents ?? DEFAULTS.rectHalfExtents).clone()
        };

        this.applyFallbackDefaults();
        this.targetLookAt = this.grounded(this.options.lookAtCenter.clone());
        this.currentLookAt = this.targetLookAt.clone();
        this.targetDistance = pc.math.clamp(this.options.maxDistance, this.options.minDistance, this.options.maxDistance);
        this.currentDistance = this.targetDistance;
        this.targetYawRad = this.degToRad(this.options.topYawDeg);
        this.currentYawRad = this.targetYawRad;
        this.targetPitchDeg = this.options.minPitchDeg;
        this.currentPitchDeg = this.targetPitchDeg;

        this.contextMenuHandler = this.handleContextMenu.bind(this);

        if (this.app.mouse) {
            this.app.mouse.disableContextMenu();
            this.app.mouse.on(pc.EVENT_MOUSEDOWN, this.onMouseDown, this);
            this.app.mouse.on(pc.EVENT_MOUSEUP, this.onMouseUp, this);
            this.app.mouse.on(pc.EVENT_MOUSEMOVE, this.onMouseMove, this);
            this.app.mouse.on(pc.EVENT_MOUSEWHEEL, this.onMouseWheel, this);
        }

        this.app.graphicsDevice.canvas.addEventListener('contextmenu', this.contextMenuHandler);
        this.app.on('update', this.update, this);
        this.applyCameraTransform();
    }

    destroy() {
        if (this.app.mouse) {
            this.app.mouse.off(pc.EVENT_MOUSEDOWN, this.onMouseDown, this);
            this.app.mouse.off(pc.EVENT_MOUSEUP, this.onMouseUp, this);
            this.app.mouse.off(pc.EVENT_MOUSEMOVE, this.onMouseMove, this);
            this.app.mouse.off(pc.EVENT_MOUSEWHEEL, this.onMouseWheel, this);
        }

        this.app.graphicsDevice.canvas.removeEventListener('contextmenu', this.contextMenuHandler);
        this.app.off('update', this.update, this);
    }

    getSettings(): MapCameraControlSettings {
        return {
            enabledControl: this.options.enabledControl,
            groundY: this.options.groundY,
            lookAtCenterX: this.options.lookAtCenter.x,
            lookAtCenterY: this.options.lookAtCenter.y,
            lookAtCenterZ: this.options.lookAtCenter.z,
            minDistance: this.options.minDistance,
            maxDistance: this.options.maxDistance,
            minPitchDeg: this.options.minPitchDeg,
            maxPitchDeg: this.options.maxPitchDeg,
            pitchCurvePower: this.options.pitchCurvePower,
            zoomSpeed: this.options.zoomSpeed,
            zoomSmooth: this.options.zoomSmooth,
            rotateSpeed: this.options.rotateSpeed,
            rotateSmooth: this.options.rotateSmooth,
            moveSpeed: this.options.moveSpeed,
            autoToTopEnabled: this.options.autoToTopEnabled,
            autoToTopHeight: this.options.autoToTopHeight,
            topYawDeg: this.options.topYawDeg,
            autoAdjustFarClip: this.options.autoAdjustFarClip,
            farClipMin: this.options.farClipMin,
            farClipMultiplier: this.options.farClipMultiplier,
            minRuntimeDistance: this.options.minRuntimeDistance,
            rangeShape: this.options.rangeShape,
            rangeAngleDeg: this.options.rangeAngleDeg,
            ellipseRadiiX: this.options.ellipseRadii.x,
            ellipseRadiiY: this.options.ellipseRadii.y,
            rectHalfExtentsX: this.options.rectHalfExtents.x,
            rectHalfExtentsY: this.options.rectHalfExtents.y,
            scaleRangeWithZoom: this.options.scaleRangeWithZoom,
            minRangeFactor: this.options.minRangeFactor,
            coneRangeEnabled: this.options.coneRangeEnabled,
            coneAutoHeights: this.options.coneAutoHeights,
            coneTopIsPoint: this.options.coneTopIsPoint,
            coneTopFactor: this.options.coneTopFactor,
            coneFullRangeHeight: this.options.coneFullRangeHeight,
            coneMinRangeHeight: this.options.coneMinRangeHeight,
            zoomTowardsCursor: this.options.zoomTowardsCursor,
            allowKeyboardPan: this.options.allowKeyboardPan,
            allowMouseDragPan: this.options.allowMouseDragPan,
            dragPanSensitivity: this.options.dragPanSensitivity,
            slideAlongBoundary: this.options.slideAlongBoundary,
            outwardSlideRatio: this.options.outwardSlideRatio,
            invertWheel: this.options.invertWheel
        };
    }

    updateSettings(patch: Partial<MapCameraControlSettings>) {
        if (typeof patch.enabledControl === 'boolean') this.options.enabledControl = patch.enabledControl;
        if (typeof patch.groundY === 'number') {
            this.options.groundY = patch.groundY;
            this.targetLookAt.y = patch.groundY;
            this.currentLookAt.y = patch.groundY;
        }

        if (typeof patch.lookAtCenterX === 'number') this.options.lookAtCenter.x = patch.lookAtCenterX;
        if (typeof patch.lookAtCenterY === 'number') this.options.lookAtCenter.y = patch.lookAtCenterY;
        if (typeof patch.lookAtCenterZ === 'number') this.options.lookAtCenter.z = patch.lookAtCenterZ;
        if (typeof patch.minDistance === 'number') this.options.minDistance = Math.max(0.01, patch.minDistance);
        if (typeof patch.maxDistance === 'number') this.options.maxDistance = Math.max(this.options.minDistance, patch.maxDistance);
        if (typeof patch.minPitchDeg === 'number') this.options.minPitchDeg = pc.math.clamp(patch.minPitchDeg, 1, 89);
        if (typeof patch.maxPitchDeg === 'number') this.options.maxPitchDeg = pc.math.clamp(patch.maxPitchDeg, 1, 89);
        if (typeof patch.pitchCurvePower === 'number') this.options.pitchCurvePower = Math.max(0.1, patch.pitchCurvePower);
        if (typeof patch.zoomSpeed === 'number') this.options.zoomSpeed = Math.max(0, patch.zoomSpeed);
        if (typeof patch.zoomSmooth === 'number') this.options.zoomSmooth = pc.math.clamp(patch.zoomSmooth, 0, 1);
        if (typeof patch.rotateSpeed === 'number') this.options.rotateSpeed = Math.max(0, patch.rotateSpeed);
        if (typeof patch.rotateSmooth === 'number') this.options.rotateSmooth = pc.math.clamp(patch.rotateSmooth, 0, 1);
        if (typeof patch.moveSpeed === 'number') this.options.moveSpeed = Math.max(0, patch.moveSpeed);
        if (typeof patch.autoToTopEnabled === 'boolean') this.options.autoToTopEnabled = patch.autoToTopEnabled;
        if (typeof patch.autoToTopHeight === 'number') this.options.autoToTopHeight = Math.max(0, patch.autoToTopHeight);
        if (typeof patch.topYawDeg === 'number') this.options.topYawDeg = patch.topYawDeg;
        if (typeof patch.autoAdjustFarClip === 'boolean') this.options.autoAdjustFarClip = patch.autoAdjustFarClip;
        if (typeof patch.farClipMin === 'number') this.options.farClipMin = Math.max(10, patch.farClipMin);
        if (typeof patch.farClipMultiplier === 'number') this.options.farClipMultiplier = Math.max(1, patch.farClipMultiplier);
        if (typeof patch.minRuntimeDistance === 'number') this.options.minRuntimeDistance = Math.max(0.01, patch.minRuntimeDistance);
        if (typeof patch.rangeShape === 'number') this.options.rangeShape = patch.rangeShape === 0 ? 0 : 1;
        if (typeof patch.rangeAngleDeg === 'number') this.options.rangeAngleDeg = patch.rangeAngleDeg;
        if (typeof patch.ellipseRadiiX === 'number') this.options.ellipseRadii.x = Math.max(0, patch.ellipseRadiiX);
        if (typeof patch.ellipseRadiiY === 'number') this.options.ellipseRadii.y = Math.max(0, patch.ellipseRadiiY);
        if (typeof patch.rectHalfExtentsX === 'number') this.options.rectHalfExtents.x = Math.max(0, patch.rectHalfExtentsX);
        if (typeof patch.rectHalfExtentsY === 'number') this.options.rectHalfExtents.y = Math.max(0, patch.rectHalfExtentsY);
        if (typeof patch.scaleRangeWithZoom === 'boolean') this.options.scaleRangeWithZoom = patch.scaleRangeWithZoom;
        if (typeof patch.minRangeFactor === 'number') this.options.minRangeFactor = pc.math.clamp(patch.minRangeFactor, 0, 1);
        if (typeof patch.coneRangeEnabled === 'boolean') this.options.coneRangeEnabled = patch.coneRangeEnabled;
        if (typeof patch.coneAutoHeights === 'boolean') this.options.coneAutoHeights = patch.coneAutoHeights;
        if (typeof patch.coneTopIsPoint === 'boolean') this.options.coneTopIsPoint = patch.coneTopIsPoint;
        if (typeof patch.coneTopFactor === 'number') this.options.coneTopFactor = pc.math.clamp(patch.coneTopFactor, 0, 1);
        if (typeof patch.coneFullRangeHeight === 'number') this.options.coneFullRangeHeight = patch.coneFullRangeHeight;
        if (typeof patch.coneMinRangeHeight === 'number') this.options.coneMinRangeHeight = Math.max(0, patch.coneMinRangeHeight);
        if (typeof patch.zoomTowardsCursor === 'boolean') this.options.zoomTowardsCursor = patch.zoomTowardsCursor;
        if (typeof patch.allowKeyboardPan === 'boolean') this.options.allowKeyboardPan = patch.allowKeyboardPan;
        if (typeof patch.allowMouseDragPan === 'boolean') this.options.allowMouseDragPan = patch.allowMouseDragPan;
        if (typeof patch.dragPanSensitivity === 'number') this.options.dragPanSensitivity = Math.max(0, patch.dragPanSensitivity);
        if (typeof patch.slideAlongBoundary === 'boolean') this.options.slideAlongBoundary = patch.slideAlongBoundary;
        if (typeof patch.outwardSlideRatio === 'number') this.options.outwardSlideRatio = pc.math.clamp(patch.outwardSlideRatio, 0, 1);
        if (typeof patch.invertWheel === 'boolean') this.options.invertWheel = patch.invertWheel;

        this.applyFallbackDefaults();
        this.targetDistance = pc.math.clamp(this.targetDistance, this.options.minDistance, this.options.maxDistance);
        this.currentDistance = pc.math.clamp(this.currentDistance, this.options.minDistance, this.options.maxDistance);
        this.targetPitchDeg = pc.math.clamp(this.targetPitchDeg, this.options.maxPitchDeg, this.options.minPitchDeg);
        this.currentPitchDeg = pc.math.clamp(this.currentPitchDeg, this.options.maxPitchDeg, this.options.minPitchDeg);
    }

    setLookAt(position: pc.Vec3) {
        this.options.lookAtCenter.copy(position);
        this.targetLookAt.copy(position);
        this.currentLookAt.copy(position);
        this.targetLookAt.y = this.options.groundY;
        this.currentLookAt.y = this.options.groundY;
        this.applyCameraTransform();
    }

    getCameraPosition() {
        return this.camera.getPosition().clone();
    }

    getLookAtPosition() {
        return this.currentLookAt.clone();
    }

    focus(bounds: pc.BoundingBox) {
        const center = bounds.center.clone();
        const radius = Math.max(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z);
        this.targetLookAt.copy(center);
        this.targetLookAt.y = this.options.groundY;
        this.currentLookAt.copy(this.targetLookAt);
        this.targetDistance = pc.math.clamp(Math.max(radius * 2.6, this.options.minDistance), this.options.minDistance, this.options.maxDistance);
        this.currentDistance = this.targetDistance;
        this.targetPitchDeg = 28;
        this.currentPitchDeg = this.targetPitchDeg;
        this.targetYawRad = pc.math.DEG_TO_RAD * 35;
        this.currentYawRad = this.targetYawRad;
        this.applyCameraTransform();
    }

    private update(dt: number) {
        if (!this.options.enabledControl) {
            return;
        }

        this.updatePan(dt);
        this.updateRotate();
        this.targetLookAt.copy(this.limitPoint(this.targetLookAt));
        this.applySmoothing(dt);
        this.maybeAdjustClip();
        this.applyCameraTransform();
    }

    private onMouseDown(event: pc.MouseEvent) {
        if (!this.shouldHandlePointerEvent(event)) {
            this.isRotating = false;
            this.isDragPanning = false;
            return;
        }

        this.stopEvent(event);

        if (event.button === pc.MOUSEBUTTON_RIGHT) {
            this.isRotating = true;
            this.isDragPanning = false;
        } else if (event.button === pc.MOUSEBUTTON_LEFT) {
            this.isDragPanning = this.options.allowMouseDragPan;
            this.isRotating = false;
        }
    }

    private onMouseUp(event: pc.MouseEvent) {
        if (!this.shouldHandlePointerEvent(event)) {
            this.isRotating = false;
            this.isDragPanning = false;
            return;
        }

        this.stopEvent(event);
        if (event.button === pc.MOUSEBUTTON_LEFT || event.button === pc.MOUSEBUTTON_RIGHT) {
            this.isRotating = false;
            this.isDragPanning = false;
        }
    }

    private onMouseMove(event: pc.MouseEvent) {
        this.lastPointerPos.set(event.x, event.y);
        if (this.isRotating) {
            this.mouseDelta.x += event.dx;
            this.mouseDelta.y += event.dy;
        } else if (this.isDragPanning) {
            this.dragPanDelta.x += event.dx;
            this.dragPanDelta.y += event.dy;
        }
    }

    private onMouseWheel(event: pc.MouseEvent) {
        if (!this.shouldHandlePointerEvent(event)) {
            return;
        }

        const nativeEvent = event.event as (WheelEvent & { wheelDelta?: number }) | undefined;
        let delta = 0;
        if (typeof event.wheelDelta === 'number') {
            delta = event.wheelDelta;
        } else if (nativeEvent && typeof nativeEvent.deltaY === 'number') {
            delta = -nativeEvent.deltaY;
        } else if (nativeEvent && typeof nativeEvent.wheelDelta === 'number') {
            delta = nativeEvent.wheelDelta;
        }

        this.lastPointerPos.set(event.x, event.y);
        this.stopEvent(event);
        if (!delta) {
            return;
        }

        const sign = this.options.invertWheel ? -1 : 1;
        const direction = delta > 0 ? sign : -sign;
        this.applyZoomRequest(direction);
    }

    private updatePan(dt: number) {
        const yaw = this.currentYawRad;
        const right = new pc.Vec3(Math.cos(yaw), 0, -Math.sin(yaw));
        const forward = new pc.Vec3(Math.sin(yaw), 0, Math.cos(yaw));
        const speedScale = 2 - this.heightRatio();
        const deltaWorld = new pc.Vec3();

        if (this.options.allowKeyboardPan && this.app.keyboard) {
            const move = new pc.Vec2();
            if (this.app.keyboard.isPressed(pc.KEY_W) || this.app.keyboard.isPressed(pc.KEY_UP)) move.y += 1;
            if (this.app.keyboard.isPressed(pc.KEY_S) || this.app.keyboard.isPressed(pc.KEY_DOWN)) move.y -= 1;
            if (this.app.keyboard.isPressed(pc.KEY_D) || this.app.keyboard.isPressed(pc.KEY_RIGHT)) move.x += 1;
            if (this.app.keyboard.isPressed(pc.KEY_A) || this.app.keyboard.isPressed(pc.KEY_LEFT)) move.x -= 1;

            if (move.lengthSq() > 0) {
                move.normalize();
                deltaWorld.add(right.clone().mulScalar(move.x * this.options.moveSpeed * speedScale * dt));
                deltaWorld.add(forward.clone().mulScalar(move.y * this.options.moveSpeed * speedScale * dt));
            }
        }

        if (this.options.allowMouseDragPan && this.dragPanDelta.lengthSq() > 0) {
            const drag = this.dragPanDelta.clone().mulScalar(this.options.dragPanSensitivity * this.options.moveSpeed * speedScale);
            deltaWorld.add(right.clone().mulScalar(drag.x));
            deltaWorld.add(forward.clone().mulScalar(drag.y));
            this.dragPanDelta.set(0, 0);
        }

        if (this.options.slideAlongBoundary && deltaWorld.lengthSq() > 0) {
            deltaWorld.copy(this.slideDeltaAlongBoundary(this.targetLookAt, deltaWorld));
        }

        this.targetLookAt.add(deltaWorld);
        this.targetLookAt.y = this.options.groundY;
    }

    private updateRotate() {
        if (!this.isRotating) {
            return;
        }

        this.targetYawRad += -this.mouseDelta.x * this.options.rotateSpeed * 0.002;
        this.mouseDelta.set(0, 0);
    }

    private applyZoomRequest(direction: number) {
        const oldFactor = this.rangeFactor();
        const center = this.grounded(this.options.lookAtCenter.clone());
        const angle = this.degToRad(this.options.rangeAngleDeg);

        let cursorGroundRaw = this.targetLookAt.clone();
        if (this.options.zoomTowardsCursor && direction > 0) {
            const cursorPos = this.getCursorPosition();
            cursorGroundRaw = this.screenToGround(cursorPos.x, cursorPos.y);
        }

        const oldDistance = this.targetDistance;
        const ratio = this.heightRatio();
        this.targetDistance -= this.targetDistance * direction * this.options.zoomSpeed * 0.25 * Math.max(1 - ratio * ratio, 0.1);
        this.targetDistance = pc.math.clamp(this.targetDistance, this.options.minDistance, this.options.maxDistance);
        const zoomingOut = this.targetDistance > oldDistance;

        const newRatio = this.heightRatio();
        this.targetPitchDeg = pc.math.lerp(this.options.minPitchDeg, this.options.maxPitchDeg, Math.pow(newRatio, this.options.pitchCurvePower));

        const newFactor = this.rangeFactor();

        if (this.options.zoomTowardsCursor && direction > 0) {
            let cursorGround = this.limitPointWithFactor(cursorGroundRaw, newFactor);
            if (!this.isPointInsideWithFactor(cursorGroundRaw, newFactor)) {
                cursorGround = this.targetLookAt.clone();
            }

            const denom = oldDistance !== 0 ? oldDistance : 0.0001;
            const mixFactor = (oldDistance - this.targetDistance) / denom;
            this.targetLookAt.lerp(this.targetLookAt, cursorGround, mixFactor);
            this.targetLookAt.y = this.options.groundY;
        }

        if (newFactor < oldFactor && oldFactor > 1e-4) {
            const scale = newFactor / oldFactor;
            const local = this.rotate2(new pc.Vec2(this.targetLookAt.x - center.x, this.targetLookAt.z - center.z), -angle);
            local.mulScalar(scale);
            const rotated = this.rotate2(local, angle);
            this.targetLookAt.set(center.x + rotated.x, this.options.groundY, center.z + rotated.y);
        }

        this.targetLookAt.copy(this.limitPointWithFactor(this.targetLookAt, newFactor));

        if (this.options.autoToTopEnabled && zoomingOut && this.targetAboveGround() >= this.options.autoToTopHeight) {
            this.toTop();
        }
    }

    private applySmoothing(dt: number) {
        const zoomT = this.smoothToLerpT(this.options.zoomSmooth, dt);
        const rotT = this.smoothToLerpT(this.options.rotateSmooth, dt);

        this.currentLookAt.lerp(this.currentLookAt, this.targetLookAt, zoomT);
        this.currentDistance = pc.math.lerp(this.currentDistance, this.targetDistance, zoomT);
        this.currentPitchDeg = pc.math.lerp(this.currentPitchDeg, this.targetPitchDeg, zoomT);
        this.currentYawRad = pc.math.lerp(this.currentYawRad, this.targetYawRad, rotT);
    }

    private applyCameraTransform() {
        if (!this.isStateFinite()) {
            this.resetStateFromOptions();
            return;
        }

        this.currentDistance = Math.max(this.currentDistance, this.options.minRuntimeDistance);
        const pitchRad = this.degToRad(pc.math.clamp(this.currentPitchDeg, 0.1, 89.9));
        const planar = new pc.Vec3(Math.sin(this.currentYawRad), 0, Math.cos(this.currentYawRad));
        if (planar.lengthSq() > 0.000001) {
            planar.normalize();
        }

        const dir = planar.mulScalar(Math.cos(pitchRad));
        dir.y = -Math.sin(pitchRad);
        if (dir.lengthSq() > 0.000001) {
            dir.normalize();
        }

        const desiredPos = this.currentLookAt.clone().sub(dir.mulScalar(this.currentDistance));
        if (desiredPos.clone().sub(this.currentLookAt).lengthSq() < 1e-6) {
            desiredPos.y += this.options.minRuntimeDistance;
        }

        this.camera.setPosition(desiredPos);
        this.camera.lookAt(this.currentLookAt);
        if (!this.isStateFinite()) {
            this.resetStateFromOptions();
        }
    }

    private maybeAdjustClip() {
        if (!this.options.autoAdjustFarClip) {
            return;
        }

        const cameraComponent = this.camera.camera;
        if (!cameraComponent) {
            return;
        }

        const rangeExtent = this.options.rangeShape === 0
            ? Math.max(this.options.ellipseRadii.x, this.options.ellipseRadii.y)
            : Math.max(this.options.rectHalfExtents.x, this.options.rectHalfExtents.y);
        const desiredFar = Math.max(
            this.options.farClipMin,
            this.options.maxDistance * this.options.farClipMultiplier,
            this.options.maxDistance + rangeExtent * 4
        );

        if (cameraComponent.farClip < desiredFar) {
            cameraComponent.farClip = desiredFar;
        }
    }

    private heightRatio() {
        const denom = this.options.maxDistance - this.options.minDistance;
        if (Math.abs(denom) < 0.0001) {
            return 1;
        }
        return pc.math.clamp(1 - ((this.targetDistance - this.options.minDistance) / denom), 0, 1);
    }

    private targetAboveGround() {
        const pitchRad = this.degToRad(pc.math.clamp(this.targetPitchDeg, 0.1, 89.9));
        return Math.sin(pitchRad) * this.targetDistance;
    }

    private pitchDegForZoomRatio(zoomRatio: number) {
        return pc.math.lerp(
            this.options.minPitchDeg,
            this.options.maxPitchDeg,
            Math.pow(pc.math.clamp(zoomRatio, 0, 1), this.options.pitchCurvePower)
        );
    }

    private heightFromDistance(distance: number) {
        const denom = this.options.maxDistance - this.options.minDistance;
        let zoomRatio = 1;
        if (Math.abs(denom) >= 0.0001) {
            zoomRatio = pc.math.clamp(1 - ((distance - this.options.minDistance) / denom), 0, 1);
        }
        const pitchDeg = this.pitchDegForZoomRatio(zoomRatio);
        const pitchRad = this.degToRad(pc.math.clamp(pitchDeg, 0.1, 89.9));
        return Math.sin(pitchRad) * distance;
    }

    private toTop() {
        this.targetDistance = this.options.maxDistance;
        this.targetPitchDeg = this.options.minPitchDeg;
        this.targetYawRad = this.degToRad(this.options.topYawDeg);
        this.targetLookAt.copy(this.grounded(this.options.lookAtCenter.clone()));
    }

    private rangeFactor() {
        if (!this.options.scaleRangeWithZoom) {
            return 1;
        }

        if (this.options.coneRangeEnabled) {
            const h = this.targetAboveGround();
            let hFull = this.options.coneFullRangeHeight;
            let hTop = this.options.coneMinRangeHeight;

            if (this.options.coneAutoHeights) {
                hFull = this.heightFromDistance(this.options.minDistance);
                hTop = this.heightFromDistance(this.options.maxDistance);
            }

            const denom = hTop - hFull;
            if (Math.abs(denom) < 0.0001) {
                return this.options.coneTopIsPoint ? 0 : this.options.minRangeFactor;
            }

            const t = pc.math.clamp((h - hFull) / denom, 0, 1);
            const topFactor = this.options.coneTopIsPoint ? 0 : this.options.coneTopFactor;
            return pc.math.lerp(1, topFactor, t);
        }

        return pc.math.lerp(this.options.minRangeFactor, 1, this.heightRatio());
    }

    private limitPoint(worldPoint: pc.Vec3) {
        return this.limitPointWithFactor(worldPoint, this.rangeFactor());
    }

    private limitPointWithFactor(worldPoint: pc.Vec3, factor: number) {
        const center = this.grounded(this.options.lookAtCenter.clone());
        const angle = this.degToRad(this.options.rangeAngleDeg);
        const local = this.rotate2(new pc.Vec2(worldPoint.x - center.x, worldPoint.z - center.z), -angle);

        if (this.options.rangeShape === 0) {
            const rx = this.options.ellipseRadii.x * factor;
            const rz = this.options.ellipseRadii.y * factor;
            if (rx <= 0 || rz <= 0) {
                local.set(0, 0);
            } else {
                const nx = local.x / rx;
                const nz = local.y / rz;
                const len = Math.sqrt(nx * nx + nz * nz);
                if (len > 1) {
                    local.x = (local.x / len) * rx;
                    local.y = (local.y / len) * rz;
                }
            }
        } else {
            const hx = this.options.rectHalfExtents.x * factor;
            const hz = this.options.rectHalfExtents.y * factor;
            local.x = pc.math.clamp(local.x, -hx, hx);
            local.y = pc.math.clamp(local.y, -hz, hz);
        }

        const rotated = this.rotate2(local, angle);
        return new pc.Vec3(center.x + rotated.x, this.options.groundY, center.z + rotated.y);
    }

    private isPointInsideWithFactor(worldPoint: pc.Vec3, factor: number) {
        const center = this.grounded(this.options.lookAtCenter.clone());
        const angle = this.degToRad(this.options.rangeAngleDeg);
        const local = this.rotate2(new pc.Vec2(worldPoint.x - center.x, worldPoint.z - center.z), -angle);

        if (this.options.rangeShape === 0) {
            const rx = this.options.ellipseRadii.x * factor;
            const rz = this.options.ellipseRadii.y * factor;
            if (rx <= 0 || rz <= 0) {
                return true;
            }
            const nx = local.x / rx;
            const nz = local.y / rz;
            return (nx * nx + nz * nz) <= 1;
        }

        const hx = this.options.rectHalfExtents.x * factor;
        const hz = this.options.rectHalfExtents.y * factor;
        if (hx <= 0 || hz <= 0) {
            return true;
        }
        return Math.abs(local.x) <= hx && Math.abs(local.y) <= hz;
    }

    private slideDeltaAlongBoundary(currentWorld: pc.Vec3, desiredDeltaWorld: pc.Vec3) {
        const center = this.grounded(this.options.lookAtCenter.clone());
        const angle = this.degToRad(this.options.rangeAngleDeg);
        const factor = this.rangeFactor();

        const curLocal = this.rotate2(new pc.Vec2(currentWorld.x - center.x, currentWorld.z - center.z), -angle);
        const deltaLocal = this.rotate2(new pc.Vec2(desiredDeltaWorld.x, desiredDeltaWorld.z), -angle);

        if (this.options.rangeShape === 1) {
            const hx = this.options.rectHalfExtents.x * factor;
            const hz = this.options.rectHalfExtents.y * factor;
            if (hx <= 0 || hz <= 0) {
                return pc.Vec3.ZERO.clone();
            }

            const nextLocal = curLocal.clone().add(deltaLocal);
            const clamped = new pc.Vec2(pc.math.clamp(nextLocal.x, -hx, hx), pc.math.clamp(nextLocal.y, -hz, hz));
            if (clamped.x !== nextLocal.x || clamped.y !== nextLocal.y) {
                if ((curLocal.x >= hx && deltaLocal.x > 0) || (curLocal.x <= -hx && deltaLocal.x < 0)) deltaLocal.x = 0;
                if ((curLocal.y >= hz && deltaLocal.y > 0) || (curLocal.y <= -hz && deltaLocal.y < 0)) deltaLocal.y = 0;
            }
        } else {
            const rx = this.options.ellipseRadii.x * factor;
            const rz = this.options.ellipseRadii.y * factor;
            if (rx <= 0 || rz <= 0) {
                return pc.Vec3.ZERO.clone();
            }

            const nextLocal = curLocal.clone().add(deltaLocal);
            const nextQ = new pc.Vec2(nextLocal.x / rx, nextLocal.y / rz);
            if (nextQ.length() > 1) {
                const qDir = nextQ.clone();
                if (qDir.lengthSq() < 1e-8) {
                    return pc.Vec3.ZERO.clone();
                }
                qDir.normalize();

                const boundary = new pc.Vec2(qDir.x * rx, qDir.y * rz);
                const normal = new pc.Vec2(boundary.x / (rx * rx), boundary.y / (rz * rz));
                if (normal.lengthSq() < 1e-8) {
                    return pc.Vec3.ZERO.clone();
                }

                const tangent = new pc.Vec2(-normal.y, normal.x).normalize();
                let tangentialAmount = deltaLocal.dot(tangent);
                if (Math.abs(tangentialAmount) < 1e-6 && this.options.outwardSlideRatio > 0) {
                    const cross = deltaLocal.x * normal.y - deltaLocal.y * normal.x;
                    const signDir = cross >= 0 ? 1 : -1;
                    tangentialAmount = signDir * deltaLocal.length() * this.options.outwardSlideRatio;
                }
                deltaLocal.copy(tangent.mulScalar(tangentialAmount));
            }
        }

        const rotated = this.rotate2(deltaLocal, angle);
        return new pc.Vec3(rotated.x, 0, rotated.y);
    }

    private screenToGround(x: number, y: number) {
        const cameraComponent = this.camera.camera;
        if (!cameraComponent) {
            return this.targetLookAt.clone();
        }

        const from = cameraComponent.screenToWorld(x, y, cameraComponent.nearClip);
        const to = cameraComponent.screenToWorld(x, y, cameraComponent.farClip);
        const dir = to.clone().sub(from);
        if (dir.lengthSq() > 0.000001) {
            dir.normalize();
        }

        if (Math.abs(dir.y) < 0.0001) {
            return this.targetLookAt.clone();
        }

        const t = (this.options.groundY - from.y) / dir.y;
        const point = from.add(dir.mulScalar(t));
        point.y = this.options.groundY;
        return point;
    }

    private grounded(point: pc.Vec3) {
        point.y = this.options.groundY;
        return point;
    }

    private rotate2(vec: pc.Vec2, angle: number) {
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        return new pc.Vec2(
            vec.x * cosA - vec.y * sinA,
            vec.y * cosA + vec.x * sinA
        );
    }

    private smoothToLerpT(smooth: number, dt: number) {
        return pc.math.clamp((250 * dt) / (100 * smooth + 1), 0, 1);
    }

    private degToRad(deg: number) {
        return (deg * Math.PI) / 180;
    }

    private getCursorPosition() {
        const canvas = this.app.graphicsDevice.canvas;
        if (Number.isFinite(this.lastPointerPos.x) && Number.isFinite(this.lastPointerPos.y)) {
            return this.lastPointerPos;
        }
        return new pc.Vec2(canvas.width * 0.5, canvas.height * 0.5);
    }

    private resetStateFromOptions() {
        this.targetLookAt.copy(this.grounded(this.options.lookAtCenter.clone()));
        this.currentLookAt.copy(this.targetLookAt);
        this.targetDistance = pc.math.clamp(this.options.maxDistance, this.options.minDistance, this.options.maxDistance);
        this.currentDistance = this.targetDistance;
        this.targetYawRad = this.degToRad(this.options.topYawDeg);
        this.currentYawRad = this.targetYawRad;
        this.targetPitchDeg = this.options.minPitchDeg;
        this.currentPitchDeg = this.targetPitchDeg;
    }

    private applyFallbackDefaults() {
        if (this.options.ellipseRadii.lengthSq() < 1e-8) {
            this.options.ellipseRadii.set(2000, 900);
        }
        if (this.options.rectHalfExtents.lengthSq() < 1e-8) {
            this.options.rectHalfExtents.set(2000, 900);
        }
        if (!this.options.coneAutoHeights && this.options.coneMinRangeHeight <= this.options.coneFullRangeHeight) {
            this.options.coneMinRangeHeight = this.options.maxDistance;
        }
    }

    private isVec3Finite(vec: pc.Vec3) {
        return Number.isFinite(vec.x) && Number.isFinite(vec.y) && Number.isFinite(vec.z);
    }

    private isStateFinite() {
        const cameraPos = this.camera.getPosition();
        return this.isVec3Finite(this.currentLookAt) &&
            this.isVec3Finite(this.targetLookAt) &&
            this.isVec3Finite(cameraPos) &&
            Number.isFinite(this.currentDistance) &&
            Number.isFinite(this.targetDistance) &&
            Number.isFinite(this.currentYawRad) &&
            Number.isFinite(this.targetYawRad) &&
            Number.isFinite(this.currentPitchDeg) &&
            Number.isFinite(this.targetPitchDeg);
    }

    private stopEvent(event: pc.MouseEvent) {
        if (!event.event) {
            return;
        }

        event.event.preventDefault?.();
        event.event.stopPropagation?.();
    }

    private shouldHandlePointerEvent(event: pc.MouseEvent) {
        const nativeEvent = event.event as Event | undefined;
        const target = nativeEvent?.target as HTMLElement | null | undefined;
        const canvas = this.app.graphicsDevice.canvas;

        if (!target) {
            return true;
        }

        // UI gets priority: only process camera controls when the pointer event comes from the canvas.
        if (target === canvas) {
            return true;
        }

        return canvas.contains(target);
    }

    private handleContextMenu(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        return false;
    }
}
