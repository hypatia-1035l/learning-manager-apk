package com.learning.manager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;

/**
 * 学习计时前台服务
 *
 * 职责：
 *   - 维护一条 ongoing notification（学习计时状态显示）
 *   - 原生侧自跑计时（Handler 每秒刷新通知），不依赖 WebView/JS 存活
 *   - 运行状态持久化到 SharedPreferences（isRunning/taskName/objectName/startedAt/accumulatedMs）
 *     以便进程被杀后其他组件（Receiver/Plugin）仍能读取
 *
 * 关键流程（避免 ForegroundServiceDidNotStartInTimeException）：
 *   onCreate()  → createNotificationChannel()
 *   onStartCommand() → 读取 Intent / 恢复状态 → buildNotification() → startForeground() → 启动计时 Handler
 */
public class StudyTimerService extends Service {

    public static final String CHANNEL_ID = "study_timer";
    public static final int NOTIF_ID = 2000;

    // Intent extras
    public static final String EXTRA_TASK_NAME = "taskName";
    public static final String EXTRA_OBJECT_NAME = "objectName";
    public static final String EXTRA_ELAPSED_SECONDS = "elapsedSeconds";

    // 运行时计时
    private Handler handler;
    private Runnable tickRunnable;
    private long startedAtElapsedRealtime;  // SystemClock.elapsedRealtime() 起点
    private long accumulatedMs;             // 启动时传入的累积毫秒
    private String taskName = "";
    private String objectName = "";

    // 状态持久化（进程被杀后，Receiver/Plugin 仍可读取）
    private static final String PREF_NAME = "study_timer_state";
    private static final String KEY_IS_RUNNING = "isRunning";
    private static final String KEY_TASK_NAME = "taskName";
    private static final String KEY_OBJECT_NAME = "objectName";
    private static final String KEY_STARTED_AT = "startedAtElapsedRealtime";
    private static final String KEY_ACCUMULATED_MS = "accumulatedMs";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // 渠道在 onCreate 中创建，确保 startForeground 调用时渠道已就绪
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 1. 读取 Intent / 恢复状态
        if (intent != null && intent.hasExtra(EXTRA_TASK_NAME)) {
            taskName = intent.getStringExtra(EXTRA_TASK_NAME);
            objectName = intent.getStringExtra(EXTRA_OBJECT_NAME);
            int elapsedSec = intent.getIntExtra(EXTRA_ELAPSED_SECONDS, 0);
            accumulatedMs = elapsedSec * 1000L;
            startedAtElapsedRealtime = SystemClock.elapsedRealtime();
        } else {
            // Service 被系统重建（START_STICKY），从 SharedPreferences 恢复
            restoreState();
        }

        // 2. 立即 startForeground，避免 ForegroundServiceDidNotStartInTimeException
        Notification notification = buildNotification(getElapsedMs());
        startForeground(NOTIF_ID, notification);

        // 3. 持久化状态
        saveState();

        // 4. 启动计时 Handler（每秒刷新通知）
        startTicking();

        return START_STICKY;
    }

    private void createNotificationChannel() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "学习计时", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("学习计时状态显示");
            ch.setShowBadge(false);
            ch.enableVibration(false);
            ch.setSound(null, null);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification(long elapsedMs) {
        // 通知点击：拉起 MainActivity
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("fromStudyTimerAction", "open");
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentPI = PendingIntent.getActivity(this, 0, openIntent, piFlags);

        // 按钮：完成当前内容
        Intent completeIntent = new Intent(this, StudyTimerReceiver.class);
        completeIntent.setAction(StudyTimerReceiver.ACTION_COMPLETE);
        PendingIntent completePI = PendingIntent.getBroadcast(
                this, 1, completeIntent, piFlags);

        // 按钮：结束学习
        Intent endIntent = new Intent(this, StudyTimerReceiver.class);
        endIntent.setAction(StudyTimerReceiver.ACTION_END);
        PendingIntent endPI = PendingIntent.getBroadcast(
                this, 2, endIntent, piFlags);

        String title = "📚 " + (taskName.isEmpty() ? "学习中" : taskName);
        String text = "对象：" + (objectName.isEmpty() ? "—" : objectName)
                + " · " + formatElapsed(elapsedMs);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_recent_history)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setContentIntent(contentPI)
                .setShowWhen(false)
                .addAction(0, "完成当前内容", completePI)
                .addAction(0, "结束学习", endPI);

        return b.build();
    }

    private void startTicking() {
        if (handler == null) {
            handler = new Handler(Looper.getMainLooper());
        } else if (tickRunnable != null) {
            handler.removeCallbacks(tickRunnable);
        }
        tickRunnable = new Runnable() {
            @Override
            public void run() {
                long elapsed = getElapsedMs();
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.notify(NOTIF_ID, buildNotification(elapsed));
                }
                // 更新持久化中的 accumulatedMs（用墙钟差重算）
                saveState();
                handler.postDelayed(this, 1000);
            }
        };
        handler.postDelayed(tickRunnable, 1000);
    }

    private long getElapsedMs() {
        return accumulatedMs + (SystemClock.elapsedRealtime() - startedAtElapsedRealtime);
    }

    // ---------- 状态持久化 ----------
    private SharedPreferences prefs() {
        return getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    private void saveState() {
        SharedPreferences.Editor ed = prefs().edit();
        ed.putBoolean(KEY_IS_RUNNING, true);
        ed.putString(KEY_TASK_NAME, taskName);
        ed.putString(KEY_OBJECT_NAME, objectName);
        ed.putLong(KEY_STARTED_AT, startedAtElapsedRealtime);
        ed.putLong(KEY_ACCUMULATED_MS, accumulatedMs);
        ed.apply();
    }

    private void clearState() {
        prefs().edit().clear().apply();
    }

    private void restoreState() {
        SharedPreferences sp = prefs();
        taskName = sp.getString(KEY_TASK_NAME, "");
        objectName = sp.getString(KEY_OBJECT_NAME, "");
        startedAtElapsedRealtime = sp.getLong(KEY_STARTED_AT, SystemClock.elapsedRealtime());
        accumulatedMs = sp.getLong(KEY_ACCUMULATED_MS, 0);
    }

    @Override
    public void onDestroy() {
        if (handler != null && tickRunnable != null) {
            handler.removeCallbacks(tickRunnable);
        }
        // Service 被销毁（用户结束学习 / App 被杀）时清除持久化状态
        clearState();
        super.onDestroy();
    }

    // ---------- 工具 ----------
    // 毫秒 → "HH:MM:SS"
    static String formatElapsed(long ms) {
        long totalSec = ms / 1000;
        long h = totalSec / 3600;
        long m = (totalSec % 3600) / 60;
        long s = totalSec % 60;
        if (h > 0) {
            return String.format("%02d:%02d:%02d", h, m, s);
        }
        return String.format("%02d:%02d", m, s);
    }

    // ---------- 静态访问（供 Receiver/Plugin 读取持久化状态） ----------
    // 注意：仅作为进程存活时的快速访问；Receiver/Plugin 应优先读取 SharedPreferences
    public static boolean isRunningFromPrefs(Context ctx) {
        return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .getBoolean(KEY_IS_RUNNING, false);
    }

    public static String getTaskNameFromPrefs(Context ctx) {
        return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .getString(KEY_TASK_NAME, "");
    }

    public static String getObjectNameFromPrefs(Context ctx) {
        return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .getString(KEY_OBJECT_NAME, "");
    }

    public static long getElapsedSecondsFromPrefs(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        long accumulated = sp.getLong(KEY_ACCUMULATED_MS, 0);
        long startedAt = sp.getLong(KEY_STARTED_AT, 0);
        long elapsedRealtime = SystemClock.elapsedRealtime();
        long elapsedMs = accumulated + (elapsedRealtime - startedAt);
        return Math.max(0, elapsedMs / 1000);
    }
}
