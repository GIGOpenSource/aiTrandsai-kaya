# uni-app / DCloud runtime
-keep class io.dcloud.** { *; }
-keep class io.dcloud.PandoraEntry{ *; }
-keep class io.dcloud.PandoraEntryActivity{ *; }
-keep class com.taobao.weex.** { *; }
-keep class com.alibaba.fastjson.** { *; }
-dontwarn com.taobao.weex.**
-dontwarn io.dcloud.**

# UTS plugins
-keep class uts.sdk.** { *; }
-keep class uts.sdk.modules.trandsGoogleIap.** { *; }
-keep class io.dcloud.uts.** { *; }
-dontwarn io.dcloud.uts.**

# Play Billing
-keep class com.android.billingclient.** { *; }
-dontwarn com.android.billingclient.**

# Google / Firebase
-keep class com.google.android.gms.** { *; }
-keep class com.google.firebase.** { *; }
-dontwarn com.google.android.gms.**
-dontwarn com.google.firebase.**

# Install Referrer
-keep class com.android.installreferrer.** { *; }

# fastjson optional integrations (not used in app)
-dontwarn org.springframework.**
-dontwarn org.springframework.data.**
-dontwarn org.joda.time.**
-dontwarn retrofit2.**
-dontwarn springfox.**
-dontwarn javax.ws.rs.**
-dontwarn org.glassfish.**
-dontwarn org.apache.cxf.**
-dontwarn com.google.gson.**
-dontwarn org.hibernate.**
-dontwarn kotlin.**
-dontwarn kotlinx.**

# Keep line numbers for crash reports
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# Avoid R8 parsing crash on DCloud camera synthetic classes (seen with AGP 8.7)
-keep class io.dcloud.js.camera.** { *; }
-keepclassmembers class io.dcloud.js.camera.** { *; }
-keep class io.dcloud.js.** { *; }
