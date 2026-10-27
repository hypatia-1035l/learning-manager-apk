package com.learning.manager;

import android.app.AppOpsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 越界管控所需的系统权限：查询状态 + 跳设置页。
 *
 * 三项权限的分工（见 docs/严格模式与界面改版方案.md）：
 *   1. 使用情况访问（PACKAGE_USAGE_STATS）—— 判定前台应用的前提，没有它整套检测是瞎的
 *   2. 悬浮窗（SYSTEM_ALERT_WINDOW）—— Android 10+ 后台 startActivity 的豁免凭据，
 *      「离开就拉回」必须靠它；没有就只能降级成通知
 *   3. 自启动 / 后台弹出界面 —— 厂商私有开关（MIUI 等），没有标准 API 能读状态，
 *      只能跳过去让用户自己开，所以这里只做「尽力打开」，返回是否成功
 *
 * 说明：本插件只读状态、只跳设置，不申请任何运行时权限。
 */
@CapacitorPlugin(name = "NativePerm")
public class NativePermPlugin extends Plugin {

    @PluginMethod
    public void check(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("usageAccess", hasUsageAccess(ctx));
        r.put("overlay", canDrawOverlays(ctx));
        r.put("sdkInt", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    /** 跳「使用情况访问」设置页（非运行时弹窗，必须用户手动开） */
    @PluginMethod
    public void openUsageAccess(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("打不开使用情况访问设置页");
        }
    }

    /** 跳本应用的悬浮窗授权页 */
    @PluginMethod
    public void openOverlay(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("打不开悬浮窗设置页");
        }
    }

    /** 应用详情页：厂商把自启动藏在别处时的兜底落点 */
    @PluginMethod
    public void openAppDetails(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("打不开应用详情页");
        }
    }

    /**
     * 尽力打开厂商的「自启动」管理页。
     * 这些 Activity 都是私有的，没有公开 API，也读不到开关状态——
     * 所以只返回「有没有打开成功」，不谎报“已开启”。
     */
    @PluginMethod
    public void openAutoStart(PluginCall call) {
        Context ctx = getContext();
        // 常见国产 ROM 的自启动页；按命中顺序尝试
        String[][] targets = new String[][]{
                {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
                {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
                {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
                {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
                {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
                {"com.hihonor.systemmanager", "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
        };
        for (String[] t : targets) {
            try {
                Intent i = new Intent();
                i.setComponent(new ComponentName(t[0], t[1]));
                if (i.resolveActivity(ctx.getPackageManager()) == null) continue;
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                JSObject r = new JSObject();
                r.put("opened", true);
                call.resolve(r);
                return;
            } catch (Exception ignored) {
                // 试下一个
            }
        }
        // 都打不开：不弹错，交给 UI 提示走「应用详情 → 自启动」手动路径
        JSObject r = new JSObject();
        r.put("opened", false);
        call.resolve(r);
    }

    // ---------- 供 Service 复用的静态判定 ----------

    /** 使用情况访问是否已授权（AppOps 的 MODE_ALLOWED 才是真的能用） */
    public static boolean hasUsageAccess(Context ctx) {
        try {
            AppOpsManager appOps = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            if (appOps == null) return false;
            int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? appOps.unsafeCheckOpNoThrow(
                            AppOpsManager.OPSTR_GET_USAGE_STATS,
                            Process.myUid(),
                            ctx.getPackageName())
                    : appOps.checkOpNoThrow(
                            AppOpsManager.OPSTR_GET_USAGE_STATS,
                            Process.myUid(),
                            ctx.getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    /** 是否已授予悬浮窗（Android 6 起才有这个概念，minSdk 24 所以恒走系统判断） */
    public static boolean canDrawOverlays(Context ctx) {
        try {
            return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx);
        } catch (Exception e) {
            return false;
        }
    }
}
