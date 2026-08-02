package com.learning.manager;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
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
 *   - 通知动作按钮（10分钟后/30分钟后/忽略）使用 BroadcastReceiver，<b>不启动 App</b>
 *   - 通知发布到专用 channel "learning_reminders"
 *
 * 注意：@capacitor/local-notifications 仍用于 schedule 的 API 层（定时、ID 管理、跨平台），
 * 但 Android 端实际通知的 action PendingIntent 在 Capacitor 源码中是 Activity Intent，
 * 会打开 App。因此我们额外暴露 "fireNow" / "scheduleExact" 两个方法，用于 Snooze 场景下
 * 在后台不启动 App 也能弹出通知。
 */
@CapacitorPlugin(name = "StudyNotifications")
public class StudyNotificationPlugin extends Plugin {

    @Override
    public void load() {
        ensureChannel(getContext());
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
            try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi); }
            catch (Throwable t) {
                try { am.set(AlarmManager.RTC_WAKEUP, atMs, pi); } catch (Throwable ignored) {}
            }
        }
    }

    static void fireImpl(Context ctx, int id, String title, String body, String taskId) {
        ensureChannel(ctx);

        Intent openApp = new Intent(ctx, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (taskId != null) openApp.putExtra("taskId", taskId);
        PendingIntent contentPi = PendingIntent.getActivity(
                ctx,
                20000 + id,
                openApp,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT)
        );

        NotificationCompat.Action a10 =
                StudyNotificationActionReceiver.buildAction(ctx, id, title, body,
                        "com.learning.manager.NOTIF_SNOOZE_10", "10分钟后", 30000 + id);
        NotificationCompat.Action a30 =
                StudyNotificationActionReceiver.buildAction(ctx, id, title, body,
                        "com.learning.manager.NOTIF_SNOOZE_30", "30分钟后", 40000 + id);
        NotificationCompat.Action aIgnore =
                StudyNotificationActionReceiver.buildAction(ctx, id, title, body,
                        "com.learning.manager.NOTIF_IGNORE", "忽略", 50000 + id);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, StudyNotificationActionReceiver.CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(contentPi)
                .addAction(a10)
                .addAction(a30)
                .addAction(aIgnore);
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
