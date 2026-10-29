/**
 * @file googleAuth.js
 * @description Android Google 登录拿 OIDC id_token。
 *
 * 背景：uni.login({provider:'google'}) 在 Android 只回 openid/email，没有 id_token，
 * 后端 /api/auth/googlelogin 会 400。因此改用原生 GoogleSignIn + requestIdToken。
 *
 * GOOGLE_WEB_CLIENT_ID 必须是 Google Cloud「Web 应用」Client ID（不能用 Android 类型）。
 */
import { GOOGLE_WEB_CLIENT_ID } from "./googleAuthConfig.js";

export { GOOGLE_WEB_CLIENT_ID };

const REQ_CODE = 200;

function str(v) {
  if (v == null) return "";
  try {
    return String(v);
  } catch {
    return "";
  }
}

/**
 * @returns {Promise<{
 *   id_token: string,
 *   email?: string,
 *   nickname?: string,
 *   avatar?: string,
 *   openid?: string,
 * }>}
 */
export function googleOAuthLogin() {
  // #ifndef APP-PLUS
  return Promise.reject(new Error("Google Sign-In requires Android App"));
  // #endif

  // #ifdef APP-PLUS
  const platform = String(uni.getSystemInfoSync().platform || "").toLowerCase();
  if (platform !== "android") {
    return Promise.reject(new Error("Google Sign-In requires Android App"));
  }

  const webClientId = GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) {
    return Promise.reject(new Error("GOOGLE_WEB_CLIENT_ID is empty"));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(data);
    };

    try {
      const mainActivity = plus.android.runtimeMainActivity();
      const GoogleSignInOptions = plus.android.importClass(
        "com.google.android.gms.auth.api.signin.GoogleSignInOptions"
      );
      const GoogleSignIn = plus.android.importClass(
        "com.google.android.gms.auth.api.signin.GoogleSignIn"
      );

      // 与 DCloud 社区验证写法一致：Builder 链式调用，仅 getSignInIntent 用 invoke
      const gso = new GoogleSignInOptions.Builder(
        GoogleSignInOptions.DEFAULT_SIGN_IN
      )
        .requestIdToken(webClientId)
        .requestEmail()
        .requestProfile()
        .build();

      const mGoogleClient = GoogleSignIn.getClient(mainActivity, gso);
      const signInIntent = plus.android.invoke(mGoogleClient, "getSignInIntent");
      if (!signInIntent) {
        finish(new Error("getSignInIntent failed — check Play Services / custom base"));
        return;
      }

      const prev = mainActivity.onActivityResult;
      mainActivity.onActivityResult = function (requestCode, resultCode, data) {
        if (Number(requestCode) !== REQ_CODE) {
          if (typeof prev === "function") {
            prev.call(mainActivity, requestCode, resultCode, data);
          }
          return;
        }
        try {
          mainActivity.onActivityResult = prev;
        } catch {
          /* ignore */
        }

        try {
          const account = GoogleSignIn.getLastSignedInAccount(mainActivity);
          if (!account) {
            finish(new Error("Google Sign-In cancelled or account empty"));
            return;
          }

          const idToken = str(plus.android.invoke(account, "getIdToken"));
          const openid = str(plus.android.invoke(account, "getId"));
          const email = str(plus.android.invoke(account, "getEmail"));
          const nickname = str(plus.android.invoke(account, "getDisplayName"));
          let avatar = "";
          try {
            const photo = plus.android.invoke(account, "getPhotoUrl");
            if (photo) avatar = str(photo.toString());
          } catch {
            /* ignore */
          }

          console.log("[GoogleAuth] hasIdToken:", !!idToken, "openid:", openid);

          if (!idToken) {
            finish(
              new Error(
                "id_token empty — googleAuthConfig.js 必须填 Web 应用 Client ID"
              )
            );
            return;
          }

          finish(null, {
            id_token: idToken,
            email: email || undefined,
            nickname: nickname || undefined,
            avatar: avatar || undefined,
            openid: openid || undefined,
          });
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      };

      mainActivity.startActivityForResult(signInIntent, REQ_CODE);
    } catch (e) {
      finish(e instanceof Error ? e : new Error(String(e)));
    }
  });
  // #endif
}
