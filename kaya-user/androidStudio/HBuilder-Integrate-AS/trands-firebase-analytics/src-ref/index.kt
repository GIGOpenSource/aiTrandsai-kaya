@file:Suppress("UNCHECKED_CAST", "USELESS_CAST", "INAPPLICABLE_JVM_NAME", "UNUSED_ANONYMOUS_PARAMETER", "SENSELESS_COMPARISON", "NAME_SHADOWING", "UNNECESSARY_NOT_NULL_ASSERTION")
package uts.sdk.modules.trandsFirebaseAnalytics
import android.content.Context
import android.os.Bundle
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.analytics.FirebaseAnalytics
import io.dcloud.uniapp.*
import io.dcloud.uniapp.extapi.*
import io.dcloud.uts.*
import io.dcloud.uts.Map
import io.dcloud.uts.Set
import io.dcloud.uts.UTSAndroid
import java.lang.Double
import kotlin.properties.Delegates
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import org.json.JSONObject

private const val TAG = "TrandsFA"

var analyticsInstance: FirebaseAnalytics? = null
var initTried = false
fun getContext(): Context? {
    return UTSAndroid.getAppContext()
}
fun readStringRes(context: Context, name: String): String? {
    try {
        val resId = context.getResources().getIdentifier(name, "string", context.getPackageName())
        if (resId == 0) {
            return null
        }
        return context.getString(resId)
    }
     catch (e: Throwable) {
        return null
    }
}
fun buildOptions(context: Context): FirebaseOptions? {
    val appId = readStringRes(context, "google_app_id")
    val apiKey = readStringRes(context, "google_api_key")
    val projectId = readStringRes(context, "project_id")
    if (appId == null || apiKey == null || projectId == null) {
        Log.e(TAG, "missing config.xml strings (google_app_id/api_key/project_id)")
        console.warn("[trands-firebase-analytics] missing config.xml strings")
        return null
    }
    val builder = FirebaseOptions.Builder().setApplicationId(appId).setApiKey(apiKey).setProjectId(projectId)
    val senderId = readStringRes(context, "gcm_defaultSenderId")
    if (senderId != null) {
        builder.setGcmSenderId(senderId)
    }
    val bucket = readStringRes(context, "google_storage_bucket")
    if (bucket != null) {
        builder.setStorageBucket(bucket)
    }
    return builder.build()
}
fun ensureAnalytics(): FirebaseAnalytics? {
    if (analyticsInstance != null) {
        return analyticsInstance
    }
    val context = getContext()
    if (context == null) {
        return null
    }
    if (!initTried) {
        initTried = true
        try {
            if (FirebaseApp.getApps(context).isEmpty()) {
                val options = buildOptions(context)
                if (options != null) {
                    FirebaseApp.initializeApp(context, options)
                } else {
                    FirebaseApp.initializeApp(context)
                }
            }
        }
         catch (e: Throwable) {
            Log.e(TAG, "initializeApp failed: $e")
            console.warn("[trands-firebase-analytics] initializeApp failed", e)
            try {
                val options = buildOptions(context)
                if (options != null) {
                    FirebaseApp.initializeApp(context, options)
                }
            }
             catch (e2: Throwable) {
                Log.e(TAG, "retry initializeApp failed: $e2")
                console.warn("[trands-firebase-analytics] retry initializeApp failed", e2)
            }
        }
    }
    try {
        analyticsInstance = FirebaseAnalytics.getInstance(context)
    }
     catch (e: Throwable) {
        Log.e(TAG, "getInstance failed: $e")
        console.warn("[trands-firebase-analytics] getInstance failed", e)
        analyticsInstance = null
    }
    return analyticsInstance
}
fun fillBundleFromJsonString(bundle: Bundle, raw: String): Unit {
    if (raw.length == 0 || raw == "{}" || raw == "null") {
        return
    }
    val json = JSONObject(raw)
    val it = json.keys()
    while(it.hasNext()){
        val key = "" + it.next()
        if (key.length == 0 || json.isNull(key)) {
            continue
        }
        val value = json.opt(key)
        if (value == null) {
            continue
        }
        val t = UTSAndroid.`typeof`(value)
        if (t == "string") {
            bundle.putString(key, value as String)
        } else if (t == "boolean") {
            bundle.putBoolean(key, value as Boolean)
        } else if (t == "number") {
            bundle.putDouble(key, Double.parseDouble("" + value))
        } else {
            bundle.putString(key, "" + value)
        }
    }
}
fun configure(): Boolean {
    val ok = ensureAnalytics() != null
    Log.i(TAG, "configure => $ok")
    console.log("[trands-firebase-analytics] configure => " + ok)
    return ok
}
fun logEvent(name: String, params: String? = null): Unit {
    if (name.length == 0) {
        return
    }
    val fa = ensureAnalytics()
    if (fa == null) {
        Log.e(TAG, "logEvent skipped, analytics null: $name")
        console.warn("[trands-firebase-analytics] logEvent skipped, analytics null: " + name)
        return
    }
    var bundle: Bundle? = null
    if (params != null && params.length > 0) {
        try {
            bundle = Bundle()
            fillBundleFromJsonString(bundle, params)
        }
         catch (e: Throwable) {
            Log.w(TAG, "fillBundle failed, send without params: $e")
            console.warn("[trands-firebase-analytics] fillBundle failed, send without params", e)
            bundle = null
        }
    }
    try {
        fa.logEvent(name, bundle)
        Log.i(TAG, "logEvent ok: $name")
        console.log("[trands-firebase-analytics] logEvent ok: " + name)
    }
     catch (e: Throwable) {
        Log.e(TAG, "logEvent failed: $name err=$e")
        console.warn("[trands-firebase-analytics] logEvent failed: " + name, e)
    }
}
fun setUserId(userId: String?): Unit {
    val fa = ensureAnalytics()
    if (fa == null) {
        return
    }
    fa.setUserId(userId)
}
fun setUserProperty(name: String, value: String?): Unit {
    if (name.length == 0) {
        return
    }
    val fa = ensureAnalytics()
    if (fa == null) {
        return
    }
    fa.setUserProperty(name, value)
}
fun setAnalyticsCollectionEnabled(enabled: Boolean): Unit {
    val fa = ensureAnalytics()
    if (fa == null) {
        return
    }
    fa.setAnalyticsCollectionEnabled(enabled)
}
fun configureByJs(): Boolean {
    return configure()
}
fun logEventByJs(name: String, params: String? = null): Unit {
    return logEvent(name, params)
}
fun setUserIdByJs(userId: String?): Unit {
    return setUserId(userId)
}
fun setUserPropertyByJs(name: String, value: String?): Unit {
    return setUserProperty(name, value)
}
fun setAnalyticsCollectionEnabledByJs(enabled: Boolean): Unit {
    return setAnalyticsCollectionEnabled(enabled)
}
