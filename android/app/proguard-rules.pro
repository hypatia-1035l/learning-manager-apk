# ============================================================================
# ProGuard / R8 规则
# ============================================================================

# 保留行号信息，便于 release 包定位崩溃栈
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# 保留泛型与签名信息（反射 / 序列化需要）
-keepattributes Signature,InnerClasses,EnclosingMethod
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations

# ----------------------------------------------------------------------------
# Capacitor / Cordova：WebView 与原生桥接，不能被混淆
# ----------------------------------------------------------------------------
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.Plugin class * { *; }
-keep @com.getcapacitor.NativePlugin class * { *; }
-keep class * implements com.getcapacitor.Plugin { *; }
-keep class * extends com.getcapacitor.Plugin { *; }

# Cordova 插件
-keep class org.apache.cordova.** { *; }
-keep class **.CordovaPlugin { *; }

# JS 通过 WebView.addJavascriptInterface 暴露的类，所有 public 方法必须保留
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ----------------------------------------------------------------------------
# AndroidX / Material：通常自带 consumer rules，这里兜底保留常用反射入口
# ----------------------------------------------------------------------------
-keep class androidx.appcompat.** { *; }
-dontwarn androidx.appcompat.**

# ----------------------------------------------------------------------------
# 反射调用兜底：保留 R 资源 ID 类的常量（部分库通过名字反射取资源）
# ----------------------------------------------------------------------------
-keep class **.R$* {
    <fields>;
}
-keepclassmembers class **.R$* {
    public static <fields>;
}

# ----------------------------------------------------------------------------
# 模型 / 序列化：保留空构造与字段（防止 JSON / 反射解析失败）
# ----------------------------------------------------------------------------
-keepclassmembers class * {
    public <init>();
}
-keepclassmembers class **.model.** { <fields>; }

# ----------------------------------------------------------------------------
# 枚举：保留 values/valueOf
# ----------------------------------------------------------------------------
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
