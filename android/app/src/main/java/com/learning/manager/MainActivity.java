package com.learning.manager;

import android.content.Intent;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * JS 端控制的「是否允许退桌面」标志位。
     * - true：  在顶层 Tab，按返回键/侧滑返回 → moveTaskToBack（退到桌面）
     * - false： 在子页面/会话中，按返回交给 Capacitor 的 AppPlugin 派发 JS backButton 事件
     */
    private static volatile boolean sCanExitApp = true;

    // 当前 Activity 实例与返回回调：setCanExitApp 需要据此动态开关回调
    private static volatile MainActivity sInstance;
    private static volatile OnBackPressedCallback sBackCallback;

    /**
     * 更新「是否允许退桌面」。
     *
     * 关键：OnBackPressedDispatcher 只会调用「最后添加且 enabled」的回调。
     * 若本回调恒为 enabled，返回事件会被直接吞掉 —— Capacitor 的 AppPlugin 收不到，
     * JS 的 backButton 监听器也就永远不会触发（子页面只能靠 DOM 手势返回）。
     * 因此这里按标志位动态 setEnabled：
     *   true  → 本回调启用，消费事件并 moveTaskToBack
     *   false → 本回调禁用，事件落到 AppPlugin 的回调 → 派发 JS backButton
     */
    public static void setCanExitApp(boolean canExitApp) {
        sCanExitApp = canExitApp;
        MainActivity act = sInstance;
        if (act != null) act.applyBackCallbackEnabled();
    }

    private void applyBackCallbackEnabled() {
        final OnBackPressedCallback cb = sBackCallback;
        if (cb == null) return;
        runOnUiThread(() -> cb.setEnabled(sCanExitApp));
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StudyTimerPlugin.class);
        registerPlugin(UsageStatsPlugin.class);
        registerPlugin(StudyNotificationPlugin.class);
        registerPlugin(BackNavigationPlugin.class);
        registerPlugin(AppListPlugin.class);
        registerPlugin(NativePermPlugin.class);
        super.onCreate(savedInstanceState);

        // 捕获通知动作（开始/换一个）：冷启动时从启动 Intent 读取
        captureNotifAction(getIntent());

        sInstance = this;

        // 拦截系统返回键（含物理返回键 + 手势导航边缘侧滑）：
        //   顶层 Tab（canExitApp=true）→ moveTaskToBack，退到桌面但不 finish
        //   子页面/会话（canExitApp=false）→ 本回调被禁用，事件交给 AppPlugin → JS backButton
        // 注意：本回调在 super.onCreate 之后注册，优先级高于 AppPlugin 的回调，
        // 所以必须靠 setEnabled 让位，而不是在 handleOnBackPressed 里「什么都不做」。
        sBackCallback = new OnBackPressedCallback(sCanExitApp) {
            @Override
            public void handleOnBackPressed() {
                // 能走到这里说明 canExitApp=true（false 时本回调已被禁用）
                moveTaskToBack(true);
            }
        };
        getOnBackPressedDispatcher().addCallback(this, sBackCallback);
    }

    @Override
    public void onDestroy() {
        if (sInstance == this) {
            sInstance = null;
            sBackCallback = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // 热启动时：通知动作（开始/换一个）打开 App，捕获并转发给插件
        captureNotifAction(intent);
    }

    /**
     * 从通知 Intent 中读取 notif_action / taskId，转发给 StudyNotificationPlugin。
     * Bridge 存活（App 已在前台）时直接派发 JS 事件，避免「点了没反应、要等切前后台」；
     * 派发不成功（冷启动、JS 还没挂载）才写 pending，由 JS 启动后消费。
     */
    private void captureNotifAction(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra("notif_action");
        if (action == null || action.isEmpty()) return;
        String taskId = intent.getStringExtra("taskId");
        boolean delivered = StudyNotificationPlugin.notifyActionIfReady(action, taskId);
        if (!delivered) {
            StudyNotificationPlugin.setPendingNotifAction(action, taskId);
        }
    }
}
