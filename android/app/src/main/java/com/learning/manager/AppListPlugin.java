package com.learning.manager;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 已安装应用清单插件
 *
 * 用途：配合「方向应用名单」——在计时页列出该方向允许的应用，点击直接进入。
 *
 * 注意：Android 10+ 禁止后台启动 Activity，本插件只在**用户点击**时调用 launch()，
 * 此时 App 处于前台，启动 100% 可靠。不做任何后台自动拉起。
 *
 * JS 端调用：
 *   - listApps()                 → { ok, apps: [{ packageName, appName, isSystem }] }
 *   - getIcon({ packageName })   → { ok, dataUrl }   按需取，不要一次拉全部
 *   - launch({ packageName })    → { ok }            按包名启动（getLaunchIntentForPackage）
 */
@CapacitorPlugin(name = "AppList")
public class AppListPlugin extends Plugin {

    /** 图标输出边长（px）。128 足够 28~40dp 的显示，且 base64 体积可控 */
    private static final int ICON_SIZE = 128;

    @PluginMethod
    public void listApps(PluginCall call) {
        JSObject r = new JSObject();
        try {
            PackageManager pm = getContext().getPackageManager();
            List<ApplicationInfo> installed = pm.getInstalledApplications(PackageManager.GET_META_DATA);
            JSArray arr = new JSArray();
            for (ApplicationInfo ai : installed) {
                // 只保留「有启动入口」的应用：否则用户点了也打不开
                Intent launch = pm.getLaunchIntentForPackage(ai.packageName);
                if (launch == null) continue;
                String label;
                try {
                    label = pm.getApplicationLabel(ai).toString();
                } catch (Exception e) {
                    label = ai.packageName;
                }
                boolean isSystem =
                        (ai.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0;
                JSObject item = new JSObject();
                item.put("packageName", ai.packageName);
                item.put("appName", label);
                item.put("isSystem", isSystem);
                arr.put(item);
            }
            r.put("ok", true);
            r.put("apps", arr);
        } catch (Exception e) {
            r.put("ok", false);
            r.put("error", e.getMessage() == null ? "exception" : e.getMessage());
        }
        call.resolve(r);
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        String pkg = call.getString("packageName");
        JSObject r = new JSObject();
        if (pkg == null || pkg.isEmpty()) {
            r.put("ok", false);
            r.put("error", "no_package");
            call.resolve(r);
            return;
        }
        try {
            PackageManager pm = getContext().getPackageManager();
            Drawable d = pm.getApplicationIcon(pkg);
            Bitmap bmp;
            if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
                bmp = Bitmap.createScaledBitmap(((BitmapDrawable) d).getBitmap(), ICON_SIZE, ICON_SIZE, true);
            } else {
                bmp = Bitmap.createBitmap(ICON_SIZE, ICON_SIZE, Bitmap.Config.ARGB_8888);
                Canvas canvas = new Canvas(bmp);
                d.setBounds(0, 0, ICON_SIZE, ICON_SIZE);
                d.draw(canvas);
            }
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, bos);
            String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
            r.put("ok", true);
            r.put("dataUrl", "data:image/png;base64," + b64);
        } catch (Exception e) {
            r.put("ok", false);
            r.put("error", e.getMessage() == null ? "exception" : e.getMessage());
        }
        call.resolve(r);
    }

    @PluginMethod
    public void launch(PluginCall call) {
        String pkg = call.getString("packageName");
        JSObject r = new JSObject();
        if (pkg == null || pkg.isEmpty()) {
            r.put("ok", false);
            r.put("error", "no_package");
            call.resolve(r);
            return;
        }
        try {
            PackageManager pm = getContext().getPackageManager();
            Intent i = pm.getLaunchIntentForPackage(pkg);
            if (i == null) {
                r.put("ok", false);
                r.put("error", "no_launch_intent");
                call.resolve(r);
                return;
            }
            // 由当前 Activity 启动，正常进入目标 App 的任务栈，返回键可回到本 App。
            // 不主动加 NEW_TASK；若 Context 非 Activity 导致失败，再以 NEW_TASK 兜底。
            try {
                getContext().startActivity(i);
            } catch (Exception inner) {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
            r.put("ok", true);
        } catch (Exception e) {
            r.put("ok", false);
            r.put("error", e.getMessage() == null ? "exception" : e.getMessage());
        }
        call.resolve(r);
    }
}
