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

    public static final String CHANNEL_ID    = "learning_reminders";
    public static final String CHANNEL_NAME  = "摸鱼提醒";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String title   = intent.getStringExtra(EXTRA_TITLE);
        String body    = intent.getStringExtra(EXTRA_BODY);
        int    notifId = intent.getIntExtra(EXTRA_NOTIF_ID, 1);
        String taskId  = intent.getStringExtra(EXTRA_TASK_ID);
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
                break;
            case "com.learning.manager.NOTIF_REFIRE":
                // 定时到点了，直接在后台弹出一条新通知（不启动 App）
                fireNotification(context, title, body, notifId, taskId);
                break;
            default:
                break;
        }
    }

    /**
     * 由 AlarmManager 回调：直接发 Notification（不启动 App）。
     */
    public static void fireNotification(Context context, String title, String body, int notifId, String taskId) {
        ensureChannel(context);

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
                "com.learning.manager.NOTIF_CANCEL", "取消", notifId + 50000);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
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
            String action, String label, int reqCode
    ) {
        Intent i = new Intent(context, StudyNotificationActionReceiver.class);
        i.setAction(action);
        i.putExtra(EXTRA_TITLE, title);
        i.putExtra(EXTRA_BODY, body);
        i.putExtra(EXTRA_NOTIF_ID, srcNotifId);
        if (taskId != null) i.putExtra(EXTRA_TASK_ID, taskId);
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
                ch.setDescription("摸鱼提醒，含开始/换一个/取消按钮");
                ch.enableLights(true);
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }
        }
    }
}
