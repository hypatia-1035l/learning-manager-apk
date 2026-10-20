package com.learning.manager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.List;

/**
 * 开机 / 应用更新后恢复原生提醒。
 *
 * AlarmManager 的闹钟在设备重启后会全部失效，且应用更新也会清掉已排的闹钟，
 * 系统都不会自动恢复。这里从 {@link NotifScheduleStore} 读回上次排程：
 *   - 还没到点的 → 原样重排（复用 StudyNotificationPlugin.scheduleExact）
 *   - 已经过点的 → 丢弃并清出镜像
 */
public class StudyNotificationBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }

        List<NotifScheduleStore.Entry> list = NotifScheduleStore.all(context);
        long now = System.currentTimeMillis();
        for (NotifScheduleStore.Entry e : list) {
            if (e.atMs <= now) {
                NotifScheduleStore.remove(context, e.id);
                continue;
            }
            try {
                StudyNotificationPlugin.scheduleExact(
                        context, e.id, e.title, e.body, e.taskId, e.atMs, e.channel, e.cooldownMinutes);
            } catch (Throwable ignored) {
            }
        }
    }
}
