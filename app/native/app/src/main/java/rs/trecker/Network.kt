package rs.trecker

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

data class HttpResult(val status: Int, val text: String, val retryAfter: Long?)

object Network {
    fun request(method: String, url: String, body: String = "", headers: Map<String, String> = emptyMap(), timeout: Int = 20_000): HttpResult {
        var connection: HttpURLConnection? = null
        try {
            val target = URL(url)
            require(target.host in setOf("online.nsmart.rs", "gspns.rs", "www.gspns.rs")) { "Unsupported data source" }
            connection = target.openConnection() as HttpURLConnection
            connection.requestMethod = method
            connection.connectTimeout = minOf(timeout, 15_000)
            connection.readTimeout = timeout
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Trecker/2.1")
            connection.setRequestProperty("Accept-Language", "sr,en;q=0.8")
            headers.forEach(connection::setRequestProperty)
            if (method == "POST") {
                connection.doOutput = true
                val bytes = body.toByteArray(Charsets.UTF_8)
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val text = stream?.use { input ->
                val output = ByteArrayOutputStream(); val buffer = ByteArray(16_384)
                while (true) { val count = input.read(buffer); if (count < 0) break; output.write(buffer, 0, count) }
                output.toString("UTF-8")
            } ?: ""
            val retry = connection.getHeaderField("Retry-After")?.toLongOrNull()
            return HttpResult(status, text, retry)
        } finally {
            connection?.disconnect()
        }
    }

    fun query(params: Map<String, Any?>): String = params.entries.joinToString("&") { (key, value) ->
        val values = value as? List<*> ?: listOf(value)
        values.joinToString("&") { encode(key) + "=" + encode(it?.toString().orEmpty()) }
    }

    fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}
