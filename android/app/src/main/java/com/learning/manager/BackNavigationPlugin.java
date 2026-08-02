package com.learning.manager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 返回导航管理插件。
 * 用于 JS 端通知原生层当前是否处于「顶层 Tab」视图：
 *   - 子页面（任务详情/提醒设置/备份）时，滑动返回应由 JS 的 backButton 监听器处理，
 *     原生层不得直接 moveTaskToBack / finish。
 *   - 顶层 Tab 时，原生层可允许退到桌面（moveTaskToBack）。
 */
@CapacitorPlugin(name = "BackNavigation")
public class BackNavigationPlugin extends Plugin {

    /**
     * JS 端调用：通知原生当前是否可以退出到桌面。
     * 参数：{ canExitApp: boolean }
     *   - true  → 在顶层 Tab，按返回可退桌面
     *   - false → 在子页面或有弹窗，按返回不得退桌面，由 JS 监听器自行处理返回逻辑
     */
    @PluginMethod
    public void setCanExitApp(PluginCall call) {
        boolean canExit = call.getBoolean("canExitApp", true);
        MainActivity.setCanExitApp(canExit);
        call.resolve();
    }
}
