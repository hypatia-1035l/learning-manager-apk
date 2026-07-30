package com.learning.manager;

import android.app.AppOpsManager;
import android.app.usage.UsageStatsManager;
import android.app.usage.UsageStats;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;

/**
 * 应用使用统计插件
 *
 * 通过 UsageStatsManager 读取今日各应用前台时长。
 * JS 端调用：
 *   - hasPermission()           → 检查使用情况访问权限
 *   - requestPermission()       → 跳「使用情况访问权限」设置页
 *   - queryTodayStats()         → 返回今日应用使用列表
 */
@CapacitorPlugin(name = "UsageStats")
public class UsageStatsPlugin extends Plugin {

    @PluginMethod
    public void hasPermission(PluginCall call) {
        boolean granted = false;
        try {
            AppOpsManager appOps = (AppOpsManager) getContext()
                    .getSystemService(Context.APP_OPS_SERVICE);
            int mode = appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    android.os.Process.myUid(),
                    getContext().getPackageName());
            granted = mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            granted = false;
        }
        JSObject r = new JSObject();
        r.put("granted", granted);
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) { /* ignore */ }
        JSObject r = new JSObject();
        r.put("opened", true);
        call.resolve(r);
    }

    @PluginMethod
    public void queryTodayStats(PluginCall call) {
        JSObject r = new JSObject();
        try {
            UsageStatsManager usm = (UsageStatsManager) getContext()
                    .getSystemService(Context.USAGE_STATS_SERVICE);
            if (usm == null) {
                r.put("ok", false);
                r.put("error", "no_usage_stats_service");
                call.resolve(r);
                return;
            }
            // 今日 0 点
            Calendar cal = Calendar.getInstance();
            cal.set(Calendar.HOUR_OF_DAY, 0);
            cal.set(Calendar.MINUTE, 0);
            cal.set(Calendar.SECOND, 0);
            cal.set(Calendar.MILLISECOND, 0);
            long start = cal.getTimeInMillis();
            long end = System.currentTimeMillis();

            Map<String, UsageStats> statsMap = usm.queryAndAggregateUsageStats(start, end);
            if (statsMap == null) statsMap = new HashMap<>();

            PackageManager pm = getContext().getPackageManager();
            JSArray arr = new JSArray();
            long total = 0;
            for (UsageStats s : statsMap.values()) {
                String pkg = s.getPackageName();
                long fg = s.getTotalTimeInForeground();
                if (fg < 1000) continue; // 小于 1 秒忽略
                String label;
                try {
                    ApplicationInfo ai = pm.getApplicationInfo(pkg, 0);
                    label = pm.getApplicationLabel(ai).toString();
                } catch (Exception e) {
                    label = pkg;
                }
                JSObject item = new JSObject();
                item.put("packageName", pkg);
                item.put("appName", label);
                item.put("foregroundMs", fg);
                arr.put(item);
                total += fg;
            }
            r.put("ok", true);
            r.put("totalForegroundMs", total);
            r.put("stats", arr);
            r.put("startMs", start);
            r.put("endMs", end);
        } catch (Exception e) {
            r.put("ok", false);
            r.put("error", e.getMessage() == null ? "exception" : e.getMessage());
        }
        call.resolve(r);
    }
}
