package com.learning.manager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 学习计时前台服务
 *
 * 职责：
 *   - 维护一条 ongoing notification（学习计时状态显示）
 *   - 原生侧自跑计时（Handler 每秒刷新通知），不依赖 WebView/JS 存活
 *   - 运行状态持久化到 SharedPreferences（isRunning/taskName/objectName/startedAt/accumulatedMs）
 *     以便进程被杀后其他组件（Receiver/Plugin）仍能读取
 *   - P3 越界提醒：学习计时进行中、本 App 在后台时，轮询检测前台应用是否跑偏（见 checkForeground）
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
    public static final String EXTRA_IS_UPDATE = "isUpdate";
    public static final String EXTRA_NODE_LABEL = "nodeLabel";

    // P3 越界提醒配置（随 start 传入）
    public static final String EXTRA_GUARD_ENABLED = "guardEnabled";
    public static final String EXTRA_GUARD_GRACE = "guardGrace";
    public static final String EXTRA_GUARD_ALLOWED = "guardAllowed";
    public static final String EXTRA_GUARD_BLOCKED = "guardBlocked";

    // 越界提醒独立通知
    // 通知 ID 命名空间（全应用共享）：2000=计时常驻、2001=「下一项」常驻（JS 侧
    // reminderService.NOTIF_ID_NEXT）、3001=越界提醒、1..120=计划项、1000=回归提醒。
    // 越界提醒原用 2001，会与「下一项」常驻通知互相覆盖，故移到 3001。
    public static final int GUARD_NOTIF_ID = 3001;
    public static final String GUARD_CHANNEL_ID = "study_guard";
    private static final long GUARD_POLL_MS = 60_000L;                 // 轮询间隔 60s
    private static final long GUARD_WARN_COOLDOWN_MS = 5 * 60 * 1000L; // 同次越界至少隔 5 分钟再提醒

    // 标记是否为用户主动停止（用于 onDestroy 中区分主动停止 vs 系统杀死）
    // 当 true 时 onDestroy 会清除持久化状态；当 false（系统杀死）时保留状态用于恢复
    public static volatile boolean explicitlyStopped = false;

    // Service 进程内的存活标志：区分「prefs 里还写着 isRunning」和「服务真的在跑」。
    // 进程被系统/OEM 清理、覆盖安装时 onDestroy 不会执行，prefs 会残留 isRunning=true，
    // 只读 prefs 会把它误判成仍在计时（并把 App 关闭期间的墙钟时间算进学习时长）。
    private static volatile boolean sAlive = false;

    public static boolean isAlive() {
        return sAlive;
    }

    // 运行时计时
    private Handler handler;
    private Runnable tickRunnable;
    private long startedAtElapsedRealtime;  // SystemClock.elapsedRealtime() 起点
    private long startedAtWallMs;           // 会话开始的墙钟时刻（识别设备重启用）
    private long accumulatedMs;             // 启动时传入的累积毫秒
    private String taskName = "";
    private String objectName = "";
    // 当前进度节点名（序列配了 progressNodes 且为数量型时才非空）
    private String nodeLabel = "";

    // 越界提醒（P3）运行时配置
    private boolean guardEnabled = false;
    private long guardGraceMs = 5 * 60 * 1000L;
    private final Set<String> allowedApps = new HashSet<>();
    private final Set<String> blockedApps = new HashSet<>();
    private String selfPackage = "";
    private long firstOffListAt = 0;        // 未列出应用首次越界时刻
    private long lastGuardWarnAt = 0;       // 上次越界提醒时刻（节流）
    private Handler guardHandler;
    private Runnable guardRunnable;

    // 状态持久化（进程被杀后，Receiver/Plugin 仍可读取）
    private static final String PREF_NAME = "study_timer_state";
    private static final String KEY_IS_RUNNING = "isRunning";
    private static final String KEY_TASK_NAME = "taskName";
    private static final String KEY_OBJECT_NAME = "objectName";
    private static final String KEY_NODE_LABEL = "nodeLabel";
    private static final String KEY_STARTED_AT = "startedAtElapsedRealtime";
    private static final String KEY_ACCUMULATED_MS = "accumulatedMs";
    private static final String KEY_GUARD_ENABLED = "guardEnabled";
    private static final String KEY_GUARD_GRACE_MS = "guardGraceMs";
    private static final String KEY_GUARD_ALLOWED = "guardAllowed";
    private static final String KEY_GUARD_BLOCKED = "guardBlocked";
    // 会话开始的墙钟时刻：用于识别「设备重启」（elapsedRealtime 会归零）
    private static final String KEY_STARTED_AT_WALL = "startedAtWallMs";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sAlive = true;
        // 渠道在 onCreate 中创建，确保 startForeground 调用时渠道已就绪
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // 1. 读取 Intent / 恢复状态
        if (intent != null && intent.hasExtra(EXTRA_TASK_NAME)) {
            boolean isUpdate = intent.getBooleanExtra(EXTRA_IS_UPDATE, false);
            if (isUpdate) {
                // update：仅更新名称，不重置计时。
                // 但若 Service 是被这次 update 新建出来的（进程/服务已被回收），
                // 计时基准仍是 0，getElapsedMs() 会返回「开机时长」。
                // 首次 update 必须按传入的 elapsedSeconds 初始化基准。
                if (startedAtElapsedRealtime <= 0) {
                    int elapsedSec = intent.getIntExtra(EXTRA_ELAPSED_SECONDS, 0);
                    accumulatedMs = elapsedSec * 1000L;
                    startedAtElapsedRealtime = SystemClock.elapsedRealtime();
                    startedAtWallMs = System.currentTimeMillis();
                }
                taskName = intent.getStringExtra(EXTRA_TASK_NAME);
                objectName = intent.getStringExtra(EXTRA_OBJECT_NAME);
                nodeLabel = safeStr(intent.getStringExtra(EXTRA_NODE_LABEL));
            } else {
                // start：全新开始，重置计时
                taskName = intent.getStringExtra(EXTRA_TASK_NAME);
                objectName = intent.getStringExtra(EXTRA_OBJECT_NAME);
                nodeLabel = safeStr(intent.getStringExtra(EXTRA_NODE_LABEL));
                int elapsedSec = intent.getIntExtra(EXTRA_ELAPSED_SECONDS, 0);
                accumulatedMs = elapsedSec * 1000L;
                startedAtElapsedRealtime = SystemClock.elapsedRealtime();
                startedAtWallMs = System.currentTimeMillis();
                // 越界提醒配置（仅 start 时更新；update 不改）
                guardEnabled = intent.getBooleanExtra(EXTRA_GUARD_ENABLED, false);
                guardGraceMs = intent.getIntExtra(EXTRA_GUARD_GRACE, 5) * 60_000L;
                allowedApps.clear();
                blockedApps.clear();
                ArrayList<String> allow = intent.getStringArrayListExtra(EXTRA_GUARD_ALLOWED);
                ArrayList<String> block = intent.getStringArrayListExtra(EXTRA_GUARD_BLOCKED);
                if (allow != null) allowedApps.addAll(allow);
                if (block != null) blockedApps.addAll(block);
                selfPackage = getPackageName();
            }
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
        // 5. 启动越界提醒轮询（guardEnabled=false 时轮询内部直接跳过，几乎零开销）
        startGuardPolling();

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
        // 正文：序列 · 进度节点 · 时长（节点为空时省略节点段）
        String objPart = objectName.isEmpty() ? "—" : objectName;
        String text = nodeLabel.isEmpty()
                ? objPart + " · " + formatElapsed(elapsedMs)
                : objPart + " · " + nodeLabel + " · " + formatElapsed(elapsedMs);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
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
        return prefsOf(this);
    }

    private static SharedPreferences prefsOf(Context ctx) {
        return ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    /**
     * 判断持久化状态是否已被「设备重启」作废。
     *
     * SystemClock.elapsedRealtime() 在重启后归零，而 prefs 里的起点属于上一次开机的时间轴；
     * 用「本次开机墙钟 = 当前墙钟 - elapsedRealtime」与会话开始墙钟比较：
     * 会话开始早于本次开机 → 中间重启过，状态不可信。
     * 旧数据没有该字段 → 返回 false，保持原有行为（向后兼容）。
     */
    private static boolean isStaleAfterReboot(SharedPreferences sp) {
        long startedWall = sp.getLong(KEY_STARTED_AT_WALL, 0L);
        if (startedWall <= 0L) return false;
        long bootWall = System.currentTimeMillis() - SystemClock.elapsedRealtime();
        return bootWall > startedWall + 1000L;
    }

    private void saveState() {
        SharedPreferences.Editor ed = prefs().edit();
        ed.putBoolean(KEY_IS_RUNNING, true);
        ed.putString(KEY_TASK_NAME, taskName);
        ed.putString(KEY_OBJECT_NAME, objectName);
        ed.putString(KEY_NODE_LABEL, nodeLabel);
        ed.putLong(KEY_STARTED_AT, startedAtElapsedRealtime);
        ed.putLong(KEY_STARTED_AT_WALL, startedAtWallMs);
        ed.putLong(KEY_ACCUMULATED_MS, accumulatedMs);
        ed.putBoolean(KEY_GUARD_ENABLED, guardEnabled);
        ed.putLong(KEY_GUARD_GRACE_MS, guardGraceMs);
        ed.putStringSet(KEY_GUARD_ALLOWED, new HashSet<>(allowedApps));
        ed.putStringSet(KEY_GUARD_BLOCKED, new HashSet<>(blockedApps));
        ed.apply();
    }

    private void clearState() {
        prefs().edit().clear().apply();
    }

    private void restoreState() {
        SharedPreferences sp = prefs();
        if (isStaleAfterReboot(sp)) {
            // 设备重启过：前台服务不可能跨重启存活，陈旧状态直接丢弃并归零
            clearState();
            taskName = "";
            objectName = "";
            nodeLabel = "";
            accumulatedMs = 0;
            startedAtElapsedRealtime = SystemClock.elapsedRealtime();
            startedAtWallMs = System.currentTimeMillis();
            guardEnabled = false;
            guardGraceMs = 5 * 60 * 1000L;
            allowedApps.clear();
            blockedApps.clear();
            selfPackage = getPackageName();
            return;
        }
        taskName = sp.getString(KEY_TASK_NAME, "");
        objectName = sp.getString(KEY_OBJECT_NAME, "");
        nodeLabel = sp.getString(KEY_NODE_LABEL, "");
        startedAtElapsedRealtime = sp.getLong(KEY_STARTED_AT, SystemClock.elapsedRealtime());
        startedAtWallMs = sp.getLong(KEY_STARTED_AT_WALL, 0L);
        accumulatedMs = sp.getLong(KEY_ACCUMULATED_MS, 0);
        guardEnabled = sp.getBoolean(KEY_GUARD_ENABLED, false);
        guardGraceMs = sp.getLong(KEY_GUARD_GRACE_MS, 5 * 60 * 1000L);
        allowedApps.clear();
        blockedApps.clear();
        allowedApps.addAll(sp.getStringSet(KEY_GUARD_ALLOWED, new HashSet<>()));
        blockedApps.addAll(sp.getStringSet(KEY_GUARD_BLOCKED, new HashSet<>()));
        selfPackage = getPackageName();
    }

    @Override
    public void onDestroy() {
        sAlive = false;
        if (handler != null && tickRunnable != null) {
            handler.removeCallbacks(tickRunnable);
        }
        if (guardHandler != null && guardRunnable != null) {
            guardHandler.removeCallbacks(guardRunnable);
        }
        // 仅在用户主动停止时清除持久化状态
        // 系统杀死（内存回收）时保留状态，确保重启后可恢复
        if (explicitlyStopped) {
            clearState();
            explicitlyStopped = false;
        }
        super.onDestroy();
    }

    /** 供 Plugin.stop 调用：无条件清掉持久化状态（不依赖 onDestroy 是否被调用） */
    public static void clearPersistedState(Context ctx) {
        prefsOf(ctx).edit().clear().apply();
    }

    // ---------- 工具 ----------
    private static String safeStr(String s) {
        return s == null ? "" : s;
    }

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
        SharedPreferences sp = prefsOf(ctx);
        if (isStaleAfterReboot(sp)) {
            // 设备重启过：会话不可能还在跑，顺手清掉，避免 App 恢复出错误时长
            sp.edit().clear().apply();
            return false;
        }
        return sp.getBoolean(KEY_IS_RUNNING, false);
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
        SharedPreferences sp = prefsOf(ctx);
        if (isStaleAfterReboot(sp)) return 0;
        long accumulated = sp.getLong(KEY_ACCUMULATED_MS, 0);
        long startedAt = sp.getLong(KEY_STARTED_AT, 0);
        long elapsedRealtime = SystemClock.elapsedRealtime();
        long elapsedMs = accumulated + (elapsedRealtime - startedAt);
        if (elapsedMs < 0) elapsedMs = 0; // 防御：时钟异常时不返回负时长
        return elapsedMs / 1000;
    }

    /**
     * 服务已不在进程内时读取「冻结」的已存时长：
     * 只返回最后一次落盘的 accumulatedMs，不再叠加 elapsedRealtime 差值，
     * 避免把服务死亡后的时间算进学习时长。
     */
    public static long getFrozenElapsedSecondsFromPrefs(Context ctx) {
        SharedPreferences sp = prefsOf(ctx);
        if (isStaleAfterReboot(sp)) return 0;
        return Math.max(0, sp.getLong(KEY_ACCUMULATED_MS, 0)) / 1000;
    }

    // ---------- 越界提醒（P3） ----------
    // 独立 Handler，每 GUARD_POLL_MS 检测一次前台应用是否跑偏
    private void startGuardPolling() {
        if (guardHandler == null) {
            guardHandler = new Handler(Looper.getMainLooper());
        } else if (guardRunnable != null) {
            guardHandler.removeCallbacks(guardRunnable);
        }
        guardRunnable = new Runnable() {
            @Override
            public void run() {
                checkForeground();
                if (guardHandler != null) {
                    guardHandler.postDelayed(this, GUARD_POLL_MS);
                }
            }
        };
        if (guardHandler != null) {
            guardHandler.postDelayed(guardRunnable, GUARD_POLL_MS);
        }
    }

    // 取最近前台应用包名（最近 10s 窗口内 lastTimeUsed 最新、且有过前台时长的应用）
    private String getRecentForegroundPackage() {
        try {
            UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) return null;
            long now = System.currentTimeMillis();
            List<UsageStats> stats = usm.queryUsageStats(
                    UsageStatsManager.INTERVAL_BEST, now - 10_000, now);
            String top = null;
            long topTime = -1;
            if (stats != null) {
                for (UsageStats s : stats) {
                    if (s.getTotalTimeInForeground() <= 0) continue;
                    long last = s.getLastTimeUsed();
                    if (last > topTime) {
                        topTime = last;
                        top = s.getPackageName();
                    }
                }
            }
            return top;
        } catch (Exception e) {
            return null; // 未授权或异常：安全返回 null（不提醒）
        }
    }

    // 越界检测：按三层身份判定是否提醒
    private void checkForeground() {
        if (!guardEnabled) return;
        String fg = getRecentForegroundPackage();
        if (fg == null || fg.equals(selfPackage)) {
            firstOffListAt = 0; // 在本 App 内或无数据：重置未列出计时
            return;
        }
        if (allowedApps.contains(fg)) {
            firstOffListAt = 0; // 允许名单：不打扰
            return;
        }
        long now = System.currentTimeMillis();
        if (blockedApps.contains(fg)) {
            // 分心名单：立即提醒（仍受全局节流保护，避免刷屏）
            warnGuard("分心提醒", "你正在打开分心应用，回去做：" + (taskName.isEmpty() ? "学习" : taskName));
            return;
        }
        // 未列出：超容忍分钟数才提醒
        if (firstOffListAt == 0) firstOffListAt = now;
        if (now - firstOffListAt >= guardGraceMs) {
            warnGuard("越界提醒", "你已离开「" + (taskName.isEmpty() ? "学习" : taskName)
                    + "」超过 " + (guardGraceMs / 60000) + " 分钟，回来继续吧");
        }
    }

    // 节流后发送越界通知
    private void warnGuard(String title, String body) {
        long now = System.currentTimeMillis();
        if (now - lastGuardWarnAt < GUARD_WARN_COOLDOWN_MS) return;
        lastGuardWarnAt = now;
        sendGuardNotification(title, body);
    }

    // 发送越界提醒通知（独立渠道 + 独立 id，不干扰前台服务通知）
    private void sendGuardNotification(String title, String body) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    GUARD_CHANNEL_ID, "越界提醒", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("学习计时期间检测到跑偏时提醒");
            ch.enableVibration(true);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("fromStudyTimerAction", "open");
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentPI = PendingIntent.getActivity(this, 10, openIntent, piFlags);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, GUARD_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(contentPI)
                .setShowWhen(true);
        nm.notify(GUARD_NOTIF_ID, b.build());
    }
}
