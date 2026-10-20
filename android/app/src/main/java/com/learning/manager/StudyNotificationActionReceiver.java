package com.learning.manager;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * 处理通知卡片上的动作按钮。
 * 设计目标：点按 "取消" 时不启动 MainActivity，完全在后台完成；
 *           "开始" / "换一个" 打开 MainActivity（Activity PendingIntent），由 JS 处理。
 *
 * 约定 Action：
 *   com.learning.manager.NOTIF_CANCEL   仅取消当前通知，不启动 App
 *   com.learning.manager.NOTIF_REFIRE   定时到达时由 AlarmManager 触发，弹出通知（不启动 App）
 *
 * 每条 Intent 携带 Extra：
 *   extra_title    String  原通知标题
 *   extra_body     String  原通知正文
 *   extra_notif_id int     原通知 ID（用于取消当前通知）
 *   extra_task_id  String? 关联任务 ID
 */
public class StudyNotificationActionReceiver extends BroadcastReceiver {

    public static final String EXTRA_TITLE    = "extra_title";
    public static final String EXTRA_BODY     = "extra_body";
    public static final String EXTRA_NOTIF_ID = "extra_notif_id";
    public static final String EXTRA_TASK_ID  = "extra_task_id";
    public static final String EXTRA_CHANNEL  = "extra_channel";
    // 冷却分钟数：点「取消」后 N 分钟内不再推送下一条提醒
    public static final String EXTRA_COOLDOWN_MINUTES = "extra_cooldown_minutes";

    // 通知冷却的持久化（与 JS 侧的 cooldownUntil 独立：Android 上「取消」是纯广播，
    // 不进 JS，所以冷却必须原生自己落一份，并在到点触发前拦截）
    private static final String PREF_COOLDOWN = "study_notif_cooldown";
    private static final String KEY_COOLDOWN_UNTIL = "cooldownUntil";

    static void setCooldownUntil(Context ctx, long untilMs) {
        try {
            ctx.getSharedPreferences(PREF_COOLDOWN, Context.MODE_PRIVATE)
                    .edit().putLong(KEY_COOLDOWN_UNTIL, untilMs).apply();
        } catch (Throwable ignored) {}
    }

    static long getCooldownUntil(Context ctx) {
        try {
            return ctx.getSharedPreferences(PREF_COOLDOWN, Context.MODE_PRIVATE)
                    .getLong(KEY_COOLDOWN_UNTIL, 0L);
        } catch (Throwable ignored) {
            return 0L;
        }
    }

    public static final String CHANNEL_ID_STRONG  = "reminders_strong";
    public static final String CHANNEL_ID_WEAK    = "reminders_weak";
    public static final String CHANNEL_ID_SILENT  = "reminders_silent";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String title   = intent.getStringExtra(EXTRA_TITLE);
        String body    = intent.getStringExtra(EXTRA_BODY);
        int    notifId = intent.getIntExtra(EXTRA_NOTIF_ID, 1);
        String taskId  = intent.getStringExtra(EXTRA_TASK_ID);
        String channel = intent.getStringExtra(EXTRA_CHANNEL);
        if (channel == null) channel = CHANNEL_ID_STRONG;
        if (title == null) title = "今天摸啥鱼";
        if (body  == null) body  = "该摸一条鱼了。";

        // 先取消当前弹出的这条通知
        try {
            NotificationManagerCompat.from(context).cancel(notifId);
        } catch (Throwable ignored) {}

        String action = intent.getAction();

        switch (action) {
            case "com.learning.manager.NOTIF_CANCEL":
                // 仅取消，不再提醒（今日窗口内不重新安排，也不跳 App）
                // 同步清掉本地镜像：用户已明确取消，开机后不该再恢复
                NotifScheduleStore.remove(context, notifId);
                // 写入通知冷却：之后 cooldownMinutes 内到点的提醒会被拦截并顺延
                int cd = intent.getIntExtra(EXTRA_COOLDOWN_MINUTES, 0);
                if (cd > 0) {
                    setCooldownUntil(context, System.currentTimeMillis() + cd * 60_000L);
                }
                break;
            case "com.learning.manager.NOTIF_REFIRE": {
                long now = System.currentTimeMillis();
                long cooldownUntil = getCooldownUntil(context);
                if (now < cooldownUntil) {
                    // 冷却期内：不弹通知，把同一条闹钟顺延到冷却结束（+1 秒）后，
                    // 镜像同步更新，避免用户手动重排前这条提醒被彻底丢掉
                    int cdRefresh = intent.getIntExtra(EXTRA_COOLDOWN_MINUTES, 0);
                    long nextAt = cooldownUntil + 1000L;
                    StudyNotificationPlugin.scheduleExact(
                            context, notifId, title, body, taskId, nextAt, channel, cdRefresh);
                    NotifScheduleStore.put(context, notifId, title, body, taskId, nextAt, channel, cdRefresh);
                    break;
                }
                // 定时到点了，直接在后台弹出一条新通知（不启动 App）
                int cdFire = intent.getIntExtra(EXTRA_COOLDOWN_MINUTES, 0);
                fireNotification(context, title, body, notifId, taskId, channel, cdFire);
                // 已触发：从本地镜像移除，避免重启后被重复恢复
                NotifScheduleStore.remove(context, notifId);
                break;
            }
            default:
                break;
        }
    }

    /**
     * 由 AlarmManager 回调：直接发 Notification（不启动 App）。
     */
    public static void fireNotification(Context context, String title, String body, int notifId, String taskId, String channel, int cooldownMinutes) {
        ensureChannels(context);
        if (channel == null) channel = CHANNEL_ID_STRONG;

        // 点击通知本体时打开 MainActivity，带 taskId
        Intent openApp = new Intent(context, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openApp.putExtra("notif_action", "start");
        if (taskId != null) openApp.putExtra("taskId", taskId);
        PendingIntent contentPi = PendingIntent.getActivity(
                context,
                notifId + 20000,
                openApp,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT)
        );

        // 开始：Activity intent（打开 App，带 action=start）
        NotificationCompat.Action aStart = buildActivityAction(context, notifId, taskId,
                "start", "开始", notifId + 30000);
        // 换一个：Activity intent（打开 App，带 action=reroll）
        NotificationCompat.Action aReroll = buildActivityAction(context, notifId, taskId,
                "reroll", "换一个", notifId + 40000);
        // 取消：broadcast（不打开 App）
        NotificationCompat.Action aCancel = buildBroadcastAction(context, notifId, title, body, taskId,
                "com.learning.manager.NOTIF_CANCEL", "取消", notifId + 50000, cooldownMinutes);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel)
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

        try {
            NotificationManagerCompat.from(context).notify(notifId, builder.build());
        } catch (Throwable ignored) {}
    }

    /**
     * 构建打开 MainActivity 的动作（开始 / 换一个），点击后由 JS 处理。
     */
    public static NotificationCompat.Action buildActivityAction(
            Context context, int srcNotifId, String taskId,
            String actionName, String label, int reqCode
    ) {
        Intent i = new Intent(context, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra("notif_action", actionName);
        if (taskId != null) i.putExtra("taskId", taskId);
        PendingIntent pi = PendingIntent.getActivity(
                context, reqCode, i,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT)
        );
        return new NotificationCompat.Action(0, label, pi);
    }

    /**
     * 构建不打开 App 的广播动作（取消）。
     */
    public static NotificationCompat.Action buildBroadcastAction(
            Context context, int srcNotifId, String title, String body, String taskId,
            String action, String label, int reqCode, int cooldownMinutes
    ) {
        Intent i = new Intent(context, StudyNotificationActionReceiver.class);
        i.setAction(action);
        i.putExtra(EXTRA_TITLE, title);
        i.putExtra(EXTRA_BODY, body);
        i.putExtra(EXTRA_NOTIF_ID, srcNotifId);
        i.putExtra(EXTRA_COOLDOWN_MINUTES, cooldownMinutes);
        if (taskId != null) i.putExtra(EXTRA_TASK_ID, taskId);
        PendingIntent pi = PendingIntent.getBroadcast(
                context, reqCode, i,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT)
        );
        return new NotificationCompat.Action(0, label, pi);
    }

    private static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            if (nm.getNotificationChannel(CHANNEL_ID_STRONG) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID_STRONG, "强提醒", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("提神闹钟声+震动，确保不错过");
                ch.enableLights(true);
                ch.enableVibration(true);
                ch.setVibrationPattern(new long[]{0, 220, 120, 220, 120, 220, 120, 360});
                // 优先用自带的升调闹钟声（更提神），缺失时退回系统闹钟声
                Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                try {
                    soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + R.raw.alarm_reminder);
                } catch (Throwable ignored) {}
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                ch.setSound(soundUri, attrs);
                nm.createNotificationChannel(ch);
            }
            if (nm.getNotificationChannel(CHANNEL_ID_WEAK) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID_WEAK, "弱提醒", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("只出现在通知栏，不打扰");
                nm.createNotificationChannel(ch);
            }
            if (nm.getNotificationChannel(CHANNEL_ID_SILENT) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID_SILENT, "静默提醒", NotificationManager.IMPORTANCE_MIN);
                ch.setDescription("仅保留通知记录，几乎无打扰");
                nm.createNotificationChannel(ch);
            }
        }
    }
}
