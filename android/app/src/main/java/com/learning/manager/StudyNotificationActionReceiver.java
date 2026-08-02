package com.learning.manager;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * 处理通知卡片上的动作按钮（Snooze/Ignore）。
 * 设计目标：点按 "10分钟后"/"30分钟后"/"忽略" 时 <b>不启动 MainActivity</b>，
 * 完全在后台（BroadcastReceiver + AlarmManager + NotificationManager）完成重排。
 *
 * 约定 Action：
 *   com.learning.manager.NOTIF_SNOOZE_10
 *   com.learning.manager.NOTIF_SNOOZE_30
 *   com.learning.manager.NOTIF_IGNORE
 * 每条 Intent 携带 Extra：
 *   extra_title    String  原通知标题
 *   extra_body     String  原通知正文
 *   extra_notif_id int     原通知 ID（用于取消当前通知）
 *   extra_task_id  String? 关联任务 ID（可空，重排时再重新随机不实际，snooze 直接复用内容即可）
 */
public class StudyNotificationActionReceiver extends BroadcastReceiver {

    public static final String EXTRA_TITLE    = "extra_title";
    public static final String EXTRA_BODY     = "extra_body";
    public static final String EXTRA_NOTIF_ID = "extra_notif_id";
    public static final String EXTRA_TASK_ID  = "extra_task_id";

    public static final String CHANNEL_ID    = "learning_reminders";
    public static final String CHANNEL_NAME  = "摸鱼提醒";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String title   = intent.getStringExtra(EXTRA_TITLE);
        String body    = intent.getStringExtra(EXTRA_BODY);
        int    notifId = intent.getIntExtra(EXTRA_NOTIF_ID, 1);
        if (title == null) title = "今天摸啥鱼";
        if (body  == null) body  = "该摸一条鱼了。";

        // 先取消当前弹出的这条通知
        try {
            NotificationManagerCompat.from(context).cancel(notifId);
        } catch (Throwable ignored) {}

        String action = intent.getAction();
        long now = System.currentTimeMillis();

        switch (action) {
            case "com.learning.manager.NOTIF_SNOOZE_10":
                scheduleReNotify(context, title, body, notifId, now + 10 * 60 * 1000L);
                break;
            case "com.learning.manager.NOTIF_SNOOZE_30":
                scheduleReNotify(context, title, body, notifId, now + 30 * 60 * 1000L);
                break;
            case "com.learning.manager.NOTIF_IGNORE":
                // 仅取消，不再提醒（今日窗口内不重新安排，也不跳 App）
                break;
            case "com.learning.manager.NOTIF_REFIRE":
                // snooze 到点了，直接在后台弹出一条新通知（不启动 App）
                fireNotification(context, title, body, notifId);
                break;
            default:
                break;
        }
    }

    /**
     * 通过 AlarmManager 在指定时间触发本 Receiver 再发一次通知。
     * 不使用 Capacitor plugin，避免拉起 Application 初始化。
     */
    private void scheduleReNotify(Context context, String title, String body, int notifId, long triggerAt) {
        Intent fire = new Intent(context, StudyNotificationActionReceiver.class);
        fire.setAction("com.learning.manager.NOTIF_REFIRE");
        fire.putExtra(EXTRA_TITLE, title);
        fire.putExtra(EXTRA_BODY, body);
        fire.putExtra(EXTRA_NOTIF_ID, notifId);

        PendingIntent pi = PendingIntent.getBroadcast(
                context,
                notifId + 10000,
                fire,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT)
        );
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } catch (Throwable t) {
                try { am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi); } catch (Throwable ignored) {}
            }
        }
    }

    /**
     * 由 AlarmManager 回调：直接发 Notification（不启动 App）。
     */
    public static void fireNotification(Context context, String title, String body, int notifId) {
        ensureChannel(context);
        // 点击通知本体时仍打开 MainActivity
        Intent openApp = new Intent(context, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(
                context,
                notifId + 20000,
                openApp,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT)
        );

        // 动作按钮（依然走 Broadcast，不打开 App）
        NotificationCompat.Action a10 = buildAction(context, notifId, title, body,
                "com.learning.manager.NOTIF_SNOOZE_10", "10分钟后", notifId + 30000);
        NotificationCompat.Action a30 = buildAction(context, notifId, title, body,
                "com.learning.manager.NOTIF_SNOOZE_30", "30分钟后", notifId + 40000);
        NotificationCompat.Action aIgnore = buildAction(context, notifId, title, body,
                "com.learning.manager.NOTIF_IGNORE", "忽略", notifId + 50000);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
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

        try {
            NotificationManagerCompat.from(context).notify(notifId, builder.build());
        } catch (Throwable ignored) {}
    }

    public static NotificationCompat.Action buildAction(
            Context context, int srcNotifId, String title, String body,
            String action, String label, int reqCode
    ) {
        Intent i = new Intent(context, StudyNotificationActionReceiver.class);
        i.setAction(action);
        i.putExtra(EXTRA_TITLE, title);
        i.putExtra(EXTRA_BODY, body);
        i.putExtra(EXTRA_NOTIF_ID, srcNotifId);
        PendingIntent pi = PendingIntent.getBroadcast(
                context, reqCode, i,
                (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                        ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        : PendingIntent.FLAG_UPDATE_CURRENT)
        );
        return new NotificationCompat.Action(0, label, pi);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("学习/摸鱼提醒，含延迟按钮");
                ch.enableLights(true);
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }
        }
    }
}
