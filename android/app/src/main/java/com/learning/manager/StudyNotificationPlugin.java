package com.learning.manager;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 原生发布通知插件。
 * 与 @capacitor/local-notifications 并存，用来保证：
 *   - "取消" 动作使用 BroadcastReceiver，<b>不启动 App</b>
 *   - "开始" / "换一个" 动作打开 MainActivity，通过 pending action 转发给 JS
 *   - 通知发布到专用 channel "learning_reminders"
 *
 * 方法：
 *   - ensureChannel / fireNow / schedule / cancelAll
 *   - consumePendingNotifAction  读取并清除由通知动作（开始/换一个）写入的 pending action
 */
@CapacitorPlugin(name = "StudyNotifications")
public class StudyNotificationPlugin extends Plugin {

    // 暂存的通知动作（开始/换一个 + taskId），由 MainActivity 从 Intent extra 写入，
    // JS 启动/切前台时调用 consumePendingNotifAction 读取并清除
    private static volatile String sPendingAction = null;
    private static volatile String sPendingTaskId = null;

    @Override
    public void load() {
        ensureChannel(getContext());
    }

    /** MainActivity 在 onCreate / onNewIntent 中调用：写入 pending action */
    public static void setPendingNotifAction(String action, String taskId) {
        sPendingAction = action;
        sPendingTaskId = taskId;
    }

    @PluginMethod
    public void consumePendingNotifAction(PluginCall call) {
        JSObject r = new JSObject();
        r.put("action", sPendingAction == null ? "" : sPendingAction);
        r.put("taskId", sPendingTaskId == null ? "" : sPendingTaskId);
        // 读取后清除
        sPendingAction = null;
        sPendingTaskId = null;
        call.resolve(r);
    }

    @PluginMethod
    public void ensureChannel(PluginCall call) {
        ensureChannel(getContext());
        call.resolve();
    }

    /**
     * 立即发一条通知（含动作按钮），不依赖 Capacitor 打开 App。
     * 传参：{ id, title, body, taskId? }
     */
    @PluginMethod
    public void fireNow(PluginCall call) {
        int    id      = call.getInt("id", 1);
        String title   = call.getString("title", "今天摸啥鱼");
        String body    = call.getString("body",  "该摸一条鱼了。");
        String taskId  = call.getString("taskId");

        fireImpl(getContext(), id, title, body, taskId);
        call.resolve();
    }

    /**
     * 批量发布：[{id,title,body,taskId?,atMs?}]
     *   atMs 为空 → 立即发
     *   atMs 有值 → 用 AlarmManager.setAndAllowWhileIdle 精确安排
     */
    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray list = call.getArray("items", new JSArray());
        Context ctx = getContext();
        int ok = 0;
        for (int i = 0; i < list.length(); i++) {
            try {
                Object raw = list.get(i);
                if (!(raw instanceof JSONObject)) continue;
                JSONObject o = (JSONObject) raw;
                int    id      = o.has("id")    ? o.getInt("id") : (i + 1);
                String title   = o.optString("title", "今天摸啥鱼");
                String body    = o.optString("body",  "该摸一条鱼了。");
                String taskId  = o.isNull("taskId") ? null : o.optString("taskId", null);
                long   atMs    = o.has("atMs")  ? o.getLong("atMs") : 0L;
                if (atMs <= 0 || atMs <= System.currentTimeMillis()) {
                    fireImpl(ctx, id, title, body, taskId);
                } else {
                    scheduleExact(ctx, id, title, body, taskId, atMs);
                }
                ok++;
            } catch (JSONException ignored) {}
        }
        JSObject ret = new JSObject();
        ret.put("scheduled", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        try { NotificationManagerCompat.from(getContext()).cancelAll(); }
        catch (Throwable ignored) {}
        call.resolve();
    }

    /**
     * 查询应用是否被授权使用精确闹钟（Android 12+ / S 及以上）。
     * 低于 S 版本无此权限概念，一律返回 true。
     */
    @PluginMethod
    public void canScheduleExactAlarms(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", canScheduleExactAlarms(getContext()));
        call.resolve(r);
    }

    /**
     * 跳转到系统"精确闹钟"授权设置页（Android 12+）。
     * 低于 S 版本或不支持时静默忽略。
     */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Context ctx = getContext();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                i.setData(Uri.fromParts("package", ctx.getPackageName(), null));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
            }
        } catch (Throwable ignored) {}
        call.resolve();
    }

    private static boolean canScheduleExactAlarms(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    // ---------------------- internal ----------------------

    private void scheduleExact(Context ctx, int id, String title, String body, String taskId, long atMs) {
        Intent fire = new Intent(ctx, StudyNotificationActionReceiver.class);
        fire.setAction("com.learning.manager.NOTIF_REFIRE");
        fire.putExtra(StudyNotificationActionReceiver.EXTRA_TITLE, title);
        fire.putExtra(StudyNotificationActionReceiver.EXTRA_BODY, body);
        fire.putExtra(StudyNotificationActionReceiver.EXTRA_NOTIF_ID, id);
        if (taskId != null) fire.putExtra(StudyNotificationActionReceiver.EXTRA_TASK_ID, taskId);

        PendingIntent pi = PendingIntent.getBroadcast(
                ctx,
                70000 + id,
                fire,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT)
        );
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            try {
                if (canScheduleExactAlarms(ctx)) {
                    // 已获精确闹钟权限：准时触发
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
                } else {
                    // 未获精确闹钟权限：降级为宽松定时（可能漂移，但不会崩溃/静默失败）
                    am.set(AlarmManager.RTC_WAKEUP, atMs, pi);
                }
            } catch (Throwable t) {
                try { am.set(AlarmManager.RTC_WAKEUP, atMs, pi); } catch (Throwable ignored) {}
            }
        }
    }

    static void fireImpl(Context ctx, int id, String title, String body, String taskId) {
        ensureChannel(ctx);

        // 点击通知本体时打开 MainActivity，带 action=start
        Intent openApp = new Intent(ctx, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openApp.putExtra("notif_action", "start");
        if (taskId != null) openApp.putExtra("taskId", taskId);
        PendingIntent contentPi = PendingIntent.getActivity(
                ctx,
                20000 + id,
                openApp,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT)
        );

        // 开始 / 换一个：Activity intent（打开 App）
        NotificationCompat.Action aStart =
                StudyNotificationActionReceiver.buildActivityAction(ctx, id, taskId,
                        "start", "开始", 30000 + id);
        NotificationCompat.Action aReroll =
                StudyNotificationActionReceiver.buildActivityAction(ctx, id, taskId,
                        "reroll", "换一个", 40000 + id);
        // 取消：广播，不打开 App
        NotificationCompat.Action aCancel =
                StudyNotificationActionReceiver.buildBroadcastAction(ctx, id, title, body, taskId,
                        "com.learning.manager.NOTIF_CANCEL", "取消", 50000 + id);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, StudyNotificationActionReceiver.CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(contentPi)
                .addAction(aStart)
                .addAction(aReroll)
                .addAction(aCancel);
        try { NotificationManagerCompat.from(ctx).notify(id, b.build()); }
        catch (Throwable ignored) {}
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.getNotificationChannel(StudyNotificationActionReceiver.CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        StudyNotificationActionReceiver.CHANNEL_ID,
                        StudyNotificationActionReceiver.CHANNEL_NAME,
                        NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("学习/摸鱼提醒，含延迟与忽略按钮（延迟不打开App）");
                ch.enableLights(true);
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }
        }
    }
}
