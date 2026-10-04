package com.learning.manager;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * 已排程提醒的本地镜像。
 *
 * 为什么需要它：原生提醒走 AlarmManager，而系统在设备重启后会清空所有闹钟，
 * 且开机广播到来时 WebView（localStorage 里的排程）还没起来，无法从 JS 侧恢复。
 * 因此这里把每条「待到点」的提醒镜像到 SharedPreferences，
 * 由 {@link StudyNotificationBootReceiver} 在开机后原样重排。
 *
 * 只镜像提醒自身的 id：计划项 1..120、回归提醒 1000、「下一项」2001。
 * 计时常驻通知（2000）与越界提醒（3001）不走这里，重启后本就不该恢复。
 */
final class NotifScheduleStore {

    private static final String PREF = "study_notif_schedule";
    private static final String KEY_PREFIX = "n";

    static final class Entry {
        int id;
        String title;
        String body;
        String taskId;
        long atMs;
        String channel;
    }

    private NotifScheduleStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    private static String keyOf(int id) {
        return KEY_PREFIX + id;
    }

    static synchronized void put(Context ctx, int id, String title, String body,
                                 String taskId, long atMs, String channel) {
        if (id <= 0 || atMs <= 0) return;
        try {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("title", title == null ? "" : title);
            o.put("body", body == null ? "" : body);
            o.put("taskId", taskId == null ? JSONObject.NULL : taskId);
            o.put("atMs", atMs);
            o.put("channel", channel == null ? "" : channel);
            prefs(ctx).edit().putString(keyOf(id), o.toString()).apply();
        } catch (Throwable ignored) {
        }
    }

    static synchronized void remove(Context ctx, int id) {
        try {
            prefs(ctx).edit().remove(keyOf(id)).apply();
        } catch (Throwable ignored) {
        }
    }

    static synchronized void removeAll(Context ctx, Collection<Integer> ids) {
        try {
            SharedPreferences.Editor ed = prefs(ctx).edit();
            for (Integer id : ids) {
                if (id != null) ed.remove(keyOf(id));
            }
            ed.apply();
        } catch (Throwable ignored) {
        }
    }

    static synchronized void clear(Context ctx) {
        try {
            prefs(ctx).edit().clear().apply();
        } catch (Throwable ignored) {
        }
    }

    static synchronized List<Entry> all(Context ctx) {
        List<Entry> out = new ArrayList<>();
        try {
            for (Map.Entry<String, ?> e : prefs(ctx).getAll().entrySet()) {
                if (!(e.getValue() instanceof String)) continue;
                try {
                    JSONObject o = new JSONObject((String) e.getValue());
                    Entry en = new Entry();
                    en.id = o.optInt("id", 0);
                    en.title = o.optString("title", "");
                    en.body = o.optString("body", "");
                    en.taskId = o.isNull("taskId") ? null : o.optString("taskId", null);
                    en.atMs = o.optLong("atMs", 0L);
                    en.channel = o.optString("channel", "");
                    if (en.id > 0 && en.atMs > 0) out.add(en);
                } catch (Throwable ignored) {
                }
            }
        } catch (Throwable ignored) {
        }
        return out;
    }
}
