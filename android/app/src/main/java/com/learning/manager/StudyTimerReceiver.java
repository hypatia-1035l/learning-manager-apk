package com.learning.manager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

/**
 * 通知按钮事件接收器
 *
 * 处理来自 ongoing notification 的两种按钮动作 + 通知点击：
 *   - ACTION_COMPLETE：完成当前内容（不强制拉起 Activity，依赖 JS 回前台后消费 pending action）
 *   - ACTION_END：结束学习（拉起 Activity 让用户填写进度）
 *   - ACTION_OPEN：仅拉起 App（不写 pending action）
 *
 * 可靠性设计：
 *   1. 无论 Activity / WebView 是否存活，先将 action 持久化到 SharedPreferences
 *      (study_timer_pending_action)，end 优先级高于 complete
 *   2. end 动作立即 startActivity 拉起 MainActivity
 *   3. 若 Plugin Bridge 存活，通过 StudyTimerPlugin.notifyActionIfReady 即时回传 JS
 *   4. 冷启动时由 JS 主动调 consumePendingAction 读取并消费
 */
public class StudyTimerReceiver extends BroadcastReceiver {

    public static final String ACTION_COMPLETE = "com.learning.manager.STUDY_COMPLETE";
    public static final String ACTION_END = "com.learning.manager.STUDY_END";
    public static final String ACTION_OPEN = "com.learning.manager.STUDY_OPEN";

    // pending action 持久化
    private static final String PREF_PENDING = "study_timer_pending";
    private static final String KEY_PENDING_ACTION = "study_timer_pending_action";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        if (ACTION_OPEN.equals(action)) {
            // 通知点击：仅拉起 App，不写 pending action
            launchMainActivity(context, "open");
            return;
        }

        String timerAction = null;
        if (ACTION_COMPLETE.equals(action)) timerAction = "complete";
        else if (ACTION_END.equals(action)) timerAction = "end";
        if (timerAction == null) return;

        // 1. 从 Service 的持久化状态读取当前计时快照
        String taskName = StudyTimerService.getTaskNameFromPrefs(context);
        String objectName = StudyTimerService.getObjectNameFromPrefs(context);
        long elapsedSeconds = StudyTimerService.getElapsedSecondsFromPrefs(context);

        // 2. 写 pending action（end 优先级高于 complete，已有 end 未消费时不覆盖）
        savePendingAction(context, timerAction, taskName, objectName, elapsedSeconds);

        // 3. end 动作拉起 Activity（需要用户看到填写进度 UI）
        if ("end".equals(timerAction)) {
            launchMainActivity(context, "end");
        }
        // complete 不拉起 Activity：依赖 JS 回前台后 consumePendingAction

        // 4. 若 Bridge 存活，即时回传（优化体验，非必需）
        StudyTimerPlugin.notifyActionIfReady(timerAction);
    }

    // ---------- pending action 持久化 ----------
    private static void savePendingAction(Context ctx, String action, String taskName,
                                          String objectName, long elapsedSeconds) {
        SharedPreferences sp = ctx.getSharedPreferences(PREF_PENDING, Context.MODE_PRIVATE);
        // end 优先级高，已有 end 未消费时不覆盖
        String existing = sp.getString(KEY_PENDING_ACTION, null);
        if (existing != null) {
            try {
                JSONObject j = new JSONObject(existing);
                if ("end".equals(j.optString("action"))) return;
            } catch (Exception ignored) {
                // 解析失败则覆盖
            }
        }
        try {
            JSONObject json = new JSONObject();
            json.put("action", action);
            json.put("taskName", taskName);
            json.put("objectName", objectName);
            json.put("elapsedSeconds", elapsedSeconds);
            json.put("savedAt", System.currentTimeMillis());
            sp.edit().putString(KEY_PENDING_ACTION, json.toString()).commit();
        } catch (Exception ignored) {
        }
    }

    public static String readPendingAction(Context ctx) {
        return ctx.getSharedPreferences(PREF_PENDING, Context.MODE_PRIVATE)
                .getString(KEY_PENDING_ACTION, null);
    }

    public static void clearPendingAction(Context ctx) {
        ctx.getSharedPreferences(PREF_PENDING, Context.MODE_PRIVATE)
                .edit().remove(KEY_PENDING_ACTION).commit();
    }

    private void launchMainActivity(Context context, String fromAction) {
        Intent i = new Intent(context, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (fromAction != null) {
            i.putExtra("fromStudyTimerAction", fromAction);
        }
        // Android 10+ 后台启动 Activity 限制：前台服务 + 通知按钮 PendingIntent 不受限
        try {
            context.startActivity(i);
        } catch (Exception ignored) {
        }
    }
}
