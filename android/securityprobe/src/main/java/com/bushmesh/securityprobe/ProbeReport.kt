package com.bushmesh.securityprobe

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.AtomicFile
import com.bushmeshmain.security.BushMeshCurve25519Keys
import com.bushmeshmain.security.BushMeshSecurityCore
import java.io.File
import java.security.KeyStore
import java.security.Security
import org.json.JSONArray
import org.json.JSONObject

/**
 * Identifiers only: never reads live BushMesh storage, radio, files,
 * contacts, map packs, positions, secret material or private keys.
 */
object ProbeReport {
  const val APP_ID = "com.bushmesh.securityprobe"
  const val REPORT_NAME = "capability-report.json"
  private const val DB = "securityprobe_capability_v1.db"
  private const val AES_ALIAS = "securityprobe_capability_aes_v1"

  fun inspect(context: Context): JSONObject {
    check(context.packageName == APP_ID) { "Not running under the isolated probe package" }
    val requested = context.packageManager.getPackageInfo(
      APP_ID, PackageManager.GET_PERMISSIONS,
    ).requestedPermissions.orEmpty().toList()
    check(requested.isEmpty()) { "Standalone security probe must request zero permissions" }

    val core = BushMeshSecurityCore(context, DB, AES_ALIAS)
    val keyProbe = try {
      BushMeshCurve25519Keys(core).probe()
    } catch (e: Exception) {
      JSONObject().put("enabled", false)
        .put("ed25519", false).put("x25519", false)
        .put("failureClass", e.javaClass.simpleName)
    } finally {
      core.close()
    }

    val providerNames = JSONArray()
    for (provider in Security.getProviders()) {
      providerNames.put(provider.name)
    }
    val report = JSONObject()
    report.put("schema", "bushmesh-security-probe-capabilities-v1")
    report.put("reportVersion", 1)
    report.put("collectedUtcEpochMs", System.currentTimeMillis())
    report.put("scope", "dedicated-app-hardware-capability-only")
    report.put("applicationId", APP_ID)
    report.put("instrumentationApplicationId", "com.bushmesh.securityprobe.test")
    report.put("installationIsolation", JSONObject()
      .put("zeroRequestedPermissions", requested.isEmpty())
      .put("radioServiceNotPackaged", try {
        Class.forName("com.bushmeshmain.radio.BushMeshRadioService")
        false
      } catch (_: ClassNotFoundException) { true })
      .put("securityStoreDatabase", DB)
      .put("keystoreAliasScope", "dedicated-Android-app-UID"))
    report.put("device", JSONObject()
      .put("manufacturer", Build.MANUFACTURER)
      .put("model", Build.MODEL)
      .put("androidRelease", Build.VERSION.RELEASE)
      .put("sdkInt", Build.VERSION.SDK_INT)
      .put("securityPatch", if (Build.VERSION.SDK_INT >= 23) Build.VERSION.SECURITY_PATCH else "unavailable"))
    report.put("providers", JSONObject()
      .put("androidKeyStore", try {
        KeyStore.getInstance("AndroidKeyStore").provider.name
      } catch (e: Exception) { "unavailable:" + e.javaClass.simpleName })
      .put("installedProviderNames", providerNames))
    report.put("capabilities", keyProbe)
    report.put("classification", when {
      keyProbe.optBoolean("enabled", false) -> "LOCAL_HARDWARE_SELF_TEST_PASS_NOT_ATTESTED"
      else -> "UNSUPPORTED_OR_UNVERIFIED_NO_PRODUCTION_USE"
    })
    report.put("hardwareRollbackResistanceProven", false)
    report.put("remoteAttestationPerformed", false)
    report.put("productionSecurityActivated", false)
    report.put("secretsOrKeyBytesIncluded", false)
    return report
  }

  fun save(context: Context, report: JSONObject) {
    check(context.packageName == APP_ID)
    val atomic = AtomicFile(File(context.filesDir, REPORT_NAME))
    val stream = atomic.startWrite()
    try {
      stream.write(report.toString(2).toByteArray(Charsets.UTF_8))
      atomic.finishWrite(stream)
    } catch (error: Exception) {
      atomic.failWrite(stream)
      throw error
    }
  }

  fun readExportable(context: Context): String {
    check(context.packageName == APP_ID)
    return File(context.filesDir, REPORT_NAME).readText()
  }
}
