package com.anonymous.eteczkamobile

import android.content.Context
import android.net.http.X509TrustManagerExtensions
import androidx.annotation.Keep
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient
import java.io.ByteArrayInputStream
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.CertPathValidator
import java.security.cert.PKIXParameters
import java.security.cert.TrustAnchor
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/** A QR-confirmed CA is trusted only by this app; no device-wide CA is installed. */
object LocalTls {
  private const val PREFS = "eteczka_pinned_tls"
  private lateinit var context: Context
  private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private fun manager(pem: String?): X509TrustManager {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    if (pem == null) factory.init(null as KeyStore?) else {
      val certificate = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(pem.toByteArray(Charsets.US_ASCII))) as X509Certificate
      certificate.checkValidity()
      require(certificate.basicConstraints >= 0) { "Certyfikat nie jest urzędem CA." }
      val store = KeyStore.getInstance(KeyStore.getDefaultType()); store.load(null, null); store.setCertificateEntry("computer", certificate); factory.init(store)
    }
    return factory.trustManagers.filterIsInstance<X509TrustManager>().single()
  }
  // Validate the received chain against the QR-confirmed CA without inventing
  // an Android TLS authType after the handshake. OkHttp also verifies the host.
  private fun verifyPinnedChain(certificates: Array<X509Certificate>, pem: String) {
    require(certificates.isNotEmpty()) { "Brak certyfikatu serwera." }
    val factory = CertificateFactory.getInstance("X.509")
    val ca = factory.generateCertificate(ByteArrayInputStream(pem.toByteArray(Charsets.US_ASCII))) as X509Certificate
    ca.checkValidity()
    require(ca.basicConstraints >= 0) { "Nieprawidłowy certyfikat CA." }
    val pathCertificates = certificates.toList().dropLastWhile { it == ca }
    require(pathCertificates.isNotEmpty()) { "Brak certyfikatu serwera." }
    val parameters = PKIXParameters(setOf(TrustAnchor(ca, null))).apply { isRevocationEnabled = false }
    CertPathValidator.getInstance("PKIX").validate(factory.generateCertPath(pathCertificates), parameters)
  }
  private fun pemFor(host: String): String? {
    val p = prefs()
    if (host.equals(p.getString("pending_host", null), true)) return p.getString("pending_pem", null)
    if (host.equals(p.getString("active_host", null), true)) return p.getString("active_pem", null)
    return null
  }
  /** Android/OkHttp calls this host-aware overload to obtain the verified chain. */
  @Keep
  class ComputerTrustManager(private val system: X509TrustManager) : X509TrustManager {
    override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = system.checkClientTrusted(chain, authType)
    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
      try { system.checkServerTrusted(chain, authType); return } catch (_: Exception) { }
      for (name in listOf("pending_pem", "active_pem")) {
        val pem = prefs().getString(name, null) ?: continue
        try { manager(pem).checkServerTrusted(chain, authType); return } catch (_: Exception) { }
      }
      throw java.security.cert.CertificateException("Niezaufany certyfikat serwera.")
    }
    @Keep
    @Throws(java.security.cert.CertificateException::class)
    fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, host: String): List<X509Certificate> {
      val pem = pemFor(host) ?: return X509TrustManagerExtensions(system).checkServerTrusted(chain, authType, host)
      try {
        verifyPinnedChain(chain, pem)
        val ca = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(pem.toByteArray(Charsets.US_ASCII))) as X509Certificate
        val result = chain.toMutableList()
        if (result.none { it == ca }) result.add(ca)
        return result
      } catch (e: Exception) { throw java.security.cert.CertificateException("Nie udało się zweryfikować certyfikatu komputera.", e) }
    }
  }
  fun init(app: Context) {
    context = app.applicationContext
    prefs().edit().remove("pending_host").remove("pending_pem").commit()
    val system = manager(null)
    val trust = ComputerTrustManager(system)
    val ssl = SSLContext.getInstance("TLS"); ssl.init(null, arrayOf(trust), null)
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder().sslSocketFactory(ssl.socketFactory, trust)
        .addNetworkInterceptor { chain ->
          val request = chain.request(); val host = request.url.host; val pem = pemFor(host)
          if (pem != null) {
            if (!request.isHttps) {
              if (request.method != "GET" || request.url.encodedPath != "/api/pairing-certificate" || request.header("Authorization") != null) throw java.io.IOException("Niezaszyfrowane połączenie z komputerem jest zabronione.")
            } else {
              val certificates = chain.connection()?.handshake()?.peerCertificates?.filterIsInstance<X509Certificate>()?.toTypedArray() ?: throw java.io.IOException("Brak certyfikatu serwera.")
              try { verifyPinnedChain(certificates, pem) } catch (e: Exception) { throw javax.net.ssl.SSLPeerUnverifiedException("Nie udało się zweryfikować certyfikatu komputera.").apply { initCause(e) } }
            }
          } else if (request.isHttps) {
            // A custom computer CA must not grant trust to unrelated hosts.
            val certificates = chain.connection()?.handshake()?.peerCertificates?.filterIsInstance<X509Certificate>()?.toTypedArray() ?: throw java.io.IOException("Brak certyfikatu serwera.")
            val authType = when (certificates[0].publicKey.algorithm.uppercase()) {
              "EC", "ECDSA" -> "ECDHE_ECDSA"
              else -> "ECDHE_RSA"
            }
            try { X509TrustManagerExtensions(system).checkServerTrusted(certificates, authType, host) } catch (e: Exception) { throw javax.net.ssl.SSLPeerUnverifiedException("Niezaufany certyfikat serwera.") }
          } else if (request.header("Authorization") != null || request.url.encodedPath == "/api/pair") {
            throw java.io.IOException("Wysyłanie tokenu lub kodu parowania przez HTTP jest zabronione.")
          }
          chain.proceed(request)
        }.build()
    }
  }
  fun setPending(host: String, pem: String) { require(host.isNotBlank()); manager(pem); check(prefs().edit().putString("pending_host", host).putString("pending_pem", pem).commit()) }
  fun commit() { val p = prefs(); val host = p.getString("pending_host", null) ?: error("Brak certyfikatu parowania."); val pem = p.getString("pending_pem", null) ?: error("Brak certyfikatu parowania."); check(p.edit().putString("active_host", host).putString("active_pem", pem).remove("pending_host").remove("pending_pem").commit()) }
  fun clearPending() { prefs().edit().remove("pending_host").remove("pending_pem").commit() }
  fun isPending(host: String) = host.equals(prefs().getString("pending_host", null), true) && prefs().contains("pending_pem")
  fun isActive(host: String) = host.equals(prefs().getString("active_host", null), true) && prefs().contains("active_pem")
}
class LocalTlsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "LocalTls"
  @ReactMethod fun setPending(host: String, pem: String, promise: Promise) { try { LocalTls.setPending(host, pem); promise.resolve(null) } catch (e: Exception) { promise.reject("TLS_CERT", "Nieprawidłowy certyfikat komputera.", e) } }
  @ReactMethod fun commit(promise: Promise) { try { LocalTls.commit(); promise.resolve(null) } catch (e: Exception) { promise.reject("TLS_COMMIT", "Nie udało się zapisać certyfikatu.", e) } }
  @ReactMethod fun clearPending(promise: Promise) { LocalTls.clearPending(); promise.resolve(null) }
  @ReactMethod fun isPending(host: String, promise: Promise) { promise.resolve(LocalTls.isPending(host)) }
  @ReactMethod fun isActive(host: String, promise: Promise) { promise.resolve(LocalTls.isActive(host)) }
}
class LocalTlsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(LocalTlsModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
