@file:Suppress("UNCHECKED_CAST", "USELESS_CAST", "INAPPLICABLE_JVM_NAME", "UNUSED_ANONYMOUS_PARAMETER", "SENSELESS_COMPARISON", "NAME_SHADOWING", "UNNECESSARY_NOT_NULL_ASSERTION")
package uts.sdk.modules.trandsAttribution
import android.content.Context
import android.provider.Settings
import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.google.android.gms.ads.identifier.AdvertisingIdClient
import io.dcloud.uniapp.*
import io.dcloud.uniapp.extapi.*
import io.dcloud.uts.*
import io.dcloud.uts.Map
import io.dcloud.uts.Set
import io.dcloud.uts.UTSAndroid
import java.lang.Thread
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.properties.Delegates
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
val REFERRER_OK: Number = 0
var cachedReferrer = ""
var referrerReady = false
var referrerStarted = false
open class TrandsReferrerListener : InstallReferrerStateListener {
    private var client: InstallReferrerClient
    constructor(client: InstallReferrerClient){
        this.client = client
    }
    override fun onInstallReferrerSetupFinished(responseCode: Int): Unit {
        try {
            if (responseCode == REFERRER_OK) {
                val response = this.client.getInstallReferrer()
                if (response != null) {
                    val ref = response.getInstallReferrer()
                    if (ref != null) {
                        cachedReferrer = ref
                    }
                }
            }
        }
         catch (e: Throwable) {
            console.warn("[trands-attribution] referrer read failed", e)
        }
         finally {
            referrerReady = true
            try {
                this.client.endConnection()
            }
             catch (e2: Throwable) {}
        }
    }
    override fun onInstallReferrerServiceDisconnected(): Unit {
        referrerReady = true
    }
}
open class GaidLoadTask : Runnable {
    private var context: Context
    private var latch: CountDownLatch
    open var adId: String = ""
    open var limited: Boolean = true
    constructor(context: Context, latch: CountDownLatch){
        this.context = context
        this.latch = latch
    }
    override fun run(): Unit {
        try {
            val info = AdvertisingIdClient.getAdvertisingIdInfo(this.context)
            if (info != null) {
                val id = info.getId()
                if (id != null) {
                    this.adId = id
                }
                this.limited = info.isLimitAdTrackingEnabled()
            }
        }
         catch (e: Throwable) {
            console.warn("[trands-attribution] GAID read failed", e)
        }
         finally {
            this.latch.countDown()
        }
    }
}
fun getContext(): Context? {
    return UTSAndroid.getAppContext()
}
fun buildAdInfoJson(adId: String, adType: String, limited: Boolean): String {
    if (adId.length > 0 && adId != "00000000-0000-0000-0000-000000000000") {
        return "{\"ad_id\":\"" + adId + "\",\"ad_id_type\":\"" + adType + "\",\"limited\":" + (if (limited) {
            "true"
        } else {
            "false"
        }
        ) + "}"
    }
    return "{\"ad_id\":\"\",\"ad_id_type\":\"none\",\"limited\":true}"
}
fun getAdvertisingInfo(): String {
    val context = getContext()
    if (context == null) {
        return buildAdInfoJson("", "none", true)
    }
    val latch = CountDownLatch(1)
    val task = GaidLoadTask(context, latch)
    Thread(task).start()
    try {
        latch.`await`(3, TimeUnit.SECONDS)
    }
     catch (e: Throwable) {
        console.warn("[trands-attribution] GAID await failed", e)
    }
    return buildAdInfoJson(task.adId, "gaid", task.limited)
}
fun getIdfv(): String {
    return ""
}
fun getAndroidId(): String {
    val context = getContext()
    if (context == null) {
        return ""
    }
    try {
        val id = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID)
        return if (id != null) {
            id
        } else {
            ""
        }
    }
     catch (e: Throwable) {
        console.warn("[trands-attribution] ANDROID_ID read failed", e)
        return ""
    }
}
fun prefetchInstallReferrer(): Unit {
    if (referrerStarted) {
        return
    }
    val context = getContext()
    if (context == null) {
        referrerReady = true
        return
    }
    referrerStarted = true
    try {
        val client = InstallReferrerClient.newBuilder(context).build()
        client.startConnection(TrandsReferrerListener(client))
    }
     catch (e: Throwable) {
        console.warn("[trands-attribution] prefetchInstallReferrer failed", e)
        referrerReady = true
    }
}
fun getInstallReferrer(): String {
    return cachedReferrer
}
fun isInstallReferrerReady(): Boolean {
    return referrerReady
}
fun requestTrackingAuthorization(): Unit {}
fun getTrackingAuthorizationStatus(): String {
    return "unknown"
}
fun consumeTrackingAuthorizationResult(): String {
    return ""
}
fun getAdvertisingInfoByJs(): String {
    return getAdvertisingInfo()
}
fun getIdfvByJs(): String {
    return getIdfv()
}
fun getAndroidIdByJs(): String {
    return getAndroidId()
}
fun prefetchInstallReferrerByJs(): Unit {
    return prefetchInstallReferrer()
}
fun getInstallReferrerByJs(): String {
    return getInstallReferrer()
}
fun isInstallReferrerReadyByJs(): Boolean {
    return isInstallReferrerReady()
}
fun requestTrackingAuthorizationByJs(): Unit {
    return requestTrackingAuthorization()
}
fun getTrackingAuthorizationStatusByJs(): String {
    return getTrackingAuthorizationStatus()
}
fun consumeTrackingAuthorizationResultByJs(): String {
    return consumeTrackingAuthorizationResult()
}
