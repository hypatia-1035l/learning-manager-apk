package com.learning.manager;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * JS 端控制的「是否允许退桌面」标志位。
     * - true：  在顶层 Tab，按返回键/侧滑返回 → moveTaskToBack（退到桌面）
     * - false： 在子页面或有弹窗，按返回键/侧滑返回 → 不做原生动作，由 JS 的 backButton 监听器处理
     *           （关弹窗 / 回 Tab 顶层）
     */
    private static volatile boolean sCanExitApp = true;

    public static void setCanExitApp(boolean canExitApp) {
        sCanExitApp = canExitApp;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StudyTimerPlugin.class);
        registerPlugin(UsageStatsPlugin.class);
        registerPlugin(StudyNotificationPlugin.class);
        registerPlugin(BackNavigationPlugin.class);
        super.onCreate(savedInstanceState);

        // 拦截系统返回键（含物理返回键 + 手势导航边缘侧滑）：
        // 只有在 JS 明确允许时才退到桌面，其余情况交给 JS 的 backButton 监听器决定行为。
        // 注意：onBackPressedDispatcher 优先级高于 Capacitor 内部默认的 finish 逻辑，
        // 这样可以防止手势导航侧滑直接把 Activity 退到后台。
        OnBackPressedCallback callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (sCanExitApp) {
                    // 顶层：退到桌面（不 finish，保持 App 在后台便于快速切回）
                    moveTaskToBack(true);
                }
                // 子页面/弹窗：不做任何原生动作。
                // Capacitor 的 Bridge 会把这次返回事件通过 backButton 回调传给 JS，
                // 由 JS 监听器负责关闭弹窗或把子页面切回顶层 Tab。
            }
        };
        getOnBackPressedDispatcher().addCallback(this, callback);
    }
}
