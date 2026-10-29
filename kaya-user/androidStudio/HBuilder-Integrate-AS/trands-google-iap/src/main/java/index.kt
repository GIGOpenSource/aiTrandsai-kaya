@file:Suppress("UNCHECKED_CAST", "UNUSED_PARAMETER", "DEPRECATION")
package uts.sdk.modules.trandsGoogleIap

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingConfig
import com.android.billingclient.api.BillingConfigResponseListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.GetBillingConfigParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.ProductDetailsResponseListener
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryProductDetailsResult
import com.android.billingclient.api.UnfetchedProduct
import com.taobao.weex.WXSDKManager
import com.taobao.weex.bridge.SimpleJSCallback
import io.dcloud.feature.weex.WeexInstanceMgr
import io.dcloud.uts.UTSAndroid
import io.dcloud.uts.UTSCallback
import io.dcloud.uts.UTSJSONObject
import io.dcloud.uts.UniCallbackWrapper
import java.util.concurrent.ConcurrentHashMap
import kotlin.jvm.functions.Function1
import org.json.JSONArray
import org.json.JSONObject

private const val TAG = "TrandsIAP"
private const val ERR_INVALID = 9011001
private const val ERR_NOT_READY = 9011002
private const val ERR_BILLING = 9011009

@Volatile
private var billingClient: BillingClient? = null

@Volatile
private var connecting = false

private val productCache = ConcurrentHashMap<String, ProductDetails>()

@Volatile
private var purchasesUpdatedCb: Any? = null

private fun getContext(): Context? = UTSAndroid.getAppContext()

private fun getActivity(): Activity? {
    try {
        UTSAndroid.getUniActivity()?.let { return it }
    } catch (_: Throwable) {
    }
    return try {
        UTSAndroid.getTopPageActivity()
    } catch (_: Throwable) {
        null
    }
}

private fun cacheKey(productId: String, productType: String): String = "$productId|$productType"

private val mainHandler = Handler(Looper.getMainLooper())

/**
 * Resolve current Weex/uni-app instance id for [SimpleJSCallback].
 * Needed when ByJs passes a raw JS callback id ([Integer]) instead of [UTSCallback].
 */
private fun resolveWeexInstanceId(): String? {
    try {
        val map = WXSDKManager.getInstance().allInstanceMap
        if (!map.isNullOrEmpty()) {
            map.keys.firstOrNull { it.contains("service", ignoreCase = true) }?.let { return it }
            return map.keys.first()
        }
    } catch (_: Throwable) {
    }
    try {
        val pre = WeexInstanceMgr.self().preInstanceId
        if (!pre.isNullOrBlank()) return pre
    } catch (_: Throwable) {
    }
    return null
}

/**
 * Invoke JS callback with a plain JSON string.
 *
 * UTS [initUTSProxyFunction] registers params as type=UTSCallback but may still deliver a raw
 * [Integer] callback id when the Kotlin ByJs signature is [Any]/[Object]. In that case fire via
 * [SimpleJSCallback] / [WXBridgeManager.callbackJavascript].
 */
private fun invokeCb(cb: Any?, jsonString: String, keepAlive: Boolean = false) {
    if (cb == null) return
    val preview = if (jsonString.length > 200) jsonString.substring(0, 200) else jsonString
    val run = Runnable {
        try {
            Log.i(TAG, "invokeCb class=${cb.javaClass.name} json=$preview")
            when (cb) {
                is UTSCallback -> {
                    Log.i(TAG, "invokeCb via UTSCallback id=${cb.mCallbackId}")
                    cb.invoke(jsonString)
                }
                is UniCallbackWrapper -> cb.invoke(jsonString)
                is Function1<*, *> -> (cb as Function1<Any?, Any?>).invoke(jsonString)
                is Number -> {
                    val id = cb.toInt()
                    val instanceId = resolveWeexInstanceId()
                    if (instanceId.isNullOrBlank()) {
                        Log.e(TAG, "invokeCb: no weex instance for callbackId=$id")
                        return@Runnable
                    }
                    val jsCb = SimpleJSCallback(instanceId, id.toString())
                    Log.i(TAG, "invokeCb via callbackId=$id")
                    if (keepAlive) {
                        jsCb.invokeAndKeepAlive(jsonString)
                    } else {
                        jsCb.invoke(jsonString)
                    }
                }
                else -> {
                    val m =
                        cb.javaClass.methods.firstOrNull {
                            it.name == "invoke" && it.parameterTypes.size == 1
                        }
                    if (m != null) {
                        m.invoke(cb, jsonString)
                    } else {
                        Log.e(TAG, "invokeCb: no invoke method on ${cb.javaClass.name}")
                    }
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "callback failed: $e", e)
        }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
        run.run()
    } else {
        mainHandler.post(run)
    }
}

private fun failJson(
    errCode: Int,
    billingResponseCode: Int?,
    debugMessage: String?,
): String {
    val o = JSONObject()
    o.put("errCode", errCode)
    o.put("errMsg", debugMessage ?: "")
    if (billingResponseCode != null) {
        o.put("billingResponseCode", billingResponseCode)
    } else {
        o.put("billingResponseCode", JSONObject.NULL)
    }
    o.put("subResponseCode", JSONObject.NULL)
    o.put("debugMessage", debugMessage ?: "")
    return o.toString()
}

private fun callFail(fail: Any?, errCode: Int, billingResponseCode: Int?, debugMessage: String?) {
    invokeCb(fail, failJson(errCode, billingResponseCode, debugMessage))
}

private fun callSuccess(success: Any?, json: String) {
    invokeCb(success, json)
}

private fun mapPurchaseState(code: Int): String {
    return when (code) {
        Purchase.PurchaseState.PURCHASED -> "purchased"
        Purchase.PurchaseState.PENDING -> "pending"
        else -> "unspecified"
    }
}

private fun purchaseToJson(p: Purchase): JSONObject {
    val o = JSONObject()
    o.put("orderId", p.orderId)
    o.put("packageName", p.packageName)
    val productsArr = JSONArray()
    for (id in p.products) {
        productsArr.put(id)
    }
    o.put("products", productsArr)
    o.put("purchaseTime", p.purchaseTime)
    o.put("purchaseToken", p.purchaseToken)
    o.put("quantity", p.quantity)
    val stateCode = p.purchaseState
    o.put("purchaseStateCode", stateCode)
    o.put("purchaseState", mapPurchaseState(stateCode))
    o.put("isAcknowledged", p.isAcknowledged)
    o.put("isAutoRenewing", p.isAutoRenewing)
    o.put("isSuspended", p.isSuspended)
    o.put("originalJson", p.originalJson)
    o.put("signature", p.signature)
    return o
}

private fun mapPurchases(list: List<Purchase>?): JSONArray {
    val arr = JSONArray()
    if (list == null) return arr
    for (p in list) {
        arr.put(purchaseToJson(p))
    }
    return arr
}

private fun safeOfferToken(getter: () -> String?): String? {
    return try {
        getter()
    } catch (e: Throwable) {
        Log.w(TAG, "getOfferToken failed: $e")
        null
    }
}

private fun oneTimeOfferToJson(offer: ProductDetails.OneTimePurchaseOfferDetails): JSONObject {
    val o = JSONObject()
    o.put("formattedPrice", offer.formattedPrice)
    o.put("priceAmountMicros", offer.priceAmountMicros)
    o.put("priceCurrencyCode", offer.priceCurrencyCode)
    o.put("offerToken", safeOfferToken { offer.offerToken } ?: JSONObject.NULL)
    o.put("offerId", offer.offerId ?: JSONObject.NULL)
    try {
        o.put("purchaseOptionId", offer.purchaseOptionId ?: JSONObject.NULL)
    } catch (e: Throwable) {
        Log.w(TAG, "purchaseOptionId omitted: $e")
    }
    return o
}

private fun subOfferToJson(offer: ProductDetails.SubscriptionOfferDetails): JSONObject {
    val o = JSONObject()
    o.put("basePlanId", offer.basePlanId)
    o.put("offerId", offer.offerId ?: JSONObject.NULL)
    o.put("offerToken", safeOfferToken { offer.offerToken } ?: JSONObject.NULL)
    return o
}

private fun productDetailsToJson(pd: ProductDetails): JSONObject {
    val o = JSONObject()
    o.put("productId", pd.productId)
    o.put("productType", pd.productType)
    o.put("title", pd.title)
    o.put("name", pd.name)
    o.put("description", pd.description)
    o.put("queriedAt", System.currentTimeMillis())

    val oneTimeArr = JSONArray()
    val oneList = pd.oneTimePurchaseOfferDetailsList
    if (!oneList.isNullOrEmpty()) {
        for (offer in oneList) {
            oneTimeArr.put(oneTimeOfferToJson(offer))
        }
    } else {
        pd.oneTimePurchaseOfferDetails?.let {
            oneTimeArr.put(oneTimeOfferToJson(it))
        }
    }
    o.put("oneTimePurchaseOffers", oneTimeArr)

    val subArr = JSONArray()
    pd.subscriptionOfferDetails?.forEach {
        subArr.put(subOfferToJson(it))
    }
    o.put("subscriptionOffers", subArr)
    return o
}

private val purchasesListener = PurchasesUpdatedListener { billingResult, purchases ->
    val responseCode = billingResult.responseCode
    val debugMessage = billingResult.debugMessage ?: ""
    Log.i(TAG, "onPurchasesUpdated code=$responseCode msg=$debugMessage")
    val result = JSONObject()
    result.put("responseCode", responseCode)
    result.put("subResponseCode", billingResult.onPurchasesUpdatedSubResponseCode)
    result.put("debugMessage", debugMessage)
    result.put("purchases", mapPurchases(purchases))
    invokeCb(purchasesUpdatedCb, result.toString(), keepAlive = true)
}

fun isReady(): Boolean {
    return try {
        billingClient?.isReady == true
    } catch (_: Throwable) {
        false
    }
}

/** Internal options-object API (optional); ByJs layer uses top-level callbacks. */
fun connect(options: UTSJSONObject) {
    val enableAuto = options.getBoolean("enableAutoServiceReconnection", true)
    val enablePrepaid = options.getBoolean("enablePrepaidPlans", true)
    val success = options.getAny("success")
    val fail = options.getAny("fail")
    connectInternal(enableAuto, enablePrepaid, success, fail)
}

private fun connectInternal(
    enableAuto: Boolean,
    enablePrepaid: Boolean,
    success: Any?,
    fail: Any?,
) {
    Log.i(TAG, "connect")
    if (isReady()) {
        callSuccess(success, JSONObject().put("connectionState", "connected").toString())
        return
    }
    if (connecting && billingClient != null) {
        Log.i(TAG, "connect already in progress")
        return
    }
    val context = getContext()
    if (context == null) {
        callFail(fail, ERR_INVALID, null, "no app context")
        return
    }

    val pendingBuilder = PendingPurchasesParams.newBuilder().enableOneTimeProducts()
    if (enablePrepaid) {
        pendingBuilder.enablePrepaidPlans()
    }
    val pendingParams = pendingBuilder.build()

    val builder = BillingClient.newBuilder(context)
        .setListener(purchasesListener)
        .enablePendingPurchases(pendingParams)
    if (enableAuto) {
        builder.enableAutoServiceReconnection()
    }

    try {
        try {
            billingClient?.endConnection()
        } catch (_: Throwable) {
        }
        val client = builder.build()
        billingClient = client
        connecting = true
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                connecting = false
                val code = billingResult.responseCode
                val msg = billingResult.debugMessage
                Log.i(TAG, "onBillingSetupFinished code=$code msg=$msg")
                if (code == BillingClient.BillingResponseCode.OK) {
                    callSuccess(success, JSONObject().put("connectionState", "connected").toString())
                } else {
                    callFail(fail, ERR_BILLING, code, msg)
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "onBillingServiceDisconnected")
            }
        })
    } catch (e: Throwable) {
        connecting = false
        Log.e(TAG, "connect failed: $e")
        callFail(fail, ERR_BILLING, null, e.toString())
    }
}

private fun getBillingConfigInternal(success: Any?, fail: Any?) {
    val c = billingClient
    if (c == null || !c.isReady) {
        callFail(fail, ERR_NOT_READY, null, "billing not ready")
        return
    }
    try {
        c.getBillingConfigAsync(
            GetBillingConfigParams.newBuilder().build(),
            BillingConfigResponseListener { billingResult, billingConfig: BillingConfig? ->
                val code = billingResult.responseCode
                val msg = billingResult.debugMessage
                Log.i(TAG, "getBillingConfig code=$code")
                if (code != BillingClient.BillingResponseCode.OK || billingConfig == null) {
                    callFail(fail, ERR_BILLING, code, msg)
                    return@BillingConfigResponseListener
                }
                val out = JSONObject()
                out.put("countryCode", billingConfig.countryCode)
                callSuccess(success, out.toString())
            },
        )
    } catch (e: Throwable) {
        callFail(fail, ERR_BILLING, null, e.toString())
    }
}

private fun queryProductDetailsInternal(productsJson: String, success: Any?, fail: Any?) {
    val c = billingClient
    if (c == null || !c.isReady) {
        callFail(fail, ERR_NOT_READY, null, "billing not ready")
        return
    }
    val products: JSONArray
    try {
        products = JSONArray(productsJson)
    } catch (e: Throwable) {
        callFail(fail, ERR_INVALID, null, "invalid productsJson: $e")
        return
    }
    if (products.length() == 0) {
        callFail(fail, ERR_INVALID, null, "products required")
        return
    }
    try {
        val productList = ArrayList<QueryProductDetailsParams.Product>()
        for (i in 0 until products.length()) {
            val item = products.getJSONObject(i)
            val productId = item.optString("productId", "")
            val productType = item.optString("productType", "")
            if (productId.isEmpty() || productType.isEmpty()) {
                callFail(fail, ERR_INVALID, null, "invalid product entry")
                return
            }
            val type =
                if (productType == "subs") BillingClient.ProductType.SUBS else BillingClient.ProductType.INAPP
            productList.add(
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(productId)
                    .setProductType(type)
                    .build(),
            )
        }
        val params = QueryProductDetailsParams.newBuilder().setProductList(productList).build()
        c.queryProductDetailsAsync(
            params,
            ProductDetailsResponseListener { billingResult, result: QueryProductDetailsResult ->
                val code = billingResult.responseCode
                val msg = billingResult.debugMessage
                Log.i(TAG, "queryProductDetails code=$code")
                if (code != BillingClient.BillingResponseCode.OK) {
                    callFail(fail, ERR_BILLING, code, msg)
                    return@ProductDetailsResponseListener
                }
                try {
                    val productsArr = JSONArray()
                    val productIds = ArrayList<String>()
                    for (pd in result.productDetailsList) {
                        productCache[cacheKey(pd.productId, pd.productType)] = pd
                        productsArr.put(productDetailsToJson(pd))
                        productIds.add(pd.productId)
                    }
                    val unfetchedArr = JSONArray()
                    for (u: UnfetchedProduct in result.unfetchedProductList) {
                        val uo = JSONObject()
                        uo.put("productId", u.productId)
                        uo.put("productType", u.productType)
                        uo.put("statusCode", u.statusCode)
                        unfetchedArr.put(uo)
                        productCache.remove(cacheKey(u.productId, u.productType))
                    }
                    Log.i(
                        TAG,
                        "queryProductDetails OK productCount=${productsArr.length()} " +
                            "unfetchedCount=${unfetchedArr.length()} " +
                            "successCbNull=${success == null} productIds=$productIds",
                    )
                    if (productsArr.length() == 0) {
                        Log.w(TAG, "queryProductDetails code=0 but products empty; still callSuccess")
                    }
                    val out = JSONObject()
                    out.put("products", productsArr)
                    out.put("unfetchedProducts", unfetchedArr)
                    callSuccess(success, out.toString())
                } catch (e: Throwable) {
                    Log.e(TAG, "queryProductDetails mapping failed", e)
                    callFail(fail, ERR_BILLING, code, e.message ?: e.toString())
                }
            },
        )
    } catch (e: Throwable) {
        Log.e(TAG, "queryProductDetails failed: $e")
        callFail(fail, ERR_BILLING, null, e.toString())
    }
}

private fun launchBillingFlowInternal(payloadJson: String, success: Any?, fail: Any?) {
    val c = billingClient
    if (c == null || !c.isReady) {
        callFail(fail, ERR_NOT_READY, null, "billing not ready")
        return
    }
    val activity = getActivity()
    if (activity == null) {
        callFail(fail, ERR_INVALID, null, "no activity")
        return
    }
    val payload: JSONObject
    try {
        payload = JSONObject(payloadJson)
    } catch (e: Throwable) {
        callFail(fail, ERR_INVALID, null, "invalid payloadJson: $e")
        return
    }
    val items = payload.optJSONArray("items")
    if (items == null || items.length() == 0) {
        callFail(fail, ERR_INVALID, null, "items required")
        return
    }
    val productTypeHint = payload.optString("productType", "")
    try {
        val paramsList = ArrayList<BillingFlowParams.ProductDetailsParams>()
        for (i in 0 until items.length()) {
            val item = items.getJSONObject(i)
            val productId = item.optString("productId", "")
            if (productId.isEmpty()) {
                callFail(fail, ERR_INVALID, null, "productId required")
                return
            }
            var pd: ProductDetails? = null
            if (productTypeHint.isNotEmpty()) {
                val t =
                    if (productTypeHint == "subs") BillingClient.ProductType.SUBS else BillingClient.ProductType.INAPP
                pd = productCache[cacheKey(productId, t)]
            }
            if (pd == null) pd = productCache[cacheKey(productId, BillingClient.ProductType.INAPP)]
            if (pd == null) pd = productCache[cacheKey(productId, BillingClient.ProductType.SUBS)]
            if (pd == null) {
                callFail(
                    fail,
                    ERR_INVALID,
                    null,
                    "product not cached, queryProductDetails first: $productId",
                )
                return
            }
            val offerToken = item.optString("offerToken", "")
            val pdb = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd)
            if (offerToken.isNotEmpty()) {
                pdb.setOfferToken(offerToken)
            }
            paramsList.add(pdb.build())
        }
        val flowBuilder = BillingFlowParams.newBuilder().setProductDetailsParamsList(paramsList)
        // 回调绑人：十进制 user_id 字符串（勿传 UUID/JSON）；Play API 才会有 obfuscatedExternalAccountId
        val obfuscatedAccountId = payload.optString("obfuscatedAccountId", "")
        if (obfuscatedAccountId.isNotEmpty()) {
            flowBuilder.setObfuscatedAccountId(obfuscatedAccountId)
            Log.i(TAG, "launchBillingFlow obfuscatedAccountId len=${obfuscatedAccountId.length}")
        }
        val flowParams = flowBuilder.build()
        val br = c.launchBillingFlow(activity, flowParams)
        val code = br.responseCode
        val msg = br.debugMessage
        Log.i(TAG, "launchBillingFlow code=$code msg=$msg")
        if (code == BillingClient.BillingResponseCode.OK) {
            val out = JSONObject()
            out.put("responseCode", code)
            out.put("debugMessage", msg ?: "")
            callSuccess(success, out.toString())
        } else {
            callFail(fail, ERR_BILLING, code, msg)
        }
    } catch (e: Throwable) {
        Log.e(TAG, "launchBillingFlow failed: $e")
        callFail(fail, ERR_BILLING, null, e.toString())
    }
}

fun onPurchasesUpdated(callback: Any?) {
    purchasesUpdatedCb = callback
    Log.i(
        TAG,
        "onPurchasesUpdated registered class=${callback?.javaClass?.name ?: "null"}",
    )
}

// --- ByJs entry points (initUTSProxyFunction / IndexKt) ---
// Top-level callbacks + JSON strings — do NOT nest success inside options.
// Prefer UTSCallback so ProxyModule ParamConvertHelper wraps JS callback ids;
// invokeCb still accepts raw Integer ids as a fallback.

fun connectByJs(optionsJson: String?, success: UTSCallback?, fail: UTSCallback?) {
    var enableAuto = true
    var enablePrepaid = true
    if (!optionsJson.isNullOrBlank()) {
        try {
            val o = JSONObject(optionsJson)
            enableAuto = o.optBoolean("enableAutoServiceReconnection", true)
            enablePrepaid = o.optBoolean("enablePrepaidPlans", true)
        } catch (e: Throwable) {
            Log.w(TAG, "connectByJs parse optionsJson: $e")
        }
    }
    connectInternal(enableAuto, enablePrepaid, success, fail)
}

fun isReadyByJs(): Boolean {
    return isReady()
}

fun getBillingConfigByJs(success: UTSCallback?, fail: UTSCallback?) {
    getBillingConfigInternal(success, fail)
}

fun queryProductDetailsByJs(productsJson: String, success: UTSCallback?, fail: UTSCallback?) {
    queryProductDetailsInternal(productsJson, success, fail)
}

fun launchBillingFlowByJs(payloadJson: String, success: UTSCallback?, fail: UTSCallback?) {
    launchBillingFlowInternal(payloadJson, success, fail)
}

fun onPurchasesUpdatedByJs(callback: UTSCallback?) {
    onPurchasesUpdated(callback)
}
