package com.learning.manager;

import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * 学习计时 Capacitor 插件
 *
 * JS 端调用：
 *   - start(taskName, objectName, elapsedSeconds)  启动前台服务 + 常驻通知
 *   - update(taskName, objectName, elapsedSeconds)  更新对象名 / 校准计时（complete 后调用）
 *   - stop()                                        停止服务 + 取消通知
 *   - consumePendingAction()                       读取并清除 Native 侧暂存的 pending action
 *   - getStatus()                                  查询 Service 当前运行状态 + 计时
 *
 * 事件（仅 Activity 在前台时即时回调，冷启动靠 consumePendingAction 兜底）：
 *   - "studyTimerAction" { action: "complete" | "end" }
 */
@CapacitorPlugin(name = "StudyTimer")
public class StudyTimerPlugin extends Plugin {

    private static final String EVT_ACTION = "studyTimerAction";

    // Bridge 存活时的静态引用，供 StudyTimerReceiver 调用 notifyListeners
    private static volatile Bridge staticBridge;

    @Override
    public void load() {
        super.load();
        staticBridge = getBridge();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String taskName = call.getString("taskName", "");
        String objectName = call.getString("objectName", "");
        int elapsedSeconds = call.getInt("elapsedSeconds", 0);
        Context ctx = getContext();
        Intent i = new Intent(ctx, StudyTimerService.class);
        i.putExtra(StudyTimerService.EXTRA_TASK_NAME, taskName);
        i.putExtra(StudyTimerService.EXTRA_OBJECT_NAME, objectName);
        i.putExtra(StudyTimerService.EXTRA_ELAPSED_SECONDS, elapsedSeconds);
        try {
            ContextCompat.startForegroundService(ctx, i);
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        String taskName = call.getString("taskName", "");
        String objectName = call.getString("objectName", "");
        int elapsedSeconds = call.getInt("elapsedSeconds", 0);
        Context ctx = getContext();
        Intent i = new Intent(ctx, StudyTimerService.class);
        i.putExtra(StudyTimerService.EXTRA_TASK_NAME, taskName);
        i.putExtra(StudyTimerService.EXTRA_OBJECT_NAME, objectName);
        i.putExtra(StudyTimerService.EXTRA_ELAPSED_SECONDS, elapsedSeconds);
        try {
            ContextCompat.startForegroundService(ctx, i);
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        try {
            ctx.stopService(new Intent(ctx, StudyTimerService.class));
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void consumePendingAction(PluginCall call) {
        Context ctx = getContext();
        String raw = StudyTimerReceiver.readPendingAction(ctx);
        JSObject r = new JSObject();
        if (raw != null) {
            try {
                JSONObject j = new JSONObject(raw);
                r.put("action", j.optString("action"));
                r.put("taskName", j.optString("taskName"));
                r.put("objectName", j.optString("objectName"));
                r.put("elapsedSeconds", j.optLong("elapsedSeconds"));
            } catch (Exception ignored) {
            }
            // 读取后立即清除
            StudyTimerReceiver.clearPendingAction(ctx);
        }
        call.resolve(r);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("isRunning", StudyTimerService.isRunningFromPrefs(ctx));
        r.put("taskName", StudyTimerService.getTaskNameFromPrefs(ctx));
        r.put("objectName", StudyTimerService.getObjectNameFromPrefs(ctx));
        r.put("elapsedSeconds", StudyTimerService.getElapsedSecondsFromPrefs(ctx));
        call.resolve(r);
    }

    // ---------- 供 Receiver 调用：Bridge 存活时即时回传 JS ----------
    public static void notifyActionIfReady(String action) {
        if (staticBridge == null) return;
        try {
            com.getcapacitor.PluginHandle handle = staticBridge.getPlugin("StudyTimer");
            if (handle != null) {
                StudyTimerPlugin plugin = (StudyTimerPlugin) handle.getInstance();
                if (plugin != null) {
                    JSObject data = new JSObject();
                    data.put("action", action);
                    plugin.notifyListeners(EVT_ACTION, data);
                }
            }
        } catch (Exception ignored) {
        }
    }
}
