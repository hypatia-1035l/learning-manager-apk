package com.learning.manager;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;

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

    // App 已在前台时：直接派发 JS 事件，不必等下一次 visibilitychange
    private static final String EVT_NOTIF_ACTION = "notifAction";
    private static volatile Bridge staticBridge;

    @Override
    public void load() {
        super.load();
        staticBridge = getBridge();
        ensureChannels(getContext());
    }

    /** MainActivity 在 onCreate / onNewIntent 中调用：写入 pending action */
    public static void setPendingNotifAction(String action, String taskId) {
        sPendingAction = action;
        sPendingTaskId = taskId;
    }

    /**
     * Bridge 存活时立即把通知动作派发给 JS（返回是否派发成功）。
     * 派发成功时 MainActivity 不再写 pending，避免「事件 + pending」重复处理同一动作。
     */
    public static boolean notifyActionIfReady(String action, String taskId) {
        Bridge bridge = staticBridge;
        if (bridge == null) return false;
        try {
            com.getcapacitor.PluginHandle handle = bridge.getPlugin("StudyNotifications");
            if (handle == null) return false;
            StudyNotificationPlugin plugin = (StudyNotificationPlugin) handle.getInstance();
            if (plugin == null) return false;
            JSObject data = new JSObject();
            data.put("action", action == null ? "" : action);
            data.put("taskId", taskId == null ? "" : taskId);
            plugin.notifyListeners(EVT_NOTIF_ACTION, data);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
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
        ensureChannels(getContext());
        call.resolve();
    }

    @PluginMethod
    public void ensureChannels(PluginCall call) {
        ensureChannels(getContext());
        call.resolve();
    }

    /**
     * 立即发一条通知（含动作按钮），不依赖 Capacitor 打开 App。
     * 传参：{ id, title, body, taskId? }
     */
    @PluginMethod
    public void fireNow(PluginCall call) {
        int    id       = call.getInt("id", 1);
        String title    = call.getString("title", "今天摸啥鱼");
        String body     = call.getString("body",  "该摸一条鱼了。");
        String taskId   = call.getString("taskId");
        String channel  = call.getString("channel", StudyNotificationActionReceiver.CHANNEL_ID_STRONG);

        fireImpl(getContext(), id, title, body, taskId, channel, 0);
        call.resolve();
    }

    /**
     * 批量发布：[{id,title,body,taskId?,atMs?,cooldownMinutes?}]
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
                int    id        = o.has("id")    ? o.getInt("id") : (i + 1);
                String title     = o.optString("title", "今天摸啥鱼");
                String body      = o.optString("body",  "该摸一条鱼了。");
                String taskId    = o.isNull("taskId") ? null : o.optString("taskId", null);
                long   atMs      = o.has("atMs")  ? o.getLong("atMs") : 0L;
                String channel   = o.optString("channel", StudyNotificationActionReceiver.CHANNEL_ID_STRONG);
                int    cooldown  = o.optInt("cooldownMinutes", 0);
                if (atMs <= 0 || atMs <= System.currentTimeMillis()) {
                    fireImpl(ctx, id, title, body, taskId, channel, cooldown);
                } else {
                    scheduleExact(ctx, id, title, body, taskId, atMs, channel, cooldown);
                    // 镜像到本地存储：设备重启会清空 AlarmManager，届时由
                    // StudyNotificationBootReceiver 据此原样重排
                    NotifScheduleStore.put(ctx, id, title, body, taskId, atMs, channel, cooldown);
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
        try {
            JSArray ids = call.getArray("ids");
            NotificationManagerCompat nm = NotificationManagerCompat.from(getContext());
            Context ctx = getContext();
            if (ids != null && ids.length() > 0) {
                // 只取消 JS 指定的提醒 id：cancelAll() 会连带清掉
                // 计时常驻通知（2000）与越界提醒（3001）。
                ArrayList<Integer> idList = new ArrayList<>();
                for (int i = 0; i < ids.length(); i++) {
                    try {
                        Integer id = ids.getInt(i);
                        if (id != null && id >= 0) {
                            nm.cancel(id);
                            // 关键：通知只是「已弹出的那条」，真正让它到点触发的是
                            // AlarmManager 里的闹钟。只 cancel 通知会导致关提醒/会话抑制/
                            // 重排后旧闹钟照样在后台触发（同一计划项重复提醒）。
                            cancelAlarm(ctx, id);
                            idList.add(id);
                        }
                    } catch (Exception ignored) {}
                }
                // 同步清掉本地镜像，避免开机后把已取消的提醒又恢复出来
                NotifScheduleStore.removeAll(getContext(), idList);
            } else {
                nm.cancelAll();
                // 无 ids 时按镜像逐个取消闹钟，再清镜像
                for (NotifScheduleStore.Entry e : NotifScheduleStore.all(ctx)) {
                    cancelAlarm(ctx, e.id);
                }
                NotifScheduleStore.clear(getContext());
            }
        } catch (Throwable ignored) {}
        call.resolve();
    }

    /** 取消某个 id 已排的 AlarmManager 闹钟（与 scheduleExact 的 requestCode 一致） */
    private static void cancelAlarm(Context ctx, int id) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent fire = new Intent(ctx, StudyNotificationActionReceiver.class);
            fire.setAction("com.learning.manager.NOTIF_REFIRE");
            PendingIntent pi = PendingIntent.getBroadcast(
                    ctx,
                    70000 + id,
                    fire,
                    (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            ? PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
                            : PendingIntent.FLAG_NO_CREATE)
            );
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        } catch (Throwable ignored) {}
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

    static void scheduleExact(Context ctx, int id, String title, String body, String taskId, long atMs, String channel, int cooldownMinutes) {
        Intent fire = new Intent(ctx, StudyNotificationActionReceiver.class);
        fire.setAction("com.learning.manager.NOTIF_REFIRE");
        fire.putExtra(StudyNotificationActionReceiver.EXTRA_TITLE, title);
        fire.putExtra(StudyNotificationActionReceiver.EXTRA_BODY, body);
        fire.putExtra(StudyNotificationActionReceiver.EXTRA_NOTIF_ID, id);
        fire.putExtra(StudyNotificationActionReceiver.EXTRA_CHANNEL, channel);
        fire.putExtra(StudyNotificationActionReceiver.EXTRA_COOLDOWN_MINUTES, cooldownMinutes);
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
                    // 已获精确闹钟权限：真正精确触发（setAndAllowWhileIdle 是
                    // WINDOW_HEURISTIC，Doze 下仍会被系统批量延后）。
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
                } else {
                    // 未获精确闹钟权限：降级为「宽松但允许打盹触发」。
                    // 这里刻意不用 am.set()：set() 在 Doze 下会被推迟到维护窗口（可能几小时），
                    // setAndAllowWhileIdle 无需精确闹钟权限，仍能在打盹中送达（约 9 分钟节流）。
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi);
                }
            } catch (Throwable t) {
                // 精确闹钟被系统拒绝（SecurityException）时退回宽松排程
                try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi); } catch (Throwable ignored) {}
            }
        }
    }

    static void fireImpl(Context ctx, int id, String title, String body, String taskId, String channel, int cooldownMinutes) {
        ensureChannels(ctx);

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
        // 取消：广播，不打开 App；携带冷却分钟数，接收器据此写入通知冷却
        NotificationCompat.Action aCancel =
                StudyNotificationActionReceiver.buildBroadcastAction(ctx, id, title, body, taskId,
                        "com.learning.manager.NOTIF_CANCEL", "取消", 50000 + id, cooldownMinutes);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
                .setSmallIcon(R.drawable.ic_stat_notify)
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

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            // 强提醒：自带提神闹钟声 + 震动 + 弹 heads-up，确保外部可感知
            if (nm.getNotificationChannel(StudyNotificationActionReceiver.CHANNEL_ID_STRONG) == null) {
                NotificationChannel ch = new NotificationChannel(
                        StudyNotificationActionReceiver.CHANNEL_ID_STRONG,
                        "强提醒",
                        NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("提神闹钟声+震动，确保不错过");
                ch.enableLights(true);
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{0, 220, 120, 220, 120, 220, 120, 360});
                // 优先用自带的升调闹钟声（更提神），缺失时退回系统闹钟声
                Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                try {
                    soundUri = Uri.parse("android.resource://" + ctx.getPackageName() + "/" + R.raw.alarm_reminder);
                } catch (Throwable ignored) {}
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                ch.setSound(soundUri, attrs);
                nm.createNotificationChannel(ch);
            }

            // 弱提醒：仅在通知栏显示，不发声不震动
            if (nm.getNotificationChannel(StudyNotificationActionReceiver.CHANNEL_ID_WEAK) == null) {
                NotificationChannel ch = new NotificationChannel(
                        StudyNotificationActionReceiver.CHANNEL_ID_WEAK,
                        "弱提醒",
                        NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("只出现在通知栏，不打扰");
                nm.createNotificationChannel(ch);
            }

            // 静默提醒：不发声、不震动、不弹 heads-up，最小程度存在感
            if (nm.getNotificationChannel(StudyNotificationActionReceiver.CHANNEL_ID_SILENT) == null) {
                NotificationChannel ch = new NotificationChannel(
                        StudyNotificationActionReceiver.CHANNEL_ID_SILENT,
                        "静默提醒",
                        NotificationManager.IMPORTANCE_MIN);
                ch.setDescription("仅保留通知记录，几乎无打扰");
                nm.createNotificationChannel(ch);
            }
        }
    }
}
