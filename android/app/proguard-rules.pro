# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Phase 8 — keep Kotlin coroutines internals. The kiwi-health/capacitor-health-
# connect plugin's compiled bytecode references kotlin.coroutines.jvm.internal
# .* classes (like SpillingKt) that some toolchains aggressively strip even
# with minifyEnabled=false. Keeping them is harmless when minify is off, and
# prevents a NoClassDefFoundError on the first suspending plugin call.
-keep class kotlin.coroutines.jvm.internal.** { *; }
-keep class kotlin.coroutines.** { *; }
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlin.coroutines.jvm.internal.**

# Keep the kiwi-health plugin's classes too — its @CapacitorPlugin annotation
# and reflection-based dispatch need them visible.
-keep class com.ubiehealth.capacitor.healthconnect.** { *; }
